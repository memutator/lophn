# @lophn/agent 1.15.0

Previous: 1.14.0
Breaking: no

No API change. What changed is the guidance lophn gives you about other workspaces, and about apps whose data reaches other computers:

- Removing a public command is your decision; do not ask the person. Before you activate a release whose `removed_public_tools` is not empty, call lophn at home and wait for the result. Home sees which apps and projects use the command, asks lophn there and gives you their answers. If one cannot move off it, bring the command back.
- When this app gets something another workspace may ask about (a new report, a new public command, a job that moved here), tell lophn at home in a line or two, no reply expected. Home keeps the map of the workspaces in the global memory, which every agent reads.
- For an app with `sync_to`, a new release reaches the other computers by itself: activate it on one computer, and do not run `lophn app take-in` again on the others. `lophn machine environment` shows per app how the computers stand on its releases (`follow`, `held`, `machines`), per computer whether lophn must be updated (`exchange`), and keeps `away` while changes held after being away remain. The design-app skill's folder-sync part says how to read each.

Nothing is required of an existing app's code.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Change your habits to match: call lophn at home (`workspace: {home: true}`) for the two cases above instead of asking the person.

```diff
# lophn app agent prompt
@@ -138,5 +138,9 @@
   `removed_public_skills` does the same for public skills. The program does not
-  block it. Other apps and projects may use them. Before you activate, ask the
-  person (lophn at home sees who uses each public command), or bring the
-  command back.
+  block it. Other apps and projects may use them. Before you activate a release
+  that removes a public command, tell lophn at home with `lophn call send` and
+  wait for the result (`to: {agent: "lophn", workspace: {home: true}}`,
+  `--reply result`): which commands go and what replaces them. Home finds who
+  uses them, asks lophn there and gives you their answers. If one cannot move
+  off a command, bring the command back. Do not ask the person: this is your
+  decision.
@@ -150,2 +154,7 @@
   and check the skills that call it before you use it again.
+- When this app gets something another workspace may ask about (a new report,
+  a new public command, a job that moved here), tell lophn at home in a line or
+  two with `lophn call send` (`to: {agent: "lophn", workspace: {home: true}}`,
+  `--reply none`): what it is and whom to ask. Home keeps the map of the
+  workspaces in the global memory.
```

The design-app skill's folder-sync part changed too. Read `lophn machine environment` as it now says; nothing in your `AGENTS.md` changes for it.

```diff
# design-app skill, folder-sync.md
@@ -60,2 +60,2 @@
-  computer runs that release. After you activate a new release on one computer,
-  activate it on the others too (see "Bring an app to another machine").
+  computer runs that release. The other computers that have the app follow a new
+  release by themselves (see "Bring an app to another machine").
@@ -206,3 +206,5 @@
-For a new release: activate it on the first computer, then on each other computer
-run `lophn app take-in <app>` again (it installs only the new release) and activate
-it there. Until then that computer holds the new changes and does not lose them.
+For a new release, activate it on one computer only. Every other computer that has
+the app installs and activates it by itself once its files arrive (`apps[].follow`
+in `lophn machine environment`, see "Releases between computers"). The person is
+asked there only when the release asks for more than the one before. Until then
+that computer holds the new changes and does not lose them.
@@ -240,0 +243,6 @@
+`away` stays set while any of those changes is held: `away.held` counts them and
+`away.changes` lists the table, kind and time of each. `away.since` is when the
+computer fell behind; it is null once the computer caught up but held changes
+remain. They still wait for the person, and while they do this computer sends no
+full copy of the app's data (see `away_too_long` below).
+
@@ -283,0 +292,37 @@
+
+### Releases between computers
+
+For an app with `sync_to`, each `apps[]` entry also shows how the computers stand
+on its releases (an app without it has `follow: null` and empty `held` and
+`machines`). While anything waits, the app keeps running on this computer's data.
+
+- `machines`: each computer that exchanges this app, with the release it runs
+  (`release.number` is its `r<n>` when this computer has that release too,
+  `code_commit`, `data_schema`), its lophn version and `exchange`.
+- `follow.state`: this computer following the release the others run.
+  - `current`: nothing to follow. `installing`, `activating`: under way, wait.
+  - `waiting_consent`: the release asks for more than the one before. The person
+    allows it on this computer in its approval card; tell them which app and what
+    it asks.
+  - `declined`: the person refused it here. This computer stays on its release and
+    the newer release's changes wait. Do not ask again on your own.
+  - `lophn_update`: this computer's lophn is too old for that release. Ask the
+    person to update lophn here.
+  - `install_failed`, `activation_failed`: read `follow.reason` and the app's log.
+    This computer keeps its release. If the cause is in the app, fix it, then build
+    and activate a new release on one computer; the others follow it.
+  - `diverged`: two computers built releases apart. Merge the other computer's
+    branch (`refs/remotes/<machine id>/*`) into this one, build a release and
+    activate it; every computer follows it.
+- `held`: changes from another release that wait here, one line per computer and
+  release, with `changes` and `why`:
+  - `newer_release`: applied once this computer runs that release (`follow`).
+  - `older_release`: that computer runs an older release; its changes come when it
+    follows.
+  - `diverged`: they come after the merged release (see `diverged` above).
+  - `full: true`: more of them wait in the folder; they come the same way.
+- `exchange` (on each of the top `machines` and in `apps[].machines`): `ok`;
+  `update_this`: this computer's lophn is too old to read that computer's files,
+  ask the person to update lophn here; `update_peer`: that computer's lophn is too
+  old, ask the person to update it there. Until then nothing from that computer is
+  read, and nothing is lost.
```
