# 상태

오케스트레이터만 고친다. `tools/status.py build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `annotation-target` | annotation | 1 | 없음 | merged | annotation/annotation-target | a5b1eb0f8 |  |
| `apps-activation-no-retry` | apps | 1 | 없음 | running | apps/apps-activation-no-retry |  |  |
| `apps-large-changeset` | apps | 1 | dead-platform | running | apps/apps-large-changeset |  |  |
| `dead-agent` | dead | 1 | 없음 | merged | dead/dead-agent | 3777a51b6 |  |
| `dead-platform` | dead | 1 | 없음 | merged | dead/dead-platform | bde4e7c2b |  |
| `feedback-existing-problem` | feedback | 1 | 없음 | running | feedback/feedback-existing-problem |  |  |
| `harness-global-install` | harness | 1 | 없음 | running | harness/harness-global-install |  |  |
| `place-operator-app-read` | place | 1 | 없음 | running | place/place-operator-app-read |  |  |
| `platform-crash-diagnostics` | platform | 1 | 없음 | running | platform/platform-crash-diagnostics |  |  |
| `router-waiting-and-failure` | router | 1 | 없음 | todo |  |  |  |
| `trust-agent-notes` | trust | 1 | 없음 | todo |  |  |  |
| `trust-cli-fence` | trust | 1 | 없음 | todo |  |  |  |
| `trust-view-error-signing` | trust | 1 | 없음 | running | trust/trust-view-error-signing |  |  |
| `annotation-screenshot` | annotation | 2 | annotation-target | todo |  |  |  |
| `dead-contexts` | dead | 2 | dead-agent | todo |  |  |  |
| `harness-global-confirm` | harness | 2 | harness-global-install | todo |  |  |  |
| `harness-opencode` | harness | 2 | harness-global-install | todo |  |  |  |
| `platform-component-checks` | platform | 2 | platform-crash-diagnostics | todo |  |  |  |
| `cleanup-leftovers` | cleanup | 3 | trust-view-error-signing, apps-large-changeset, dead-platform, harness-global-install, dead-agent, dead-contexts, annotation-target, apps-activation-no-retry | todo |  |  |  |
