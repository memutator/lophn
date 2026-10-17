# app-restart

앱 write가 도는 중에 core가 죽었다 켜지면 그 invocation은 `unknown`(`core_restarted`)이 되고, 앱 process는 새로 하나만 뜨며, 결과 모르는 write는 다시 보내지 않고, 기록 없는 write가 범위에 있는 rewind는 막힌다. `tests/e2e/app-restart_test.ts`.

- 단위: app-restart (wave 3)
- 선행: test-app
- 소유(이 task만 고친다):
  - `tests/e2e/app-restart_test.ts`
  - `tests/support/app/patch-restart.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/apps/invocations/`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 3절 `app-call-unknown`, `app-rewind-blocked-by-unknown`; `candidates-invariants.md` 후보 22(`app-restart-unknown`); `candidates-bugs.md` `app-invocation-restart`; `candidates-product.md` 후보 `restart-with-app`
  - architecture: `project-docs/architecture/app-call.md`("보냈는데 응답을 못 받은 호출은 결과 모름", "core가 다시 켜질 때 running으로 남은 invocation도 unknown", "결과 모름으로 닫혀 changeset이 없는 write가 범위에 있으면 rewind를 막는다"), `project-docs/architecture/activation.md`(두 process가 한 DB를 열면 안 된다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-runtime`, `app-data`, `storage`
  - 코드: `packages/core/apps/invocations/restart.ts`(`closeUnfinishedInvocations`), `packages/protocol/apps/calls/{invocation,rewind}.ts`(`rewindPlan`의 `blocked: {reason: "unrecoverable_write"}`), `packages/protocol/apps/runtime.ts`(`appRuntime`의 `observation.process_nonce`)
  - main의 `tests/support/core/{mod,process,human,try-boot}.ts`(`createRun`, `bootCore(run, {settings, env})`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`, `until`), `tests/support/app/`(`test-app`이 내놓는 `startTestApp`, `deliverRelease`, `approveActivation`, `waitRunning`, `activateTestApp`, `createAppSource`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human,try-boot}.ts`(`createRun`, `bootCore(run, {settings, env})`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`, `until`), `tests/support/app/`(`test-app`이 내놓는 `startTestApp`, `deliverRelease`, `approveActivation`, `waitRunning`, `activateTestApp`, `createAppSource`), `appCallApi`·`appInvocations`·`appRewindPlan`·`appRuntime`, `processesOf`, `bootCore(run, { env: await appCoreEnv() })`(`coding-role`의 `tests/support/coding/deps.ts`: `DENO_DIR=.dev-data/e2e/deno-dir`, `XDG_RUNTIME_DIR`).
  - 내놓는 것: `tests/support/app/patch-restart.ts`: `slowPatch(dir)`. write app-api `slow_write {title}`(row를 넣고 응답하지 않고 오래(예 600초) 기다린다)와 read app-api `count_slow`(row 수).

## 할 일

1. 시작 조건: `test-app`이 merge됐다.
2. case 하나(core를 두 번 띄운다. `bootCore`는 같은 run에 `env`를 같게 준다).

| 항목 | 내용 |
|---|---|
| route 순서 | `activateTestApp(patch)` → `appCallApi slow_write`를 await 없이 시작(promise의 거절은 잡는다. sanitizer 때문에 test 끝까지 안 풀린 요청이 남지 않아야 한다) → `appInvocations`에 running 항목이 보일 때까지 poll → `core.kill()` → `bootCore(같은 run, env)` → `appRuntime`이 새 `process_nonce`로 running일 때까지 poll → `appInvocations`·`appRewindPlan`·`count_slow` |
| fake 대답 | 앱 activation의 App Engineer 대답뿐이다. fake 대답은 README "정한 것" 11의 예외(앱 activation helper의 App Engineer 대답)다. test 머리 주석에 이유를 한 줄 적는다. |
| 단정 1 (ledger) | 그 invocation이 `unknown`이고 reason이 `core_restarted`다 |
| 단정 2 (route) | `appRewindPlan {from_invocation: 그 호출}`이 `blocked: {reason: "unrecoverable_write"}`이고 `count_slow`가 1이다(같은 write가 자동으로 다시 가지 않았다) |
| 단정 3 (process) | 앱 process가 하나뿐이고(예전 process는 없다. 앱 bundle 경로가 든 cmdline으로 센다) `process_nonce`가 앞과 다르다 |

   둘째 행 `app-process-killed`(`candidates-docs.md` 3절 `app-call-unknown`, `app-rewind-blocked-by-unknown`; app-call.md 110·119행):

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) |
|---|---|---|---|
| `app-process-killed` | `slow_write` 시작(await 없이) → running 항목이 보일 때까지 poll → 앱 process(앱 bundle 경로가 든 cmdline)를 `Deno.kill(pid, "SIGKILL")` → `appRuntime`이 새 `process_nonce`로 running일 때까지 poll → `appInvocations`·`appRewindPlan`·`count_slow` | 앱 activation의 대답뿐 | ledger: 그 invocation이 `unknown`이고 reason이 `connection_lost`나 `unavailable`이다(`APP_API_UNKNOWN_REASONS`에서 코드가 정한 값을 읽어 단정) / route: `appRewindPlan`이 `blocked: {reason: "unrecoverable_write"}`이고 `count_slow`가 1이다(다시 보내지 않았다) / process: 새 process가 하나 뜨고 core는 안 죽었다 |

   두 행은 core를 따로 띄운다(둘째 행이 첫 행의 재시작 뒤 상태에 기대지 않게 앱도 새로 activate한다. 시간이 두 배이므로 한 core·한 앱으로 합치고 순서(앱 process kill → core kill)로 돌려도 된다. 합치면 보고에 적는다).
3. `core.kill()`은 앱 supervisor와 앱 process까지 없어진 것을 확인한다(`bootCore`의 `kill` 계약). 거기서 "core가 child를 남긴다"로 실패하면 제품 bug다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `app-runtime`·`app-data`(재시작에 결과 모르는 write는 `unknown`으로 닫히고 다시 보내지 않으며 기록 없는 write는 rewind를 막는다), `storage`(두 process가 한 앱 DB를 열지 않는다).
- 현실적 회귀: 재시작 뒤 invocation이 `running`으로 남아 새 호출이 막히는 것, 모르는 write가 자동으로 다시 가서 두 번 쓰이는 것, 옛 앱 process가 남아 새 process와 한 DB를 여는 것(데이터 손상).
- 왜 지금 test가 못 잡나: `closeUnfinishedInvocations`는 unit으로 볼 수 있어도 core 재시작 ↔ supervisor ↔ 앱 process가 실제로 다시 뜨는 것과 두 process가 한 DB를 안 여는 것은 process를 건너야 한다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/app-restart_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/app-restart_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "core가 앱 write 도중 죽었다 켜져도 결과 모르는 호출은 다시 가지 않고 앱 process는 하나만 뜬다"

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
