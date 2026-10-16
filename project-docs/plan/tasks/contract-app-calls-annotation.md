# contract-app-calls-annotation

앱 화면 annotation(S9)의 계약을 고정한다: annotation 값과 묶음, 보내기·읽기 route, 고르기와 capture를 나르는 IPC, core module이 기대는 port. 구현은 넣지 않는다.

- 단위: contract-app-calls (wave 2)
- 선행: 없음. 단 lead가 task를 띄우기 전에 `packages/protocol/base/ids.ts`의 `ID_PREFIXES`에 `ann: "Annotation"`, `anb: "AnnotationBatch"` 두 줄을 더해 둔다.
- 소유(이 task만 고친다):
  - `packages/protocol/apps/annotation.ts` (새 file)
  - `packages/shell/ipc/annotation.ts` (새 file)
  - `packages/core/apps/annotations/ports.ts` (새 file. 이 폴더의 나머지는 wave 3의 annotation-core 소유다)
- 읽을 것:
  - spec: S9 4~10장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/annotation.md`
  - spec: S4 6장 입력 표(`lophn-annotation` tag) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - inventory: `I3.12#3`(`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`. assignment.md에서는 ui-chrome 몫이지만 위치가 `protocol/apps`라 이 task가 받는다. 보고에 적혀 있다). 문맥으로 `I3.9#1`, `I3.9#2`, `I3.3#17`, `I3.6#21`
  - 결정: `/home/pyosechang/projects/lophn/project-docs/plan/README.md` 3장 #112(source 위치는 release의 source map으로 푼다)
  - 지금 코드: 본보기 `packages/protocol/coding-agent/ticket-claims.ts`의 `ticketUploadSummary`(upload route + 준비 blob 참조), `packages/protocol/storage/blob.ts`의 `preparedBlobSchema`·`defineBlobPurpose`, `packages/shell/ipc/app-frame.ts`(IPC 사본의 쓰는 법)
- 계약:
  - 쓰는 것: `protocol/storage/blob.ts`의 `preparedBlobSchema`, `protocol/projects/values.ts`의 `appIdSchema`, `protocol/base/actor.ts`의 `actorSchema`. 입력 tag `lophn-annotation`의 상수는 contract-agent-tools(S4 6장)가 `protocol/lophn-agent`에 둔다. 이 task는 그 이름을 import하지 않는다. wave 3의 annotation-core가 쓴다.
  - 내놓는 것: 아래 이름과 칸. annotation-core·annotation-shell·annotation-page·screens-app-space(annotate mode 화면)·coding-agent(ticket 근거)가 기댄다. `annotationIdSchema`는 contract-coding이 ticket 근거 ref(`{kind: "annotation", id}`)에서 import한다.

## 할 일

