# @lophn/agent 1.11.0

Previous: 1.10.0
Breaking: no. Needs lophn with session lifecycle; nothing else moves with it (`@lophn/cap-tool` 2.1.0 is only needed if you subscribe to `session.*` events in the app process).

Adds session lifecycle: your app can read the agent sessions lophn runs, follow their state, and stop a running turn. lophn only gives what lophn alone knows (which sessions exist and their state). It gives no process list, no git information and no process kill. The app does those itself from a session's `cwd`, shell pid and `LOPHN_SESSION_ID`.

- Screens: `useSessions(filter?)` returns `{state, reload, stop}`.
- App process (handlers, start code): import from the new entry `@lophn/agent/process`. It has no React. `sessions.list(filter?)`, `sessions.status(session)`, `sessions.stop(session)` return `{ok: true, value}` or `{ok: false, error}`.
- State changes: declare `subscriptions: [{ source: "lophn", event: "session.running" }]` in `lophn.ts` (events `session.started`, `session.running`, `session.waiting`, `session.idle`, `session.ended`) and register the handler with `subscribe("lophn", "session.running", handler)` from `@lophn/cap-tool` 2.1.0. The handler gets the same session line that `list` returns.
- An app sees only the sessions of workspaces that an agent living in the app's workspace could call (a private workspace is invisible; the app's own workspace is always visible). A session the app may not see is `not_found`.
- `sessions.stop` stops the running turn and cleans up what belongs to it. lophn records that an app stopped it (Inbox History and the app's Activity), so the person can see why.

```ts
// before: no way to know which agent sessions exist
// after (app process)
import { sessions } from "@lophn/agent/process";
const listed = await sessions.list({ state: "running" });
if (listed.ok) for (const s of listed.value.sessions) await sessions.stop(s.session);

// after (screen)
import { useSessions } from "@lophn/agent";
const { state, reload } = useSessions({ state: "running" });
```

```json
// package.json, before
"@lophn/agent": "file:.lophn/sdk/agent/1.10.0",
// after
"@lophn/agent": "file:.lophn/sdk/agent/1.11.0",
```

Change the same version in `lophn.ts` (`sdk_dependencies`). Nothing else is required of an existing app. Add this only when the app needs to watch or stop sessions.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Update your own habits:

- When an app must react to agent sessions (stop Claude Code near a usage limit, watch memory of an agent's processes), use `sessions` and the `session.*` events instead of polling the filesystem. Find an agent's processes yourself: start at `terminal.shell_pid` or look for `LOPHN_SESSION_ID=<session id>` in process environments; do not ask lophn for a process list. The `design-app` skill has an example.

```diff
# @lophn/agent guide.md
@@ -83,5 +83,44 @@ import { contextBlock, useAgentSession } from "@lophn/agent";
 - `agentBridge()` — `window.lophnApp.agent`다. 앱 view 밖이면 `undefined`다.
+- `useSessions(filter?)` — lophn의 agent session 목록이다(session lifecycle). `{state, reload, stop}`이고 `state`는
+  `{status: "loading"}`·`{status: "ready", sessions}`·`{status: "failed", code}`다. 화면이 열릴 때 읽고 `session.started|running|waiting|idle|ended`
+  event가 오면 다시 읽는다. event는 앱이 선언의 `subscriptions`에 `{source: "lophn", event}`를 적었을 때만 온다(적지 않으면 `reload()`로 읽는다.
+  선언한 구독은 화면만 쓸 때 process handler가 없어도 된다. process가 같은 event를 받으려면 `@lophn/cap-tool`의 `subscribe("lophn", event, handler)`로 handler를 건다).
+  `filter`는 `{workspace?, state?, harness?, kind?}`다. `stop(session)`은 도는 turn을 멈춘다.
+- `SESSION_EVENTS` — 위 다섯 event 이름이다.
 - type: `AcpState`, `AcpUpdate`, `AcpItem`, `AcpMessageItem`, `AcpToolItem`,
   `AcpAnswer`, `ContentBlock`, `JsonSchema`, `Reply`, `AgentBridge`,
-  `AgentSession`, `Sent`, `Done`
+  `AgentSession`, `Sent`, `Done`, `SessionInfo`, `SessionFilter`, `SessionStatus`, `SessionKind`, `SessionState`, `SessionResult`
+
+### session lifecycle
+
+lophn만 아는 것(어떤 session이 있고 무슨 상태인가)을 앱이 읽고 멈춘다. 폴더의 git 상태, process 목록, process 죽이기는 주지 않는다. 그것은 앱이 session의
+shell pid·cwd·`LOPHN_SESSION_ID`로 직접 한다(`design-app` skill의 예).
+
+- **보이는 범위.** 앱은 그 앱 workspace에 사는 agent가 call로 닿을 수 있는 workspace의 session만 본다(private workspace는 안 보이고 같은
+  workspace는 늘 보인다). 안 보이는 session은 없는 session과 같다(`not_found`).
+- **앱 화면**은 `useSessions()`나 `lophnApp.sessions`(`list`, `status`, `stop`)를 쓴다.
+- **앱 process**는 `@lophn/agent/process`의 `sessions`(React 없이)를 쓴다. 부모 invocation이 돌고 있지 않아도 된다(시작 code, timer).
+  - `sessions.list(filter?)` → `{ok, value: {sessions}}`. session 한 줄은 `{session, kind("lophn"|"harness"|"terminal"), agent, harness, workspace, title,
+    state("running"|"waiting"|"idle"|"unknown"), waiting_for("approval"|"question"|null), last_active_at, spawned_by, cwd, folders, terminal}`이다.
+    `terminal`은 터미널 탭의 coding agent일 때 `{harness, cli_session, tab, shell_pid}`다(`shell_pid`는 PTY shell이고 CLI 자신이 아니다).
+  - `sessions.status(session)` → token, 비용, context 점유(lophn·harness session만).
+  - `sessions.stop(session)` → `{stopped}`. 도는 turn을 멈추고 그 turn에 딸린 process를 정리한다. 앱이 멈춘 것은 사람이 볼 수 있게 기록된다(Inbox History와 앱 상세
+    Activity). 터미널 session은 그 CLI의 끊기 key를 보내고, key가 없는 harness는 `unavailable`이다.
+- **상태가 바뀔 때**를 받으려면 선언의 `subscriptions`에 `{source: "lophn", event: "session.running"}`을 적고 앱 process에서
+  `subscribe("lophn", "session.running", (info) => …)`(`@lophn/cap-tool`)를 건다. payload는 목록의 한 줄과 같다. event는 일이 일어난 뒤의 알림이고 한 번만 오며 저장되지 않는다.
+  **켤 때 `sessions.list()`를 한 번 읽고** event로 고친다.
+- 앱이 연 session은 아직 없다(session을 여는 것은 `useAgentSession`이 한다. 앱이 다른 workspace에 여는 길은 열리지 않았다).
+
+```ts
+// 앱 process: 구독 한도에서 도는 Claude Code를 멈춘다.
+import { sessions } from "@lophn/agent/process";
+import { subscribe } from "@lophn/cap-tool";
+
+subscribe("masup", "usage.limit", async (e: { percent: number }) => {
+  if (e.percent < 90) return;
+  const listed = await sessions.list({ harness: "claude", state: "running" });
+  if (!listed.ok) return;
+  for (const s of listed.value.sessions) await sessions.stop(s.session);
+});
+```
 
```
