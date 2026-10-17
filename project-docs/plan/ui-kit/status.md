# 상태

lead만 고친다. `tools/status.py ui-kit build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `kit-layout-chart` | kit-layout | 1 | kit-layout-move | todo |  |  |  |
| `kit-layout-guide` | kit-layout | 1 | kit-layout-chart | todo |  |  |  |
| `kit-layout-move` | kit-layout | 1 | kit-renderer | merged | kit-layout/kit-layout-move | 4ed77e0a5 |  |
| `kit-renderer` | kit-renderer | 1 | 없음 | merged | kit-renderer/kit-renderer | fd43d900b |  |
| `kit-gallery-copies` | kit-gallery | 2 | kit-sdk-move | todo |  |  |  |
| `kit-gallery-data` | kit-gallery | 2 | kit-gallery-split | todo |  |  |  |
| `kit-gallery-feedback-reading` | kit-gallery | 2 | kit-gallery-split | todo |  |  |  |
| `kit-gallery-layout-navigation` | kit-gallery | 2 | kit-gallery-split | todo |  |  |  |
| `kit-gallery-overlay` | kit-gallery | 2 | kit-gallery-split | todo |  |  |  |
| `kit-gallery-primitives-input` | kit-gallery | 2 | kit-gallery-split | todo |  |  |  |
| `kit-gallery-split` | kit-gallery | 2 | kit-gallery-copies | todo |  |  |  |
| `kit-sdk-move` | kit-sdk | 2 | 없음 | todo |  |  |  |
| `kit-sdk-publish` | kit-sdk | 2 | kit-sdk-move | todo |  |  |  |
| `gallery-index` | gallery-index | 3 | kit-checks | todo |  |  |  |
| `kit-checks` | kit-checks | 3 | 없음 | todo |  |  |  |
