# 상태

lead만 고친다. `tools/status.py core-terminals build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `term-contract` | term | 1 | 없음 | merged | term/term-contract | c9eb81ea5 |  |
| `ext-host` | ext | 2 | term-contract | merged | ext/ext-host | ad822a8ea |  |
| `term-host` | term | 2 | term-contract | merged | term/term-host | 796ff8347 |  |
| `coding-core` | coding | 3 | term-host, ext-host | todo |  |  |  |
| `term-desktop` | term | 4 | coding-core | todo |  |  |  |
| `term-phone` | term | 4 | coding-core | todo |  |  |  |
| `term-cleanup` | term | 5 | term-desktop, term-phone | todo |  |  |  |
