# ds-shell-window

project 창을 가벼운 project의 창으로 마무리하고, project 없는 domain도 창으로 연다. 창은 project id(`prj_`)로 열고(폴더, Explorer, editor, terminal, layout, 검색, `LOPHN.md`), 창 안의 agent·artifact·앱은 그 project에 이은 domain들의 것을 `ds-shell-agents`가 만든 화면에 domain 목록으로 넘겨 보인다. project 없는 domain은 Explorer 없는 domain 창으로 연다. 호스트(`Desktop`)는 런처의 domain 카드, palette, session 열기를 이 두 종류의 창으로 잇는다.

**화면 모양은 사람이 Drafts에서 고른다(`ds-wireframe-drafts`).** lead가 띄우기 전에 "고른 안"을 채운다. 비어 있으면 시작하지 말고 lead에게 알린다.

- 단위: shell (wave 4)
- 선행: ds-shell-launcher, ds-shell-agents
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/add-tab-menu.tsx`
  - `packages/shell/renderer/workspace/add-tab-menu.module.css`
  - `packages/shell/renderer/workspace/app-panel-tab.tsx`
  - `packages/shell/renderer/workspace/app-panel-tab.module.css`
  - `packages/shell/renderer/workspace/core-source.ts`
  - `packages/shell/renderer/workspace/drag.ts`
  - `packages/shell/renderer/workspace/fake-source.ts`
  - `packages/shell/renderer/workspace/file-actions.tsx`
  - `packages/shell/renderer/workspace/keybindings_test.ts`
  - `packages/shell/renderer/workspace/launcher-button.tsx`
  - `packages/shell/renderer/workspace/layout-map.ts`
  - `packages/shell/renderer/workspace/model.ts`
  - `packages/shell/renderer/workspace/model_test.ts`
  - `packages/shell/renderer/workspace/notice-card.tsx`
  - `packages/shell/renderer/workspace/notice-card.module.css`
  - `packages/shell/renderer/workspace/source.ts`
  - `packages/shell/renderer/workspace/use-keybindings.ts`
  - `packages/shell/renderer/workspace/workspace.module.css`
  - `packages/shell/renderer/workspace/workspace.tsx`
  - `packages/shell/renderer/workspace/detached`
  - `packages/shell/renderer/workspace/floats`
  - `packages/shell/renderer/workspace/kinds`
  - `packages/shell/renderer/workspace/minimized`
  - `packages/shell/renderer/workspace/panes`
  - `packages/shell/renderer/workspace/search`
  - `packages/shell/renderer/workspace/top-path`
  - `packages/shell/renderer/workspace/visuals`
  - `packages/shell/renderer/workspace/sidebar/explorer-names.ts`
  - `packages/shell/renderer/workspace/sidebar/explorer-row.tsx`
  - `packages/shell/renderer/workspace/sidebar/explorer.tsx`
  - `packages/shell/renderer/workspace/sidebar/project-sidebar.module.css`
  - `packages/shell/renderer/workspace/sidebar/project-sidebar.tsx`
  - `packages/shell/renderer/workspace/sidebar/rail.tsx`
  - `packages/shell/renderer/workspace/sidebar/use-file-tree.ts`
  - `packages/shell/renderer/editor`
  - `packages/shell/renderer/browser`
  - `packages/shell/renderer/desktop/main.tsx`
  - `packages/shell/renderer/desktop/entry.tsx`
  - `packages/shell/renderer/desktop/router.ts`
  - `packages/shell/renderer/desktop/intents.tsx`
  - `packages/shell/renderer/desktop/dev-seed.ts`
  - `packages/shell/renderer/desktop/dev-mock`
  - `packages/shell/renderer/desktop/palette`
  - `packages/shell/main/workspace`
  - `packages/shell/main/editor`
  - `packages/shell/main/browser`
  - `packages/shell/main/desktop/detached`
  - `packages/shell/main/desktop/core/layout-ipc.ts`
  - `packages/shell/main/desktop/wiring/detached.ts`
  - `packages/shell/main/desktop/wiring/editor.ts`
  - `packages/shell/main/desktop/wiring/layout.ts`
  - `packages/shell/main/desktop/wiring/browser.ts`
  - `packages/shell/main/desktop/wiring/desktop-window.ts`
  - `packages/shell/ipc/detached.ts`
  - `packages/shell/ipc/instructions.ts`
  - `packages/shell/ipc/app-window.ts`
  - `packages/shell/ipc/workspace.ts`
  - `packages/shell/ipc/browser.ts`
  - `packages/shell/ipc/folder-picker.ts`
  - `packages/shell/ipc/overlay.ts`
  - `packages/shell/preload/layout-api.ts`
  - `packages/shell/preload/shell.ts`
  - `tools/wireframes/pages/screens/project-app.tsx`
  - `tools/wireframes/pages/screens/project-pages.tsx`
  - `tools/wireframes/pages/screens/project-window.tsx`
  - `tools/wireframes/pages/screens/project-workspace.tsx`
  - `tools/wireframes/pages/screens/project-detached`
  - `tools/wireframes/pages/screens/project-files`
  - `tools/wireframes/pages/screens/project-float`
  - `tools/wireframes/pages/screens/launcher`
  - `tools/wireframes/pages/screens/launcher.tsx`
  - `tools/wireframes/pages/screens/documents.tsx`
  - `tools/wireframes/pages/screens/bodies.tsx`
  - `tools/wireframes/mock/mock-desktop.tsx`
  - `tools/wireframes/mock/phroner-data.ts`
  - `tools/wireframes/mock/project-files`
  - `tools/wireframes/mock/fake-terminal.ts`
  - `tools/wireframes/mock/window-api.ts`
  - `tools/wireframes/mock/drive.ts`
  - `tools/wireframes/mock/driven.tsx`
  - `tools/wireframes/mock/connect-host.tsx`
- 읽을 것:
  - skill: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`
  - 계획: `project-docs/plan/domain-split/README.md`("정한 것"의 연결, place, coding agent, 화면 말), `tasks/ds-rename.md`("shell: 어디가 project로 남고 어디가 domain이 되나"), `tasks/ds-project-registry.md`(`project.get`의 `domains`), `tasks/ds-shell-agents.md`(`domains` 인자), `tasks/ds-shell-launcher.md`(`Launcher` props), `tasks/ds-coding-location.md`(`runtime.project`)
  - architecture: `project-docs/architecture/workspace-layout.md`(layout.json은 창 하나에 파일 하나, detached 창이 같은 창에 묶임), `place-session.md`(session을 어느 창에서 여는가), `coding-agent.md`, `artifact.md`
  - 본보기(화면): Drafts의 `dp-window-domain-*`, `dp-empty-states`, `dp-open-*`(`tools/wireframes/drafts/domain-project/`). 지금 화면은 `tools/wireframes/pages/screens/project-window.tsx`·`project-workspace.tsx`
  - 코드: `packages/shell/renderer/desktop/{main.tsx,entry.tsx,router.ts,intents.tsx,dev-seed.ts}`(`Desktop`, `openSession`, `DesktopTarget`, `openProject`), `packages/shell/renderer/workspace/{workspace.tsx,source.ts,core-source.ts,use-tab-host-slices.ts}`, `packages/shell/main/workspace/schema.ts`(layout의 key 칸), `packages/shell/main/desktop/core/layout-ipc.ts`, `packages/shell/main/desktop/wiring/desktop-window.ts`(`LOPHN_SHELL_START`), `packages/shell/main/editor/instructions.ts`
