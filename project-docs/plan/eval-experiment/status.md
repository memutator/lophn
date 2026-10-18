# 상태

lead만 고친다. `tools/status.py eval-experiment build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `ex-fix-calls-check` | ex-fix-calls-check | 1 | 없음 | merged | ex-fix-calls-check/ex-fix-calls-check | eec5ba0cd |  |
| `ex-spec` | ex-spec | 1 | 없음 | merged | ex-spec/ex-spec | 9765eacf6 |  |
| `ex-assembly` | ex-assembly | 2 | ex-spec | merged | ex-assembly/ex-assembly | 3cc2b21d5 |  |
| `ex-gate` | ex-gate | 2 | ex-spec | merged | ex-gate/ex-gate | f2326964a |  |
| `ex-human-agent` | ex-human-agent | 2 | ex-spec, ex-judge-agent | merged | ex-human-agent/ex-human-agent | 06224279d |  |
| `ex-judge-agent` | ex-judge-agent | 2 | ex-spec | merged | ex-judge-agent/ex-judge-agent | 1862fb958 |  |
| `ex-overfit` | ex-overfit | 2 | ex-spec | merged | ex-overfit/ex-overfit | dd889d9b9 |  |
| `ex-parallel` | ex-parallel | 2 | 없음 | merged | ex-parallel/ex-parallel | 1a1101bdf |  |
| `ex-repeat` | ex-repeat | 2 | ex-spec, ex-judge-agent | merged | ex-repeat/ex-repeat | c08742aaf |  |
| `ex-select` | ex-select | 2 | ex-spec | merged | ex-select/ex-select | a2fea14e5 |  |
| `ex-trials` | ex-trials | 2 | ex-spec | merged | ex-trials/ex-trials | b17cc8b3f |  |
| `ex-variant` | ex-variant | 2 | 없음 | merged | ex-variant/ex-variant | 27cc58f13 |  |
| `ex-verdict` | ex-verdict | 2 | ex-spec | merged | ex-verdict/ex-verdict | a2a9e1fd5 |  |
| `ex-cli` | ex-cli | 3 | ex-select, ex-trials, ex-verdict, ex-variant, ex-gate, ex-parallel, ex-overfit, ex-assembly, ex-repeat, ex-judge-agent, ex-human-agent | merged | ex-cli/ex-cli | 69ed77f08 |  |
| `ex-skills` | ex-skills | 4 | ex-cli | merged | ex-skills/ex-skills | 101acd4a2 |  |
