# 상태

lead만 고친다. `tools/status.py cross-os build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `os-base` | os | 1 | 없음 | merged | os/os-base | 4ed05fcd1 |  |
| `os-ci` | os | 1 | 없음 | merged | os/os-ci | 0edaa2f08 |  |
| `os-fs` | os | 2 | os-base | running | os/os-fs |  |  |
| `os-package` | os | 2 | os-base, os-ci | running | os/os-package |  |  |
| `os-process` | os | 2 | os-base | running | os/os-process |  |  |
| `os-shell` | os | 2 | os-base | merged | os/os-shell | 41763bd9a |  |
