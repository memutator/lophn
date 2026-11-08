# 상태

lead만 고친다. `tools/status.py workspace-layers build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `wlophn-core` | wlophn | 1 | 없음 | merged | wlophn/wlophn-core | 349d4ad9f |  |
| `wlophn-migrate` | wlophn | 1 | wlophn-core | todo |  |  |  |
| `wlophn-ui` | wlophn | 1 | wlophn-core | todo |  |  |  |
| `wlayer` | wlayer | 2 | 없음 | todo |  |  |  |
| `wmem` | wmem | 3 | 없음 | todo |  |  |  |
| `wui` | wui | 4 | 없음 | todo |  |  |  |
