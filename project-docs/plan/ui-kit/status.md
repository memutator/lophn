# 상태

lead만 고친다. `tools/status.py ui-kit build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `kit-layout-chart` | kit-layout | 1 | kit-layout-move | merged | kit-layout/kit-layout-chart | 65ccb37c9 |  |
| `kit-layout-guide` | kit-layout | 1 | kit-layout-chart | merged | kit-layout/kit-layout-guide | 3b836c848 |  |
| `kit-layout-move` | kit-layout | 1 | kit-renderer | merged | kit-layout/kit-layout-move | 4ed77e0a5 | 앱 template·FIXED_UI_DEPENDENCIES는 kit-sdk-publish까지 옛 이름(@lophn/design, @lophn/chart, ui-*). 그 사이 앱 build가 깨질 수 있다. 지금은 sdk 사본 설치 코드가 없어 원래 막혀 있다(issues/platform.md) |
| `kit-renderer` | kit-renderer | 1 | 없음 | merged | kit-renderer/kit-renderer | fd43d900b |  |
| `kit-gallery-copies` | kit-gallery | 2 | kit-sdk-move | merged | kit-gallery/kit-gallery-copies | a50111d11 |  |
| `kit-gallery-data` | kit-gallery | 2 | kit-gallery-split | merged | kit-gallery/kit-gallery-data | ba4243fc0 |  |
| `kit-gallery-feedback-reading` | kit-gallery | 2 | kit-gallery-split | merged | kit-gallery/kit-gallery-feedback-reading | 5d1daa915 |  |
| `kit-gallery-layout-navigation` | kit-gallery | 2 | kit-gallery-split | merged | kit-gallery/kit-gallery-layout-navigation | 41688014b |  |
| `kit-gallery-overlay` | kit-gallery | 2 | kit-gallery-split | merged | kit-gallery/kit-gallery-overlay | e1d7952dc |  |
| `kit-gallery-primitives-input` | kit-gallery | 2 | kit-gallery-split | merged | kit-gallery/kit-gallery-primitives-input | 2a6299dc4 |  |
| `kit-gallery-split` | kit-gallery | 2 | kit-gallery-copies | merged | kit-gallery/kit-gallery-split | 7264346f9 |  |
| `kit-sdk-move` | kit-sdk | 2 | 없음 | merged | kit-sdk/kit-sdk-move | 83a9dc45b |  |
| `kit-sdk-publish` | kit-sdk | 2 | kit-sdk-move | merged | kit-sdk/kit-sdk-publish | 8dff9e150 |  |
| `gallery-index` | gallery-index | 3 | kit-checks | todo |  |  |  |
| `kit-checks` | kit-checks | 3 | 없음 | merged | kit-checks/kit-checks | 985e4b890 |  |
