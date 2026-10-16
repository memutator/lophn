# annotation-shell

shell main 쪽 annotate mode를 짓는다: view마다 annotate 상태(켬·끔, 고른 목록)를 쥐고, 앱 view의 페이지와 IPC로 주고받고, 보내기를 누르면 annotation마다 앱 view를 capture해 고른 곳을 자르고 줄여 core에 올린 뒤 묶음으로 보낸다. 위쪽 바 Annotate 단추와 목록 panel은 screens-app-space가 이 task의 renderer API로 그린다.

- 단위: annotation (wave 3)
- 선행: 없음 (`registry.annotateView`는 app-calls-shell이 내놓지만, 이 task는 `AnnotateViewPort` 인터페이스에 대고 짓고 가짜 port로 확인한다)
- 소유(이 task만 고친다):
  - `packages/shell/main/app-frame/annotate.ts` (새 file)
  - `packages/shell/main/app-frame/capture.ts` (새 file)
  - `packages/shell/preload/annotate-api.ts` (새 file. renderer에 열리는 `LophnShellAnnotateApi` 구현)
  - `packages/shell/main/desktop/wiring/annotate.ts` (새 file. `shell-wiring.md`의 `register(ctx): Registered` 꼴)
- 읽을 것:
  - spec: S9 4·6·7·10장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/annotation.md`
  - inventory: 이 단위는 assignment.md에 줄이 없다. 이 task가 받는 줄은 `I3.9#1`(assignment.md에서는 screens-app-space 몫), `I3.9#2`(screens-workspace 몫. 보내기의 main 쪽). 보고에 적혀 있다. (`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`) 문맥으로 `U3.4#1`(`/home/pyosechang/projects/lophn/project-docs/tmp/ui-inventory.md`. 화면은 screens-app-space)
  - 지금 코드: `packages/shell/main/app-frame/feedback.ts`(capture를 쓰는 본보기), `registry.ts`의 `feedbackView`, `view-ipc.ts`(IPC 등록 모양), `packages/shell/preload/views-api.ts`(renderer API 구현 본보기), `packages/shell/main/desktop/core/client.ts`(`upload`·memory 호출)
- 계약:
  - 쓰는 것: `shell/ipc/annotation.ts` 전부(채널, `annotateStateSchema`, `pickedItemSchema`, `LophnShellAnnotateApi`, `AnnotateViewPort`, `AnnotateReply`), `protocol/apps/annotation.ts`의 상수와 `annotationSend`·`annotationUploadScreenshot` 입력 모양. 단 shell main은 protocol을 import하지 못해 `ipc/annotation.ts`의 사본을 쓴다(없는 칸이 있으면 계약 바꾸기 요청)
  - 내놓는 것: `registerAnnotateIpc(ipc, deps)`와 `removeAnnotateIpc(ipc)`(`app-frame/annotate.ts`), `createAnnotateApi(transport)`(`preload/annotate-api.ts`). 조립은 lead가 한다(보고).

## 할 일

1. `annotate.ts` — 상태와 IPC (S9 4장)
   - view_session마다 상태 `{on, items, phase}`를 메모리에 쥔다. `items`는 페이지가 `annotate:items`로 보낸 `pickedItem` 목록에 이 task가 `release`(고를 때 그 view의 release)를 붙인 것이다. 새 번호가 생길 때 release를 적어 둔다.
   - renderer → main (`ANNOTATE_MODE_CHANNEL`, `ANNOTATE_REMOVE_CHANNEL`, `ANNOTATE_SEND_CHANNEL`. send 입력의 `session`은 agent pane이 가리키는 session이고 그대로 `annotation.send`에 넘긴다): sender가 shell 창 본문이고 `view_session`이 그 창에 속한 앱 view여야 한다(`view-ipc.ts`가 하는 검사를 같은 방식으로). 모르는 view는 `forbidden`. 결과는 `AnnotateReply`로 돌려준다.
     - mode: 켜면 페이지에 `annotate:set-mode {on: true}`를 보내고 state를 push한다. 끄면 mode만 끄고 목록은 둔다.
     - remove: 페이지에 `annotate:remove`를 보내고 목록에서 뺀다(`n`을 빈 번호 없이 다시 매기지는 않는다. 페이지가 번호를 쥔다).
   - 페이지 → main (`annotate:items`, `annotate:exit`, `annotate:capture-ready`): sender가 `senderAnnotateView`로 찾은 살아 있는 앱 view일 때만 받는다(앱 view가 아닌 sender는 무시). `annotate:items`는 `pickedItemSchema`로 검사하고 알 수 없는 칸이 있으면 버린다. `annotate:exit`(Esc)이면 mode만 끈다.
   - state push(`ANNOTATE_STATE_CHANNEL`)는 목록이 바뀔 때, mode가 바뀔 때, 보내는 중(`phase`)에 보낸다. `label`은 component 이름, 없으면 `role "name"`이다.
