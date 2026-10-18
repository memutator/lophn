# 상태

lead만 고친다. `tools/status.py chatgpt-subscription build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `cs-models-account` | cs-models | 1 | 없음 | merged | plan/chatgpt-subscription | 2158f869e |  |
| `cs-live` | cs-live | 2 | cs-models-account | todo |  |  |  |
| `cs-models-picker` | cs-models | 2 | cs-models-account | todo |  |  |  |
