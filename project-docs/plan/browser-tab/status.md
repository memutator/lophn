# 상태

lead만 고친다. `tools/status.py browser-tab build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `bt-contract` | bt-contract | 1 | 없음 | todo |  |  |  |
| `bt-rules` | bt-rules | 1 | 없음 | todo |  |  |  |
| `bt-session` | bt-session | 1 | bt-rules | todo |  |  |  |
| `bt-bookmark-ipc` | bt-bookmark | 2 | bt-bookmark-store, bt-view | todo |  |  |  |
| `bt-bookmark-store` | bt-bookmark | 2 | 없음 | todo |  |  |  |
| `bt-bookmark-ui` | bt-bookmark | 2 | bt-popup-tab, bt-bookmark-ipc | todo |  |  |  |
| `bt-popup-host` | bt-popup | 2 | bt-view | todo |  |  |  |
| `bt-popup-tab` | bt-popup | 2 | bt-popup-host, bt-tab-kind | todo |  |  |  |
| `bt-settings-bookmarks` | bt-settings | 2 | bt-settings-clear, bt-bookmark-ipc | todo |  |  |  |
| `bt-settings-clear` | bt-settings | 2 | bt-tab-page | todo |  |  |  |
| `bt-tab-kind` | bt-tab | 2 | bt-tab-page | todo |  |  |  |
| `bt-tab-page` | bt-tab | 2 | bt-contract, bt-view | todo |  |  |  |
| `bt-view` | bt-view | 2 | bt-rules, bt-session, bt-contract | todo |  |  |  |
| `bt-popup-float` | bt-popup | 3 | bt-popup-tab, bt-bookmark-ui | todo |  |  |  |
| `bt-gallery` | bt-gallery | 4 | 없음 | todo |  |  |  |