- 계약:
  - 쓰는 것: `ProjectView.domains`가 될 `project.get`의 `domains: [{id,name,title,status}]`, `useSidebarAgents(source, domains)`, `ArtifactPanel`·`AgentsTab`의 `domains`(`ds-shell-agents`), `Launcher`의 `domains`·`onDomain`·`domainsCoreSource`(`ds-shell-launcher`), 실행 계획·runtime의 `project`(`ds-coding-location`).
  - 내놓는 것: `Workspace`의 `target: { kind: "project" | "domain"; id: string }`, `Route`의 `space: "domain"`(`openDomain(id)`), `DesktopTarget`의 `{kind:"domain", id}`.

## 고른 안

(lead가 띄우기 전에 채운다: project 없는 domain 창 `dp-window-domain-…`, 열기 `dp-open-…`, 빈 상태 `dp-empty-states`)

## 정한 것

- layout 파일은 창을 연 id 하나로 파일 하나다(`workspace-layout.md`). schema의 key 칸 `project`(`prj_` 정규식)를 `owner`로 바꾸고 `prj_` 또는 `dom_` id를 받는다. domain 창도 같은 layout 모델을 쓴다(Explorer 탭만 없다). 옛 판 파일은 읽지 않는다(AGENTS.md "호환성". `LAYOUT_SCHEMA_VERSION`을 올린다).
- `ds-rename`이 `dom_`로 맞춘 project 가족의 id 정규식(`main/workspace/schema.ts`, `main/desktop/core/layout-ipc.ts`, `ipc/detached.ts`, `ipc/app-window.ts`, `ipc/instructions.ts`, `main/desktop/wiring/desktop-window.ts`의 `LOPHN_SHELL_START`)을 `prj_`로 돌린다. domain 창을 받는 곳(layout key, `LOPHN_SHELL_START=domain:dom_…`)만 둘 다 받는다.
- session을 열 창: session의 place가 domain이면 (1) 지금 열려 있거나 마지막으로 연 project 창 가운데 그 domain에 이은 것, (2) 없으면 이은 첫 project 창, (3) 이은 project가 없으면 그 domain 창이다. lophn(place 없음)은 지금처럼 마지막으로 연 창, 없으면 런처다.
- 창은 자기 id와 상관없이 바깥 사실을 한 번 읽는다: project 창은 `project.get`, domain 창은 `domain.get`. 창 안의 "이은 domain 목록"은 project 창이면 `ProjectView.domains`, domain 창이면 자기 하나다.
- `[Instructions]`(`LOPHN.md` 편집)는 project 창에만 있다(project의 첫 폴더 `LOPHN.md`. `main/editor/instructions.ts`는 폴더 없는 project는 `LOPHN.md`가 없다. `<data>/…/LOPHN.md` 대체 자리 코드는 지운다). domain 창에는 단추를 두지 않는다. `DOMAIN.md`를 사람이 고치는 화면은 이번에 만들지 않는다.
- 앱 panel 탭은 이은 domain들의 앱 목록을 보인다(domain마다 앱 하나).
- coding 터미널은 `runtime.project`가 이 창의 project id일 때만 이 창이 받는다(`workspace.tsx`의 filter. 앱 공간이 project 있는 계획을 받지 않는 쪽은 `ds-coding-location`이 맞춘다).

