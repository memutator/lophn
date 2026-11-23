# @lophn/agent

## 목적

앱 화면이 자기 앱 workspace의 agent와 이야기하는 길이다. session을 열고, 화면의
context를 block으로 싸서 보내고, ACP 상태를 React state로 받고, 꼴이 있는 답을
값으로 꺼낸다. 화면의 호출은 앱 view의 `lophnApp.agent` 하나로만 간다. 화면에서
보낸 것은 그 앱을 쓰는 사람의 메시지이고, 열린 session은 lophn의 sidebar와 채팅
탭에도 보인다. 앱 안에 따로 대화 UI를 만들지 않아도 되는 일(한 번 시키고 결과를
화면에 그리기)에 쓴다.

## 공개 API와 type

```tsx
import { contextBlock, useAgentSession } from "@lophn/agent";
```

- `useAgentSession({agent, title?, session?, workspace?, app?, newId?})` — `{session, state,
  send, stop, answer, rename, reset, error}`.
  - `agent`는 agent의 **handle**이다. `lophn agent create <handle>`로 agent를 만들 때
    정한 짧은 소문자 이름(예: `omok-opponent`)이고, 이 앱 workspace의 agent(그 앱
    안에서 만든 agent, 또는 전역 agent)를 가리킨다. id(`agt_…`)가 아니다. session은
    화면을 연 것만으로는 열리지 않고 **첫 `send`에서** 이 앱 workspace에 새로 열려
    바로 snapshot을 읽는다(열 때마다 lophn의 sidebar에 session이 하나 생기기
    때문이다). `session`이 없으면 화면이 새로 load될 때마다 첫 `send`에서 새
    session을 연다.
  - `title`은 SDK가 session을 **열 때** 붙이는 제목이다. 주지 않으면 첫 prompt 글이
    제목이 되어 sidebar가 어지러우니 앱이 정한다(예: `"Game 3"`). 열 때 읽는 값이라
    바뀌어도 session을 새로 잇지 않는다.
  - `session`은 기존 session에 **다시 붙는다**. 이 앱이 볼 수 있는 session이면 어느 것이든 된다
    (이 앱 workspace의 것, call 정책이 허락한 다른 workspace의 lophn·harness session. 터미널 탭 `term:…`은 아니다).
    주면 바로 snapshot을 읽어 `state`를 채우고 `send`도 거기로 간다(진행 중이던 turn의 답도 이어서 받는다).
    볼 수 없거나 없으면 `error`가 `forbidden: …`이다.
    `agent`나 `session`이 바뀌면 session을 바꾼다. id는 앱이 저장한다(예: 판 기록에
    넣고 화면이 다시 load될 때 `session`으로 넘긴다).
  - 반환의 `session`은 지금 session id이고 열리기 전에는 `null`이다. `state`는
    ACP 상태(`AcpState`)이고 snapshot을 읽기 전에는 `null`이다. `stop`과 `answer`와
    `rename`은 session이 열리기 전에는 `session is not open` 오류다. `items`가 대화의
    줄(`message`, `tool`, `approval`, `notice`, `hidden`)이고 순서가 `seq`다. 앱 화면이 보낸 사람 메시지
    (이 SDK의 `send`)에는 `via: {app, name}`이 붙는다(어느 앱 화면이 보냈는지 보이는 이름표일 뿐이고
    메시지는 사람의 것이다). `state.queued`의 줄에도 같은 `via`가 있을 수 있다.
    `turn`이 지금 turn(`phase`: working, waiting, ended)이고 `writing`이 흘러나오는
    글이다. 갱신은 `reduceAcp`로 접고 순번이 빠지면 snapshot을 다시 읽는다.
  - `error`는 열기·읽기 실패 `"<code>: <message>"`다. bridge가 없으면(앱 view 밖)
    `unavailable`이다.
  - `send(blocks, {reply?})` — 사람 메시지를 보낸다. 접수되면
    `{ok: true, reply}`, 아니면 `{ok: false, error}`다. 도는 turn이 있으면 다음
    turn으로 줄을 선다. `{reply: schema}`를 주면 꼴을 알리는 글 block이 뒤에
    붙고, `reply`가 그 turn이 끝날 때 **그 turn 마지막 agent 메시지**에서 꺼낸
    값 `{ok: true, value}`나 `{ok: false, error}`로 풀리는 Promise다. 꼴이 없으면
    `reply`는 `null`이다. turn이 실패했거나 멈췄거나 JSON이 아니거나 꼴에 맞지
    않으면 값이 아니라 오류다.
  - `stop()` — 도는 turn을 멈춘다. `{ok}`나 `{ok: false, error}`다.
  - `answer(answers)` — agent가 `ask`로 물은 질문 묶음에 답한다. 답은 질문 순서대로
    `{question, status: "answered" | "unanswered", answer: string[]}`이다.
    승인 카드(`state.pending.approval`)는 이 SDK가 결정하지 않는다. 사람이 lophn의
    채팅 탭에서 결정한다(bridge가 `send`·`stop`·`answer`·`rename` 밖의 입력은
    `forbidden`으로 막는다).
  - `rename(title)` — 지금 session의 제목을 바꾼다. `{ok}`나 `{ok: false, error}`다.
  - `reset()` — 지금 session을 잊는다(`session`과 `state`가 `null`이 된다). 도는 turn은
    멈추지 않으니 필요하면 먼저 `stop()`한다. 다음 `send`가 새 session을 열고 `title`을
    붙인다. 판이 바뀌는 앱이 쓴다. 새 session id를 `session`으로 되넘겨도 화면은
    비지 않는다.
  - 화면을 떠났다 돌아오면 page가 다시 load된다. session id를 저장해 두고 `session`으로
    넘기면 이어 받고, 안 넘기면 새 session이다.
