# wd-main

main이 detached 창을 띄우고 project 창과 중계한다. `openDesktopWindow`가 hash와 bounds를 받아 shell 창을 하나 더 띄우고, `wiring/detached.ts`가 `wd-contract`의 channel 여덟 개를 처리한다: 창 만들기와 앱 view 옮기기(`open`), 탭 값 받기(`take`), 돌려보내기(`dock`), 바뀐 탭 값·탭 열기·탭 닫기 중계, 창 닫기(×) 가로채기, project 창이 닫히면 함께 닫기.

- 단위: wd-main (wave 2)
- 선행: wd-native-move. `AppViews.owns`·`moveViews`(앱 view와 browser의 popup·DevTools를 모두 옮기는 항구)를 쓴다.
- 소유(이 task만 고친다):
  - `packages/shell/main/desktop/detached/registry.ts`
  - `packages/shell/main/desktop/detached/ipc.ts`
  - `packages/shell/main/desktop/wiring/detached.ts`
  - `packages/shell/main/desktop/wiring/desktop-window.ts`
  - `packages/shell/main/desktop/wiring/context.ts`
  - `packages/shell/main/desktop/window.ts`
  - `packages/shell/main/desktop/main.ts`
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/workspace-float.md`의 "지금 코드"(창 여럿), "무엇을 만드나" 4(창, 누가 layout을 갖나, 창을 닫을 때), "정한 것"
  - 계획: `project-docs/plan/workspace-detach/README.md`의 "정한 것"
  - 본보기(IPC 꼴): `main/app-frame/view-ipc.ts`(`guard`: `checkCaller` 뒤 `checkInput`, 창은 sender로 main이 정한다, 응답 `ViewReply`), `main/desktop/core/layout-ipc.ts`, `main/desktop/window-controls.ts`
  - architecture: `project-docs/architecture/browser-tab.md`(popup view의 소유 창은 opener의 창, `<webview>`는 옮기지 않는다)
  - 지금 코드(main `5361104e8`을 열어 확인한 것이다):
    - `main/desktop/wiring/desktop-window.ts`: `openDesktopWindow(ctx)`(61행 근처)는 옵션이 없고 URL을 환경 변수로만 고른다. `create` 안에서 `windows.add(window)`, `overlays.attach`, `ctx.windowHooks.created`를 부르고 `closed` hook과 `windows.delete`를 단다. 창은 `create` 안에서 동기로 만들어져 함수가 돌려준다. `sendIntent`·`showDesktopWindow`는 `ctx.windows`의 "가장 최근 창"을 쓴다.
    - `main/desktop/window.ts`: `windowConfig`가 `MIN_WINDOW_WIDTH/HEIGHT`(960×600)를 너비·높이·최소로 쓰고 위치가 없다. `WindowConfig`에 `x`·`y`가 없다.
    - `main/desktop/window.ts`의 `windowConfig`는 `webPreferences.webviewTag: true`를 **모든** desktop 창에 준다(browser-tab 문서와 `wiring/browser.ts` 주석은 "project 창만"이라 쓰지만 코드는 창을 가리지 않는다). 그래서 detached 창도 `<webview>`를 붙일 수 있고, `wiring/browser.ts`의 `windowHooks.created`가 거는 `will-attach-webview`·`did-attach-webview`(guest 등록)가 detached 창에도 걸린다. `ctx.windowHooks.closed`의 `views.closeWindow(ref)`가 창에 남은 popup·DevTools·guest를 폐기한다.
    - `main/desktop/wiring/context.ts`: `ShellContext`의 `windows`, `windowRef`, `windowOfRef`, `shellWindowOf`, `windowHooks`(`created`·`closed`), `quit`(`requested`, `active()`), `closeGuards`.
    - `main/desktop/wiring/editor.ts`: 창마다 `CloseGuard`를 `windowHooks.created`에서 달고 `guardWindowClose`가 `window.on("close")`에서 renderer에 저장을 묻는다(마지막 고침을 flush하고, 남으면 사람에게 묻는다). detached 창의 닫기 가로채기는 이 guard **뒤에** 돌아야 한다: 이 task의 `close` listener는 `openDesktopWindow`가 돌려준 뒤에 달므로 순서가 저절로 맞는다.
    - `main/desktop/main.ts`: 영역 등록 순서(`browser.register` → `appViews.register(ctx, browserViews)` → … → `layout` → `bookmarks` → `editor` → `desktop`). `main/desktop/wiring/app-views.ts`는 `register(ctx, browser)`다. `main/desktop/ipc-guard.ts`: `checkCaller`는 sender webContents id로 본다(창이 여럿이어도 된다).
    - `main/app-frame/registry.ts`·`wiring/app-views.ts`: `wd-native-move`가 더한 `AppViews.owns`, `moveViews`. `closeWindow`는 닫힌 창에 남은 view를 폐기한다.
  - module: `project-docs/module-catalog.yaml`의 `packages/shell/main`
- 계약:
  - 쓰는 것: `wd-contract`의 `ipc/detached.ts` 전부(channel 상수, schema, `DetachedEvent`, `DetachedReply`), `wd-native-move`의 `AppViews.owns`·`moveViews`, `wd-layout`의 `WindowBounds`(`main/workspace/layout.ts`가 re-export하는 type).
  - 내놓는 것: `wiring/detached.ts`의 `register(ctx, views)`가 `Registered`를 돌려준다(`wd-restore`가 `boundsOf`와 `moved` 중계를 더한다). `openDesktopWindow(ctx, start?)`와 `ShellContext.detached`:

```ts
// desktop-window.ts
export function openDesktopWindow(ctx: ShellContext, start?: { hash: string; bounds?: WindowBounds }): BrowserWindow | undefined;
// context.ts — ShellContext에 더한다. detached 창들. `windows`에도 들어 있다.
detached: Set<BrowserWindow>;
```

## 할 일

1. `window.ts`: `WindowOptions`에 `bounds?`를 더하고 `windowConfig`가 있으면 `x`·`y`·`width`·`height`로 쓴다. 너비·높이는 `MIN_WINDOW_*` 아래로 내려가지 않는다(`WindowConfig`에 `x?`·`y?`를 더한다). `minWidth`·`minHeight`는 그대로다.
2. `desktop-window.ts`: `openDesktopWindow(ctx, start?)`. `start.hash`가 있으면 URL을 `${desktopUrl}${start.hash}`로 하고(`LOPHN_SHELL_START`·`LOPHN_DEV_SEED`는 보지 않는다), `start.bounds`를 `openWindow`에 넘긴다. `sendIntent`·`showDesktopWindow`가 "가장 최근 창"을 고를 때 `ctx.detached`의 창을 건너뛴다(전역 palette 키와 tray의 창 열기가 detached 창으로 가지 않게). 건너뛰고 남는 창이 없으면 지금처럼 새 기본 창을 연다.
3. `context.ts`: `detached` Set을 더한다.
4. `detached/registry.ts`(순수): detached 창 항목의 표. 항목은 `{ ref(detached 창), parent(project 창 ref), project, key, tab, transfer, silent }`. `add`, `byRef`, `byParentKey(parent, key)`, `childrenOf(parent)`, `remove(ref)`, `setTab`. Electron을 import하지 않는다.
5. `detached/ipc.ts`: channel마다 handler를 만드는 함수. 의존은 인자로 받는다(`registry`, `ContentsRegistry`, `refOf(sender)`: sender가 보낸 창의 ref와 detached 창인지, `openWindow`, `closeWindow(ref)`, `focusWindow(ref)`, `send(ref, event)`, `owns`·`moveViews`). 모든 handler는 `view-ipc.ts`의 `guard`처럼 `checkCaller`(desktop 창 본문) → `checkInput`(`wd-contract`의 schema)를 차례로 보고 응답은 `DetachedReply`다. 보낸 창의 역할이 맞지 않으면 `forbidden`.
   - `open`(project 창, 또는 detached 창 안에서 열린 popup): 보낸 창이 detached 창이면 `project`가 그 창 항목의 project와 같아야 하고(아니면 `invalid_input`) 새 항목의 parent는 그 창의 parent다. 같은 (project, key) 항목이 있으면 그 창을 앞으로 가져오고 `conflict`. `transfer.views`가 모두 보낸 창의 view여야 한다(`owns`, 아니면 `invalid_input`. 앱 view, popup, DevTools를 가리지 않는다). 창을 만들고(`#detached=<encodeURIComponent(tab.key)>`, `bounds`) 항목을 더한 뒤 `moveViews(보낸 창, 새 창, transfer.views)`. 옮기기가 실패하면 만든 창을 silent로 닫고 `unavailable`. 성공하면 `{ bounds: 만든 창의 getBounds() }`. 보낸 창이 detached 창이었으면 parent project 창에 `{ kind: "opened", tab, bounds }`도 보낸다(그 탭은 project 창 layout에 아직 없다).
   - `focus`: 보낸 창의 항목 (parent, key)이 없으면 `not_found`, 있으면 최소화를 풀고 앞으로 가져온다.
   - `close`: key면 그 창, null이면 보낸 창의 detached 창 전부를 silent로 닫는다(탭 값은 건드리지 않고 project 창에 event도 보내지 않는다).
   - `take`(detached 창): 그 창의 항목에서 `{ project, tab, transfer }`를 돌려준다(여러 번 불러도 같다). 항목이 없으면 `not_found`.
   - `dock`(detached 창): `tab.key`가 항목의 key와 같아야 한다. `transfer.views`가 detached 창의 view여야 하고(`owns`) project 창이 살아 있어야 한다(아니면 `unavailable`, 창은 그대로). `moveViews(detached 창, project 창, views)` 뒤 project 창에 `{ kind: "docked", key, tab, transfer }`를 보내고 silent로 창을 닫는다.
   - `changed`: 항목의 tab을 갱신하고 project 창에 `{ kind: "changed", key, tab }`.
   - `openTab`: project 창에 `{ kind: "open-tab", tab }`를 보내고 project 창을 앞으로 가져온다.
   - `remove`: project 창에 `{ kind: "closed", key }`를 보내고 silent로 창을 닫는다.
