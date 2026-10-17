# 상태

오케스트레이터만 고친다. `tools/status.py build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `annotation-target` | annotation | 1 | 없음 | todo |  |  |  |
| `apps-activation-no-retry` | apps | 1 | 없음 | todo |  |  |  |
| `apps-large-changeset` | apps | 1 | dead-platform | todo |  |  |  |
| `dead-agent` | dead | 1 | 없음 | todo |  |  |  |
| `dead-platform` | dead | 1 | 없음 | todo |  |  |  |
| `feedback-existing-problem` | feedback | 1 | 없음 | todo |  |  |  |
| `harness-global-install` | harness | 1 | 없음 | todo |  |  |  |
| `place-operator-app-read` | place | 1 | 없음 | todo |  |  |  |
| `platform-crash-diagnostics` | platform | 1 | 없음 | todo |  |  |  |
| `router-waiting-and-failure` | router | 1 | 없음 | todo |  |  |  |
| `trust-agent-notes` | trust | 1 | 없음 | todo |  |  |  |
| `trust-cli-fence` | trust | 1 | 없음 | todo |  |  |  |
| `trust-view-error-signing` | trust | 1 | 없음 | todo |  |  |  |
| `annotation-screenshot` | annotation | 2 | annotation-target | todo |  |  |  |
| `dead-contexts` | dead | 2 | dead-agent | todo |  |  |  |
| `harness-global-confirm` | harness | 2 | harness-global-install | todo |  |  |  |
| `harness-opencode` | harness | 2 | harness-global-install | todo |  |  |  |
| `platform-component-checks` | platform | 2 | platform-crash-diagnostics | todo |  |  |  |
| `cleanup-leftovers` | cleanup | 3 | trust-view-error-signing, apps-large-changeset, dead-platform, harness-global-install, dead-agent, dead-contexts, annotation-target, apps-activation-no-retry | todo |  |  |  |
