# 상태

lead만 고친다. `tools/status.py workflow-shell build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `ws-detached-show` | detached | 1 | 없음 | todo |  |  |  |
| `ws-layout-map` | layout | 1 | ws-model, ws-detached-show | todo |  |  |  |
| `ws-schema` | layout | 1 | 없음 | todo |  |  |  |
| `ws-model` | model | 1 | 없음 | todo |  |  |  |
| `ws-desk-wireframe` | screen | 1 | 없음 | todo |  |  |  |
| `ws-wire-state` | wire | 2 | ws-model, ws-layout-map, ws-detached-show, ws-desk-wireframe | todo |  |  |  |
| `ws-wire-selector` | wire | 3 | ws-wire-state, ws-desk-wireframe | todo |  |  |  |
