# rr-prepare-reasons

`release.prepare`가 떨어진 이유(`{status: "failed", stage, reason}`)가 고칠 곳을 가리키게 한다. migration은 실패한 단계(`from-to`)와 SQLite 오류 글을, build는 deno가 낸 stderr의 앞 몇 줄을, handlers는 빠지거나 더해진 tool 이름과 data schema 차이를 reason에 싣는다.

- 단위: prepare-reasons (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/data/worker/{db.ts,migrate.ts}`
  - `packages/core/apps/releases/prepare/{checks.ts,checks_test.ts,from-source.ts}`
  - `packages/core/apps/preview/launcher.ts`
- 읽을 것:
  - 계획: `project-docs/plan/reactor-remove/README.md`의 "목표"(ae-builds가 남긴 것)와 "정한 것"(release 준비 이유)
  - 이슈: `project-docs/issues/activation.md`의 "release 준비가 떨어진 이유가 고칠 곳을 가리키지 않는다". "고치려면"의 셋을 다 한다. 이 task로 닫힌다(lead가 `issue` skill로 닫는다).
  - 앞 계획: `project-docs/products/change-log/0.6.0.md`의 "App Engineer가 앱을 직접 짓고, ticket과 test runner를 지운다". "후"의 `release.prepare`(준비 자식이 의존성과 migration을 검사하고, core가 봉인한 뒤 preview launcher로 blueprint와 handler를 대조한다. 떨어지면 `{status: "failed", stage, reason}`)와 "결정"(검사 실패는 오류 code가 아니라 `failed` 결과다. model은 오류 code마다 고정 글만 받는다)
  - architecture: `project-docs/architecture/activation.md`("흐름"의 migration과 실패 때 되돌리기), `project-docs/architecture/app-call.md`("지키는 것"의 preview는 따로 띄운 process와 일회용 DB). reason의 모양을 적은 문서는 없다.
  - App Engineer 지침: `packages/core/agent-roles/roles/app-engineer/prompt.md` 80("`failed` gives `stage` and `reason`: fix, commit, prepare again"). 고치지 않는다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-releases`, `app-data`, `app-runtime`; `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 코드(줄은 main `15f282fcd`. `083e55064`까지 코드는 같다)
    - reason이 가는 길: `packages/core/main/worker/release-job.ts`(준비 자식. 93-94 build, 69 dependencies, 86 migration)가 stdout 마지막 줄에 `{ok: false, stage, reason}`을 쓰고, `packages/core/main/app-supervisor/release-runner.ts` 107-134(`readOutcome`)가 읽는다. 준비 자식의 stderr는 버린다(69-70 `stderr: "null"`). core의 `releasePrepareHandler`(`packages/core/apps/control.ts` 491-)가 그대로 돌려준다(574-578, handlers는 595-599). 길 위에 길이 상한은 없다(`reason: z.string()`, `packages/core/apps/runtime/control-protocol.ts` 171).
    - migration: `packages/core/apps/data/worker/db.ts`의 `applyStep`(type 26-31, 구현 97-137. PRIMARY KEY 없는 새 표는 110-116에서 `MIGRATION_PRIMARY_KEY_REQUIRED: <표>`로 실패하고, SQL 오류는 129-136에서 `catch {}`로 버리고 `"migration step rolled back"`만 돌려준다). `packages/core/apps/data/worker/migrate.ts`의 `MigrateOutcome`(34-38), 단계 loop(118-139. 단계 script가 없거나(122-125) `applyStep`이 실패하면(132-135) `failed = true`로만 받는다), 복원 결과(140-155. `restored: true`뿐이다). `packages/core/apps/releases/prepare/checks.ts`의 `migrateOnce`(91-119, 115-117의 일반 글), `listed`와 `LIST_MAX`(24-31).
    - activation도 같은 `migrateAppDatabase`를 data job 자식에서 부른다(`packages/core/apps/data/worker/job.ts` 151-167은 `.result`만 쓴다). 자식의 실패와 복원 결과는 core에 닿기 전에 지워진다(`packages/core/main/app-supervisor/data-runner.ts` 60 `stderr: "null"`, 72-77 "data job failed"; `packages/core/apps/releases/activation/steps.ts` 194-205 `changeData`가 목표 아닌 schema를 "data change failed"로; `orchestrator.ts` 121-130 summary "the data change failed").
    - build: `packages/core/apps/releases/prepare/from-source.ts`의 `runDeno`(59-102, stderr를 이미 받는다), blueprint 평가(255-268, 268 `fail("blueprint_eval_failed")`), 화면 build(273-297, 295 `console.error(built.stderr)`는 준비 자식의 버려지는 stderr로 간다), npm·jsr 받기 `fetchExternal`(177-191, 191 `fail("dependency_fetch_failed", "unavailable")`). staging은 `<data root>/apps/<app>/staging/<uuid>`이고(235-236) deno 출력의 경로가 이것을 가리킨다. deno는 pipe에도 색 escape(`\x1b[…m`)를 쓴다(`NO_COLOR` 없이 돌린다).
    - handlers: `packages/core/apps/preview/launcher.ts` 299-311(선언한 tool `launch.tools`와 앱이 알린 tool `probe.tools`, `launch.dataSchema`와 `probe.dataSchema`를 비교하고 `"handler or schema mismatch"`만 낸다). 이 summary가 preview 관측의 `reason.summary`로 `packages/core/apps/preview/service.ts`의 `check`(346-387, 373)를 지나 handlers reason이 된다. preview 상태 읽기의 `reason`(`service.ts` 158)에도 같은 글이 보인다.
    - 같은 글이 activation의 후보 process 확인에도 있다(`packages/core/apps/runtime/supervisor/supervisor.ts` 438-454). 같은 bundle이 준비에서 이미 handler 검사를 지났으니 고치지 않는다.
    - test: `packages/core/apps/releases/prepare/checks_test.ts`(`migrationOk` 12-45는 reason이 비지 않았는지만 본다. 표 47-84에 "단계 실패" 57-66, "PRIMARY KEY 없는 표" 67-73)
- 계약:
  - 쓰는 것: `release.prepare` 결과 `{status: "failed", stage, reason}`(`packages/core/apps/control.ts`의 `prepareFailed`), 준비 자식의 결과 줄(`release-job.ts`의 `ReleaseJobResult`)
  - 내놓는 것: 모양은 그대로다. `reason` 글만 길어진다. `migrateAppDatabase`의 복원 결과는 실패한 단계와 그 글을 싣는다(예: `{ result, restored: true, failed: { step: "1-2", message: "no such table: missing" } }`. 이름은 worker가 정한다). `AppDatabase.applyStep`의 실패 message는 SQLite 오류 글을 싣는다.

## 할 일

근거: 이슈의 "고치려면" 셋(README "정한 것"). 덧붙이는 글은 짧게 자른다(AGENTS.md "속도"): 오류 글은 한 줄 300자, deno stderr는 앞 5줄 500자, tool 이름은 `checks.ts`의 `listed`처럼 5개와 "and N more". 자르는 helper는 file마다 작게 둔다(`checks.ts`는 core module graph에 넣지 않는 file이라 `launcher.ts`가 import하지 않는다. `checks.ts` 1-4 주석).

1. migration
   - `db.ts`의 `applyStep`: `catch (error)`로 받아 SQLite 오류 글을 message에 싣는다(예: `migration step rolled back: no such table: missing`). PRIMARY KEY 갈래(110-116)는 지금 글 그대로다.
   - `migrate.ts`: 단계가 실패하면 그 단계(`${from}-${to}`)와 `applyStep`의 message를 복원 결과(`restored: true`)에 함께 돌려준다. 단계 script가 없어서 멈춘 경우도 그 단계와 짧은 글("no script for the step" 같은 것)을 싣는다. 복원 자체가 실패하면 지금처럼 그 err를 돌려준다.
   - `checks.ts`의 `migrateOnce`: 복원 결과의 단계와 글을 reason에 붙인다. 예: `Migration from schema 1 to schema 2 failed: step 1-2 was rolled back: no such table: missing. Fix that step's SQL; every new table needs a PRIMARY KEY.` 지금의 일반 글은 이 글로 바꾼다.
   - `job.ts`(activation의 data job)는 고치지 않는다. 바뀐 결과 type에 compile 오류가 나면 소유 밖이니 고치지 말고 보고한다(`.result`만 읽으므로 나지 않아야 한다).
   - 정한 것: activation의 `migration_failed` summary("the data change failed")는 이 task에서 바꾸지 않는다. 이유: data job 자식의 결과가 core에 닿기 전에 지워진다(stderr를 버리고 성공 줄만 읽는다, 위 "코드"). 글을 실으려면 data job 결과 줄의 protocol(`packages/protocol/apps/activation/data-job.ts`), `data-runner.ts`, activation port와 `changeData`를 같이 바꿔야 해서 작지 않다. 같은 단계 SQL은 준비 검사가 빈 DB와 active release의 schema에서 먼저 돌린다. 보고의 "알려진 미완 동작"에 적는다.
2. build(`from-source.ts`)
   - deno를 돌린 실패 셋에 stderr의 앞 5줄(500자까지)을 code 뒤에 붙인다: `blueprint_eval_failed`(268), `ui_build_failed`(294-297. `console.error(built.stderr)`를 지운다), `dependency_fetch_failed`(191). 예: `blueprint_eval_failed: error: Uncaught (in promise) TypeError: SyntaxError: Expression expected …  at blueprint.ts:4:1`.
   - 붙이기 전에 색 escape를 지우고, staging 경로(`file://<staging>/`와 `<staging>/`)를 지워 앱 source 기준 상대 경로로 보이게 한다(`fetchExternal`도 staging 안 `.lophn/deps`에서 돈다, 312).
   - 정한 것: 이슈는 blueprint 평가만 적었지만 화면 build와 의존 받기도 같은 꼴로 붙인다. 이유: 셋 다 같은 build 단계에서 deno 출력 없이 code만 남고, App Engineer가 고치는 것(blueprint, 화면 code, package 판)이 그 출력에만 있다. 같은 helper 한 줄씩이다.
3. handlers(`launcher.ts` 299-311): 선언했지만 handler가 없는 tool, 선언 없이 handler만 있는 tool, data schema가 다르면 선언한 값과 앱이 알린 값을 summary에 싣는다. 예: `handler or schema mismatch: declared without a handler: notes.add; handler not declared: notes.remove; data schema declared 2, app reports 1`. 맞는 쪽은 적지 않는다.
4. test(`checks_test.ts`): `migrationOk`가 reason도 돌려주게 하고, 표의 "단계 실패"는 reason에 `1-2`와 `no such table: missing`이, "PRIMARY KEY 없는 표"는 `0-1`과 `notes`가 들어 있는지 본다. 새 file과 새 Deno.test를 만들지 않는다. build와 handlers는 test하지 않는다(deno 자식이나 preview process를 띄워야 한다. AGENTS.md "속도").

## 끝남

- `deno task check`가 통과한다.
- `deno test --no-check packages/core/apps/releases/prepare/checks_test.ts`가 통과한다.
- 위험 test: "migration 단계가 실패하면 release 준비의 reason에 그 단계와 SQLite 오류 글이 실린다"(기존 `checks_test.ts`의 표 test에 단정을 더한다. SQLite 임시 file만 쓰고 subprocess가 없다). 이 글을 두 곳(`applyStep`의 `catch {}`, `migrateAppDatabase`의 `failed = true`)에서 버렸다.
- 남지 않음
  - `git grep -n "a step failed and was rolled back" -- packages`가 0줄이다.
  - `git grep -n "fail(\"blueprint_eval_failed\")\|fail(\"ui_build_failed\", \"unavailable\")\|console.error(built.stderr)" -- packages/core/apps/releases/prepare/from-source.ts`가 0줄이다.
  - `git grep -n "summary: \"handler or schema mismatch\"" -- packages/core/apps/preview`가 0줄이다.
  - `git grep -n "unavailable(\"migration step rolled back\")" -- packages/core/apps/data/worker/db.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없으면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(복원 결과의 칸 이름, 자르는 길이, 할 일 1·2의 정한 것을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". activation의 `migration_failed` summary가 단계와 SQLite 오류 글을 싣지 않는 것(할 일 1의 정한 것)을 적는다.