- **keep-alive는 자동이다.** 보내는 중이거나 turn이 도는 동안(`state.turn`이
  `ended`가 아닐 때) SDK가 알아서 page를 살려 둔다. 사람이 그 사이 다른
  workspace로 가도 page가 다시 load되지 않아 기다리던 답을 받는다. 앱은 아무것도 하지
  않는다. 앱이 자기 이유로 `useKeepAlive`(`@lophn/app-ui`)를 써도 서로 끄지 않는다.
  turn이 끝나면 내려가므로 늘 살아 있지는 않다(그래서 판의 session id는 저장한다).
- 앱 안에서 쓸 agent(상대 선수, 코치, 검토자)는 **custom agent를 이 앱 workspace에서
  먼저 만들고**(`lophn agent create`, 지침에 역할과 답 꼴을 쓰고 `tools: []`. custom은
  `lophn` tool을 늘 받으니 명령을 부를 일이 없으면 지침에 그렇게 쓴다) 그
  handle을 `agent`에 준다. 앱을 짓는 agent의 `design-app` skill이 "앱 안 agent"
  절에 절차를 적는다. lophn 기본 agent를 상대로 쓰지 않는다: 제품 규칙과 tool이
  매 turn마다 실려 느리고 비싸다.
- 앱을 짓고 옮기는 lophn은 사람이 그 앱에서 고른 세부(임계값, 단축키)를 자기 memory(`agent.memory`)에
  적고, 사람에게 다시 묻기 전에 memory부터 본다. 모든 workspace가 읽는 global memory(Home이 씀)도
  같은 prompt에 실리니, workspace를 건너는 사실은 거기서 먼저 본다. SDK를 올릴지·어떤 기능을 쓸지의
  결정과 진행은 memory가 아니라 lophn이 기록한다(`lophn app sdk-status`로 읽는다): Home이 넘긴 기능마다
  결과를 `lophn app sdk-feature`로 낸다.
- `contextBlock({name, mimeType, text})` — 화면의 context(보고 있는 글, 고른 항목)를
  `resource` block으로 싼다. 같은 `name`이 한 메시지에서 구별되게 짓는다.
