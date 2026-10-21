# ap-waiting

problem-remove 뒤의 모양을 기준으로 한다. 대기 목록과 toast를 turn request(lophn agent, coding harness)와 activation 동의 둘로 줄인다. 보류 approval 카드(reaction, 설정 고치기, 보류 activation)와 그 결정 길을 지우고 허락 카드의 선택지를 `once | always | reject`로 한다. `ui-design` skill로 wireframe부터 고치고 문구는 `wording` skill을 따른다.

- 단위: waiting (wave 2)
- 선행: ap-ask-turn, ap-activation
- 소유(이 task만 고친다):
  - `tools/wireframes/pages/screens/questions.tsx`
  - `packages/shell/renderer/desktop/connection/events/hooks.tsx`
  - `packages/shell/renderer/desktop/connection/waiting/`
  - `packages/shell/renderer/desktop/connection/events/{waiting-store.ts,waiting-store_test.ts,reactions.ts,snapshots.ts,sessions-store.ts,fake-source.ts}`
  - `packages/shell/renderer/desktop/connection/toasts/`
  - `tools/wireframes/pages/screens/waiting/`
  - `packages/design/wording/catalog/`
- 읽을 것:
  - 계획: `project-docs/plan/approval-simplify/README.md`의 "정한 것"(activation 동의를 activation 상태로 옮긴다, 대기 목록에 같이 보인다)과 "뼈대 검토에서 정한 것"(대기 목록은 turn request와 activation 동의만 든다)
  - roadmap: `project-docs/products/roadmap/approval.md`의 "묻는 길은 하나다"(선택지 셋, "이 session 동안" 없음), "앱 쪽"(activation 동의), "남기거나 새로 두는 것"의 대기 목록 줄
  - architecture: `project-docs/architecture/approval.md`(지금 코드. 대기 목록이 두 길을 한 목록에 두는 부분과 request의 cancelled·거절 구별은 남는다), `project-docs/architecture/ui-kit.md`의 "gallery가 정본이다"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `event-stream`, `design-api`; `project-docs/module-catalog.yaml`의 `packages/shell/renderer`, `packages/design`
  - skill: `.claude/skills/ui-design/SKILL.md`("새 화면 만들기", "확인"), `.claude/skills/wording/SKILL.md`("key를 지우기 전에"), `.claude/skills/write-test/SKILL.md`
  - 계약(앞 task가 만든 것. 이름과 모양은 그 file에서 확인한다):
    - `packages/protocol/approvals/turn-request.ts`(ap-contract): `TurnRequest`, `turnRequestChoiceSchema`, `TurnRequestOutcome`, `turnRequestDecide`
    - `packages/protocol/approvals/gate-call.ts`(ap-contract): `GateCall`(subject의 `app_tool`·`mcp_tool`·`shell`)
    - `packages/protocol/apps/activation/consent.ts`(ap-contract): `ActivationConsent`, `activationConsent`, `activationConsents`
    - `packages/protocol/events/agent.ts`, `packages/protocol/events/snapshot.ts`(ap-ask-turn): `TurnRequestOpened`, `TurnRequestClosed`, snapshot `turn_requests`
    - `packages/protocol/events/transient.ts`(ap-activation): `ActivationConsentRequested`, `ActivationConsentClosed`의 envelope(`subject` 값 포함)
  - 본보기(화면): `tools/wireframes/pages/screens/waiting/waiting-pages.tsx`, `tools/wireframes/pages/screens/questions.tsx`(이 page들의 영역 file. 소유 밖)
  - renderer(모두 `packages/shell/renderer/desktop/connection/` 아래)
    - 대기 목록: `waiting/model.ts`(`cardOf`), `waiting/decide.ts`(`turnChoiceOf`, `decideWaiting`), `waiting/settled.ts`, `waiting/waiting-panel.tsx`, `waiting/waiting-layer.tsx`, `waiting/cards/{decision,permission-card,activation-card,reaction-card,coding-card,question-card,head}.tsx`, `waiting/waiting.module.css`
    - store와 source: `events/waiting-store.ts`, `events/sessions-store.ts`, `events/snapshots.ts`, `events/hooks.tsx`(`useWaitingRefresh`. 소유 밖), `events/fake-source.ts`(fake Gateway), `waiting/fake-source.ts`(대기 목록 fake)
    - toast: `events/reactions.ts`(`reactionsOf`), `toasts/toast-text.ts`, `toasts/toast-host.tsx`
  - 이 fake를 쓰는 소유 밖 file(이름과 인자를 깨지 않는다): `tools/wireframes/pages/screens/app-space/space.tsx`(`CODING_ASK`), `tools/wireframes/pages/screens/{settings-frame.tsx,launcher/launcher-pages.tsx}`(`createFakeWaiting([])`), `tools/wireframes/pages/screens/conversation.tsx`(`createFakeSource()`), `packages/shell/renderer/desktop/dev-mock/requests.ts`(`createFakeWaiting()`)
