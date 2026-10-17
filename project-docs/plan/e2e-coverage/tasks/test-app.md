# test-app

test용 앱을 제품의 길로 activate하는 helper를 `tests/support/app/`에 만들고, 그 helper가 맞게 도는지 `tests/e2e/app-release_test.ts` 하나로 본다: 새 data root에서 template 앱이 release 준비를 지나고(file 수 상한 아래) activate되어 앱 process가 뜬다. 앱 flow 다섯이 이 위에 선다.

**이 task는 `app-cli-finish`가 merge된 뒤에만 시작한다. 앱 길의 다른 막힘(위 "먼저 확인한다")이 나오면 test를 고쳐 맞추지 말고 보고한다. 제품 동작을 새로 정해야 하면 정하지 말고 "사람에게 물을 것"으로 올린다.**

- 단위: test-app (wave 2)
- 선행: reply-fn, boot-damaged, gateway-client, coding-role, app-cli-finish. 함수 대답·줄, `env` 옵션, shell 역할, CLI runner·DENO_DIR, 끝까지 가는 CLI 명령을 모두 쓴다.
- 소유(이 task만 고친다):
  - `tests/support/app/`
  - `tests/e2e/app-release_test.ts`
  - `tests/support/coding/prepare-deps.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/apps/releases/`
  - `packages/core/apps/packages/`
  - `packages/core/apps/tickets/`
  - `packages/core/problems/tests/`
  - `packages/coding-agent/`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/README.md` 전체(특히 "정한 것" 9~11, 지켜야 할 것), 이 계획의 `tasks/app-cli-finish.md`("찾은 것" 네 가지와 새 CLI 명령 이름)
  - `project-docs/plan/e2e-coverage/research/candidates-bugs.md`의 "앱이 필요한 것"(`fresh-root-app-release`), `candidates-product.md` §3 G4 "공통 준비"와 후보 `app-release-activate-call`, `candidates-invariants.md` §2.3 서두와 후보 24
  - architecture: `project-docs/architecture/activation.md`(계기는 `TicketVerified`, 첫 activation은 사람에게 묻는다, 앱마다 하나), `project-docs/architecture/coding-agent.md`(token, 앱 하나에 coding session 하나), `project-docs/architecture/app-call.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-releases`, `app-runtime`, `app-tickets`, `external-coding-agent`, `coding-agent-cli-interface`, `approvals`, `problems`
  - 코드(경로만. 순서는 아래 "할 일"): `packages/protocol/apps/apps.ts`(`appCreate`, `appConnectSource`, `appGet`), `packages/protocol/apps/{runtime,releases}.ts`(`appRuntime`), `packages/protocol/apps/activation/activation.ts`(`releasesGetRecord`, `releasesListRecords`, `activationsQueue`), `packages/protocol/coding-agent/ticket/{routes,claims,values}.ts`, `packages/protocol/coding-agent/cli-commands.ts`, `packages/protocol/approvals/{requests,grants}.ts`(`approvalsPending`, `approvalsDecide`, `agentGrantsSet`), `packages/core/apps/packages/template/{files,scaffold,install}.ts`(`{{APP}}`·`{{TITLE}}` 치환 규칙), `packages/core/apps/tickets/coding/{launch,transport,relay}.ts`(coding session 열기와 frame), `packages/core/apps/agent-tools/{app,ticket}.ts`(`ticket.create {app, goal, check}`, `ticket.verify {ticket, result, note?}`), `packages/core/lophn-agent/tools/bundles/call.ts`(`call` tool: `to: {role: "coding_agent", place: {app: <앱 이름>}}`, `refs: [{kind: "ticket", ticket: <id>}]`, `options: {harness}`), `packages/core/problems/tests/app-test/{frozen,generate}.ts`, `packages/core/problems/tests/work/{runner-service,app-test-run}.ts`(app test는 `systemd-run --user --scope`로 메모리 상한을 건다. `XDG_RUNTIME_DIR`이 없으면 `unavailable`), `packages/core/apps/releases/{finalizer,preparation}.ts`
  - main의 `tests/support/core/{mod,process,human,try-boot}.ts`(`createRun`, `bootCore(run, {settings, env})`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`, `until`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script(steps, lane?)`, 함수 대답, `JournalEntry.lane`)와 `probe.ts`, `tests/support/gateway/`, `tests/support/coding/`
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human,try-boot}.ts`(`createRun`, `bootCore(run, {settings, env})`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`, `until`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script(steps, lane?)`, 함수 대답, `JournalEntry.lane`)와 `probe.ts`, `connectGateway`·`reportHarness`·`waitCodingTerminal`·`answerTerminal`·`exitTerminal`(`gateway-client`), `codingCli`·`appCoreEnv`·`requireDenoDir`(`coding-role`), `app-cli-finish`가 정한 CLI 명령(`release status`, `app test status`, `app test result`).
  - 내놓는 것: 아래 "내놓는 것" 절