6. `wiring/detached.ts`: `register(ctx, views)`. 위 handler를 `ctx.ipc`에 등록하고(`stop`에서 `removeHandler`), 창을 만드는 `openWindow`는 `openDesktopWindow(ctx, { hash, bounds })`로 만든 창을 `ctx.detached`에 넣고 항목에 `ctx.windowRef(window)`를 쓴다.
   - 창 닫기 가로채기: 만든 창에 `window.on("close", …)`를 단다. 항목이 silent이거나 앱을 끄는 중(`ctx.quit.requested` 또는 `ctx.quit.active()`)이면 그대로 닫는다. 아니면 `event.preventDefault()`하고 그 창 renderer에 `{ kind: "dock-request" }`를 보낸다(renderer가 transfer를 만들어 `dock`을 부른다. 실패하면 창이 그대로 남는다). renderer가 죽었으면(`webContents.isCrashed()`) 가로채지 않는다.
   - `ctx.windowHooks.closed`: (a) 닫힌 창이 project 창이면 그 창의 detached 창을 모두 silent로 닫는다(`window.close()`. 편집기 guard가 자기 창에서 묻는다). (b) 닫힌 창이 detached 창이면 항목을 지우고 `ctx.detached`에서 뺀다. silent가 아니고 앱을 끄는 중이 아니면(창이 예기치 않게 사라졌다) project 창에 `{ kind: "docked", key, tab: 항목의 마지막 tab, transfer: null }`를 보내 탭이 layout에서 사라지지 않게 한다. event를 보내기 전 `webContents.isDestroyed()`를 본다.