- 계약:
  - 쓰는 것: `TurnRequest`, `turnRequestDecide`, `TurnRequestOpened`·`TurnRequestClosed`, snapshot `turn_requests`(ap-contract, ap-ask-turn), `activationConsents`, `activationConsent`, `ActivationConsentRequested`·`ActivationConsentClosed`(ap-contract, ap-activation)
  - 내놓는 것: 대화 화면이 쓰는 결정 helper(`packages/shell/renderer/desktop/connection/waiting/decide.ts`의 `turnChoiceOf` 자리)는 `TurnRequestChoice`를 만든다. renderer는 `approvalsPending`, `approvalsDecide`, `approvalsDecideTurn`, `PendingApproval`, `ApprovalRequested`, `PermissionRequested`, `PermissionResolved`, `permission_requests`를 쓰지 않는다(대화 화면 몫은 ap-conversation).

## 할 일

추가(planner, 살 단계 뒤): shell turn request에는 `always_patterns`(always를 고르면 더해질 규칙 줄)가 있다. card는 그 줄을 그대로 보이고, `always` 단추는 그것이 있을 때만 둔다. activation 동의는 `choice: "allow" | "reject"`이고 이유가 없으며 compare는 `{requested_at}`이다.

근거: README "정한 것"(activation 동의는 activation 상태와 동의 command, 대기 목록에 같이 보인다), roadmap "묻는 길은 하나다"(선택지 `once | always | reject`, "이 session 동안" 없음), README "뼈대 검토에서 정한 것"(대기 목록은 turn request와 activation 동의만). 이 task가 돌 때 reaction 물음(ap-reaction, ap-ask-pending)과 설정 고치기 물음(ap-settings-edit)은 core에서 이미 사라졌다. gallery는 renderer component를 그대로 그리므로(`ui-kit.md` "gallery가 정본이다") 1~2(gallery와 fake)와 3~8(renderer)을 같이 바꿔야 type check가 선다. 이 brief는 `e192a9d8c` 기준이다. "앞 계획 land 뒤 path 확인"이라 적은 곳은 `problem-remove`의 `pr-reactions`가 먼저 고친 file이라 줄이 옮겨졌을 수 있으니 함수 이름으로 찾는다.

