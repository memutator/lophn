# af-artifact-ipc

artifact view의 shell IPC 계약(channel, 값 모양, preload API)을 고정하고, annotate mode의 main 쪽을 "앱 view"에서 "target이 앱 또는 artifact인 view"로 넓힌다. artifact view 자체(registry, WebContentsView)는 wave 2 `af-artifact-view`가 만든다. 계약 task라 모양을 아래에 못박는다.

- 단위: artifact-view (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/ipc/artifact.ts`
  - `packages/shell/ipc/annotation.ts`
  - `packages/shell/preload/artifact-api.ts`
  - `packages/shell/preload/artifact.ts`
  - `packages/shell/preload/shell.ts`
  - `packages/shell/main/build.ts`
  - `packages/shell/main/app-frame/annotate.ts`
  - `packages/shell/main/app-frame/annotate_test.ts`
  - `packages/shell/main/app-frame/registry.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/annotation.md`("지키는 것": 신원은 shell main이 sender view로 정한다, 보내기 흐름), `project-docs/architecture/browser-tab.md`(IPC 꼴: `packages/shell/ipc/browser.ts`, `preload/browser-api.ts`)
  - 제품 결정: `project-docs/products/roadmap/artifact.md`의 "2. artifact 탭"의 "preload"와 "4. artifact annotation"
  - 본보기: `packages/shell/ipc/browser.ts`(channel 상수 + zod + `BrowserReply` + `LophnBrowserApi`), `packages/shell/preload/browser-api.ts`, `preload/annotate-api.ts`, `preload/app.ts`(annotate layer 설치: `installAnnotate`), `preload/shell.ts:129`(`lophnBrowser` 노출), `main/build.ts:47`(preload entry 목록), `main/app-frame/annotate.ts:262`(core 호출), `main/app-frame/registry.ts:472`(`annotateView`, `senderAnnotateView`)
  - 짝: 같은 wave의 `af-annotation-target`이 core `annotations.send`의 입력을 `target` 모양으로 바꾼다. 둘은 같이 합쳐야 앱 annotation이 계속 간다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`
- 계약(내놓는 것. wave 2 task가 모두 기댄다)
  - `packages/shell/ipc/artifact.ts`(main tsc가 protocol을 보지 않으므로 slug·ID 규칙은 `ipc/app-frame.ts`처럼 사본이다)
    - channel: `ARTIFACT_OPEN_CHANNEL = "shell:artifact-open"`, `ARTIFACT_RELOAD_CHANNEL = "shell:artifact-reload"`, `ARTIFACT_LIST_CHANNEL = "shell:artifact-list"`, `ARTIFACT_STATE_CHANNEL = "shell:artifact-state"`(main → renderer push), `ARTIFACT_EVENT_CHANNEL = "shell:artifact-event"`(push). view의 bounds·숨기기·폐기는 새 channel 없이 `ipc/app-frame.ts`의 `VIEW_BOUNDS_CHANNEL`·`VIEWS_HIDDEN_CHANNEL`·`VIEW_CLOSE_CHANNEL`을 그대로 쓴다(`frame-router.ts`가 view_session으로 가른다).
    - `artifactSourceSchema`는 둘 중 하나다. artifact는 `{ kind: "artifact"; project: prj_ID; name: slug }`(slug는 최대 63자의 소문자·숫자·하이픈), 사람의 file은 `{ kind: "file"; project: prj_ID; path: 절대 path 문자열(최대 4096자) }`.
    - `artifactOpenSchema = { source }`, `artifactReloadSchema = { view_session }`, `artifactListSchema = { project }`
    - `artifactViewStateSchema`: `{ view_session; source; file; title; loading; health }`. `source`는 위 값 그대로, `file`은 입구 file의 절대 path(Edit source가 연다), `title`은 page의 title이고 load 전은 빈 글, `health`는 "ok" | "unresponsive" | "crashed".
    - `artifactEventSchema`: `{ kind: "open-link"; view_session; url: string }` — 사용자 입력 직후 page에서 누른 http/https link. renderer가 browser 탭으로 연다.
    - `artifactListItemSchema = { name; title; description; modified }`, 목록 답은 `{ artifacts: ArtifactListItem[] }`
    - `ArtifactReply<T>`(`BrowserReply`와 같은 꼴, code는 `invalid_input` | `forbidden` | `not_found` | `unavailable`)
    - `interface LophnArtifactApi { open(input): Promise<ArtifactViewState>; reload(input): Promise<null>; list(input): Promise<{ artifacts: ArtifactListItem[] }>; subscribeState(listener): () => void; subscribeEvent(listener): () => void }` — `open`의 `not_found`는 폴더나 입구 file이 없다는 뜻이고 renderer는 placeholder를 그린다. 봉한 session을 못 세웠으면 `unavailable`.
  - `packages/shell/ipc/annotation.ts`: `AnnotateViewPort`의 `app`·`release`·`screen`을 `target: AnnotateTarget`으로 바꾼다.
    - `AnnotateTarget = { kind: "app"; app: string; release: string | null; screen: string } | { kind: "artifact"; project: string; name: string | null }` (`name` null은 사람의 폴더에 있는 `.html`이다)
    - 나머지 필드(`view_session`, `pageUrl`, `current`, `send`, `capture`)는 그대로다.
  - core에 보내는 `annotations.send` 입력(짝 task가 protocol에 정의한다): `{ target, session, annotations }`. 앱이면 `target = { kind: "app", app }`이고 annotation마다 `release`·`view.screen`이 있다. artifact면 `target = { kind: "artifact", project, name }`이고 annotation마다 `release: null`, `view: { screen: null, path: picked.path }`다.

## 할 일

1. `ipc/artifact.ts`를 위 모양대로 쓴다. 계약 task라 이 file이 wave 2의 기준이다.
2. `preload/artifact-api.ts`: `createArtifactApi(transport)` — `preload/annotate-api.ts`의 `call`(거절은 code만 싣는다)과 `subscribeState`(schema로 거른 push) 꼴. `preload/shell.ts`에 `contextBridge.exposeInMainWorld("lophnArtifact", createArtifactApi(ipcRenderer))`를 더한다(`lophnBrowser`와 같은 자리, desktop 창 preload).
3. `preload/artifact.ts`: artifact page의 preload. **annotate layer만** 싣는다(`preload/app.ts`의 `installAnnotate` 부분만 옮긴다. `lophnApp` bridge도 오류 보고도 없다). `main/build.ts`의 `entries`에 `{ in: join(shell, "preload/artifact.ts"), out: "preload-artifact" }`를 더한다.
4. `main/app-frame/annotate.ts`를 target 종류에 열어 둔다.
   - `ViewState`·`guard`·`pageView`는 port를 쓰는 그대로. `mode`·`remove`·`items`·`exit`·`captureReady`는 target과 상관없다.
   - `send`: `item.release === null`을 막는 검사(237줄 근처)는 `target.kind === "app"`일 때만 한다. `releases` 맵과 `items`의 `release`는 artifact에서 늘 null이다. core 호출 본문은 target별로 만든다(위 계약). `labelOf`는 그대로.
   - `lost`가 돌려주는 code 목록은 그대로.
5. `main/app-frame/registry.ts`의 `annotateView`·`senderAnnotateView`가 새 `AnnotateViewPort`(`target: { kind: "app", … }`)를 낸다. `annotate_test.ts`를 새 모양에 맞춘다(옛 모양을 살리지 않는다).
6. `tests/e2e/annotation_test.ts`는 호출부(`app:`)가 옛 모양이다. 이 계획은 e2e를 고치지 않는다(plan README). 건드리지 말고 보고의 "알려진 미완 동작"에 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 기존 `annotate_test.ts`가 새 모양에서 통과한다(앱 target의 release 없음 거절이 남아 있고, 신원은 sender view로 정해진다). 새 test는 두지 않는다.
- 남지 않음: `grep -rn "port\.app\b\|port\.screen\b\|port\.release\b" packages/shell`이 0줄이다(`port.target`으로 옮김).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: `AnnotateViewPort`의 옛 필드
- 정한 것: `view.screen`이 artifact에서 null인 것, `ArtifactViewState.file`
- 넘길 줄: `main/app-frame/annotate.ts`와 `registry.ts`는 다른 계획(domain-tools, domain-place)도 건드린다
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: `tests/e2e/annotation_test.ts` 호출부가 옛 모양이다(이 계획은 e2e를 안 건드린다)
