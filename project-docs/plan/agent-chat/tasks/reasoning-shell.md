# reasoning-shell

reasoning을 세 화면에 보인다: 도는 동안 live reasoning은 "Thinking", 저장된 reasoning part는 "Thought for {d}"(읽을 글이 없으면 "Thought")이고 펼치면 요약 글이 보인다. 보기 select의 Messages에서는 숨기고, 복사 글에는 넣지 않는다.

- 단위: reasoning (wave 3)
- 선행: stream-shell. 같은 thread file과 live 글 component를 고친다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/agent-tab-source.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts`
  - `packages/shell/renderer/conversation/agent-tab-fake-source.ts`
  - `packages/shell/renderer/conversation/agent-thread.tsx`
  - `packages/shell/renderer/conversation/agent-view-model.ts`
  - `packages/shell/renderer/conversation/message-list/message-body.tsx`
  - `packages/shell/renderer/conversation/message-list/live-message.tsx` (`stream-shell`이 만든다)
  - `packages/shell/renderer/conversation/message-list/message-body.module.css`
  - `packages/shell/renderer/conversation/message-list/reasoning.tsx` (새 file)
  - `packages/design/wording/catalog/{conversation,conversation.placeholders}.ts` (공용, key만 더한다)
- 읽을 것:
  - architecture: `project-docs/architecture/event.md`("agent event와 화면": 정본은 session 기록이고 화면은 snapshot과 event로 맞춘다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 element `shell`, interface `core-api`(`ReadMessageBody`의 reasoning part), `event-stream`(`ModelOutputStreamed`의 `kind: "reasoning"`), `design-api`(`Shimmer`, `Icon`). `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
  - 제품 결정: `project-docs/plan/agent-chat/README.md` "정한 것"의 "reasoning을 보인다", `project-docs/products/roadmap/agent-chat.md` 5(화면, "Thought"만 보이는 경우)
  - 계약: `project-docs/plan/agent-chat/tasks/chat-protocol.md`(reasoning part, `readBody`가 reasoning을 건너뛰는 지금 모양), `reasoning-core.md`(저장되는 part: `text`는 redaction을 거친 요약이고 없으면 "", `duration_ms`는 모르면 null), `stream-shell.md`(`LiveText.reasoning`, `LiveMessage`, `useThrottledLive`, `closeOpenFence`), `chat-md.md`(`ChatMarkdown`)
  - 본보기(화면): `tools/wireframes/pages/screens/agent-tab/scenes.tsx`(`SkipScene`은 `report`와 같은 대화, `QuestionAnsweredScene`), `tools/wireframes/pages/screens/agent.tsx`의 page `new-agent-skip`, `new-agent-question-answered`
  - skill: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`
  - 코드:
    - protocol: `packages/protocol/lophn-agent/message-content.ts`(`messagePartSchema`의 reasoning)
    - 화면 값: `packages/shell/renderer/conversation/agent-tab-source.ts`(`BodyPart`), `agent-tab-core-source-thread.ts`(`readBody`, `textOf`), `agent-view-model.ts`(`shownEntries`, `textOfBody`), `drafts.ts`(`BodyState`), `agent-tab-fake-source.ts`(`sceneData`의 `report`·`question-answered`)
    - 그리기: `packages/shell/renderer/conversation/agent-thread.tsx`(`itemsOf`의 `said`, `textOf`), `message-list/message-body.tsx`(`MessageBody`), `message-list/live-message.tsx`, `message-list/message-body.module.css`, `activity/tool-line.tsx`(`ToolRow`: 접히는 줄의 본보기), `message-list/agent-turn.tsx`(`WorkingRow`의 `Shimmer`), `activity/worked-for.tsx`(`duration`), `packages/shell/renderer/icons/common.ts`(`expand`, `collapse`)
    - 문구: `packages/design/wording/catalog/conversation.ts`
- 계약:
  - 쓰는 것: `chat-protocol`의 reasoning part(`{kind: "reasoning", text, duration_ms}`)와 `ModelOutputStreamed`의 `kind: "reasoning"`; `reasoning-core`가 저장한 part; `stream-shell`의 live 상태 `reasoning`과 `message-list/live-message.tsx`; `chat-md`의 `ChatMarkdown`; `activity/worked-for.tsx`의 `duration`(import만).
  - 내놓는 것: 화면 `BodyPart`의 `{kind: "reasoning", text, durationMs}`와 `message-list/reasoning.tsx`. 뒤 task가 기대는 것은 없다.

## 할 일

정한 것(살 단계):
- 줄의 말: 도는 중이고 그 model 호출의 글이 아직 없으면 "Thinking"이다. 저장된 part는 글이 있고 `durationMs`가 있으면 "Thought for {d}", 글이 ""이거나 `durationMs`가 null이면 "Thought"다. live에서 글이 흐르기 시작하면 "Thought"이고, 시간은 저장된 뒤 part에서 보인다. 이유: 시간은 core가 재서 저장한 값 하나만 쓴다(roadmap 5). renderer가 delta 시각으로 다시 재지 않는다.
- 글이 ""이면 펼치는 단추가 없다(읽을 것이 없다).
- 보기 select는 Messages에서만 숨긴다. Compact와 Everything에서는 접힌 채 시작한다. roadmap 5는 Messages만 말하고, Everything이 펼치는 것은 tool 묶음이다(`tool-title-shell`).
- Messages에서 본문이 reasoning뿐인 agent message는 줄에서 뺀다. model 응답 하나가 agent message 하나라(README) reasoning과 tool call만 있는 응답은 글 없는 message가 된다. 빼지 않으면 Messages에서 이름만 있는 빈 묶음이 남는다(`shownEntries` 주석의 지금 규칙과 같은 이유).
- 복사 글은 묶음에서 글이 있는 마지막 message의 글이다. 지금은 마지막 message라서 마지막이 reasoning뿐이면 빈 글을 복사한다.
- 요약 글은 `ChatMarkdown`으로 그린다(OpenAI 요약은 굵은 제목이 있는 markdown이다). live 요약은 `closeOpenFence`를 거친다.

1. `packages/shell/renderer/conversation/agent-tab-source.ts` (근거: 계약 "화면 `BodyPart`")
   - `BodyPart`에 `{ readonly kind: "reasoning"; readonly text: string; readonly durationMs: number | null }`. 주석: agent 답 앞의 reasoning 요약. 글은 redaction을 거쳤고 없으면 "". 복사 글과 model 이력에는 들지 않는다.
2. `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts` (근거: `chat-protocol` 할 일 13이 둔 건너뛰기를 이 task가 그린다)
   - `readBody`의 `case "reasoning"`을 `[]` 대신 `[{ kind: "reasoning", text: part.text, durationMs: part.duration_ms }]`로 바꾼다. `textOf`는 지금처럼 글 part만 잇는다.
3. `packages/shell/renderer/conversation/message-list/reasoning.tsx` (새 file. 근거: roadmap 5 "화면")
   - `export function Reasoning({ text, durationMs, thinking, artifacts }: { text: string; durationMs: number | null; thinking: boolean; artifacts: ArtifactsSlice | undefined })`.
   - 말: `thinking`이면 `<Shimmer>{t("conversation.label.thinking")}</Shimmer>`, 아니면 위 정한 것의 "Thought for {d}"(`duration(durationMs)`) 또는 "Thought".
   - 글이 있으면 `ToolRow`(`activity/tool-line.tsx`)와 같은 꼴의 단추(`aria-expanded`, `commonIcons.expand`·`collapse` icon)이고 누르면 아래에 글을 `ChatMarkdown`으로 보인다. `ToolRow`는 `<ul>`을 그리므로 쓰지 않고 이 file에 단추를 둔다. 펼침 상태는 이 component의 state이고 접힌 채 시작한다. 글이 없으면 단추 없이 말만 있는 줄이다.
   - `data-reasoning=""`, 도는 중이면 `data-thinking=""`.
4. `packages/shell/renderer/conversation/message-list/message-body.tsx`
   - `MessageBodyProps`에 `reasoning?: boolean`(reasoning part를 그린다. 없으면 false. 사람 말과 받은 메시지는 넘기지 않는다).
   - 본문을 읽은 경우의 `switch`에 `case "reasoning"`: `reasoning`이 참이면 `<Reasoning text={part.text} durationMs={part.durationMs} thinking={false} artifacts={artifacts} />`, 아니면 null. 본문 part 순서(reasoning, 글)대로 그린다. `memo`는 `stream-shell`이 감싼 그대로다.
5. `packages/shell/renderer/conversation/message-list/live-message.tsx`
   - props에 `reasoning: boolean`. `live.reasoning !== ""`이고 `reasoning`이 참이면 글 위에 `<Reasoning text={closeOpenFence(live.reasoning)} durationMs={null} thinking={live.text === ""} artifacts={artifacts} />`. 글이 ""이면 글 칸은 그리지 않는다.
6. `packages/shell/renderer/conversation/agent-thread.tsx` (근거: 위 정한 것, roadmap 5 "보기 select의 Messages에서는 숨긴다")
   - agent message의 `MessageBody`와 `LiveMessage`에 `reasoning={props.detail !== "messages"}`. 숨긴 구간 안도 같다.
   - live를 붙이는 조건을 `live.text !== "" || (props.detail !== "messages" && live.reasoning !== "")`로 바꾼다.
   - `shownEntries` 두 곳(맨 위, 숨긴 구간)에 본문 읽기 `(id) => props.drafts.body(id)`를 넘긴다(아래 7).
   - 복사: `itemsOf`의 묶음이 message를 하나(`said`)가 아니라 목록으로 들고, `copyText`는 뒤에서부터 `textOf`가 ""가 아닌 첫 글을 낸다. 묶음에 message가 없으면 지금처럼 `copyText`가 없다.
7. `packages/shell/renderer/conversation/agent-view-model.ts`
   - `shownEntries(entries, detail, bodyOf: (message: string) => BodyState | undefined)`: Messages에서 agent message 중 본문을 읽었고(`ready`) reasoning 밖의 part가 없는 것을 뺀다. 아직 읽지 않은 본문은 남긴다. 주석에 이유 한 줄.
   - `textOfBody`는 지금처럼 글 part만 잇는다(복사 글과 rewind 원문에 reasoning이 들지 않는다).
8. `packages/shell/renderer/conversation/message-list/message-body.module.css`
   - reasoning 줄과 펼친 글의 class(예: `.reasoning`, `.reasoningHead`, `.reasoningText`). 색은 `--color-text-muted`, 글자는 small token, 단추는 `activity.module.css`의 tool 줄과 같은 크기다. 값을 직접 쓰지 않고 token(var)을 쓴다(`ui-design`).
9. `packages/shell/renderer/conversation/agent-tab-fake-source.ts` (근거: `ui-design` "gallery는 fake source로 실제 component를 그린다")
   - `report`·`skip` 장면의 `messageId(2)` 본문 앞에 `{ kind: "reasoning", text, durationMs: 12_000 }`. `text`는 굵은 제목 한 줄과 두세 문장의 영어 요약이다.
   - `question-answered` 장면에 `stream-shell`이 둔 `live` 칸으로 쓰는 중인 reasoning 하나: `{ turn: turn1, modelCall: fakeId("mcl", 2), at: at(41), gap: false, text: "", reasoning }`.
10. wording(근거: `wording` skill): `packages/design/wording/catalog/conversation.ts`에 셋을 정렬 자리에 더하고 `deno task wording`으로 `conversation.placeholders.ts`를 다시 만든다.
    - `conversation.label.thinking`: "Thinking"
    - `conversation.label.thought`: "Thought"
    - `conversation.label.thought-for`: "Thought for {duration}"

## 끝남

- `deno task check`가 통과한다.
- renderer를 고쳤으니 `deno run -A packages/shell/renderer/build.ts`가 선다.
- `deno run --allow-read tools/check-wording.ts`가 새 key에 오류를 내지 않는다.
- 위험 test: 없음. 화면과 문구다. reasoning 글의 redaction은 `reasoning-core`가 본다(README 위험 test).
- 남지 않음: 지우는 이름이 없다. `chat-protocol`이 `readBody`에 둔 reasoning 건너뛰기(빈 배열)는 이 task가 part로 바꿔 남지 않는다.
- (화면) `deno task wireframes`가 되고:
  - `new-agent-skip`에서 agent 답 위에 "Thought for 12s" 줄이 있고, 누르면 요약이 markdown으로 펼쳐진다. View detail을 Messages로 바꾸면 그 줄이 없다.
  - `new-agent-question-answered`에서 마지막 agent 묶음 끝에 "Thinking"이 shimmer로 보인다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 적을 것: live에서 "Thought"가 저장된 뒤 "Thought for {d}"로 바뀌는 한 번의 바뀜
