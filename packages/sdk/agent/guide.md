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

- `useAgentSession({agent, title?, session?, app?, newId?})` — `{session, state,
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
  - `session`은 이 앱 workspace의 기존 session에 **다시 붙는다**. 주면 바로 snapshot을
    읽어 `state`를 채우고 `send`도 거기로 간다(진행 중이던 turn의 답도 이어서 받는다).
    그 앱 workspace의 session이 아니거나 없으면 `error`가 `forbidden: …`이다.
    `agent`나 `session`이 바뀌면 session을 바꾼다. id는 앱이 저장한다(예: 판 기록에
    넣고 화면이 다시 load될 때 `session`으로 넘긴다).
  - 반환의 `session`은 지금 session id이고 열리기 전에는 `null`이다. `state`는
    ACP 상태(`AcpState`)이고 snapshot을 읽기 전에는 `null`이다. `stop`과 `answer`와
    `rename`은 session이 열리기 전에는 `session is not open` 오류다. `items`가 대화의
    줄(`message`, `tool`, `approval`, `notice`, `hidden`)이고 순서가 `seq`다.
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
- 앱 안에서 쓸 agent(상대 선수, 코치, 검토자)는 **bare agent를 이 앱 workspace에서
  먼저 만들고**(`lophn agent create`, 지침에 역할과 답 꼴을 쓰고 `tools: []`) 그
  handle을 `agent`에 준다. 앱을 짓는 agent의 `design-app` skill이 "앱 안 agent"
  절에 절차를 적는다. lophn 기본 agent를 상대로 쓰지 않는다: 제품 규칙과 tool이
  매 turn마다 실려 느리고 비싸다.
- `contextBlock({name, mimeType, text})` — 화면의 context(보고 있는 글, 고른 항목)를
  `resource` block으로 싼다. 같은 `name`이 한 메시지에서 구별되게 짓는다.
- 꼴은 JSON schema의 부분이다: `type`(object, array, string, number, integer,
  boolean, null), `properties`, `required`, `items`, `enum`. 이 밖의 keyword는 보지
  않는다. 추가 property는 막지 않는다.
  - 답 글에서는 마지막 ```` ```json ```` 블록을 JSON으로 읽고, 없으면 글 전체를
    읽는다.
- `parseReply(text, schema)` — 같은 꺼내기와 검사를 글 하나에 한다.
- `agentBridge()` — `window.lophnApp.agent`다. 앱 view 밖이면 `undefined`다.
- type: `AcpState`, `AcpUpdate`, `AcpItem`, `AcpMessageItem`, `AcpToolItem`,
  `AcpAnswer`, `ContentBlock`, `JsonSchema`, `Reply`, `AgentBridge`,
  `AgentSession`, `Sent`, `Done`

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

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
