# 상태

lead만 고친다. `tools/status.py artifact build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `af-annotation-target` | artifact-annotation | 1 | af-artifact-values | running | artifact-annotation/af-annotation-target |  |  |
| `af-artifact-files` | artifact-files | 1 | af-artifact-values | running | artifact-files/af-artifact-files |  |  |
| `af-artifact-values` | artifact-protocol | 1 | 없음 | merged | artifact-protocol/af-artifact-values | 5a6137f1b |  |
| `af-sandbox` | artifact-sandbox | 1 | 없음 | merged | artifact-sandbox/af-sandbox | 45b5d911d |  |
| `af-file-scope` | artifact-scope | 1 | af-artifact-values | running | artifact-scope/af-file-scope |  |  |
| `af-wireframes` | artifact-screen | 1 | 없음 | running | artifact-screen/af-wireframes |  |  |
| `af-artifact-ipc` | artifact-view | 1 | 없음 | merged | artifact-view/af-artifact-ipc | fb4d2643c |  |
| `af-annotation-read` | artifact-annotation | 2 | 없음 | todo |  |  |  |
| `af-annotation-receiver` | artifact-annotation | 2 | 없음 | todo |  |  |  |
| `af-guide` | artifact-scope | 2 | 없음 | todo |  |  |  |
| `af-prompt-list` | artifact-scope | 2 | 없음 | todo |  |  |  |
| `af-artifact-links` | artifact-screen | 2 | af-artifact-tab | todo |  |  |  |
| `af-artifact-sidebar` | artifact-screen | 2 | af-artifact-tab | todo |  |  |  |
| `af-artifact-tab` | artifact-screen | 2 | 없음 | todo |  |  |  |
| `af-artifact-view` | artifact-view | 2 | 없음 | todo |  |  |  |
| `af-gallery` | artifact-screen | 3 | 없음 | todo |  |  |  |
| `af-wording` | artifact-wording | 3 | 없음 | todo |  |  |  |
