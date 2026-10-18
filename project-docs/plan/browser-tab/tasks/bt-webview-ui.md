# bt-webview-ui

보통 browser 탭의 page를 shell renderer의 `<webview>`로 그린다. `<webview>`는 DOM 안에 그려지므로 menu, popover, floated 패널이 그 위에 그냥 겹친다. 다만 `<webview>`를 DOM에서 다른 부모로 옮기면 guest가 다시 만들어진다(page 다시 load, 로그인 도중 화면과 opener 끊김). 그래서 창마다 고정된 그릇 하나에 탭 key당 `<webview>`를 한 번만 만들고, 탭을 그리는 자리(pane 칸, floated 패널 몸통)는 자기 사각형만 알려 위치·크기·z-index만 바꾼다. 크기 준 popup(native view)은 지금 길 그대로이고, dock하면 같은 주소의 `<webview>`로 다시 연다.

- 단위: bt-webview-ui (wave 3)
- 선행: bt-popup-float
- 소유(이 task만 고친다):
  - `packages/shell/renderer/browser/webview-host.tsx`(새로)
  - `packages/shell/renderer/browser/webview-host.module.css`(새로)
  - `packages/shell/renderer/browser/browser-tab.tsx`
  - `packages/shell/renderer/browser/browser-tab.module.css`
  - `packages/shell/renderer/browser/testdata/fake-browser-api.ts`
  - `packages/shell/renderer/workspace/kinds/browser.tsx`
  - `packages/shell/renderer/workspace/workspace.tsx`
  - `packages/shell/renderer/workspace/workspace.module.css`
  - `packages/shell/renderer/workspace/floats/floats.tsx`
  - `packages/shell/renderer/workspace/floats/floats.module.css`
- 읽을 것:
  - 계획: `project-docs/plan/browser-tab/README.md`의 "정한 것" 끝 세 줄(2026-10-19)
  - architecture: `project-docs/architecture/workspace-layout.md`(floats 층, 패널 z-index = 층 번호, DOM 순서 고정, focus, cover, `ViewKeeps`), `project-docs/architecture/browser-tab.md`
  - lead 실험 결과(Electron 44.5.1): 겹친 DOM(z-index 높음)이 `<webview>` 위에 그려진다. `<webview>`를 다른 부모로 `appendChild`하면 guest id가 바뀌고 page가 다시 load된다. 한 부모에 둔 채 left/top/width/height/z-index만 바꾸면 그대로다. `visibility:hidden`이나 크기 0도 그대로다.
  - 지금 코드: `browser/browser-tab.tsx`(`open`/`adopt`, `useViewBounds`, `ViewKeeps`, `subscribeState`·`subscribeEvents`, toolbar, 새 탭 목록, popup-blocked toast), `kinds/browser.tsx`(`keep`, `onPopup`, `onAdopted`, `onCloseRequested`, `openFloat`), `workspace.tsx`(`.content`, Panes, Floats, `ViewLayerProvider`, `ViewKeeps`를 만들고 layout에서 사라진 key를 닫는 effect), `floats/floats.tsx`·`floats.module.css`(층 `--z-sticky`, 패널 z-index), `panes/panes.tsx`(keep kind를 숨긴 채 mount)
  - 계약(lead가 고정): `packages/shell/ipc/browser.ts`. guest 탭의 `view_session`은 `"wv-" + <webview>.getWebContentsId()`다(main이 같은 이름으로 state를 밀고 navigate·command를 받는다, `bt-webview-main`). `BrowserEvent`의 `open-tab { opener, url }`. `open`은 더 쓰지 않는다.

## 할 일

