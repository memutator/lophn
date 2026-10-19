# 상태

lead만 고친다. `tools/status.py browser-bridge build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `bb-contract` | bb-contract | 1 | 없음 | merged | bb-contract/bb-contract | 98837d2c7 |  |
| `bb-policy` | bb-policy | 1 | 없음 | merged | bb-policy/bb-policy | a1cb6e33b |  |
| `bb-renderer` | bb-renderer | 2 | bb-contract | merged | bb-renderer/bb-renderer | a8446d589 |  |
| `bb-server` | bb-server | 2 | bb-policy, bb-contract, bb-shim | merged | bb-server/bb-server | 6bd1b6b52 |  |
| `bb-settings` | bb-settings | 2 | bb-policy | merged | bb-settings/bb-settings | 959aa1930 |  |
| `bb-shim` | bb-shim | 2 | bb-policy | merged | bb-shim/bb-shim | 7d91762e8 |  |
| `bb-gallery` | bb-gallery | 3 | bb-renderer, bb-settings | merged | bb-gallery/bb-gallery | c34ac48a3 |  |