- 꼴은 JSON schema의 부분이다: `type`(object, array, string, number, integer,
  boolean, null), `properties`, `required`, `items`, `enum`. 이 밖의 keyword는 보지
  않는다. 추가 property는 막지 않는다.
  - 답 글에서는 마지막 ```` ```json ```` 블록을 JSON으로 읽고, 없으면 글 전체를
    읽는다.
- `parseReply(text, schema)` — 같은 꺼내기와 검사를 글 하나에 한다.
- `agentBridge()` — `window.lophnApp.agent`다. 앱 view 밖이면 `undefined`다.
- `useSessions(filter?)` — lophn의 agent session 목록이다(session lifecycle). `{state, reload, stop}`이고 `state`는
  `{status: "loading"}`·`{status: "ready", sessions}`·`{status: "failed", code}`다. 화면이 열릴 때 읽고 `session.started|running|waiting|idle|ended`
  event가 오면 다시 읽는다. event는 앱이 선언의 `subscriptions`에 `{source: "lophn", event}`를 적었을 때만 온다(적지 않으면 `reload()`로 읽는다.
  선언한 구독은 화면만 쓸 때 process handler가 없어도 된다. process가 같은 event를 받으려면 `@lophn/cap-tool`의 `subscribe("lophn", event, handler)`로 handler를 건다).
  `filter`는 `{workspace?, state?, harness?, kind?}`다. `stop(session)`은 도는 turn을 멈추고 `end(session)`은 이 앱이 연 session을 끝낸다.
- `SESSION_EVENTS` — 위 다섯 event 이름이다.
- `useAgents()` — 이 앱 workspace에서 부를 수 있는 agent들의 명함 `{state, reload}`다(`state.agents`).
- `useAgentCalls(session)` — 보이는 session이 받은 call들(새것부터 최대 50) `{state, reload}`다. 이 앱이 보낸 call이 끝나면(`call.settled`) 다시 읽는다.
- `calls` — 화면에서 `send({to, reply, text, key?})`·`read(call)`·`cancel(call, reason?)`·`list(session)`. `onCallSettled(listener)`는 이 앱이 보낸 call이 끝날 때 부른다.
- `CALL_SETTLED_EVENT` — `"call.settled"`.
- type: `AcpState`, `AcpUpdate`, `AcpItem`, `AcpMessageItem`, `AcpToolItem`,
  `AcpAnswer`, `ContentBlock`, `JsonSchema`, `Reply`, `AgentBridge`,
  `AgentSession`, `Sent`, `Done`, `SessionInfo`, `SessionFilter`, `SessionStatus`, `SessionKind`, `SessionState`, `SessionResult`,
  `AgentCard`, `CallRow`, `CallSendInput`, `CallSent`, `CallSettled`, `CallAddress`

### session lifecycle

lophn만 아는 것(어떤 session이 있고 무슨 상태인가)을 앱이 읽고 멈춘다. 폴더의 git 상태, process 목록, process 죽이기는 주지 않는다. 그것은 앱이 session의
환경 표지 `LOPHN_SESSION_ID`와 shell pid·cwd로 직접 한다(`design-app` skill의 예).

- **보이는 범위.** 앱은 그 앱 workspace에 사는 agent가 call로 닿을 수 있는 workspace의 session만 본다(private workspace는 안 보이고 같은
  workspace는 늘 보인다). 안 보이는 session은 없는 session과 같다(`not_found`).
- **앱 화면**은 `useSessions()`나 `lophnApp.sessions`(`list`, `status`, `stop`)를 쓴다.
- **앱 process**는 `@lophn/agent/process`의 `sessions`(`list`·`status`·`stop`, React 없이)를 쓴다. 부모 invocation이 돌고 있지 않아도 된다(시작 code, timer).
  - `sessions.list(filter?)` → `{ok, value: {sessions}}`. session 한 줄은 `{session, kind("lophn"|"harness"|"terminal"), agent, harness, workspace, title,
    state("running"|"waiting"|"idle"|"unknown"), waiting_for("approval"|"question"|null), last_active_at, spawned_by, cwd, folders, terminal, workflow}`이다.
    `terminal`은 터미널 탭의 coding agent일 때 `{harness, cli_session, tab, shell_pid}`다(`shell_pid`는 PTY shell이고 CLI 자신이 아니다).
    `workflow`는 workflow step이 넘겼거나 그 세션이 `team spawn`으로 연 자식 세션일 때 `{project, workflow, instance, step}`이고 아니면 `null`이다.
    탭이 GUI view(`claude gui`·`codex gui`)이면 `title`, `state`, `terminal.cli_session`은 GUI가 아는 값(제목, turn 단계)이며 `terminal` 세션으로 나타나므로 `workflow`는 `null`이다.
  - **process를 session에 잇는 법.** 환경 표지를 먼저 본다. lophn agent의 `shell.run`과 그 아래 process, headless harness CLI와 그 아래 process는
    `LOPHN_SESSION_ID=<session>`(`ses_…`)이고, 터미널 탭의 shell과 그 안에서 뜬 모든 process(TUI CLI)는 `LOPHN_SESSION_ID=term:<탭>`이다. 목록 한 줄의
    `session`과 같은 값이다. GUI view가 띄운 CLI도 같은 값을 받지만 그 CLI는 탭의 shell이 아니라 lophn shell의 자식이라 `shell_pid` 아래에서 찾을 수 없다.
    `shell_pid`는 환경 표지가 없는 때(표지가 생기기 전에 연 탭, 환경을 비우고 띄운 process)의 대안이다.
  - `sessions.status(session)` → token, 비용, context 점유(lophn·harness session만).
  - `sessions.stop(session)` → `{stopped}`. 도는 turn을 멈추고 그 turn에 딸린 process를 정리한다. 앱이 멈춘 것은 사람이 볼 수 있게 기록된다(Inbox History와 앱 상세
    Activity). 터미널 session은 그 CLI의 끊기 key를 보내고, key가 없는 harness는 `unavailable`이다.
- **상태가 바뀔 때**를 받으려면 선언의 `subscriptions`에 `{source: "lophn", event: "session.running"}`을 적고 앱 process에서
  `subscribe("lophn", "session.running", (info) => …)`(`@lophn/cap-tool`)를 건다. payload는 목록의 한 줄과 같다. event는 일이 일어난 뒤의 알림이고 한 번만 오며 저장되지 않는다.
  **켤 때 `sessions.list()`를 한 번 읽고** event로 고친다. timer로 목록을 계속 다시 읽지 않는다.
- **시작 code의 첫 호출은 한 번 더 시도한다.** 프로세스를 먼저 띄우고 release를 active로 잇는 사이에 시작 code가 `publish`, `net`·`secret`·`notify`를 부르면
  `unavailable`이 온다(곧 된다는 뜻이다). `sessions.list`는 이 사이에도 읽힌다. `unavailable`을 영구 실패로 굳히지 말고 짧게 쉬었다 다시 시도한다.

```ts
// 앱 process: 켤 때 한 번 읽고 event로 고친다. 시작 중의 unavailable은 다시 시도한다.
import { type SessionInfo, SESSION_EVENTS, sessions } from "@lophn/agent/process";
import { subscribe } from "@lophn/cap-tool";