## 내놓는 것

```ts
// tests/support/app/source.ts
createAppSource(core: Core, options: { slug: string; title?: string; patch?: (dir: string) => Promise<void> }): Promise<{ dir: string; commit: string }>
// <core.run.home>/templates/app(core가 깐 읽기 전용 사본)을 run.work/<slug>로 복사한다. `{{APP}}`·`{{TITLE}}`은 scaffold.ts의 fill 규칙과 같게 채운다. patch를 적용하고 git init·commit(`-c user.name -c user.email`을 명령에 준다. 사람의 git 설정을 읽지 않는다). commit은 40 hex.
amendAppSource(dir: string, patch: (dir: string) => Promise<void>): Promise<string>   // 둘째 release용. patch 적용 뒤 새 commit

// tests/support/app/activate.ts
startTestApp(core, fake, options: { name: string; slug: string; patch?: ... }): Promise<TestApp>
// apps/create(user) → createAppSource → apps/connect_source(compare base_revision) → agent grant(AE → coding_agent, setting "never") → connectGateway → reportHarness → openSession(app_engineer)
deliverRelease(core, fake, app: TestApp, options: { goal: string; verify?: boolean }): Promise<{ ticket: string; release: string }>
// AE에게 말한다 → AE ticket_create + call(coding_agent) → waitCodingTerminal → answerTerminal → codingCli: ticket show·claim → release prepare → release status poll → app test(test hash는 release status가 준다) → app test status·result poll → release status로 release id → ticket report → exitTerminal(session 끝) → AE의 알림 turn(`verify`가 false면 여기서 text로 끝내고 돌아온다)에서 ticket_verify. 기본(`verify` 생략)은 TicketVerified까지 지나고 돌아온다
verifyTicket(core, fake, app: TestApp, ticket: string): Promise<void>   // `verify: false`로 멈춘 release의 ticket을 AE에게 말해 ticket_verify하게 한다(줄: ① ticket_verify ② text)
handOff(core, fake, app: TestApp, options?: { goal?: string }): Promise<{ ticket: string; call: string; token: string; terminal: string }>
// AE가 ticket_create + call(coding_agent) → waitCodingTerminal → answerTerminal까지. `deliverRelease`는 이것으로 시작한다. coding 쪽 task(`coding-*`)가 같은 단계를 다시 만들지 않게 내놓는다(planner 검토)
approveActivation(core, app: TestApp, choice?: "allow" | "reject"): Promise<{ request: string }>
// approvals/pending에 activation request가 올 때까지 poll(제한 시간 있음)하고 approvals/decide로 결정한다(기본 allow). 첫 activation은 항상 묻는다(`gate.ts`: first)이므로 요청이 안 오면 실패한다.
// 선언이 안 늘어난 둘째 이후 release는 안 묻는다: 그때는 `approveActivation`을 부르지 않는다(`waitRunning(core, app, release)`로 새 release가 running이 되기를 기다린다)
waitRunning(core, app: TestApp, release?: string): Promise<RuntimeObservation>   // appRuntime이 (그 release로) running·ready·accepting일 때까지 poll
activateTestApp(core, fake, options): Promise<TestApp>    // startTestApp + deliverRelease + approveActivation(allow) + waitRunning

// tests/support/app/patches.ts   (template 위에 얹는 patch. 각 patch는 blueprint 선언과 handler를 같이 더하고 platform app test를 통과해야 한다)
projectScopePatch(dir: string): Promise<void>   // read app-api `list_in_project`(blueprint `project_scope: true`)를 더한다. handler는 호출의 project를 그대로 돌려준다(app-project-scope 행이 쓴다)
type TestApp = { app: string; slug: string; name: string; source: string; commit: string; ae: string; gateway: Gateway };
```
다른 계획의 worker가 쓰는 계약이므로 export 이름과 인자를 바꾸지 않는다. 바꿔야 하면 "계약 바꾸기 요청"이다.

