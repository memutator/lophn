# 계획: UI kit 하나로 모으기

상태: 열었음. 분류는 정했다(`classification.md`). brief는 아직 없다. "이슈 결정 적용" 계획(`project-docs/plan/README.md`의 "이 계획")이 끝나고 계획 tool이 계획마다 폴더를 받도록 바뀐 뒤 돌린다(아래 "돌리기 전에").

## 이 계획

- 목표: wireframe gallery에 그린 component를 정본으로, 범용 UI component는 `packages/design` 하나(앱에는 `@lophn/ui`로 배포)에, lophn 전용 부품은 `packages/shell/renderer`에, 앱 bridge를 쓰는 UI만 `packages/sdk`에 둔다. gallery는 실제 component를 import만 하고, 그것을 check 셋이 지킨다.
- 재료: `project-docs/products/roadmap/ui-kit-single-source.md`(요구 6개, 바꿀 모양, check 셋, 바꿀 것 표, 하지 않는 것), `classification.md`(component마다 분류와 범용·전용), `.claude/skills/ui-design/`, `project-docs/boundary-catalog.yaml`의 `design`, `design-api`, `sdk`, `sdk-api`, `shell`, `app-releases`, `project-docs/module-catalog.yaml`.
- 범위 밖: preview, slot, shell theme, eject CLI, token override 공식화, 앱 CSS 검사(roadmap "하지 않는 것").
- 단위(초안, 분류 표가 정해지면 확정한다):
  - `kit-layout`: `packages/design/components/`를 분류 폴더 8개(primitives, layout, navigation, data, feedback, overlay, reading, input)로 옮기고, 분류마다 `mod.ts`에 export마다 "언제 쓰나" 한 줄. `@lophn/chart`를 `data/`로 합친다.
  - `kit-renderer`: design 안의 lophn 전용 부품을 renderer로 옮긴다.
  - `kit-sdk`: sdk `ui-*`의 범용 부품(AppShell, Sidebar, FilterBar 등)을 design으로 옮기고, 앱 bridge를 쓰는 부품(AppApiButton, AppErrorBoundary 등)만 sdk 하나에 남기고, 재export뿐인 `ui-*`를 지운다. 앱 배포 이름을 `@lophn/ui`(분류는 sub-path)로 바꾸고 `core/apps/releases/ui-build/build.ts`의 `FIXED_UI_DEPENDENCIES`와 앱 template, `lophn-build-app` skill을 맞춘다.
  - `kit-gallery`: `tools/wireframes`를 `pages/kit/<분류>/`, `pages/screens/`, `mock/`, `drafts/`로 나누고, wireframe 전용 코드를 renderer·design(승인된 것)이나 `drafts/`(아닌 것)로 옮긴다.
  - `kit-checks`: check 셋 — `tools/wireframes`에서 `drafts/` 밖 CSS 없음, design의 모든 export가 `pages/kit`에 한 번은 나옴, design component가 모두 분류 폴더 안에 있고 `mod.ts`에 한 줄 문서가 있음.
- 순서(초안): wave 1 `kit-layout`(옮기기의 바탕). wave 2 `kit-renderer`, `kit-sdk`, `kit-gallery`(소유가 겹치면 선행으로). wave 3 `kit-checks`. 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.
- 사람이 정할 것: 없음. component마다의 분류와 범용·전용은 요구의 기준으로 lead가 정했다(`classification.md` 5절). 사람은 요구 1대로 `kit-gallery`가 끝난 뒤 gallery의 `pages/kit`을 보고 승인하고, 다르게 보면 그 component만 옮긴다.
- architecture 문서: 이 흐름(token → design → sdk·renderer → 앱 UI build → gallery)을 계획이 끝난 뒤의 코드로 `project-docs/architecture/ui-kit.md`에 쓴다. 문서가 코드보다 앞서지 않게 lead가 마지막에 쓴다.

## 돌리기 전에

- "이슈 결정 적용" 계획이 끝나야 한다. 두 계획 모두 `packages/shell/renderer`(feedback dialog, overlay), `packages/design/wording`, `tools/wireframes`를 고친다.
- 계획 tool(`project-docs/plan/tools/status.py`, `briefs.py`, `lead/*.py`, `lead/*.sh`)이 계획 폴더를 인자로 받고, `ready`가 다른 계획의 `running` task와 소유 겹침을 보도록 바뀌어야 한다. 그때 "이슈 결정 적용"의 파일을 `plan/issue-decisions/`로 옮기거나 지운다. 지금 도는 session이 그 tool을 쓰므로 그 계획이 끝난 뒤에 바꾼다.

## lead가 할 일

- task가 merge될 때마다 `ui-design` skill과 `issues/`의 관련 절을 맞춘다.
- 모두 merged면 roadmap 파일을 지우고, `architecture/ui-kit.md`를 쓰고, `context-component-registry.yaml`(skill-ui-design, tool-wireframes, 새 architecture 문서)과 changelog 열린 판을 고친다. 이 폴더를 지운다.
