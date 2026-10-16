# screens-contexts-overview

context 화면의 틀과 읽기 쪽을 새로 옮긴다. Contexts 탭(카드 목록, 보관), Context 탭의 머리(적용된 판, 판 목록과 되돌리기)와 하위 탭 틀, Overview, Contract, 문서 정보 panel의 Contexts 탭, project sidebar의 Context 모양(contexts 목록과 saved views)이다. agent를 부르는 단추([Ask Context Engineer], [History])와 [New context]는 없다. context는 Project Manager가 대화에서 만든다. 만드는 중 화면, 30초 polling, `stamp` 다시 읽기, 옛 위반 toast와 rail은 지운다. Searches·Violations·Glossary 하위 탭과 gallery는 뒤의 `screens-contexts-views`가 한다.

- 단위: screens-contexts (wave 3)
- 선행: `screens-project-reactions`(`workspace/workspace.tsx`를 차례로 고친다), screens-project-window (이 task가 지우는 `useContextWatch`·`contextStamp`·`ViolationToast`·`shortcut-rail`·`settleContextTabs`를 `workspace.tsx`와 `sidebar/`가 더는 부르지 않아야 한다), screens-project-search (`kinds/search.tsx`가 `onAsk`를 더는 넘기지 않아야 한다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/contexts/` 가운데 `contexts-tab*.ts(x)`·`contexts-tab.module.css`, `context-frame*`, `context-tab-body.tsx`, `context-overview*`, `context-composition*`, `contract-details*`, `document-contexts*`, `context-drafting*`(지운다), `context-watch.ts`(지운다), `use-context-read.ts`, `violation-toast.tsx`(지운다), `shortcut-rail*`(지운다), `settle-tabs.ts`(지운다), `source.ts`, `core-source.ts`, `fake-source.ts`, `tab-fields.ts`, `shared.ts`, `error-reason.ts`, `context-palette-group.ts`, `context-sidebar.tsx`(새로)
  - `tools/wireframes/frames/compositions/contexts/contexts-list.tsx`, `contexts-data.ts`, `context-pages.tsx`의 `ContextsTabPage`·`ContextsArchivedPage`·`ContextVersionsPage`·`ContextRestoredPage`·`ContextOverviewPage`·`ContextContractPage`
  - `packages/shell/renderer/workspace/workspace.tsx`의 `ProjectSidebar` `contextPanel` slot에 `ContextSidebar`를 끼우는 한 줄과 그 import(추가 소유, lead 승인 2026-10-16: screens-project-window 소유 file이다. 이 줄만 고친다)
  - `packages/design/wording/catalog/contexts.ts`와 생성물 `catalog/contexts.placeholders.ts` (wording-split이 만든 영역 file. ownership.md에 없어 추가 소유, lead 승인 2026-10-16)
- 읽을 것:
  - spec: S1 8장(Context 탭은 열 때 읽는다. 위반은 `ContextViolationFound` toast) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - spec: S4 4장(Project Manager가 context를 만들고 판을 제출한다), S8 2장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`, `place-session.md`
  - inventory: `U1.3#11`(Context 탭 머리의 [Ask Context Engineer]·[History] 지우기), `U1.3#13`([New context]와 안내 글 지우기), `U1.3#14`([New context] 뒤 agent 탭 열기·draft 탭·drafting 표시 지우기), `U1.3#15`(30초 polling 지우기), `U1.3#18`(문구: context의 agent 부르기와 new context 계열 key), `U2.3#17`, `U2.3#18`, `U2.3#19`, `U3.3#11`, `U6.4#3`, `U6.1#1`
  - inventory(다른 단위에서 넘어온 줄): `U1.3#16`(화면을 둔 채 다시 읽는 `stamp` 장치 지우기), `U3.3#10`(sidebar의 saved view 목록)
  - 결정: `../README.md` 3장 #57(`project_manager`)
  - 지금 코드: `contexts/contexts-tab.tsx`(170줄), `contexts-tab-load.ts`, `contexts-tab-rows.ts`, `context-frame.tsx`(203줄: `onAsk`, `onHistory`, `stamp`, `ContextDrafting`), `context-tab-body.tsx`(`onHistory={onAsk}`), `context-overview*.ts(x)`, `context-composition*.ts(x)`, `contract-details*.ts(x)`, `document-contexts.tsx`, `use-context-read.ts`(`contextStamp`), `context-watch.ts`, `context-drafting*.ts(x)`, `source.ts`(`ContextsSource`: `draft`, `operatorCounts` 등), `core-source.ts`(316줄), `fake-source.ts`(1,191줄: `createFakeContextsSource`, `EVAL`), `workspace/kinds/{context, contexts}.tsx`(window 소유. 읽기만)
  - 본보기(화면): `tools/wireframes/frames/compositions/contexts/contexts-list.tsx`(120줄), `contexts-data.ts`(151줄), `context-body.tsx`(801줄: `Header` 37줄~, `VersionList` 87줄~, `RelationDiagram`, `Contract` 234줄~, `Overview` 652줄~, `ContextBody` 720줄~), `project-files/pages.tsx`의 `ContextSidebar`·`DocumentInfoContexts`, `contexts/context-pages.tsx`, `contexts/contexts.module.css`
- 계약:
  - 쓰는 것:
    - `packages/protocol/projects`(contract-calls-places): context 읽기·판 목록·되돌리기(`bundle.rollback`)·보관·용어집·saved view의 route와 schema. 이름은 고정된 파일을 따른다.
    - 외부가 import하는 이름은 유지한다: `contextPaletteItems`·`CONTEXT_PALETTE_PREFIX`·`ContextListItem`(`desktop/palette/workspace-scope.ts`), `createFakeContextsSource`·`contextExampleFiles`용 `EVAL`(`desktop/dev-mock/mod.ts`, `desktop/dev-seed.ts`, `workspace/agents/fake-source.ts`)
  - 내놓는 것:
    - `contexts/context-sidebar.tsx`: `ContextSidebar({ source, project, onOpenContext, onOpenSavedView })`. project sidebar의 Context 모양 본문(contexts 목록과 saved views). 이 task가 `workspace.tsx`에서 `ProjectSidebar`의 `contextPanel` slot에 끼운다.
    - `contexts/document-contexts.tsx`: 문서 정보 panel의 Contexts 탭 본문. 이름 유지(screens-project-editor의 문서 탭이 `host.contexts`로 가져다 쓴다)
    - `ContextsSource`: `list`·`get`·`overview`·`contract`·`bundles`·`rollback`·`savedViews` 읽기. `draft`·`operatorCounts`의 drafting 쪽은 지운다.

## 할 일

1. Contexts 탭(`contexts-tab*`). 카드는 이름, 목적, 개체 종류 수, 적용된 판과 검사 결과, 위반 수, [Open], [Archive]다. [New context]와 안내 글, 만드는 중 표시는 없다. 보관한 context는 접힌 "Archived" 묶음에 두고 보관은 사람이 이 화면에서 한다(보관한 context는 검색과 위반 목록에서 빠진다). 열 때 읽고 열려 있는 동안 다시 읽지 않는다. 근거: `U2.3#19`, `U1.3#13`, `U2.3#17`.
2. Context 탭 틀(`context-frame.tsx`, `context-tab-body.tsx`). 머리는 이름, Context 표시, 목적, 적용된 판 줄("Version N, tests passed", "applied 2 hours ago")과 판 목록이다. 판 목록은 판마다 시각과 바뀐 것 한 줄이고, 옛 판 줄의 [Restore]로 되돌린다(`rollback`). [Ask Context Engineer]와 [History] 단추, `onAsk`·`onHistory`·`stamp` prop은 없다. 하위 탭은 Overview · Search · Violations · Glossary · Contract(`shared.ts`의 `SUB_TABS`). 근거: `U1.3#11`, `U3.3#11`, `U2.3#17`.
3. 지운다: `context-drafting.tsx`, `context-drafting-model.ts`, `context-drafting.module.css`(만드는 중 화면), `context-watch.ts`(30초 polling과 `onDrafting`), `use-context-read.ts`의 `contextStamp`(`stamp`로 다시 읽기), `violation-toast.tsx`, `shortcut-rail.tsx`·`shortcut-rail.module.css`, `settle-tabs.ts`. `ContextsSource`의 `draft`, `DraftProgress`, `ContextDraft` 쓰는 곳을 걷는다. 근거: `U1.3#14`, `U1.3#15`, `U1.3#16`.
4. Overview와 Contract를 옮긴다. Overview는 개체 관계 그림과 구성 tree(harness context는 개체 둘이라 그림 없이 카드), Contract는 개체 종류 카드와 선언된 검색 목록. 탭 본문은 최대 폭을 둔 기둥을 가로 가운데에 놓고 배경이 같은 한 면으로 보인다. 근거: `U2.3#17`, `U6.1#1`의 기둥 규칙.
5. `ContextSidebar`를 만든다. contexts 목록(이름을 누르면 그 Context 탭)과 그 아래 saved views(이름을 누르면 결과를 연다. 선언된 검색 탭을 saved view로 여는 호출은 `host.contexts.openSearch`가 이미 한다). 근거: `U6.4#3`, `U3.3#10`.
6. context 목록의 공급원. 작업대가 `contextsSource.list`를 열 때 읽어 Contexts 탭, 팔레트, sidebar, 대화의 context 링크 이름이 같은 목록을 쓴다(store 층 없음. 목록은 window가 가진다). 이 task는 `list`를 부르는 쪽(`ContextsSource`)만 맞춘다. 근거: `U2.3#18`.
7. 문구를 wording key로 바꾼다(영역 `contexts`). 지운다: `contexts.button.frame-ask`, `frame-history`, `input-ask`, `tab-new-context`, `contexts.*drafting*`, `contexts.title.toast-violations`(toast key는 screens-data-toast가 `waiting.toast-violation`으로 옮겼다), 위반 목록의 `contexts.label.violations-on-it`는 views task가 지운다. 근거: `U1.3#18`. key는 `catalog/contexts.ts`에 더하고 지우고, `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 `catalog/contexts.placeholders.ts`를 갱신한다. 둘 이상의 단위가 쓰는 key는 `catalog/common.ts`(lead 소유)로 가야 하므로 보고에 적는다.
8. gallery. `contexts/contexts-list.tsx`가 renderer `ContextsTab`을 fake 통로로 그리게 다시 쓴다(`ContextsList`의 export 이름과 props 유지). `context-pages.tsx`의 위 페이지들이 옮긴 component로 그려지게 import를 고친다. `context-body.tsx`는 이 task가 고치지 않는다(views task가 `ContextBody`를 한꺼번에 갈아탄다).

- (lead가 더함, screens-project-window가 넘긴 것) `ContextsSlice.askContextEngineer`는 `askProjectManager`가 되었고 `ContextTabBody.onAsk`와 `ContextsTab.onNewContext`(둘 다 required)에 들어간다. prop을 바꾸면 `workspace/kinds/` 그 줄만 따라 고친다. 안 쓰게 된 것: `contexts/shortcut-rail.tsx`, `contexts/violation-toast.tsx`, `contexts/context-watch.ts`, `use-context-read.ts`의 `contextStamp`, `ContextTabBody`·`ContextFrame`의 `stamp`. 지운다. gallery `project-window.tsx`의 Context sidebar는 임시 `ContextRows`(+Saved views)다. `ContextSidebar`가 생기면 바꾼다. `settleContextTabs`는 복원 때 Context 탭 이름을 채우려고 한 번 불린다. contexts 쪽이 이름을 채우면 그 호출을 걷는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (화면과 읽기 통로)
- 남지 않음: `grep -rn "frame-ask\|frame-history\|useContextWatch\|contextStamp\|ContextDrafting\|shortcut-rail" packages/shell/renderer`가 0줄이다.
- (화면) `deno task wireframes`가 되고, gallery의 `new-contexts`, `new-contexts-archived`, `new-context-versions`, `new-context-restored`가 옮긴 component로 그려진다. `new-context-overview`와 `new-context-contract`는 `context-body.tsx`를 views task가 갈아탄 뒤 같은 component로 그려진다.

## 보고

- 바꾼 file
- 등록할 것: 영역 `contexts`의 지운 key와 새 key. `workspace.tsx`의 `contextPanel` 한 줄은 이 task가 고친다(screens-project-reactions가 같은 file의 다른 줄을 고치므로 겹치면 lead가 푼다).
- 안 쓰게 된 export: `ContextsSource.draft`·`operatorCounts`·`DraftProgress`, `shortcut-rail`의 `RailAction`(sidebar가 자기 것을 가진다)
- 정한 것: 판 목록의 되돌리기 확인(되돌릴 판의 "바뀐 것 한 줄"을 확인 modal 없이 줄 안에서 한 번 더 묻는지)
- 계약 바꾸기 요청(wave 3): context 판 목록 읽기에 시각과 바뀐 것 한 줄이 없으면 여기 적는다