2. `capture.ts` — 보내기 때 screenshot 만들기 (S9 6장)
   - annotation마다: 페이지에 `annotate:prepare-capture {n}` → `annotate:capture-ready {n, crop}`을 기다린다(시간 상한 2초) → `AnnotateViewPort.capture()`로 view 전체 PNG를 받는다 → `crop`(viewport CSS px)을 PNG 크기와 viewport 크기의 비로 PNG px로 바꿔 자른다 → 긴 변이 1600px를 넘으면 줄인다 → PNG byte가 `ANNOTATION_SCREENSHOT_MAX_BYTES`를 넘으면 한 번 더 줄인다 → 끝나면 `annotate:clear-capture`.
   - Electron `nativeImage`(`createFromBuffer`, `crop`, `resize`, `toPNG`)를 쓴다. 이미지 처리는 `deps`로 받는 함수(`cropAndFit`)에 두어 가짜로 바꿀 수 있게 한다. 실제 구현은 `capture.ts` 안의 adapter다.
   - 어느 단계든 실패하면 그 annotation은 screenshot 없이(`null`) 보낸다. 모은 목록과 메모를 잃지 않는다(S9 10장).
   - view 바깥(lophn 크롬, 다른 창)은 찍지 않는다. `capture()`는 앱 view의 것이다.
3. 보내기 (`ANNOTATE_SEND_CHANNEL`, `I3.9#2`, S9 7장)
   - 보내기를 누르면 `phase: "sending"`을 push하고, 위 2를 번호 순서로 돌린 뒤 screenshot을 core의 `annotation.upload_screenshot`(upload route)로 올려 준비 blob을 받고, 마지막으로 `annotation.send`(memory route)를 한 번 부른다. 입력 `{app, session, annotations: [{n, kind, note, screenshot, component, bundle_position, element, rect, view: {screen, path}, release}]}`. `app`·`release`·`screen`은 sender view에서 정한 값이다(페이지 주장 아님). `view.path`는 페이지가 준 `path`다.
   - core 호출은 `deps.core`(`desktop/core/client.ts`의 `CoreSession`과 같은 모양: `call(kind, resource, method, body)`, `upload(resource, method, body, bytes)`)로 받는다.
   - 성공하면 mode를 끄고 목록을 비우고 state를 push하고 `{sent, session}`을 돌려준다(toast는 renderer가 띄운다). 실패하면 `phase`를 `idle`로 되돌리고 목록은 그대로 두고 오류 code와 이유를 돌려준다. 보관한 앱이면 core가 `conflict`로 답하고 이유가 message에 있다.
4. `preload/annotate-api.ts` — `createAnnotateApi(transport): LophnShellAnnotateApi`. `views-api.ts`와 같은 모양: 채널마다 `invoke`하고 실패는 code만 message로 싣은 Error로 거절한다. `subscribeState`는 `ANNOTATE_STATE_CHANNEL` push를 `annotateStateSchema`로 검사해 listener에 준다.
5. `wiring/annotate.ts` — `register(ctx)`: `ctx.ipc`에 `registerAnnotateIpc`를 달고 `stop()`에서 `removeAnnotateIpc`. `ctx.core`(`CoreSession`)와 앱 view 입구(`senderAnnotateView`, `annotateView`)를 `ShellContext`의 칸으로 읽는다. 칸이 없으면 `wiring/context.ts`(lead)에 더해 달라고 보고한다(`app-views` 영역의 registry 값이 칸으로 올라와야 한다).
6. 위험 test 한 file `annotate_test.ts` (가짜 `AnnotateViewPort`·가짜 `core`·가짜 `cropAndFit`)

- (lead가 더함, app-calls-shell이 넘긴 것) app frame이 `annotateView`·`senderAnnotateView`를 구현했다(`views.appFrame.annotateView`, `views.appFrame.senderAnnotateView`). `ShellContext`에 올리는 줄이 필요하면 보고의 "등록할 것"에 적는다(lead가 `wiring/context.ts`에 넣는다).

## 끝남

- `deno task check`가 통과한다. shell main의 type check(`tsc`, `packages/shell/main/package.json`의 check)도 통과한다.
- 위험 test(`packages/shell/main/app-frame/annotate_test.ts`):
  - "앱 view가 아닌 sender가 보낸 고르기 IPC는 무시되고, 앱·release·screen은 sender view에서 정한 값으로만 core에 간다"
  - "capture나 upload가 실패해도 모은 목록과 메모는 screenshot 없이 보내진다"
- 남지 않음: 해당 없음(새 file).

## 보고

- 바꾼 file
- 등록할 것: `wiring/`의 register 목록(`main.ts`, lead)에 `annotate` 한 줄, `ShellContext`에 더할 칸, `preload/shell.ts`(contract-shell 소유)에서 `...createAnnotateApi(ipcRenderer)`를 `lophnShell`에 더하는 한 줄
- 안 쓰게 된 export: 없음
- 정한 것: capture 대기 2초, 긴 변 1600px, 번호를 다시 매기지 않는 것, 번호는 페이지가 쥐는 것
- 계약 바꾸기 요청(wave 3): `ipc/annotation.ts`나 `AnnotateViewPort`에서 모자란 칸, main의 core client가 upload를 쓰지 못하면 그 모양

- (lead가 더함, screens-app-space-frame가 넘긴 것) renderer `app-frame/annotate/`가 `LophnShellAnnotateApi`(`send({view_session, session})` 등)를 쓴다. `preload/shell.ts`의 `lophnShell`에 이 API를 여는 줄을 넣는다.
