# app-calls-path

core 호출 경로 서비스를 새로 짓는다. 모든 app-api 호출(앱 화면의 사람, agent, 다른 앱)이 이 서비스 하나를 지난다: 부른 쪽 확인, project 정하기, Gate, invocation 기록, 앱마다 write 줄 세우기, 앱 process 전달, 결과. activation과 rewind가 같이 쓰는 drain(`AppIntake`)도 여기서 짓는다. 고정된 port와 가짜 구현으로 짓고 다른 task의 구현을 기다리지 않는다.

- 단위: app-calls (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/calls/` (새 폴더)
- 읽을 것:
  - spec: S5 2·4·5·6장(write 줄 세우기)·7장 4(drain) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`
  - spec: S2 5장(Gate를 부르는 곳) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`, S7 7장 2~3(drain) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/activation.md`
  - inventory(`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`): `I3.5#1`, `I3.5#2`, `I3.5#3`, `I3.5#4`, `I3.5#5`, `I3.5#12`(호출 경로 쪽), `I2.7#9`(접수 닫기·붙잡기 쪽), `I2.5#18`(이름)
  - 결정: `/home/pyosechang/projects/lophn/project-docs/plan/README.md` 3장 #3, #7, #18
  - 지금 코드(참고만): `packages/core/apps/connections/{origin,resolve}.ts`(옛 path 기록과 범위 계산), `packages/core/apps/runtime/entrypoint/invoke.ts`(옛 호출 한 건의 순서), `packages/core/apps/runtime/supervisor/supervisor.ts`(`accepting`)
- 계약:
  - 쓰는 것: `core/apps/ports.ts`의 `AppApiCallPath`(내놓는다), `AppIntake`(내놓는다), `CallerDirectory`, `ProjectDirectory`, `AppApiLookup`, `InvocationLedger`, `AppProcessLink`, contract-approvals의 `core/approvals/ports.ts`의 `Approvals`(`judge`, `openTurnRequest`, `waitTurnDecision`, `consumeTurnAllow`)와 `protocol/approvals`의 `Intent`·`GateVerdict`. `protocol/apps/calls`의 `AppApiCallInput`·`AppApiCallOutput`·`AppApiCaller`·`ProcessCallRequest`·`APP_API_DENIAL_CODES`. 호출 깊이 상수 `APP_CALL_DEPTH_LIMIT`(8, `protocol/apps/channel-values.ts`). `packages/base`의 `Clock`·`IdSource`.
  - 내놓는 것: `createAppCalls(deps): {path: AppApiCallPath; intake: AppIntake}` (`core/apps/calls/mod.ts`). app-calls-assembly가 route handler에 잇고, app-calls-rewind와 releases-problems(activation)가 `intake`를 쓴다.

## 할 일

모두 `packages/core/apps/calls/` 안의 새 file이다. 각 file은 순수 판정(`model` 모양)과 IO를 나눈다. 부르는 바깥은 모두 `deps`로 받는다.

1. `caller.ts` — 부른 쪽 확인 (`I3.5#2`, S5 4장 1)
   - route actor와 `caller.kind`가 맞아야 한다: user ↔ `person`, agent ↔ `agent`, app ↔ `app`. 어긋나면 `forbidden`.
   - `person`: user credential을 믿는다. 앱·release·mode·project는 shell main이 view에서 정해 보낸 것이다.
   - `agent`: `CallerDirectory.agentToolCall(session, turn, tool_call)`이 null이면 `forbidden`. 돌려준 `agent`와 `place`를 뒷단계(Gate, project)가 쓴다.
   - `app`: `auth.app === caller.app`이어야 하고, `caller.release`가 그 앱의 지금 활성 release여야 한다. `parent_invocation`은 이 서비스가 지금 돌리고 있는 invocation(읽기 포함, 메모리 표)이어야 한다. 모르는 id나 이미 끝난 id는 `forbidden`이다. 본문 주장을 믿지 않는다.
2. `project.ts` — project 정하기 (`I3.5#3`, S5 4장 2)
   - `AppApiLookup.find`의 `project_scope`가 false면 project는 null이다. 입력에 project가 있으면 `project_mismatch`로 거절한다(범위 아닌 app-api에 project를 주었다).
   - 범위 app-api: person은 입력 project가 있어야 한다(없으면 `project_required`). agent는 place가 `project`이면 그 project이고 입력 project가 있어 다르면 `project_mismatch`, place가 `app`·`lophn`이면 입력 project가 필요하다. app은 부른 invocation의 project를 그대로 넘기고, 없으면 `project_required`. 정해진 project가 `ProjectDirectory.get`에 없으면 `project_not_found`.
3. `loop.ts` — 호출 루프와 깊이 (`I3.5#4`, `I2.5#20`)
   - 부모 invocation 사슬(메모리 표의 `parent`를 따라 올라간 앱 목록)에 대상 앱이 이미 있으면 `call_loop`, 사슬 길이가 `APP_CALL_DEPTH_LIMIT`에 닿으면 `call_too_deep`. handler 전에 거절한다. 순수 함수로 둔다.
4. `queue.ts` — 앱마다 write 줄 세우기 (`I3.5#5`, S5 6장)
   - write와 external은 앱마다 한 번에 하나씩 돈다. read는 줄을 서지 않고 동시에 돈다. 앞 호출이 끝나면(성공·실패·결과 모름 모두) 다음 호출이 시작된다. 기다리는 동안 부른 쪽이 끊기면 줄에서 뺀다. 앱 정지·끊김으로 `AppIntake.abandon`이 불리면 줄을 정리한다.
5. `intake.ts` — `AppIntake` 구현 (`I3.5#12`, `I2.7#9`, S5 7장 4)
   - `close(app, reason)` 뒤 들어온 호출은 실패시키지 않고 붙잡는다. `open(app)`이 붙잡은 호출을 들어온 순서로 넘기고, 넘길 때 대상 release는 그때의 활성 release로 다시 정한다. `whenIdle(app, graceMs)`는 도는 호출(읽기 포함)이 모두 끝나면 `{idle: true}`, 유예가 지나면 남은 invocation 목록과 `{idle: false}`. `abandon(app)`은 남은 호출을 결과 모름으로 닫아 부른 쪽에 돌려준다.
6. `service.ts` — `createAppCalls(deps)` (`I3.5#1`, S5 4장 순서 1~7)
   - 순서: 부른 쪽 확인 → 접수 닫힘이면 붙잡기 → 대상 선언 찾기(`AppApiLookup.find`: 없으면 `not_declared`, 앱이 보관됐으면 `app_archived`, 앱이 멈췄으면 `app_unavailable`) → project 정하기 → 호출 루프 → Gate(agent와 app만. person은 거치지 않는다. `Approvals.judge(intent)`가 `deny`면 `denied(gate_blocked)`, `ask`면 `openTurnRequest` → `waitTurnDecision`(reject는 `denied(rejected)`, cancelled는 `denied(cancelled)`)이고 허락이면 실행 직전 `consumeTurnAllow`를 부른다. 막음·거절·cancelled는 `denied` outcome으로 돌려주고 `InvocationLedger.recordOnce`로 `denied` 기록을 남긴다. intent는 `{kind: "app_api", actor, target: {app, api}, effect, input, origin}`이고 agent는 origin이 turn이다) → 효과별 실행.
   - 읽기: 줄 없이 바로 `AppProcessLink.call`. 성공이면 기록을 남기지 않고 `invocation: null`로 돌려준다(S5 5장). 실패이면 `recordOnce`로 한 번에 남긴다.
   - write·external: 줄에서 차례가 오면 `InvocationLedger.begin`(`running`) → `AppProcessLink.call` → `finish`. 응답의 `changeset`(base64)을 풀어 `finish`에 넘긴다. 실패 응답에도 changeset이 있으면 같이 넘긴다.
   - 응답 처리: `sent: false`는 `denied`(`app_unavailable`)로 돌려주고 시작한 기록이 있으면 `failed`로 닫는다. `sent: true`에 `response: null`이면 `finish`를 `unknown`으로 닫고 `unknown` outcome(`connection_lost`)을 돌려준다.
   - invocation id는 `IdSource`로 이 서비스가 만든다. 읽기도 앱 process에 보내는 id가 있어야 하고 부모 사슬 표에 들어간다.
   - `input_hash`는 `canonicalJson(input)`의 sha256이다(default 적용 전의 입력. 앱 process가 blueprint 기준으로 다시 검사한다). `summary`는 입출력 본문이 아니라 `{outcome, error_code?}` 정도의 작은 JSON이다.
7. `mod.ts`에서 `createAppCalls`와 `deps` type만 내보낸다.
8. 위험 test 한 file `calls_test.ts` (가짜 `InvocationLedger`·`AppProcessLink`·`Approvals`·`CallerDirectory`·`ProjectDirectory`·`AppApiLookup`를 file 안에서 만든다)
   - 한 번 만든 fake로 표를 돌린다. 시계와 timer를 직접 만들지 않고 `Clock`을 주입한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`packages/core/apps/calls/calls_test.ts`, 세 개 안팎):
  - "부른 쪽 종류가 credential과 다르거나 모르는 부모 invocation을 주장하면 handler까지 가지 않는다"
  - "write는 앱마다 한 번에 하나씩 돌고 read는 동시에 돈다"
  - "호출 루프와 깊이 8 초과는 handler 전에 거절되고, 접수를 닫은 동안 온 호출은 실패하지 않고 붙잡혔다가 열리면 넘어간다"
- 남지 않음: `grep -rniE "confirm|revert|automat|\bcommand\b" packages/core/apps/calls`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: core 조립에서 `createAppCalls`를 부르는 곳(app-calls-assembly가 잇는다). 새 deps 중 lead가 조립해야 하는 것(`CallerDirectory`, `ProjectDirectory`, `Approvals`, `AppProcessLink`의 실제 구현)
- 안 쓰게 된 export: 없음 (`connections/origin.ts`·`resolve.ts`는 app-calls-assembly가 지운다)
- 정한 것: 범위 아닌 app-api에 project를 주면 거절한 것, `denied`를 invocation으로 남기는 것, `input_hash`를 default 적용 전 입력으로 잡은 것, 부모 사슬을 메모리 표로 확인하는 것(core 재시작 뒤에는 모르는 부모가 되어 forbidden)
- 계약 바꾸기 요청(wave 3): port 모양이 모자란 곳
