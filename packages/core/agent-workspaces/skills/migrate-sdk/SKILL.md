---
name: migrate-sdk
description: Move an app to newer lophn SDK versions (the @lophn/* packages the app pins). Read this when the person asks to update an app's SDK, when an app's pinned SDK versions are older than lophn's, or when an app stopped starting after a lophn update.
---

# Migrate an app's SDK

An app pins exact versions of lophn's SDK packages. When lophn ships newer
versions, the app's code may need changes. This skill is the one procedure;
what changed in each version is in note files beside this file.

If you are lophn at Home, you do not change apps (you cannot read their
source). Read the `update-apps` skill: it looks at all apps as a whole, decides
per app whether to migrate, adopt new features or leave it, asks the person, and
hands each chosen app to lophn at that app (`lophn call send`, no reply
expected) with the required migration, the chosen features, the target
versions, the note files and "follow the migrate-sdk skill". Skip archived apps.

If you are lophn at the app, do steps 1 to 12 for this app only.

## 1. Find the pinned versions

In the app's source folder, two places must hold the same exact versions:

- `package.json`: `"@lophn/<part>": "file:.lophn/sdk/<part>/<version>"`
- `lophn.ts`: `sdk_dependencies: [{ name: "@lophn/<part>", version: "<version>" }]`

`<part>` is the package name without `@lophn/` (`declaration`, `app-ui`, `ui`,
`agent`, `cap-tool`, ...). If the two places differ, take the lower version for
reading notes and make them equal in step 4. Make sure `git status` is clean
first: a release is built from the last commit.

## 2. Find the target versions

`lophn app sdk-status <this app's ID>` gives each pinned SDK with the version
lophn has now (the target), its level and the note files to read.
`lophn package read` lists the SDK packages lophn has now with their versions.
The target of each package is that version. Never pin a version lophn does not
have. A package whose pinned version equals the target needs nothing.
If lophn at Home or the person gave you the versions and note files, check them
against steps 1 and 2 and use them.

## 3. Read the notes

A note is `<part>-<version>.md` and is read with
`skill.read {name: "migrate-sdk", path: "<part>-<version>.md"}`. Read only the
notes after the pinned version up to the target. Start from the target note and
follow its `Previous:` line back until you reach the pinned version. Do not read
other versions. Each note says whether the version is breaking and the exact
code change from the previous version. Read all of them before you edit, and
write the final shape once (do not add something a later note removes).
A note may end with an `## Instruction diff` section: the diff of the guidance lophn
gives app agents (an SDK guide, the `design-app` skill, the app template's
`AGENTS.md`). Apply it to the app's own `AGENTS.md` (the part that came from the
template) and change your habits to match, not only the code.

Some packages move together (for example `@lophn/app-ui` depends on specific
`@lophn/declaration` and `@lophn/ui` versions); the notes say so. When you move a
package, also move the packages it depends on to the versions in its installed
`package.json` if the app pins them.

## 4. Edit the pins

Change both `package.json` and `lophn.ts` to the target versions, exact and
equal. Then run `npm install` in the source folder: it copies the new SDK into
`.lophn/sdk/`. If it fails because a copy is missing, lophn does not have that
version: stop and tell the person which package and version.

## 5. Change the code

Apply the notes: declaration (`lophn.ts`) first, then handlers, then screens.
Search the app for each old name a note lists. Update `DESIGN.md`, tests and
text that mention the old names. Do not do more than the notes require in
this step; new features of a newer version are not part of the migration
itself. If the handoff lists features the person chose, they come after the
migration is released (step 11).

## 6. Check

`lophn declaration check`, `npm run check`, `npm test`. Fix what fails. Commit.

## 7. Prepare, preview, activate

`lophn release prepare` (builds from the commit; on `failed` read `stage` and
`reason`, fix, commit, prepare again). Then `lophn preview start`, walk the
app's main operations and commands with `lophn preview call`, and
`lophn preview stop`. Preview is not proof that production works; say so. Then
`lophn release activate` and handle the result as the app prompt says (`active`,
`waiting_consent`: say what is asked and that the person answers in the waiting
list, `failed`: read `failure`, fix, prepare again).

## 8. A release that no longer starts

After a lophn update an old release may not start (`start_failed`, `crash_loop`
in `lophn app status`) when a note says a major version "no longer starts" with
the old release (for example the declaration changes in 3.0.0 and 4.0.0). An old
release is sealed with its old declaration and cannot be repaired; rolling back
to another old release does not help. The only way is steps 1 to 7: migrate
the source and make a new release.

## 9. Data (`-- loss:`)

Notes rarely need a schema change. If one does, add a new `migrations/<from>-<to>.sql`
step; never edit a step file that was already released. A step that drops a
table or column, or narrows a type, must start with a `-- loss:` line
(`-- loss: drop_table t`, `-- loss: drop_column t.c`, `-- loss: narrow_type t.c`).
Activation then waits for the person's consent. Tell the person what data would
be lost before you activate; if you are not sure, do not drop it.

## 10. If a note cannot be followed

If the app uses something the notes do not cover, or a note's change would
change what the app does, first look in your Memory for what the person already
decided about it. If they settled it, follow that and say only that you did. If
not, stop and ask the person (`ask`); do not guess. When they answer, write the
decision in your Memory with `agent.memory`.

## 11. Features chosen by the person

Only if the handoff from Home lists features. Do this after the migration is
released and working, as a separate change. Each feature is a proposal the
person picked from a short description, not a finished spec: confirm what they
want in this app's conversation (`ask` for the open choices, such as the
threshold or whether it is persistent; skip a choice your Memory already holds,
follow it, and write each new answer there with `agent.memory`), design it with
the `design-app` skill, read the notes of the version that adds it for the exact
API, then implement, check, preview and release as in steps 6 and 7. If a feature does not fit once
you see the code, say so and skip it instead of forcing it.

## 12. Report

For each package: from version, to version, what you changed in the code. Then
what you verified (check, tests, preview) and what you did not, and the release
result. List each chosen feature as done, changed after talking to the person, or
skipped with the reason. If something was left undone, say what and why.
