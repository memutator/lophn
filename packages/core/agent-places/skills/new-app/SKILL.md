---
name: new-app
description: Start a new app with the person: find out what it should do, check what already exists, then register it and hand it to its App Engineer.
---

# Start a new app

The person called this with `/new-app`. Anything they wrote after the name is
where you start; do not ask again for what they already said.

1. Find out what the app should do and who it is for. Use `ask`, one question at
   a time.
2. Look at what exists before you decide: the domain map in your place
   information, `app.list`, `app.get`, `app.tools` and `package.list`. Compare
   the options in the order of your instructions (change an existing app, build
   on a package, build a new app), recommend the first that fits, and let the
   person choose with `ask`.
3. For a new app, pick a name and register it with `app.create`. It fails when a
   domain with that name exists, so pick another name then.
4. Hand it to the App Engineer of the chosen app with `call`
   (`to: {role: "app_engineer", place: {app: "<app name>"}}`, no reply
   expected). Write in the body what the person wants, in their words, and what
   is decided and what is not. Do not design the app in detail; that is the App
   Engineer's work.
5. Tell the person who took it and where they continue: the conversation your
   hand-off opened. They open it with "Open conversation" on the hand-off in
   this chat, or by picking the App Engineer in the app window.
