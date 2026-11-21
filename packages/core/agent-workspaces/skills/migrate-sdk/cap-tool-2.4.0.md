# @lophn/cap-tool 2.4.0

Previous: 2.3.0
Breaking: no.

New `machines()` reads the person's computers and the one this app's backend runs on: `{ ok: true, value: Machine[] }` or `{ ok: false, error }`. A `Machine` is `{ id, name, status, current, always_on }`, the same shape as `useMachines()` in `@lophn/app-ui`: `id` is the `mch_` id that `connectCommands(..., { on })` takes, `current` is the computer this backend runs on, `status` is `online | offline | connecting | update`, `always_on` is `true`/`false`, or `null` when lophn has no record from that computer yet. No permission is needed and nothing goes in `lophn.ts`. In preview and tests it returns one computer (this one). Nothing changes for an app that does not use it.

```ts
// Before: hand-made detection (do not keep it)
const here = JSON.parse(readFileSync(`${process.env.HOME}/.lophn/machine.json`, "utf8")).id;

// After
import { connectCommands, machines } from "@lophn/cap-tool";
const all = await machines();
if (all.ok) {
  const here = all.value.find((m) => m.current);
  const others = all.value.filter((m) => !m.current);
  // connectCommands("usage", ["usage.read"], { on: others[0].id }) calls the same app on that computer
}
```

