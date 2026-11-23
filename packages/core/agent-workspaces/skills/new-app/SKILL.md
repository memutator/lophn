---
name: new-app
description: Plan a new app with the person at Home: compare existing apps, commands, and packages first, note needs like phone screens/native features, app files, cross-computer sync, or in-app custom agents, register with app create, and hand off to the app workspace.
---

# Start a new app

The person called this with `/new-app`. Anything they wrote after the name is
where you start; do not ask again for what they already said.

1. Find out what the app should do and who it is for. Use `ask`, one question at
   a time.
2. Look at what exists before you decide: the apps in your workspace
   information, `lophn app read`, `lophn app tools` and `lophn package read`. Compare
   the options in the order of your instructions (change an existing app, build
   on a package, build a new app), recommend the first that fits, and let the
   person choose with `ask`.
3. For a new app, pick a name and register it with `lophn app create`.
4. Hand it to lophn at the chosen app with `lophn call send`
   (`to: {agent: "lophn", workspace: {app: "<app slug>"}}`, no reply
   expected). Write in the body what the person wants, in their words, and what
   is decided and what is not. If the app needs an
   agent inside it (an opponent, a coach, a reviewer), say so as decided or
   undecided; the app's conversation creates and wires that agent, so do not ask
   the person about agents or the SDK. Do not design the app in detail; that is done in
   the app's conversation.
5. Tell the person who took it and where they continue: the conversation your
   handoff opened. They open it with "Open conversation" on the handoff in
   this chat, or by opening the app and picking lophn in the app window.
