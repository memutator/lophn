# activation-restart

`app-activation`이 찾은 제품 문제 셋을 고치고, 그 test가 문제를 비켜 가려고 둔 기다림(`quiet()`)을 지운다.

1. **activation이 `active`가 된 뒤 0.2~0.4초 안에 앱 process가 새 nonce로 한 번 더 뜬다**(`running` → `unavailable` → `running`). 그 사이에 다음 release의 coding session을 열면 CLI의 `ticket show`·`release status`가 `unauthorized: credential unavailable`이다. `tests/e2e/app-activation_test.ts`는 `deliver`마다 `quiet()`(앱 nonce가 1.5초 그대로일 때까지)로 기다려 이것을 가렸다. 의심: 활성화 뒤 reconcile이 다시 띄우는 곳(`packages/core/apps/releases/activation/assembly.ts`의 `reconcileOne`), 앱 재시작이 그 앱의 credential을 회수할 때 coding token까지 같이 지우는 곳.
2. **`activationsQueue`의 `held_calls`가 늘 0이다.** `assembly.ts`의 `late.heldCalls`를 채우는 쪽이 없고 앱 호출 intake에 붙잡은 수를 읽는 길이 없다. 그래서 `holds-calls` 행이 `held_calls >= 1`을 단정하지 못했다.
3. **`invocations.get`·`invocations.list`를 사람이 부르면 `not_found: route not found`다.** protocol에 정의되어 있고(`packages/protocol/apps/invocations.ts`, actors에 user), reader 등록(`packages/core/apps/register.ts`의 `createReaderRegistration`)에도 있다. collector와 agent runtime은 이 operation을 credential scope에 둔다.

- 단위: fix (wave 3)
- 선행: app-activation
- 소유(이 task만 고친다):
  - `tests/e2e/app-activation_test.ts`
  - `packages/core/apps/releases/activation/`
  - `packages/core/apps/runtime/`
  - `packages/core/apps/calls/`
  - `packages/core/apps/register.ts`
- 추가 소유(원인이 거기 있을 때만. 그 밖이 필요하면 먼저 보고한다):
  - `packages/core/server/identity/`
  - `packages/core/main/app-supervisor/`
  - `packages/core/main/daemon/wiring/apps.ts`
- 읽을 것:
  - `project-docs/architecture/activation.md`(순서와 실패 복구, 붙잡은 호출), `project-docs/architecture/app-call.md`, `project-docs/architecture/coding-agent.md`(coding token은 session마다, 언제 회수되나)
  - `tests/e2e/app-activation_test.ts`의 `quiet`, `holds-calls` 행, `appProcesses`
  - `packages/core/apps/releases/activation/{assembly,orchestrator,queue}.ts`, `packages/core/apps/calls/intake.ts`, `packages/core/server/dispatch.ts`(route를 못 찾는 곳), `packages/core/server/identity/`
- 계약: 쓰는 것 `activationsQueue`의 `held_calls`(protocol), `invocationsGet`·`invocationsList`. 내놓는 것 없음.

## 정한 것

- activation은 새 process를 준비 모드로 띄워 확인하고, complete가 commit된 뒤 그 process의 업무 통로를 연다(`activation.md` 순서 5와 "새 process는 준비 모드로 확인까지만"). 그러니 확정 뒤에 앱이 다시 뜰 이유가 문서에는 없다. 두 번째 시작이 필요 없는 것이면 없앤다. 필요한 것이면(예: 확정 뒤 운영 slot으로 옮기기) 그 재시작이 coding token을 지우지 않게 한다. 어느 쪽인지 보고에 적는다.
- coding token은 그 coding session이 끝나거나 cancel될 때만 회수된다(`coding-agent.md`). 앱 process 재시작은 coding session과 상관없다.
- `invocations.*`가 사람에게 안 보여야 하는 것이면 protocol의 actors에서 user를 빼는 것이 아니라 먼저 보고한다(제품 동작).

## 할 일

1. 고치기 전 실패: `quiet()`을 지운 `app-activation_test.ts`가 실패하는 출력 한 줄, `held_calls`를 `>= 1`로 단정한 `holds-calls`가 실패하는 출력 한 줄, `invocationsGet`(user)이 `not_found`인 출력 한 줄을 적는다.
2. 셋을 고친다. 2는 붙잡은 호출 수를 intake에서 읽어 `late.heldCalls`로 잇는다. 3은 route가 왜 등록되지 않는지 찾아 잇는다.
3. `quiet()`을 지우고, `holds-calls`가 `held_calls >= 1`을 단정하게 하고(지금 쓰는 `appRewindPlan`의 release 단정은 그대로 둬도 된다), 가능하면 `invocationsGet`으로 그 invocation을 읽는다. 단정 수 상한(3)을 지킨다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다.

## 끝남

- `deno task check:full`, core 기동 두 번이 통과한다.
- `tests/e2e/app-activation_test.ts`(quiet 없이) 10번 연속 통과. `tests/e2e/app-release_test.ts`, `tests/e2e/coding_test.ts` 한 번씩.
- 위험 test: "activation 하나에 앱 process는 한 번 뜨고, 그 뒤 연 coding session의 token이 살아 있다"

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 찾은 제품 bug: 증상, 재현하는 행, 의심 file. 고쳤으면 "고치기 전 코드에서 그 행이 실패한 것"의 출력 한 줄
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
