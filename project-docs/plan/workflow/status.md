# 상태

lead만 고친다. `tools/status.py workflow build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `wf-contract-shapes` | contract | 1 | 없음 | todo |  |  |  |
| `wf-call-tool` | call | 2 | wf-contract-shapes | todo |  |  |  |
| `wf-decl-reader` | decl | 2 | wf-contract-shapes | todo |  |  |  |
| `wf-envelope-carry` | envelope | 2 | wf-contract-shapes | todo |  |  |  |
| `wf-role-text` | role | 2 | wf-contract-shapes | todo |  |  |  |
| `wf-prompt-section` | prompt | 3 | wf-decl-reader | todo |  |  |  |
