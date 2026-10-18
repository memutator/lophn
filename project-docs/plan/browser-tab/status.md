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
| `bt-menu-overlay` | bt-menu-overlay | 2 | bt-bookmark-ui | merged | bt-menu-overlay/bt-menu-overlay | 5a96ea729 |  |
| `bt-popup-host` | bt-popup | 2 | bt-view | merged | bt-popup/bt-popup-host | 589712cf6 |  |
| `bt-popup-tab` | bt-popup | 2 | bt-popup-host, bt-tab-kind | merged | bt-popup/bt-popup-tab | 0055e5f3f |  |
| `bt-settings-bookmarks` | bt-settings | 2 | bt-settings-clear, bt-bookmark-ipc | merged | bt-settings/bt-settings-bookmarks | 4810cc5b3 |  |
| `bt-settings-clear` | bt-settings | 2 | bt-tab-page | merged | bt-settings/bt-settings-clear | e84fc37cd |  |
| `bt-tab-kind` | bt-tab | 2 | bt-tab-page | merged | bt-tab/bt-tab-kind | 8bb323d9c |  |
| `bt-tab-page` | bt-tab | 2 | bt-contract, bt-view | merged | bt-tab/bt-tab-page | 39c13995e |  |
| `bt-view` | bt-view | 2 | bt-rules, bt-session, bt-contract | merged | bt-view/bt-view | 269e235ce |  |
| `bt-devtools-main` | bt-devtools | 3 | bt-favicon-main | merged | bt-devtools/bt-devtools-main | 87c604c84 |  |
| `bt-devtools-ui` | bt-devtools | 3 | bt-favicon-ui, bt-devtools-main | merged | bt-devtools/bt-devtools-ui | 5dac49a38 |  |
| `bt-favicon-main` | bt-favicon | 3 | bt-view-layers, bt-webview-main | merged | bt-favicon/bt-favicon-main | 782fef943 |  |
| `bt-favicon-ui` | bt-favicon | 3 | bt-popup-float, bt-favicon-main, bt-webview-ui | merged | bt-favicon/bt-favicon-ui | 9963908c9 |  |
| `bt-popup-float` | bt-popup | 3 | bt-popup-tab, bt-bookmark-ui, bt-menu-overlay | merged | bt-popup/bt-popup-float | 999669572 |  |
| `bt-view-layers` | bt-view-layers | 3 | bt-menu-overlay | merged | bt-view-layers/bt-view-layers | f226c42b2 |  |
| `bt-webview-main` | bt-webview-main | 3 | bt-view-layers, bt-popup-float | merged | bt-webview-main/bt-webview-main | 3347f036c |  |
| `bt-webview-ui` | bt-webview-ui | 3 | bt-popup-float | merged | bt-webview-ui/bt-webview-ui | 4946b3690 |  |
| `bt-gallery` | bt-gallery | 4 | 없음 | todo |  |  |  |
