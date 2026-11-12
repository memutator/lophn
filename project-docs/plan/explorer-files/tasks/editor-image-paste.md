# editor-image-paste

md 문서에 붙여넣은 이미지를 그 file 옆에 png로 저장하고 커서에 상대 경로 링크를 넣는다. 문서 본문의 상대 경로 이미지를 그린다(지금은 https·data만 그린다).

- 단위: editor (wave 2)
- 선행: `files-transfer`
- 소유(이 task만 고친다):
  - `packages/shell/renderer/editor/markdown-editor.tsx`
  - `packages/shell/renderer/editor/markdown-pane.tsx`
  - `packages/shell/renderer/editor/live-preview.ts`
  - `packages/shell/renderer/editor/text-file-view.tsx`
  - `packages/shell/renderer/editor/use-file.ts`
  - `packages/shell/renderer/editor/source.ts`
  - `packages/shell/renderer/editor/image-paste.ts`(새 file)
  - `packages/shell/renderer/editor/markdown-editor.module.css`
- 읽을 것:
  - 앞 task 계약: `packages/shell/renderer/workspace/files/paste-names.ts`의 `freeName`, `WorkspaceSource.writeBytes`(files-transfer brief). 이 task는 `EditorSessions`(editor/sessions.ts)의 `files`(`EditorFiles`, editor/source.ts의 `Pick<FilesApi, ...>`)를 쓴다. 그쪽 `writeBytes({path, bytes})`를 쓴다. `EditorFiles`의 Pick 목록에 `writeBytes`를 더한다.
  - 지금 코드: `live-preview.ts`의 `ImageWidget`·`defaultResolveImage`, `markdown-editor.tsx`의 `EditorView.domEventHandlers`, `text-file-view.tsx`의 `MarkdownPane` 자리
  - 배경: `project-docs/architecture/agent-chat.md` 16번은 **대화의** image URL 규칙이다. 문서 본문은 사람이 쓴 파일이라 다르게 둔다(이 계획 README "정한 것").
- 계약:
  - `MarkdownEditor`의 props에 둘을 더한다(이 모양을 바꾸지 않는다):
    ```ts
    /** 붙여넣은 이미지를 파일 옆에 저장하고 문서에 넣을 링크(상대 경로)를 돌려준다. 없으면 붙여넣지 않는다. */
    onPasteImage?: (images: readonly File[]) => Promise<readonly string[]>;
    /** 문서 상대 경로를 이 창에서 그릴 수 있는 주소로 바꾼다. 없으면 상대 경로는 그리지 않는다. */
    resolveImage?: (src: string) => string | null;
    ```
  - `MarkdownPane`은 그 둘을 그대로 넘긴다.
- 할 일:
  1. `image-paste.ts`: 이미지 File → 저장할 이름(`freeName(originalName || "image.png", taken, "number")`)과 링크 글(`![](./<이름>)`)을 만드는 작은 helper. MIME→확장자(png·jpeg·gif·webp) 표를 여기 하나로 둔다.
  2. `text-file-view.tsx`: md 문서면 `onPasteImage`를 넘긴다. 문서 경로 `path`의 부모 폴더를 대상으로, 붙여넣은 이미지마다
     - 이름은 그 폴더의 지금 tree를 알 수 없으므로 **디스크 확인**으로 정한다: `sessions.files.read`/`writeBytes`의 응답으로만 판정하지 말고, `paste-names.ts`의 `freeName`에 넘길 `taken`을 모을 수 없으면 `writeBytes`가 `conflict`일 때 `image 2.png`, `image 3.png`으로 두 번까지 다시 시도한다(작게).
     - 성공하면 상대 링크 글을 돌려준다. 실패한 이미지가 있으면 `project-workspace.error.explorer-paste-failed` 문구를 편집기 아래 status로 보인다(지금 `tooLong`/`skipped` 문단과 같은 자리).
  3. `MarkdownPane`: 파일 경로를 알아야 상대 경로 이미지를 풀 수 있으므로 props에 `path`를 더한다(`text-file-view`가 넘긴다). `resolveImage`를 만든다:
     - `https:`·`data:image/`는 지금처럼 그대로.
     - `./x.png`·`x.png` 같은 상대 경로는 절대 경로로 풀어(`/`가 아니고 `file:`가 아니면 `dirname(path)/src`) 셸 파일 통로로 읽어 blob URL로 만든다. blob URL은 문서 하나에 캐시하고, 그 문서가 닫힐 때(component unmount) revoke한다. `..`로 연결 폴더 밖으로 가는 경로도 그린다(사람이 연 file이므로 지금 편집기와 같은 범위다).
     - `MarkdownEditor`는 `ImageWidget.eq`가 `src`를 비교하므로 blob URL이 매 render마다 새로 나오면 무한 다시 그리기가 된다. resolve한 url을 key로 캐시하고 **같은 src에는 같은 문자열**을 돌려준다.
  4. `markdown-editor.tsx`: `EditorView.domEventHandlers`에 `paste`를 더한다.
     - `event.clipboardData.files` 가운데 `image/*`만 고른다. 없으면 `false`를 돌려 브라우저 기본 붙여넣기(글)를 막지 않는다.
     - 있으면 `preventDefault`하고 `onPasteImage`를 부르고, 돌아온 링크 글들을 커서(`state.selection.main.head`)에 줄바꿈으로 이어 넣는다. 넣은 뒤 커서는 마지막 링크 뒤다.
     - `onPasteImage`가 없으면 지금처럼 기본 동작(아무것도 안 들어간다)이다.
  5. 주석: `live-preview.ts`의 `defaultResolveImage` 머리에 "상대 경로는 문서 tab이 연다" 한 줄을 더한다.
- 끝남:
  - `npm run check:full`이 통과한다.
  - 위험 test: `image-paste.ts`의 이름·MIME 표가 `image/png`·`image/jpeg`·알 수 없는 형식을 견딘다(file 하나).
  - `npm run wireframes`가 되고 gallery의 문서 page(MarkdownEditing)가 그대로 그려진다.
- 보고:
  - 바꾼 file
  - 통과한 check
  - 등록할 것
  - 안 쓰게 된 export
  - 정한 것: 이름이 겹칠 때의 재시도 횟수, blob 캐시의 수명
  - 넘길 줄
  - 계약 바꾸기 요청
  - **무겁게 짠 것**: 없으면 "없음"
  - **알려진 미완 동작**: 없으면 "없음"
