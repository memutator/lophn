# sm-chip

composer에서 보낸 context·위반 chip이 대화에 남게 한다. 본문에 chip마다 `attached` part를 쓰고, 실패한 turn을 다시 보낼 때 그 part로 `SendMessage.attached`를 되살려 agent가 처음에 받은 위반을 잃지 않게 한다.

- 단위: sm-chip (wave 7)
- 선행: sm-envelope-helper
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/message-content.ts`
  - `packages/shell/renderer/conversation/attached-chips.ts`
  - `packages/shell/renderer/conversation/attached-chips_test.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-commands.ts`
  - `packages/shell/renderer/conversation/agent-tab-fake-source.ts`
- 읽을 것:
  - issue: `project-docs/issues/shell.md`의 "보낸 chip이 대화에 남지 않고 다시 보내기가 chip을 빼고 보낸다"(정한 것: 위대로 고친다)
  - 입력 쪽: `packages/protocol/lophn-agent/inputs.ts`의 `AttachedChip`(context·file·violation)과 `sendMessage`(`content`와 `attached`가 따로다)
  - core가 쓰는 쪽(읽기만 한다): `packages/core/lophn-agent/session/message-commands.ts`의 `sendWith`. Router 입력의 `<lophn-attached>` 줄은 `input.attached`로만 만들고, 본문에서는 `text` part만 읽는다(`textOf`). 그래서 본문에 `attached` part를 더해도 줄이 두 번 생기지 않는다.
  - 그리는 쪽(이미 있다): `conversation/agent-tab-core-source-thread.ts`의 `readBody`, `conversation/message-list/message-body.tsx`가 `attached` part를 `name · line`으로 그린다.
  - test: `.claude/skills/write-test/SKILL.md`
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/protocol`(boundary `protocol`), `packages/shell/renderer`(boundary `shell`)
- 계약:
  - 쓰는 것: `AttachedChip`(`inputs.ts`), `userMessageContentInputSchema`(`message-content.ts`)
  - 내놓는 것: `message-content.ts`의 `attachedFields`에 `context: idSchema("ctx").optional()`. 입력·출력 schema가 같은 fields를 쓰므로 `messageBody` 읽기에도 `context`가 온다.

## 할 일

1. `message-content.ts`: `attachedFields`에 optional `context`(ctx id)를 더하고 위 주석("위반은 path와 rule, 파일은 path를 더한다")에 context를 적는다.
2. `attached-chips.ts`: 두 함수를 더한다. 기존 `attachedOf`는 그대로 둔다.
   - `attachedPartsOf(chips)`: chip마다 본문 part를 만든다. context chip은 `{ kind: "attached", attached: "context", name: label, context }`, 위반 chip은 `{ kind: "attached", attached: "violation", name: 파일 path, line: rule, path, rule, context }`다(`line`을 채우는 것은 화면이 `name · line`으로 그리기 때문이다).
   - `attachedOfParts(parts)`: 본문의 `attached` part에서 `AttachedChip`을 되살린다. context part는 `context`가 있을 때, 위반 part는 `context`·`path`·`rule`이 모두 있을 때만 되살리고 나머지는 건너뛴다.
3. `agent-tab-core-source-commands.ts`의 `sendText`: `content.parts`를 `[...attachedPartsOf(input.chips), { kind: "text", text: input.text }]`로 쓴다(chip이 입력칸 위에 있고 agent 입력에서도 글 앞이므로 앞에 둔다). `attached: attachedOf(input.chips)`는 그대로다.
4. 같은 file의 `retryTurn`: 본문의 `attached` part를 이미 `parts`로 복사한다. 거기서 `attached: attachedOfParts(body.value.content.parts)`로 `SendMessage.attached`를 다시 만들고, "본문에 chip이 남지 않아 …" 주석을 지운다.
5. `agent-tab-fake-source.ts`의 `send`가 `bodies.set(id, …)`에 chip을 `attached` BodyPart로 같이 저장하게 한다(화면 fake가 core와 같은 모양을 그린다).
6. `attached-chips_test.ts`의 test를 아래 하나로 바꾼다(같은 file의 기존 test와 합친다).

## 끝남

- `deno task check`가 통과한다.
- `deno run -A packages/shell/renderer/build.ts`가 통과한다.
- 위험 test(하나): "chip을 본문 part로 쓰고 다시 읽으면 같은 `attached`가 되어, 다시 보내기가 위반(파일·규칙)을 잃지 않는다." context chip 하나와 위반 chip 하나로 `attachedOfParts(attachedPartsOf(chips))`가 `attachedOf(chips)`와 같고, 그 `content`와 `attached`가 `sendMessage.input.safeParse`를 통과하는지 본다. 이 bug는 다시 보내면 agent가 위반을 잃는 데이터 손실이다.
- 남지 않음: `grep -rn "chip이 남지 않아" packages --include=*.ts --include=*.tsx --exclude-dir=dist`가 0줄이다. `grep -n "attached: \[\]" packages/shell/renderer/conversation/agent-tab-core-source-commands.ts`가 0줄이다.

## 보고

- 바꾼 file, 통과한 check
- 정한 것: 글 없이 chip만 보낼 때 `agent-view.tsx`가 chip 라벨을 글로 쓰는 것(`chipText`)은 그대로 둔다. core의 history와 제목은 `text` part만 읽어(`session/history.ts`가 글이 빈 사람 메시지를 건너뛴다) 글이 비면 그 메시지가 이력에서 사라진다. 대화에는 라벨 글과 chip part가 같이 보인다.
- 넘길 줄(계획 `prompt-text`의 file이라 고치지 않았다): 이력(`packages/core/lophn-agent/session/history.ts`)은 `text` part만 읽으므로 뒤 turn의 history에는 chip 줄이 없다. 지금도 그렇다. 바꾸려면 그 계획이 입력과 history를 같은 속성으로 맞출 때 같이 정한다.
- 무겁게 짠 것 / 알려진 미완 동작: 없으면 "없음"
