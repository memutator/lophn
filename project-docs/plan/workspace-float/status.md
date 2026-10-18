# 상태

lead만 고친다. `tools/status.py workspace-float build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `wf-layout-model` | wf-layout | 1 | 없음 | merged | wf-layout/wf-layout-model | 87fd27363 |  |
| `wf-layout-schema` | wf-layout | 1 | wf-layout-model | running | wf-layout/wf-layout-schema |  |  |
| `wf-entry` | wf-entry | 2 | wf-minimized | todo |  |  |  |
| `wf-floated-layer` | wf-floated | 2 | wf-panel, wf-native, wf-floated-wire, wf-view-keep | todo |  |  |  |
| `wf-floated-wire` | wf-floated | 2 | 없음 | todo |  |  |  |
| `wf-minimized` | wf-minimized | 2 | wf-floated-layer | todo |  |  |  |
| `wf-native` | wf-native | 2 | 없음 | todo |  |  |  |
| `wf-panel` | wf-panel | 2 | 없음 | todo |  |  |  |
| `wf-view-keep` | wf-view-keep | 2 | wf-native, wf-floated-wire | todo |  |  |  |
| `wf-gallery` | wf-gallery | 3 | 없음 | todo |  |  |  |