const known = new Map<string, SessionInfo>();

async function load(): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const read = await sessions.list();
    if (read.ok) {
      known.clear();
      for (const info of read.value.sessions) known.set(info.session, info);
      return;
    }
    if (read.error.code !== "unavailable") return; // 영구 거절은 다시 해도 같다
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
}

await load();
for (const event of SESSION_EVENTS) {
  subscribe<SessionInfo>("lophn", event, (info) => {
    if (event === "session.ended") known.delete(info.session);
    else known.set(info.session, info);
  });
}
```

화면은 `useSessions()`가 같은 일을 한다(한 번 읽고 `session.*` event에 다시 읽는다). timer로 `reload()`를 부르지 않는다.
- **session 열기와 끝내기는 앱 화면만 한다.** 앱 process는 session을 열거나 끝내지 못한다(상한 없이 session과 model 호출을 만들 수 있어서다). 화면의
  `useAgentSession`이 첫 `send`에서 session을 연다(`workspace: {kind, id}`를 주면 이 앱이 call로 닿을 수 있는 다른 workspace에 연다. 정책이 막으면 `forbidden`).
  앱이 연 session에는 그 표시가 붙는다. 앱은 **자기가 연 session만** `lophnApp.sessions.end`(`useSessions().end`)로 끝낸다(archive와 같은 영향: 도는 turn 중단,
  받은 call 실패, 대기 요청 취소). 사람이 연 session은 `forbidden`이다. 앱이 연 session은 turn이 끝나도 사람에게 알림이 가지 않는다(승인·질문 알림은 간다).
  이 표시는 shell을 다시 켜도 남는다.

### agent에게 call 보내기 (앱 화면)

앱 **화면**이 agent에게 일을 맡기고 답을 받는다(A2A). 앱 process(handler, 시작 code)에는 이 길이 없다. 화면에서 보낸 call은 사람이 지켜보는 turn이다.

- `useAgents()`: 이 앱 workspace에서 부를 수 있는 agent의 명함(handle, name, description, runtime, modality, replies).
- `calls.send({to, reply, text, key?})` → `{call, state, fail_reason}`. `to`는 `{agent: "<handle>"}`(새 session) 또는 `{session: "ses_…"}`(보이는 session) 또는
  `{agent, session, fallback: "new"}`다. workspace를 빼면 이 앱 workspace에 열린다. 다른 workspace는 `workspace: {project: "<name>"}`·`{app: "<slug>"}`, Home은
  `workspace: {home: true}`다(전역 agent를 Home에서 부른다). `reply`는 `"none"`(맡기고 끝)과 `"result"`(답 글 하나)뿐이다. 대화(`conversation`)는 열지 않는다.
  보낼 수 있는 곳은 이 앱 workspace에서 call 정책이 허락한 workspace의 agent·session이고, 아니면 `forbidden`이다. 받는 agent가 그 reply를 지원하지 않으면
  `invalid_input`이다. 받는 agent의 chat에는 `From app:<slug>`로 보인다. **같은 `key`로 다시 보내면 첫 call을 돌려준다.** `calls.send`가 호출마다 key를 만들어
  주므로 앱이 따로 하지 않아도 되고, 앱이 직접 재시도하려면 같은 `key`를 넘긴다.
- `calls.read(call)` → `{call}`. `state`(`accepted`·`done`·`failed`·`cancelled`), `fail_reason`, result call이 `done`이면 `result`(agent의 답 글. 글이
  아닌 block은 담기지 않는다). 이 앱이 보낸 call만 읽힌다.
- `calls.cancel(call, reason?)`, `calls.list(session)`(보이는 session이 받았거나 보낸 call들, 최대 50. `result`는 이 앱이 보낸 것만 차 있다),
  `useAgentCalls(session)`.
- **끝남은 event로 받는다.** 선언의 `subscriptions`에 `{source: "lophn", event: "call.settled"}`를 적고 화면에서 `onCallSettled`(또는 `useAgentCalls`)를 건다.
  payload는 `{call, state, fail_reason}`이고 이 앱이 보낸 call에 대해서만 오며 화면이 떠 있는 동안만 받는다. 일이 일어난 뒤의 알림이고 한 번만
  오며 저장되지 않는다. lophn이 켜질 때 닫힌 call(`lophn_restarted`)은 event가 오지 않는다. 놓쳤으면 `calls.read`로 읽는다. `reply: "none"` call도 받는 turn이
  입력을 가져가면 `done`으로 끝나 event가 온다.

```ts
// 앱 화면: agent에게 맡기고 답을 받는다.
import { calls, onCallSettled } from "@lophn/agent";

