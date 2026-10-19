# dk-wireframes

wireframe gallery(`tools/wireframes`)에서 context 화면을 지운다: Contexts 화면 묶음(`contexts`, `context-body`, `contexts/*`)과 그 mock(`mock/contexts/`), 그리고 다른 화면 안에 끼어 있던 Context 사이드바·Context 탭·문서 info의 Contexts 탭. 이 gallery는 실제 shell component를 그대로 그리므로(`project-window.tsx`가 `ContextSidebar`·`NewTabMenu`를 import한다) **shell에서 context component를 지우기 전에** 이 task가 import를 모두 끊어야 한다. 그래서 `dk-shell-workspace`가 이 task 뒤다.

- 단위: wireframes (wave 3)
- 선행: dk-operator-contexts
- 소유(이 task만 고친다):
  - `tools/wireframes/pages/index.ts`
  - `tools/wireframes/pages/screens/context-body.tsx`
  - `tools/wireframes/pages/screens/contexts.tsx`
  - `tools/wireframes/pages/screens/contexts/`
  - `tools/wireframes/pages/screens/documents.tsx`
  - `tools/wireframes/pages/screens/project-workspace.tsx`
  - `tools/wireframes/pages/screens/project-window.tsx`
  - `tools/wireframes/pages/screens/project-app.tsx`
  - `tools/wireframes/pages/screens/project-pages.tsx`
  - `tools/wireframes/pages/screens/project-files/`
  - `tools/wireframes/pages/kit/overlay/page.tsx`
  - `tools/wireframes/mock/contexts/`
  - `tools/wireframes/mock/phroner-data.ts`
- 읽을 것:
  - plan: `project-docs/plan/domain-kinds/README.md`("정한 것"의 화면: contexts tab·context tab·search tab의 context 쪽·document의 "이 문서를 담은 context"를 지운다. kind를 보는 새 화면은 만들지 않는다)
  - 규칙: `.claude/skills/ui-design/SKILL.md`(wireframe gallery 규칙), `project-docs/architecture/ui-kit.md`
  - 고칠 곳(확인된 위치. `rg -n -i "context" tools/wireframes --glob '!**/dist/**'`에서 `contextmenu`·`FieldContext`·모델 context window 같은 무관한 것을 빼고 본다):
    - `pages/index.ts`: `contextsArea` import(≈:25)와 목록(≈:63), 주석(≈:9)
    - `pages/screens/project-window.tsx`: `ContextSidebar`·`createFakeContextsSource`·`PageContextPanel`·`CONTEXT_CHOICES`·`context`/`contexts` 탭 종류와 icon(`workspaceIcons.context`)·`NewTabMenu`의 `contexts` prop
    - `pages/screens/project-workspace.tsx`: `ContextSidebar`·`DocumentInfoContexts`·`./contexts/context-pages.tsx` import, "Sidebar · Context", "Document · info panel, Contexts" 등 화면 설명과 항목, 선언된 검색 table 항목(≈:485)
    - `pages/screens/project-pages.tsx`: `context(sub)` TabSpec(≈:8), 탭 kind·메뉴·rail·info 설명의 Context/Contexts
    - `pages/screens/project-files/pages.tsx`: `ContextSidebar`(≈:63)·`DocumentInfoContexts`(≈:165). `project-files/tab-menu.tsx`는 Context 항목이 있으면 같이
    - `pages/screens/documents.tsx`: `DocumentContexts`·`createFakeContextsSource` import(≈:8,9)·`contextOf`·`contextTab`·`InfoPanel`의 `"contexts"`
    - `pages/screens/project-app.tsx`: `ContextBody`·`ContextsList`·`DeclaredSearch`·`HostProvider`(mock/contexts/open-tab)·`context`/`contexts` 탭
    - `pages/kit/overlay/page.tsx`: `paletteIcons.context`(≈:52)와 "3 contexts include this" 문구(≈:245,264,320) — 의미 없는 예시 문구로 바꾼다
    - `mock/phroner-data.ts`: `contextTab`·`contextOf`(≈:41~50)
  - 이 task가 건드리지 않는 것: `pages/screens/agents-tab.tsx`·`agent-settings.tsx`·`agent-pages.tsx`·`mock/agents-data.ts`(`dk-operator-contexts`), `pages/screens/agent-chat.tsx`·`waiting/waiting-pages.tsx`(`dk-chips-reactions`), 검색 탭의 **키워드 검색** 화면(`FILES_SEARCH`, project 키워드 검색은 남는다)
- 계약:
  - 쓰는 것: shell component(import만)
  - 내놓는 것: 없음

## 할 일

1. context 화면 file과 mock 폴더를 지운다: `pages/screens/{context-body,contexts}.tsx`, `pages/screens/contexts/`, `mock/contexts/`.
2. 위 위치에서 context 쪽 항목·import·상태를 지운다. 화면 설명 글(`note`/`description`)에서 Context 이야기를 뺀다. 탭 종류 union에서 `context`·`contexts`를 뺀다(`tools/wireframes`의 `TabSpec`이 shell의 tab kind type과 같다면 shell 쪽은 `dk-shell-workspace`가 바꾼다. 이 task는 wireframes 안의 값만 다룬다).
3. `pages/index.ts`에서 `contextsArea` 줄을 뺀다(등록 줄 제거는 lead 규칙의 예외다).
4. `deno task wireframes`가 되는지 본다(실패하면 원인이 이 task인지 환경인지 보고).

## 끝남

- `deno task check`가 통과한다(wireframes workspace의 type check 포함).
- 위험 test: 없음(화면).
- 남지 않음: `rg -n -i "contexts?\b" tools/wireframes --glob '!**/dist/**'`에서 `agents-tab`·`agent-settings`·`agent-pages`·`agents-data`·`agent-chat`·`waiting-pages`(다른 task 몫)와 `contextmenu`·`FieldContext`·`ContextReader`·모델 `context` 한도 같은 무관한 줄을 뺀 것이 0줄이다. `rg -n "workspace/contexts|mock/contexts|screens/contexts" tools` 가 0줄이다.
- 화면: `deno task wireframes`가 되고, gallery에서 Project window·Documents 화면이 Context 없이 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
