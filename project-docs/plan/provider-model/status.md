# 상태

lead만 고친다. `tools/status.py provider-model build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `pm-reported-models` | pm-contract | 1 | 없음 | merged | pm-contract/pm-reported-models | f9f09e1c8 |  |
| `pm-custom-list` | pm-core | 2 | pm-reported-models | merged | pm-core/pm-custom-list | 1fd62ad73 |  |
| `pm-model-rules` | pm-core | 2 | pm-reported-models | merged | pm-core/pm-model-rules | 44622bf21 |  |
| `pm-connect-flow` | pm-screens | 3 | 없음 | running | pm-screens/pm-connect-flow |  |  |
| `pm-picker-data` | pm-screens | 3 | pm-custom-list, pm-model-rules | todo |  |  |  |
| `pm-picker-ui` | pm-screens | 4 | pm-picker-data, pm-connect-flow | todo |  |  |  |
| `pm-wireframes` | pm-wireframes | 5 | pm-picker-ui | todo |  |  |  |