## 할 일

1. **id와 layout.** 위 "정한 것"의 정규식, layout `owner`, 판 올림을 한다. `main/workspace/schema.ts`, `layout-store.ts`(저장 위치 key), `renderer/workspace/layout-map.ts`·`model.ts`를 맞춘다. layout 파일을 읽고 쓰는 test(`model_test.ts`)는 새 key로 옮긴다.
2. **source.** `renderer/workspace/source.ts`의 `ProjectView`에 `domains`를 더하고 `core-source.ts`(`project.get` 호출)와 `fake-source.ts`를 맞춘다. `WorkspaceSource`에 domain 창용 읽기(`domain.get`)가 필요하면 `target`이 domain일 때 `folders: []`, `domains: [self]`인 `ProjectView` 모양으로 돌려주게 한다(화면이 한 모양만 본다).
3. **Workspace.** `workspace.tsx`의 `projectId` prop을 `target`으로 바꾸고, 이은 domain 목록을 `useSidebarAgents`·`ArtifactPanel`·`AgentsTab`·앱 panel에 넘긴다. `ds-shell-agents`가 임시로 둔 `[{id: 창 id}]`를 지운다. agent 탭을 여는 place는 `{kind:"domain", id}`이고 key는 `(domain, role key)`다. 고른 안대로 domain 창의 Explorer 탭 처리와 빈 상태(이은 domain이 없는 project 창, 이은 project가 없는 domain 창)를 둔다. `props.projectManager`는 `domainEngineer?: string`(열 domain id)으로 바꾼다.
4. **호스트.** `desktop/router.ts`에 `space: "domain"`과 `openDomain`, `main.tsx`의 `go`·`openSession`·`openProjectManager` 반응(`reactions.ts`의 `domain-engineer`)을 위 session 창 규칙으로 잇는다. `entry.tsx`가 `domainsCoreSource`와 `domains`·`onDomain`을 `Launcher`에 넘긴다. `dev-mock/`·`dev-seed.ts`에 domain과 연결 data를 더한다. `palette/`: project 행과 domain 행(`DesktopTarget`의 `domain`), 키워드 검색은 project 폴더 범위 그대로다(`workspace-scope.ts`는 domain 창에서 파일 묶음이 없다). `main/desktop/wiring/desktop-window.ts`의 `LOPHN_SHELL_START`에 `domain:<id>`를 더한다.
5. **LOPHN.md 편집.** `main/editor/instructions.ts`, `ipc/instructions.ts`, `renderer/editor/`를 위 규칙에 맞춘다. 폴더가 없는 project에는 `[Instructions]`를 두지 않는다.
6. **gallery.** `project-*` 페이지와 `mock/`을 새 모양으로 고친다(project 창 + domain 둘이 이어진 창, domain 창). `Desktop` 호스트가 이제 새 props를 넘기므로 `ds-shell-launcher`가 `Launcher`를 직접 그리게 한 gallery 페이지를 `MockDesktop`으로 돌리고 `tools/wireframes/pages/screens/launcher/`의 임시 직접 render는 지운다(launcher gallery 파일은 `ds-shell-launcher`가 끝났으므로 이 task가 소유한다).
7. **wording.** 새 문구는 key로 쓴다(`workspace.ts` catalog의 `project-workspace.*`, 필요한 새 key). 폴더·창 말은 "Project", 경계 말은 "Domain"이다. 생성물은 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 만든다.
8. **확인.** `deno task check:full`, `deno run -A packages/shell/renderer/build.ts`, `deno task wireframes`, `project-docs/plan/tools/lead/boot.sh`. `deno task dev:mock`(`.claude/skills/ui-design/SKILL.md` "확인")으로 mock 데이터의 project 창과 domain 창을 눈으로 본다.

