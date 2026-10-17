# app-sandbox

활성 앱 process는 선언 밖의 파일 읽기·쓰기와 network를 못 한다. 정상 api는 계속 된다. `tests/e2e/app-sandbox_test.ts`.

- 단위: app-sandbox (wave 3)
- 선행: test-app
- 소유(이 task만 고친다):
  - `tests/e2e/app-sandbox_test.ts`
  - `tests/support/app/patch-sandbox.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/apps/permissions/`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-invariants.md` 후보 23(`app-process-denied`); `candidates-product.md` 후보 `app-sandbox-denies`
  - architecture: `project-docs/architecture/activation.md`("앱 process의 실제 권한은 선언과 active 앱 grant의 교집합으로 만든 flag다. 앱 code가 선언을 어겨도 flag 밖은 열리지 않는다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-runtime`, `app-spi`, `app-capability`
  - 코드: `packages/core/apps/permissions/`(flag 계산. `sandbox-boundary_test.ts`는 subprocess 한 번만 본다), `packages/protocol/apps/calls/call.ts`(`appCallApi`: user가 부른다), `packages/core/apps/runtime/entrypoint/`
  - main의 `tests/support/core/{mod,process,human,try-boot}.ts`(`createRun`, `bootCore(run, {settings, env})`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`, `until`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script(steps, lane?)`, 함수 대답, `JournalEntry.lane`)와 `probe.ts`, `tests/support/app/`(`test-app`이 내놓는 `startTestApp`, `deliverRelease`, `approveActivation`, `waitRunning`, `activateTestApp`, `createAppSource`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human,try-boot}.ts`(`createRun`, `bootCore(run, {settings, env})`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`, `until`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script(steps, lane?)`, 함수 대답, `JournalEntry.lane`)와 `probe.ts`, `tests/support/app/`(`test-app`이 내놓는 `startTestApp`, `deliverRelease`, `approveActivation`, `waitRunning`, `activateTestApp`, `createAppSource`), `appCallApi`·`appInvocations`·`appRuntime`, `bootCore(run, { env: await appCoreEnv() })`(`coding-role`의 `tests/support/coding/deps.ts`: `DENO_DIR=.dev-data/e2e/deno-dir`, `XDG_RUNTIME_DIR`).
  - 내놓는 것: `tests/support/app/patch-sandbox.ts`: `escapePatch(dir)`. read app-api `escape {secrets, outside, url}`(세 칸 모두 문자열)를 더한다. handler는 (1) `secrets` 경로를 읽고 (2) `outside` 폴더에 file을 쓰고 (3) `url`을 `fetch`하려 하며, 각각 막히면 `"blocked"`, 성공하면 `"leaked"`를 담은 객체를 돌려준다. 앱이 선언한 권한은 비어 있다(template의 `permissions: []` 그대로).

## 할 일

1. 시작 조건: `test-app`이 merge됐다.
2. case 하나(core 하나, 앱 하나).

| 항목 | 내용 |
|---|---|
| route 순서 | `activateTestApp(patch)` → `appCallApi`(user) `escape {secrets: <home>/secrets.json, outside: <work>/outside/x.txt, url: <fake.url>/probe}` → `appCallApi` `list_items` → `appInvocations` → `appRuntime` |
| fake 대답 | 앱 activation의 App Engineer 대답뿐이다. 이 case 자신은 model을 쓰지 않는다. fake 대답은 README "정한 것" 11의 예외(앱 activation helper의 App Engineer 대답)다. test 머리 주석에 이유를 한 줄 적는다. |
| 단정 1 (route) | `escape` 결과의 세 칸이 모두 `"blocked"`이다(`secrets.json`을 읽지 못했다) / 뒤이은 `list_items`는 `succeeded`다 |
| 단정 2 (disk) | `<work>/outside/`에 file이 없고 `secrets.json`의 바이트가 그대로다 |
| 단정 3 (fake) | journal에 `/probe` 요청이 없다(앱의 `fetch`가 닿지 않았다) |

3. `escape` handler가 `blocked`를 돌려주는 대신 handler 자체가 권한 오류로 던져 invocation이 `failed`가 되어도 같은 뜻이다. 구현이 쉬운 쪽을 고르고 단정 1을 그에 맞춘다(둘 중 하나. 보고에 적는다).
4. 앱 process는 끝까지 살아 있어야 한다(권한 오류가 process crash가 되면 안 된다). `appRuntime`의 `process_nonce`가 호출 앞뒤로 같다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `app-runtime`·`app-capability`(앱 process의 권한은 선언과 grant의 교집합이고 앱 code가 어겨도 flag 밖은 열리지 않는다).
- 현실적 회귀: activation 경로가 flag를 넓게 만들어 앱이 data root의 `secrets.json`을 읽거나 밖에 쓰거나 network로 나가는 것(AI가 만든 앱 code의 실수를 막는 마지막 층).
- 왜 지금 test가 못 잡나: `sandbox-boundary_test.ts`는 flag를 만드는 쪽을 subprocess 한 번으로 본다. 실제 activation을 거친 앱 process가 정말 막는지는 안 본다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/app-sandbox_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/app-sandbox_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "activate된 앱 process는 선언 밖의 파일·network에 닿지 못한다"

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