const sent = await calls.send({ to: { agent: "reviewer" }, reply: "result", text: "Review the last commit." });
const off = onCallSettled(async ({ call }) => {
  const done = await calls.read(call);
  if (done.ok && done.value.call.state === "done") console.log(done.value.call.result);
});
```

```ts
// 앱 process: 구독 한도에서 도는 Claude Code를 멈춘다.
import { sessions } from "@lophn/agent/process";
import { subscribe } from "@lophn/cap-tool";

subscribe("masup", "usage.limit", async (e: { percent: number }) => {
  if (e.percent < 90) return;
  const listed = await sessions.list({ harness: "claude", state: "running" });
  if (!listed.ok) return;
  for (const s of listed.value.sessions) await sessions.stop(s.session);
});
```

## 요구 permission

없다. 화면이 보낸 것은 사람의 메시지라 lophn이 따로 허락을 묻지 않는다. 그 session
안에서 agent가 하는 일(tool 호출, 파일, 승인)은 평소 agent와 같은 규칙을 지난다.

## peer 의존

정확한 peer다. 범위가 아니라 정확한 판을 쓴다.

| peer    | version |
| ------- | ------- |
| `react` | 19.3.0  |

## 예제

코딩 테스트 앱. 사람이 쓴 코드와 지금 시도(attempt)를 context로 보내고, agent가
줄 주석을 JSON으로 답하게 해서 textarea의 줄에 그린다.

```tsx
import { contextBlock, useAgentSession } from "@lophn/agent";

