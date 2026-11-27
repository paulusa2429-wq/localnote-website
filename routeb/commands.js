// Proofaro Route B test stub — canned OnMessageSend decision logic.
// Purpose: prove, on a real machine, that Outlook's OnMessageSend Smart Alert
// (SendMode "PromptUser") fires and can hold a send. Nothing here talks to the
// Proofaro app, a bridge, or any server. The decision is deterministic:
//
//   body contains "4800" or "$4,800"  ->  BLOCK, show the native dialog
//   anything else                     ->  ALLOW silently
//   any error                         ->  ALLOW (fail open — a test stub must
//                                        never trap someone's email)
//
// Every decision is logged to this page's console with the "[routeb]" prefix.

var ROUTEB_BLOCK_MESSAGE =
  "Proofaro found a mismatch. The meeting agreed $4,000 \u2014 this draft says $4,800. " +
  "Send anyway from the dialog if you're sure.";
// (Smart Alerts dialog text is capped at 500 characters; the message above is ~124.)

function onMessageSend(event) {
  // BUILD B (2026-11-27): the real canned decision, now on the fixed
  // registration. Diagnostic A proved the block path works once the handler is
  // associated inside Office.onReady. The body read returns here behind a
  // 4-second watchdog: if getAsync never answers, the send is held with a
  // DISTINCT timeout message so the failure is visible in the dialog itself
  // (the first build's hang predated the registration fix, so the read may
  // simply work now).
  var finished = false;
  function done(allow, message) {
    if (finished) return;
    finished = true;
    console.log(
      "[routeb] OnMessageSend decision: allowEvent=" + allow +
      (message ? " errorMessage=" + JSON.stringify(message) : "")
    );
    if (allow) {
      event.completed({ allowEvent: true });
    } else {
      event.completed({ allowEvent: false, errorMessage: message });
    }
  }

  var watchdog = setTimeout(function () {
    done(false,
      "Route B diagnostic B: reading the draft timed out, so the add-in held this send. " +
      "Please report this exact message.");
  }, 4000);

  try {
    Office.context.mailbox.item.body.getAsync(
      Office.CoercionType.Text,
      function (result) {
        clearTimeout(watchdog);
        try {
          var body = (result && result.value) || "";
          console.log("[routeb] draft body read: " + body.length + " characters");
          if (body.indexOf("4800") !== -1 || body.indexOf("$4,800") !== -1) {
            done(false, ROUTEB_BLOCK_MESSAGE);
          } else {
            done(true);
          }
        } catch (e) {
          console.log("[routeb] error reading body, failing open: " + e);
          done(true);
        }
      }
    );
  } catch (e) {
    clearTimeout(watchdog);
    console.log("[routeb] error, failing open: " + e);
    done(true);
  }
}

// Register the handler under the exact name the manifest's LaunchEvent declares.
// DIAGNOSTIC FIX (2026-11-27): registration must happen inside Office.onReady —
// the first stub build associated at script-parse time, and on JP's machine the
// host then waited on a handler it never saw complete (the "taking longer than
// expected / processing" dialog, twice). The product add-in registers inside
// onReady (addin/src/events.ts) — the stub now matches it.
if (typeof Office !== "undefined" && Office.onReady) {
  Office.onReady(function () {
    Office.actions.associate("onMessageSend", onMessageSend);
  });
}
