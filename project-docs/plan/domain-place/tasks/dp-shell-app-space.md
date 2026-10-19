# dp-shell-app-space

앱 화면(app space)의 agent pane을 앱 place에서 그 앱의 project 층으로 옮긴다. 앱 위쪽 바의 agent select가 lophn, 그 앱 project의 Project Manager(PM), 그 project의 Operator들을 보인다(App Engineer 항목은 없다). annotation은 PM에게 가고, 알림·문구의 App Engineer는 Project Manager다. 새 화면을 그리지 않는다. 있던 항목을 바꾸고 지운다.

- 단위: shell-place (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/app-frame/`
  - `packages/shell/ipc/annotation.ts`
  - `packages/design/wording/catalog/app-space.ts`
  - `tools/wireframes/pages/screens/app-space.tsx`
  - `tools/wireframes/pages/screens/app-space/`
  - `tools/wireframes/mock/app-space/`
- 읽을 것:
  - architecture: `project-docs/architecture/annotation.md`, `project-docs/architecture/place-session.md`, `project-docs/architecture/workspace-layout.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
  - 본보기(화면): `tools/wireframes/pages/screens/app-space.tsx`와 `app-space/space.tsx`(앱 공간 wireframe, gallery의 `appSpaceArea`)
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것 > PM이 App Engineer의 일을 맡는다 / annotation", `project-docs/products/AGENT-ROLE.md`의 P7, A3
  - 쓰는 규칙: `.claude/skills/wording/SKILL.md`, `.claude/skills/ui-design/SKILL.md`
- 계약:
  - 쓰는 것: core가 주는 앱 record의 `project`(`dp-app-project`), agent 목록 `AgentsSource.list(project)`(`packages/shell/renderer/workspace/agents/source.ts` 243째 줄. project id로 부르면 lophn·그 project의 PM·그 project의 Operator들을 준다). 앱 공간이 앱의 project id를 얻는 길은 앱 목록 행(launcher의 앱 item)이나 앱 상세 읽기에서 읽는다.
  - 내놓는 것: 앱 공간 pane의 agent assignment key는 `lophn`, `project_manager`, Operator는 `agt_…`다(`app_engineer` key가 없다).

## 할 일

1. `packages/shell/renderer/app-frame/agent-select.tsx`: `AppSpaceAgentRole`(15째 줄)을 `"lophn" | "project_manager" | "operator"`로, `ordered()`(103~109째 줄)와 menu 항목 순서 주석을 lophn, Project Manager, Operator들 순으로 고친다. "약속하는 DOM" 주석의 App Engineer도 고친다.
2. `packages/shell/renderer/app-frame/app-agents.ts`: 후보를 `source.list(app)`(앱 id)에서 `source.list(project)`로 바꾸고 `row.role === "project_manager"`를 거르는 줄(20째 줄)을 지운다(PM이 이제 후보다). `source.imageSrc(app, …)` 호출도 project id로 맞춘다.
3. `packages/shell/renderer/app-frame/app-space.tsx`: `app_engineer` 갈래(285~298, 343, 411째 줄)를 `project_manager`(session의 `agent.project`가 이 앱의 project일 때)로 바꾼다. 터미널 요청이 열릴 때 기본 pane(`assignment: "app_engineer"`)도 `project_manager`로. `side-panel.tsx`(285째 줄)의 `factory({ assignment, place: { kind: "app", id: app } })`는 `place: { kind: "project", id: <앱의 project> }`로 바꾼다. 앱 공간에 앱 project id가 필요하면 props로 받고 `packages/shell/renderer/desktop/main.tsx`가 넘기게 한다는 요청은 보고에 적는다(그 file은 `dp-shell-agents`가 고친다).
4. `packages/shell/renderer/app-frame/toast-handler.ts`, `annotate/{annotation-panel,use-annotate}.tsx|ts`, `app-detail/{model,source,core-source}.ts`의 App Engineer 문구·role key를 PM으로 바꾼다. `packages/shell/ipc/annotation.ts`의 주석(26째 줄)도.
5. wording: `packages/design/wording/catalog/app-space.ts`의 `app-detail.label.role-app-engineer`(132째 줄), "App Engineer was called …"(186, 188째 줄), `app-space.button.send-annotations`("Send to App Engineer", 235째 줄), 보관 안내(245째 줄), 안내 문장들(265, 272, 274째 줄)을 Project Manager로 바꾸고 안 쓰는 key는 지운다. `deno task wording`으로 생성물을 맞춘다(`.placeholders.ts`는 손으로 고치지 않는다).
6. wireframe: `tools/wireframes/pages/screens/app-space.tsx`, `app-space/space.tsx`와 `tools/wireframes/mock/app-space/coding-terminal.ts`(`/home/mina/.lophn/apps/orders/source` 두 곳, 16·80째 줄)를 새 이름·자리(`~/.lophn/projects/<prj>/app/source`)로 맞춘다.
7. fake source·test data(`packages/shell/renderer/app-frame/testdata/`, `app-detail/testdata/`)의 App Engineer를 PM으로. 위험 test는 두지 않는다.
8. 합집합이 아직 남아 있다: protocol의 `Role`·`Place`는 `dp-place-protocol`이 마지막에 줄인다. 그때까지 `app_engineer`·앱 place가 type에 있어 exhaustive `switch`나 `Record<Role, …>`가 오류를 내면 그 갈래만 새 로직 없이 남긴다(null, 빈 값). 남긴 곳은 보고의 "넘길 줄"에 file:줄로 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(화면·문구다)
- 남지 않음: `grep -rn "app_engineer\|App Engineer\|App Engineers" packages/shell/renderer/app-frame packages/shell/ipc/annotation.ts packages/design/wording/catalog/app-space.ts tools/wireframes/pages/screens/app-space.tsx tools/wireframes/pages/screens/app-space tools/wireframes/mock/app-space`가 0줄이다.
- (화면) `deno task wireframes`가 되고, gallery의 `appSpaceArea`(앱 공간 page)가 바뀐 agent select로 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성물(`deno task wording`)
- 안 쓰게 된 export
- 정한 것: 앱 공간이 project id를 얻는 길
- 넘길 줄: `packages/shell/renderer/desktop/main.tsx`(`dp-shell-agents`)가 앱 공간에 project id를 넘겨야 하면 요청으로 적는다
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
