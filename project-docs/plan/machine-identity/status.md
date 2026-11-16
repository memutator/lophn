# 상태

lead만 고친다. `tools/status.py machine-identity build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `machine-id` | machine-id | 1 | 없음 | merged | machine-id/machine-id | 2c9b95b7c |  |
| `machine-device-kind` | machine-remote | 1 | 없음 | merged | machine-remote/machine-device-kind | 6a78e3f82 |  |
| `machine-consumers` | machine-consumers | 2 | machine-id, machine-device-kind | todo |  |  |  |
| `machine-hello` | machine-remote | 2 | machine-id, machine-device-kind | todo |  |  |  |
| `machine-settings` | machine-settings | 2 | machine-id, machine-device-kind | todo |  |  |  |
| `machine-phone` | machine-phone | 3 | machine-hello, machine-device-kind | todo |  |  |  |