7. `main.ts`: `import * as detached from "./wiring/detached.ts"`, `add(detached.register(ctx, views))`를 `editor.register` 뒤 `desktop.register` 앞에 둔다.
8. 확인은 손으로 하지 않는다(창 여럿을 띄우는 Electron test는 만들지 않는다). 순서 논리는 `detached/registry.ts`와 `ipc.ts`가 의존을 인자로 받는 모양이라 `deno check`로 충분하다.

## 정한 것

- renderer가 창이 뜬 뒤 `take()`로 탭 값을 당겨 받는다(agent). 값은 hash에 싣지 않는다(탭 key가 4096자까지이고 transfer가 커질 수 있다). hash의 key는 route 선택용이다.
- 창이 예기치 않게 사라지면 탭을 저장된 값으로 project 창에 돌려준다(agent, `transfer: null`). 앱을 끄는 중에는 보내지 않는다: 끄기에서 자동으로 dock하면 다음 실행에 detached 창이 돌아오지 않는다.
- 같은 (project, key)의 detached 창이 이미 있으면 새로 띄우지 않고 그 창을 앞으로 가져온다(agent). project 창 둘이 같은 project의 layout 파일을 같이 읽을 때 같은 창이 둘 뜨지 않게 하려는 것이다.
- OS 창 제목은 기본(`windowTitle()`)을 쓴다(agent). `windowTitle`은 main이 아는 공간 이름만 받는다는 규칙이고 탭 제목은 renderer가 낸 글이다.
- detached 창은 기본 크기·최소 크기가 다른 창과 같다(960×600, agent). 따로 정할 근거가 없다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 창을 여럿 띄우는 Electron test는 새로 만들기 전에 사람에게 묻는다(AGENTS.md). 중계 논리는 의존을 인자로 받아 읽기로 검토한다.
- 남지 않음: 없음(더하는 것뿐이다. `sendIntent`·`showDesktopWindow`만 필터가 붙는다).
- `deno run -A packages/shell/main/build.ts`로 main bundle이 선다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없으면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: Electron에서 손으로 확인하지 못한 것(창 닫기 가로채기, project 창 닫을 때 함께 닫기, 앱 끄기)을 적는다. lead가 손으로 본다.
