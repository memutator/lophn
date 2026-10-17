# app-activation

release activation의 불변 조건을 `tests/e2e/app-activation_test.ts`로 본다. 중심 행은 둘째 release의 activation이 실패하면 앱 data가 그대로이고 이전 release가 계속 서빙하며 실패 기록과 `ReleaseActivationFailed`가 남고 App Engineer가 reaction을 받는 것이다. 같은 앱 위에 선언을 넓히면 다시 묻는 것, 새 release가 보류 request를 취소하는 것, 이전 release로 돌아가기, 이전 release의 write를 rewind하지 못하는 것, 허락 직후 재시작, activation 도중 온 호출을 붙잡는 것, activation 도중 재시작을 행으로 더한다.

- 단위: app-activation (wave 3)
- 선행: test-app
- 소유(이 task만 고친다):
  - `tests/e2e/app-activation_test.ts`
  - `tests/support/app/patch-migration.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/apps/releases/activation/`
  - `packages/core/apps/data/`
  - `packages/core/approvals/applier.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-invariants.md` 후보 24(`activation-failure-restores-data`), 25; `candidates-product.md` 후보 `activation-failure-keeps-data`, `app-activation-approval`; `candidates-docs.md` 2절 전부(`activation-widened-asks`, `activation-holds-calls`, `activation-restart-resume`, `activation-supersedes-pending`, `release-rollback`)와 3절 `rewind-not-across-release`, 4절 `allow-reapplied-after-restart`
  - architecture: `project-docs/architecture/activation.md`(복구본이 ledger에 확정된 뒤에만 migration, 6 전에 실패하면 복원하고 이전 release를 다시 띄움, "실패 기록과 `ReleaseActivationFailed`는 같은 tx", 더 새 release가 시작되면 이전 보류 request 취소, 이전 release로 돌아가기는 schema가 같을 때만), `project-docs/architecture/approval.md`(reaction grant 기본 `open`, 허락의 접수와 적용은 따로 — 결과가 기록되지 않은 허락은 시작할 때 다시 적용), `project-docs/architecture/app-call.md`(rewind는 activation을 넘지 못한다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-releases`, `app-data`, `app-runtime`, `approvals`, `events`
  - 코드: `packages/core/apps/releases/activation/`와 `packages/core/apps/data/`(복구본), `packages/protocol/apps/activation/{activation,migration}.ts`(`releasesGetRecord`의 `failure`, `activationsQueue`, `activationActivatePrevious`(user), migration 파일 머리의 `-- loss:`), `packages/core/events/reactor/session-opening.ts`(`ReleaseActivationFailed` → App Engineer reaction), `packages/core/approvals/applier.ts`(시작 때 다시 적용), `project-docs/issues/archived/activation.md`(끊긴 시도·복구본 전례)
  - main의 `tests/support/core/{mod,process,human,try-boot}.ts`(`createRun`, `bootCore(run, {settings, env})`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`, `until`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script(steps, lane?)`, 함수 대답, `JournalEntry.lane`)와 `probe.ts`, `tests/support/app/`(`test-app`이 내놓는 `startTestApp`, `deliverRelease`, `approveActivation`, `waitRunning`, `activateTestApp`, `createAppSource`), `tests/support/gateway/`
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human,try-boot}.ts`(`createRun`, `bootCore(run, {settings, env})`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`, `until`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script(steps, lane?)`, 함수 대답, `JournalEntry.lane`)와 `probe.ts`, `tests/support/app/`(`test-app`이 내놓는 `startTestApp`, `deliverRelease`, `approveActivation`, `waitRunning`, `activateTestApp`, `createAppSource`)(`deliverRelease`·`verifyTicket`·`approveActivation`·`amendAppSource`), `appCallApi`·`appGet`·`appRewindPlan`·`releasesGetRecord`·`activationActivatePrevious`·`approvalsPending`·`approvalsDecide`·`appRuntime`, `connectGateway`, `bootCore(run, { env: await appCoreEnv() })`(`coding-role`의 `tests/support/coding/deps.ts`: `DENO_DIR=.dev-data/e2e/deno-dir`, `XDG_RUNTIME_DIR`).
  - 내놓는 것: `tests/support/app/patch-migration.ts`: `failingMigrationPatch(dir)`, `widenPatch(dir)`, `codeOnlyPatch(dir)`, `slowReadPatch(dir)`. (1) `failingMigrationPatch`는 `migrations/1-2.sql`을 더한다. 빈 DB에서는 통과하고 v1 data가 있을 때만 실패해야 한다(platform app test의 `migration_upgrade`는 빈 DB에서 돌므로). 추천: `CREATE UNIQUE INDEX items_title ON items(title);`(v1에 같은 title의 row가 둘 있으면 실패). blueprint의 data schema 판도 올린다. 파일 머리에 `-- loss:` 선언은 없다. (2) `widenPatch`는 blueprint에 permission 하나를 더한다(선언이 넓어진다. 형식은 `blueprint-schema.ts`가 정한다). (3) `codeOnlyPatch`는 handler 한 줄만 바꾼다(schema 그대로, 선언 그대로). (4) `slowReadPatch`는 read api `delay {ms}`를 더한다(`ms`만큼 앱 안에서 기다렸다 답한다. 앱 안 timer이지 test의 sleep이 아니다).

## 할 일

1. 시작 조건: `test-app`이 merge됐다. `rewind-not-across-release` 이후 행은 앞 행이 만든 release를 이어 쓰므로 표 순서대로 돈다. 한 `Deno.test`, core 하나, 앱 하나. 한 release를 내는 데 `deliverRelease`로 몇십 초가 든다. 시간이 5분 예산을 넘기면 행을 더 쪼개지 말고 뒤 행(`holds-calls`, `restart-resume`)부터 접고 보고한다.
2. 둘째 release는 `deliverRelease`를 다시 부른다(같은 App Engineer session, 앱 하나에 coding session은 하나라 첫 session은 이미 끝나 있다). 먼저 `activateTestApp`으로 v1을 띄우고 `appCallApi add_item {title: "dup"}`을 두 번 해 data를 만든다.
3. 행 표(순서대로).

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `fail-keeps-data` | `amendAppSource(failingMigrationPatch)` → `deliverRelease` → v2 status가 `failed`가 될 때까지 poll(`releasesGetRecord`) → `appGet`·`list_items`·`appRuntime` → AE reaction turn 끝 | AE 줄: 첫 release 5개 + 둘째 release 5개 + reaction turn text 1개 | app state: `appGet.active_release`가 v1이고 `list_items`가 "dup" 둘을 그대로 돌려주며 `appRuntime`이 v1로 running / ledger·event: v2 `releasesGetRecord`가 `failed`이고 failure 코드·요약이 있으며 Gateway에서 `ReleaseActivationFailed` event를 받았다(조건 `{types: ["ReleaseActivationFailed"]}`) / fake: AE 줄의 마지막 요청(reaction turn)이 있고 본문에 v2 release id나 실패 코드가 실렸다(구조만) | 후보 24, `activation-failed-reaction`. 데이터 잃기. v2 선언이 안 늘면 안 묻는다(`approveActivation` 불필요) |
| `rewind-not-across-release` | v1에서 한 write의 invocation을 `from_invocation`으로 `core.tryCall(appRewindPlan)` | 없음 | route: 오류 `invalid_input`이다(이전 release의 호출은 고를 수 없다). 이 행은 v2가 active인 뒤에 두는 편이 의미가 있어 `rollback`·`widened-asks` 뒤로 옮겨도 된다(v1 호출 id만 기억하면 된다) | `rewind-not-across-release`(app-call.md 122행) |
| `widened-asks` | `amendAppSource(widenPatch)` → `deliverRelease` → `approveActivation({allow})` → `waitRunning(v3)` | AE 줄 5개 | route: 허락 전 `approvals/pending`에 activation request가 정확히 하나이고 비교(`activationsCompare`)에 늘어난 permission이 있다 / ledger: 허락 뒤 `appGet.active_release`가 v3 / process: 앱이 v3로 running이다 | `activation-widened-asks`(activation.md 36·38행). `fail-keeps-data`의 v2는 안 넓혀서 안 물은 짝이다 |
| `supersedes-pending` | `amendAppSource(widenPatch2)` → `deliverRelease`(허락하지 않는다) → 더 새 release를 `deliverRelease` → `approvals/pending` | AE 줄 10개 | route: 앞 release의 request는 cancelled이고 pending에는 새 release의 것 하나뿐이다 / ledger: 앞 release는 `prepared`로 남는다 / app state: 활성 release는 그대로다 | `activation-supersedes-pending`(activation.md 56행, approval.md). `widenPatch2`는 `widenPatch`와 다른 permission을 더하는 같은 file의 patch다 |
| `rollback` | 새 request를 허락해 활성 release를 정한 뒤, 코드만 다른 release를 `codeOnlyPatch`로 내고(안 묻는다) active로 만든 다음 `core.call(activationActivatePrevious, ...)` → `list_items` | 위 release 만큼의 AE 줄 | ledger: 이전 release가 다시 active이고 현재 release는 `superseded`다 / app state: `list_items`의 data가 그대로다 / route: schema가 다른 release로 돌아가려 하면 거절된다(`failing`이 아닌 `widenPatch` release는 schema가 같다. 거절 쪽은 v1→migration release 사이를 골라 한 번 `tryCall`) | `release-rollback`(activation.md 28·64행). 사람만 시작한다 |
| `allow-reapplied-after-restart` | `widenPatch`류 release를 `deliverRelease` → `approvals/pending` → `approvalsDecide(allow)` 직후 `core.kill()` → `bootCore` → `waitRunning` | AE 줄 5개 | ledger: 재시작 뒤 그 release가 active이고 activation 시도 기록이 정확히 하나다 / route: 같은 request가 두 번 적용되지 않았다(`approvals/pending`이 비어 있다) / process: 앱 process가 하나다 | `allow-reapplied-after-restart`(approval.md 185행). **시간 경쟁이다**: 결정과 적용 사이에 kill이 끼는지는 보장하지 못한다. 어느 쪽이든 단정이 같아서 통과하지만 고치기 전 실패를 보장하지 않는다 — 보고에 적는다 |
| `holds-calls` | `slowReadPatch` release를 active로 만든 뒤 `appCallApi delay {ms: 2000}`을 await 없이 시작 → 다음 release(`codeOnlyPatch`)를 `deliverRelease`·허락 → activation이 시작된 것을 `activationsQueue`로 확인하자마자 `list_items`를 부름 | AE 줄 | route: 붙잡힌 `list_items`가 실패하지 않고 `succeeded`이다 / ledger: 그 invocation의 release가 새 release다 / process: 앱이 새 release로 running | `activation-holds-calls`(activation.md 18·24행). 시간 경쟁이 커서 못 만들면 접고 보고한다 |
| `restart-resume` | 위 `holds-calls`처럼 activation이 진행 중일 때(`activationsQueue`) `core.kill()` → `bootCore` → `waitRunning` | 같다 | ledger: `releasesGetRecord`가 `activating`이 아니라 `active`나 `failed`로 닫혔다(반쯤 바뀐 채 남지 않는다) / app state: 활성 release가 하나이고 data가 그대로 / process: 앱 process가 하나 | `activation-restart-resume`(activation.md 35·54행). `holds-calls`가 접히면 이 행도 접는다 |

4. v2 선언이 늘지 않으면 activation은 사람에게 묻지 않고 바로 시도한다(`activation.md`). 묻는 release만 `approveActivation`이 allow한다.
5. 복구본 복원이 실패하면 이전 code도 띄우지 않고 사용 불가가 된다(문서). 이 case는 복원이 성공하는 길만 본다.
6. fake 대답은 README 정한 것 11의 예외(앱 activation helper의 App Engineer 대답)다. 한 줄에 순서대로 걸고 test 머리 주석에 이유를 적는다. 행마다 `deliverRelease`가 AE 줄에 5개를 더 걸어야 하므로 줄을 `fake.script`로 행 앞에서 새로 건다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `app-releases`·`app-data`(migration 전에 복구본을 ledger에 확정하고, 실패하면 복원하고 이전 release를 다시 띄운다. 실패 기록과 event는 같은 tx. 더 새 release가 이전 보류 request를 취소한다. 허락은 접수와 적용이 따로라 재시작에 다시 적용한다), `approvals`(선언이 넓어지면 다시 묻는다), `events`(실패가 program → App Engineer reaction으로 이어진다).
- 현실적 회귀: migration이 실패했는데 data가 반쯤 바뀐 채 남는 것, 이전 release가 안 뜨는 것, 실패 기록이 없거나 App Engineer가 모르는 것(두 번 이상 고친 흔적: `archived/activation.md`의 끊긴 시도·복구본 보존), 선언이 넓어졌는데 묻지 않고 올리는 것, 허락이 재시작에 사라져 적용 안 되는 것.
- 왜 지금 test가 못 잡나: 순서와 복원은 unit이 일부 있을 수 있지만 이전 process 종료 확인, 실제 DB 복원, 새 process 준비 모드, 허락의 재적용은 process를 건너야 한다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/app-activation_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/app-activation_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "activation은 확인된 release만, 넓어진 선언은 사람이 허락해야만 올리고, 실패하면 앱 data와 이전 release를 그대로 둔다"

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
