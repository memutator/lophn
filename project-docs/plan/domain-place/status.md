# 상태

lead만 고친다. `tools/status.py domain-place build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `dp-app-project` | app-binding | 1 | 없음 | merged | app-binding/dp-app-project | a226d53be |  |
| `dp-project-folderless` | app-binding | 1 | 없음 | merged | app-binding/dp-project-folderless | 50c060875 |  |
| `dp-eval` | evals | 2 | 없음 | merged | evals/dp-eval | 4867b08b8 |  |
| `dp-agents-core` | place-core | 2 | 없음 | merged | place-core/dp-agents-core | 61100fa9d |  |
| `dp-operator-skills` | place-core | 2 | dp-agents-core, dp-agent-roles-scope | todo |  |  |  |
| `dp-place-events` | place-core | 2 | 없음 | merged | place-core/dp-place-events | 7d94a227d |  |
| `dp-place-protocol` | place-core | 2 | dp-agents-core, dp-place-events, dp-agent-roles-scope, dp-agent-roles-prompt, dp-operator-skills, dp-storage-apps, dp-problems-core, dp-shell-app-space, dp-shell-agents, dp-shell-launcher, dp-coding-text, dp-eval | todo |  |  |  |
| `dp-agent-roles-prompt` | role-merge | 2 | 없음 | running | role-merge/dp-agent-roles-prompt |  |  |
| `dp-agent-roles-scope` | role-merge | 2 | dp-agents-core | running | role-merge/dp-agent-roles-scope |  |  |
| `dp-coding-text` | role-merge | 2 | 없음 | merged | role-merge/dp-coding-text | a16c48487 |  |
| `dp-shell-agents` | shell-place | 2 | 없음 | todo |  |  |  |
| `dp-shell-app-space` | shell-place | 2 | 없음 | todo |  |  |  |
| `dp-shell-launcher` | shell-place | 2 | dp-shell-agents | todo |  |  |  |
| `dp-problems-core` | storage | 2 | dp-storage-apps | merged | storage/dp-problems-core | 7609a6373 |  |
| `dp-storage-apps` | storage | 2 | 없음 | merged | storage/dp-storage-apps | 9465bc595 |  |
| `dp-lophn-map` | map | 3 | dp-usage-read | todo |  |  |  |
| `dp-package-owner` | map | 3 | 없음 | todo |  |  |  |
| `dp-usage-read` | map | 3 | 없음 | todo |  |  |  |
| `dp-grants-public-ui` | public-tools | 3 | dp-public-filter | todo |  |  |  |
| `dp-public-event` | public-tools | 3 | 없음 | todo |  |  |  |
| `dp-public-filter` | public-tools | 3 | 없음 | todo |  |  |  |
| `dp-release-guard` | public-tools | 3 | dp-public-event, dp-usage-read | todo |  |  |  |
| `dp-roles-public` | public-tools | 3 | 없음 | todo |  |  |  |