1. gallery의 fake부터 새 모양으로 바꾼다: `waiting/fake-source.ts`(앞 계획 land 뒤 path 확인).
   - fixture를 `TurnRequest`(`subject`가 있고 intent, choices, fingerprint가 없다)와 `ActivationConsent`로 바꾼다.
     - `SHELL_COMMAND`: Operator session의 shell 물음. `subject: { kind: "shell", command: "git push --force origin main" }`. 지금의 `APP_TOOL_CALL` 자리다(그 이름은 지운다).
     - `EXTERNAL_CALL`: MCP tool 물음으로 남긴다(`subject: { kind: "mcp_tool", server: "mail", tool: "send_message", effect: "external" }`). tool subject 카드의 그림이 하나 있어야 해서다. 지금은 바깥 효과 tool을 묻지 않으니(README "사람이 정할 것" 1의 추천) page 설명에 그렇게 적는다.
     - `CODING_ASK`: 이름을 지킨다(`app-space/space.tsx`가 쓴다). `subject: { kind: "harness", harness: "claude", tool: "Bash", summary: null }`.
     - `ACTIVATION`, `FIRST_ACTIVATION`: `ActivationConsent`(`{ app, release, comparison, requested_at }`). comparison 값은 지금 fixture의 것을 그대로 옮긴다.
     - 지운다: `CONFIG_EDIT`, `REACTION`, `pending()`, `activationIntent()`, `agentIntent()`, `TOOL_CHOICES`, `ALLOW_CHOICES`.
   - `Item`은 turn request 묶음, `ActivationConsent`, `"question"`이다. `allItems()`는 `SHELL_COMMAND`, `CODING_ASK`, `"question"`, `ACTIVATION`이다.
   - `SETTLED`는 상태 셋(`allowed`, `denied`, `cancelled`)의 줄이다. activation 허락 줄 하나, shell 거절 줄 하나(`agent` 있음), cancelled 줄 하나.
   - `createFakeWaiting`: snapshot의 `turn_requests`에 든다(`permission_requests`는 ap-cleanup이 schema에서 지울 때까지 빈 배열로 둔다). route 셋을 받는다.
     - memory `turnRequestDecide`: 항목을 빼고 agent event `TurnRequestClosed { request, outcome }`를 흘리고 `{ outcome: TurnRequestOutcome }`을 돌려준다(`once`·`always`면 `{ outcome: "allow", scope }`).
     - command `activationConsent`: 항목을 빼고 남지 않는 event `ActivationConsentClosed`를 흘리고 `{ release, outcome }`을 돌려준다.
     - read `activationConsents`: `{ as_of_seq, next_cursor, consents }`.
     - `approvalsPending`, `approvalsDecide`, `approvalsDecideTurn` 갈래와 `ApprovalDecided`를 흘리는 곳을 지운다.
   - `events/fake-source.ts`: `FakeSnapshot.approvals`를 `consents: readonly ActivationConsent[]`로, read 갈래 `approvalsPending`을 `activationConsents`로 바꾼다.
2. gallery page를 고친다: `tools/wireframes/pages/screens/waiting/waiting-pages.tsx`(ui-design skill "새 화면 만들기" 4~7. 앞 계획 land 뒤 path 확인).
   - `WaitingReaction`을 지운다. page id는 바꾸지 않는다.
   - `WaitingPermission`은 `SHELL_COMMAND`, `EXTERNAL_CALL`을 펼친 상태, `WaitingDenyReason`은 `SHELL_COMMAND`에 이유 칸을 연 상태다. `WaitingActivation`, `WaitingFirstActivation`, `WaitingList`, `WaitingSettled`, `WaitingToasts`는 새 fixture로 그린다.
   - `FAKE_EVENTS`: `PermissionRequested`를 `TurnRequestOpened { request }`(agent event, `session` 있음)로, `ApprovalRequested`를 `ActivationConsentRequested`(남지 않는 event, `{ type, subject, at, payload: { app, release } }`)로 바꾼다. `AppRestartHalted`, `KindViolationFound`, `QuestionAsked`는 `pr-reactions`가 맞춘 모양 그대로 둔다.
   - page 머리 주석(`/** … */`)을 새 모양으로 고친다: 권한 요청은 shell 명령과 tool이고, shell은 Allow once·Always allow·Deny, tool은 Allow once·Deny다. 결정 뒤 줄은 허락·거절·cancelled 셋이다.
3. 대기 목록 store(`events/waiting-store.ts`).
   - `WaitingEntry`: `permission`·`coding`은 `request: TurnRequest`이고 `subject.kind === "harness"`면 `coding`, 아니면 `permission`이다(지금은 agent role로 가른다). `activation`은 `request: ActivationConsent`이고 `id`는 release id다(같은 release는 한 줄). `reaction` 갈래와 `approvalWaitingKind`를 지운다. `question`·`coding_start`는 그대로다.
   - 항목의 agent와 place는 session에서 온다(`SessionStarted`와 snapshot). turn request에는 actor가 없으니 session을 모르면 agent는 null이다. activation 항목은 agent가 null이고 place는 `{ kind: "app", id: app }`이다.
   - `WAITING_CONDITION`: `PermissionRequested`·`PermissionResolved`·`ApprovalRequested` 대신 `TurnRequestOpened`·`TurnRequestClosed`·`ActivationConsentRequested`·`ActivationConsentClosed`를 듣는다.
   - `apply`: `TurnRequestOpened`는 넣고 `TurnRequestClosed`는 뺀다. `ActivationConsentClosed`는 그 release 항목을 뺀다. `ActivationConsentRequested`에는 comparison이 없으니 `activationConsents`를 다시 읽어 맞춘다(지금의 `refresh`).
   - `readAll`·`replace`: snapshot의 `turn_requests`와 `activationConsents` 읽기다. 둘 다 읽혀야 통째로 맞추는 규칙은 그대로다.
   - `refresh`: activation 동의만 다시 읽어 맞춘다. `hooks.tsx`의 `useWaitingRefresh`(소유 밖)는 결정 뒤에 부르는 곳이 없어진다. 보고의 "안 쓰게 된 export"에 적는다.
   - `events/snapshots.ts`: `readPendingApprovals`를 `readActivationConsents`(read `activationConsents`)로 바꾼다.
   - `events/sessions-store.ts`: session의 대기 수는 `TurnRequestOpened`·`TurnRequestClosed`와 snapshot `turn_requests`로 센다.
