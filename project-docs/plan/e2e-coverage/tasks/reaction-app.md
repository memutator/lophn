# reaction-app

앱 process가 던진 오류가 문제가 되어 그 앱의 App Engineer가 불리는 길(앱 process → SDK 오류 관측 → collector worker → core → Reactor)과, 앱이 거듭 죽어 자동 재시작이 멈추면 App Engineer가 불리는 길(`AppRestartHalted`)을 `tests/e2e/reaction_test.ts`에 `Deno.test` 하나로 더한다. activation이 실패하면 App Engineer가 불리는 길(`activation-failed-reaction`)은 `app-activation`의 `fail-keeps-data` 행이 본다.

- 단위: reaction-app (wave 3)
- 선행: reaction-rows, test-app. 같은 file에 `Deno.test`를 더하고, 앱 activate helper와 `appCoreEnv()`를 쓴다.
- 소유(이 task만 고친다):
  - `tests/e2e/reaction_test.ts`
  - `tests/support/app/patch-reaction.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/apps/runtime/`
  - `packages/sdk/cap-problem/`
  - `packages/core/problems/reporting/`
  - `packages/core/events/reactor/`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 8절 `problem-opens-app-engineer`·`restart-halted-reaction`·`activation-failed-reaction`; `candidates-product.md` 후보 `app-crash-problem-reaction`
  - architecture: `project-docs/architecture/event.md`, `project-docs/architecture/approval.md`(reaction grant 기본 `open`), `project-docs/products/AGENT-ROLE.md` §6 E1·E2
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-runtime`, `problems`, `events`, `supervision`
  - 코드: `packages/core/apps/runtime/entrypoint/{crash,main}.ts`(처리 안 된 오류/거부는 stderr에 쓰고 exit 1. 보고는 앱 code가 load되기 전에 설치한 observer가 한 번 한다), `packages/sdk/cap-problem/{exception-observer,deliver}.ts`(보고를 보낸 뒤 process가 죽기 전에 전달이 끝나는지는 코드로 못 닫았다), `packages/core/apps/runtime/supervisor/restart-policy.ts`(backoff 1·2·4·8·16초, 10분 창 안의 예상 밖 종료가 `CRASH_LIMIT` 5를 넘으면 멈춤 = 여섯 번째 종료), `packages/core/apps/runtime/commands.ts`(`recordUnavailable`이 `crash_loop`이면 같은 tx에 `AppRestartHalted`를 낸다), `packages/core/events/reactor/session-opening.ts`(`callOf`: `ProblemOpened`는 refs에 problem, `AppRestartHalted`는 refs 없이 본문에 횟수와 release), `packages/protocol/apps/runtime.ts`(`appRuntime`의 `state`와 `observation.process_nonce`), `packages/core/problems/snapshots/work.ts`(`observedErrorGroupKey`: stack의 맨 위 frame으로 묶으므로 같은 api가 던지는 오류는 같은 문제다. 두 번째 오류부터는 새 `ProblemOpened`가 없다), `packages/protocol/events/domain.ts`(`AppRestartHalted`)
  - `project-docs/plan/e2e-coverage/tasks/test-app.md`("내놓는 것"의 `activateTestApp`·`waitRunning`·`TestApp`), `tasks/reaction-rows.md`(같은 file의 `reportViewError`·`reactionSessions`)
  - main의 `tests/support/core/`, `tests/support/fake-server/`(함수 대답, 줄), `tests/support/gateway/`(`connectGateway`), `tests/support/coding/deps.ts`(`appCoreEnv`), `tests/support/app/`(`test-app`이 만든 것)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: 위 support와 `test-app`의 `activateTestApp`·`createAppSource`의 `patch` 옵션.
  - 내놓는 것: `tests/support/app/patch-reaction.ts`: `crashPatch(dir)`. read app-api `crash {}`를 더한다. handler는 `{ok: true}`를 돌려주고 같은 tick 뒤에 처리되지 않는 오류를 던진다(예 `setTimeout(() => { throw new Error("e2e crash") }, 0)`). 이 앱은 `app-call`의 `callPatch`·`app-sandbox`의 `escapePatch`와 다른 앱이고 다른 test에서 쓰지 않는다. blueprint 선언과 `src/app-api.ts` handler가 맞아야 platform app test가 통과한다.

## 층을 정한 이유와 접은 것

core E2E다(앱 process, supervisor, collector worker, Reactor, agent runtime child가 모두 이어져야 한다).

- `problem-opens-app-engineer`의 "reaction 사슬"은 `reaction-rows`가 view 오류로 이미 본다. 이 task의 행 1은 그 앞 구간(앱 process의 오류가 collector worker를 지나 문제가 되는 것)을 본다. 두 행이 겹치는 구간은 반응 쪽이라 이 행은 반응을 가볍게만 본다.
- `activation-failed-reaction`은 `app-activation`의 `fail-keeps-data`가 (실패 기록, `ReleaseActivationFailed`, App Engineer reaction turn)을 본다. 여기서 다시 하지 않는다. 확인만: 그 행의 reaction turn 단정이 빠지면 `tasks/app-activation.md`로 보낸다.
- 시간 예산: 행 2는 backoff만 31초가 든다(1+2+4+8+16). 앱 activation(`test-app` 보고에 적힌 시간)과 합쳐 이 `Deno.test`가 3분을 넘기면 행 2를 접지 말고 보고한다(5분 예산은 lead가 정한다).

## 할 일

1. 시작 조건: `reaction-rows`와 `test-app`이 merge됐다. 같은 file에 둘째 `Deno.test`를 더한다(앞 test와 core를 같이 쓰지 못한다: 앱 test가 `DENO_DIR`·`XDG_RUNTIME_DIR` env를 필요로 한다. fake server와 helper만 같이 쓴다). 준비: `startFakeServer` → `bootCore(run, {env: await appCoreEnv()})` → `connectFakeProvider` → `activateTestApp(core, fake, {name, slug, patch: crashPatch})`. 이 둘째 test는 reaction grant를 건드리지 않는다(기본 `open`).
2. App Engineer 줄: `activateTestApp`이 거는 App Engineer 대답 줄에 reaction turn마다 text 하나를 이어서 건다(`app-activation`의 `fail-keeps-data`와 같은 방식. reaction turn의 요청도 App Engineer의 tool이 든 요청이라 같은 줄로 간다). 이 줄의 대답이 3개를 넘는 것은 README "정한 것" 11의 예외(앱 activation helper의 App Engineer 대답)다. 이유를 test 머리 주석에 한 줄 적는다.
3. 행 표(차례로 돈다).

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `crash-opens-problem` | `appCallApi crash` → `until`(`listProblems {app}`에 문제 하나) → `until`(`reactionSessions`에 session 하나, `reaction-rows`의 helper를 이 file 위쪽으로 올려 두 test가 같이 쓴다) → `waitTurnEnd` | App Engineer 줄에 text 1 | ledger: 문제가 `open`이고 이름이 던진 오류(`Error`)다(문구는 단정하지 않는다) / route: reaction session의 첫 메시지 `from`이 program이고 `refs`가 그 문제다 / process: `appRuntime`이 다시 running이다(앱이 죽었다가 backoff 1초 뒤 다시 떴다. `observation.process_nonce`가 호출 전과 다르다) | AGENT-ROLE E1·A2. 앱이 조용히 깨지지 않게 하는 제품 약속의 첫 고리 |
| `crash-loop-halts` | `connectGateway(core, {conditions: [{types: ["AppRestartHalted"]}]})` → (`process_nonce`가 바뀌어 running일 때마다) `appCallApi crash`를 모두 여섯 번째 종료까지(행 1이 첫 번째) → Gateway `next("event", AppRestartHalted)` → `until`(`reactionSessions`에 둘째 session) → `waitTurnEnd` | App Engineer 줄에 text 1 | route: `appRuntime`의 state가 running이 아니고 reason code가 `crash_loop`이다 / event: `AppRestartHalted` frame을 정확히 한 번 받았다 / ledger: 둘째 reaction session의 첫 메시지가 program이고 `refs`가 비었다(문제 reaction이 아니라 이 event의 것이다) | AGENT-ROLE E2, `app-runtime`. 반복 종료를 사람과 agent가 모르면 앱이 영영 죽어 있다 |

4. 여섯 번의 `crash` 호출은 for 루프 하나다. 각 호출 사이는 `until`로 `appRuntime`의 `observation.process_nonce`가 바뀌고 ready·accepting일 때까지 읽는다(제한 시간 60초, 마지막 backoff가 16초). sleep을 쓰지 않는다. 여섯 번째 종료 뒤에는 앱이 다시 안 떠야 한다.
5. 같은 api가 던지는 오류는 같은 문제로 묶인다. 그렇지 않아 행 2의 오류마다 `ProblemOpened`가 나면 reaction session이 여럿 생겨 행 2의 "둘째 session" 단정이 어긋난다. 그 경우 `reactionSessions`에서 refs가 비어 있는 것으로 가리고, 묶임이 안 되는 것은 "찾은 제품 bug"로 보고한다(제품 결함 후보: 같은 오류가 문제를 여럿 연다).
6. 보고가 process가 죽기 전에 끝나지 않아 행 1에서 문제가 안 열리면 test를 고치지 말고 제품 bug로 본다(`sdk/cap-problem/deliver.ts`·`entrypoint/crash.ts`). 앱이 죽는데 문제가 안 열리는 것이 E1이 막으려는 일이다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `problems`(앱 process의 처리 안 된 오류는 문제가 되고 한 번만 열린다), `app-runtime`(거듭 죽으면 자동 재시작을 멈추고 `AppRestartHalted`를 낸다), `events`(새 일 event는 reaction grant대로 App Engineer를 연다).
- 현실적 회귀: 앱이 죽는데 문제가 안 열리는 것(보고가 exit에 먼저 잘림), 같은 오류가 보고마다 새 문제를 여는 것, crash 횟수 계산이 어긋나 멈추지 않고 영영 되살리거나 너무 일찍 멈추는 것, 멈췄는데 아무도 부르지 않는 것.
- 왜 지금 test로 못 잡나: 재시작 정책은 순수 규칙 unit이 있어도 실제 process 종료 → supervisor → command → ledger → Reactor → Router → agent runtime의 turn은 이어서 본 적이 없다. SDK 오류 관측이 실제 exit와 경쟁하는 것은 process를 건너야 보인다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/reaction_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/reaction_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다. 앱 process가 남지 않는 것도 본다(`pgrep -af 'apps/runtime/entrypoint'`).
- 위험 test: "앱 process가 던진 오류는 문제가 되어 App Engineer를 부르고, 거듭 죽으면 자동 재시작이 멈추며 App Engineer를 다시 부른다"

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 찾은 제품 bug: 증상, 재현하는 행, 의심 file. 고쳤으면 "고치기 전 코드에서 그 행이 실패한 것"의 출력 한 줄
- 이 test의 실행 시간(행 1, 행 2)
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
