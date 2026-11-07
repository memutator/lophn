---
name: update-apps
description: Move the person's apps to newer lophn SDK versions, one app lophn at a time.
---

# Update apps

The person called this with `/update-apps`, usually with an app name after it
(from a notice that an app needs an update). Apps are built on lophn's SDK and
pin the versions they use. When lophn ships newer versions an app may stop
starting (required) or only miss new features (optional). You do not change
apps (you cannot read their source). You find out what changes, tell the person
in plain words, and hand each app to lophn at that app.

1. Which apps. If the person wrote an app name, use it (`lophn app read` finds
   its ID). Otherwise all apps.
2. Read the status: `lophn app sdk-status` (add the app ID for one app). For
   each SDK of an app it gives the pinned version, the current version, a level
   and `notes`. `required`: the app does not start or soon will not.
   `available`: the app still runs and only lacks newer features. `current`:
   nothing to do. An app with only `current` entries needs nothing; say so. If
   a required app is already stopped, `lophn app status` shows it.
3. Read the notes. Each entry's `notes` lists note files; read each with
   `skill.read {name: "migrate-sdk", path: "<note file>"}`. A note says what
   changed, whether it is `Breaking: yes`, and how app code changes. Read only
   the listed notes.
4. Tell the person, per app and in plain words: what will change for them (a
   screen layout, a setting, something that stops working), whether it is
   required or optional, and what you recommend. Do not use package names,
   version numbers or code words unless the person asks; say "a newer look
   toolkit", "the way screens are declared". Say clearly what you did not read.
   Required updates you recommend; optional ones you offer. If the person
   asked for one app only, or has not agreed, ask with `ask` which apps to
   move before handing anything over.
5. For each app the person agreed to move, hand it to lophn at that app with
   `lophn call send` (`to: {agent: "lophn", workspace: {app: "<app name>"}}`,
   `--reply none`). Body: the SDK packages with the pinned version and the
   target version for each, the note files, and "follow the migrate-sdk skill".
   Do not paste the notes. The app's lophn migrates the code, checks and
   releases; the person answers any consent there.
6. If the call is refused, say so and tell the person to open the app and ask
   lophn there to follow the migrate-sdk skill.
7. Tell the person which apps you handed over and that each continues in that
   app's own conversation (they open the app's workspace to follow it). You do
   not get a result back; say that and that the status can be read again later
   with `lophn app sdk-status`.

Skip apps that are not listed (archived apps are not shown to you).
