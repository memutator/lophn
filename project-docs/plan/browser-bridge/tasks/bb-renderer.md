# bb-renderer

renderer가 bridge를 쓰는 두 길을 만든다. (1) main이 push한 "이 terminal이 연 URL을 browser 탭으로 열어 달라"(`onBridgeOpen`)를 Workspace가 받아 browser 탭을 열고 ack한다. 여는 자리는 terminal 반대쪽 pane, pane이 하나면 같은 pane의 terminal 바로 뒤, terminal이 floated이면 focus pane이다. (2) terminal에서 http/https link를 Ctrl/Cmd-click하면 `openLink`로 main에 보낸다. 그냥 click은 아무 일도 하지 않는다.

- 단위: bb-renderer (wave 2)
- 선행: bb-contract
- 소유(이 task만 고친다):
  - `packages/shell/renderer/terminal/use-bridge-open-requests.ts`
  - `packages/shell/renderer/terminal/xterm-view.ts`
  - `packages/shell/renderer/terminal/terminal-tab.tsx`
  - `packages/shell/renderer/workspace/workspace.tsx`
  - `packages/shell/renderer/deno.json`
  - `deno.lock`
- 읽을 것:
  - 계획: `project-docs/plan/browser-bridge/README.md`("정한 것": 여는 자리, ack, Ctrl/Cmd-click, `workspace-detach`와의 접점)
  - architecture: `project-docs/architecture/browser-tab.md`("흐름"의 browser 탭 열기, 새 탭 뒤에 여는 `after`), `project-docs/architecture/workspace-layout.md`(pane, floats, focus pane)
  - 제품 결정: `project-docs/products/roadmap/browser-tab.md`의 "무엇을 만드나" 2(여는 자리, terminal link)
  - 본보기(hook): `packages/shell/renderer/terminal/use-terminal-open-requests.ts`(구독과 `latest` ref 꼴), 쓰는 자리는 `workspace.tsx`의 `useTerminalOpenRequests(...)`(`hostRef` 바로 뒤)
  - 본보기(탭 열기): `workspace/kinds/host.ts`의 `TabHost.openTab(tab, { after })`와 `view`, `workspace/model.ts`의 `allTabs`·`openTabIn`(`after`가 있는 칸에 들어간다), `workspace/kinds/browser.tsx`의 `openBrowserTab`(탭 모양: `{ kind: "browser", fields: { url } }`)
  - 본보기(xterm): `packages/shell/renderer/terminal/xterm-view.ts`(`createXtermView`, `XtermParts`, OSC 8·52를 삼키는 `SWALLOWED_OSC`), `terminal-tab.tsx`의 `deps.createView(host)`를 쓰는 effect
  - 이 task가 쓰는 것: bb-contract(`TerminalApi.onBridgeOpen`·`ackBridgeOpen`·`openLink`, `TerminalBridgeOpen`)
- 계약:
  - 쓰는 것: `ipc/terminal.ts`의 위 member, `TabHost`, `TerminalStore.get(key)?.terminalRef`.
  - 내놓는 것:
    - `use-bridge-open-requests.ts`: `useBridgeOpenRequests(bridge: TerminalApi | null, open: (request: { terminal_ref: string; url: string }) => boolean): void`(push마다 `open`을 부르고 true를 돌려줬을 때만 `bridge.ackBridgeOpen({ request, opened: true })`), `bridgeAfter(view: WorkspaceView, terminalKey: string): string | undefined`(순수), `openBridgeUrl(host: TabHost, store: TerminalStore, request: { terminal_ref: string; url: string }): boolean`.
    - `TerminalView`의 새 member: `onLink(listener: (url: string) => void): () => void`.

## 할 일

