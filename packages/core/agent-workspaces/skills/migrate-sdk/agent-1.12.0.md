# @lophn/agent 1.12.0

Previous: 1.11.0
Breaking: no. Needs lophn with apps in agent calls; nothing else moves with it.

Adds apps as call senders, from the app screen only: your screen can hand work to an agent, get one answer back, open sessions (also in other workspaces your app may reach), end the sessions it opened, and attach the chat view to any session it can see. The app process (handlers, start code) cannot send calls or open/end sessions; it keeps `sessions.list|status|stop`.

- Send (screen): `calls.send({to, reply, text, key?})` with `reply: "none"` (hand off) or `"result"` (one answer). Import `calls` from `@lophn/agent`. The call runs as an attended turn; the receiving agent's chat shows `From app:<slug>`. `calls.send` makes a `key` per call, so a retried send returns the first call; pass your own `key` to retry yourself. `to.workspace` may be `{project: "<name>"}`, `{app: "<slug>"}` or `{home: true}` (omitted means your own app workspace).
- Answer: read it with `calls.read(call)` (`state`, `fail_reason`, `result` text). Learn that a call ended from the `lophn` event `call.settled`: declare `subscriptions: [{ source: "lophn", event: "call.settled" }]` in `lophn.ts`, then `onCallSettled(listener)` or `useAgentCalls(session)` on the screen. The event reaches only your app's open screens; a call closed when lophn restarted sends none, so read the call.
- Read: `useAgents()` gives the agent cards you can call; `calls.list(session)` / `useAgentCalls(session)` give the calls a visible session received or sent.
- Sessions: `useAgentSession({..., workspace?})` opens in your app workspace by default, or in another workspace your app may reach. `lophnApp.sessions.end(session)` / `useSessions().end` ends a session your app opened (never one the person opened). Sessions an app opens do not raise a "turn finished" notification, and that stays so after a restart.
- `useAgentSession({session})` now attaches to any session your app can see (before: only your app workspace). Terminal tabs (`term:…`) are not chat sessions.
- Messages your screen sends are the person's messages, now labelled: a message item (and a queued line) carries `via: {app, name}` so the chat shows "via <your app>". Nothing else changes (sender, text the agent receives, permissions).
- Limits: reply modes are `none` and `result` only; the call body is text; a result keeps text only.

```ts
// before: no way for the app to ask an agent without a chat session
// after (app screen)
import { calls } from "@lophn/agent";
const sent = await calls.send({ to: { agent: "reviewer" }, reply: "result", text: "Review the last commit." });
```

```json
// package.json, before
"@lophn/agent": "file:.lophn/sdk/agent/1.11.0",
// after
"@lophn/agent": "file:.lophn/sdk/agent/1.12.0",
```

Change the same version in `lophn.ts` (`sdk_dependencies`). Nothing else is required of an existing app. Add this only when a screen needs to call agents or manage its own sessions.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Update your own habits:

- When an app screen needs an agent to do a job (review, summarize, run a long task) without a chat transcript, send a call with `calls.send` and read the result, instead of opening a chat session and parsing its messages. Do not look for a way to send calls from handlers or start code: there is none. End only sessions your app opened.

