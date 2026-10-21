# activation

ticket 확인됨 뒤 prepared release를 운영 앱으로 올리는 순서와 실패 복구. `project-docs/architecture/activation.md`.

## migration 단계가 실패한 이유가 release 준비의 결과에 닿지 않는다

```yaml
kind: bug
modules: [packages/core/apps]
```

지금: release 준비의 migration 검사(`packages/core/apps/releases/prepare/checks.ts`의 `checkMigration`)는 activation과 같은 `migrateAppDatabase`(`packages/core/apps/data/worker/migrate.ts`)를 fixture DB에 건다. 단계가 실패하면 `applyStep`(`packages/core/apps/data/worker/db.ts`)이 SQL 오류를 `catch {}`로 버리고 "migration step rolled back"만 돌려주고, PRIMARY KEY 없는 새 표의 이름이 담긴 오류도 `migrateAppDatabase`가 `failed = true`로만 받아 버린다. 결과는 `restored: true` 하나라 검사의 reason은 "a step failed and was rolled back. Check the SQL of each step for errors, and that every new table has a PRIMARY KEY." 같은 일반 글이다.

영향: App Engineer는 어느 단계의 어느 SQL이 왜 떨어졌는지 모른 채 migration을 고친다. 단계를 shell에서 따로 돌려 오류를 다시 찾아야 하고, 그동안 release를 못 낸다. activation의 실패 이유도 같은 자리에서 사라진다.

고치려면:
- `applyStep`이 sqlite 오류 글을 message에 싣고, `migrateAppDatabase`가 실패한 단계(`from-to`)와 그 message를 `restored: true` 결과에 함께 돌려준다. 검사는 그 글을 reason에 붙인다(작음. 앱이 쓴 SQL의 오류 글이라 secret 경계가 아니다). **추천.**