1. `use-bridge-open-requests.ts`:
   - `bridgeAfter(view, terminalKey)`: terminal이 pane에 있고 `view.panes.length === 2`이면 반대쪽 pane의 마지막 탭의 key(그 pane에 탭이 없으면 undefined). pane이 하나이면 terminal의 key(`TabHost.openTab`의 `after`가 그 탭 바로 뒤에 넣는다). terminal이 floated이거나 pane에 없으면 undefined(focus pane에 연다).
   - `openBridgeUrl(host, store, request)`: `allTabs(host.view)`에서 `kind === "terminal"`이고 `store.get(tab.key)?.terminalRef === request.terminal_ref`인 탭을 찾는다. 없으면 false(이 창의 terminal이 아니다). 있으면 `host.openTab({ key: <새 key>, kind: "browser", title: <url의 host>, fields: { url } }, { after: bridgeAfter(...) })`로 열고 true. 새 key는 `browser-bridge-<시각 base36>-<번호>`(탭 key 규칙 `[A-Za-z0-9._:-]+`). `kinds/browser.tsx`의 `openBrowserTab`은 `after`를 받지 않고 그 file은 계획 `workspace-detach`가 고치므로 건드리지 않고 같은 모양의 탭을 직접 만든다.
   - `useBridgeOpenRequests`: `use-terminal-open-requests.ts`처럼 `bridge.onBridgeOpen`을 effect에서 구독하고 `open`은 최신 ref로 부른다. 해지를 돌려준다.
2. `workspace.tsx`: `import` 한 줄과 `useTerminalOpenRequests(...)` 블록 바로 뒤에 `useBridgeOpenRequests(terminal?.bridge ?? null, (request) => terminal === undefined ? false : openBridgeUrl(hostRef.current, terminal.store, request))` 한 블록만 더한다. 이 file은 `workspace-detach`의 task들도 고친다. 이 두 곳 말고는 건드리지 않는다.
3. 의존성: `@xterm/addon-web-links`를 `0.12.0`으로 고정해 `packages/shell/renderer/deno.json`의 imports에 더하고(`@xterm/xterm@6.0.0`과 짝이다. npm `latest`다) `deno.lock`이 바뀌게 한다. 새 의존성을 이것 하나로 한다.
4. `xterm-view.ts`: `WebLinksAddon`을 `XtermParts`에 더하고 `createXtermView`에서 `new parts.WebLinksAddon((event, uri) => …)`로 `loadAddon`한다. handler는 `event.ctrlKey || event.metaKey`일 때만 등록된 `onLink` listener들에 `uri`를 넘긴다(그냥 click은 무시). `window.open`이나 기본 동작을 쓰지 않는다. OSC 8 삼키기는 그대로 둔다. `TerminalView.onLink`를 낸다(`onData`와 같은 꼴). 파일 머리 주석의 "링크 handler를 등록하지 않는다"를 지금 사실에 맞게 고친다(자동 링크 OSC 8은 여전히 삼키고, 보이는 http/https 글자만 Ctrl/Cmd-click으로 연다).
5. `terminal-tab.tsx`: view를 만드는 effect에서 `view.onLink((url) => …)`를 구독한다. 그 탭의 `store.get(tabKey)?.terminalRef`가 있고 `bridge`가 있으면 `void bridge.openLink({ terminal_ref, url })`. 실패해도 아무것도 보이지 않는다. 해지는 effect 정리에서 한다.
6. test는 쓰지 않는다(화면과 내부 구현이다). `deno task wireframes`가 깨지지 않는지 본다(wireframes의 terminal도 `createXtermView`를 쓴다. import map에 addon이 없어서 번들이 깨지면 `tools/wireframes/deno.json`에 같은 줄을 더하고 보고에 적는다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음.
- 남지 않음: 없음(새 file과 새 member).
- 손으로(lead가 한다): README "손으로 확인"의 Ctrl-click, 반대쪽 pane, floated terminal.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `workspace.tsx` 두 곳, 필요했다면 `tools/wireframes/deno.json`
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음". 알고 있는 것: detached 창 안의 terminal은 이 hook이 없어 bridge가 `declined`이다(OS browser).
