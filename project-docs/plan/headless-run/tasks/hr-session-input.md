# hr-session-input

approval-simplify가 land한 뒤의 unattended 전파 위에서, `SendMessage`가 받은 unattended 표시를 Router 입력(call 봉투)에 실어 그 메시지가 연 turn을 unattended로 연다. 켤 때 입력함에 되돌리는 사람 메시지에서 unattended 메시지를 빼, 실패로 닫힌 run의 입력이 attended turn으로 다시 돌지 않게 한다.

- 단위: session (wave 2)
- 선행: hr-contract-runs.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/session/message-commands.ts`
  - `packages/core/lophn-agent/session/message-commands_test.ts`
  - `packages/core/lophn-agent/session/model.ts`
- 읽을 것:
  - 계약: `project-docs/plan/headless-run/tasks/hr-contract-runs.md`의 `inputs.ts` 줄과 "끝"을 정하는 규칙의 "켤 때 running인 run" 줄
  - 제품 결정: `project-docs/plan/headless-run/README.md`의 "이 계획에서 더 정한 것"(run의 turn은 unattended다)과 "뼈대 검토에서 정한 것"(run 입력은 켤 때 다시 줄 세우지 않는다). roadmap `project-docs/products/roadmap/approval.md`의 "turn mode"(unattended는 call을 따라 간다)
  - architecture: `project-docs/architecture/place-session.md` "지키는 것"의 "lophn이 꺼졌다 켜져도" 줄(켤 때 turn이 가져가지 않은 사람 메시지를 입력함에 다시 넣는다. 이 task가 거기서 run 입력을 뺀다), `project-docs/architecture/agent-call.md`("입력함은 메모리라 꺼지면 사라진다"), approval-simplify가 고친 `project-docs/architecture/agent-call.md`의 봉투 mode 줄(앞 계획 land 뒤 path 확인)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-sessions`, `router`; `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - 코드
    - `packages/core/lophn-agent/session/message-commands.ts`(`sendWith`, `writeHuman`, `MessageRouter`, `unstartedHumanMessages`)
    - `packages/core/lophn-agent/session/model.ts`(`conversationSchemaSteps`의 `messages` 표와 `messages_content_immutable` trigger)
    - `packages/core/main/daemon/wiring/router.ts`의 `start`(켤 때 `unstartedHumanMessages`로 입력함에 되돌린다. 이 task는 고치지 않는다)
    - approval-simplify가 Router 입력(call 봉투)과 `RoutedInput`에 둔 unattended 칸, 그 칸으로 turn mode를 정하는 곳, 그 계획의 test(봉투에 표시를 직접 넣어 본다)(앞 계획 land 뒤 path 확인)
    - `packages/core/lophn-agent/session/message-commands_test.ts`(지금 test의 준비 꼴)
- 계약:
  - 쓰는 것: hr-contract-runs의 `sendMessage` 입력 칸 `unattended`, approval-simplify가 Router 입력(call 봉투)에 둔 unattended 칸과 그 전파
  - 내놓는 것(hr-runs-wiring이 기댄다):
    - `SendMessage { …, unattended: true }`로 넣은 메시지가 연 turn은 unattended다. 칸이 없는 사람 메시지는 지금처럼 attended다.
    - 그 메시지의 `messages` 행에 표시가 남는다(approval-simplify가 이미 남기면 그 칸을 쓴다). `unstartedHumanMessages`는 표시가 있는 메시지를 내지 않는다. 그 run은 hr-runs-wiring이 켤 때 `lophn_restarted`로 닫는다.

## 할 일

근거는 README "뼈대 검토에서 정한 것"의 "run 입력은 켤 때 다시 줄 세우지 않는다"와 `approval.md` "turn mode"다. 앞 계획 land 뒤 path 확인: approval-simplify가 Router 입력과 `messages` 행에 둔 칸 이름(아래 `unattended`)은 그 계획이 정한 이름을 쓴다.

1. `packages/core/lophn-agent/session/model.ts`: `conversationSchemaSteps`의 `messages` 표에 `unattended integer not null default 0 check (unattended in (0, 1))`와 표 check `(unattended = 0 or from_kind = 'human')`을 더하고, `messages_content_immutable` trigger의 열 목록에 `unattended`를 더한다.
   - 같은 schema step(`lophn-agent.sessions.tables`)을 고친다. 새 step, migration, 옛 행 읽기를 만들지 않는다. 개발 data는 지우고 새로 만든다(AGENTS.md "호환성").
   - approval-simplify가 `messages` 행에 같은 뜻의 칸을 이미 두었으면 이 단계는 하지 않고 그 칸을 쓴다.
   - 다른 insert(`packages/core/lophn-agent/places/messages.ts`, `packages/core/lophn-agent/session/fork.ts`, `recordAgent`)는 열을 적어 넣으므로 기본값 0으로 그대로 된다. 고치지 않는다.
2. `packages/core/lophn-agent/session/message-commands.ts`
   1. `HumanMessage`에 `unattended: boolean`을 더하고 `writeHuman`의 insert에 싣는다.
   2. `sendWith`에서 `const unattended = input.unattended === true`를 `writeHuman`과 `deps.router.route(...)`에 싣는다. `MessageRouter`의 route 입력 type에 approval-simplify가 Router 입력에 둔 unattended 칸을 더한다(그 계획이 이미 required로 두었으면 지금 넘기던 값을 이 값으로 바꾼다). 칸이 없는 사람 메시지는 지금처럼 attended다.
   3. `unstartedHumanMessages`의 where에 `and m.unattended = 0`을 더하고, 머리 주석에 이유를 한 줄 더한다: unattended 메시지는 run의 입력이고, 켤 때 다시 돌면 이미 실패로 닫힌 run 뒤에 attended turn이 생겨 바깥 효과가 두 번 난다.
   - 같은 id의 재전송 비교(`writeHuman`의 `existing`)는 그대로 둔다.
   - 정한 것: unattended 메시지의 `delivery`는 따로 막지 않는다. 이유: run(hr-runs-wiring)은 늘 `next_turn`으로 넣는다. 막을 다른 입구가 없다.
3. `packages/core/main/daemon/wiring/router.ts`(켤 때 되돌리기)는 고치지 않는다. `unstartedHumanMessages`가 빼므로 되돌리는 쪽은 바뀌지 않는다.
4. test: `packages/core/lophn-agent/session/message-commands_test.ts`에 아래 위험 test를 새 `Deno.test` 하나로 더한다. 지금 test의 DB 준비(`conversationSchemaSteps`, `revertSchemaSteps`, `sql`, `session`, `message`)를 file 안 작은 helper로 나눠 같이 쓴다. 열린 session 하나에 turn이 가져가지 않은 사람 메시지 둘(하나는 `unattended = 1`)을 넣고 `unstartedHumanMessages(sql)`의 id가 attended 메시지 하나뿐인지 본다. 지금 test는 이름과 판정을 바꾸지 않는다.
   - turn mode가 unattended로 열리는지는 approval-simplify의 test(봉투에 표시를 직접 넣어 본다)가 본다. 여기서 다시 보지 않는다(`write-test` "이미 다른 test가 보는 동작").

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
- 정한 것: 문서에 답이 없어 worker가 정한 것(approval-simplify의 칸 이름과 위 "정한 것" 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
