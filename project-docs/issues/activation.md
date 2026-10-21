# activation

App Engineer가 준비한 release를 운영 앱으로 올리는 순서와 실패 복구, 그 앞의 release 준비. `project-docs/architecture/activation.md`.

## release 준비가 떨어진 이유가 고칠 곳을 가리키지 않는다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/main]
```

지금: `release.prepare`는 떨어진 단계와 이유를 `{status: "failed", stage, reason}`으로 돌려주지만(`packages/core/apps/control.ts`의 `releasePrepareHandler`), 세 단계의 이유가 모두 짧다.
- migration: 검사(`packages/core/apps/releases/prepare/checks.ts`의 `checkMigration`)는 activation과 같은 `migrateAppDatabase`(`packages/core/apps/data/worker/migrate.ts`)를 fixture DB에 건다. 단계가 실패하면 `applyStep`(`packages/core/apps/data/worker/db.ts`)이 SQL 오류를 `catch {}`로 버리고 "migration step rolled back"만 돌려주고, PRIMARY KEY 없는 새 표의 이름이 담긴 오류도 `migrateAppDatabase`가 `failed = true`로만 받아 버린다. 결과는 `restored: true` 하나라 reason은 "a step failed and was rolled back. Check the SQL of each step …" 같은 일반 글이다.
- build: 준비 자식(`packages/core/main/worker/release-job.ts`)의 실패 이유는 `prepareFromSource`(`packages/core/apps/releases/prepare/from-source.ts`)의 code(`blueprint_eval_failed`, `deno_json_missing` 같은 것)뿐이고 blueprint를 평가한 deno의 출력이 없다.
- handlers: preview launcher(`packages/core/apps/preview/launcher.ts`)가 선언한 tool과 앱이 알린 tool이 다르면 "handler or schema mismatch"만 낸다. 그 자리에서 두 목록을 갖고 있지만 어느 tool이 빠지거나 더해졌는지 싣지 않는다.

영향: App Engineer는 어디를 고칠지 모른 채 다시 짓는다. shell에서 `deno task check`나 단계 SQL을 따로 돌려 이유를 다시 찾아야 하고, 그동안 release를 못 낸다. activation의 migration 실패 이유도 같은 자리에서 사라진다.

고치려면:
- migration: `applyStep`이 sqlite 오류 글을 message에 싣고, `migrateAppDatabase`가 실패한 단계(`from-to`)와 그 message를 `restored: true` 결과에 함께 돌려준다. 검사는 그 글을 reason에 붙인다(작음. 앱이 쓴 SQL의 오류 글이라 secret 경계가 아니다).
- build: blueprint 평가가 실패하면 deno stderr의 앞 몇 줄을 reason에 붙인다(작음).
- handlers: launcher가 빠진 tool과 더해진 tool의 이름, schema 차이를 summary에 싣는다(작음).
- 셋 다 한다. **추천.**
