# @lophn/agent 1.13.0

Previous: 1.12.0
Breaking: no

No API change. What changed is the guidance: how to join a process to its session, and how to read sessions from the app process.

Needs lophn with the terminal session tag: in a terminal tab the tab's shell, everything started in it, and the CLI that `claude gui` or `codex gui` starts for the tab have `LOPHN_SESSION_ID=term:<tab>` (the row's `session`). Before, only core sessions (`ses_...`) had it, and a GUI-mode CLI was a child of lophn's shell process, so `terminal.shell_pid` could not find it. A GUI-mode tab now also keeps a row in `sessions.list` with its title and state (running, waiting, idle) from the GUI.

Nothing is required of an existing app's code. Switch a process-to-session join from `shell_pid` to the environment tag when the app shows terminal sessions (keep `shell_pid` as the fallback for tabs opened before the tag).

```ts
// before: terminal tab -> shell_pid -> children (misses a GUI-mode CLI)
const pids = treeOf(row.terminal.shell_pid);
// after: the tag first, shell_pid as fallback
const tagged = processesOf(row.session); // pids whose environ has LOPHN_SESSION_ID=<row.session>
const pids = tagged.length > 0 ? tagged : treeOf(row.terminal.shell_pid);
```

Also read `sessions.list` once at start and then on `session.*` events instead of polling on a timer, and retry a startup call that returns `unavailable` (publish, net, secret and notify answer `unavailable` while lophn is still activating your release) instead of latching it as a permanent failure.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Change your habits to match:

- Find an agent session's processes by `LOPHN_SESSION_ID` first (core sessions `ses_...` and terminal tabs `term:...`); use `terminal.shell_pid` only as the fallback.
- In app process code, read `sessions.list()` once at start, keep the result current from the `session.*` events, and do not poll on a timer. Retry a failed startup call whose code is `unavailable`; give up only on other codes.

```diff
--- a/packages/core/agent-workspaces/skills/design-app/SKILL.md
+++ b/packages/core/agent-workspaces/skills/design-app/SKILL.md
@@ -272,10 +272,15 @@ yourself. lophn gives no process list, no git information and no process kill.
 - A session you may see has `cwd`, `folders` and, for a coding agent in a terminal
   tab, `terminal.shell_pid` (the PTY shell, not the CLI itself).
-- A command a lophn agent runs with `shell.run`, and a headless harness CLI
-  (Claude Code, Codex, OpenCode) with every process it starts, has
-  `LOPHN_SESSION_ID=<session id>` in its environment. Find that session's
-  processes by that variable. An agent that clears the environment before it
-  starts a process hides it; you cannot find that one by the variable.
-- For a terminal tab, start from `shell_pid` and walk the children.
+- Join a process to its session by the environment first. These all have
+  `LOPHN_SESSION_ID=<session id>`: a command a lophn agent runs with `shell.run`,
+  a headless harness CLI (Claude Code, Codex, OpenCode) with every process it
+  starts, and, in a terminal tab, the tab's shell with everything started in it
+  (the value is the row's `session`, `term:<tab>`). The CLI that `claude gui` or
+  `codex gui` starts for a tab carries the same tag, but it is a child of lophn's
+  shell process, not of the tab's shell, so `shell_pid` cannot find it. An agent
+  that clears the environment before it starts a process hides it from the tag.
+- Use `terminal.shell_pid` as the fallback: for a tab opened before the tag
+  existed, or a process that dropped the variable, start from `shell_pid` and walk
+  the children.
 
 Linux only (`/proc`); on macOS and Windows use `ps` or the platform's tools and
@@ -314,5 +319,5 @@ export function treeOf(root: number): number[] {
 }
 
-// pids whose environment has LOPHN_SESSION_ID=<session>.
+// pids whose environment has LOPHN_SESSION_ID=<session>: core sessions (ses_...) and terminal tabs (term:...).
 export function processesOf(session: string): number[] {
   const want = `LOPHN_SESSION_ID=${session}`;
--- a/packages/sdk/agent/guide.md
+++ b/packages/sdk/agent/guide.md
@@ -107,5 +107,5 @@ import { contextBlock, useAgentSession } from "@lophn/agent";
 
 lophn만 아는 것(어떤 session이 있고 무슨 상태인가)을 앱이 읽고 멈춘다. 폴더의 git 상태, process 목록, process 죽이기는 주지 않는다. 그것은 앱이 session의
-shell pid·cwd·`LOPHN_SESSION_ID`로 직접 한다(`design-app` skill의 예).
+환경 표지 `LOPHN_SESSION_ID`와 shell pid·cwd로 직접 한다(`design-app` skill의 예).
 
 - **보이는 범위.** 앱은 그 앱 workspace에 사는 agent가 call로 닿을 수 있는 workspace의 session만 본다(private workspace는 안 보이고 같은
@@ -116,4 +116,9 @@ shell pid·cwd·`LOPHN_SESSION_ID`로 직접 한다(`design-app` skill의 예).
     state("running"|"waiting"|"idle"|"unknown"), waiting_for("approval"|"question"|null), last_active_at, spawned_by, cwd, folders, terminal}`이다.
     `terminal`은 터미널 탭의 coding agent일 때 `{harness, cli_session, tab, shell_pid}`다(`shell_pid`는 PTY shell이고 CLI 자신이 아니다).
