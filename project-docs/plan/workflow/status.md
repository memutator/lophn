# 상태

lead만 고친다. `tools/status.py workflow build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `wf-contract` | workflows | 1 | 없음 | merged | workflows/wf-contract | a2d63f5e8 |  |
| `wf-artifact-source` | artifact | 2 | wf-contract | merged | artifact/wf-artifact-source | 6b480af2b |  |
| `wf-cli` | cli | 2 | wf-contract | merged | cli/wf-cli | 71b8bb989 |  |
| `wf-kit-graph` | kit | 2 | wf-contract | merged | kit/wf-kit-graph | 6d0f78962 |  |
| `wf-agent-tools` | roles | 2 | wf-contract | merged | roles/wf-agent-tools | 337b038d1 |  |
| `wf-role-text` | roles | 2 | wf-contract | merged | roles/wf-role-text | 57650425a |  |
| `wf-write-scope` | roles | 2 | wf-contract | merged | roles/wf-write-scope | 275d9cdb3 |  |
| `wf-wireframe` | shell | 2 | wf-contract | merged | shell/wf-wireframe | a22b0aab6 | 사람 승인 대기 |
| `wf-decl-reader` | workflows | 2 | wf-contract | merged | workflows/wf-decl-reader | 4b2169127 |  |
| `wf-step-input` | workflows | 2 | wf-contract | merged | workflows/wf-step-input | 6522369b1 |  |
| `wf-store` | workflows | 2 | wf-contract | merged | workflows/wf-store | 8ac529c7e |  |
| `wf-sidebar-activity` | activity | 3 | wf-wireframe | merged | activity/wf-sidebar-activity | c0915b45a |  |
| `wf-artifact-serve` | artifact | 3 | wf-artifact-source | merged | artifact/wf-artifact-serve | e0c3f993d |  |
| `wf-kit-build` | kit | 3 | wf-kit-graph | merged | kit/wf-kit-build | f836544d4 |  |
| `wf-artifact-tab` | shell | 3 | wf-artifact-source | merged | shell/wf-artifact-tab | bac76fcf0 |  |
| `wf-commands` | workflows | 3 | wf-store, wf-step-input | merged | workflows/wf-commands | 180a54a29 |  |
| `wf-screen-source` | shell | 4 | wf-wireframe, wf-service | merged | shell/wf-screen-source | cfd010aeb |  |
| `wf-service` | workflows | 4 | wf-commands, wf-decl-reader | merged | workflows/wf-service | 671cf2678 |  |
| `wf-screen-tab` | shell | 5 | wf-screen-source, wf-artifact-tab | merged | shell/wf-screen-tab | e103c1154 |  |
| `wf-screen-sidebar` | shell | 6 | wf-screen-tab, wf-sidebar-activity | running | shell/wf-screen-sidebar |  |  |
