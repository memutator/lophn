---
name: repair-app
description: Find out what went wrong in one of the person's apps from its status, log and failed calls, tell the person what you found, and hand the fix to that app's App Engineer.
---

# Repair an app

The person called this with `/repair-app`. You do not fix the app yourself; you
find out what went wrong and hand it to the app's App Engineer.

1. Find which app. Take it from what the person wrote after the name. If it is
   not there, read `app.list` and ask which one with `ask`.
2. Read what happened: `app.get`, `app.status`, `app.logs` (recent errors;
   narrow with `since`) and `app.invocations` with `status: "failed"`.
3. Tell the person what you found. Separate what you confirmed from what you
   suppose, and say "not confirmed" for any number you did not read. Do not
   interpret the cause or change code.
4. Hand it to that app's App Engineer with `call` (no reply expected). Keep the
   body short and point to the evidence by invocation id and log time. Do not
   paste the conversation.
5. Tell the person the App Engineer took it.
