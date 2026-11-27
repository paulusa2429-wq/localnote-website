"use strict";
(() => {
  // src/core.ts
  var BRIDGE_URL = "http://127.0.0.1:47651/check-draft";
  var SEND_BUDGET_MS = 2e3;
  var CACHE_FRESH_MS = 3e4;
  var PRECOMPUTE_DEBOUNCE_MS = 800;
  var PRECOMPUTE_TIMEOUT_MS = 5e3;
  var normLines = (text) => text.replace(/\r\n?/g, "\n").split("\n");
  var isQuoteStart = (line) => {
    const t = line.trim();
    if (/^on .+ wrote:$/i.test(t)) return true;
    if (/^-{2,}\s*(original message|forwarded message)\s*-{2,}$/i.test(t)) return true;
    if (/^_{5,}$/.test(t)) return true;
    if (t.startsWith(">")) return true;
    return false;
  };
  var isHeaderBlockStart = (lines, i) => {
    if (!/^from:\s/i.test(lines[i].trim())) return false;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      if (/^(sent|date):\s/i.test(lines[j].trim())) return true;
      if (lines[j].trim() === "") return false;
    }
    return false;
  };
  function stripQuotedHistory(bodyText) {
    const lines = normLines(bodyText);
    let cut = lines.length;
    for (let i = 0; i < lines.length; i++) {
      if (isQuoteStart(lines[i]) || isHeaderBlockStart(lines, i)) {
        cut = i;
        break;
      }
    }
    return lines.slice(0, cut).join("\n").trim();
  }
  function hashText(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i) | 0;
    return (h >>> 0).toString(16);
  }
  function fingerprintOf(snapshot2) {
    const recipients = [...snapshot2.recipients].map((r) => r.trim().toLowerCase()).sort().join("|");
    return hashText(`${recipients}
${snapshot2.subject.trim()}
${stripQuotedHistory(snapshot2.bodyText)}`);
  }
  function inputFor(snapshot2, meetingId) {
    return {
      draftText: stripQuotedHistory(snapshot2.bodyText),
      recipients: snapshot2.recipients,
      subject: snapshot2.subject,
      ...meetingId ? { meetingId } : {}
    };
  }
  var isResult = (v) => {
    if (!v || typeof v !== "object") return false;
    const r = v;
    return (r.matchedMeeting === null || typeof r.matchedMeeting === "object") && Array.isArray(r.mismatches) && Array.isArray(r.candidates);
  };
  async function callBridge(deps) {
    if (!deps.token) return { kind: "no-token" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
    try {
      const res = await deps.fetchImpl(deps.url ?? BRIDGE_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${deps.token}`, "content-type": "application/json" },
        body: JSON.stringify(deps.input),
        signal: controller.signal
      });
      if (res.status === 200) {
        const body = await res.json().catch(() => null);
        return isResult(body) ? { kind: "ok", result: body } : { kind: "error", status: 200 };
      }
      if (res.status === 401) return { kind: "unauthorized" };
      if (res.status === 403) return { kind: "refused" };
      return { kind: "error", status: res.status };
    } catch (e) {
      if (controller.signal.aborted || e instanceof Error && e.name === "AbortError") return { kind: "timeout" };
      return { kind: "unreachable" };
    } finally {
      clearTimeout(timer);
    }
  }
  var UNCHECKED_SEND_LINE = "Proofaro wasn't running, so this email wasn't checked.";
  var NOT_CONNECTED_SEND_LINE = "Proofaro isn't connected yet, so this email wasn't checked.";
  var SEND_MESSAGE_LIMIT = 500;
  var clip = (s, max) => s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}\u2026`;
  function sendBlockMessage(active) {
    const n = active.length;
    const first = active[0];
    const head = `Proofaro found ${n} possible ${n === 1 ? "mismatch" : "mismatches"}. `;
    const stamp = first.timestamp ? ` (${first.timestamp})` : "";
    const detail = first.draftText ? `You wrote "${clip(first.draftText, 120)}" \u2014 the meeting said "${clip(first.meetingText, 120)}"${stamp}. ` : `The meeting said "${clip(first.meetingText, 140)}"${stamp} \u2014 it is not in your draft. `;
    const tail = "Open the Proofaro pane to fix it, or send anyway.";
    const full = head + detail + tail;
    return full.length <= SEND_MESSAGE_LIMIT ? full : clip(full, SEND_MESSAGE_LIMIT);
  }
  function activeMismatches(result, dismissed, resolved) {
    return result.mismatches.filter((_, i) => !dismissed.has(i) && !resolved.has(i));
  }
  function decideFromResult(result, dismissed, resolved) {
    if (!result.matchedMeeting) return { allow: true, reason: "no-meeting" };
    const active = activeMismatches(result, dismissed, resolved);
    if (!active.length) return { allow: true, reason: result.mismatches.length ? "all-dismissed" : "clean" };
    return { allow: false, reason: "mismatches", message: sendBlockMessage(active), active: active.length };
  }
  function applyFixToBody(bodyText, mismatch) {
    if (!mismatch.fix || !mismatch.draftText) return null;
    const at = bodyText.indexOf(mismatch.draftText);
    if (at >= 0) return bodyText.slice(0, at) + mismatch.fix + bodyText.slice(at + mismatch.draftText.length);
    const normalised = bodyText.replace(/\r\n?/g, "\n");
    const atN = normalised.indexOf(mismatch.draftText);
    if (atN >= 0) return normalised.slice(0, atN) + mismatch.fix + normalised.slice(atN + mismatch.draftText.length);
    return null;
  }
  var SendCheckSession = class {
    deps;
    now;
    entry = null;
    lastFailure = null;
    dismissed = /* @__PURE__ */ new Set();
    resolved = /* @__PURE__ */ new Set();
    overrideFor = null;
    chosenMeetingId = null;
    lastFingerprint = null;
    precomputeTimer = null;
    constructor(deps) {
      this.deps = deps;
      this.now = deps.now ?? Date.now;
    }
    /** a different draft (addressees, subject or new text changed) starts with a clean slate */
    syncDraft(fingerprint) {
      if (fingerprint === this.lastFingerprint) return;
      this.lastFingerprint = fingerprint;
      this.dismissed = /* @__PURE__ */ new Set();
      this.resolved = /* @__PURE__ */ new Set();
      this.overrideFor = null;
      this.chosenMeetingId = null;
    }
    async runCheck(snapshot2, timeoutMs) {
      const outcome = await callBridge({
        fetchImpl: this.deps.fetchImpl,
        token: this.deps.token(),
        input: inputFor(snapshot2, this.chosenMeetingId ?? void 0),
        timeoutMs,
        ...this.deps.url ? { url: this.deps.url } : {}
      });
      if (outcome.kind === "ok") {
        this.entry = { fingerprint: fingerprintOf(snapshot2), result: outcome.result, at: this.now() };
        this.lastFailure = null;
        this.deps.clearUncheckedSend?.();
        this.deps.clearNotConnectedSend?.();
      } else if (outcome.kind !== "no-token") {
        this.lastFailure = outcome.kind;
      }
      return outcome;
    }
    /** pre-compute as the draft changes, debounced — by send time the answer is already here */
    schedulePrecompute(snapshot2) {
      this.syncDraft(fingerprintOf(snapshot2));
      if (this.precomputeTimer) clearTimeout(this.precomputeTimer);
      this.precomputeTimer = setTimeout(() => {
        this.precomputeTimer = null;
        void this.runCheck(snapshot2, PRECOMPUTE_TIMEOUT_MS);
      }, PRECOMPUTE_DEBOUNCE_MS);
    }
    /** run a check now (the pane opening, a meeting switch) and keep the result */
    async checkNow(snapshot2) {
      this.syncDraft(fingerprintOf(snapshot2));
      return this.runCheck(snapshot2, PRECOMPUTE_TIMEOUT_MS);
    }
    /** the meeting switcher: re-run against the chosen candidate; its cards replace the old ones */
    async switchMeeting(meetingId, snapshot2) {
      this.syncDraft(fingerprintOf(snapshot2));
      this.chosenMeetingId = meetingId;
      this.dismissed = /* @__PURE__ */ new Set();
      this.resolved = /* @__PURE__ */ new Set();
      return this.runCheck(snapshot2, PRECOMPUTE_TIMEOUT_MS);
    }
    /** "Not a mismatch": this card stops counting against the send */
    dismiss(index) {
      this.dismissed.add(index);
      this.persistClearance();
    }
    /** "Fix it" applied: this card is settled */
    markResolved(index) {
      this.resolved.add(index);
    }
    /** "Send anyway": the person's word for this exact draft — the send goes, and a programmatic resend is not held again */
    sendAnyway(snapshot2) {
      this.syncDraft(fingerprintOf(snapshot2));
      this.overrideFor = fingerprintOf(snapshot2);
      this.persistClearance();
    }
    persistClearance() {
      if (!this.deps.saveClearance || !this.lastFingerprint) return;
      this.deps.saveClearance({
        fingerprint: this.lastFingerprint,
        override: this.overrideFor === this.lastFingerprint,
        dismissed: [...this.dismissed]
      });
    }
    /** the on-send decision: fresh cache, else a budgeted check; every failure allows */
    async decideSend(snapshot2) {
      const fingerprint = fingerprintOf(snapshot2);
      this.syncDraft(fingerprint);
      if (this.overrideFor === fingerprint) return { allow: true, reason: "user-override" };
      const clearance = this.deps.clearance?.() ?? null;
      const cleared = clearance && clearance.fingerprint === fingerprint ? clearance : null;
      if (cleared?.override) return { allow: true, reason: "user-override" };
      const dismissed = cleared ? /* @__PURE__ */ new Set([...this.dismissed, ...cleared.dismissed]) : this.dismissed;
      if (!this.deps.token()) {
        this.deps.recordNotConnectedSend?.();
        return { allow: true, reason: "not-paired" };
      }
      if (this.entry && this.entry.fingerprint === fingerprint && this.now() - this.entry.at < CACHE_FRESH_MS) {
        return decideFromResult(this.entry.result, dismissed, this.resolved);
      }
      const outcome = await this.runCheck(snapshot2, SEND_BUDGET_MS);
      if (outcome.kind === "no-token") {
        this.deps.recordNotConnectedSend?.();
        return { allow: true, reason: "not-paired" };
      }
      if (outcome.kind !== "ok") {
        this.deps.recordUncheckedSend?.();
        return { allow: true, reason: "bridge-unavailable" };
      }
      return decideFromResult(outcome.result, dismissed, this.resolved);
    }
    /** what the task pane shows for this draft right now */
    paneModel(snapshot2) {
      const fingerprint = fingerprintOf(snapshot2);
      this.syncDraft(fingerprint);
      const notes = [];
      if (snapshot2.hasAttachments) notes.push("Attachments are not checked.");
      if (!this.deps.token()) return { state: "needs-pairing", meeting: null, candidates: [], cards: [], activeCount: 0, notes };
      const entry = this.entry && this.entry.fingerprint === fingerprint ? this.entry : null;
      if (!entry) {
        const down = this.lastFailure === "unreachable" || this.lastFailure === "timeout" || this.lastFailure === "error";
        if (this.lastFailure === "unauthorized") {
          return { state: "not-paired-token-rejected", meeting: null, candidates: [], cards: [], activeCount: 0, notes: [...notes, "The app did not accept the paired token. Paste the current one from Proofaro Settings \u2192 Send-Time Check."] };
        }
        return {
          state: down ? "bridge-down" : "unknown",
          meeting: null,
          candidates: [],
          cards: [],
          activeCount: 0,
          notes: [...notes, ...down ? ["Proofaro is not reachable on this computer \u2014 this draft will send unchecked."] : ["Not checked yet."]]
        };
      }
      const { result } = entry;
      if (!result.matchedMeeting) {
        return { state: "no-meeting", meeting: null, candidates: [], cards: [], activeCount: 0, notes: [...notes, "No matching meeting found \u2014 this draft will send as it is."] };
      }
      const cards = result.mismatches.map((m, i) => ({
        index: i,
        type: m.type,
        draftText: m.draftText,
        meetingText: m.meetingText,
        timestamp: m.timestamp,
        fix: m.fix,
        canFix: m.fix !== null && m.draftText !== null,
        state: this.resolved.has(i) ? "resolved" : this.dismissed.has(i) ? "dismissed" : "open"
      }));
      const active = activeMismatches(result, this.dismissed, this.resolved).length;
      const selectedId = this.chosenMeetingId ?? result.candidates[0]?.id;
      return {
        state: active ? "mismatches" : "clean",
        meeting: result.matchedMeeting,
        candidates: result.candidates.map((c) => ({ ...c, selected: c.id === selectedId })),
        cards,
        activeCount: active,
        notes
      };
    }
  };

  // src/office.ts
  var TOKEN_KEY = "proofaroBridgeToken";
  var CLEARANCE_KEY = "proofaroSendClearance";
  var UNCHECKED_KEY = "proofaroUncheckedSend";
  var NOT_CONNECTED_KEY = "proofaroNotConnectedSend";
  function getPairedToken() {
    try {
      const v = Office.context.roamingSettings.get(TOKEN_KEY);
      return typeof v === "string" && v.trim() ? v.trim() : null;
    } catch {
      return null;
    }
  }
  function setPairedToken(token) {
    Office.context.roamingSettings.set(TOKEN_KEY, token.trim());
    Office.context.roamingSettings.saveAsync();
  }
  function getClearance() {
    try {
      const v = Office.context.roamingSettings.get(CLEARANCE_KEY);
      if (v && typeof v.fingerprint === "string" && typeof v.override === "boolean" && Array.isArray(v.dismissed)) {
        return { fingerprint: v.fingerprint, override: v.override, dismissed: v.dismissed.filter((n) => typeof n === "number") };
      }
    } catch {
    }
    return null;
  }
  function saveClearance(clearance) {
    try {
      Office.context.roamingSettings.set(CLEARANCE_KEY, clearance);
      Office.context.roamingSettings.saveAsync();
    } catch {
    }
  }
  function clearUncheckedSend() {
    try {
      Office.context.roamingSettings.set(UNCHECKED_KEY, 0);
      Office.context.roamingSettings.saveAsync();
    } catch {
    }
  }
  function getUncheckedSendAt() {
    try {
      const v = Office.context.roamingSettings.get(UNCHECKED_KEY);
      return typeof v === "number" && v > 0 ? v : null;
    } catch {
      return null;
    }
  }
  function clearNotConnectedSend() {
    try {
      Office.context.roamingSettings.set(NOT_CONNECTED_KEY, 0);
      Office.context.roamingSettings.saveAsync();
    } catch {
    }
  }
  function getNotConnectedSendAt() {
    try {
      const v = Office.context.roamingSettings.get(NOT_CONNECTED_KEY);
      return typeof v === "number" && v > 0 ? v : null;
    } catch {
      return null;
    }
  }
  var formatRecipient = (r) => r.displayName && r.displayName !== r.emailAddress ? `${r.displayName} <${r.emailAddress}>` : r.emailAddress;
  function getRecipients(field) {
    return new Promise((resolve) => {
      try {
        field.getAsync((r) => resolve(r.status === Office.AsyncResultStatus.Succeeded && Array.isArray(r.value) ? r.value.map(formatRecipient) : []));
      } catch {
        resolve([]);
      }
    });
  }
  function getText(get) {
    return new Promise((resolve) => {
      try {
        get((r) => resolve(r.status === Office.AsyncResultStatus.Succeeded && typeof r.value === "string" ? r.value : ""));
      } catch {
        resolve("");
      }
    });
  }
  async function readSnapshot() {
    const item = Office.context.mailbox.item;
    const [to, cc, subject, bodyText] = await Promise.all([
      getRecipients(item.to),
      getRecipients(item.cc),
      getText((cb) => item.subject.getAsync(cb)),
      getText((cb) => item.body.getAsync(Office.CoercionType.Text, cb))
    ]);
    return {
      bodyText,
      recipients: [...to, ...cc],
      subject,
      hasAttachments: Array.isArray(item.attachments) ? item.attachments.length > 0 : false
    };
  }
  function applyBody(newText) {
    return new Promise((resolve) => {
      try {
        Office.context.mailbox.item.body.setAsync(newText, { coercionType: Office.CoercionType.Text }, (r) => resolve(r.status === Office.AsyncResultStatus.Succeeded));
      } catch {
        resolve(false);
      }
    });
  }
  function sendItemNow() {
    const item = Office.context.mailbox.item;
    if (typeof item.sendAsync !== "function") return Promise.resolve(false);
    try {
      if (!Office.context.requirements.isSetSupported("Mailbox", "1.15")) return Promise.resolve(false);
    } catch {
    }
    return new Promise((resolve) => {
      try {
        item.sendAsync((r) => resolve(r.status === Office.AsyncResultStatus.Succeeded));
      } catch {
        resolve(false);
      }
    });
  }
  function onDraftChanged(handler) {
    const item = Office.context.mailbox.item;
    for (const eventType of [Office.EventType.RecipientsChanged, Office.EventType.SubjectChanged]) {
      try {
        item.addHandlerAsync(eventType, handler);
      } catch {
      }
    }
  }
  var browserFetch = (url, init) => fetch(url, init);

  // src/pane.ts
  var session = new SendCheckSession({
    token: getPairedToken,
    fetchImpl: browserFetch,
    clearance: getClearance,
    saveClearance,
    clearUncheckedSend,
    clearNotConnectedSend
  });
  var snapshot = null;
  var notice = "";
  var TYPE_LABEL = {
    amount: "Amount",
    date: "Date",
    statement: "Wording",
    missing: "Missing from your draft"
  };
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== void 0) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  var dayOf = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(void 0, { year: "numeric", month: "short", day: "numeric" });
  };
  async function refresh(checkFirst) {
    snapshot = await readSnapshot();
    if (checkFirst) await session.checkNow(snapshot);
    render(session.paneModel(snapshot));
  }
  function render(model) {
    const root = document.getElementById("pane");
    if (!root || !snapshot) return;
    root.replaceChildren();
    root.append(el("h1", "Proofaro \u2014 check before you send", "title"));
    if (getUncheckedSendAt()) root.append(el("p", UNCHECKED_SEND_LINE, "notice"));
    if (getNotConnectedSendAt()) root.append(el("p", NOT_CONNECTED_SEND_LINE, "notice"));
    if (notice) {
      root.append(el("p", notice, "notice"));
      notice = "";
    }
    for (const note of model.notes) root.append(el("p", note, "note"));
    if (model.state === "needs-pairing" || model.state === "not-paired-token-rejected") {
      root.append(el("p", "Pair this add-in with Proofaro on this computer. In the Proofaro app, open Settings \u2192 Send-Time Check, turn the check on, and paste the token it shows here. The check then runs entirely on this computer \u2014 your drafts are never sent anywhere else."));
      const input = el("input");
      input.type = "text";
      input.placeholder = "Paste the token from Proofaro Settings";
      input.autocomplete = "off";
      const save = el("button", "Pair");
      save.addEventListener("click", () => {
        if (!input.value.trim()) {
          notice = "Paste the token first.";
          render(model);
          return;
        }
        setPairedToken(input.value);
        notice = "Paired. Checking this draft now\u2026";
        void refresh(true);
      });
      root.append(input, save);
      return;
    }
    if (model.state === "bridge-down") {
      const retry = el("button", "Check again");
      retry.addEventListener("click", () => {
        void refresh(true);
      });
      root.append(el("p", "Open the Proofaro app (and check its Settings \u2192 Send-Time Check switch) \u2014 then try again. Until then, this draft sends unchecked, as it should: Proofaro never blocks your mail."), retry);
      return;
    }
    if (model.state === "unknown") {
      const go = el("button", "Check this draft");
      go.addEventListener("click", () => {
        void refresh(true);
      });
      root.append(go);
      return;
    }
    if (model.state === "no-meeting") return;
    if (model.meeting) {
      root.append(el("p", `Checked against: ${model.meeting.title} \xB7 ${dayOf(model.meeting.date)}`, "meeting"));
      if (model.candidates.length > 1) {
        const select = el("select");
        for (const c of model.candidates) {
          const option = el("option", `${c.title} \xB7 ${dayOf(c.date)}`);
          option.value = c.id;
          option.selected = c.selected;
          select.append(option);
        }
        select.addEventListener("change", () => {
          if (!snapshot) return;
          void session.switchMeeting(select.value, snapshot).then(() => {
            if (snapshot) render(session.paneModel(snapshot));
          });
        });
        const label = el("label", "Check against a different meeting: ");
        label.append(select);
        root.append(label);
      }
    }
    if (model.state === "clean") {
      root.append(el("p", model.cards.length ? "Every card below is settled \u2014 nothing stands against this draft." : "No mismatches found. Still worth one last read.", "clean"));
    }
    for (const card of model.cards) {
      const box = el("section", void 0, `card ${card.state}`);
      box.append(el("h2", TYPE_LABEL[card.type] ?? card.type));
      if (card.draftText) box.append(el("p", `You wrote: ${card.draftText}`));
      box.append(el("p", `The meeting said: "${card.meetingText}"${card.timestamp ? ` (${card.timestamp})` : ""}`));
      if (card.state === "open") {
        if (card.canFix && card.fix) {
          const fix = el("button", "Fix it");
          fix.addEventListener("click", () => {
            if (!snapshot) return;
            const fixed = applyFixToBody(snapshot.bodyText, card);
            if (!fixed) {
              notice = "That line has changed since the check \u2014 check again and fix it by hand.";
              void refresh(true);
              return;
            }
            void applyBody(fixed).then((ok) => {
              session.markResolved(card.index);
              notice = ok ? "Fixed in your draft. Checking again\u2026" : "Outlook would not apply the fix \u2014 change that line by hand.";
              void refresh(true);
            });
          });
          box.append(fix);
        }
        const dismiss = el("button", "Not a mismatch");
        dismiss.addEventListener("click", () => {
          session.dismiss(card.index);
          if (snapshot) render(session.paneModel(snapshot));
        });
        box.append(dismiss);
      } else {
        box.append(el("p", card.state === "resolved" ? "Fixed." : "Dismissed \u2014 it will not hold your send.", "settled"));
      }
      root.append(box);
    }
    if (model.activeCount > 0) {
      const anyway = el("button", "Send anyway", "send-anyway");
      anyway.addEventListener("click", () => {
        if (!snapshot) return;
        session.sendAnyway(snapshot);
        void sendItemNow().then((sent) => {
          if (!sent && snapshot) {
            notice = "Your choices are saved \u2014 press Send in Outlook and this draft will go as it is.";
            render(session.paneModel(snapshot));
          }
        });
      });
      root.append(anyway);
    }
    const again = el("button", "Check again");
    again.addEventListener("click", () => {
      void refresh(true);
    });
    root.append(again);
  }
  Office.onReady(() => {
    void refresh(true);
    onDraftChanged(() => {
      void readSnapshot().then((s) => {
        snapshot = s;
        session.schedulePrecompute(s);
        setTimeout(() => {
          if (snapshot) render(session.paneModel(snapshot));
        }, 1200);
      }).catch(() => {
      });
    });
  });
})();
