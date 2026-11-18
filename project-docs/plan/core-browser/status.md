# 상태

lead만 고친다. `tools/status.py core-browser build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `page-contract` | page | 1 | 없음 | merged | page/page-contract | 95de8ac17 |  |
| `page-stream` | page | 2 | page-contract | merged | page/page-stream | 1d2bb3822 |  |
| `page-view-core` | page | 2 | page-contract | merged | page/page-view-core | c5201d4ac |  |
| `page-host` | page | 3 | page-stream | merged | page/page-host | b229939d3 |  |
| `page-view-desktop` | page | 3 | page-view-core | merged | page/page-view-desktop | 93f036350 |  |
| `page-view-phone` | page | 3 | page-view-core | merged | page/page-view-phone | 77f1a4345 |  |