4. 카드 값(`waiting/model.ts`. 앞 계획 land 뒤 path 확인).
   - `cardOf`가 `TurnRequest.subject`와 `ActivationConsent`에서 글을 만든다. 글은 program이 만든다(요청한 agent가 쓴 설명은 없다)는 규칙은 그대로다.
     - `shell`: 제목은 "Run a command", 명령은 접지 않고 code 한 줄로 보인다(정한 것 2). facts는 없다.
     - `app_tool`·`mcp_tool`: 지금 제목과 설명을 쓰고 facts는 대상과 효과뿐이다. 입력 칸은 없다(정한 것 3).
     - `activation`: `comparison`을 type 그대로 읽는다(`activationComparisonSchema.safeParse`가 필요 없다). meta는 앱만 보인다.
   - `CardView.choices`의 type은 `WaitingChoice[]`다. turn request는 `turnChoicesOf(subject)`, activation은 `["allow", "reject"]`다.
   - 지운다: `SETTINGS_LABELS`, `EVENT_LABELS`, `OPENS_LABELS`, `scopeText`, `targetOf`의 `agent_call`·`settings_edit`·`app_resource`·`reaction`·`activation` 갈래, `titleAndDescription`의 `settings_edit`·`agent_call`·default 갈래, `reaction` 카드 값, `metaOf`의 `waiting.label.agent-reaction`. `Intent`, `PendingApproval`, `RequestChoice`, `AppGrantScope` import도 지운다.
5. 결정 helper(`waiting/decide.ts`). 계약 "내놓는 것"이다.
   - `WaitingChoice = "once" | "always" | "allow" | "reject"`. `allow`는 activation만 쓴다.
   - `turnChoiceOf(choice: "once" | "always" | "reject", reason?)`는 `TurnRequestChoice`를 만든다. 이유를 한 줄 500자로 맞추는 규칙은 그대로다.
   - `turnChoicesOf(subject)`를 더한다: shell이면 `["once", "always", "reject"]`, 나머지는 `["once", "reject"]`. 대화 화면(ap-conversation)도 이 함수로 단추를 고른다(정한 것 1).
   - `decideWaiting`: `permission`은 memory `turnRequestDecide`(`{ session, request, choice }`), `activation`은 `commandCall(activationConsent, { input: { release, choice }, compare, key: "activation-consent-<release>-<allow|reject>" })`다. compare는 그 route 정의를 따른다. 결과는 `SettledState`(`allowed`, `denied`, `cancelled`)다.
   - 지운다: `settledOfPending`, `approvalsDecide`·`approvalsDecideTurn` 갈래, `SettledState`의 `accepted`·`applied`·`failed`.
6. 카드 component(`waiting/cards/`).
   - `reaction-card.tsx`를 지운다.
   - `decision.tsx`: `ALLOW_ORDER`는 `["always", "once", "allow"]`이고 맨 오른쪽이 주 행동이다(지금 규칙). `session` label 갈래를 지운다. `RequestChoice` import를 `WaitingChoice`로 바꾼다.
   - `permission-card.tsx`: shell subject면 명령 줄을 늘 보이고 펼침 토글이 없다. tool subject는 지금처럼 facts를 접는다.
   - `activation-card.tsx`: `ActivationConsent`를 그린다. 요청한 agent가 없으니 Decision의 `requester`는 null이고 이유 칸이 없다(정한 것 4).
   - `head.tsx`: `faceOf`의 reaction 갈래를 지우고 activation은 `apps` 아이콘이다.
   - `coding-card.tsx`, `question-card.tsx`: 그대로다(`coding`은 이제 harness subject다).