+    탭이 GUI view(`claude gui`·`codex gui`)이면 `title`, `state`, `terminal.cli_session`은 GUI가 아는 값(제목, turn 단계)이다.
+  - **process를 session에 잇는 법.** 환경 표지를 먼저 본다. lophn agent의 `shell.run`과 그 아래 process, headless harness CLI와 그 아래 process는
+    `LOPHN_SESSION_ID=<session>`(`ses_…`)이고, 터미널 탭의 shell과 그 안에서 뜬 모든 process(TUI CLI)는 `LOPHN_SESSION_ID=term:<탭>`이다. 목록 한 줄의
+    `session`과 같은 값이다. GUI view가 띄운 CLI도 같은 값을 받지만 그 CLI는 탭의 shell이 아니라 lophn shell의 자식이라 `shell_pid` 아래에서 찾을 수 없다.
+    `shell_pid`는 환경 표지가 없는 때(표지가 생기기 전에 연 탭, 환경을 비우고 띄운 process)의 대안이다.
   - `sessions.status(session)` → token, 비용, context 점유(lophn·harness session만).
   - `sessions.stop(session)` → `{stopped}`. 도는 turn을 멈추고 그 turn에 딸린 process를 정리한다. 앱이 멈춘 것은 사람이 볼 수 있게 기록된다(Inbox History와 앱 상세
@@ -121,5 +126,38 @@ shell pid·cwd·`LOPHN_SESSION_ID`로 직접 한다(`design-app` skill의 예).
 - **상태가 바뀔 때**를 받으려면 선언의 `subscriptions`에 `{source: "lophn", event: "session.running"}`을 적고 앱 process에서
   `subscribe("lophn", "session.running", (info) => …)`(`@lophn/cap-tool`)를 건다. payload는 목록의 한 줄과 같다. event는 일이 일어난 뒤의 알림이고 한 번만 오며 저장되지 않는다.
-  **켤 때 `sessions.list()`를 한 번 읽고** event로 고친다.
+  **켤 때 `sessions.list()`를 한 번 읽고** event로 고친다. timer로 목록을 계속 다시 읽지 않는다.
+- **시작 code의 첫 호출은 한 번 더 시도한다.** 프로세스를 먼저 띄우고 release를 active로 잇는 사이에 시작 code가 `publish`, `net`·`secret`·`notify`를 부르면
+  `unavailable`이 온다(곧 된다는 뜻이다). `sessions.list`는 이 사이에도 읽힌다. `unavailable`을 영구 실패로 굳히지 말고 짧게 쉬었다 다시 시도한다.
+
+```ts
+// 앱 process: 켤 때 한 번 읽고 event로 고친다. 시작 중의 unavailable은 다시 시도한다.
+import { type SessionInfo, SESSION_EVENTS, sessions } from "@lophn/agent/process";
+import { subscribe } from "@lophn/cap-tool";
+
+const known = new Map<string, SessionInfo>();
+
+async function load(): Promise<void> {
+  for (let attempt = 0; attempt < 5; attempt++) {
+    const read = await sessions.list();
+    if (read.ok) {
+      known.clear();
+      for (const info of read.value.sessions) known.set(info.session, info);
+      return;
+    }
+    if (read.error.code !== "unavailable") return; // 영구 거절은 다시 해도 같다
+    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
+  }
+}
+
+await load();
+for (const event of SESSION_EVENTS) {
+  subscribe<SessionInfo>("lophn", event, (info) => {
+    if (event === "session.ended") known.delete(info.session);
+    else known.set(info.session, info);
+  });
+}
+```
+
+화면은 `useSessions()`가 같은 일을 한다(한 번 읽고 `session.*` event에 다시 읽는다). timer로 `reload()`를 부르지 않는다.
 - **session 열기와 끝내기는 앱 화면만 한다.** 앱 process는 session을 열거나 끝내지 못한다(상한 없이 session과 model 호출을 만들 수 있어서다). 화면의
   `useAgentSession`이 첫 `send`에서 session을 연다(`workspace: {kind, id}`를 주면 이 앱이 call로 닿을 수 있는 다른 workspace에 연다. 정책이 막으면 `forbidden`).
```
