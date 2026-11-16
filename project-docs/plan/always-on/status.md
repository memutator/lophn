# 상태

lead만 고친다. `tools/status.py always-on build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `always-jobs` | always-jobs | 1 | 없음 | merged | always-jobs/always-jobs | a2f39b409 |  |
| `always-mark` | always-mark | 1 | 없음 | merged | always-mark/always-mark | 82be00cef |  |
| `always-os` | always-os | 1 | 없음 | merged | always-os/always-os | af3d59c51 |  |
| `always-boot` | always-boot | 2 | always-mark, always-os | todo |  |  |  |
| `always-desktop` | always-desktop | 2 | always-mark | todo |  |  |  |