```diff
# @lophn/agent guide.md
@@ -17,3 +17,3 @@ import { contextBlock, useAgentSession } from "@lophn/agent";
 
-- `useAgentSession({agent, title?, session?, app?, newId?})` — `{session, state,
+- `useAgentSession({agent, title?, session?, workspace?, app?, newId?})` — `{session, state,
   send, stop, answer, rename, reset, error}`.
@@ -29,5 +29,6 @@ import { contextBlock, useAgentSession } from "@lophn/agent";
     바뀌어도 session을 새로 잇지 않는다.
-  - `session`은 이 앱 workspace의 기존 session에 **다시 붙는다**. 주면 바로 snapshot을
-    읽어 `state`를 채우고 `send`도 거기로 간다(진행 중이던 turn의 답도 이어서 받는다).
-    그 앱 workspace의 session이 아니거나 없으면 `error`가 `forbidden: …`이다.
+  - `session`은 기존 session에 **다시 붙는다**. 이 앱이 볼 수 있는 session이면 어느 것이든 된다
+    (이 앱 workspace의 것, call 정책이 허락한 다른 workspace의 lophn·harness session. 터미널 탭 `term:…`은 아니다).
+    주면 바로 snapshot을 읽어 `state`를 채우고 `send`도 거기로 간다(진행 중이던 turn의 답도 이어서 받는다).
+    볼 수 없거나 없으면 `error`가 `forbidden: …`이다.
     `agent`나 `session`이 바뀌면 session을 바꾼다. id는 앱이 저장한다(예: 판 기록에
@@ -37,3 +38,5 @@ import { contextBlock, useAgentSession } from "@lophn/agent";
     `rename`은 session이 열리기 전에는 `session is not open` 오류다. `items`가 대화의
-    줄(`message`, `tool`, `approval`, `notice`, `hidden`)이고 순서가 `seq`다.
+    줄(`message`, `tool`, `approval`, `notice`, `hidden`)이고 순서가 `seq`다. 앱 화면이 보낸 사람 메시지
+    (이 SDK의 `send`)에는 `via: {app, name}`이 붙는다(어느 앱 화면이 보냈는지 보이는 이름표일 뿐이고
+    메시지는 사람의 것이다). `state.queued`의 줄에도 같은 `via`가 있을 수 있다.
     `turn`이 지금 turn(`phase`: working, waiting, ended)이고 `writing`이 흘러나오는
@@ -87,7 +90,12 @@ import { contextBlock, useAgentSession } from "@lophn/agent";
   선언한 구독은 화면만 쓸 때 process handler가 없어도 된다. process가 같은 event를 받으려면 `@lophn/cap-tool`의 `subscribe("lophn", event, handler)`로 handler를 건다).
-  `filter`는 `{workspace?, state?, harness?, kind?}`다. `stop(session)`은 도는 turn을 멈춘다.
+  `filter`는 `{workspace?, state?, harness?, kind?}`다. `stop(session)`은 도는 turn을 멈추고 `end(session)`은 이 앱이 연 session을 끝낸다.
 - `SESSION_EVENTS` — 위 다섯 event 이름이다.
+- `useAgents()` — 이 앱 workspace에서 부를 수 있는 agent들의 명함 `{state, reload}`다(`state.agents`).
+- `useAgentCalls(session)` — 보이는 session이 받은 call들(새것부터 최대 50) `{state, reload}`다. 이 앱이 보낸 call이 끝나면(`call.settled`) 다시 읽는다.
+- `calls` — 화면에서 `send({to, reply, text, key?})`·`read(call)`·`cancel(call, reason?)`·`list(session)`. `onCallSettled(listener)`는 이 앱이 보낸 call이 끝날 때 부른다.
+- `CALL_SETTLED_EVENT` — `"call.settled"`.
 - type: `AcpState`, `AcpUpdate`, `AcpItem`, `AcpMessageItem`, `AcpToolItem`,
   `AcpAnswer`, `ContentBlock`, `JsonSchema`, `Reply`, `AgentBridge`,
-  `AgentSession`, `Sent`, `Done`, `SessionInfo`, `SessionFilter`, `SessionStatus`, `SessionKind`, `SessionState`, `SessionResult`
+  `AgentSession`, `Sent`, `Done`, `SessionInfo`, `SessionFilter`, `SessionStatus`, `SessionKind`, `SessionState`, `SessionResult`,
+  `AgentCard`, `CallRow`, `CallSendInput`, `CallSent`, `CallSettled`, `CallAddress`
 
@@ -101,3 +109,3 @@ shell pid·cwd·`LOPHN_SESSION_ID`로 직접 한다(`design-app` skill의 예).
 - **앱 화면**은 `useSessions()`나 `lophnApp.sessions`(`list`, `status`, `stop`)를 쓴다.
-- **앱 process**는 `@lophn/agent/process`의 `sessions`(React 없이)를 쓴다. 부모 invocation이 돌고 있지 않아도 된다(시작 code, timer).
+- **앱 process**는 `@lophn/agent/process`의 `sessions`(`list`·`status`·`stop`, React 없이)를 쓴다. 부모 invocation이 돌고 있지 않아도 된다(시작 code, timer).
   - `sessions.list(filter?)` → `{ok, value: {sessions}}`. session 한 줄은 `{session, kind("lophn"|"harness"|"terminal"), agent, harness, workspace, title,
@@ -111,3 +119,38 @@ shell pid·cwd·`LOPHN_SESSION_ID`로 직접 한다(`design-app` skill의 예).
   **켤 때 `sessions.list()`를 한 번 읽고** event로 고친다.
-- 앱이 연 session은 아직 없다(session을 여는 것은 `useAgentSession`이 한다. 앱이 다른 workspace에 여는 길은 열리지 않았다).
+- **session 열기와 끝내기는 앱 화면만 한다.** 앱 process는 session을 열거나 끝내지 못한다(상한 없이 session과 model 호출을 만들 수 있어서다). 화면의
+  `useAgentSession`이 첫 `send`에서 session을 연다(`workspace: {kind, id}`를 주면 이 앱이 call로 닿을 수 있는 다른 workspace에 연다. 정책이 막으면 `forbidden`).
+  앱이 연 session에는 그 표시가 붙는다. 앱은 **자기가 연 session만** `lophnApp.sessions.end`(`useSessions().end`)로 끝낸다(archive와 같은 영향: 도는 turn 중단,
+  받은 call 실패, 대기 요청 취소). 사람이 연 session은 `forbidden`이다. 앱이 연 session은 turn이 끝나도 사람에게 알림이 가지 않는다(승인·질문 알림은 간다).
+  이 표시는 shell을 다시 켜도 남는다.
+
+### agent에게 call 보내기 (앱 화면)
+
+앱 **화면**이 agent에게 일을 맡기고 답을 받는다(A2A). 앱 process(handler, 시작 code)에는 이 길이 없다. 화면에서 보낸 call은 사람이 지켜보는 turn이다.
+
+- `useAgents()`: 이 앱 workspace에서 부를 수 있는 agent의 명함(handle, name, description, runtime, modality, replies).
+- `calls.send({to, reply, text, key?})` → `{call, state, fail_reason}`. `to`는 `{agent: "<handle>"}`(새 session) 또는 `{session: "ses_…"}`(보이는 session) 또는
+  `{agent, session, fallback: "new"}`다. workspace를 빼면 이 앱 workspace에 열린다. 다른 workspace는 `workspace: {project: "<name>"}`·`{app: "<slug>"}`, Home은
+  `workspace: {home: true}`다(전역 agent를 Home에서 부른다). `reply`는 `"none"`(맡기고 끝)과 `"result"`(답 글 하나)뿐이다. 대화(`conversation`)는 열지 않는다.
+  보낼 수 있는 곳은 이 앱 workspace에서 call 정책이 허락한 workspace의 agent·session이고, 아니면 `forbidden`이다. 받는 agent가 그 reply를 지원하지 않으면
+  `invalid_input`이다. 받는 agent의 chat에는 `From app:<slug>`로 보인다. **같은 `key`로 다시 보내면 첫 call을 돌려준다.** `calls.send`가 호출마다 key를 만들어
+  주므로 앱이 따로 하지 않아도 되고, 앱이 직접 재시도하려면 같은 `key`를 넘긴다.
+- `calls.read(call)` → `{call}`. `state`(`accepted`·`done`·`failed`·`cancelled`), `fail_reason`, result call이 `done`이면 `result`(agent의 답 글. 글이
+  아닌 block은 담기지 않는다). 이 앱이 보낸 call만 읽힌다.
+- `calls.cancel(call, reason?)`, `calls.list(session)`(보이는 session이 받았거나 보낸 call들, 최대 50. `result`는 이 앱이 보낸 것만 차 있다),
+  `useAgentCalls(session)`.
+- **끝남은 event로 받는다.** 선언의 `subscriptions`에 `{source: "lophn", event: "call.settled"}`를 적고 화면에서 `onCallSettled`(또는 `useAgentCalls`)를 건다.
+  payload는 `{call, state, fail_reason}`이고 이 앱이 보낸 call에 대해서만 오며 화면이 떠 있는 동안만 받는다. 일이 일어난 뒤의 알림이고 한 번만
+  오며 저장되지 않는다. lophn이 켜질 때 닫힌 call(`lophn_restarted`)은 event가 오지 않는다. 놓쳤으면 `calls.read`로 읽는다. `reply: "none"` call도 받는 turn이
+  입력을 가져가면 `done`으로 끝나 event가 온다.
+
+```ts
+// 앱 화면: agent에게 맡기고 답을 받는다.
+import { calls, onCallSettled } from "@lophn/agent";
+
+const sent = await calls.send({ to: { agent: "reviewer" }, reply: "result", text: "Review the last commit." });
+const off = onCallSettled(async ({ call }) => {
+  const done = await calls.read(call);
+  if (done.ok && done.value.call.state === "done") console.log(done.value.call.result);
+});
+```
 
```