7. 목록과 결정 뒤 줄.
   - `waiting/waiting-panel.tsx`: `GROUPS`는 권한 요청(`permission`, `coding`, `coding_start`), 질문, activation(`activation`) 셋이다. 셋째 묶음 이름 key를 `waiting.label.group-activation`으로 바꾼다. `ReactionCard` 갈래와 결정 뒤 `refresh()`를 지운다(activation은 `ActivationConsentClosed`가 뺀다). `SETTLED_MARK`는 `allowed`, `denied`, `cancelled` 셋이다.
   - `waiting/settled.ts`: `TurnRequestClosed`·`QuestionResolved`·`ActivationConsentClosed`를 듣고 cancelled만 줄로 남긴다. `ApprovalDecided`와 "접수를 적용 결과로 바꾸는" 몫(`applied` ref)을 지운다.
8. toast(앞 계획 land 뒤 path 확인).
   - `events/reactions.ts`: `REACTION_EVENT_TYPES`의 `PermissionRequested`·`ApprovalRequested`를 `TurnRequestOpened`·`ActivationConsentRequested`로 바꾼다. 권한 toast는 `toast("permission", request.id, { session })`(`intent` 칸을 뺀다), activation toast는 `toast("activation", release, { app })`이다. `approvalWaitingKind` import를 지운다.
   - `toasts/toast-text.ts`: `waiting.toast-approval.*` 갈래를 `waiting.toast-activation.*`로 바꾼다. 제목은 `{intent}` 없이 앱 이름을 쓴다.
   - `toasts/toast-host.tsx`, `toasts/toast-actions.ts`: 고칠 것이 없으면 두지 않는다.
9. test(`events/waiting-store_test.ts`). 새로 만들지 않는다. 있는 test 하나가 보는 것(같은 event 두 번에 항목 하나, 다시 붙으면 snapshot이 목록을 통째로 맞춰 사라진 요청이 남지 않음, snapshot으로 온 것은 toast가 없음)을 새 event와 snapshot 칸으로 옮긴다. snapshot fixture에는 ap-cleanup 전까지 `permission_requests: []`가 있어야 type이 선다.
10. wording(`packages/design/wording/catalog/data.ts`). wording skill "key를 지우기 전에"대로 앞부분(`waiting.toast-`, `waiting.label.`, `waiting.notice.`, `waiting.title.`, `waiting.button.`)으로 `packages`와 `tools`를 grep한 뒤 지운다. `reactions.ts`가 `` `waiting.toast-${kind}.title` ``을 만든다.
    - 지울 후보: `waiting.button.allow-session`, `waiting.label.agent-reaction`, `waiting.label.event-*`(남은 것), `waiting.label.fact-event`, `waiting.label.fact-opens`, `waiting.label.fact-detail`, `waiting.label.fact-input`, `waiting.label.settings-*`, `waiting.label.group-approval`, `waiting.label.settled-accepted`, `waiting.label.settled-applied`, `waiting.label.settled-failed`, `waiting.notice.settled-accepted`, `waiting.notice.settled-applied`, `waiting.notice.settled-failed`, `waiting.notice.agent-call`, `waiting.notice.app-resource`, `waiting.notice.settings-edit`, `waiting.title.agent-call`, `waiting.title.app-resource`, `waiting.title.reaction`, `waiting.title.settings-edit`, `waiting.toast-approval.*`
    - 더할 것: `waiting.title.shell`("Run a command"), `waiting.label.group-activation`, `waiting.label.settled-allowed`, `waiting.notice.settled-allowed`, `waiting.toast-activation.title`·`.body`·`.button`
    - `deno task wording`, `deno run --allow-read tools/check-wording.ts`
11. 소유 줄에 없는 file. 최소로 고치고 보고의 "넘길 줄"에 적는다.
    - `tools/wireframes/pages/screens/questions.tsx`: `new-waiting-reaction` page 줄과 `WaitingReaction` import만 뺀다(지운 page를 가리키던 등록 줄). 다른 page 설명(`new-waiting-list`, `new-waiting-permission`, `new-waiting-activation`, `new-waiting-settled`, `new-waiting-toasts`)에 고칠 글은 보고의 "등록할 것"에 적어 lead가 고친다.
