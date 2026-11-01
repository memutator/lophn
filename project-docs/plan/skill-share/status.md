# 상태

lead만 고친다. `tools/status.py skill-share build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `instr-claude-fallback` | agent | 1 | 없음 | merged | agent/instr-claude-fallback | 8cf873d4a |  |
| `skill-places` | agent | 1 | 없음 | merged | agent/skill-places | 77f0dc797 |  |
| `assign-file` | approvals | 1 | 없음 | merged | approvals/assign-file | 1b7750596 |  |
| `app-skill-decl` | apps | 1 | 없음 | merged | apps/app-skill-decl | 9f9b833fa |  |
| `shared-skills` | agent | 2 | skill-places, assign-file, app-skill-decl | merged | agent/shared-skills | a81551365 |  |
| `share-guidance` | agent-places | 2 | app-share-request | merged | agent-places/share-guidance | 1131efdd2 |  |
| `app-share-request` | approvals | 2 | assign-file | merged | approvals/app-share-request | 6098e9da5 |  |
| `harness-skill-copies` | coding-agent | 2 | app-share-request | merged | coding-agent/harness-skill-copies | 1afbd8a57 |  |
| `skill-share-docs` | docs | 3 | harness-skill-copies | merged | docs/skill-share-docs | 228df3e6c |  |
