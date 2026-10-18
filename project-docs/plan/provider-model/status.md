# 상태

lead만 고친다. `tools/status.py provider-model build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `pm-reported-models` | pm-contract | 1 | 없음 | running | pm-contract/pm-reported-models |  |  |
| `pm-custom-list` | pm-core | 2 | pm-reported-models | todo |  |  |  |
| `pm-model-rules` | pm-core | 2 | pm-reported-models | todo |  |  |  |
| `pm-connect-flow` | pm-screens | 3 | 없음 | todo |  |  |  |
| `pm-picker-data` | pm-screens | 3 | pm-custom-list, pm-model-rules | todo |  |  |  |
| `pm-picker-ui` | pm-screens | 4 | pm-picker-data, pm-connect-flow | todo |  |  |  |
| `pm-wireframes` | pm-wireframes | 5 | pm-picker-ui | todo |  |  |  |
