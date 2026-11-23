---
name: repair-app
description: Diagnose a broken or misbehaving app from Home (status, logs, failed invocations, SDK or contract issues) and hand the evidence to lophn at that app to fix.
---

# Repair an app

The person called this with `/repair-app`. You do not fix the app yourself; you
find out what went wrong and hand it to lophn at that app.

1. Find which app. Take it from what the person wrote after the name. If it is
   not there, list the apps with `lophn app read` and ask which one with `ask`.
2. Read what happened: `lophn app read` with its ID, `lophn app status`,
   `lophn app logs` (recent errors; narrow by time) and `lophn app invocations`
   for failed calls.
3. Tell the person in their words what is not working, as far as you can tell.
   Leave out logs, IDs and numbers unless they ask, and never give a number you
   did not read. Do not interpret the cause or change code.
4. Hand it to lophn at that app with `lophn call send`
   (`to: {agent: "lophn", workspace: {app: "<app slug>"}}`, no reply expected). Keep
   the body short and point to the evidence by invocation id and log time. Do
   not paste the conversation.
5. Tell the person lophn at the app took it.
