# 상태

lead만 고친다. `tools/status.py keybindings-ext build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `key-core` | key-core | 1 | 없음 | merged | key-core/key-core | c9123a54d |  |
| `key-app` | key-app | 2 | key-core | running | key-app/key-app |  |  |
| `key-ext` | key-ext | 2 | key-core | merged | key-ext/key-ext | 090f15195 |  |
| `key-agent` | key-agent | 3 | key-ext, key-app | todo |  |  |  |
| `key-parity` | key-parity | 4 | key-agent | todo |  |  |  |
