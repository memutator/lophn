# rr-test-child

test runner(옛 `packages/core/problems/`)를 지운 뒤 그것만 쓰던 갈래를 지운다: 앱 runtime mode `"test"`, data job kind `"test"`, identity의 `test_runner_only`·`test_runner`, 메모리 상한 `applyMemoryLimit`과 core가 받는 env `DBUS_SESSION_BUS_ADDRESS`, 아무도 읽지 않는 team 등록의 `workers` 칸과 늘 빈 Map을 넘기는 wiring의 `Built.workers`. 켜는 곳이 없어 잃는 동작은 없다.

- 단위: test-child (wave 2)
- 선행: rr-reactor. rr-reactor가 `packages/core/storage/ledger/`(`team-module.ts` 포함)와 `packages/core/main/daemon/wiring/context.ts`를 고친다.
- 소유(이 task만 고친다):
  - `packages/protocol/apps/{channel-values.ts,activation/data-job.ts}`
  - `packages/protocol/apps/calls/rewind.ts`(66줄 주석만)
  - `packages/protocol/server/identity.ts`(51줄 주석만)
  - `packages/protocol/supervision/supervision.ts`(`MEMORY_LIMIT_MODES`, `memoryLimitModeSchema`, `MemoryLimitMode`만)
  - `packages/core/apps/runtime/entrypoint/{start-input.ts,wire.ts,state.ts,cap-host.ts,broker-client.ts}`
  - `packages/core/apps/invocations/{context.ts,schema.ts}`
  - `packages/core/apps/permissions/broker/{invocations.ts,access.ts,apps-call.ts}`
  - `packages/core/apps/preview/adapters/refusal.ts`(주석만)
  - `packages/core/apps/data/worker/job.ts`
  - `packages/core/server/identity/{model.ts,registry.ts,app-credential.ts}`
  - `packages/core/supervision/security/{memory-limit.ts,mod.ts}`
  - `packages/shell/main/desktop/core/supervise.ts`(`--allow-env` 한 줄만)
  - `packages/core/storage/ledger/team-module.ts`
  - `packages/core/main/daemon/{registration.ts,core.ts}`
  - `packages/core/main/daemon/wiring/context.ts`(`Built.workers`만)
  - `packages/core/lophn-agent/register.ts`(`workers: []` 한 줄만)
