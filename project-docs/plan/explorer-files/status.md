# 상태

lead만 고친다. `tools/status.py explorer-files build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `explorer-multi-select` | explorer | 1 | 없음 | merged | explorer/explorer-multi-select | 2b19a6358 |  |
| `files-transfer` | files | 1 | 없음 | merged | files/files-transfer | ed2da6265 |  |
| `editor-image-paste` | editor | 2 | files-transfer | merged | editor/editor-image-paste | 24b4a086c |  |
| `explorer-clipboard` | explorer | 2 | files-transfer, explorer-multi-select | merged | explorer/explorer-clipboard | 01316169d |  |
| `explorer-clipboard-ui` | explorer | 2 | explorer-clipboard | todo |  |  |  |
