# 계획: UI kit 하나로 모으기

상태: 열었음. 분류는 정했다(`classification.md`). brief는 `tasks/`, 상태는 `status.md`(`python3 -I project-docs/plan/tools/status.py ui-kit build`). lead는 `project-docs/plan/tools/lead/lead.sh ui-kit`이 여는 worktree(branch `plan/ui-kit`)에서 돌린다.

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
  - `gallery-index`: gallery 첫 화면과 목차를 아래 "gallery index"대로 다시 짠다.
- 순서(초안): wave 1 `kit-layout`(옮기기의 바탕). wave 2 `kit-renderer`, `kit-sdk`, `kit-gallery`(소유가 겹치면 선행으로). wave 3 `kit-checks`, `gallery-index`. 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.
- 사람이 정할 것: 없음. component마다의 분류와 범용·전용은 요구의 기준으로 lead가 정했다(`classification.md` 5절). 사람은 요구 1대로 `kit-gallery`가 끝난 뒤 gallery의 `pages/kit`을 보고 승인하고, 다르게 보면 그 component만 옮긴다.
- architecture 문서: 이 흐름(token → design → sdk·renderer → 앱 UI build → gallery)을 계획이 끝난 뒤의 코드로 `project-docs/architecture/ui-kit.md`에 쓴다. 문서가 코드보다 앞서지 않게 lead가 마지막에 쓴다.

## gallery index

지금(`tools/wireframes/pages.ts` 1248줄, `gallery.tsx`):
- 맨 위 묶음이 구현 상태다: "디자인 시스템" 25, "지금 화면" 13, "새 설계" 123. 같은 제품 영역(Launcher, Settings, App space, Workspace)이 "지금 화면"과 "새 설계"에 갈라져 있어 "Settings 화면"을 두 곳에서 찾는다.
- "새 설계" 123개 중 상당수가 이미 renderer를 import하는 진짜 화면이라 badge가 낡았다. 구현 여부를 손으로 적는 badge는 늘 낡는다.
- 디자인 시스템은 package(Components 10, SDK 11)로 나뉘어 있다. 분류로 찾을 수 없다.
- 첫 화면이 161장의 카드를 한 줄로 늘어놓는다.
- page id를 `ScreenId` union과 page 목록, `frames/screens.tsx`의 `SCREENS`에 세 번 적는다.

바꿀 모양:
- 맨 위 묶음 셋: **Kit**(분류 8개), **Screens**(제품 영역), **Drafts**(승인 전 실험). 구현 여부는 위치가 말한다. Screens는 renderer를 import한 진짜 화면이고 Drafts는 아직 아니다. "구현됨·새 설계" badge는 없앤다.
- Screens의 영역: Launcher, lophn 공간, Project workspace(sidebar, document, files, search), Agent(대화), Agent 설정, Contexts, App space, Settings, 물음·입력(waiting, secret input). 영역마다 page 하나가 아니라 상태별 page 여럿이다(지금의 `Settings · Providers` 꼴).
- Kit의 page는 분류마다 하나다. 그 분류의 export를 모두 상태별로 그린다(`kit-checks`의 check 2가 이 page를 본다).
- 첫 화면은 page 카드 대신 묶음과 영역 카드다(이름, page 수, 한 줄). 왼쪽 목차는 묶음 > 영역 > page이고 지금 영역만 펼친다.
- page 목록은 한 곳에 적는다. 영역마다 파일 하나(`pages/screens/<영역>.ts`, `pages/kit/<분류>.ts`)가 자기 page와 그리는 함수를 같이 내고 index가 모은다. `ScreenId` union과 `SCREENS`의 따로 적기는 없앤다. 영역 파일이 나뉘어 있어 task 여럿이 page를 더해도 한 파일에서 부딪치지 않는다.
- page의 description은 한국어 한두 문장 그대로 둔다. 화면 이름(title)은 영어 그대로다.

## 돌리기 전에

- "이슈 결정 적용" 계획은 끝났다. 계획 tool은 계획 이름을 첫 인자로 받는다(`status.py ui-kit ready`, `launch.sh ui-kit <id>`, `prompt.py ui-kit <id> <branch>`, `merge.sh ui-kit <id>`, wave 끝에 `land.sh ui-kit`).
- harness-domain 계획과 같이 돌 수 있다. 겹칠 수 있는 곳은 `packages/core/apps`와 `tools/check.ts` 정도이고 `status.py ready`가 거른다.

## lead가 할 일

- task가 merge될 때마다 `ui-design` skill과 `issues/`의 관련 절을 맞춘다.
- 모두 merged면 roadmap 파일을 지우고, `architecture/ui-kit.md`를 쓰고, `context-component-registry.yaml`(skill-ui-design, tool-wireframes, 새 architecture 문서)과 changelog 열린 판을 고친다. 이 폴더를 지운다.
