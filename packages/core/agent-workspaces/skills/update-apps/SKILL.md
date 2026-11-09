---
name: update-apps
description: Look at all of the person's apps after a lophn update, decide per app whether to migrate, adopt new SDK features, or leave it, and hand the chosen work to lophn at each app.
---

# Update apps (the forest view)

The person called this with `/update-apps`, usually from the Inbox notice "SDK
updates for your apps", with no argument. An argument may narrow it to one app
name. Apps are built on lophn's SDK and pin the versions they use. When lophn
ships newer versions an app may stop starting (required), or still run and only
lack new capabilities (available).

You are the one who sees the whole forest. The person cannot judge what an SDK
change broke or made possible; that judgement is yours. Do not hand the person a
list of version bumps. For each app decide what is worth doing. A required
migration is software upkeep: you decide it and do not ask. Ask the person only
about new things an app could do for them. You do not change apps and you cannot read their source:
you judge from what the app is for (`lophn app read`), its public commands, and
the notes. Leave code-level detail to lophn at the app.

1. Which apps. If the person wrote an app name, use it (`lophn app read` finds
   its ID). Otherwise all apps; archived apps are not shown to you, skip them.
2. Read the status: `lophn app sdk-status` (add the app ID for one app). For
   each SDK of an app it gives the pinned version, the current version, a level
   and `notes`. `required`: the app does not start or soon will not.
   `available`: the app still runs and only lacks newer capabilities.
   `current`: nothing to do. If a required app is already stopped,
   `lophn app status` shows it.
3. Know each app. `lophn app read <app ID>` gives its purpose and public
   commands. Use that to judge what matters to it. Say what you could not tell.
4. Read the notes for every version crossed, both required and available. Each
   entry's `notes` lists files; read each with
   `skill.read {name: "migrate-sdk", path: "<note file>"}`. A note says what
   changed, whether it is `Breaking: yes`, and what the version makes possible.
   Read only the listed notes.
5. Decide per app, one of:
   - (a) Required migration: what breaks if it is not done. It is handed over
     without asking.
   - (b) New capabilities worth adopting, given what this app does. Make
     concrete proposals in plain words, tied to the app's purpose. Example: "the
     expense app could send a short-lived notice when spending passes a monthly
     limit, using `@lophn/cap-notify` 1.2.0 (persistent or ephemeral)". Do not
     propose a capability that does not fit the app; "nothing fits" is a fine
     answer.
   - (c) Leave as is: it runs and nothing new is useful.
   Mark which feature proposals you recommend and why.
   Before you ask about an app, look in your Memory for what the person already
   decided about that app. An app they already settled is not asked again: follow
   the decision and say only that you are doing so.
6. Tell the person a short plan per app, without lophn internals (no package
   names, version numbers or code words unless asked): which apps you are
   keeping working after lophn's update (one line, no question), and what new
   things you propose for which app, with your recommendation. An app that needs
   nothing is left out or one line. Then ask with `ask` only about the proposed
   features (per app: which to add, or none); leave out the apps already
   settled. Hand over required migrations right away; hand over features after
   they answer. When they answer, write each app's feature decision in your
   Memory with `agent.memory`, with the app's name.
7. For each app with a required migration or chosen features, hand it to lophn at that app with
   `lophn call send` (`to: {agent: "lophn", workspace: {app: "<app name>"}}`,
   `--reply none`). Body: the required migration (if any); each feature the
   person chose, as a proposal for lophn at the app to confirm with the person
   in the app conversation and design with the `design-app` skill (the person
   chose the idea, not the final shape); the SDK packages with the pinned
   version and the target version; the note file names; and "follow the
   migrate-sdk skill". Do not paste the notes.
8. If a call is refused, say so and tell the person to open the app and ask
   lophn there to follow the migrate-sdk skill.
9. Tell the person in their words which apps are being taken care of and what
   each will gain. Each continues in that app's own conversation (they open the
   app's workspace to follow it and to answer the feature questions). You get
   no result back; `lophn app sdk-status` shows you the status later.
