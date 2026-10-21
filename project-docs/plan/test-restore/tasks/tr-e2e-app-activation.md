# tr-e2e-app-activation

`app-activation_test.ts`를 App Engineer가 직접 올리는 흐름으로 다시 쓴다. README "정한 것" 표의 `app-activation` 줄이 재는 것이다: migration이 실패하면 data와 앞 release가 남고 실패가 `release_activate` 결과의 `migration_failed`(단계와 SQLite 오류 글)와 release `failure`에 실린다. 선언을 넓히면 `waiting_consent`이고, 새 release가 나오면 옛 동의 줄이 닫힌다(늦은 동의는 `conflict`). 되돌리기, drain 동안 잡아 둔 호출, 재시작 뒤에도 남는 허락은 그대로 본다.

- 단위: e2e (wave 2)
- 선행: tr-support-app.
- 소유(이 task만 고친다):
  - `tests/e2e/app-activation_test.ts`
  - `tests/support/app/patch-migration.ts`
- 읽을 것:
  - 계획: `project-docs/plan/test-restore/README.md`의 "정한 것" 표 `app-activation` 줄, `project-docs/plan/test-restore/survey-e2e.md` §1의 3번 줄(행마다 무엇이 바뀌나)
  - tr-support-app의 brief "내놓는 것"(`activateTestApp`, `prepareRelease`, `activateRelease`, `deliverRelease`, `approveActivation`, `waitRunning`, `sampleDomain`. `TestApp`에 `gateway`가 없다. AE turn 기다림은 480초, `waitRunning`은 120초)
  - architecture: `project-docs/architecture/activation.md` 전부(특히 "지키는 것"의 "계기와 묻는 조건": `release.activate`는 120초까지 기다리고 동의가 필요하면 `waiting_consent`를 바로 돌려준다, 동의 줄과 `requested_at`, "더 새 release의 activation이 시작되면 그 앱의 동의 줄을 모두 닫는다". "실패와 복구"), `project-docs/architecture/testing.md`("case 고르는 규칙" 1·4·7)
  - 변경 기록: `project-docs/products/change-log/0.6.0.md`의 "activation의 migration 실패가 단계와 오류 글을 싣고"(summary `the data change failed: step 2-3 was rolled back: <SQLite 오류 글>`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-releases`, `app-data`, `app-runtime`, `supervision`, `event-stream`; `project-docs/module-catalog.yaml`의 `tests`
  - 코드(HEAD `85f19080e`)
    - 지금 test: `tests/e2e/app-activation_test.ts`(머리 주석 1-17, `call`·`titles`·`recordOf`·`activeOf`·`appProcesses` 64-115는 그대로 쓴다, `activationRequests` 93-98은 지운다, 행 169-391)
    - `tests/support/app/patch-migration.ts`(`failingMigrationPatch` 14-25, `slowReadPatch` 59-98의 slug 줄 60-61, `resetSource` 116-127, 머리 주석 1-2)
    - 동의: `packages/protocol/apps/activation/consent.ts`(`activationConsents`, `activationConsent`와 그 compare), `packages/core/apps/releases/commands.ts` 185-196(activation 시작이 그 앱의 대기 줄을 `cancelled`로 닫고 지운다)·427-473(`activation.consent`: 대기가 없거나 `requested_at`이 다르면 `conflict`)
    - 실패 글: `packages/protocol/apps/activation/data-job.ts` 63-67(`rolledBackStepText`), `packages/protocol/apps/releases.ts` 137-158(`release.activate` 출력의 `failure`)
    - 되돌리기: `packages/core/apps/releases/commands.ts` 341-379(`activation.activate_previous`: superseded가 아니거나 schema가 다르면 `invalid_input`)
    - `release.activate`의 기다림: `packages/core/apps/releases/activation/assembly.ts` 688-760
    - `packages/protocol/events/transient.ts` 65-86(`ActivationConsentRequested`, `ActivationConsentClosed {app, release, outcome}`), `tests/support/gateway/mod.ts`
- 계약:
  - 쓰는 것: tr-support-app의 `tests/support/app/activate.ts`(`startTestApp`, `aeLane`, `prepareRelease`, `activateRelease`, `deliverRelease`, `approveActivation`, `waitRunning`), `source.ts`(`amendAppSource`), `deps.ts`(`appCoreEnv`); `packages/protocol/apps/activation/consent.ts`(`activationConsents`, `activationConsent`), `packages/protocol/apps/activation/activation.ts`(release 기록과 `failure`), `packages/protocol/events/transient.ts`(`ActivationConsentRequested`, `ActivationConsentClosed`), `tests/support/gateway/mod.ts`
    - tr-support-app의 `activateTestApp`(첫 release까지 한 번에)과 `source.ts`의 `sampleDomain`
  - 내놓는 것: 없음

## 할 일

근거: README "정한 것" 표의 `app-activation` 줄과 `architecture/activation.md`. 사용자 data를 잃는 규칙(migration 실패 복원, 이전 release 다시 띄움, 재시작 뒤 이어 감)을 지키는 계획의 가장 중요한 e2e다. 행이 재는 것은 바꾸지 않고 길만 바꾼다: ticket 맡기기와 `ticket.verify` → App Engineer의 `release_prepare`·`release_activate`(helper가 가짜 model로 부른다), 보류 approval → 동의 줄(`activations.consents`, `activation.consent`), reaction turn → `release_activate` tool 결과.

1. `tests/support/app/patch-migration.ts`
   - `slowReadPatch` 60-61의 slug를 `await sampleDomain(dir)`(`./source.ts`)로 바꾼다. 이유: source 폴더가 `<home>/apps/<app id>/source`라 폴더 이름이 slug가 아니다(tr-support-app "정한 것" 3).
   - 주석: 머리 1-2의 "platform app test를 통과해야 한다"를 "release 준비의 검사(빈 DB와 active release schema에서 migration, handler 대조)를 지나야 한다"로. `failingMigrationPatch` 14-17은 "release 준비의 migration 검사(빈 DB와 active release의 schema에서 돌린다)는 지나고, 같은 title의 row가 둘 이상 있는 운영 DB에서만 activation 때 실패한다"로.
   - 나머지 patch와 `resetSource`는 그대로다.
2. `tests/e2e/app-activation_test.ts`를 다시 쓴다. 한 `Deno.test`, core 하나, 앱 하나, 행은 아래 순서대로 앞 행의 release를 이어 쓴다(지금과 같다).
   1. 머리 주석의 세 질문을 새 길로 고친다: contract `app-releases`·`app-data`(migration 전 복구본을 확정하고 실패하면 복원해 이전 release를 다시 띄운다. 실패 기록은 fail 한 tx이고 `release.activate`가 그것을 돌려준다. 더 새 release의 activation이 시작되면 이전 동의 줄을 닫는다. 허락은 표에 남아 재시작에 다시 적용된다) / 회귀(data가 반쯤 바뀐 채 남음, 이전 release가 안 뜸, 실패 이유가 App Engineer에게 안 닿음, 넓어진 선언을 묻지 않고 올림, 낡은 동의가 새 release에 쓰임, 허락이 재시작에 사라짐) / 왜 지금 test로 못 잡나(지금과 같다). fake 대답 줄: "행의 fake 대답은 앱 activation helper(`deliverRelease`, `prepareRelease`, `activateRelease`)가 거는 App Engineer의 `release_prepare`·`release_activate`뿐이라 행 상한(3)에 세지 않는다(`architecture/testing.md` "case 고르는 규칙" 4)".
   2. 준비
      - `bootCore(run, { env })`(`env = await appCoreEnv()`, `../support/app/deps.ts`), `connectFakeProvider`, `app = await activateTestApp(core, fake, { name: "Notes", slug: "notes" })`, `base = app.commit`, `v1 = activeOf(...)`, `add_item {title: "dup"}` 두 번(첫 invocation은 `firstWrite`), `seeded = ["dup", "dup"]`.
      - `gateway = await connectGateway(core, { conditions: [{ types: ["ActivationConsentClosed"] }] })`. 재시작 뒤에는 다시 열지 않는다(재시작 뒤 행은 event를 보지 않는다). finally에서 닫는다.
      - test 안 helper 둘. 둘 다 `resetSource(app.source, base)` 뒤 patch마다 `amendAppSource(app.source, patch)`를 한다.
        - `deliver(patches)` → `deliverRelease(core, fake, app, { goal: "Make the next release" })`(`{ release, activated }`)
        - `prepareOnly(patches)` → `prepareRelease(core, fake, app)`. `prepared`가 아니면 stage와 reason으로 던지고, 맞으면 release id.
      - `reboot()`: `core.kill()` → `core = await bootCore(run, { env })` → `settle(core)`(runtime이 ready여야 다음 App Engineer turn이 끊기지 않는다). `reportHarness`와 Gateway 다시 열기는 없다.
      - 지운다: `approvalsDecide`·`approvalsPending`·`verifyTicket`·`reportHarness` import, `activationRequests`, `deliver`의 `verify`·`reaction` 옵션, `ReleaseActivationFailed` watch와 reaction turn 단정, `gateways` 배열.
   3. 행(단정은 행마다 서로 다른 곳에서. 화면 문구는 단정하지 않는다)

      | 행 | 하는 일 | 단정 |
      |---|---|---|
      | `fail-keeps-data` | `failing = deliver([failingMigrationPatch])`. `release_activate`가 activation의 끝(120초 안)을 기다린다 | route(tool 결과): `failing.activated`가 `{ status: "failed", failure: { code: "migration_failed", restored: true } }`이고 `failure.summary`에 `step 1-2 was rolled back`과 `UNIQUE constraint failed`가 있다. ledger: `recordOf(failing.release)`가 `failed`이고 그 `failure`가 tool 결과의 `failure`와 같다. `activeOf`가 `v1`. app state: v1이 다시 답하고(`until`) `titles`가 `seeded`, runtime이 `running`이고 observation의 release가 `v1` |
      | `widened-asks` | `widened = deliver([widenPatch])` → `approveActivation(core, app, "allow")` → `waitRunning(core, app, widened.release)` | route: 동의 전 `widened.activated.status`가 `waiting_consent`이고 `activationConsents {app}`이 그 release의 줄 하나이며 `comparison.added_resources`가 하나다. ledger: 동의 전 `activeOf`가 `v1`, 뒤에 `widened.release`이고 `v1`이 `superseded` |
      | `rewind-not-across-release` | 지금(230-236)과 같다 | 지금과 같다 |
      | `supersedes-pending` | `pending = deliver([widenPatch2])`(`waiting_consent`), `[stale] = activationConsents {app}`의 줄. `newer = deliver([codeOnlyPatch])`(묻지 않는다) → `waitRunning(core, app, newer.release)`. 그 뒤 늦은 `core.tryCall(activationConsent, { release: pending.release, choice: "allow" }, { requested_at: stale.requested_at })` | route: `newer.activated.status`가 `active`, 늦은 동의가 `conflict`, `activationConsents {app}`이 빈 목록. event: `gateway.next("event", …)`로 받은 `ActivationConsentClosed`의 payload가 `{ app, release: pending.release, outcome: "cancelled" }`. ledger: `pending.release`가 `prepared`이고 `activeOf`가 `newer.release` |
      | `rollback` | 지금(263-280)과 같다(`activationActivatePrevious`로 `widened.release`, superseded 아닌 `failing.release`는 `invalid_input`) | 지금과 같다 |
      | `holds-calls` | `slowOne = deliver([slowReadPatch])` → `waitRunning`. `swap = prepareOnly([slowReadPatch, codeOnlyPatch])`. 5초 읽기 `slow = call(…, "delay", { ms: 5000 })`를 await 없이 시작한 뒤 `activating = activateRelease(core, fake, app, swap)`도 await 없이 시작한다. `activationsQueue`에서 `swap`의 `step === "drain"`을 기다려 `held = call(…, "add_item", { title: "held" })`. 붙잡은 수(`held_calls >= 1`)를 기다린다 | route: `slow`와 `held`가 둘 다 `succeeded`, `(await activating).status`가 `active`. ledger: `held`의 invocation `release`가 `swap`. process: `waitRunning(core, app, swap)`. 뒤 행을 위해 `seeded.push("held")` |
      | `allow-reapplied-after-restart` | `reapplied = deliver([slowReadPatch, widenPatch3])`(`waiting_consent`) → `approveActivation(core, app, "allow")` → `reboot()` → `waitRunning(core, app, reapplied.release)` | ledger: `activeOf`가 `reapplied.release`이고 그 기록이 `active`. route: `activationConsents {app}`이 빈 목록(두 번 적용되지 않았다). process: `appProcesses`가 1 |
      | `restart-resume` | `resumed = prepareOnly([slowReadPatch, codeOnlyPatch])`. `slowAgain`(5초 읽기)과 `activating = activateRelease(…).catch(() => undefined)`를 await 없이 시작하고(그 App Engineer turn은 kill에 끊긴다), `resumed`의 `drain`을 기다려 `reboot()` | ledger: 기록이 `active`나 `failed`로 닫히고(`until`) `activeOf`가 그에 맞다(`active`면 `resumed`, 아니면 `reapplied.release`). process: `waitRunning` 뒤 `appProcesses`가 1. app state: `titles`가 `seeded`. 행 끝에 `await activating`과 `slowAgain`을 받아 test 밖에 남는 요청이 없게 한다 |
      | `rollback-refused` | `migrated = deliver([okMigrationPatch])`(묻지 않는다) → `waitRunning(core, app, migrated.release)` → `activationActivatePrevious { release: reapplied.release }` | ledger: `migrated` 기록의 `data_schema`가 2. route: 되돌리기가 `invalid_input`. app state: `titles`가 `seeded` |

      - 정한 것: `holds-calls`와 `restart-resume`은 `prepareOnly` 뒤 `activateRelease`를 await 없이 시작한다. 이유: 옛 test는 `verify: false`로 activation 시작을 늦춰 5초 읽기가 먼저 돌게 했다. 지금은 `release.activate`가 시작이고 그 tool 호출이 activation 끝까지 turn을 붙든다. 읽기를 먼저 시작하고 App Engineer의 model 요청을 한 번 거친 뒤 activation이 시작되므로 drain이 그 읽기를 기다린다(읽기는 invocation을 남기지 않아 실행 중인 것을 볼 수 없는 것은 지금과 같다).
      - 정한 것: `fail-keeps-data`는 release 기록을 `until`로 기다리지 않는다. 이유: `release.activate`가 시도의 끝을 120초까지 기다려 `failed`를 돌려준다(`architecture/activation.md`). `running`이 오면 실패로 둔다(2줄 data의 migration이 120초를 넘는 것은 그 자체로 회귀다).
      - `activationsCompare`는 쓰지 않는다. 동의 줄의 `comparison`이 같은 값이다.
3. 돌려 본다: `deno task e2e:deps` 한 번 뒤 `deno test --allow-all --no-check tests/e2e/app-activation_test.ts`. 두 번 연속 통과를 확인한다(10번은 lead가 merge 전에 돈다, `architecture/testing.md` "case 고르는 규칙" 7). flaky하면 test를 느슨하게 맞추지 말고 원인(helper, 제품)을 보고한다(같은 문서 규칙 8).

## 끝남

- `deno task check`가 통과한다(이 file들은 `NOT_CHECKED`와 `tests/e2e` 안이라 type check에 들지 않는다).
- `deno check tests/e2e/app-activation_test.ts tests/support/app/patch-migration.ts`가 오류 없이 끝나고, 같은 file에 `deno fmt --check`와 `deno lint`가 통과한다.
- `deno task e2e:deps` 뒤 `deno test --allow-all --no-check tests/e2e/app-activation_test.ts`가 두 번 연속 통과한다.
- 위험 test: "release activation은 migration이 실패하면 data와 이전 release를 그대로 두고 실패를 `release_activate` 결과와 release `failure`에 싣고, 넓어진 선언은 동의로만 올리며 낡은 동의를 쓰지 않고, 재시작을 넘는다"(`tests/e2e/app-activation_test.ts`. 사용자 data를 잃는 규칙과 동의라는 권한 경계)
- 남지 않음:
  - `grep -nE "approvalsDecide|approvalsPending|verifyTicket|reportHarness|ReleaseActivationFailed|support/coding|gateway/shell|ticket|reaction|verify:" tests/e2e/app-activation_test.ts`가 0줄이다.
  - `grep -nE 'split\("/"\)|platform app test' tests/support/app/patch-migration.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check(위 `deno check`·fmt·lint, `deno task check`, e2e 두 번)
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것" 둘을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 잰 것: test 한 번에 걸린 시간과 release 하나(prepare + activate)의 평균(e2e 전체 10분 예산, `architecture/testing.md` "층")
- 제품에서 본 것: 행이 제품 동작과 달라 떨어졌으면 그 행, 기대, 실제(test를 맞추지 않는다)
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
