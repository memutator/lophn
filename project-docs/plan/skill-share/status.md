# 상태

lead만 고친다. `tools/status.py skill-share build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `instr-claude-fallback` | agent | 1 | 없음 | merged | agent/instr-claude-fallback | 8cf873d4a |  |
| `skill-places` | agent | 1 | 없음 | running | agent/skill-places |  |  |
| `assign-file` | approvals | 1 | 없음 | running | approvals/assign-file |  |  |
| `app-skill-decl` | apps | 1 | 없음 | running | apps/app-skill-decl |  |  |
| `shared-skills` | agent | 2 | skill-places, assign-file, app-skill-decl | todo |  |  |  |
| `share-guidance` | agent-places | 2 | app-share-request | todo |  |  |  |
| `app-share-request` | approvals | 2 | assign-file | todo |  |  |  |
| `harness-skill-copies` | coding-agent | 2 | app-share-request | todo |  |  |  |
