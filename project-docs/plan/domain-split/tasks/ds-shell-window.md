# ds-shell-window

project 창을 가벼운 project의 창으로 마무리한다. 창은 project id(`prj_`)로 열고(폴더, Explorer, editor, terminal, layout, 검색, `LOPHN.md`), 창 안의 agent·artifact·앱은 그 project에 속한 domain들의 것을 `ds-shell-agents`가 만든 화면에 domain 목록으로 넘겨 보인다. domain은 늘 project에 속하므로 domain만 여는 창은 없다. 호스트(`Desktop`)는 session 열기와 Domain Engineer 반응을 "그 domain의 project 창"으로 잇고, 런처의 새 props와 domain 만들기 dialog를 창에 잇는다.

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
  - 계획: `project-docs/plan/domain-split/README.md`("정한 것"의 "domain의 project", place, coding agent, 화면 말), `tasks/ds-rename.md`("shell: 어디가 project로 남고 어디가 domain이 되나"), `tasks/ds-project-registry.md`(`project.get`의 `domains`, `domain.get`의 `project`), `tasks/ds-shell-agents.md`(`domains` 인자, [Add domain] callback), `tasks/ds-shell-launcher.md`(`Launcher` props, domain 만들기 dialog), `tasks/ds-coding-location.md`(`runtime.project`)
  - architecture: `project-docs/architecture/workspace-layout.md`(layout.json은 창 하나에 파일 하나, detached 창이 같은 창에 묶임), `place-session.md`(session을 어느 창에서 여는가), `coding-agent.md`, `artifact.md`
  - 본보기(화면): Drafts의 `dp-sidebar-*`, `dp-agents-tab-*`, `dp-create-*`, `dp-empty-states`(`tools/wireframes/drafts/domain-project/`). 지금 화면은 `tools/wireframes/pages/screens/project-window.tsx`·`project-workspace.tsx`
  - 코드: `packages/shell/renderer/desktop/{main.tsx,entry.tsx,router.ts,intents.tsx,dev-seed.ts}`(`Desktop`, `openSession`, `DesktopTarget`, `openProject`), `packages/shell/renderer/workspace/{workspace.tsx,source.ts,core-source.ts,use-tab-host-slices.ts}`, `packages/shell/main/workspace/schema.ts`(layout의 key 칸), `packages/shell/main/desktop/core/layout-ipc.ts`, `packages/shell/main/desktop/wiring/desktop-window.ts`(`LOPHN_SHELL_START`), `packages/shell/main/editor/instructions.ts`
- 계약:
  - 쓰는 것: `ProjectView.domains`가 될 `project.get`의 `domains: [{id,name,title,status}]`, `domain.get`의 `project`(session의 domain → 열 project), `useSidebarAgents(source, domains)`, `ArtifactPanel`·`AgentsTab`의 `domains`와 [Add domain] callback(`ds-shell-agents`), `Launcher`의 `domains`와 `domainsCoreSource`, domain 만들기 dialog(`ds-shell-launcher`), 실행 계획·runtime의 `project`(`ds-coding-location`).
  - 내놓는 것: 없다. 창의 key는 지금처럼 project id 하나다.

## 고른 안

(lead가 띄우기 전에 채운다: 빈 상태 `dp-empty-states`, domain 만들기 위치 `dp-create-…`)

## 정한 것

- `ds-rename`이 `dom_`로 맞춘 project 가족의 id 정규식(`main/workspace/schema.ts`, `main/desktop/core/layout-ipc.ts`, `ipc/detached.ts`, `ipc/app-window.ts`, `ipc/instructions.ts`, `main/desktop/wiring/desktop-window.ts`의 `LOPHN_SHELL_START`)을 `prj_`로 돌린다. layout 파일의 key 칸 `project`는 이름 그대로 두고 `prj_`만 받는다. 이 정규식을 바꾸므로 `LAYOUT_SCHEMA_VERSION`을 올린다(옛 판 파일은 읽지 않는다. AGENTS.md "호환성").
- session을 열 창: session의 place가 domain이면 그 domain의 project(`domain.get`의 `project`) 창이다. 같은 project 창이 이미 열려 있으면 그 창을 쓴다. lophn(place 없음)은 지금처럼 마지막으로 연 창, 없으면 런처다.
- `[Instructions]`(`LOPHN.md` 편집)는 project의 첫 폴더 `LOPHN.md`다. 폴더 0개 project에는 단추를 두지 않는다. `main/editor/instructions.ts`의 `<data>/…/LOPHN.md` 대체 자리 코드는 지운다. `DOMAIN.md`를 사람이 고치는 화면은 이번에 만들지 않는다.
- 앱 panel 탭은 그 project의 domain들의 앱 목록을 보인다(domain마다 앱 하나).
- coding 터미널은 `runtime.project`가 이 창의 project id이면 이 창이 받는다(`workspace.tsx`의 filter. 앱 공간이 받지 않는 쪽은 `ds-coding-location`이 맞춘다).

