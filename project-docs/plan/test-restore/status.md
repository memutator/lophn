# 상태

lead만 고친다. `tools/status.py test-restore build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `tr-e2e-app-tools` | e2e | 1 | 없음 | running | e2e/tr-e2e-app-tools |  |  |
| `tr-e2e-coding-mcp` | e2e | 1 | 없음 | running | e2e/tr-e2e-coding-mcp |  |  |
| `tr-e2e-kinds` | e2e | 1 | 없음 | running | e2e/tr-e2e-kinds |  |  |
| `tr-e2e-operator-domain` | e2e | 1 | tr-e2e-app-tools | todo |  |  |  |
| `tr-eval-app-engineer` | eval | 1 | tr-eval-checks, tr-eval-apps, tr-eval-operator | todo |  |  |  |
| `tr-eval-apps` | eval | 1 | 없음 | running | eval/tr-eval-apps |  |  |
| `tr-eval-calendar` | eval | 1 | tr-eval-apps, tr-eval-app-engineer | todo |  |  |  |
| `tr-eval-checks` | eval | 1 | tr-eval-apps | todo |  |  |  |
| `tr-eval-operator` | eval | 1 | 없음 | running | eval/tr-eval-operator |  |  |
| `tr-e2e-budget` | e2e | 2 | 없음 | todo |  |  |  |
