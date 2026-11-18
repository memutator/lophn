# 상태

lead만 고친다. `tools/status.py core-setup build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `setup-project` | setup | 1 | 없음 | merged | setup/setup-project | 8d325796e |  |
| `setup-provider` | setup | 1 | 없음 | running | setup/setup-provider |  |  |
| `setup-scope` | setup | 1 | 없음 | todo |  |  |  |
| `setup-phone` | setup | 2 | setup-provider, setup-scope | todo |  |  |  |
| `setup-viewer` | setup | 2 | setup-provider, setup-project, setup-scope | todo |  |  |  |
