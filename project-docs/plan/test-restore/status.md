# 상태

lead만 고친다. `tools/status.py test-restore build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `tr-e2e-approval` | e2e | 1 | 없음 | running | e2e/tr-e2e-approval |  |  |
| `tr-eval-prune-checks` | eval | 1 | 없음 | merged | eval/tr-eval-prune-checks | 17559d9d7 |  |
| `tr-eval-prune-coding` | eval | 1 | 없음 | running | eval/tr-eval-prune-coding |  |  |
| `tr-eval-versions` | eval | 1 | 없음 | merged | eval/tr-eval-versions | eec5a3283 |  |
| `tr-shell-instructions-card` | shell | 1 | 없음 | merged | shell/tr-shell-instructions-card | 04a2e9202 |  |
| `tr-support-app` | support | 1 | 없음 | running | support/tr-support-app |  |  |
| `tr-e2e-app-activation` | e2e | 2 | tr-support-app | todo |  |  |  |
| `tr-e2e-app-call-kinds` | e2e | 2 | tr-support-app | todo |  |  |  |
| `tr-e2e-app-fix` | e2e | 2 | tr-support-app | todo |  |  |  |
| `tr-e2e-app-release` | e2e | 2 | tr-support-app | todo |  |  |  |
| `tr-e2e-ask-fix` | e2e | 2 | tr-e2e-approval | todo |  |  |  |
| `tr-e2e-call-fix` | e2e | 2 | tr-e2e-approval | todo |  |  |  |
| `tr-e2e-operator` | e2e | 2 | tr-support-app | todo |  |  |  |
| `tr-eval-calendar-build` | eval | 2 | tr-eval-restore, tr-eval-human | todo |  |  |  |
| `tr-eval-calendar-maintain` | eval | 2 | tr-eval-calendar-build | todo |  |  |  |
| `tr-eval-human` | eval | 2 | tr-eval-prune-coding | todo |  |  |  |
| `tr-eval-restore` | eval | 2 | tr-support-app, tr-eval-prune-coding | todo |  |  |  |
| `tr-eval-scenario-fix` | eval | 2 | tr-eval-restore, tr-eval-human | todo |  |  |  |
| `tr-check-enable` | check | 3 | 없음 | todo |  |  |  |
