# 상태

lead만 고친다. `tools/status.py one-screen build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `screen-base-core` | screen | 1 | 없음 | merged | screen/screen-base-core | 407164bf3 |  |
| `screen-base-scope` | screen | 1 | 없음 | running | screen/screen-base-scope |  |  |
| `screen-link` | screen | 1 | 없음 | merged | screen/screen-link | 84cd4f299 |  |
| `screen-apps` | screen | 2 | screen-base-core, screen-base-scope | todo |  |  |  |
| `screen-lists` | screen | 2 | screen-base-core, screen-base-scope | todo |  |  |  |
| `screen-phone` | screen | 2 | screen-base-core, screen-base-scope | todo |  |  |  |
| `screen-terminals` | screen | 2 | screen-base-core, screen-base-scope | todo |  |  |  |
| `screen-inbox` | screen | 3 | screen-lists | todo |  |  |  |
| `screen-layout` | screen | 3 | screen-lists, screen-terminals, screen-apps | todo |  |  |  |
| `screen-pages` | screen | 3 | screen-lists | todo |  |  |  |
| `screen-windows` | screen | 3 | screen-lists | todo |  |  |  |
| `screen-cleanup` | screen | 4 | screen-layout, screen-inbox, screen-pages, screen-windows, screen-phone, screen-link | todo |  |  |  |
