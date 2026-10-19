# 상태

lead만 고친다. `tools/status.py test-restore build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `tr-e2e-app-tools` | e2e | 1 | 없음 | merged | e2e/tr-e2e-app-tools | 0057376f7 |  |
| `tr-e2e-coding-mcp` | e2e | 1 | 없음 | merged | e2e/tr-e2e-coding-mcp | 66a98fcf4 |  |
| `tr-e2e-kinds` | e2e | 1 | 없음 | merged | e2e/tr-e2e-kinds | 38a96812c |  |
| `tr-e2e-operator-domain` | e2e | 1 | tr-e2e-app-tools | todo |  |  |  |
| `tr-eval-app-engineer` | eval | 1 | tr-eval-checks, tr-eval-apps, tr-eval-operator | running | eval/tr-eval-app-engineer |  |  |
| `tr-eval-apps` | eval | 1 | 없음 | merged | eval/tr-eval-apps | ddb76771d |  |
| `tr-eval-calendar` | eval | 1 | tr-eval-apps, tr-eval-app-engineer | todo |  |  |  |
| `tr-eval-checks` | eval | 1 | tr-eval-apps | merged | eval/tr-eval-checks | 2bfa9d1de |  |
| `tr-eval-operator` | eval | 1 | 없음 | merged | eval/tr-eval-operator | 3107caba9 |  |
| `tr-e2e-budget` | e2e | 2 | 없음 | todo |  |  |  |
