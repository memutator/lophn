# jobs-archive-and-erase

보관된 앱·project를 가리키는 `job`을 `enabled` 변경 없이 동적으로 건너뛰고(`target_unavailable`, `job.claim_due` cycle 전진, `job.activity` 제외), `agent.delete` 및 `workflow.rename`/`workflow.delete`용 `job` 정리 함수를 제공한다.

- 단위: jobs (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/jobs/ports.ts`
  - `packages/core/jobs/reads.ts`
  - `packages/core/jobs/commands.ts`
  - `packages/core/jobs/due.ts`
  - `packages/core/jobs/events.ts`
  - `packages/core/jobs/store.ts`
  - `packages/core/jobs/scheduler.ts`
  - `packages/core/jobs/commands_test.ts`
  - `packages/core/jobs/due_test.ts`
  - `packages/core/jobs/events_test.ts`
  - `packages/core/main/daemon/wiring/jobs-registration.ts`
- 읽을 것:
  - `project-docs/architecture/job.md`
  - `project-docs/products/roadmap/cascade.md`
- 계약:
  - 쓰는 것: `packages/protocol/jobs/jobs.ts` (`jobRecordSchema.target_unavailable`)
  - 내놓는 것: `eraseJobsOfAgent`, `eraseJobsOfWorkflow`, `renameJobsOfWorkflow` exported from `packages/core/jobs/commands.ts` (and `packages/core/jobs/mod.ts` if appropriate — leave `mod.ts` untouched or report if export needed)

## 할 일

1. Extend `JobTargets` / `JobEventPolicy` (or add `jobTargetAvailabilityPort` in `packages/core/jobs/ports.ts` and implement in `packages/core/main/daemon/wiring/jobs-registration.ts` using `apps` and `projects` tables in SQL): check whether an app or project is `archived` or missing without direct SQL in `packages/core/jobs/`.
2. Add pure helper `isJobTargetUnavailable(job, availability)`: returns `true` when `action.kind === "tool_run"` and `action.app` is unavailable/archived; `action.kind === "agent_run"` and `action.workspace` is an archived app or archived project; `action.kind === "workflow_start"` and `action.project` is archived; or `trigger?.kind === "event"` and source app is archived.
3. Without mutating `jobs.enabled`:
   - In `job.list` (`packages/core/jobs/reads.ts`): set `target_unavailable: true` when unavailable (omit or set `false` when available).
   - In `job.claim_due` (`due.ts` / `commands.ts`): when a due job has `isJobTargetUnavailable === true`, do NOT insert a `job_runs` row or hold; for recurring (`every`), advance `next_due_at` to the next cycle after `now`; for `once`, clear `next_due_at` to `null` (keeping `enabled` intact) or skip claiming cleanly so unarchiving resumes recurring cycles automatically.
   - In event trigger dispatch (`events.ts` / `commands.ts`): skip triggering jobs whose target is unavailable/archived.
   - In `job.activity` (`store.ts` / `reads.ts`): exclude `enabled = 1` jobs whose target is unavailable/archived so archived apps/projects do not block idle-exit.
4. Export deterministic Tx helpers from `packages/core/jobs/commands.ts`:
   - `eraseJobsOfAgent(tx, agent: { id: string; handle: string; workspace: Workspace | null }): { id: Id<"job">; title: string; summary: string }[]` — delete jobs where creator matches `agent.id` (matching scope) OR `action_kind = 'agent_run'` targets that agent's handle in scope, deleting associated `job_runs` first and pushing `jobsChanged(tx)` if any deleted, returning erased specs for semantic handoff.
   - `eraseJobsOfWorkflow(tx, project: Id<"prj">, workflow: string): { id: Id<"job">; title: string; summary: string }[]` — delete `workflow_start` jobs targeting `{ project, workflow }`.
   - `renameJobsOfWorkflow(tx, project: Id<"prj">, from: string, to: string): number` — update `action_json` (`workflow = to`) for `workflow_start` jobs in `project` where `workflow = from`.
5. Add concise risk unit tests in `packages/core/jobs/commands_test.ts` and `due_test.ts` covering archived app/project dynamic skip + `next_due_at` advance + `unarchive` resume + `activity` exclusion + `eraseJobsOfAgent` + `renameJobsOfWorkflow` + `eraseJobsOfWorkflow`.

## 끝남

- `npx tsc --noEmit -p tsconfig.node.json` passes
- `node tools/electron-node.ts --test packages/core/jobs/*_test.ts` passes
- `node tools/check-deps.ts` passes

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
