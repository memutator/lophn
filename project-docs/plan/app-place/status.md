# 상태

lead만 고친다. `tools/status.py app-place build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `place-declaration` | place | 1 | 없음 | merged | place/place-declaration | 6d8fb883b |  |
| `shell-global-float` | shell | 1 | 없음 | running | shell/shell-global-float |  |  |
| `place-params` | place | 2 | place-declaration | todo |  |  |  |
| `shell-taskbar` | shell | 2 | shell-global-float | todo |  |  |  |
| `shell-sidebar-slots` | shell | 3 | place-params, shell-taskbar | todo |  |  |  |
| `tray` | tray | 4 | shell-sidebar-slots | todo |  |  |  |
