# activation

App Engineer가 준비한 release를 운영 앱으로 올리는 순서와 실패 복구, 그 앞의 release 준비. `project-docs/architecture/activation.md`.

## activation의 migration 실패 이유가 실패한 단계와 SQLite 오류 글을 싣지 않는다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/main, packages/protocol]
```

지금: activation은 data job 자식(`packages/core/apps/data/worker/job.ts`)에서 release 준비와 같은 `migrateAppDatabase`를 부른다. 단계가 되돌아가면 결과에 실패한 단계와 SQLite 오류 글(`failed`)이 실리지만, `job.ts`의 migrate 갈래는 `.result`만 돌려준다. core 쪽 `packages/core/main/app-supervisor/data-runner.ts`는 자식 stderr를 버리고(`stderr: "null"`) 마지막 결과 줄만 읽는다. `packages/core/apps/releases/activation/steps.ts`의 `changeData`는 목표가 아닌 schema를 "data change failed"로 바꾸고, `packages/core/apps/releases/activation/orchestrator.ts`가 `{ code: "migration_failed", summary: "the data change failed" }`로 되돌린다.

영향: 운영 data에서만 떨어지는 migration(준비 검사의 빈 fixture DB에는 없는 행이 제약에 걸리는 것 등)이면 App Engineer는 `release.activate`의 `failed`에서 어느 단계가 왜 떨어졌는지 모르고 다시 짓는다. 단계 SQL의 문법이나 PRIMARY KEY 같은 실패는 준비 검사가 빈 DB와 active release의 schema에서 먼저 돌려 이유와 함께 걸린다.

고치려면: data job 결과 줄(`packages/protocol/apps/activation/data-job.ts`)에 실패한 단계와 글을 싣고, `job.ts`가 `failed`를 넘기고, `data-runner.ts`, activation port의 `data.migrate`(`packages/core/apps/releases/activation/assembly.ts`), `changeData`가 그 글을 `migration_failed` summary까지 옮긴다(중간. protocol과 port를 같이 바꾼다). 글은 `applyStep`이 이미 한 줄 300자로 자른다. **추천.**
