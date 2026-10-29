# shell-fixes

- 목표: 런처·작업대의 Radix modal scroll-lock 때 화면이 접히는 버그를 고치고, minimized 바 hover 닫기 노출과 VS Code 방식 탭 drag & drop 화면 분할·titlebar 드롭 최소화를 더하며, markdown 편집기의 읽기/수정 모드 구분을 없애고 모든 글 편집기에 일관된 Ctrl+F 검색 줄을 붙인다.
- 재료: `issue.md`, `project-docs/architecture/workspace-layout.md`, `project-docs/boundary-catalog.yaml`, `project-docs/module-catalog.yaml`
- 범위 밖: 이미지·PDF viewer 안의 본문 검색, 3칸 이상 화면 분할.
- 단위:
  - `workspace`: Radix scroll-lock 때 `html, body` 높이 유지, minimized 바 hover 닫기 노출, 탭 drag & drop으로 좌우 화면 분할·이동 및 titlebar 드롭 최소화 (`workspace-tab-dnd`)
  - `editor`: markdown 편집기 보기/수정 모드 통합 및 markdown·text 편집기 공통 Ctrl+F/Ctrl+Alt+F 검색 줄 (`editor-unified-find`)
- 순서:
  - wave 1: `workspace-tab-dnd`, `editor-unified-find` (소유 겹침 없음, 병렬 실행)
- 사람이 정할 것: 없음.
- lead가 할 일:
  - merge 때마다: `project-docs/architecture/workspace-layout.md`에 탭 drag & drop 분할·titlebar 드롭 최소화 반영 확인.
  - 다 끝나면: `project-docs/products/change-log/0.9.0.md`에 변경 기록 후 계획 폴더 정리.
