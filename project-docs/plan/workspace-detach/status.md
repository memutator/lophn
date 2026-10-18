# 상태

lead만 고친다. `tools/status.py workspace-detach build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `wd-contract` | wd-contract | 1 | wd-layout | merged | wd-contract/wd-contract | c955b0a5d |  |
| `wd-layout` | wd-layout | 1 | 없음 | merged | wd-layout/wd-layout | 7a3a1c82d |  |
| `wd-browser` | wd-browser | 2 | wd-native-move | todo |  |  |  |
| `wd-main` | wd-main | 2 | wd-native-move | todo |  |  |  |
| `wd-native-move` | wd-native-move | 2 | 없음 | merged | wd-native-move/wd-native-move | d182af000 |  |
| `wd-project-side` | wd-project-side | 2 | 없음 | merged | wd-project-side/wd-project-side | 501cc4ad0 |  |
| `wd-transfer-kinds` | wd-transfer-kinds | 2 | 없음 | merged | wd-transfer-kinds/wd-transfer-kinds | 7fad62f70 |  |
| `wd-window-ui` | wd-window-ui | 2 | 없음 | running | wd-window-ui/wd-window-ui |  |  |
| `wd-gallery` | wd-gallery | 3 | 없음 | todo |  |  |  |
| `wd-restore` | wd-restore | 3 | 없음 | todo |  |  |  |