## 끝남

- `deno task check:full`이 통과하고 renderer build와 `deno task wireframes`가 된다.
- 위험 test: 없음(화면이다). `model_test.ts`의 탭 이동 위험 test가 새 key에서도 통과한다.
- 남지 않음:
  - `grep -rnE "dom_" packages/shell/main/workspace packages/shell/main/desktop/core/layout-ipc.ts packages/shell/ipc/detached.ts packages/shell/ipc/app-window.ts packages/shell/ipc/instructions.ts`가 domain 창 key를 받는 한 곳 말고 0줄이다.
  - `grep -rn "projectManager" packages/shell`이 0줄이다.
  - `grep -rnE "\[\{ *id: *(projectId|project)" packages/shell/renderer/workspace`가 0줄이다(임시 domain 목록).
- (화면) `deno task wireframes`가 되고 gallery의 `project-*` page가 옮긴 component로 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성 결과, gallery `pages/index.ts`는 바꾸지 않았음
- 안 쓰게 된 export
- 정한 것: session 창 규칙, layout key와 판, 고른 안에 답이 없던 세부
- 넘길 줄: 없음
- 계약 바꾸기 요청: `project.get`·`domain.get` 모양 변경이 필요하면 적는다
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: `DOMAIN.md`를 사람이 고치는 화면이 없다. 그 밖에 안 되는 동작.
