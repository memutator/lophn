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

## cb-core가 넘긴 것 (lead가 더함)

- upload 계약이 바뀌었다: `UploadMessageImage` 입력은 `{content_type, bytes}`(session 없음), 출력은 `{blob}`이다. `agent-tab-core-source-images.ts`가 아직 옛 꼴(session을 보내고 `{id}`를 읽음)이라 cb-core 뒤 main에서 composer 이미지 첨부가 실패한다. 이 task가 고친다. 올림과 `SendMessage`는 같은 자격이어야 하고, 참조되지 않은 올림은 10분 뒤 만료된다.
- 대기 메시지 고치기: `EditQueued.content`는 block 배열이고 이미 있는 image block만 남길 수 있다(새 이미지는 `invalid_input`). 지금 renderer `editQueued`는 글만 보내서 이미지가 든 대기 메시지를 고치면 본문에서 이미지가 빠진다. 기존 image block을 그대로 실어 보낸다.
- `MessageReceived` event의 `body`는 아직 글이다. 이미지만 든 메시지는 live view에서 빈 줄로 보이다가 snapshot을 다시 읽으면 보인다. `ReadMessageBody`는 새 part kind(`image`, `resource_link`, `resource`)를 돌려주는데 `agent-tab-core-source-thread.ts`의 `readBody`가 `default: return []`로 버린다. 그것을 그린다.
- block 이미지는 `ReadMessageImage`(file route, `{session, image: <blob hash>}`)로 그린다. 옛 `att_` id도 같은 route로 읽힌다.
- 옛 주석: `attachments.ts` 1행, `agent-tab-core-source-images.ts` 2행, `message-attachments.ts` 1행.
- cb-core가 compile만 맞춘 곳: `agent-tab-core-source-commands.ts`(send, edit, retry를 block으로, `UserPart`), `agent-tab-core-source-thread.ts`(`default: return []`). 이 task가 제대로 고친다.