12. 지운 이름(`PendingApproval`, `TurnPermissionRequest`, `approvalWaitingKind`, `readPendingApprovals`, `ReactionCard`, `settled-accepted`, `allow-session`)을 주석과 문구에서도 grep해 맞춘다. 파일 머리 주석의 "보류 request", "접수와 적용", "intent"를 지금 동작으로 고친다.

정한 것:
1. `always` 단추는 shell 물음에만 둔다. 이유: `always`는 등록된 효과가 내고 지금 등록은 shell 줄 더하기 하나다(ap-ask-turn, ap-shell-gate). tool 물음에 `always`를 보내면 `invalid_input`이다. 사람이 "묻는다"로 정하면(README "사람이 정할 것" 1) `turnChoicesOf`의 tool 갈래에 `always`를 더한다.
2. shell 카드는 명령을 접지 않고 늘 보인다. 이유: 세부가 명령 하나뿐이고 사람이 그것을 보고 정한다.
3. tool 카드에 입력 칸이 없다. 이유: `TurnRequest`에 입력이 없다(ap-contract). 입력을 보이려면 계약에 칸을 더해야 한다.
4. activation 카드에 거절 이유 칸이 없다. 이유: `ActivationConsent`에 요청한 agent가 없어 이유를 받을 쪽이 없다. 거절은 `{ kind: "reject" }`만 보낸다.
5. 질문(ask tool)의 카드와 묶음은 그대로 둔다. 이유: approval이 아니고 이 계획 범위 밖이다.

## 끝남

- `deno task check`가 통과한다.
- `deno run -A packages/shell/renderer/build.ts`가 통과한다. `check:full`은 renderer build를 보지 않는다.
- `deno run --allow-read tools/check-wording.ts`에 오류가 없다.
- `deno task wireframes`가 되고(ui-design skill "확인"), gallery에서 다음이 그려진다.
  - `new-waiting-list`: 권한 요청(shell 명령, coding agent), 질문, activation 묶음 셋이다.
  - `new-waiting-permission`: shell 카드는 명령이 code 줄로 보이고 단추가 Deny, Always allow, Allow once다. MCP tool 카드는 Deny, Allow once다.
  - `new-waiting-deny-reason`, `new-waiting-activation`, `new-waiting-first-activation`, `new-waiting-settled`(허락·거절·cancelled 셋), `new-waiting-toasts`(권한, activation, 질문, 재시작 멈춤)
  - `new-waiting-reaction`은 목록에 없다.
- 위험 test: 없음. 새로 만들지 않는다. `events/waiting-store_test.ts`의 test는 새 event로 옮겨 그대로 통과한다.
- 남지 않음:
  - `grep -rn --exclude-dir=dist -E "approvalsPending|approvalsDecide|PendingApproval|TurnPermissionRequest|ApprovalRequested|ApprovalDecided|PermissionRequested|PermissionResolved|permission_requests|approvalWaitingKind|readPendingApprovals|ReactionCard|settledOfPending" packages/shell/renderer/desktop/connection tools/wireframes/pages/screens/waiting`가 0줄이다. 단 `waiting-store_test.ts`와 fake의 snapshot fixture에 남는 `permission_requests: []`는 ap-cleanup이 지운다(보고에 적는다).
  - `grep -rn --exclude-dir=dist -E "allow-session|settled-accepted|settled-applied|settled-failed|toast-approval|agent-reaction|group-approval|title\.reaction|settings-edit" packages/shell/renderer tools/wireframes packages/design/wording`가 0줄이다.
  - `ls packages/shell/renderer/desktop/connection/waiting/cards/reaction-card.tsx`가 없다고 답한다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 적어도 `tools/wireframes/pages/screens/questions.tsx`의 page 설명 고칠 글(할 일 11)과 `tools/wireframes/pages/index.ts` 머리 주석의 버린 화면("Waiting · reaction approval")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): 적어도 `events/hooks.tsx`의 `useWaitingRefresh`가 쓰이는지
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳(할 일 11)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 적어도 확인해 적는다: tool 물음에는 `always`가 없다(정한 것 1), activation 거절에 이유를 붙일 수 없다(정한 것 4).
