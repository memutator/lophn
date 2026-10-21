# 상태

lead만 고친다. `tools/status.py headless-run build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `hr-contract-runs` | contract | 1 | 없음 | running | contract/hr-contract-runs |  |  |
| `hr-token-file` | token | 1 | 없음 | running | token/hr-token-file |  |  |
| `hr-cli-commands` | cli | 2 | hr-contract-runs, hr-token-file | todo |  |  |  |
| `hr-runs-core` | runs | 2 | hr-contract-runs | todo |  |  |  |
| `hr-screen-wireframe` | screen | 2 | hr-contract-runs | todo |  |  |  |
| `hr-session-input` | session | 2 | hr-contract-runs | todo |  |  |  |
| `hr-runs-wiring` | runs | 3 | hr-runs-core, hr-session-input | todo |  |  |  |
| `hr-screen-data` | screen | 3 | hr-screen-wireframe | todo |  |  |  |
