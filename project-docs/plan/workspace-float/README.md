# workspace-float: 탭을 workspace 위에 띄우고 상단 bar로 접는다

- 목표: 모든 탭 kind에 floated(workspace 위 패널)와 minimized(상단 bar span)를 준다. docked ⇄ floated ⇄ minimized를 오가고, 다시 띄우면 돌아온다. native view(app panel, 뒤에 browser)도 floated가 된다.
- 재료:
  - `project-docs/products/roadmap/workspace-float.md`: 이 계획의 정본이다. "상태", "지금 코드", "무엇을 만드나" 1·2·3·5(floated·minimized 몫), "정한 것".
  - `project-docs/architecture/annotation.md`(app view identity), `project-docs/architecture/ui-kit.md`(kit와 wireframes).
  - `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `shell/main`, `shell/renderer`, `shell/ipc`.
- 범위 밖:
  - detached 창, `transfer`/`receive`, native view를 다른 창으로 옮겨 붙이기. 계획 `workspace-detach`가 한다.
  - browser 탭 kind와 popup. 계획 `browser-tab`이 한다.
  - roadmap "하지 않는 것" 전부(끌어서 float·dock, pane 3개 이상, snap 등).
- 돌리는 방식: worker를 쓴다. orchestrate skill대로 한다. task id는 `wf-`로 시작한다.
- 단위: `tasks/*.md`의 "단위"가 정한다.
- 순서: layout model과 schema(wave 1) → floats 층·`FloatPanel`·native view 세 층·minimized span·탭 menu와 명령(wave 2) → gallery(wave 3) → 문서(lead).
- 시작 조건: 없음. 계획 `browser-tab`과 같이 돈다. 겹치는 소유는 `status.py ready`가 가른다.

## 정한 것

roadmap "정한 것"은 다시 적지 않는다. 아래는 이 계획에서 새로 정한 것이다.

- schema에 `floats`만 더하고 `detached`는 `workspace-detach`가 더한다(agent). 쓰는 코드 없이 칸을 먼저 두지 않는다(AGENTS.md "속도").
- popup용 `transient` 표시는 이 계획이 `TabItem`과 저장 규칙에 넣는다(agent). `browser-tab`의 popup task가 그 위에 선다. 저장하지 않는 규칙은 위험 test로 지킨다.
- `LAYOUT_SCHEMA_VERSION`은 2로 올린다. 1인 파일은 `unsupported_schema`로 읽지 않고 새로 만든다(agent, AGENTS.md "호환성"). 개발 데이터는 지운다.

## lead가 할 일

- wave 2를 띄우기 전에: `packages/shell/ipc/app-frame.ts`의 `viewBoundsRequestSchema`, `bounds: viewBoundsSchema,` 바로 아래에 `layer`를 더해 commit한다. 정확한 줄은 `tasks/wf-native.md`의 "쓰는 것"에 있다. preload는 입력을 그대로 넘기므로 따로 고칠 곳이 없다.
- merge 때마다: wording 생성, gallery `tools/wireframes/pages/index.ts` 등록, `ipc/keybindings.ts` 표가 겹치면 두 쪽을 다 남긴다.
- 끝나면:
  - `project-docs/architecture/workspace-layout.md`를 새로 쓴다: 탭 상태(docked, floated, minimized), floats 층, native view 세 층과 cover, 저장. `project-docs/context-component-registry.yaml`에 올린다.
  - `project-docs/products/change-log/`의 열린 판에 항목을 덧붙인다.
  - `project-docs/products/roadmap/workspace-float.md`에서 이 계획 몫을 지운다.
- 사람에게 묻는 것: 창이나 Electron을 띄우는 test를 새로 만들 때(AGENTS.md "속도").
