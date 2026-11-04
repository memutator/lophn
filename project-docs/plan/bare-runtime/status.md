# 상태

lead만 고친다. `tools/status.py bare-runtime build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `bare-definition` | bare | 1 | 없음 | merged | bare/bare-definition | 1d37155c1 |  |
| `bare-assembly` | bare | 2 | bare-definition | merged | bare/bare-assembly | 39acf678c |  |
| `bare-reply` | bare | 3 | bare-assembly | running | bare/bare-reply |  |  |
