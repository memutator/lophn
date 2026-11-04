# cb-screen

대화 화면이 content block을 쓴다. composer는 이미지를 image block으로 보내고, 메시지 목록은 사람 메시지와 받은 메시지의 block을 그린다. 첨부 줄 code를 지운다.

- 단위: screen (wave 2)
- 선행: cb-core.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/**`(composer, `attachments.ts`, `agent-view.tsx`, `agent-tab-source.ts`, `agent-tab-core-source*.ts`, `agent-tab-fake-source.ts`, `message-list/{message-body,message-attachments}.tsx`, `thread/received-message.tsx`)
  - `packages/shell/main/desktop/core/allowlist.ts`
  - `packages/design/i18n/catalog/conversation.ts`
  - `packages/protocol/lophn-agent/message-attachments.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-call.md`
  - 제품 결정: 계획 README 정한 것 2, 6
- 계약:
  - 쓰는 것: `cb-core`가 내놓은 `contentBlockSchema`, `SendMessage.content`, 저장 part kind
  - 내놓는 것: 없음

## 할 일

1. composer: 이미지를 blob으로 올리고 `SendMessage.content`에 image block으로 싣는다. `composeAttachmentText`와 upload 뒤 줄 붙이기를 지운다.
2. 메시지 목록: 사람 메시지와 받은 메시지(call, 답)의 image·`resource_link`·`resource` block을 그린다. `splitAttachmentText`를 지운다. 옛 메시지의 첨부 줄은 글로 보인다(정한 것 2).
3. Agent 탭 source: `sendText`가 block을 보낸다. `retryTurn`이 글이 아닌 part를 버리지 않는다. fake source도 같다.
4. `message-attachments.ts`의 `attachmentImageLine`을 지운다(`image.read`의 `attachment:` 읽기는 남는다).

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음(화면)
- 남지 않음: `grep -rn "attachmentImageLine\|composeAttachmentText\|splitAttachmentText" packages`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
