# hr-session-input

approval-simplify가 만든 unattended 전파(Router 입력 `RouteInput.unattended` → 입력함의 `RoutedInput.unattended` → `turnModeOf`) 위에서, `SendMessage`가 받은 unattended 표시를 Router 입력에 실어 그 메시지가 연 turn을 unattended로 연다. 켤 때 입력함에 되돌리는 사람 메시지에서 unattended 메시지를 빼, 실패로 닫힌 run의 입력이 attended turn으로 다시 돌지 않게 한다.

- 단위: session (wave 2)
- 선행: hr-contract-runs.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/session/message-commands.ts`
  - `packages/core/lophn-agent/session/message-commands_test.ts`
  - `packages/core/lophn-agent/session/model.ts`
  - `packages/core/router/model.ts`(`RouteInput.unattended`의 주석 한 줄만)
  - `packages/protocol/lophn-agent/turn-values.ts`(turn mode 머리 주석만)
- 읽을 것:
  - 계약: `project-docs/plan/headless-run/tasks/hr-contract-runs.md`의 `inputs.ts` 줄과 "끝"을 정하는 규칙의 "켤 때 running인 run" 줄
  - 제품 결정: `project-docs/plan/headless-run/README.md`의 "이 계획에서 더 정한 것"(run의 turn은 unattended다)과 "뼈대 검토에서 정한 것"(run 입력은 켤 때 다시 줄 세우지 않는다). `project-docs/architecture/approval.md`의 "turn mode"(정하는 순서는 unattended 입력, session skip, attended다)
  - architecture: `project-docs/architecture/place-session.md` "지키는 것"의 "lophn이 꺼졌다 켜져도" 줄(켤 때 turn이 가져가지 않은 사람 메시지를 입력함에 다시 넣는다. 이 task가 거기서 run 입력을 뺀다), `project-docs/architecture/agent-call.md`("입력함은 메모리라 꺼지면 사라진다", "unattended는 call을 따라 간다": 표시는 봉투, `RoutedInput`, `agent_calls`에 실리고 받은 메시지 기록과 태그 글에는 넣지 않는다. 받은 turn과 뒤 이력이 같은 bytes를 만들어야 해서다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-sessions`, `router`; `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - 코드
    - `packages/core/lophn-agent/session/message-commands.ts`(`sendWith`, `writeHuman`, `MessageRouter`, `unstartedHumanMessages`)
    - `packages/core/lophn-agent/session/model.ts`(`conversationSchemaSteps`의 `messages` 표와 `messages_content_immutable` trigger)
    - `packages/core/main/daemon/wiring/router.ts`의 `start`(켤 때 `unstartedHumanMessages`로 입력함에 되돌린다. 이 task는 고치지 않는다)
    - `packages/protocol/lophn-agent/turn-values.ts`의 turn mode 머리 주석("mode가 사는 곳", "정하는 규칙(`turnModeOf`)"), `packages/core/router/model.ts`의 `RouteInput.unattended?: boolean`, `packages/core/router/router.ts`의 `inputOf`(`RoutedInput.unattended`로 옮긴다), `packages/core/lophn-agent/run-loop/turn-mode.ts`의 `turnModeOf`, `packages/core/router/router_test.ts`의 "attended turn이 보낸 call은 attended로 열린다. unattended가 attended 사슬로 새지 않는다"
    - `packages/core/lophn-agent/session/message-commands_test.ts`(지금 test의 준비 꼴)
- 계약:
  - 쓰는 것: hr-contract-runs의 `sendMessage` 입력 칸 `unattended`, Router 입력의 `unattended?: boolean`(`packages/core/router/model.ts`의 `RouteInput`)과 그 전파
  - 내놓는 것(hr-runs-wiring이 기댄다):
    - `SendMessage { …, unattended: true }`로 넣은 메시지가 연 turn은 unattended다. 칸이 없는 사람 메시지는 지금처럼 attended다.
    - 그 메시지의 `messages` 행에 표시(`unattended` 열, 1)가 남는다. `unstartedHumanMessages`는 표시가 있는 메시지를 내지 않는다. 그 run은 hr-runs-wiring이 켤 때 `lophn_restarted`로 닫는다.

## 할 일

근거는 README "뼈대 검토에서 정한 것"의 "run 입력은 켤 때 다시 줄 세우지 않는다"와 `architecture/approval.md` "turn mode"다. approval-simplify는 Router 입력에 `unattended?: boolean`을 두었고 `messages`에는 표시를 두지 않았다. 칸 이름은 둘 다 `unattended`다.

1. `packages/core/lophn-agent/session/model.ts`: `conversationSchemaSteps`의 `messages` 표에 `unattended integer not null default 0 check (unattended in (0, 1))`와 표 check `(unattended = 0 or from_kind = 'human')`을 더하고, `messages_content_immutable` trigger의 열 목록에 `unattended`를 더한다.
   - 같은 schema step(`lophn-agent.sessions.tables`)을 고친다. 새 step, migration, 옛 행 읽기를 만들지 않는다. 개발 data는 지우고 새로 만든다(AGENTS.md "호환성").
   - 이 열은 켤 때 되돌리기만 읽는다. 받은 봉투(`receivedEnvelopeSchema`, `packages/core/lophn-agent/session/reads.ts`·`history.ts`의 읽기)와 태그 글에는 싣지 않는다. 받은 turn과 뒤 이력이 같은 bytes를 만들어야 한다(`agent-call.md`).
   - 다른 insert(`packages/core/lophn-agent/places/messages.ts`, `packages/core/lophn-agent/session/fork.ts`, `recordAgent`)는 열을 적어 넣으므로 기본값 0으로 그대로 된다. 고치지 않는다.
2. `packages/core/lophn-agent/session/message-commands.ts`
   1. `HumanMessage`에 `unattended: boolean`을 더하고 `writeHuman`의 insert에 싣는다.
   2. `sendWith`에서 `const unattended = input.unattended === true`를 `writeHuman`과 `deps.router.route(...)`에 싣는다. `MessageRouter`의 route 입력 type에 `unattended?: boolean`(Router의 `RouteInput`과 같은 칸)을 더한다. 칸이 없는 사람 메시지는 지금처럼 attended다.
   3. `unstartedHumanMessages`의 where에 `and m.unattended = 0`을 더하고, 머리 주석에 이유를 한 줄 더한다: unattended 메시지는 run의 입력이고, 켤 때 다시 돌면 이미 실패로 닫힌 run 뒤에 attended turn이 생겨 바깥 효과가 두 번 난다.
   - 같은 id의 재전송 비교(`writeHuman`의 `existing`)는 그대로 둔다.
   - 정한 것: unattended 메시지의 `delivery`는 따로 막지 않는다. 이유: run(hr-runs-wiring)은 늘 `next_turn`으로 넣는다. 막을 다른 입구가 없다.
3. 주석 둘을 이 동작에 맞춘다. 코드는 고치지 않는다.
   - `packages/core/router/model.ts`: `RouteInput.unattended`의 주석 "agent의 SendCall·ReplyCall만 싣는다. 없으면 false."를 "agent의 SendCall·ReplyCall과 run이 넣은 사람 메시지(`SendMessage`의 `unattended: true`)가 싣는다. 없으면 false."로 고친다.
   - `packages/protocol/lophn-agent/turn-values.ts`의 turn mode 머리 주석: "봉투" 줄에 `SendMessage` 입력의 `unattended?: true`(run만 싣는다)를 더한다. "받은 메시지 기록(`receivedEnvelopeSchema`, `messages`)에는 싣지 않는다"를 "받은 봉투(`receivedEnvelopeSchema`)와 태그 글에는 싣지 않는다. `messages`에는 사람 메시지의 표시만 `unattended` 열로 남는다(켤 때 입력함에 되돌리지 않으려고)"로 고친다. "정하는 규칙"의 attended 목록의 "사람 메시지"를 "표시 없는 사람 메시지"로 고친다.
4. `packages/core/main/daemon/wiring/router.ts`(켤 때 되돌리기)는 고치지 않는다. `unstartedHumanMessages`가 빼므로 되돌리는 쪽은 바뀌지 않는다(되돌린 입력은 지금처럼 `unattended: false`다).
5. test: `packages/core/lophn-agent/session/message-commands_test.ts`에 아래 위험 test를 새 `Deno.test` 하나로 더한다. 지금 test의 DB 준비(`conversationSchemaSteps`, `revertSchemaSteps`, `sql`, `session`, `message`)를 file 안 작은 helper로 나눠 같이 쓴다. 열린 session 하나에 turn이 가져가지 않은 사람 메시지 둘(하나는 `unattended = 1`)을 넣고 `unstartedHumanMessages(sql)`의 id가 attended 메시지 하나뿐인지 본다. 지금 test는 이름과 판정을 바꾸지 않는다.
   - turn mode가 unattended로 열리는지는 다시 보지 않는다. Router가 입력의 표시를 `RoutedInput`으로 옮기는 것은 `packages/core/router/router_test.ts`의 "attended turn이 보낸 call은 attended로 열린다…"가 보고(`inputOf`는 사람 메시지와 call이 같이 쓴다), mode는 순수 함수 `turnModeOf`가 정한다(`write-test` "이미 다른 test가 보는 동작").

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "켤 때 unattended 사람 메시지는 입력함에 다시 들어가지 않는다. 실패로 닫힌 run의 입력이 다시 돌아 바깥 효과가 두 번 나지 않는다"(`packages/core/lophn-agent/session/message-commands_test.ts`)
- 지금 test "재시작 때 되돌리는 사람 메시지는 turn이 가져가지 않은 것만이고 Fork 복사본은 뺀다"가 그대로 통과한다.
- `grep -n "unattended" packages/core/lophn-agent/session/message-commands.ts`가 `writeHuman`의 insert, `sendWith`의 Router 입력, `unstartedHumanMessages`의 where를 보인다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file. 없음이면 "없음". schema step을 고쳤으므로 개발 data(`.dev-data/`)를 지우고 새로 만든다는 것을 적는다
- 안 쓰게 된 export: 없음이면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것" 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
