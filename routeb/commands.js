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
  // DIAGNOSTIC BUILD A (2026-11-27): no body read. The first build hung inside
  // the send on JP's machine twice — Outlook showed "taking longer than
  // expected / processing message" and never completed. This build completes
  // IMMEDIATELY with a block, to isolate whether the hang is in the body read
  // or in the completion path itself. If this dialog text appears at once,
  // the runtime + event.completed are healthy and the body read is the
  // suspect; the body read then returns behind a watchdog timer whose
  // timeout writes its own distinct dialog message.
  console.log("[routeb] OnMessageSend fired (diagnostic build A — instant block)");
  event.completed({
    allowEvent: false,
    errorMessage:
      "Route B diagnostic A: the add-in held this send instantly, without reading the draft. " +
      "If you can read this, the send-block path works."
  });
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
