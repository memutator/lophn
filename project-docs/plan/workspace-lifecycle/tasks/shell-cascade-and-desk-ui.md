# shell-cascade-and-desk-ui

삭제 확인 창(영향 0곳이면 바로 삭제, 1곳 이상이면 `[Delete & clean up now]` 기본 + `[Delete only]` 보조), workflow 이름 변경·삭제와 열린 창 desk 동기화, 보관된 `job`의 `target_unavailable` 표시, Inbox의 `workspace_update_needed`·open follow-up 연결을 구현한다.

- 단위: shell-ui (wave 2)
- 선행: `cascade-deterministic-core, workspace-reader-and-followups`
- 소유(이 task만 고친다):
  - `packages/shell/**`
  - `packages/design/i18n/catalog/**`
  - `tools/wireframes/**`
- 읽을 것:
  - `project-docs/products/roadmap/{platform-update,cascade}.md`
  - `project-docs/issues/workflow-rename-merges-desk-into-main.yaml`
  - `packages/shell/renderer/shell/delete-app-dialog.tsx`
  - `packages/shell/renderer/workspace/agents/editor/tab-who.tsx`
  - `packages/shell/renderer/workspace/sidebar/{artifact-panel,workflow-panel}.tsx`
  - `packages/shell/renderer/workspace/workspace-window.tsx`
- 계약:
  - 쓰는 것: `impact.read`, `artifacts.delete`, `workflows.rename`, `workflows.delete`, `follow_up.list`, `WorkflowRenamed`, `WorkflowRemoved`, `workspace_update_needed`
  - 내놓는 것: updated shell main/preload/renderer, i18n keys, wireframes fake sources

## 할 일

1. Route artifact deletion through core `artifacts.delete` (project AND app artifacts) in `packages/shell/ipc/artifact.ts`, `packages/shell/main/artifact/artifact-ipc.ts`, `packages/shell/main/desktop/wiring/artifact.ts`, keeping `views.removeSource` on success.
2. Add cascade delete confirmation UI (App, Agent, Artifact, Workflow):
   - Call `impact.read` before confirming delete; show `immediate` deletions and `declared` affected places if `declared.length >= 1`, with primary **`[Delete & clean up now]`** (`clean_up: "now"`, opening/focusing the returned `handoff_session`) and secondary **`[Delete only]`** (`clean_up: "later"`). If `declared.length === 0`, preserve lightweight delete behavior.
   - Wire into `DeleteAppDialog`, Agent editor delete in `tab-who.tsx`, `ArtifactPanel` delete (for both project & app workspaces), and add Rename (`workflows.rename`) + Delete (`workflows.delete`) actions to `WorkflowPanel`.
3. Relay `WorkflowRenamed` and `WorkflowRemoved` in shell `desktop/wiring/layout.ts` / renderer `workspace-window.tsx`: on `WorkflowRenamed`, rename `desks[from]` → `desks[to]` and `workflow:<from>` tabs atomically before refreshing workflow list so `mergeVanished` does NOT merge renamed workflow desks into Main; on `WorkflowRemoved`, remove the workflow tab/desk cleanly.
4. Show `target_unavailable` paused/archived-target state in Jobs UI, switch `sdk_update_needed` / `update-apps` across `desktop/wiring/notice.ts`, `connection/waiting/{notice-kinds,notice-action,fake-source}.ts`, `agent-tab-fake-commands.ts`, `agents/fake-data.ts`, `i18n/catalog/*.ts`, and surface open `follow_up_items` in Inbox so `[Delete only]` backlog is actionable.

## 끝남

- `npm --prefix packages/shell/main run check && npx tsc --noEmit -p packages/shell/renderer && node packages/shell/renderer/build.ts` passes
- `npm run check` (including `style`, `kit`, `flows`, `wireframes` smoke if touched) passes

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
