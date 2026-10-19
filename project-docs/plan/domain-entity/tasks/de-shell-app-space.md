# de-shell-app-space

앱 공간(app space)의 agent pane을 예전 모양으로 되돌린다: 위쪽 바의 agent select가 lophn, 그 앱의 App Engineer, 그 앱에 놓인 Operator들을 보이고, pane이 앱 place에 열리며, 앱 화면 annotation과 coding terminal의 기본 agent가 App Engineer다. 앱 공간이 앱의 project를 읽던 길(`appProject`)은 없앤다. 화면의 새 모양(domain 칩, 앱 상세의 Domains 절)은 사람이 고른 뒤 `de-shell-domain-list`가 더한다. 이 task는 새 화면을 그리지 않고 있던 항목을 되돌린다.

- 단위: shell (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/app-frame/`
  - `packages/shell/renderer/workspace/{app-panel-tab.tsx,kinds/app-panel.tsx}`
  - `packages/design/wording/catalog/app-space.ts`
  - `packages/design/wording/catalog/app-space.placeholders.ts`
  - `tools/wireframes/pages/screens/app-space.tsx`
  - `tools/wireframes/pages/screens/app-space/`
  - `tools/wireframes/mock/app-space/`
- 읽을 것:
  - skill: `.claude/skills/wording/SKILL.md`, `.claude/skills/ui-design/SKILL.md`
  - architecture: `project-docs/architecture/annotation.md`, `project-docs/architecture/place-session.md`, `project-docs/architecture/workspace-layout.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "정한 것 > 되돌리기 > place", `project-docs/products/roadmap/domain.md`의 "role과 place"
  - 본보기(화면): `tools/wireframes/pages/screens/app-space.tsx`와 `app-space/space.tsx`(gallery의 `appSpaceArea`)
  - 본보기(git): `d6b39fe34`(앱 공간 agent pane을 앱 project로 옮긴 diff)와 `3dab0cb55`(앱 record의 project를 읽게 한 diff)를 거꾸로 읽는다
- 계약:
  - 쓰는 것: 앱 place와 `app_engineer`가 돌아온 `AgentListRow["role"]`·`AgentsSource.list(place)`(`de-place-restore`가 `workspace/agents/{core-source,source}.ts`를 맞췄다. 앱 id로 부르면 lophn·그 앱의 App Engineer·그 앱의 Operator들을 준다)
  - 내놓는 것: 앱 공간 pane의 assignment key는 `lophn`, `app_engineer`, Operator는 `agt_…`다. `AppPanelTabProps`와 app panel tab에 `project`가 없다.

## 할 일

1. `agent-select.tsx`: `AppSpaceAgentRole`을 `"lophn" | "app_engineer" | "operator"`로, `ordered()`와 menu 순서 주석을 lophn, App Engineer, Operator들 순으로 되돌린다.
2. `app-agents.ts`: 후보를 `source.list(app)`(앱 id)에서 읽고 `project_manager` 거르는 줄을 되살린다(PM은 project의 agent라 앱 공간에 오지 않는다). `source.imageSrc(app, …)`도 앱 id다.
3. `app-space.tsx`·`side-panel.tsx`·`toast-handler.ts`·`annotate/{annotation-panel.tsx,use-annotate.ts}`·`app-detail/{model,source,core-source}.ts`와 `app-detail/testdata/fake-source.ts`: `appProject`·`project`·`projectName` props와 `core-source.ts`의 앱 record `.app.project` 읽기를 없애고, pane이 `place: { kind: "app", id: app }`로 열리게 한다(`app_engineer` assignment key 되살림). annotation 보내기와 coding terminal 기본 agent가 App Engineer다. 터미널은 앱 공간에 열린다.
4. `workspace/app-panel-tab.tsx`와 `workspace/kinds/app-panel.tsx`는 `d6b39fe34`가 지운 `project` prop 선언·전달이 이미 없다. 앱 공간 props가 더 필요한 일이 없는지만 확인하고, 있으면 그 줄만 고친다.
5. wording: `packages/design/wording/catalog/app-space.ts`의 App Engineer 문구(`app-detail.label.role-app-engineer`, "App Engineer was called …", `app-space.button.send-annotations`("Send to App Engineer"), 보관 안내, 안내 문장들)를 `d6b39fe34`의 역으로 되돌린다. 안 쓰게 된 key는 지우고 `deno task wording`으로 생성물을 맞춘다(`.placeholders.ts`를 손으로 고치지 않는다).
6. wireframe: `tools/wireframes/pages/screens/app-space.tsx`, `app-space/{pages,space}.tsx`, `mock/app-space/coding-terminal.ts`를 되돌린다(앱 공간 agent select에 App Engineer, 터미널 경로 `~/.lophn/apps/orders/source`).
7. fake source·test data(`app-frame/testdata/`, `app-detail/testdata/`)의 PM을 App Engineer로 되돌린다. 위험 test는 두지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(화면·문구다)
- 남지 않음: `grep -rn "appProject\|app.project\|project_manager\|Project Manager" packages/shell/renderer/app-frame packages/design/wording/catalog/app-space.ts tools/wireframes/pages/screens/app-space.tsx tools/wireframes/pages/screens/app-space tools/wireframes/mock/app-space`가 0줄이다(`app_engineer` 줄 앞의 "PM은 project의 agent라 …" 주석 한 줄만 남아도 된다).
- (화면) `deno task wireframes`가 되고, gallery의 `appSpaceArea`(앱 공간 page)가 App Engineer가 든 agent select로 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성물(`deno task wording`)
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: 앱 공간에 domain을 보이는 곳은 `de-shell-domain-list`가 더한다
