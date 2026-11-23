# 상태

lead만 고친다. `tools/status.py workspace-lifecycle build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `cascade-deterministic-core` | cascade-core | 1 | 없음 | merged | cascade-core/cascade-deterministic-core | df54086b3 |  |
| `jobs-archive-and-erase` | jobs | 1 | 없음 | merged | jobs/jobs-archive-and-erase | 80b91169b |  |
| `tooling-checks` | tooling | 1 | 없음 | merged | tooling/tooling-checks | c9488d28a |  |
| `workspace-reader-and-followups` | workspace-reader | 1 | 없음 | merged | workspace-reader/workspace-reader-and-followups | 14cbb1131 |  |
| `cascade-handoff-and-cli` | cascade-handoff | 2 | jobs-archive-and-erase, cascade-deterministic-core, workspace-reader-and-followups | todo |  |  |  |
| `prompts-skills-and-sdk-note` | prompts-skills | 2 | tooling-checks, workspace-reader-and-followups | todo |  |  |  |
| `shell-cascade-and-desk-ui` | shell-ui | 2 | cascade-deterministic-core, workspace-reader-and-followups | todo |  |  |  |
| `update-engine-and-notices` | update-engine | 2 | workspace-reader-and-followups, cascade-deterministic-core | todo |  |  |  |
