# 상태

lead만 고친다. `tools/status.py workspace-layers build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `wlophn-core` | wlophn | 1 | 없음 | merged | wlophn/wlophn-core | 349d4ad9f |  |
| `wlophn-migrate` | wlophn | 1 | wlophn-core | merged | wlophn/wlophn-migrate | 4b44abeee |  |
| `wlophn-ui` | wlophn | 1 | wlophn-core | merged | wlophn/wlophn-ui | 33546285c |  |
| `wlayer` | wlayer | 2 | 없음 | merged | wlayer/wlayer | 888788bfb | wave 2·3은 land하지 않고 wui 뒤 한 번 land(사람, 2026-11-09) |
| `wmem` | wmem | 3 | 없음 | merged | wmem/wmem | d57a0cec9 |  |
| `wui` | wui | 4 | 없음 | running | wui/wui |  |  |
