# af-artifact-view

artifact view를 shell main에 세운다: 봉한 partition의 `WebContentsView`를 만들고 열고 숨기고 닫는 registry, renderer IPC, navigation 규칙, 파일이 바뀌면 다시 load, http/https link를 사용자 입력 뒤에만 renderer로 알리기, annotate port 내놓기. 위치·숨김·층 순서·창 옮기기는 browser의 `frame-router.ts` 길에 세 번째 갈래로 잇는다.

- 단위: artifact-view (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/artifact/registry.ts`
  - `packages/shell/main/artifact/electron-view.ts`
  - `packages/shell/main/artifact/navigation.ts`
  - `packages/shell/main/artifact/navigation_test.ts`
  - `packages/shell/main/artifact/artifact-ipc.ts`
  - `packages/shell/main/browser/frame-router.ts`
  - `packages/shell/main/desktop/wiring/artifact.ts`
  - `packages/shell/main/desktop/wiring/app-views.ts`
  - `packages/shell/main/desktop/wiring/annotate.ts`
  - `packages/shell/main/desktop/main.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/browser-tab.md`("지키는 것": navigation 결정은 순수 함수 하나, 사용자 입력 5000ms, native view는 앱 view registry에 넣지 않고 같은 `createPlacement`와 `appViewOrder`를 쓴다, `frame-router.ts`가 view_session으로 가른다), `project-docs/architecture/annotation.md`, `project-docs/architecture/workspace-layout.md`(native view 세 층, 창 옮기기 `moveViews`)
  - 제품 결정: `project-docs/products/roadmap/artifact.md`의 "2. artifact 탭"("view", "봉한 partition", "다시 load", "preload"), "정한 것 (agent)"의 "봉한 view는 browser 탭과 다른 kind다"
  - 본보기: `packages/shell/main/browser/registry.ts`(`createBrowserViews`: Entry·Placed·health·`pushState`, 특히 native popup 항목), `browser/electron-view.ts`(`hookBrowserContents`, `WebContentsView` 생성 + `surfaceOptions`), `browser/navigation.ts`·`navigation_test.ts`(순수 결정 + 표 test), `browser/browser-ipc.ts`(`checkCaller`·`checkInput`·창 확인), `browser/activation.ts`(`createActivation`), `browser/frame-router.ts`, `desktop/wiring/browser.ts`(wiring 꼴), `app-frame/placement.ts`(`createPlacement`), `app-frame/crash.ts`(`nextHealth`), `app-frame/electron-app-frame.ts:57`(preload 있는 `WebContentsView` 생성)
  - 계약: `packages/shell/ipc/artifact.ts`, `ipc/annotation.ts`(`AnnotateViewPort`·`AnnotateTarget`), `packages/shell/main/artifact/{session,electron-session,roots,serve}.ts`(af-sandbox), `{source,list,watch}.ts`(af-artifact-files), `preload/artifact.ts`(af-artifact-ipc)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`
- 계약:
  - 쓰는 것: 위 "계약" 항목의 이름들. `ARTIFACT_PARTITION`, `sealArtifactSession`, `electronArtifactSession`, `createArtifactRoots`, `createArtifactServer`, `resolveSource`, `listArtifacts`, `watchFolder`, `artifact*Schema`, `ARTIFACT_*_CHANNEL`
  - 내놓는 것(wave 2의 renderer·annotate가 기댄다): `desktop/wiring/artifact.ts`의 `register(ctx, browser)` → `{ views, frame, stop }`. `frame`은 `BrowserFrame`과 같은 `has/owner/setBounds/hide/close/move`. `views`는 `open`, `reload`, `list`, `annotateView(view_session)`, `senderAnnotateView(contentsId)`(둘 다 `AnnotateViewPort`, target은 `{ kind: "artifact", project, name }`).

## 할 일

1. `navigation.ts`(순수): `decideArtifactNavigation({ url, isMainFrame, host })`. main frame은 같은 host의 `lophn-artifact://<host>/…`만 허용(같은 폴더 안 다른 HTML로 가는 상대 link는 이것이다). http/https는 막고 `external: true`(renderer로 알릴 후보). 나머지(다른 artifact host, `file:`, `lophn-*:`, `data:`, `blob:`, `javascript:`, 모르는 scheme)는 막는다. subframe은 같은 host만 허용. `navigation_test.ts`는 `browser/navigation_test.ts`처럼 표 하나(위험 test).
2. `registry.ts`: `createArtifactViews(deps)`. `browser/registry.ts`의 native popup 항목(Entry + Placed + `createPlacement`)을 본보기로 다시 쓴다(새로 짜지 않는다). 항목 = view_session(`artifact-<uuid>`), window, `source`, `root`, `host`, `file`, contents, health, 마지막 title, loading.
   - `open(window, source)`: `resolveSource` → 실패는 그 code로(`not_found`면 view를 만들지 않는다). 성공이면 `roots.register(root)`로 host를 얻어 contents를 만들고 `lophn-artifact://<host>/<entry>`를 load, `watchFolder`를 건다(artifact는 `recursive: true`, 사람의 file은 `false`와 `dirname(file)`). 같은 창에서 같은 source의 view가 이미 있으면 그 view의 state를 돌려준다(탭이 다시 mount되어도 하나다).
   - `onChange` → `contents.reloadIgnoringCache()`. debounce는 150ms. 시각·timer는 deps로 받는다.
   - `setBounds/hide/close/move/owner/has`: browser native popup 항목과 같은 의미. `closeWindow(ref)`는 그 창의 view를 모두 닫는다. 닫을 때 watch를 거둔다.
   - state push: title(`page-title-updated`), loading, health가 바뀔 때 `ARTIFACT_STATE_CHANNEL`로 그 창에. link 알림은 `ARTIFACT_EVENT_CHANNEL`.
   - `annotateView(view_session)`/`senderAnnotateView(contentsId)`: `AnnotateViewPort`를 낸다. `target = { kind: "artifact", project, name }`(page가 보낸 값은 쓰지 않는다. source는 open 때 main이 정한 것), `send`·`capture`·`pageUrl`·`current`는 contents에 잇는다. `senderAnnotateView`는 main frame에서 온 메시지만 쓰는 쪽(annotate.ts의 `pageView`)이 검사하므로 contentsId로 항목을 찾아 주면 된다.
3. `electron-view.ts`: `WebContentsView`를 `webPreferences(packaged)` + `partition: ARTIFACT_PARTITION` + `preload: preload-artifact.cjs`(`join(here, "preload-artifact.cjs")`)로 만든다. `surfaceOptions`로 headless 처리. hook:
   - `will-navigate`/`will-redirect`/`will-frame-navigate` → `decideArtifactNavigation`. 막고 `external`이면서 사용자 입력이 fresh(`createActivation`, 5000ms)일 때만 `open-link` event를 낸다(입력 없이 page가 스스로 보낸 이동은 조용히 버린다).
   - `setWindowOpenHandler`는 늘 deny. http/https이고 fresh이면 같은 `open-link`.
   - `will-attach-webview` 막기, packaged에서 `devtools-opened` 닫기, `render-process-gone`·`unresponsive`·`responsive` → `nextHealth`, `input-event`로 activation mark. 앱 view가 아니라 browser와 같은 꼴이다.
4. `artifact-ipc.ts`: `ARTIFACT_OPEN/RELOAD/LIST` handler. `browser-ipc.ts`처럼 `checkCaller`(desktop 창 본문만), `checkInput(schema)`. 창은 sender에서 main이 정한다. `list`는 `listArtifacts(ctx.dataRoot, project, fs)`.
   - `open`은 봉한 session을 처음 쓸 때 `sealArtifactSession(electronArtifactSession(), createArtifactServer(…))`를 한 번 한다(`ensureSession`: userData를 data root로 잡은 뒤 첫 view에서. `wiring/browser.ts`의 `ensureSession` 꼴). 봉하지 못하면 `unavailable`로 거절하고 view를 만들지 않는다. 다음 요청이 다시 시도한다.
5. `wiring/artifact.ts`: `register(ctx, browser: Pick<BrowserWiring, "orderOf">)`. native 항목은 `browser.orderOf`를 같이 쓴다(층 순서가 하나여야 한다). `ctx.windowHooks.closed.push(({ ref }) => views.closeWindow(ref))`. `stop()`은 IPC를 걷고 view를 모두 닫는다.
6. `frame-router.ts`: `routeFrame(appFrame, browser, artifact)`로 세 번째 갈래를 더한다(`owner`는 browser → artifact → app 순으로 묻는다). `wiring/app-views.ts`: `register(ctx, browser, artifact)`에서 `routeFrame(appFrame, browser.frame, artifact.frame)`. `desktop/main.ts`: `const artifacts = add(artifact.register(ctx, browserViews))`를 `appViews.register`·`annotate.register` 앞에 두고 둘에 넘긴다.
7. `wiring/annotate.ts`: `register(ctx, views, artifact)`. 앱 view registry와 artifact registry를 합친다: `owner`는 `appFrame.owner(s) ?? artifact.views.owner(s)`, `view`·`senderView`는 앱 것을 먼저 묻고 없으면 artifact 것. 신원(project, name)은 port의 target이 정한다.
8. 사람의 `.html`을 다른 창으로 옮길 때(Detach·Dock)는 `move`로 view를 그대로 옮긴다(`AppViews.moveViews`가 `frame.move`를 부른다). 탭 kind 쪽이 `transfer`를 어떻게 정할지는 `af-artifact-tab`의 일이다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`navigation_test.ts`의 표): "artifact view의 main frame은 같은 host의 `lophn-artifact:`만 가고, 다른 artifact host·`file:`·`lophn-shell:`·`lophn-app:`·`data:`·`javascript:`·모르는 scheme은 막히며, http/https는 막히되 `external`로 표시된다". 이 표 하나다.
- Electron을 띄워 보는 check(죽은 proxy가 실제로 막는지, view가 뜨는지)는 새로 만들지 않는다. 필요하면 lead가 사람에게 먼저 묻는다.
- core 기동 확인은 `project-docs/plan/tools/lead/boot.sh`만 쓴다(shell main은 core를 띄우지 않으므로 보통 필요 없다).
- 남지 않음: `grep -rn "routeFrame(" packages/shell`이 인자 셋짜리만 남는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`desktop/main.ts`는 이 task가 직접 고친다)
- 안 쓰게 된 export: 없음
- 정한 것: 같은 창·같은 source의 view는 하나로 쓴다는 것, reload debounce 값, `open-link` 알림 조건
- 넘길 줄: `frame-router.ts`·`wiring/app-views.ts`·`wiring/annotate.ts`·`desktop/main.ts`는 다른 계획(domain-tools, domain-place)도 건드린다
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: Electron에서의 실제 동작(view 표시, 죽은 proxy, reload)은 lead가 wave 2 뒤 `deno task dev`로 본다
