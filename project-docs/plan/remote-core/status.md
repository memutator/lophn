# 상태

lead만 고친다. `tools/status.py remote-core build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `remote-channel` | remote | 1 | 없음 | merged | remote/remote-channel | 7549a454a |  |
| `phone-runtime-spike` | spike | 1 | 없음 | merged | spike/phone-runtime-spike | 4ac401228 |  |
| `remote-devices` | remote | 2 | remote-channel | running | remote/remote-devices |  |  |
| `remote-settings` | remote | 3 | remote-devices | todo |  |  |  |
