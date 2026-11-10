---
name: update-apps
description: Look at all of the person's apps after a lophn update, decide per app whether to migrate, adopt new SDK features, or leave it, record each decision, and hand the chosen work to lophn at each app.
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
about new things an app could do for them. You do not change apps and you cannot
read their source: you judge from what the app is for (`lophn app read`), its
public commands, and the notes. Leave code-level detail to lophn at the app.

lophn keeps the progress, not you: which apps you have already looked at, what
you decided and what became of the features you handed over are in
`lophn app sdk-status`. Do not keep a log of it in your Memory and do not look
for one there.

1. Which apps. If the person wrote an app name, use it (`lophn app read` finds
   its ID). Otherwise all apps; archived apps are not shown to you, skip them.
2. Read the status: `lophn app sdk-status` (add the app ID for one app). For
   each SDK of an app it gives the pinned version, the current version, a
   level, `notes` (after the pinned version) and `unreviewed` (the part of
   `notes` after what you last decided for this app; the same as `notes` when
   you never decided). `required`: the app does not start or soon will not.
   `available`: it still runs and only lacks newer capabilities. `current`:
   nothing to do. The app's `review` is your last decision: `decision`, `through`
   (the versions it covered), `migrated` (for `update`: whether the app now pins
   those versions) and the `features` you chose with their state (`open` until
   lophn at the app reports a result). If a required app is already stopped,
   `lophn app status` shows it.
3. Sort the apps:
   - The app has no `unreviewed` note and no `required` SDK: nothing new to
     look at. If its last `review` was an `update` that is not finished
     (`migrated: false`, or a feature still `open`), keep it for step 6.
   - The app has `unreviewed` notes: read only those. A `leave` you decided
     earlier does not cover them: new notes are looked at fresh.
   - The app has a `required` SDK: you do not ask. It is an `update`.
4. Know each app and read its notes. `lophn app read <app ID>` gives its
   purpose and public commands; use that to judge what matters to it. Say what
   you could not tell. Read each `unreviewed` note (for a required app, also the
   rest of `notes`) with `skill.read {name: "migrate-sdk", path: "<note file>"}`.
   A note says what changed, whether it is `Breaking: yes`, and what the version
   makes possible. Read only the listed notes.
5. Decide per app, one of:
   - (a) Required migration: what breaks if it is not done. Decided without
     asking.
   - (b) New capabilities worth adopting, given what this app does. Make
     concrete proposals in plain words, tied to the app's purpose. Example: "the
     expense app could send a short-lived notice when spending passes a monthly
     limit". Do not propose a capability that does not fit the app; "nothing
     fits" is a fine answer. Mark which proposals you recommend and why.
   - (c) Leave as is: it runs and nothing new is useful. If the app is only
     `available` and the person chooses no feature, it is left: lophn does not
     make a release that only raises the version. A note saying a later release
     will be blocked is not a reason to touch a running app; lophn at the app
     moves it the next time that app is changed.
6. Tell the person a short plan per app, without lophn internals (no package
   names, version numbers or code words unless asked): which apps you are
   keeping working after lophn's update (one line, no question), what new things
   you propose for which app with your recommendation, and, for an app whose
   earlier handoff is not finished, what is still open ("the tray popup for
   Masup has not been reported as done") and whether to send it again. An app
   that needs nothing is left out or one line. Then ask with `ask` only about the
   proposed features (per app: which to add, or none) and about sending an
   unfinished handoff again; leave out everything else.
7. Record each decision with `lophn app sdk-decide <app ID>`, for every app that
   had `unreviewed` notes or a `required` SDK, and for an unfinished handoff the
   person wants sent again. This one command writes the decision and, for
   `update`, hands the work to lophn at the app in the same action: do not send
   a call yourself and do not write the pin, target versions or note names;
   lophn fills them in.
   - `--decision leave`: keep as is. Not allowed for an app with a `required`
     SDK.
   - `--decision update`: move the app to the current versions. Add
     `--features '[{"title": "...", "proposal": "...", "note": "<note file>"}]'`
     for each feature the person chose: `title` in the person's words,
     `proposal` for lophn at the app (what they chose and why it fits this app;
     lophn at the app confirms the details with the person and designs it with
     the `design-app` skill, because the person chose the idea, not the final
     shape), `note` the note file that adds the capability. For an `update` of
     an app that is already on the current versions, only the features are sent.
   Hand over required migrations right away; hand over features after the
   person answered. An app with a required SDK and a feature the person chose
   later gets a second `update` with only that feature.
8. If the command is refused (the app's lophn cannot be reached), nothing was
   recorded. Say so and tell the person to open the app and ask lophn there to
   follow the migrate-sdk skill; run the command again once it can be reached.
9. Tell the person in their words which apps are being taken care of and what
   each will gain. Each continues in that app's own conversation (they open the
   app's workspace to follow it and to answer the feature questions). You get no
   answer back, but the status shows you later: the pin when the release goes
   live, and each feature's state and one-line note once lophn at the app
   reports it. A feature that stays `open` is not done; say so the next time.

If this session stops halfway, the apps you recorded are finished and the ones
you did not stay `unreviewed`: the next `/update-apps` continues with them.