AE의 fake 대답은 `deliverRelease`가 줄(`ticket_create` tool이 든 요청)에 5개를 건다: ① `ticket_create {app, goal, check: {kind: "text", text: ...}}` ② 함수: ①의 `tkt_` id로 `call` ③ text ④ 함수: 알림 turn에서 `ticket_verify {ticket, result: "verified"}` ⑤ text. `check`는 `text`로 둔다(App Engineer가 판단하는 조건이라 test runner를 거치지 않는다).

## 할 일

1. **먼저 확인한다(막히면 거기서 멈추고 보고한다. 지름길을 만들지 않는다)**. 임시 script(commit하지 않음)로 위 "내놓는 것"의 순서를 한 걸음씩 돌려 본다. 코드로 읽어 의심한 곳:
   - Gateway frame이 오려면 App Engineer의 `call`이 `not_allowed`가 아니어야 한다. grant 줄이 없으면 거절이다(`callGate`). 위 "agent grant" 단계가 그 이유다.
   - `harness.report`가 없으면 call이 `not_connected`로 실패한다. `canLaunch(harness)`가 false인 harness(hermes, openclaw)는 안 된다.
   - release 준비는 `DENO_DIR` 안의 npm·jsr·esbuild만으로 돈다(network 없이). `unshare -rn sh -c 'ip link set lo up && <명령>'`으로 loopback만 있는 환경에서 `app-release_test`를 한 번 돌려 확인한다. 모자란 의존은 `tests/support/coding/prepare-deps.ts`에 더한다(이 task의 소유).
   - app test는 `systemd-run --user --scope`가 필요하다. `bootCore`가 `XDG_RUNTIME_DIR`을 주지 않으면 runner가 자식을 못 띄워 test가 영영 안 통과한다. `appCoreEnv()`가 준 값을 쓴다.
   - template 앱의 platform test(`blueprint_handler_match`, `dependencies`, `migration_empty`, `rewind`)가 통과하는지. `issues/activation.md`의 "write app-api의 rewind 검사가 fail"은 `add_item`(입력 `{title}`)이 걸리지 않는지로 확인한다.
   위가 모두 되는데 CLI만 막히면 `app-cli-finish`의 결과가 모자란 것이다. 그 사실을 "계약 바꾸기 요청"에 적고 멈춘다.
2. 위 순서가 되면 "내놓는 것"을 `tests/support/app/`에 만든다. file은 `source.ts`, `activate.ts`로 둔다. flow의 단계를 helper에 넣지 않는다: `activateTestApp`은 "앱 하나를 activate 상태로 만든다"는 하나의 준비다(README "정한 것" 11).
3. 모든 대기는 신호를 읽는 poll(`until`, 제한 시간 있음)이다. 제한 시간 안에 안 되면 무엇을 기다렸는지(ticket 상태, call 상태, test 요청 상태)를 담아 실패한다. 앱 하나에 coding session은 한 번에 하나라 `deliverRelease`는 끝에 `exitTerminal`로 session을 끝내고 token을 회수한다.
4. E2E `tests/e2e/app-release_test.ts`: `Deno.test` 하나(core 하나, 앱 하나).

