# editor-unified-find

markdown 편집기에서 보기 모드와 수정 모드의 구분(Edit/Read 단추, `Ctrl+E`)을 없애 늘 live preview 편집기로 열리게 하고, markdown·JSON·YAML·일반 text 등 모든 글 편집기에서 일관된 `Ctrl+F` / `Ctrl+Alt+F` 검색·바꾸기 줄(`FindBar`)이 동작하게 한다.

- 단위: editor (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/editor/file-frame.tsx`
  - `packages/shell/renderer/editor/find/find.ts`
  - `packages/shell/renderer/editor/find/find-bar.tsx`
  - `packages/shell/renderer/editor/find/find-bar.module.css`
  - `packages/shell/renderer/editor/find/use-editor-find.ts`
  - `packages/shell/renderer/editor/live-preview.ts`
  - `packages/shell/renderer/editor/markdown-editor.tsx`
  - `packages/shell/renderer/editor/markdown-pane.tsx`
  - `packages/shell/renderer/editor/markdown-pane.module.css`
  - `packages/shell/renderer/editor/reveal.ts`
  - `packages/shell/renderer/editor/text-file-view.tsx`
  - `packages/shell/renderer/editor/view-bar.tsx`
  - `packages/shell/renderer/editor/viewers/text-editor.tsx`
  - `packages/shell/renderer/editor/viewers/text-editor.module.css`
  - `packages/design/wording/catalog/common.ts`
  - `packages/design/wording/catalog/common.placeholders.ts`
  - `packages/design/wording/catalog/project.ts`
  - `packages/design/wording/catalog/project.placeholders.ts`
  - `tools/wireframes/mock/project-files/file-data.ts`
  - `tools/wireframes/pages/screens/documents.tsx`
  - `tools/wireframes/pages/screens/project-app.tsx`
  - `tools/wireframes/pages/screens/project-desk/frame.tsx`
  - `tools/wireframes/pages/screens/project-files/pages.tsx`
  - `tools/wireframes/pages/screens/project-workspace.tsx`
- 읽을 것:
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/shell/renderer`, `packages/design`
  - 본보기(화면): `tools/wireframes/pages/screens/documents.tsx`, `tools/wireframes/pages/screens/project-files/pages.tsx`
- 계약:
  - 쓰는 것: `packages/shell/renderer/editor/find/find-bar.tsx`의 `FindBar`, `packages/shell/renderer/editor/find/find.ts`의 `findMatches`, `nearestMatch`, `stepMatch`, `findLabel`, `replaceAll`
  - 내놓는 것: `MarkdownEditorHandle`과 `TextEditorHandle`의 `openFind(replace?: boolean): void`

## 할 일

1. **markdown 편집기의 보기/수정 모드 구분 제거**
   - `packages/shell/renderer/editor/markdown-pane.tsx`:
     - `editing: boolean` prop과 `<Markdown>` 분기를 지우고 늘 `<ReadingFrame width={width}>` 안에 `<MarkdownEditor>`를 그린다. `articleRef`도 더 이상 필요 없으면 정리하거나 `<div ref={articleRef} className={styles.article} data-document-body="">`에 둔다.
     - `windowLinkOpener()`가 돌려준 `onOpenLink`를 `<MarkdownEditor>`에 넘겨 `.cm-lp-link`(`[data-href]`)를 Mod+클릭(또는 클릭)했을 때 외부 링크가 열리게 한다.
   - `packages/shell/renderer/editor/markdown-pane.module.css`:
     - 읽기 전용 `<Markdown>`에서만 쓰던 `.article [data-hit]` 규칙을 지운다(CodeMirror의 `.cm-hit-line`이 대신한다).
   - `packages/shell/renderer/editor/reveal.ts`:
     - 읽기 전용 모드에서만 쓰던 `revealInReading` 파일 전체를 지운다.
   - `packages/shell/renderer/editor/view-bar.tsx`:
     - `editShortcut()`, `FileActionsProps`의 `editing`·`onEditing`, 그리고 `kind === "markdown"`일 때 그리던 `[data-edit-toggle]` 단추(`Tooltip` + `IconButton`)를 지운다.
   - `packages/shell/renderer/editor/file-frame.tsx`:
     - `FileFrameProps`와 `FileFrame`에서 `editing`·`onEditing`을 지운다.
   - `packages/shell/renderer/editor/text-file-view.tsx`:
     - `editing` 상태, `toggleEdit`, `key === "e"` 단축키 처리를 지운다.
     - `line`으로 이동하는 effect는 늘 `editorRef.current?.revealLine(line)`을 부른다.
     - `headingTops`와 `jump`는 늘 `editorRef.current?.lineTop(section.line)`과 `editorRef.current?.revealLine(target.line)`을 쓴다.
   - `packages/design/wording/catalog/common.ts`, `packages/design/wording/catalog/project.ts`:
     - 더 이상 쓰지 않는 `"document.button.read"`(`common.ts`)와 `"document.button.edit"`(`project.ts`)를 지우고 `npm run wording`으로 `.placeholders.ts`를 다시 생성한다.
   - `tools/wireframes/mock/project-files/file-data.ts`, `tools/wireframes/pages/screens/documents.tsx`, `project-app.tsx`, `project-desk/frame.tsx`, `project-files/pages.tsx`, `project-workspace.tsx`:
     - `FileInit.editing`과 `DocumentPane`의 `editing`·`onEditing` prop을 지우고 wireframe 화면 설명을 맞춘다.

2. **markdown·text 편집기 공통 `Ctrl+F` / `Ctrl+Alt+F` 검색·바꾸기 컴포넌트 (`use-editor-find.ts`, `text-editor.tsx`, `markdown-editor.tsx`)**
   - `packages/shell/renderer/editor/live-preview.ts`에 있던 `setFindMatches`와 `findField`를 `packages/shell/renderer/editor/find/use-editor-find.ts`(또는 `find.ts`)에서 공유하거나 export하여 `livePreview`와 `TextEditor`(`viewers/text-editor.tsx`)가 똑같이 `findField` extension을 장착하게 한다.
   - `packages/shell/renderer/editor/find/use-editor-find.ts`를 새로 만들어 `MarkdownEditor`와 `TextEditor`의 중복 없는 공통 찾기·바꾸기 hook(`useEditorFind(viewRef)`)을 둔다:
     - 상태: `find` (`{ open, replace }`), `query`, `caseSensitive`, `current`, `revision` (`onDocChanged()`로 증가).
     - 동작: `openFind(replace: boolean)`(선택된 한 줄 글이 있으면 `query`로 채움), `closeFind()`, `step(1 | -1)`, `replaceOne(replacement)`, `replaceEvery(replacement)`, `onKeyDown` (`Mod+F` → `openFind(false)`, `Mod+Alt+F` 또는 `Mod+H` → `openFind(true)`, `Escape` → 열린 찾기 닫기).
     - `setFindMatches`와 `EditorView.scrollIntoView(match.from, { y: "center" })`를 `viewRef.current`에 dispatch한다.
   - `MarkdownEditor`와 `TextEditor` 모두 `useEditorFind`와 `<FindBar>`를 써서 똑같은 찾기·바꾸기 줄을 편집기 위쪽에 그린다.
   - `MarkdownEditorHandle`과 `TextEditorHandle` 모두 `openFind(replace?: boolean): void`를 노출하고, `TextFileView`의 `onKeyDown`(`FileFrame`의 `onKeyDownCapture`)에서도 `Mod+F`와 `Mod+Alt+F`/`Mod+H`를 잡으면 `editorRef.current?.openFind(...)`를 불러 편집기 바깥(탭 틀·view bar 등)에 focus가 있을 때도 `Ctrl+F`가 동작하게 한다.
   - `packages/shell/renderer/editor/viewers/text-editor.module.css`와 `find-bar.module.css`:
     - `TextEditor`는 `.editor`를 `display: flex; flex-direction: column;`으로 두고 위쪽에 `<FindBar>`, 아래쪽에 CodeMirror host(`.host { flex: 1; min-width: var(--space-0); min-height: var(--space-0); overflow: hidden; }`)를 놓는다.
     - `text-editor.module.css`에 `.editor :global(.cm-lp-match)`와 `.editor :global(.cm-lp-match-current)` 스타일(`markdown-editor.module.css`와 동일)을 더하고, `TextEditor` 안의 `FindBar`에 좌우 여백(`padding: var(--space-0) var(--space-4) var(--space-0) var(--layout-pane-padding-wide)`)이 들어가 `ViewBar`·`MarkdownEditor`와 모양이 일관되게 맞춘다.

## 끝남

- `npm run wording` 및 `node tools/check-wording.ts`가 통과한다.
- `npm run check`가 통과한다.
- 위험 test: 없음 (화면·편집기 UI 통합)
- 남지 않음: `grep -rn "data-edit-toggle\|revealInReading\|document\.button\.read\|document\.button\.edit" packages tools`가 0줄이다.
- (화면) `npm run wireframes`가 통과한다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 (`common.ts`, `project.ts`와 `.placeholders.ts`는 이 task가 단독 소유)
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
