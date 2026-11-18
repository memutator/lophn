# 상태

lead만 고친다. `tools/status.py remote-use build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `use-contract` | use | 1 | 없음 | running | use/use-contract |  |  |
| `use-contract-sdk` | use | 1 | 없음 | running | use/use-contract-sdk |  |  |
| `use-grant` | use | 1 | 없음 | running | use/use-grant |  |  |
| `use-cli` | use | 2 | use-contract | todo |  |  |  |
| `use-receive` | use | 2 | use-contract, use-grant | todo |  |  |  |
| `use-send` | use | 2 | use-contract | todo |  |  |  |
| `use-events` | use | 3 | use-receive, use-send | todo |  |  |  |
| `use-screens` | use | 3 | use-send | todo |  |  |  |
| `use-cleanup` | use | 4 | use-events, use-screens, use-cli | todo |  |  |  |
