# stream-shell

세 화면이 agent 글을 쓰이는 대로 보인다: renderer가 snapshot의 `writing`과 `ModelOutputStreamed`를 model 호출마다 접어 live 글로 들고, `MessageRecorded`가 오면 live 글을 버리고 저장된 본문으로 바꾼다. live 글은 throttle(한 frame~100ms)해서 `ChatMarkdown`으로 다시 그리고, 닫히지 않은 code fence는 그릴 때만 닫으며, 다 쓴 message는 `React.memo`로 다시 그리지 않는다. 한 turn의 agent message 여럿을 tool 줄 사이에 시간순으로 둔다.

- 단위: stream (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/connection/events/session-events-store.ts`
  - `packages/shell/renderer/conversation/live-text.ts` (새 file)
  - `packages/shell/renderer/conversation/live-text_test.ts` (새 file)
  - `packages/shell/renderer/conversation/agent-tab-data.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts`
  - `packages/shell/renderer/conversation/agent-tab-source.ts`
  - `packages/shell/renderer/conversation/agent-tab-fake-source.ts`
  - `packages/shell/renderer/conversation/agent-thread.tsx`
  - `packages/shell/renderer/conversation/agent-view.tsx`
  - `packages/shell/renderer/conversation/message-list/live-message.tsx` (새 file)
  - `packages/shell/renderer/conversation/message-list/{message-body,agent-turn,thread-scroll}.tsx`
  - `packages/design/wording/catalog/{conversation,conversation.placeholders}.ts` (공용, key만 더한다)
- 읽을 것:
  - architecture: `project-docs/architecture/event.md`("agent event와 화면": 조건을 걸고 ready 뒤에 snapshot을 읽고 그 뒤 event로 고친다, 끊기면 처음부터 다시 맞춘다. "Bus는 놓칠 수 있다", 정본은 session 기록)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 element `shell`, interface `event-stream`(agent event), `core-api`(session snapshot read, `ReadMessageBody`, `ListReceivedMessages`, `ListToolCalls`), `design-api`(`Markdown`). `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
  - 제품 결정: `project-docs/plan/agent-chat/README.md` "정한 것"(streaming의 길, retry·멈춤, model 응답 하나가 agent message 하나)과 "위험 test", `project-docs/products/roadmap/agent-chat.md` 4의 "늦게 붙은 화면", "저장되면 정본으로 바꾼다", "retry", "renderer"와 "지금 코드 > transcript"
  - 계약: `project-docs/plan/agent-chat/tasks/chat-protocol.md`(`ModelOutputStreamed`, `MessageRecorded`, snapshot `writing`, agent message 규칙), `chat-md.md`(`ChatMarkdown`), `highlight.md`(`CodeBlock`)
  - 본보기(화면): `tools/wireframes/pages/screens/conversation.tsx`(Agent 탭 장면이 `createFakeAgentTabSource`를 끼운다. event 쪽 fake는 비어 있다), `tools/wireframes/pages/screens/agent-tab/scenes.tsx`의 `ConversationScene`(`sub="working"`), `tools/wireframes/pages/screens/agent.tsx`의 page `new-agent-conversation`
  - skill: `.claude/skills/write-test/SKILL.md`, `.claude/skills/ui-design/SKILL.md`
  - 코드:
    - event 길: `packages/shell/renderer/desktop/connection/events/session-events-store.ts`, 같은 폴더 `store.ts`(`createValueStore`, `syncOnReady`), `hooks.tsx`(`useSessionEvents`, `NO_SESSION_EVENTS`), `client.ts`(`busEventSchema`로 검사)
    - protocol: `packages/protocol/events/agent.ts`, `packages/protocol/events/snapshot.ts`(`writing`), `packages/protocol/lophn-agent/received-messages.ts`(`created_at`, `turn`), `packages/protocol/lophn-agent/tool-values.ts`(`ToolCall.started_at`)
    - 화면 값과 접기: `packages/shell/renderer/conversation/agent-tab-source.ts`(`ThreadView`, `ThreadMessage.text`, `EMPTY_THREAD`), `agent-tab-data.ts`(`foldEvent`, `withEntries`, `useAgentTabData`), `agent-tab-core-source-thread.ts`(`readThread`, `toolEntries`, `place`), `agent-tab-fake-source.ts`(`sceneData`의 `working`)
    - 그리기: `packages/shell/renderer/conversation/agent-view.tsx`(`Screen`), `agent-thread.tsx`(`AgentThread`, `itemsOf`), `bodies.ts`(`loadBodies`), `message-list/message-body.tsx`(`MessageBody`), `message-list/agent-turn.tsx`(`Said`), `message-list/thread-scroll.tsx`
- 계약:
  - 쓰는 것: `chat-protocol`의 `ModelOutputStreamed`(offset, model_call), `MessageRecorded`, snapshot `writing`, agent message 규칙(한 turn에 agent message 여럿, `MessageRecorded`가 그 응답의 `ToolCallStarted`보다 먼저 온다, `TurnEnded.messages`는 빠진 것을 채우는 데만 쓴다); `stream-core`·`reasoning-core`가 Bus에 낸 delta; `chat-md`의 `ChatMarkdown`(`message-list/chat-markdown.tsx`); `highlight`의 `CodeBlock`(자라는 code block).
  - 내놓는 것: renderer live 상태(`conversation/live-text.ts`: model 호출마다 text·reasoning을 snapshot `writing`, delta, `MessageRecorded`로 접는다. 다른 model 호출의 delta가 오면 앞 것을 버린다), `ThreadView`의 live 칸, live 글 component(`message-list/live-message.tsx`), 한 turn 안의 agent message와 tool 줄을 시간순으로 두는 배치. `reasoning-shell`, `clock-shell`, `tool-title-shell`이 이 위에서 고친다.

## 할 일

planner 검토(core 규칙과 맞춘다):
- `ToolCallStarted`가 오면 그 turn의 live 글을 비운다(core `live-turns.ts`와 같다. 그 응답은 tool 전에 저장되어 `MessageRecorded`가 먼저 온다).
- 이미 `MessageRecorded`가 온 `model_call`이나 끝난 turn의 늦은 delta는 버린다.

정한 것(살 단계):
- live 상태는 `ThreadView.live` 하나다. thread snapshot(`readThread`가 이미 읽는 session snapshot의 `writing`)이 시작점이고 `useAgentTabData`의 접기가 delta, `MessageRecorded`, `TurnEnded`로 고친다. event store(`session-events-store.ts`)에 따로 두지 않는다. 이유: 화면 값의 길은 이미 "thread snapshot + event 접기" 하나이고(`event.md`), gallery의 fake source도 같은 길(`thread()`)로 쓰는 중인 글을 보인다.
- event store는 event마다 배열 전체를 복사하지 않는다. 지금은 event마다 `[...current.events, event]`로 복사하고 `useAgentTabData`가 thread를 읽은 뒤의 event 전부를 render마다 다시 접어, 약 50ms마다 오는 delta가 쌓이면 제곱으로 느려진다. 그래서 store는 탭이 열린 동안의 log에 쌓아 `count`와 `since(from)`만 내고, `useAgentTabData`는 접은 결과와 접은 개수를 기억해 새 event만 접는다. log는 탭이 열린 동안 delta까지 남는다. 줄이는 것은 긴 session을 재어 느리면 한다(roadmap 9의 가상화와 같은 기준).
- offset이 맞지 않으면(gap) thread를 다시 읽는다(`readThread`. 다시 붙을 때와 같은 길이고 session snapshot을 같이 읽는다). model 호출 하나에서 한 번만 읽는다. 그래도 맞지 않으면 그 응답의 `MessageRecorded` 본문이 맞춘다. 읽기를 되풀이하는 고리를 만들지 않는다.
- `MessageRecorded`로 만든 message 줄의 `text`는 그때의 live 글이다(`ThreadMessage.text`의 지금 뜻: 본문을 읽기 전에 보이는 글). live 글이 사라진 뒤 본문을 읽을 때까지 빈 자리가 없다.
- throttle은 `AgentThread`가 live 값에 건다(100ms). live가 null이 되거나 model 호출이 바뀌면 기다리지 않고 바꾼다. 저장된 message와 앞 live 글이 겹쳐 보이지 않게 한다. throttle한 값이 바뀌면 `AgentThread`와 `ThreadScroll`이 같이 다시 그려지므로 지금의 바닥 따라가기(`thread-scroll.tsx`의 deps 없는 `useLayoutEffect`)가 그대로 맞는다.
- 한 turn 안의 tool 묶음은 사이에 그 turn의 message가 있으면 끊는다. 안 끊으면 묶음이 첫 call 시각에 놓여 message 뒤의 call까지 앞에 보인다.
- 위험 test는 renderer 접기(`live-text.ts`)에 하나 둔다. core의 `writing`(`stream-core`의 `live-turns_test.ts`)과 다른 code이고, streaming 동안 화면에 무엇이 남는지는 이 접기만 정한다. 순수 함수라 가장 싼 층이다.

1. `packages/shell/renderer/conversation/live-text.ts` (새 file. 근거: 계약 `ModelOutputStreamed`·snapshot `writing`, README "retry하면 앞 attempt의 글을 버린다")
   - `export interface LiveText { turn: string; modelCall: string; text: string; reasoning: string; at: string; gap: boolean }`. `at`은 이 글이 새 agent 묶음을 열 때 묶음 위 시각이다(첫 delta event의 `at`, snapshot에서 왔으면 그 turn의 `started_at`). `gap`은 offset이 앞 글 길이보다 큰 delta를 받았다는 뜻이다.
   - `liveFromWriting(writing: SessionSnapshot["writing"], at: string): LiveText | null`. 칸이 없거나 null이면 null, 있으면 `gap: false`인 값이다. 글이 둘 다 ""여도 값을 낸다(그릴지는 부르는 쪽이 정한다).
   - `foldDelta(live: LiveText | null, delta: Extract<AgentEvent, { type: "ModelOutputStreamed" }>["payload"], at: string): LiveText`. 규칙:
     - `live`가 null이거나 `live.modelCall !== delta.model_call`이면 앞 글을 버리고 `{turn: delta.turn, modelCall: delta.model_call, text: "", reasoning: "", at, gap: false}`에서 시작한다(retry, 다음 model 호출).
     - `delta.kind`의 칸(`text` 또는 `reasoning`)을 `current`라 하면: `offset > current.length`는 붙이지 않고 `gap: true`, `offset + text.length <= current.length`는 이미 가진 글이라 그대로, 그 밖은 `current + text.slice(current.length - offset)`이다. snapshot 뒤에 다시 접는 delta가 겹쳐도 두 번 붙지 않는다.
   - `closeOpenFence(text: string): string`. 줄마다 보아 줄 앞 공백 0~3개 뒤 backtick 셋 이상이나 `~` 셋 이상으로 연 fence가 끝까지 닫히지 않았으면(닫는 줄은 같은 문자를 연 길이 이상 쓰고 뒤에 공백만 있다) 끝에 줄바꿈과 연 fence 문자열을 붙인다. 닫혀 있으면 그대로다. 그릴 때만 쓴다(roadmap 4 "renderer").
   - React를 import하지 않는다. protocol type은 `packages/protocol/events/mod.ts`에서 type으로만 import한다.
2. `packages/shell/renderer/conversation/live-text_test.ts` (새 file. 근거: README 위험 test "retry된 attempt의 글은 화면에 남지 않고, 멈춘 답은 사람이 본 데까지 남는다", `write-test` 순수 함수 층)
   - `Deno.test("retry된 attempt의 글은 live 글에 남지 않고 겹친 delta는 두 번 붙지 않는다", …)` 하나. 준비 없이 표로 돈다: snapshot `writing`(call A, `"Hel"`) → A offset 3 `"lo"`는 `"Hello"`, A offset 0 `"Hello"`(다 겹침)는 그대로, A offset 4 `"o wor"`(반 겹침)는 `"Hello wor"`, B offset 0 `"Hi"`(retry)는 `"Hi"`이고 A의 글이 없다, B offset 5 `"x"`는 `gap: true`이고 글은 `"Hi"`, reasoning delta는 text와 따로 센다. 판정은 낸 `LiveText`의 `text`·`reasoning`·`modelCall`·`gap`이다.
   - `closeOpenFence`와 throttle은 test하지 않는다(화면, `write-test`).
3. `packages/shell/renderer/desktop/connection/events/session-events-store.ts` (근거: 위 정한 것, `event.md` "읽고 나서 걸면 그 사이 event를 놓친다")
   - `SessionEventsState`의 `events`를 지우고 `count: number`(이 session을 연 뒤 받은 agent event 수)와 `since: (from: number) => readonly AgentEvent[]`(`from`번째부터 이 state의 `count` 전까지)를 둔다. `status`, `snapshot`은 그대로다.
   - session마다 닫힌 곳(`start` 안)에 `const log: AgentEvent[] = []`를 두고 `apply`는 `log.push(event)` 뒤 `update(session, { count: n, since: (from) => log.slice(from, n) })`(n은 그때의 `log.length`)이다. 배열을 복사하지 않는다.
   - `NO_SESSION_EVENTS`는 `{ status: "loading", snapshot: null, count: 0, since: () => [] }`이다. `hooks.tsx`는 고치지 않는다(`useSessionEvents`는 state를 그대로 낸다).
   - 머리 주석을 고친다: event는 탭이 열린 동안 log에 쌓고, 쓰는 쪽은 접은 개수 뒤만 읽는다.
4. `packages/shell/renderer/conversation/agent-tab-source.ts` (근거: 계약 "`ThreadView`의 live 칸")
   - `ThreadView`에 `readonly live: LiveText | null`(주석: 아직 저장되지 않은 model 호출 하나의 글. 저장되면 그 message 줄로 바뀐다), `EMPTY_THREAD`에 `live: null`. `LiveText`는 `./live-text.ts`에서 type으로 import한다.
5. `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts` (근거: roadmap 4 "늦게 붙은 화면", README "model 응답 하나가 agent message 하나")
   - `readThread`: 이미 읽는 session snapshot(지역 이름 `live`)의 `writing`을 `liveFromWriting`에 넘겨 돌려주는 값의 `live`에 싣는다. `at`은 `writing.turn`의 `TurnRecord.started_at`(`turnById`)이고 그 turn을 못 찾으면 `current`의 것이다. 지역 이름 `live`는 `snapshot` 따위로 바꿔 화면 값 `live`와 헷갈리지 않게 한다.
   - 한 turn 안의 배치를 시각순으로 바꾼다. 지금은 turn의 tool 줄(`pre`)을 그 turn의 첫 agent 답 앞에 한꺼번에 두고(`firstAnswerAt`) 끝 줄을 마지막 메시지 뒤에 둔다. 바꾼 뒤:
     - turn마다 아직 놓지 않은 `pre` 줄(시각순)을 들고, 그 turn의 메시지 줄을 놓기 직전에 `Date.parse(entry.at) < Date.parse(message.at)`인 줄을 먼저 놓는다. 같은 시각이면 메시지가 먼저다(`MessageRecorded`가 그 응답의 tool call보다 먼저다).
     - 그 turn의 마지막 메시지 뒤에 남은 `pre` 줄과 끝 줄(`tailOf`)을 놓는다. 메시지를 못 찾은 turn은 지금처럼 맨 뒤다. 숨긴 구간(`hiddenTurns`)은 지금 그대로다.
     - `firstAnswerAt`를 지운다.
   - `toolEntries`: 같은 turn에서 이어진 call이라도 앞 call과 이 call의 시작 사이(앞 call 시작 < t ≤ 이 call 시작)에 그 turn의 메시지 시각 t가 있으면 묶음을 끊는다(`flush`). `readThread`가 turn마다 메시지 `created_at`(ms, 정렬)을 넘긴다. 묶는 규칙(`bucketOf`) 자체는 `tool-title-shell`이 바꾼다.
   - 머리 주석의 "메시지가 아닌 줄은 그 turn의 메시지에 맞춰 둔다"를 "그 turn의 메시지 사이에 시각순으로 둔다"로 고친다.
6. `packages/shell/renderer/conversation/agent-tab-data.ts` (근거: 계약 `MessageRecorded`, roadmap 4 "저장되면 정본으로 바꾼다", "retry", 위 정한 것)
   - `foldEvent`에 둘을 더한다:
     - `ModelOutputStreamed`: `{ ...view, live: foldDelta(view.live, event.payload, event.at) }`.
     - `MessageRecorded`: `withEntries`로 agent message 줄 하나(`id: message`, `at: event.at`, `actor: "agent"`, `sender: null`, `call: null`, `replyTo: null`, `delivery: "next_turn"`, `turn`, `text`: `view.live?.modelCall === model_call && view.live.text !== "" ? view.live.text : null`)를 더하고, `view.live?.modelCall === model_call`이면 `live: null`이다.
   - `TurnEnded`: `view.live?.turn === turn`이면 `live: null`. `messages`로 빠진 message를 채우는 것은 지금 그대로다(`withEntries`가 id로 한 번만 든다).
   - `foldEvent` 위 주석에 두 event와 live 규칙을 한 줄씩 더한다.
   - `useAgentTabData`:
     - `useSessionEvents`의 값을 담은 지역 이름 `live`는 `stream` 따위로 바꿔 `ThreadView.live`와 헷갈리지 않게 한다.
     - `eventCount.current = stream.count`(thread를 읽기 시작한 때의 `mark`).
     - 접기를 다시 하지 않는다: `useRef`에 `{ base, ctx, upTo, view }`를 두고, `base`와 `ctx`가 같으면 `stream.since(upTo)`만 앞 `view`에 접고, 다르면 `base.view`에 `stream.since(base.mark)`부터 접는다. 접은 뒤 `upTo = stream.count`. 같은 event를 두 번 접어도 같은 결과라(`withEntries`, `foldDelta`) render가 두 번 돌아도 맞다.
     - turn이 끝났을 때 다시 읽기: 지금의 `live.events.filter(TurnEnded).length`를 지우고, effect가 앞서 본 개수 뒤(`stream.since(seen)`)에 `TurnEnded`가 있으면 `readThread()`를 부른다.
     - gap: 접은 `view.live?.gap`이 참이면 그 `modelCall`을 deps로 한 effect가 `readThread()`를 한 번 부른다(위 정한 것).
   - 머리 주석의 "snapshot은 처음과 다시 붙을 때(와 turn이 끝났을 때)만 읽는다"에 gap을 더한다.
7. `packages/shell/renderer/conversation/message-list/live-message.tsx` (새 file. 근거: roadmap 4 "renderer")
   - `export const LiveMessage = memo(function LiveMessage({ live, artifacts }: { live: LiveText; artifacts: ArtifactsSlice | undefined }))`: `<Said>`(`agent-turn.tsx`) 안에 `data-live=""`인 칸을 두고 `ChatMarkdown`에 `closeOpenFence(live.text)`를 넘긴다(props 이름은 `chat-md`가 만든 대로, artifact path link도 같다). 글이 ""이면 부르는 쪽이 그리지 않는다.
   - `export function useThrottledLive(live: LiveText | null, now: () => number): LiveText | null`: `LIVE_RENDER_MS = 100`(주석: 긴 글을 delta마다 markdown으로 다시 parse하지 않는다). null이 되거나 `modelCall`이 바뀌면 바로 바꾸고, 같은 model 호출의 글이 자라는 동안은 앞서 바꾼 때부터 100ms가 지나야 바꾼다. 마지막 값은 늦어도 100ms 뒤에 보인다(`setTimeout` 한 개, unmount에서 지운다. `WorkingRow`의 timer와 같은 층이다).
8. `packages/shell/renderer/conversation/agent-thread.tsx` (근거: roadmap 4 "renderer", 계약 "시간순으로 두는 배치")
   - `AgentThreadProps`에 `live: LiveText | null`. 위에서 `const live = useThrottledLive(props.live, props.now)`.
   - `itemsOf`에 `live: LiveText | null`을 넘긴다(숨긴 구간 안 `nested` 호출은 null). 줄을 다 돈 뒤 마지막 `flush` 전에 `live !== null && live.text !== ""`이면 `LiveMessage`(key와 id는 `"live-" + live.modelCall`, 시각은 `live.at`)를 `add`로 끝 agent 묶음에 붙인다. 앞 줄이 내 말이면 새 묶음이 열린다. `add`가 받는 첫 칸을 `{ id, at }`로 넓힌다. live 글은 Messages 보기에서도 보인다(message다).
   - 머리 주석에 "쓰는 중인 글은 끝 agent 묶음의 마지막에 선다"를 더한다.
9. `packages/shell/renderer/conversation/agent-view.tsx`: `AgentThread`에 `live={thread?.live ?? null}`을 넘긴다. 다른 것은 고치지 않는다.
10. `packages/shell/renderer/conversation/message-list/message-body.tsx` (근거: roadmap 4 "다 쓴 message는 `React.memo`로 다시 그리지 않는다")
    - `MessageBody`를 `memo`로 감싼다(`export const MessageBody = memo(function MessageBody(…))`). props(`message`, `DraftStore`가 들고 있는 `body` 객체, `fallback` 글, host의 `artifacts`)가 얕게 같으면 delta마다 다시 그리지 않는다. `UserBody`는 그대로다.
11. `packages/shell/renderer/conversation/agent-tab-fake-source.ts` (근거: `ui-design` "gallery는 renderer의 실제 component를 fake source로 그린다")
    - `SceneData`에 `live?: LiveText | null`, thread를 만들 때 `live: data.live ?? null`. `EMPTY_THREAD`를 펼치는 곳은 그대로 null이다.
    - `working` 장면(`scene === "working"`만. `rewind`·`queued`는 null)에 쓰는 중인 글: `{ turn: turn1, modelCall: fakeId("mcl", 1), at: at(42), gap: false, reasoning: "", text }`. `text`는 짧은 문단, 목록 하나, 닫히지 않은 `ts` code fence로 끝나는 영어 글이다(장면의 eval 이야기에 맞춘다).
    - `stop`과 `retryTurn`은 `live: null`로 둔다.
12. 고치지 않는 것:
    - `message-list/thread-scroll.tsx`: 위 정한 것대로 지금의 따라가기가 맞다. 따라가지 않는 것을 보면 그때 고친다.
    - `message-list/agent-turn.tsx`: `Said`를 그대로 쓴다.
    - wording: 더할 key가 없다(live 글에 화면 문구가 없다).

## 끝남

- `deno task check`가 통과한다.
- renderer를 고쳤으니 `deno run -A packages/shell/renderer/build.ts`가 선다.
- 위험 test: "retry된 attempt의 글은 live 글에 남지 않고 겹친 delta는 두 번 붙지 않는다"(`live-text_test.ts`). `deno test --no-check packages/shell/renderer/conversation/live-text_test.ts`.
- 남지 않음: `grep -rn --exclude-dir=dist "firstAnswerAt\|\.\.\.current\.events" packages/shell tools`가 0줄이다. `SessionEventsState.events`의 옛 쓰임은 type check가 잡는다.
- (화면) `deno task wireframes`가 되고, gallery의 `new-agent-conversation`(`index.html?frame=new-agent-conversation`)에서 마지막 agent 묶음 끝에 쓰는 중인 글이 `ChatMarkdown`으로 보이고 닫히지 않은 code fence가 code block으로 그려진다. View detail을 Messages로 바꿔도 보인다.
- lead가 merge 때 `deno task dev`(fake provider)로 글이 흘러 나오는지, code fence가 열린 채 흐를 때 깨지지 않는지, 저장된 뒤 한 번 깜빡이지 않는지 본다(README "lead가 할 일").

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없을 것이다
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 적을 것: session-events-store의 log가 탭이 열린 동안 delta까지 남는 것(얼마나 되는지 잰 값이 있으면 같이), 도는 중 tool 줄은 아직 call마다 한 줄인 것(→ `tool-title-shell`)
