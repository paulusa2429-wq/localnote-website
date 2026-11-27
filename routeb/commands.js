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
  function done(allow, message) {
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

  try {
    Office.context.mailbox.item.body.getAsync(
      Office.CoercionType.Text,
      function (result) {
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
    console.log("[routeb] error, failing open: " + e);
    done(true);
  }
}

// Register the handler under the exact name the manifest's LaunchEvent declares.
if (typeof Office !== "undefined" && Office.actions && Office.actions.associate) {
  Office.actions.associate("onMessageSend", onMessageSend);
}
