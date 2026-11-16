# remote-desk-stale-send

두 기기(이 컴퓨터 창, 다른 기계를 보는 desktop, 폰)가 한 session에 쓸 때 늦게 보낸 쪽이 아직 못 본 사람 메시지가 있으면 그 보내기를 거절한다. 보내기가 화면이 아는 마지막 사람 메시지 id(`seen`)를 싣고, core가 메시지를 넣는 같은 transaction 안에서 그 뒤에 다른 사람 메시지가 있는지 보고 있으면 `conflict`(`details.reason: "changed_elsewhere"`)로 끝내며 아무것도 넣지 않는다. 화면은 쓴 글을 남긴 채 "다른 기기에서 바뀌었다"를 보이고 대화를 다시 읽는다. 합치지 않는다.

- 단위: stale-send (wave 2)
- 선행: remote-desk-client. 폰의 보내기 자리(`packages/mobile/src`)를 그 task가 옮긴 뒤에 고친다.
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/inputs.ts`
  - `packages/protocol/acp/input.ts`
  - `packages/core/lophn-agent/session/message-commands.ts`
  - `packages/core/lophn-agent/session/message-commands_test.ts`
  - `packages/core/main/daemon/wiring/acp-send.ts`
  - `packages/core/main/daemon/wiring/acp-send_test.ts`
  - `packages/shell/ipc/core-api.ts`(`CoreReply.error`의 `details?` type만)
  - `packages/shell/renderer/conversation/agent-tab-source.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-commands.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-env.ts`
  - `packages/shell/renderer/conversation/delivery-state.ts`
  - `packages/shell/renderer/conversation/delivery-state_test.ts`
  - `packages/shell/renderer/conversation/agent-view.tsx`
  - `packages/mobile/src/screens/session/conversation.tsx`
  - `packages/mobile/src/screens/session/new-session.tsx`
  - `packages/mobile/src/data/hooks.tsx`
  - `packages/design/i18n/catalog/conversation.ts`(key만 더한다)
  - `project-docs/flows/areas/sessions.yaml`
- 읽을 것:
  - 계획: `project-docs/plan/desktop-remote/README.md`의 "정한 것"(두 기기가 한 session에 쓸 때, 꺼진 기계에 queue 없음)
  - 비교: `/home/pyosechang/projects/harness-lab/_report/multi-device/mixdog.md` 6.1(stale view 거절: 같은 기기의 입력은 세지 않는다), `comparison.md` 5.2·5.3
  - architecture: `project-docs/architecture/acp.md`(AcpSend 하나가 지금 route로 보낸다), `project-docs/architecture/agent-chat.md`(보내기와 delivery 상태)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 sessions 쪽 항목, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - 지금 코드: `protocol/lophn-agent/inputs.ts`의 `sendMessageInputSchema`·`sendMessage`(errors에 `conflict`가 이미 있다), `protocol/acp/input.ts`의 `type: "send"`, `core/main/daemon/wiring/acp-send.ts`(send를 SendMessage command로 옮기는 곳), `core/lophn-agent/session/message-commands.ts`(같은 id 다시 보내기의 `conflict`, "this session takes no new input"의 `conflict`. 표 `messages`의 `from_kind`·`created_seq`는 `session/model.ts`), renderer `agent-tab-core-source-commands.ts`의 `sendContent`, `agent-tab-core-source-env.ts`가 실패를 `code`로만 옮기는 곳, `delivery-state.ts`의 `afterReply`, `agent-view.tsx`의 `deliver`(desktop composer), 폰의 `source.send` 자리 셋(`screens/session/conversation.tsx`, `new-session.tsx`, `data/hooks.tsx`), ACP 항목의 사람 메시지(`protocol/acp/items.ts`의 `actor: "user"`)
- 계약:
  - 쓰는 것: `packages/remote-client`의 `CoreReply`(폰 연결은 frame의 `error`를 통째로 넘기므로 `details`가 이미 온다)
  - 내놓는 것:
    - `sendMessage` 입력 칸 `seen?: Id<"msg"> | null`. 없으면 검사하지 않는다(화면이 없는 보내는 쪽: CLI, run, coding agent relay). `null`은 "이 화면은 사람 메시지를 하나도 못 봤다"이다.
    - AcpSend `type: "send"` 입력 칸 `seen?: Id<"msg"> | null`, SendMessage로 그대로 넘긴다. coding agent(harness) session의 보내기(`ctx.codingRelay.send`)는 보지 않는다.
    - 거절: `conflict`, message "this conversation changed on another device", `details: { reason: "changed_elsewhere" }`. 메시지, turn, queue 어느 것도 생기지 않는다.
    - renderer `SendInput.seen: string | null`(필수. 부르는 쪽이 늘 정한다), 실패 code `changed_elsewhere`(env가 `conflict` + `details.reason`을 이 code로 옮긴다).

## 할 일

1. protocol: 위 두 입력 칸. 주석에 뜻(화면이 아는 마지막 사람 메시지, 없으면 검사 없음)을 한 줄씩.
2. core(`message-commands.ts`): SendMessage가 메시지를 넣는 같은 write transaction 안에서, `seen`이 있으면 그 session의 `from_kind = 'human'` 메시지 가운데 `seen`보다 `created_seq`가 큰 것이 있는지 본다. `seen`이 null이면 사람 메시지가 하나라도 있으면 거절이다. `seen`이 그 session의 메시지가 아니면 `invalid_input`. 같은 id·key로 다시 보내기(이미 접수된 메시지)는 이 검사보다 먼저 지금처럼 같은 결과를 돌려준다(다시 보내기가 자기 메시지에 막히지 않는다). 자기가 방금 보낸 메시지가 다음 보내기를 막지 않는 것은 화면이 `seen`에 그 id를 넣어서다(아래 4).
3. `acp-send.ts`: send 입력의 `seen`을 SendMessage 입력으로 넘긴다.
4. renderer: `SendInput.seen`을 더하고 `sendContent`가 싣는다. desktop `agent-view.tsx`의 `deliver`는 지금 ACP 상태의 마지막 `actor: "user"` 메시지 id와 이 창이 마지막으로 보낸 메시지 id 가운데 대화에서 뒤의 것을 넣는다(대화에 아직 안 들어온 자기 메시지가 있으면 그 id). 새 session의 첫 보내기는 null. `agent-tab-core-source-env.ts`가 `conflict`이고 `details.reason`이 `changed_elsewhere`면 code `changed_elsewhere`로 옮긴다(`ipc/core-api.ts`의 `CoreReply.error`에 `details?: Record<string, unknown>` type을 더한다. main은 이미 넘긴다). `delivery-state.ts`의 `afterReply`가 `changed_elsewhere`를 받으면 쓴 글과 첨부를 composer에 되돌리고 그 뜻의 상태를 둔다. view는 그 상태에서 toast 한 줄 "This conversation changed on another device. Read the new messages, then send again."(catalog `conversation.ts` key)을 띄우고 ACP snapshot을 다시 읽는다.
5. 폰: 세 자리가 `seen`을 같은 규칙으로 넣는다(대화 화면은 그 화면의 ACP 상태와 마지막으로 보낸 id, 새 session은 null). 실패 표시는 같은 `afterReply`와 key를 쓴다. 화면 모양은 바꾸지 않는다.
6. flows: `areas/sessions.yaml`의 SendMessage와 AcpSend flow에 outcome `changed_elsewhere`(conflict)와 `seen`의 when을 더한다. `node tools/flows.ts check`.

## 끝남

- `npm run check`가 통과한다.
- `cd packages/mobile && npm ci && npm run typecheck && npm test`가 통과한다.
- 위험 test:
  - `message-commands_test.ts`: "다른 사람 메시지가 `seen` 뒤에 있으면 보내기가 `conflict`(`changed_elsewhere`)로 끝나고 메시지·turn·queue가 하나도 생기지 않으며, `seen`이 마지막 사람 메시지면 접수되고, `seen`이 없으면 검사하지 않고, 같은 id·key의 다시 보내기는 거절되지 않는다"
  - `delivery-state_test.ts`: "`changed_elsewhere` 뒤 쓴 글과 첨부가 composer에 남는다"
- subprocess, 서버, 브라우저를 띄우는 test는 만들지 않는다.
- 남지 않음: 없음(칸을 더한다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: `seen`을 고르는 규칙을 desktop과 폰 각자 어디서 읽는지(file과 함수), 개발 core에서 두 창(이 컴퓨터 창 둘이어도 된다)으로 같은 session에 차례로 보내 거절과 다시 읽기를 본 결과, lead가 고칠 목록(`architecture/acp.md`나 `agent-chat.md`의 stale 거절).
