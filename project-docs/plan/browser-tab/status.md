# 상태

lead만 고친다. `tools/status.py browser-tab build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `bt-contract` | bt-contract | 1 | 없음 | merged | bt-contract/bt-contract | 589033281 |  |
| `bt-rules` | bt-rules | 1 | 없음 | merged | bt-rules/bt-rules | 547b9b0c0 |  |
| `bt-session` | bt-session | 1 | bt-rules | merged | bt-session/bt-session | bdb3af555 |  |
| `bt-bookmark-ipc` | bt-bookmark | 2 | bt-bookmark-store, bt-view | merged | bt-bookmark/bt-bookmark-ipc | ac667e3d6 |  |
| `bt-bookmark-store` | bt-bookmark | 2 | 없음 | merged | bt-bookmark/bt-bookmark-store | 639e1e033 |  |
| `bt-bookmark-ui` | bt-bookmark | 2 | bt-popup-tab, bt-bookmark-ipc | merged | bt-bookmark/bt-bookmark-ui | 3b3cffd9f |  |
| `bt-menu-overlay` | bt-menu-overlay | 2 | bt-bookmark-ui | todo |  |  |  |
| `bt-popup-host` | bt-popup | 2 | bt-view | merged | bt-popup/bt-popup-host | 589712cf6 |  |
| `bt-popup-tab` | bt-popup | 2 | bt-popup-host, bt-tab-kind | merged | bt-popup/bt-popup-tab | 0055e5f3f |  |
| `bt-settings-bookmarks` | bt-settings | 2 | bt-settings-clear, bt-bookmark-ipc | merged | bt-settings/bt-settings-bookmarks | 4810cc5b3 |  |
| `bt-settings-clear` | bt-settings | 2 | bt-tab-page | merged | bt-settings/bt-settings-clear | e84fc37cd |  |
| `bt-tab-kind` | bt-tab | 2 | bt-tab-page | merged | bt-tab/bt-tab-kind | 8bb323d9c |  |
| `bt-tab-page` | bt-tab | 2 | bt-contract, bt-view | merged | bt-tab/bt-tab-page | 39c13995e |  |
| `bt-view` | bt-view | 2 | bt-rules, bt-session, bt-contract | merged | bt-view/bt-view | 269e235ce |  |
| `bt-popup-float` | bt-popup | 3 | bt-popup-tab, bt-bookmark-ui | todo |  |  |  |
| `bt-gallery` | bt-gallery | 4 | 없음 | todo |  |  |  |
