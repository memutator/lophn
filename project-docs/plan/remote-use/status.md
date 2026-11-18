# 상태

lead만 고친다. `tools/status.py remote-use build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `use-contract` | use | 1 | 없음 | merged | use/use-contract | f141be239 |  |
| `use-contract-sdk` | use | 1 | 없음 | merged | use/use-contract-sdk | f5bc7b3c1 |  |
| `use-grant` | use | 1 | 없음 | merged | use/use-grant | cffb6a878 |  |
| `use-cli` | use | 2 | use-contract | merged | use/use-cli | fbc1d13bf |  |
| `use-receive` | use | 2 | use-contract, use-grant | merged | use/use-receive | 4e6ae337e |  |
| `use-send` | use | 2 | use-contract | merged | use/use-send | b4e3e3a49 |  |
| `use-events` | use | 3 | use-receive, use-send | running | use/use-events |  |  |
| `use-screens` | use | 3 | use-send | running | use/use-screens |  |  |
| `use-cleanup` | use | 4 | use-events, use-screens, use-cli | todo |  |  |  |
