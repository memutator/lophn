# cascade-deterministic-core

`agent.delete` 결정적 정리(MCP secret, `callPolicy`, open session, `job`), `artifacts.delete`의 core command 이전, workflow `flow_sdk` 도장·차단 및 `workflow.rename`·`workflow.delete`를 구현한다.

- 단위: cascade-core (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/agents/commands.ts`
  - `packages/core/lophn-agent/agents/ports.ts`
  - `packages/core/lophn-agent/agents/commands_test.ts`
  - `packages/core/projects/artifacts/mod.ts`
  - `packages/core/projects/artifacts/artifacts_test.ts`
  - `packages/core/projects/register.ts`
  - `packages/core/workflows/declaration.ts`
  - `packages/core/workflows/service.ts`
  - `packages/core/workflows/reads.ts`
  - `packages/core/workflows/ports.ts`
  - `packages/core/workflows/register.ts`
  - `packages/core/workflows/durable_test.ts`
  - `packages/core/workflows/service_test.ts`
  - `packages/core/workflows/reads_test.ts`
  - `packages/core/main/flow-host/check.ts`
  - `packages/core/main/flow-host/host_test.ts`
  - `packages/core/main/daemon/wiring/agent-delete.ts`
  - `packages/core/main/daemon/wiring/projects.ts`
  - `packages/core/main/daemon/wiring/workflows.ts`
  - `packages/core/main/daemon/wiring/workflows-files.ts`
  - `project-docs/flows/tests/core-rest.yaml`
- 읽을 것:
  - `project-docs/architecture/{agent-definition,artifact,workflow}.md`
  - `packages/core/main/daemon/wiring/apps-delete.ts` (pattern for closing sessions + cleaning rewind files + secrets/settings)
- 계약:
  - 쓰는 것: `packages/protocol/lophn-agent/agent-definitions.ts`, `packages/protocol/projects/artifact-api.ts`, `packages/protocol/workflows/{declaration,instances,routes}.ts`, `packages/protocol/events/transient.ts` (`WorkflowRenamed`, `WorkflowRemoved`)
  - 내놓는 것: `agentRemnantsEraser` / `agent-delete` wiring, `artifacts.delete` memory handler, `workflow.check` `flow_sdk` stamping, `StartWorkflow` `flow_sdk < supported_from` gate, `WorkflowRename` & `WorkflowDelete` handlers

## 할 일

1. **`agent.delete` deterministic cleanup**:
   - Define `agentRemnantsEraser` port in `packages/core/lophn-agent/agents/ports.ts` (and implement in `packages/core/main/daemon/wiring/agent-delete.ts`, exporting `createCoreRegistration` + `agentDeleteWiring` mirroring `apps-delete.ts`):
     - Delete sessions owned by the deleted agent via `deleteSession` in Tx + clean tool-results and rewind files after commit.
     - Erase jobs via `eraseJobsOfAgent` (from `packages/core/jobs/commands.ts` — note: DO NOT edit `packages/core/jobs/commands.ts`; call `eraseJobsOfAgent` signature `{ id, handle, workspace }` OR implement SQL delete inside `agent-delete.ts` / use SQL until Wave 1 merge if `eraseJobsOfAgent` isn't on base branch yet! Wait: to compile independently in Wave 1 before `jobs-archive-and-erase` merges, either query/delete the agent's jobs directly in `agent-delete.ts` inside Tx using `jobs` table OR note in "넘길 줄" — actually `check-deps.ts` allows `packages/core/main/daemon/wiring/` to import `jobs` AND wait: we cannot import `eraseJobsOfAgent` in Wave 1 if `jobs` branch hasn't merged yet! Let `agent-delete.ts` perform `DELETE FROM job_runs ...` + `DELETE FROM jobs ...` inside Tx cleanly OR extract helper call in Wave 2 cleanup! Even better: write the self-contained helper inside `agent-delete.ts` + unit test `agent-delete_test.ts`? Wait: don't create extra files not listed in 소유 unless listed; let `agent-delete_test.ts` be added or test in `commands_test.ts` / `projects` / `workflows`!). Let's keep `agent-delete.ts` deleting `mcp.<agt_id>.*` & `mcp-oauth.<agt_id>.*` from `secrets` (`ctx.secretStore` — note: check how `ctx.secretStore.delete` works!), removing `agents` rules referencing `handle` from `callPolicySetting`, closing open sessions, and deleting the agent's jobs!
     - Attach `erased_jobs` (array of `{ id, title, summary }`) to `agentDelete` output!
2. **`artifacts.delete` core command**:
   - Implement `remove` handler in `packages/core/projects/artifacts/mod.ts` (supporting both `{ project, name }` and `{ app, name }`, enforcing `artifactNameSchema`, `lstat`/`realpath` inside base folder, removing directory safely, returning `{ deleted: true, follow_ups: [], handoff_session: null }`).
   - Wire `${artifactsDelete.resource}/${artifactsDelete.method}` in `packages/core/main/daemon/wiring/projects.ts`. Also authorize `agent` actor to only delete artifacts in its own workspace (`project` or `app` matching `ctx.conditions.project`/`app`).
3. **Workflow `flow_sdk` stamping, enforcement & `WorkflowRename` / `WorkflowDelete`**:
   - Parse & preserve `flow_sdk` in `packages/core/workflows/declaration.ts`; compute `flow_sdk` & `flow_sdk_status` (`current` | `available` | `required`) for `flow.ts` workflows in `reads.ts` / `service.ts` (reading installed `@lophn/flow` `version` and `supported_from` from `<dataRoot>/sdk/flow/...` via `WorkflowFiles` port in `workflows-files.ts`, falling back to `packages/sdk/flow/package.json` or `"2.0.0"` if symlink/not yet installed; missing `flow_sdk` on `flow.ts` treated as `"1.0.0"`).
   - Stamp `flow_sdk: "<version>"` into `workflow.yaml` in `packages/core/main/flow-host/check.ts` when `flow.ts` passes typecheck (using `yaml` `parseDocument` to preserve comments/fields).
   - In `service.ts` (`StartWorkflow` & `list`): when `flow.ts` exists and `flow_sdk_status === "required"` (`< supported_from`), mark `startable: false` (problem `reason: "broken_flow"`) and reject `StartWorkflow` with `conflict` explaining `@lophn/flow` migration (`flow_sdk < supported_from`) is required.
   - Update ALL existing `flow.ts` test fixtures in `packages/core/workflows/{durable_test,service_test,reads_test}.ts` and `packages/core/main/flow-host/host_test.ts` to include `flow_sdk: "2.0.0"` (and add a dedicated test verifying missing/old `flow_sdk: "1.0.0"` is blocked!).
   - Implement `WorkflowRename` & `WorkflowDelete` in `workflows/service.ts`, `workflows-files.ts`, and `wiring/workflows.ts` (registering `workflowRename` & `workflowDelete` in `workflows/register.ts` `memoryRoutes` too):
     - `WorkflowRename`: rename directory `from` → `to`, update `workflow_instances`, `flow_sdk_reviews`, and `workflow_start` `jobs` targeting `{ project, from }` -> `to` in ledger, update `<dataRoot>/shell/workspaces/<prj>.json` desk key & `workflow:<from>` tab cleanly if file exists, publish transient `WorkflowRenamed`.
     - `WorkflowDelete`: verify exists, stop running instances of `{ project, name }`, erase `workflow_start` jobs & `flow_sdk_reviews` rows, remove `workflows/<name>` dir, update `<dataRoot>/shell/workspaces/<prj>.json` desk/tab cleanly if file exists, publish transient `WorkflowRemoved`.
   - Update `project-docs/flows/tests/core-rest.yaml` if any test outcomes/files changed.

## 끝남

- `npx tsc --noEmit -p tsconfig.node.json` passes
- `node tools/electron-node.ts --test packages/core/lophn-agent/agents/commands_test.ts packages/core/projects/artifacts/artifacts_test.ts packages/core/workflows/*_test.ts packages/core/main/flow-host/*_test.ts` passes
- `node tools/check-deps.ts && node tools/flows.ts check` passes

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것 (note `agentDeleteWiring` & `createAgentDeleteRegistration` for `assembly.ts`!)
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