1. `packages/protocol/apps/annotation.ts` — 값 (S9 5장, `I3.12#3`)
   - 상수: `ANNOTATION_BATCH_MAX = 20`, `ANNOTATION_NOTE_MAX_CHARS = 2000`, `ANNOTATION_SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024`. S9 6장이 "정해진 크기로 줄인다(수치는 refactor session)"라 한 수치이고 이 task가 정한다. 보고의 "정한 것"에 적는다.
   - `annotationIdSchema = idSchema("ann")`, `annotationBatchIdSchema = idSchema("anb")`
   - `annotationKindSchema = z.enum(["element","region"])`
   - `annotationRectSchema` (strict) = `{x_ratio: 0..1, width_ratio: 0..1, y_px: number, height_px: number, scroll_x: number, scroll_y: number}` (viewport 비율의 x와 너비, px의 y와 높이, scroll 값. S9 4장 6)
   - `annotationElementSchema` (strict) = `{role: string | null, name: string | null, text: string | null}` 각각 200자 이하(역할, 접근 이름, 보이는 글)
   - `annotationSourceSchema` = `{file: string, line: number}`
   - `annotationBundlePositionSchema` = `{file: string, line: number, column: number}` (페이지가 요소에서 얻은 bundle 위치. core가 source map으로 `source`로 푼다. 결정 #112)
   - `annotationViewSchema` = `{screen: screenKeySchema, path: string}` (앱 화면 위치. `screenKeySchema`는 `protocol/apps/channel-values.ts`)
   - `annotationScreenshotBlobSchema` = `preparedBlobSchema`에 `purpose === "annotation_screenshot"`을 건 것(`ticketSummaryBlobSchema` 모양)
   - 보내는 쪽 입력 `annotationInputSchema` (strict) = `{n: int ≥ 1, kind, note: string(≤ max, 빈 문자열 허용), screenshot: annotationScreenshotBlobSchema | null, component: string | null, bundle_position: annotationBundlePositionSchema | null, element, rect, view, release: releaseIdSchema}`
   - 저장 값 `annotationSchema` = `{id, batch, app, n, kind, note, screenshot: {hash, size_bytes} | null, component | null, source: annotationSourceSchema | null, element, rect, view, release}`
   - 묶음 `annotationBatchSchema` = `{id, app, sent_at, sent_by: actorSchema, annotations: annotationIdSchema[]}`
   - 읽는 쪽 값 `annotationReadSchema` = `annotationSchema` + `screenshot_path: string | null` (coding agent가 CLI로 읽는 screenshot 파일 경로. blob store의 object 파일 경로. S9 9장)
2. 같은 file — route (S9 7·9장)
   - `annotationUploadScreenshot` = `defineUpload({resource: "annotations", method: "upload_screenshot", name: "annotation.upload_screenshot", input: {blob_hash: sha256, bytes: 1..ANNOTATION_SCREENSHOT_MAX_BYTES}, output: annotationScreenshotBlobSchema, actors: ["user"], errors: ["invalid_input","unauthorized","forbidden","unavailable"], max_bytes: ANNOTATION_SCREENSHOT_MAX_BYTES})`
   - `annotationSend` = `defineMemory({resource: "annotations", method: "send", name: "annotation.send", actors: ["user"], errors: ["invalid_input","not_found","conflict","unavailable"]})`. ledger command가 아니라 memory route인 이유: source map 읽기와 Router 전달 같은 비동기 단계가 있어 짧은 transaction 하나로 끝나지 않는다. 저장은 core 안에서 annotation module이 한다.
     - 입력 strict `{app, session: idSchema("ses") | null, annotations: annotationInputSchema[] (1..20)}`. `session`은 앱 공간의 agent pane에 열려 있는 그 앱 App Engineer의 session이다(shell이 고른다. S9 7장 2). null이면 core가 새 session을 연다. refine: `n`이 1부터 빠짐없이 이어진다.
     - 출력 `{batch: annotationBatchIdSchema, annotations: annotationIdSchema[], session: idSchema("ses"), message: idSchema("msg")}`
     - `conflict`는 보관한 앱이라 새 입력을 받지 않는 경우다(S9 10장). 보내기는 사람의 동작이라 Gate를 거치지 않는다.
   - `annotationsGet` = `defineRead({resource: "annotations", method: "get", name: "annotations.get", actors: ["user","coding_agent","agent"]})`
     - 입력 strict. `{annotation: annotationIdSchema}` 또는 `{batch: annotationBatchIdSchema}` 중 하나만.
     - 출력 `withReadCommon({batch: annotationBatchSchema | null, annotations: annotationReadSchema[]})`
   - blob 선언 이름: purpose `annotation_screenshot`의 상수 `ANNOTATION_SCREENSHOT_PURPOSE`를 내보낸다(annotation-core가 `defineBlobPurpose`에 쓴다).
3. `packages/shell/ipc/annotation.ts` — IPC (S9 4·6장). 이 file은 main·preload·renderer가 같이 import한다. zod만 쓴다.
   - renderer ↔ main
     - 채널: `ANNOTATE_MODE_CHANNEL = "shell:annotate-mode"` 입력 `{view_session, on}`; `ANNOTATE_REMOVE_CHANNEL = "shell:annotate-remove"` 입력 `{view_session, n: int | "all"}`; `ANNOTATE_SEND_CHANNEL = "shell:annotate-send"` 입력 `{view_session, session: idSchema("ses") | null}`; push `ANNOTATE_STATE_CHANNEL = "shell:annotate-state"`.
     - `annotateStateSchema` = `{view_session, on: boolean, phase: "idle" | "sending", items: [{n, kind, note, label}]}` (`label`은 component 이름, 없으면 role과 접근 이름. 모은 목록 panel이 그린다)
     - `annotateSendResultSchema` = `{sent: int, session: idSchema("ses")}` ("N annotations sent" toast의 재료)
     - `AnnotateReply<T>` = `{ok: true, value} | {ok: false, error: {code: "invalid_input" | "forbidden" | "conflict" | "unavailable", message}}` (`ipc/app-frame.ts`의 `ViewReply`와 같은 모양)
     - `LophnShellAnnotateApi` = `{setMode(input): Promise<AnnotateState>, remove(input): Promise<AnnotateState>, send(input): Promise<AnnotateSendResult>, subscribeState(listener): () => void}`. 실패는 code를 message로 싣은 Error로 거절한다(`LophnShellViewsApi`와 같다).
   - main 안의 view port: `AnnotateViewPort` = `{view_session: string; app: string; release: string | null; screen: string; pageUrl(): string | null; current(): boolean; send(channel: string, payload: unknown): void; capture(): Promise<Uint8Array>}` (`capture`는 앱 view의 PNG byte, `send`는 그 view의 페이지로 보내는 `webContents.send`). type만 둔다. 구현은 wave 3의 app-calls-shell이 registry에 `annotateView(view_session)`과 `senderAnnotateView(contentsId)`로 내놓는다.
   - 앱 view의 preload ↔ main (안쪽 통로. 신원은 sender view가 정하고 페이지 주장은 쓰지 않는다)
     - main → page: `ANNOTATE_PAGE_SET_MODE = "annotate:set-mode"` `{on}`, `ANNOTATE_PAGE_REMOVE = "annotate:remove"` `{n | "all"}`, `ANNOTATE_PAGE_PREPARE_CAPTURE = "annotate:prepare-capture"` `{n}`(그 annotation의 윤곽과 번호 표지를 그린다), `ANNOTATE_PAGE_CLEAR_CAPTURE = "annotate:clear-capture"`.
     - page → main: `ANNOTATE_PAGE_ITEMS = "annotate:items"` `{items: pickedItem[]}`(목록이 바뀔 때마다 전체를 보낸다), `ANNOTATE_PAGE_EXIT = "annotate:exit"`(Esc), `ANNOTATE_PAGE_CAPTURE_READY = "annotate:capture-ready"` `{n, crop: {x, y, width, height}}`(표지를 그린 뒤 자를 범위. 고른 사각형과 표지를 합친 것에 둘레 여백. viewport CSS px)
     - `pickedItemSchema` (strict) = `{n, kind, note, component: string | null, bundle_position: annotationBundlePositionSchema | null, element, rect, path: string(≤ 512)}`. 값 type은 `protocol/apps/annotation.ts`와 같은 모양을 이 file에 사본으로 둔다(main tsc가 protocol을 보지 않는다. `ipc/app-frame.ts`와 같은 이유).
4. `packages/core/apps/annotations/ports.ts` — type만 (core가 기대는 바깥)
   - `AnnotationDelivery.deliver(input: {app, session: SessionId | null, text: string, images: readonly {hash, size_bytes, media_type: "image/png"}[], annotations: readonly AnnotationId[]}): Promise<Result<{session: SessionId, message: MessageId}>>` — 그 앱의 App Engineer에게 사람 메시지 하나로 넣는다. `session`이 있으면 그 session(그 앱의 App Engineer의 열린 session이어야 한다), null이면 새 session을 연다(S9 7장 2, 13장 1). 보관한 앱이면 `conflict`. 구현은 Router가 한다(lead 조립).
   - `ReleaseSourceMaps.sourceMap(app, release, bundleFile): Promise<Result<string | null>>` — release의 UI bundle 파일에 맞는 source map 본문. 없으면 null. 구현은 release 쪽 bundle 읽기(lead 조립).
   - `AnnotationLookup.byIds(ids): Result<readonly AnnotationRead[]>` — ticket 근거를 읽는 쪽(coding-agent의 `core/apps/tickets`)이 core 안에서 부른다. annotation-core가 구현한다.
   - id·`Result` type은 `base/mod.ts`와 위 protocol file에서 import한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. schema와 type만 둔다.
- 남지 않음: 해당 없음(새 file만).

## 보고

- 바꾼 file
- 등록할 것: `ID_PREFIXES`의 `ann`·`anb`(lead가 먼저), `protocol/apps/mod.ts`에 `export * from "./annotation.ts"`(lead), `annotationUploadScreenshot`·`annotationSend`·`annotationsGet`을 `protocol/apps/registry.ts`의 `ROUTES`에(lead. 이 task 소유가 아니다)
- 안 쓰게 된 export: 없음
- 정한 것: 수치 세 개(묶음 20개, 메모 2000자, screenshot 2 MiB), screenshot을 upload route + 준비 blob으로 올리고 `annotation.send`가 참조만 싣게 한 것(요청 본문에 큰 byte를 싣지 않으려고), `annotation.send`를 memory route로 하고 받는 session을 shell이 입력으로 주게 한 것(`session`, null이면 새 session), `bundle_position`을 보내는 쪽 입력으로 두고 `source`는 core가 푸는 값으로 둔 것, `screenshot_path`를 읽는 쪽 값에 둔 것
- 계약 바꾸기 요청: `lophn-annotation` tag 상수 이름이 contract-agent-tools와 어긋나면 적는다