Change the same version in `package.json` (`file:.lophn/sdk/cap-tool/2.4.0`) and in `lophn.ts` (`sdk_dependencies`). Nothing else is required of an existing app. Replace hand-made "which computer is this" detection (reading lophn's data folder such as `machine.json`, the hostname, `/proc/<pid>/environ`, an environment variable) with the roster API below. Those values are not given by lophn, differ per computer and break on the next release.

## Instruction diff

lophn changed the instruction text it gives app agents in this version: the SDK guide and the `design-app` skill (`folder-sync.md`). Update your own habits:

- Seeing or using what is on another computer right now is not sync: the person can open that computer's app from their window, and the app can call that computer with `connectCommands(..., { on })` using `machines()` / `useMachines()` and a `MachineSelector`. It needs that computer on. `sync_to` is for having the same data on every computer also while the other one is off; it moves the whole app database (1 GiB, no triggers, text primary keys, no `UNIQUE`/`CHECK` outside the key), so do not turn it on only to share a small summary of a large per-computer table.
- A non-private active app's source and releases reach the person's other computers without `sync_to`; do not set `sync_to` only to install the app elsewhere. A computer that is always on carries the files of the others.
- Never read lophn's data folder or guess "this computer" from the hostname; use `machines()`.

```diff
# @lophn/cap-tool guide.md
@@ -50,2 +50,8 @@ import {
   앱을 부른다("다른 기계의 앱 부르기").
+- `machines()` — 사람의 컴퓨터(폰 제외)와 이 앱 backend가 도는 컴퓨터를 읽는다. `{ok: true, value: Machine[]}`나 `{ok: false, error}`다.
+  `Machine`은 `{id, name, status, current, always_on}`이고 화면의 `useMachines()`(`@lophn/app-ui`)와 같은 모양이다.
+  `id`는 `mch_` id로 `connectCommands`의 `on`에 그대로 쓴다. `status`는 `online`·`offline`·`connecting`·`update`, `current`는 이 backend가 도는
+  컴퓨터 하나, `always_on`은 그 컴퓨터가 "늘 켜 둠"으로 표시됐는지다(그 컴퓨터의 기록이 아직 없으면 `null`). 허락이 필요 없고 선언에 적을 것도
+  없다. 부모 invocation이 돌고 있지 않아도 된다(시작 코드, timer). preview·test에서는 core에 가지 않고 이 컴퓨터 하나뿐인 목록을 돌려준다.
+  앱이 lophn의 data root를 읽거나 hostname·`/proc`으로 컴퓨터를 알아내지 않는다("다른 기계의 앱 부르기").
 - `publish(name, payload)` — 선언의 `events`에 있는 event를 낸다(아래 "앱 event"). `{ok, value: {publication,
@@ -59,3 +65,3 @@ import {
   `ReadQuery`, `ReadSource`, `ReadCoverage`, `ReadFreshness`, `ReadContinuation`,
-  `RejectionCode`, `CommandClient`, `CallOutcome`, `CallOutput`, `AppResult`, `PublishOutput`
+  `RejectionCode`, `CommandClient`, `CallOutcome`, `CallOutput`, `AppResult`, `PublishOutput`, `Machine`
 
@@ -71,2 +77,23 @@ core가 정한 요청한 쪽과 함께 오므로, 받는 앱의 handler에서 `c
 
+어느 컴퓨터가 있는지는 `machines()`로 읽는다. 화면은 `@lophn/app-ui`의 `useMachines()`와 `@lophn/ui/input`의 `MachineSelector`로 컴퓨터를 고르게
+하고 고른 `id`를 operation 입력으로 넘긴다. handler는 `current`인 컴퓨터면 직접 읽고 아니면 `on`에 그 `id`를 준다.
+
+```ts
+import { connectCommands, handle, machines } from "@lophn/cap-tool";
+
+handle("usage.read-on", async (input: { machine: string }) => {
+  const all = await machines();
+  if (!all.ok) throw new Error(all.error.message);
+  const target = all.value.find((m) => m.id === input.machine);
+  if (target === undefined) return { error: "unknown computer" };
+  if (target.current) return await readUsage(); // 이 컴퓨터는 직접 읽는다. `on`에 주면 invalid_input이다
+  const remote = connectCommands("usage", ["usage.read"], { on: target.id });
+  const there = await remote.call("usage.read");
+  return there.ok ? there.value.outcome : { error: there.error.message };
+});
+```
+
+앱은 lophn의 data root(`~/.lophn`의 `machine.json` 등)를 읽거나 hostname·`/proc`·환경 변수로 "이 컴퓨터"를 알아내지 않는다. 그 값은 `machines()`의
+`current`가 준다.
+
 ## 앱 event
# design-app skill (folder-sync.md)
@@ -2,3 +2,4 @@
 
-Read this before you set `sync_to` in `lophn.ts`, before you set up a sync folder
+Read this before you set `sync_to` in `lophn.ts`, before you build a screen that
+shows another computer's data, before you set up a sync folder
 or the tool that moves it, and when `lophn machine environment` shows an error.
@@ -11,3 +12,5 @@ wrote there. There are two kinds:
   the computers, the paired phone carrying them, or a folder all the person's
-  computers see that the person added in Settings. Nothing to set up.
+  computers see that the person added in Settings. Nothing to set up. A computer
+  that is always on carries the files of the others, so two computers that are
+  never on together still meet through it.
 - A named destination (`personal`, `work`): a folder the person set up themselves
@@ -19,2 +22,29 @@ put one into lophn.
 
+## Two needs that look alike
+
+Decide which one the person has before you touch `sync_to`:
+
+- **See or use what is on another computer right now.** Examples: how many
+  resources the agents on my server use, each computer's own logs or harness
+  records. This is not sync. The person can open that computer's app from their
+  window: it draws the same screen with that computer's data. An app can also call
+  the other computer's commands with `connectCommands(app, commands, { on })`
+  (`@lophn/cap-tool`), with the list of computers from `useMachines()`
+  (`@lophn/app-ui`) or `machines()` (`@lophn/cap-tool`) and a `MachineSelector`
+  (`@lophn/ui`) to pick one. It needs that computer to be on. Use the roster API:
+  never read lophn's data folder or guess "this computer" from the hostname.
+- **Have the same data on every computer, also while the other one is off.** This
+  is `sync_to`.
+
+Data that describes one computer (raw logs, file offsets, process state) is not
+synced. When the screen needs another computer's numbers while it is off, sync or
+cache only the small summary.
+
+The limits of `sync_to` come before the choice. Today it moves the whole app
+database, not a table: the store must stay well under 1 GiB, with no triggers,
+text primary keys (no `AUTOINCREMENT`), and no `UNIQUE` or `CHECK` outside the key
+(the full list is in "What syncing asks of the app"). An app with a large
+per-computer table must not turn `sync_to` on to share a small summary: keep the
+large table out of the synced store or call the other computer instead.
+
 ## Pick `sync_to`
@@ -23,3 +53,5 @@ The default is no `sync_to`: the data stays on this computer (and on the phone,
 a `runs_on` phone app). Choose the default unless the person uses this app on
-another computer too, or the data must exist on another machine.
+another computer too, or the data must exist on another machine. The default does
+not stop the app from reaching the other computers: see "Bring an app to another
+machine".
 
@@ -226,6 +258,13 @@ zero. If not, read "Read the state".
 
-On the other computer, after its destination of the same name is set and the tool
-has run there:
+An active app that is not in a `private` workspace reaches the person's other
+computers without `sync_to`: its source and releases travel through `computers`,
+and `lophn machine environment` there lists it in `available`. Only its data and
+`across_machines` events need `sync_to`; without it each computer keeps its own
+data. Do not set `sync_to` just to install the app elsewhere.
+
+On the other computer:
 
-1. `lophn machine environment` lists the app in `available`.
+1. `lophn machine environment` lists the app in `available`. For a named
+   destination, its destination of the same name must be set and the tool must
+   have run there first; `computers` needs neither.
 2. In lophn's home conversation: `lophn app take-in <app>`. The app gets the same
@@ -242,3 +281,4 @@ If take-in answers `conflict` with `sdk_missing`, or the environment shows
 `source_incomplete` means the source bundles for that commit have not fully
-arrived; wait for the tool and try again.
+arrived; wait for the tool (for `computers`, for the link or the carrying computer)
+and try again.
 
```