1. `webview-host.tsx`: 창(Workspace)마다 하나인 `<webview>` 그릇과 그것을 다루는 작은 registry(React context).
   - 그릇은 workspace에 한 번 놓이고 다시 mount되지 않는 자리다. 탭 key마다 `<webview partition="persist:lophn-browser" allowpopups src=…>`를 한 번 만들어 그릇에 넣고, 다른 부모로 옮기지 않는다(React tree 밖에서 key로 들고 있어도 된다).
   - 탭을 그리는 자리는 `useWebviewSlot({ key, url, ref, shown, layer })`로 자기 요소의 사각형(ResizeObserver, 스크롤·창 크기 변화)과 보임을 알린다. registry는 그 `<webview>`의 left·top·width·height·z-index·visibility만 바꾼다.
   - z-index: pane 칸의 탭은 pane 내용 높이에, floated 탭은 그 패널 바로 위·다음 패널 아래에 오게 한다. 지금 floats 층은 자기 stacking context(`--z-sticky`) 안에서 패널 z-index로 위아래를 정하므로, 그릇을 그 stacking context와 맞게 둘 자리를 정한다(예: 그릇을 floats 층과 같은 stacking context 안에 두고 pane 탭은 모든 패널보다 아래, floated 탭은 자기 패널 z-index 위). side panel, project picker, menu·popover·dialog·toast(portal)는 여전히 위에 와야 한다. 정한 자리와 이유를 보고에 쓴다.
   - 안 보이는 탭(고르지 않음, 접힘, 다른 화면)은 `visibility:hidden`. 탭이 layout에서 사라지면(Workspace의 key 정리와 같은 때) `<webview>`를 지운다.
   - `<webview>`가 붙으면(`did-attach`) `getWebContentsId()`로 `view_session`을 알려 준다.
2. `browser-tab.tsx`: 두 종류를 그린다.
   - guest 탭(보통): `open`을 부르지 않고 `useWebviewSlot`으로 page 자리를 알린다. `view_session`(`wv-<id>`)을 얻으면 지금처럼 `subscribeState`·`subscribeEvents`와 toolbar(`navigate`, `command`)를 쓴다. 빈 주소 칸으로 연 탭은 `<webview>`를 숨기고 새 탭 목록을 그린다. 처음 주소는 `src`로 준다(main이 attach 때 검사한다).
   - native popup 탭(`fields.adopt`가 있거나 adopt된 popup): 지금 길(`adopt`, `useViewBounds`, `ViewKeeps`) 그대로.
3. dock: native popup 탭이 dock되면(floated에서 pane으로) 그 native view를 닫고 같은 탭 key로 지금 주소의 guest 탭으로 바꾼다(`fields`에서 native 표시를 지우고 `url`을 지금 주소로). page는 다시 load되고 opener는 끊긴다(정한 것). dock을 아는 길은 `ViewLayerProvider`의 층이 0이 되는 것 등 가장 단순한 것을 고른다.
4. `kinds/browser.tsx`: `open-tab { opener, url }` event는 연 탭 바로 뒤에 그 url의 guest 탭을 연다(`openTab(..., { after })`). 크기 준 popup은 지금처럼 `openFloat`(native, `transient`).
5. menu·popover: guest 탭 위의 toolbar menu와 별 popover는 지금의 overlay 길을 그대로 둔다(native popup 탭과 길을 하나로). DOM menu로 되돌리지 않는다.
6. `fake-browser-api.ts`: dev mock·gallery에서 `<webview>` 없이도 그려지게 한다(가짜 page 자리).

## 정한 것

- `<webview>` 그릇은 창마다 하나이고 `<webview>`는 탭 key당 하나다. Float·Dock·접기는 위치·z-index·visibility만 바꾼다(실험: 다른 부모로 옮기면 다시 load된다).
- native popup 탭을 dock하면 `<webview>`로 다시 연다(사람). 잃는 것은 page 상태와 opener다.

## 끝남

- `deno task check`가 통과한다.
- `deno run -A packages/shell/renderer/build.ts`가 선다.
- 위험 test: 없음(화면이다). `model_test.ts`의 위험 test가 통과한다.
- 남지 않음: `grep -rn "browser.open(\|\.open({ url" packages/shell/renderer/browser`가 0줄이다.
- 손으로 보는 것은 lead와 사람이 한다(floated terminal을 page 위에 띄워도 page가 그대로, Float·Dock해도 page가 다시 load되지 않음).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것(그릇 자리와 z-index를 꼭 적는다)
- 넘길 줄: `workspace.tsx`, `floats/*`
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
