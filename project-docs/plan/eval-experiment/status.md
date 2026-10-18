# 상태

lead만 고친다. `tools/status.py eval-experiment build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `ex-fix-calls-check` | ex-fix-calls-check | 1 | 없음 | todo |  |  |  |
| `ex-spec` | ex-spec | 1 | 없음 | todo |  |  |  |
| `ex-assembly` | ex-assembly | 2 | ex-spec | todo |  |  |  |
| `ex-gate` | ex-gate | 2 | ex-spec | todo |  |  |  |
| `ex-human-agent` | ex-human-agent | 2 | ex-spec, ex-judge-agent | todo |  |  |  |
| `ex-judge-agent` | ex-judge-agent | 2 | ex-spec | todo |  |  |  |
| `ex-overfit` | ex-overfit | 2 | ex-spec | todo |  |  |  |
| `ex-parallel` | ex-parallel | 2 | 없음 | todo |  |  |  |
| `ex-repeat` | ex-repeat | 2 | ex-spec, ex-judge-agent | todo |  |  |  |
| `ex-select` | ex-select | 2 | ex-spec | todo |  |  |  |
| `ex-trials` | ex-trials | 2 | ex-spec | todo |  |  |  |
| `ex-variant` | ex-variant | 2 | 없음 | todo |  |  |  |
| `ex-verdict` | ex-verdict | 2 | ex-spec | todo |  |  |  |
| `ex-cli` | ex-cli | 3 | ex-select, ex-trials, ex-verdict, ex-variant, ex-gate, ex-parallel, ex-overfit, ex-assembly, ex-repeat, ex-judge-agent, ex-human-agent | todo |  |  |  |
| `ex-skills` | ex-skills | 4 | ex-cli | todo |  |  |  |
