# 상태

lead만 고친다. `tools/status.py device-roster build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `roster-contract` | roster | 1 | 없음 | merged | roster/roster-contract | 03fa37edb | review 고친 것 재확인 중 |
| `roster-client` | roster | 2 | roster-contract | merged | roster/roster-client | 8a833daba |  |
| `roster-core` | roster | 2 | roster-contract | merged | roster/roster-core | bc2d27dfd |  |
| `roster-cli` | roster | 3 | roster-core | merged | roster/roster-cli | 1314a3c78 |  |
| `roster-links` | roster | 3 | roster-core | merged | roster/roster-links | c99596b58 |  |
| `roster-desktop` | roster | 4 | roster-links | merged | roster/roster-desktop | 1bd4fd398 |  |
| `roster-cleanup` | roster | 5 | roster-client, roster-cli, roster-desktop | running | roster/roster-cleanup |  |  |
