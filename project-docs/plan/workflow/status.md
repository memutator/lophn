# 상태

lead만 고친다. `tools/status.py workflow build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `wf-contract` | workflows | 1 | 없음 | merged | workflows/wf-contract | a2d63f5e8 |  |
| `wf-artifact-source` | artifact | 2 | wf-contract | todo |  |  |  |
| `wf-cli` | cli | 2 | wf-contract | todo |  |  |  |
| `wf-kit-graph` | kit | 2 | wf-contract | todo |  |  |  |
| `wf-agent-tools` | roles | 2 | wf-contract | todo |  |  |  |
| `wf-role-text` | roles | 2 | wf-contract | todo |  |  |  |
| `wf-write-scope` | roles | 2 | wf-contract | todo |  |  |  |
| `wf-wireframe` | shell | 2 | wf-contract | running | shell/wf-wireframe |  |  |
| `wf-decl-reader` | workflows | 2 | wf-contract | running | workflows/wf-decl-reader |  |  |
| `wf-step-input` | workflows | 2 | wf-contract | running | workflows/wf-step-input |  |  |
| `wf-store` | workflows | 2 | wf-contract | running | workflows/wf-store |  |  |
| `wf-sidebar-activity` | activity | 3 | wf-wireframe | todo |  |  |  |
| `wf-artifact-serve` | artifact | 3 | wf-artifact-source | todo |  |  |  |
| `wf-kit-build` | kit | 3 | wf-kit-graph | todo |  |  |  |
| `wf-artifact-tab` | shell | 3 | wf-artifact-source | todo |  |  |  |
| `wf-commands` | workflows | 3 | wf-store, wf-step-input | todo |  |  |  |
| `wf-screen-source` | shell | 4 | wf-wireframe, wf-service | todo |  |  |  |
| `wf-service` | workflows | 4 | wf-commands, wf-decl-reader | todo |  |  |  |
| `wf-screen-tab` | shell | 5 | wf-screen-source, wf-artifact-tab | todo |  |  |  |
| `wf-screen-sidebar` | shell | 6 | wf-screen-tab, wf-sidebar-activity | todo |  |  |  |
