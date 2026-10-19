# af-artifact-tab

탭 kind `artifact`를 만든다: layout 저장·복원, 탭 본문(toolbar + native view 자리 + 폴더가 없을 때 placeholder), [Edit source], annotate mode(모은 목록 panel, 보내기, 받은 session 열기), http/https link를 browser 탭으로 열기, 사람의 폴더에 있는 아무 `.html`을 같은 탭으로 열기. wave 1의 wireframe(Experiments)을 renderer로 옮긴다(다시 그리지 않는다).

- 단위: artifact-screen (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/artifact/`
  - `packages/shell/renderer/workspace/kinds/artifact.tsx`
  - `packages/shell/renderer/workspace/kinds/registry.ts`
  - `packages/shell/renderer/workspace/kinds/document-editor.tsx`
  - `packages/shell/renderer/workspace/kinds/host.ts`
  - `packages/shell/renderer/workspace/use-tab-host-slices.ts`
  - `packages/shell/renderer/workspace/sidebar/panel-sessions.ts`
  - `packages/shell/renderer/editor/model.ts`
  - `packages/shell/renderer/icons/artifact.ts`
  - `packages/shell/renderer/icons/mod.ts`
  - `packages/shell/renderer/desktop/entry.tsx`
  - `packages/shell/renderer/app-frame/annotate/annotation-panel.tsx`
  - `packages/shell/main/workspace/kinds/artifact.ts`
  - `packages/shell/main/workspace/kinds/registry.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/workspace-layout.md`(탭 kind registry, native view 세 층, ViewKeeps, Detach/Dock), `project-docs/architecture/browser-tab.md`(탭 본문과 native view), `project-docs/architecture/annotation.md`
  - 제품 결정: `project-docs/products/roadmap/artifact.md`의 "2. artifact 탭", "4. artifact annotation"(받는 쪽 결정은 core가 한다. 탭은 `session`에 열려 있는 PM session을 후보로 줄 뿐이다), `project-docs/products/roadmap/domain.md`의 "view와 artifact"
  - 본보기(화면): wave 1이 낸 `tools/wireframes/drafts/artifact/`(옮길 코드), 구조는 `packages/shell/renderer/workspace/kinds/browser.tsx`(renderer kind 선언: `fromStored`/`toStored`/`keep`/`transfer`), `renderer/browser/browser-tab.tsx`(toolbar + native view 자리 + `keeps`), `renderer/app-frame/embedded-view.tsx:79`(`useViewBounds`)·`app-frame/view-keeps.ts`(`ViewKeeps`), `renderer/app-frame/app-space.tsx:385`(annotate 켜기·보내기·toast), `renderer/app-frame/annotate/use-annotate.ts`(`useAnnotate`), `renderer/browser/browser-api.tsx`(context 꼴), `main/workspace/kinds/browser.ts`(main kind 선언), `workspace/sidebar/panel-sessions.ts:23`(`openedProjectManagerSession`)·`:35`(`agentRow`)
  - 계약: `packages/shell/ipc/artifact.ts`(`LophnArtifactApi`, `ArtifactViewState`, `ArtifactEvent`), `ipc/annotation.ts`, `ipc/app-frame.ts`(`LophnShellViewsApi.closeView/setViewBounds`)
  - 문구: wave 1이 만든 `packages/design/wording/catalog/artifact.ts`의 key를 쓴다. 모자라는 key는 같은 file에 더한다(허용된 예외. `deno task wording`을 돌린다).
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`
- 계약:
  - 쓰는 것: 위 계약 file들. `window.lophnArtifact`(= `LophnArtifactApi`), 앱 view 통로 `useAppViews()`의 `views`, `ProjectSidebar`·`useSessions` 쪽의 session 정보
  - 내놓는 것(같은 wave의 `af-artifact-sidebar`·`af-artifact-links`가 import한다. 이 둘은 이 task 뒤에 돈다)
    - `renderer/artifact/artifact-api.tsx`: `ArtifactApiProvider`, `useArtifactApi(): LophnArtifactApi | null`, `AnnotateApiProvider`, `useAnnotateApi()`
    - `renderer/artifact/use-artifact-list.ts`: `useArtifactList(project: string): { items: readonly ArtifactListItem[]; reload(): void }`
    - `renderer/workspace/kinds/artifact.tsx`: `openArtifact(host: TabHost, project: string, name: string): void`, `openArtifactFile(host: TabHost, path: string): void`
    - `renderer/artifact/testdata/fake-artifact-api.ts`: `fakeArtifactApi(...)`(gallery와 test용 가짜 `LophnArtifactApi`)
    - `TabHost.agentView.openSession(session: string): void`(host.ts의 `AgentViewSlice`에 더한다. 그 session의 agent 탭을 연다)

## 할 일

1. 탭 kind 선언
   - main `kinds/artifact.ts`: layout은 `strictObject({ kind: "artifact", key, project: prj_ID, name: slug.optional(), path: 문자열(최대 4096).optional() })`이고 `name`과 `path` 중 정확히 하나가 있어야 한다. 로드맵의 `{key, project, name}`에 사람의 `.html`을 위한 `path`를 더한 모양이다. `restore`는 `{ kind: "tab", tab }`(폴더가 없는 것은 탭 안 placeholder가 보인다). `registry.ts`에 한 줄.
   - renderer `kinds/artifact.tsx`: `fromStored`/`toStored`. 탭 key는 `artifact:<project>:<name>` 또는 `artifact-file:<path>`. 탭 이름은 page title, 없으면 name 또는 file 이름. `keep`이 본문을 그린다(다른 탭으로 가도 view를 남기고 숨기는 것은 BrowserTab과 같은 꼴). `transfer`는 옮길 상태가 없는 kind(`{ value: null, views: [] }`)로 둔다: 다른 창으로 옮기면 받는 창이 다시 연다(보통 browser 탭과 같다). `registry.ts`에 한 줄.
   - `icons/artifact.ts` + `icons/mod.ts`에 종류 아이콘(`artifactIcons`).
2. 탭 본문 `renderer/artifact/artifact-tab.tsx` (+ module.css)
   - 열기: `useArtifactApi()`의 `open({ source })`. `not_found`면 placeholder와 [Retry]만 그린다(wireframe `artifact-missing`). 같은 탭이 다시 mount되면 `keeps`(`ViewKeeps`, signature = source를 이은 글)에서 view를 이어 쓴다. view를 닫는 일은 보관소 주인(Workspace)이다.
   - view 자리 하나(`useViewBounds`)와 toolbar. 안 보이면 `shown=false`로 숨긴다. state push(title, health)를 받아 `host.patchTab`으로 탭 이름을 바꾼다(`later: true`). health가 "crashed"면 오류 안내와 [Retry].
   - `ArtifactEvent`의 `open-link`는 `openBrowserTab(host, url)`(`kinds/browser.tsx`)로 연다(이 탭 바로 뒤, `after: tab.key`).
   - [Edit source]: `ArtifactViewState.file`을 text 편집기로 연다(`openFile(host, file, { source: true })`).
3. annotate (탭 안)
   - `useAnnotate(useAnnotateApi(), viewSession)`와 `AnnotationPanel`을 쓴다. toolbar에 [Annotate] 토글, 켜져 있을 때 안내 toast(`app-space`의 `useViewToast` 꼴, 글은 `artifact.*` key).
   - 보내기: `annotating.send(openedProjectManagerSession(sessions, project))` — pane에 열린 그 project의 PM session이 있으면 그 id, 없으면 null. 받는 쪽은 core가 정한다(마지막으로 그 폴더에 쓴 session, 없으면 PM). 성공하면 답의 `session`을 `host.agentView.openSession(session)`으로 연다(agent pane에 그 session).
   - `AnnotationPanel`은 안내 글이 "App Engineer"를 말하므로 글 칸을 prop으로 받게 고친다(기본은 지금 글이라 앱 쪽은 그대로).
4. 사람의 `.html`
   - `editor/model.ts`: `FileKind`에 `"html"`(`/\.html?$/i`)을 더한다. `document-view.tsx`는 `image`·`pdf` 밖을 text 편집기로 보내므로 고칠 것이 없다.
   - `kinds/document-editor.tsx`의 `openFile`: `fileKindOf(path) === "html"`이고 `options.source !== true`이면 `openArtifactFile(host, path)`로 간다. 옵션 `source`를 더한다. 사이드바·팔레트·검색·대화의 링크가 모두 `openFile`을 부르므로 한 곳만 고치면 된다.
5. 통로 연결
   - `renderer/desktop/entry.tsx`: `bridges.lophnArtifact`를 `ArtifactApiProvider`로, 이미 있는 `annotate` 값을 `AnnotateApiProvider`로 감싼다(`BrowserApiProvider` 옆).
   - `host.ts`·`use-tab-host-slices.ts`: `AgentViewSlice.openSession(session)`. `useSessions()`의 entry에서 그 session의 agent 줄을 찾아(`panel-sessions.ts`의 `agentRow`를 export해 쓴다) `openAgent(host, { agent: row.assignment, name: row.name, session })`.
6. `renderer/artifact/testdata/fake-artifact-api.ts`: 열기 결과, state·event push, 목록을 정하는 가짜. gallery(wave 3)가 쓴다.

## 끝남

- `deno task check`가 통과한다.
- `deno task wireframes`가 되고(renderer를 import하는 gallery의 type check), `deno run -A packages/shell/renderer/build.ts`로 bundle이 선다.
- 위험 test: 없음(화면). `openFile`의 html 분기는 한 줄 규칙이라 test하지 않는다.
- 남지 않음: `grep -rn "artifact" packages/shell/renderer/workspace/kinds/registry.ts packages/shell/main/workspace/kinds/registry.ts`가 각 한 줄이다. 문구가 코드에 직접 박힌 곳이 없다(`deno run --allow-read tools/check-wording.ts`).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(wording 영역은 wave 1이 등록했다)
- 안 쓰게 된 export: 없음
- 정한 것: layout에 `path`를 더한 것(`name`과 둘 중 하나), `keep`·`transfer` 선택, annotate 보내기의 후보 session
- 넘길 줄: `kinds/registry.ts`·`kinds/host.ts`·`editor/model.ts`·`use-tab-host-slices.ts`는 domain-kinds, domain-place도 건드린다
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 실제 Electron에서의 동작은 lead가 `deno task dev`로 본다. dev:mock(`desktop/dev-mock`)에는 artifact를 연결하지 않았다.