const NOTES = {
  type: "object",
  required: ["annotations"],
  properties: {
    annotations: {
      type: "array",
      items: {
        type: "object",
        required: ["line", "severity", "note"],
        properties: {
          line: { type: "integer" },
          severity: { enum: ["info", "bug"] },
          note: { type: "string" },
        },
      },
    },
  },
} as const;

type Note = { line: number; severity: "info" | "bug"; note: string };

function Coach({ attempt }: { attempt: { id: string; title: string } }) {
  // COACH_HANDLE은 코치 agent의 handle이다. title은 이 session이 sidebar에 보일 이름이다.
  // savedSession은 앱이 저장해 둔 session id로, 화면이 다시 load돼도 같은 대화를 잇는다.
  const coach = useAgentSession({
    agent: COACH_HANDLE,
    title: `Review: ${attempt.title}`,
    session: savedSession,
  });
  const [code, setCode] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  async function review() {
    const sent = await coach.send(
      [
        { type: "text", text: "Review my attempt. Annotate the lines." },
        contextBlock({ name: "attempt", mimeType: "application/json", text: JSON.stringify(attempt) }),
        contextBlock({ name: "code", mimeType: "text/plain", text: code }),
      ],
      { reply: NOTES },
    );
    if (!sent.ok || sent.reply === null) return setProblem(sent.ok ? "no reply" : sent.error);
    const reply = await sent.reply;
    if (reply.ok) {
      setNotes((reply.value as { annotations: Note[] }).annotations);
      setProblem(null);
    } else {
      // 값이 아니라 오류다. 사람에게 다시 보내게 한다.
      setProblem(reply.error);
    }
  }

  const working = coach.state?.turn?.phase === "working";
  // 받은 주석은 textarea 줄 옆 gutter에 그린다. 줄 번호가 그 자리다.
  const byLine = new Map(notes.map((note) => [note.line, note]));

  return (
    <>
      <Gutter lines={code.split("\n").length} notes={byLine} />
      <textarea value={code} onChange={(event) => setCode(event.target.value)} />
      <button disabled={working} onClick={review}>
        {working ? "Reviewing…" : "Send for review"}
      </button>
      {problem ?? coach.error}
    </>
  );
}
```

- 주석을 줄에 그릴 때 textarea와 gutter가 같은 `line-height`와 글꼴을 쓰고 줄을
  넘기지 않게(`wrap="off"`) 한다.
- 흘러나오는 글은 `state.writing?.text`, 끝난 메시지는 `state.items`의
  `message`(`actor: "agent"`)다. 꼴이 있는 답이면 끝나기 전 글은 JSON 조각이므로
  그리지 않는다.
- `session`을 주지 않으면 새로 load된 화면은 첫 `send`에서 새 session을 연다. 이전 session은
  lophn의 채팅 탭에 남는다. 다음 시도로 넘어갈 때는 `coach.reset()`으로 새 대화를 시작한다.
- 앱이 연 session은 turn이 끝나도 lophn이 "끝났다"고 알리지 않는다. 승인이나 질문이
  생겼는데 그 앱 화면이 안 보이면 알린다.

## version 정책

판마다 바뀐 점과 앱 code를 옮기는 법은 `migrate-sdk` skill의 메모 `<이름>-<판>.md`(예: `declaration-4.0.0.md`)에 있다(이 SDK의 판을 올리면 그 메모를 같이 쓴다).

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
