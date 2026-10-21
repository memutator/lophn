# 상태

lead만 고친다. `tools/status.py test-restore build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `tr-e2e-approval` | e2e | 1 | 없음 | merged | e2e/tr-e2e-approval | 1a2cc49f7 |  |
| `tr-eval-prune-checks` | eval | 1 | 없음 | merged | eval/tr-eval-prune-checks | 17559d9d7 |  |
| `tr-eval-prune-coding` | eval | 1 | 없음 | merged | eval/tr-eval-prune-coding | c7229fd8c |  |
| `tr-eval-versions` | eval | 1 | 없음 | merged | eval/tr-eval-versions | eec5a3283 |  |
| `tr-shell-instructions-card` | shell | 1 | 없음 | merged | shell/tr-shell-instructions-card | 04a2e9202 |  |
| `tr-support-app` | support | 1 | 없음 | merged | support/tr-support-app | 39dd2e801 |  |
| `tr-e2e-app-activation` | e2e | 2 | tr-support-app | merged | e2e/tr-e2e-app-activation | f45c3a012 |  |
| `tr-e2e-app-call-kinds` | e2e | 2 | tr-support-app | merged | e2e/tr-e2e-app-call-kinds | 1bbad5b07 |  |
| `tr-e2e-app-fix` | e2e | 2 | tr-support-app | merged | e2e/tr-e2e-app-fix | 98e20b676 |  |
| `tr-e2e-app-release` | e2e | 2 | tr-support-app | merged | e2e/tr-e2e-app-release | c74f81a15 |  |
| `tr-e2e-ask-fix` | e2e | 2 | tr-e2e-approval | merged | e2e/tr-e2e-ask-fix | 84f102cf2 |  |
| `tr-e2e-call-fix` | e2e | 2 | tr-e2e-approval | merged | e2e/tr-e2e-call-fix | 6ff93af2f |  |
| `tr-e2e-operator` | e2e | 2 | tr-support-app | merged | e2e/tr-e2e-operator | 33f5decb2 |  |
| `tr-eval-calendar-build` | eval | 2 | tr-eval-restore, tr-eval-human | merged | eval/tr-eval-calendar-build | 4a053cd9b |  |
| `tr-eval-calendar-maintain` | eval | 2 | tr-eval-calendar-build | merged | eval/tr-eval-calendar-maintain | f386e6cb0 |  |
| `tr-eval-human` | eval | 2 | tr-eval-prune-coding | merged | eval/tr-eval-human | 5aad282ad |  |
| `tr-eval-restore` | eval | 2 | tr-support-app, tr-eval-prune-coding | merged | eval/tr-eval-restore | bedbe0834 |  |
| `tr-eval-scenario-fix` | eval | 2 | tr-eval-restore, tr-eval-human | merged | eval/tr-eval-scenario-fix | 302dd7e4d |  |
| `tr-check-enable` | check | 3 | 없음 | todo |  |  |  |
