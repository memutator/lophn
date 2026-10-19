# dk-shell-workspace

shell에서 context 화면을 지운다: Contexts 탭, Context 탭, Search 탭의 **선언된 검색 갈래**, 문서 info의 "Contexts" 탭(이 문서를 담은 context), sidebar의 Context 탭, rail의 Contexts·Saved views, 새 탭 menu의 Context, palette의 contexts 묶음, mock/dev 시드의 context 예시, 위반 toast가 PM을 열 때 붙이던 context chip 쪽(workspace 쪽). kind를 보는 새 화면은 만들지 않는다. project 키워드 검색(Search 탭의 `query`·`folder` 갈래)은 **남긴다**.

README는 "search tab"을 지운다고 적었지만 `main/workspace/kinds/search.ts`와 `renderer/workspace/kinds/search.tsx`는 한 kind가 두 갈래(선언된 검색 / project 키워드 검색)다. context 갈래만 지운다.

코드 이름은 아직 `project`·`project_manager`다.

- 단위: shell (wave 3)
- 선행: dk-wireframes, dk-operator-contexts
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/contexts/`
  - `packages/shell/renderer/workspace/kinds/`
  - `packages/shell/renderer/workspace/workspace.tsx`
  - `packages/shell/renderer/workspace/use-tab-host-slices.ts`
  - `packages/shell/renderer/workspace/source.ts`
  - `packages/shell/renderer/workspace/core-source.ts`
  - `packages/shell/renderer/workspace/add-tab-menu.tsx`
  - `packages/shell/renderer/workspace/sidebar/rail.tsx`
  - `packages/shell/renderer/workspace/sidebar/project-sidebar.tsx`
  - `packages/shell/renderer/workspace/reactions/`
  - `packages/shell/renderer/workspace/agent/agent-tab.tsx`
  - `packages/shell/renderer/workspace/agent/tab-fields.ts`
  - `packages/shell/renderer/editor/info-panel/info-panel.tsx`
  - `packages/shell/renderer/editor/file-frame.tsx`
  - `packages/shell/renderer/editor/document-view.tsx`
  - `packages/shell/renderer/editor/text-file-view.tsx`
  - `packages/shell/renderer/desktop/dev-seed.ts`
  - `packages/shell/renderer/desktop/dev-mock/mod.ts`
  - `packages/shell/renderer/desktop/palette/labels.ts`
  - `packages/shell/renderer/desktop/palette/model.ts`
  - `packages/shell/renderer/desktop/palette/workspace-scope.ts`
  - `packages/shell/renderer/desktop/router.ts`
  - `packages/shell/renderer/desktop/main.tsx`
  - `packages/shell/renderer/conversation/slash-menu/slash-menu.tsx`
  - `packages/shell/renderer/icons/workspace.ts`
  - `packages/shell/main/workspace/kinds/`
  - `packages/protocol/shell/workspace.ts`
- 읽을 것:
  - plan: `project-docs/plan/domain-kinds/README.md`("정한 것"의 화면, "같이 도는 계획" 표: `artifact`가 tab kind·sidebar·add-tab menu·palette·`use-tab-host-slices.ts`를, `domain-place`가 앱 place 화면을 같이 고친다. **context 쪽 줄만 지우고 다른 줄은 건드리지 않는다**)
  - architecture: `project-docs/architecture/workspace-layout.md`(tab kind, layout 파일, 복원), `project-docs/architecture/ui-kit.md`
  - 규칙: `.claude/skills/ui-design/SKILL.md`(화면을 바꿀 때), `.claude/skills/wording/SKILL.md`(문구 key는 이 task가 지우지 않는다 — `dk-delete-wording`이 정리한다)
  - 고칠 곳(확인된 위치. 한 곳에서 시작해 type 오류를 따라간다. 빠진 곳은 `rg -n -i "context" packages/shell --glob '!**/node_modules/**' --glob '!**/dist/**'`로 찾되 `contextBridge`·`createContext`·`useContext`·`contextmenu`·모델 context window 같은 무관한 것은 뺀다):
    - 지우는 file: `renderer/workspace/contexts/` 전체(css 포함), `renderer/workspace/kinds/context.tsx`·`contexts.tsx`, `main/workspace/kinds/context.ts`·`contexts.ts`
    - `kinds/search.tsx`·`main/workspace/kinds/search.ts`: 선언된 검색 갈래(`declaredLayout`, `context`·`declared_search`·`inputs`·`page`·`saved_view`, `SearchTab` import, `restore`의 context·search 검사)를 빼고 키워드 갈래만 남긴다. `renderer/workspace/search/`(FileSearch)는 건드리지 않는다.
    - `kinds/registry.ts`·`main/workspace/kinds/registry.ts`: `contextKind`·`contextsKind` 줄. `main/workspace/kinds/values.ts`: `contextId`, `savedViewId`, `searchInputs`, `CONTEXT_SUB_TABS`(쓰는 곳이 없어지면). `main/workspace/kinds/kind.ts`: `RestoreTargets.context`·`declaredSearch`, `PlaceholderReason`의 `context_missing`·`search_missing`. `kinds/host.ts`: `ContextsSlice`·`contexts` 칸·`SearchTabState` import. `kinds/agents.tsx:8`: `TAB_KEY`를 `../contexts/tab-fields.ts`에서 가져온다 — 이 상수가 다른 곳에도 필요하면 `kinds/` 안의 작은 file로 옮긴다. `kinds/agent.tsx`: `chips`(ContextChipView)와 첫 말에 chip을 붙이던 부분. `kinds/document-editor.tsx`: `DocumentContexts`·`host.contexts`·`openContext`
    - `workspace.tsx`: `ContextSidebar`·`openContext`·`openContexts`·`contextsSource`·`contextList`/`readContexts`·`contexts` slice·`contextPanel`·rail 동작(`contexts`, `saved` 분기 ≈:915~950)·`projectManager?` prop(≈:152)과 그 열기(≈:598~616, `openProjectManager`). `use-tab-host-slices.ts`: `contextsSource`·`contextList`·`ContextsSlice`·`askPm`의 chip. `source.ts`/`core-source.ts`: `contextsSource`·`coreContextsSource`
    - `sidebar/project-sidebar.tsx`: `SidebarTab`의 `"context"`, `contextPanel`. `sidebar/rail.tsx`: `RAIL_ACTIONS`의 `contexts`·`saved`(rail에는 terminal·agent·search가 남는다). `add-tab-menu.tsx`: `Level`의 `"context"`, `contexts`·`onContext` prop
    - `reactions/project-manager.ts`: 위반 chip을 읽던 `contextChips`를 없애고 `openProjectManager(env)`가 PM Agent 탭을 chip 없이 연다(열린 session이 있으면 그 탭, 없으면 새 session 탭. `openedProjectManagerSession`·`agentByRole`은 그대로). `reactions/toast-handler.ts`: host의 `openProjectManager()`가 인자를 받지 않는다(`action.context`·`action.check`를 읽지 않는다. toast action type 자체는 `dk-chips-reactions`가 바꾼다). `desktop/router.ts:30`·`desktop/main.tsx:128,317`: `projectManager` route 값을 `{ context, check }`에서 인자 없는 신호(`true`)로
    - `agent/agent-tab.tsx`·`agent/tab-fields.ts`: `chips`·`chipsOf`·`ContextChipView` import (type 자체는 `renderer/conversation/composer/`에 있고 `dk-chips-reactions`가 지운다)
    - `editor/info-panel/info-panel.tsx`: `InfoTabId`의 `"contexts"`, `contexts` prop과 탭. `editor/file-frame.tsx`·`document-view.tsx`·`text-file-view.tsx`: 그 prop 전달
    - `desktop/palette/{labels,model,workspace-scope}.ts`: `contexts` 묶음, `CONTEXT_PALETTE_PREFIX`·`contextPaletteItems`·`ContextListItem`, 항목 `kind: "context"`와 그 열기. 호출하는 쪽(`palette/host.tsx` 등 `rg`로)
    - `desktop/dev-seed.ts`·`desktop/dev-mock/mod.ts`: context 예시 문서와 `createFakeContextsSource`
    - `conversation/slash-menu/slash-menu.tsx:64`: `"new-context": workspaceIcons.context` 항목(그 명령은 이미 없다). `icons/workspace.ts:42`: `context: Library` — 쓰는 곳이 모두 없어지면 지운다(`rg "workspaceIcons.context|paletteIcons.context" packages tools`). PM의 profile icon 이름 `"contexts"`(`agent-roles` role 표)는 icon id라 건드리지 않는다.
    - `protocol/shell/workspace.ts`: `CONTEXT_SUB_TABS`, `contextIdSchema`, 입력·출력 두 union의 `contexts`·`context`·context를 요구하는 `search` 가지. 키워드 검색 탭이 이 union으로 보고되는지(`rg -n "declared_search|viewTab" packages`)를 확인하고, 아니면 `search` 가지를 통째로 빼며, 맞다면 `context`를 뺀 키워드 모양(`query`, `folder`)으로 바꾼다.
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음. tab kind `contexts`·`context`가 layout schema에서 사라진다. 저장된 옛 layout 파일은 읽히지 않을 수 있다 — 개발 data는 지운다(AGENTS.md "호환성").

## 할 일

1. `dk-wireframes`가 gallery의 import를 끊은 상태에서 시작한다(`rg -n "workspace/contexts" tools/wireframes`가 0줄인지 먼저 확인).
2. 위 file을 지우고 고친다. `deno task check`의 type 오류를 따라간다.
3. `deno run -A packages/shell/renderer/build.ts`(renderer build)가 되는지 본다(`check:full`이 못 보는 것. `.claude/skills/orchestrate/SKILL.md`의 함정).
4. layout 파일 schema를 읽는 test가 있으면(`rg -l "context" packages/shell/main/workspace`) 지운 kind의 줄을 뺀다.

## 정한 것

- 사람이 `kinds.yaml`을 보려면 파일 탭(editor)으로 연다. 별도 화면이 없다(README).
- toast의 "Ask Project Manager"는 chip 없이 PM 탭만 연다. 위반 내용은 PM이 `kind.check`·`problem.list`로 읽는다.
- 키워드 검색은 그대로 둔다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(화면). 지우는 test 외에 새 test를 쓰지 않는다.
- 남지 않음: `rg -n -i "contexts?\b" packages/shell --glob '!**/node_modules/**' --glob '!**/dist/**'` 중 `renderer/conversation/**`(chips는 `dk-chips-reactions`)와 `renderer/workspace/agents/**`(`dk-operator-contexts`)와 wording 사용 key 이름, 무관한 말(`contextBridge`, `createContext`, `useContext`, `contextmenu`, 모델 `context` 한도)을 뺀 줄이 0이다. `rg -n "workspace/contexts|kinds/context|ContextsSlice|contextsSource|CONTEXT_SUB_TABS|contextKind|contextsKind" packages tools`가 0줄이다.
- 화면: `deno task wireframes`가 되고 Project window가 Context 없이 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 안 쓰게 된 wording key 이름 목록(`dk-delete-wording`이 지운다)
- 정한 것
- 넘길 줄: `artifact`·`domain-place`가 같이 고치는 file에서 건드린 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
