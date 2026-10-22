# 상태

lead만 고친다. `tools/status.py workflow-shell build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `ws-detached-show` | detached | 1 | 없음 | merged | detached/ws-detached-show | 5b9001bb0 |  |
| `ws-layout-map` | layout | 1 | ws-model, ws-detached-show | merged | layout/ws-layout-map | f8d7401f3 |  |
| `ws-schema` | layout | 1 | 없음 | merged | layout/ws-schema | ed2426e90 |  |
| `ws-model` | model | 1 | 없음 | merged | model/ws-model | aa5c84637 |  |
| `ws-desk-wireframe` | screen | 1 | 없음 | merged | screen/ws-desk-wireframe | b67eeb9ff | wireframe 승인 대기 |
| `ws-wire-state` | wire | 2 | ws-model, ws-layout-map, ws-detached-show, ws-desk-wireframe | merged | wire/ws-wire-state | 0c13bfc5d |  |
| `ws-wire-selector` | wire | 3 | ws-wire-state, ws-desk-wireframe | merged | wire/ws-wire-selector | 128353e48 |  |