- 읽을 것:
  - 계획: `project-docs/plan/reactor-remove/README.md`의 "목표"(ae-builds가 남긴 것)와 "정한 것"(test 자식의 죽은 갈래를 지운다)
  - 이슈: `project-docs/issues/code-health.md`의 "test runner를 지운 뒤 test 자식의 갈래가 남았다". 정한 것: 지운다. runtime mode는 `"live" | "preview"`만 남고, `XDG_RUNTIME_DIR`은 앱 socket 폴더가 쓰므로 둔다. 이 task로 닫힌다(lead가 `issue` skill로 닫는다).
  - 앞 계획: `project-docs/products/change-log/0.6.0.md`의 "App Engineer가 앱을 직접 짓고, ticket과 test runner를 지운다". "없어진 것"(test runner `packages/core/problems/` 전부, runner worker)과 "결정"(앱 test는 App Engineer가 앱 source에서 돌린다)
  - architecture: `project-docs/architecture/app-call.md`("지키는 것"의 preview는 따로 띄운 process, live 자식만 바깥에 닿는다), `project-docs/architecture/activation.md`(data job). 이 task로 틀리는 곳은 없다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-runtime`, `app-data`, `server`, `supervision`, `storage`, `sdk-api`, `app-capability`; `project-docs/module-catalog.yaml`의 `packages/core/apps`, `packages/core/server`, `packages/core/supervision`, `packages/core/storage`, `packages/core/main`, `packages/sdk`, `packages/shell/main`, `packages/protocol`
  - 코드(줄은 main `15f282fcd`. `083e55064`까지 코드는 같다. 이 task는 rr-reactor 뒤라 `team-module.ts`와 `wiring/context.ts`의 줄은 이름으로 찾는다)
    - runtime mode: `packages/protocol/apps/channel-values.ts` 29-31(`runtimeModeSchema`와 "test는 problems runner가 …" 주석). `ChannelMode`와 `app-start.ts`·`broker.ts`·`calls/broker.ts`·`calls/invocation.ts`·`calls/process-wire.ts`의 `mode`는 이 schema를 따른다.
    - 앱 process는 Zod를 싣지 않아 같은 판정을 손으로 한다(`wire.ts` 1-2 주석): `packages/core/apps/runtime/entrypoint/start-input.ts` 13·51-54, `wire.ts` 15·103-106, `state.ts` 10, `cap-host.ts` 69, `broker-client.ts` 19
    - `packages/core/apps/invocations/context.ts` 19, `schema.ts` 35(step `apps.invocations.tables`의 `mode` CHECK), `packages/core/apps/permissions/broker/invocations.ts` 4·6(`BrokerChild`)
    - SDK(고치지 않는다): `packages/sdk/{cap-net,cap-secret,cap-store}/host.ts`의 `RuntimeMode`와 `packages/sdk/cap-tool/context.ts` 18의 `"test"`는 앱 자신의 test가 넘기는 값이라 남는다(할 일 1의 정한 것).
    - 주석 "preview·test": `packages/core/apps/permissions/broker/access.ts` 44, `apps-call.ts` 34, `packages/core/apps/preview/adapters/refusal.ts` 1·21, `packages/core/server/identity/app-credential.ts` 71, `registry.ts` 177, `packages/protocol/server/identity.ts` 51, `packages/protocol/apps/calls/rewind.ts` 66
    - data job: `packages/protocol/apps/activation/data-job.ts` 11-17(`ACTIVATION_DATA_JOB_KINDS`), `packages/core/apps/data/worker/job.ts` 235-243(마지막 갈래 `invalid("test jobs are not data changes")`)
    - identity: `packages/core/server/identity/model.ts` 13(`OperationPolicy.test_runner_only`), 70-82(`operationCeiling`의 `testRunner`); `registry.ts` 42(`test_runner`), 152-155, 164, 213-218(`operationCeiling`의 셋째 인자). `test_runner_only`를 단 policy는 없다(`git grep -n test_runner_only`가 정의와 판정뿐이다).
    - 메모리 상한: `packages/core/supervision/security/memory-limit.ts`(전체. 부르는 곳이 없다), `mod.ts` 2. `MemoryLimitMode`(`packages/protocol/supervision/supervision.ts` 434-436)는 이 file만 쓴다. `DBUS_SESSION_BUS_ADDRESS`는 이 file의 `probeEnv`(38)만 읽고, shell main이 core에 `--allow-env`로 준다(`packages/shell/main/desktop/core/supervise.ts` 58).
    - `XDG_RUNTIME_DIR`은 남는다: `packages/core/apps/control.ts` 878·922, `packages/core/main/app-supervisor/main.ts` 71, `packages/core/main/daemon/wiring/supervision.ts` 46-47
    - `workers`: 이슈는 core.ts가 team 등록의 `workers`를 빈 Map으로 모은다고 적었지만 둘은 다른 칸이고 둘 다 죽었다.
      - team 등록의 `workers?: readonly KindLaunchSpec[]`: `packages/core/storage/ledger/team-module.ts` 36(import 15), `packages/core/main/daemon/registration.ts` 10(import)·25·38·84(주석의 "worker kind")·98·105·194-198. 채우는 곳은 `packages/core/lophn-agent/register.ts` 813의 `workers: []`뿐이고 `Assembled.workers`를 읽는 곳이 없다.
      - wiring의 `Built.workers`(`packages/core/main/daemon/wiring/context.ts` 132): 내는 wiring이 없다. `packages/core/main/daemon/core.ts` 296-298이 이것을 모아 늘 빈 Map을 `startApiServer`의 `workers`로 넘긴다.
- 계약:
  - 쓰는 것: `runtimeModeSchema`(`packages/protocol/apps/channel-values.ts`), cap-host port(`packages/sdk/*/host.ts`, `packages/core/apps/runtime/entrypoint/cap-host.ts`)
  - 내놓는 것: runtime mode는 `"live" | "preview"`다(protocol, 앱 process 판정, invocation 표). SDK host와 `cap-tool` context는 `"test"`도 그대로 받는다(앱 자신의 test). data job kind는 `inspect`, `backup`, `migrate`, `restore`다. `OperationPolicy`에 `test_runner_only`가 없고 credential 발급 입력에 `test_runner`가 없다. `packages/core/supervision/security/mod.ts`는 `checkLaunchSpec`, `launchArgv`만 낸다. team 등록(`TeamModule`, `Assembled`)과 wiring `Built`에 `workers`가 없다.

## 할 일

근거: 이슈의 정한 것(지운다. 잃는 기능이 없는 죽은 코드다. AGENTS.md "속도", "죽은 코드는 지운다"). 지우는 이름마다 먼저 `git grep -nw`로 읽는 곳을 본다. 읽는 곳이 check 밖(`tests/e2e`, `tests/eval`, `tools/check.ts`의 `NOT_CHECKED`)에만 남으면 고치지 말고 보고에 적는다.

1. runtime mode `"test"`
   - `channel-values.ts`: `runtimeModeSchema`를 `z.enum(["live", "preview"])`로 한다. 29-30줄 주석("test는 problems runner가 …", "화면 틀은 live·preview만 쓴다")을 지운다.
   - 앱 process 판정: `start-input.ts`, `wire.ts`의 type과 판정에서 `"test"`를 뺀다. `state.ts`, `cap-host.ts`, `broker-client.ts`의 type도 같다.
   - `invocations/context.ts`, `permissions/broker/invocations.ts`의 type에서 뺀다.
   - `invocations/schema.ts`: `mode` CHECK를 `('live', 'preview')`로 한다. step `apps.invocations.tables`를 그 자리에서 고친다. migration을 만들지 않는다. step hash가 바뀌어 옛 개발 data root는 뜨지 않으니 지우고 새로 만든다(AGENTS.md "호환성").
   - SDK는 고치지 않는다.
     - 정한 것(planner): `packages/sdk/{cap-net,cap-secret,cap-store}/host.ts`의 `RuntimeMode`와 `cap-tool/context.ts`의 `mode`는 `"test"`를 그대로 받는다. 앱이 자기 `deno task test`에서 `openStore({ host: { mode: "test", dataPath } })`로 임시 DB를 여는 길이고(`tests/support/app/sample/tests/items_test.ts.tmpl` 29, eval materials의 앱 test가 이렇게 쓴다), App Engineer가 이제 앱 test를 직접 쓰고 돌린다. lophn runtime이 그 값을 쓰지 않는 것과 별개로 SDK의 공개 입력이다. cap-host port는 runtime이 `live`·`preview`만 넣고 SDK가 셋을 받는 꼴이 된다.
     - SDK의 stand-in 설명("preview·test의 대역": `packages/sdk/cap-secret/secret.ts` 62, `packages/sdk/cap-secret/guide.md` 27, `packages/sdk/cap-store/guide.md` 25의 "개발·test·preview")도 그대로다.
   - 위 "preview·test" 주석 일곱 file에서 `test`를 뺀다. `access.ts` 44의 "준비 모드"는 activation의 후보 process라 남는다.
2. data job kind `"test"`: `data-job.ts`의 `ACTIVATION_DATA_JOB_KINDS`에서 뺀다. `job.ts`의 마지막 갈래(241-243)는 `runRestore`가 되고 `invalid("test jobs are not data changes")`가 없어진다.
3. identity: `OperationPolicy.test_runner_only`, `operationCeiling`의 `testRunner` 인자와 그 판정, `CredentialRegistry` 발급 입력의 `test_runner` 칸과 검사(152-155), user 판정의 `input.test_runner ||`(164), `operationCeiling` 부르기의 셋째 인자(217)를 지운다. `test_runner_only`를 단 policy가 없으니 ceiling은 그대로다.
4. 메모리 상한
   - `packages/core/supervision/security/memory-limit.ts`를 지우고 `mod.ts` 2줄 export를 뺀다. `MEMORY_LIMIT_MODES`, `memoryLimitModeSchema`, `MemoryLimitMode`(`supervision.ts` 434-436)를 지운다(이 file만 썼다).
   - `supervise.ts` 58: `--allow-env`에서 `DBUS_SESSION_BUS_ADDRESS`를 뺀다. `XDG_RUNTIME_DIR`은 둔다(위 "남는다").
5. `workers`
   - team 등록: `team-module.ts`의 `workers` 칸과 안 쓰게 된 `KindLaunchSpec` import, `registration.ts`의 `Loose.workers`, `Assembled.workers`, 초기값, `workers` Set, 모으는 loop, import, 84줄 주석의 "·worker kind"를 지운다. `register.ts` 813의 `workers: []`를 지운다.
   - wiring: `Built.workers`(`context.ts` 132)와 `core.ts` 296-298의 `workers` 인자를 지운다. `startApiServer`는 `workers` 없이 불린다. 동작은 같다: `deps.workers`가 지금도 빈 Map이라 worker route는 `unavailable`이다(`packages/core/server/dispatch.ts` 633-636).
   - 범위 밖: API server의 worker route 통로(`packages/core/server/server.ts` 56의 `ApiServerOptions.workers`, 96-98, `adaptedWorkers` 363-376, `dispatch.ts`의 worker 갈래와 file route의 worker 넘김 551-555, `WorkerRoute`·`defineWorker`, 늘 `unavailable`인 `packages.guide` route `packages/protocol/apps/package-routes.ts` 205). 이 task 뒤 `workers`를 넘기는 곳이 없어지지만 route 종류 정리는 이슈 밖이다. 고치지 말고 보고에 적는다.
6. 아래 "남지 않음"을 돌려 주석과 오류 글에 남은 것을 고친다.

## 끝남

- `deno task check`가 통과한다(shell main은 check가 `npm --prefix packages/shell/main run check`로 본다).
- core가 뜬다: `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다(바뀐 schema step `apps.invocations.tables`가 새 data root에서 돈다).
- 위험 test: 없음. 켜는 곳이 없는 갈래를 지운다. `test_runner_only`를 단 policy가 없어 권한 ceiling이 그대로이고, identity의 권한 판정 test(`packages/core/server/identity/registry_test.ts`)는 지우지 않는다.
- 남지 않음
  - `git grep -n -E "\"preview\" \| \"test\"|\"preview\", \"test\"|mode (===|!==) \"test\"|'preview', 'test'|^\s*\"test\",$" -- packages tools tests/support ':!packages/sdk'`가 0줄이다.
  - `git grep -n -E "test_runner|testRunner|applyMemoryLimit|memory-limit|MemoryLimitMode|memoryLimitModeSchema|MEMORY_LIMIT_MODES|DBUS_SESSION_BUS_ADDRESS|test jobs" -- packages tools tests/support`가 0줄이다.
  - `git grep -n "preview·test" -- packages`가 `packages/sdk/cap-secret/secret.ts`, `packages/sdk/cap-secret/guide.md`뿐이다(SDK stand-in 설명).
  - `git grep -nw "workers" -- packages/core/main packages/core/storage packages/core/lophn-agent/register.ts`가 0줄이다.
  - `git grep -n "XDG_RUNTIME_DIR" -- packages/shell/main/desktop/core/supervise.ts`가 1줄이다(남는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없으면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다). 예: `ApiServerOptions.workers`와 `adaptedWorkers`, `forwardToWorker`가 이 task 뒤 부르는 곳이 있는지
- check 밖에 남은 것: `tests/e2e`, `tests/eval`, check 밖 `tests/support`에서 지운 것을 쓰는 file 목록. main `15f282fcd`에서 본 것: `openStore({ host: { mode: "test", … } })`를 쓰는 `tests/support/app/sample/tests/items_test.ts.tmpl` 29, `tests/eval/materials/{calendar-app,calendar-app-bug}/{1,2}/files/source/tests/events_test.ts.tmpl` 54, `tests/eval/materials/notify-app/{1,2}/files/source/tests/reminders_test.ts.tmpl` 22, `tests/eval/registry/template/app.json`; mode `"test"`를 말하는 주석 `tests/support/app/patch-net.ts` 8-9, `patch-restart.ts` 2; systemd-run을 말하는 `tests/support/coding/deps.ts` 23-27
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
