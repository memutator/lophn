# 상태

lead만 고친다. `tools/status.py domain-split build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `ds-wireframe-drafts` | drafts | 1 | 없음 | todo |  |  |  |
| `ds-rename` | rename | 1 | 없음 | todo |  |  |  |
| `ds-project-registry` | registry | 2 | ds-rename | todo |  |  |  |
| `ds-scope` | scope | 3 | ds-project-registry | todo |  |  |  |
| `ds-shell-agents` | shell | 3 | ds-project-registry | todo |  |  |  |
| `ds-shell-launcher` | shell | 3 | ds-project-registry | todo |  |  |  |
| `ds-coding-location` | coding | 4 | ds-project-registry | todo |  |  |  |
| `ds-shell-window` | shell | 4 | ds-shell-launcher, ds-shell-agents | todo |  |  |  |
| `ds-tool-rename` | tool | 4 | ds-project-registry | todo |  |  |  |
| `ds-leftover` | leftover | 5 | ds-shell-window, ds-coding-location, ds-tool-rename | todo |  |  |  |
