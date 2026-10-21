# 상태

lead만 고친다. `tools/status.py headless-run build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `hr-contract-runs` | contract | 1 | 없음 | merged | contract/hr-contract-runs | e2957faa9 |  |
| `hr-token-file` | token | 1 | 없음 | merged | token/hr-token-file | b7905d226 |  |
| `hr-cli-commands` | cli | 2 | hr-contract-runs, hr-token-file | merged | cli/hr-cli-commands | ddeaa0925 |  |
| `hr-runs-core` | runs | 2 | hr-contract-runs | merged | runs/hr-runs-core | 39040778b |  |
| `hr-screen-wireframe` | screen | 2 | hr-contract-runs | merged | screen/hr-screen-wireframe | e5c60cfea |  |
| `hr-session-input` | session | 2 | hr-contract-runs | merged | session/hr-session-input | 7270d6b5e |  |
| `hr-runs-wiring` | runs | 3 | hr-runs-core, hr-session-input | merged | runs/hr-runs-wiring | d5f8cb27a |  |
| `hr-screen-data` | screen | 3 | hr-screen-wireframe | todo |  |  |  |
