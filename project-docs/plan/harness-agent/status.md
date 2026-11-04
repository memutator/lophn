# 상태

lead만 고친다. `tools/status.py harness-agent build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `harness-core` | harness | 1 | 없음 | merged | harness/harness-core | ee4ee840a |  |
| `harness-headless` | harness | 2 | harness-core | merged | harness/harness-headless | b488869cb |  |
| `harness-reply` | harness | 3 | harness-headless | todo |  |  |  |