| 항목 | 내용 |
|---|---|
| route 순서 | `bootCore(run, {env})` → `connectFakeProvider` → `activateTestApp` → `releasesGetRecord`·`appGet`·`appRuntime` → `appCallApi {target: {mode: "live", app, release: null}, api: "list_items", caller: {kind: "person", view_session: ...}}` |
| fake 대답 | App Engineer 5개(위 "내놓는 것"). fake 대답은 README "정한 것" 11의 예외(앱 activation helper의 App Engineer 대답)다. test 머리 주석에 이유를 한 줄 적는다. |
| 단정 1 (disk) | bundle 사본 `<home>/apps/<app>/bundles/<bundle_hash>/`의 file 수가 10,000 아래(`RELEASE_FILE_MAX_COUNT`)이고 `screens/items/main.js.map`이 있으며, `<home>/sdk/ui/1.0.0`이 읽기 전용(쓰기 비트 없음)이다 |
| 단정 2 (ledger) | `releasesGetRecord`의 status가 `active`이고 `appGet.active_release`가 그 release id다 |
| 단정 3 (process) | `appRuntime`의 state가 `running`이고 관측이 ready이며 `list_items` 호출이 `succeeded`다(앱 process가 실제로 답했다) |

   위 case는 첫 activation이 사람에게 묻는 길을 지난다: `activateTestApp` 안의 `approveActivation`이 `approvals/pending`의 activation request를 `approvals/decide`로 허락한다(`activation-first-asks`, `activation-needs-verify`; `candidates-docs.md` 2절). 같은 `Deno.test` 안에서 순서는 이렇다.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `needs-verify-then-first-asks` (첫 앱, 위 case의 앞 절반) | `startTestApp` → `deliverRelease({verify: false})` → `approvals/pending`·`appGet` 읽기 → `verifyTicket` → `approveActivation(allow)` → `waitRunning` | AE 줄(위 5개를 둘로 나눠 건다) | ledger: `verify: false` 뒤에는 보류 request가 없고 `appGet.active_release`가 null이다(준비만으로는 시작하지 않는다. 증거는 AE의 알림 turn이 text로 끝났다는 신호이지 시간 대기가 아니다) / route: `verifyTicket` 뒤 `approvals/pending`에 activation request가 정확히 하나이고 허락 전 `appRuntime`이 running이 아니다 / process: 허락 뒤에만 앱 process가 뜬다(`waitRunning`) | `activation-needs-verify`, `activation-first-asks` |
| `first-activation-rejected` (둘째 앱 `startTestApp`, 같은 core) | `startTestApp` → `deliverRelease` → `approveActivation(reject)` | AE 줄 5개 | route: request가 결정됐고 `appGet.active_release`가 null이다 / process: 앱 process가 없고 `appRuntime`이 running이 아니다 / ledger: release 기록이 `prepared`로 남는다(저절로 다시 시작하지 않는다) | `activation-first-asks`(거절). activation.md "거절된 prepared release는 저절로 다시 시작하지 않는다" |

   두 앱은 slug가 다르고 같은 AE 줄을 쓰지 못하므로(줄은 AE의 `ticket_create` tool로 가른다) `deliverRelease`는 앱마다 줄 이름을 앱 id로 붙인다.

4b. `tests/support/app/patches.ts`의 `projectScopePatch`: template에 project 범위 api 하나를 더한다(`app-project-scope`, `app-call.md` 101행). template의 두 api는 `project_scope: false`이므로 project에 놓인 agent가 부를 때 project가 호출에 어떻게 실리는지는 이 patch가 있어야 본다. 쓰는 곳은 `app-call`이다. 이 task는 patch가 platform app test를 통과하는 것까지만 `app-release_test`에서 한 번 쓴다(첫 앱에 `projectScopePatch`를 적용).
5. 이 E2E는 시간이 가장 오래 든다. 한 번 도는 시간(release 준비 build + app test + activation)을 보고에 적는다. 5분 예산(README 정한 것 3)에서 앱 flow 다섯이 이만큼씩 더 든다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `app-releases`·`app-tickets`·`app-runtime`(ticket → claim → 준비 → 확정 → 보고 → 확인 → activation → 앱 process 순서가 제품의 길로 끝까지 간다), `external-coding-agent`·`coding-agent-cli-interface`(coding agent는 token + CLI로만 닿는다).
- 현실적 회귀: 새 data root에서 template 앱의 release 준비가 깨지는 것(이번 판에 bug 넷: sdk 사본이 없다, file 수 상한 10,000에 걸린다, 화면이 둘 이상인 앱의 `app.js.map`에 `mappings`가 없다, sdk package가 catalog에 없다), 준비/확정/보고 단계 중 하나가 CLI에서 끊기는 것, activation이 앱 process를 못 띄우는 것.
- 왜 지금 test가 못 잡나: 각 닫음이 "실제 template 앱으로 손으로 확인하지 않았다(E2E 몫)"였다. 이 길을 지나는 test가 없고 unit은 단계 하나씩만 본다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/app-release_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/app-release_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- `unshare -rn sh -c 'ip link set lo up && deno test --allow-all --no-check tests/e2e/app-release_test.ts'`가 통과한다(network 없이도 도는 것을 한 번 확인한다. 이 환경에서 안 되면 이유를 보고에 적는다).
- 위험 test: "새 data root에서 template 앱이 제품의 길로 release 준비를 지나 activate되고 앱 process가 답한다. 확인 전에는 시작하지 않고 첫 activation은 허락 뒤에만 뜬다"

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