## 할 일

1. **id와 layout.** 위 "정한 것"의 정규식, 판 올림을 한다. `main/workspace/schema.ts`, `layout-store.ts`, `renderer/workspace/layout-map.ts`·`model.ts`를 맞춘다. layout 파일을 읽고 쓰는 test(`model_test.ts`)는 새 판에 옮긴다.
2. **source.** `renderer/workspace/source.ts`의 `ProjectView`에 `domains`를 더하고 `core-source.ts`(`project.get` 호출)와 `fake-source.ts`를 맞춘다.
3. **Workspace.** `workspace.tsx`가 `ProjectView.domains`를 `useSidebarAgents`·`ArtifactPanel`·`AgentsTab`·앱 panel에 넘긴다. `ds-shell-agents`가 임시로 둔 `[{id: 창 id}]`를 지운다. agent 탭을 여는 place는 `{kind:"domain", id}`이고 key는 `(domain, role key)`다. 고른 안대로 domain이 없는 project 창의 빈 상태와 [Add domain](launcher의 만들기 dialog를 열고, 만든 뒤 `project.get`을 다시 읽는다)을 잇는다. `props.projectManager`는 `domainEngineer?: string`(열 domain id)으로 바꾼다.
4. **호스트.** `main.tsx`의 `openSession`·반응 case(`reactions.ts`의 `domain-engineer`: `openProject(그 domain의 project, { domainEngineer })`)를 위 규칙으로 잇는다. domain → project는 `project.list`가 싣는 `domains`를 모은 catalog에서 찾는다(`palette/core-catalog.ts`). `entry.tsx`가 `domainsCoreSource`와 `domains`를 `Launcher`에 넘긴다. `dev-mock/`·`dev-seed.ts`에 project 안 domain data를 더한다. `palette/`는 project 행과 키워드 검색 그대로다(domain 행은 두지 않는다. 고른 안에 있으면 그때 더한다).
5. **LOPHN.md 편집.** `main/editor/instructions.ts`, `ipc/instructions.ts`, `renderer/editor/`를 위 규칙에 맞춘다.
6. **gallery.** `project-*` 페이지와 `mock/`을 새 모양으로 고친다(domain 둘이 속한 project 창, domain 없는 project 창). `Desktop` 호스트가 새 props를 넘기므로 `ds-shell-launcher`가 `Launcher`를 직접 그리게 한 gallery 페이지를 `MockDesktop`으로 돌리고 임시 직접 render는 지운다(launcher gallery 파일은 `ds-shell-launcher`가 끝났으므로 이 task가 소유한다).
7. **wording.** 새 문구는 key로 쓴다(`workspace.ts` catalog의 `project-workspace.*`, 필요한 새 key). 폴더·창 말은 "Project", 경계 말은 "Domain"이다. 생성물은 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 만든다.
8. **확인.** `deno task check:full`, `deno run -A packages/shell/renderer/build.ts`, `deno task wireframes`, `project-docs/plan/tools/lead/boot.sh`. `deno task dev:mock`(`.claude/skills/ui-design/SKILL.md` "확인")으로 mock 데이터의 project 창을 눈으로 본다.

## 끝남

- `deno task check:full`이 통과하고 renderer build와 `deno task wireframes`가 된다.
- 위험 test: 없음(화면이다). `model_test.ts`의 탭 이동 위험 test가 새 판에서도 통과한다.
- 남지 않음:
  - `grep -rn "dom_" packages/shell/main/workspace packages/shell/main/desktop/core/layout-ipc.ts packages/shell/ipc/detached.ts packages/shell/ipc/app-window.ts packages/shell/ipc/instructions.ts`가 0줄이다.
  - `grep -rn "projectManager" packages/shell`이 0줄이다.
  - `grep -rnE "\[\{ *id: *(projectId|project)" packages/shell/renderer/workspace`가 0줄이다(임시 domain 목록).
- (화면) `deno task wireframes`가 되고 gallery의 `project-*` page가 옮긴 component로 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성 결과, gallery `pages/index.ts`는 바꾸지 않았음
- 안 쓰게 된 export
- 정한 것: session 창 규칙, layout 판, 고른 안에 답이 없던 세부
- 넘길 줄: 없음
- 계약 바꾸기 요청: `project.get`·`domain.get` 모양 변경이 필요하면 적는다
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: `DOMAIN.md`를 사람이 고치는 화면이 없다. 그 밖에 안 되는 동작.
