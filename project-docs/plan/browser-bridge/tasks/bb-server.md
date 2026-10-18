# bb-server

Electron main에 bridge를 올린다. unix socket 서버가 `{v:1,key,url}` 한 줄을 받아 key로 어느 terminal 탭이 연 것인지 알고, 설정(`web_links`·`local_links`)이 `browser_tab`이면 renderer에 "이 URL을 browser 탭으로 열어 달라"고 push해 응답(ack)을 기다린 뒤 `pane` 또는 `declined`로 답한다. shell 탭을 열 때 key를 발급해 env를 host에 넘기고, terminal link를 Ctrl/Cmd-click했을 때의 `openLink`도 같은 길로 처리한다. 판정은 `bb-policy`의 함수가, 폴더와 shim file은 `bb-shim`이 맡는다.

- 단위: bb-server (wave 2)
- 선행: bb-policy, bb-contract, bb-shim
- 소유(이 task만 고친다):
  - `packages/shell/main/browser-bridge/bridge.ts`
  - `packages/shell/main/browser-bridge/bridge_test.ts`
  - `packages/shell/main/browser-bridge/socket.ts`
  - `packages/shell/main/desktop/wiring/bridge.ts`
  - `packages/shell/main/terminal/ipc.ts`
  - `packages/shell/main/terminal/controller.ts`
  - `packages/shell/main/desktop/wiring/coding.ts`
- 읽을 것:
  - 계획: `project-docs/plan/browser-bridge/README.md`("정한 것": 흐름, ack, 제외한 것)
  - architecture: `project-docs/architecture/browser-tab.md`("지키는 것"의 navigation 결정과 `mailto:` 규칙), `project-docs/architecture/coding-agent.md`
  - 제품 결정: `project-docs/products/roadmap/browser-tab.md`의 "무엇을 만드나" 2(서버)·4(link를 열 곳)
  - 가져올 동작(코드를 복사하지 않고 계약만 따른다): `../rea/project/desktop-embeded-browser/src/main/bridge.js`(`BrowserBridgeServer`: 한 줄 요청, 8KiB, 한 줄 답, socket timeout, `dispatch`의 순서)
  - 본보기(wiring): `packages/shell/main/desktop/wiring/coding.ts`(`register`, `terminalIpc`), `wiring/bookmarks.ts`, `wiring/browser.ts`의 `openExternal`(headless 건너뛰기)
  - 본보기(IPC 검사): `packages/shell/main/terminal/ipc.ts`의 `focus`(`checkCaller`, `checkInput`), `desktop/ipc-guard.ts`
  - 본보기(core 설정 읽기): `packages/shell/main/desktop/wiring/context.ts`의 `coreInternal`, renderer 쪽 모양은 `renderer/desktop/settings/declared.ts`의 `listSettings`
  - 쓰는 외부 URL 검사: `packages/shell/main/app-frame/external-link.ts`의 `checkExternalUrl`
  - 이 task가 쓰는 것: bb-policy, bb-contract(`TerminalBridge`, channel 이름, `HostRequest.env`), bb-shim(`prepareRunDir`, `writeShim`)
- 계약:
  - 쓰는 것: `policy.ts` 전부, `types.ts`의 `TerminalBridge`, `ipc/terminal.ts`의 channel·schema, `run-dir.ts`·`shim.ts`.
  - 내놓는 것:
    - `bridge.ts`: `createBridge(deps: BridgeDeps): TerminalBridge & { handleLine(line: string): Promise<"pane" | "declined"> }`.
      ```ts
      type BridgeDeps = {
        paths: { socket: string; shim: string };
        env: Readonly<Record<string, string | undefined>>;     // 앱 process env (policy.bridgeEnv에 넘긴다)
        ids: { key(): string /* 64자 hex */; request(): string };
        readPrefs(): Promise<LinkPrefs>;                       // 못 읽으면 DEFAULT_LINK_PREFS로 답한다(던지지 않는다)
        windows(): readonly { send(channel: string, payload: unknown): void }[];
        openExternal(url: string): void;
        timers: { after(ms: number, run: () => void): () => void }; // 취소 함수를 돌려준다
        log(message: string): void;
      };
      ```
    - `socket.ts`: `listenBridge(options: { socket: string; handleLine(line: string): Promise<"pane" | "declined">; log(message: string): void }): Promise<{ stop(): Promise<void> }>`.
    - `wiring/bridge.ts`: `createBridgeWiring(ctx: ShellContext): { bridge: TerminalBridge | null; stop(): void }`. `wiring/coding.ts`의 `register`가 부른다(`desktop/main.ts`를 고치지 않으려는 것이다. 계획 `workspace-detach`가 `main.ts`를 소유한다).

## 할 일

1. `bridge.ts`:
   - key 표는 `Map<key, terminalRef>`다. `issue()`는 `deps.ids.key()`로 key를 만들고 `policy.bridgeEnv(deps.env, { shim, socket, key })`가 null이면 null, 아니면 `{ key, env }`. 표에는 넣지 않는다. `bind(key, ref)`가 넣는다. `revoke(ref)`는 그 ref의 key를 모두 지운다.
   - `handleLine(line)`: `parseBridgeRequest` → null이면 `declined`. key가 표에 없으면 `declined`. `readPrefs()`로 `linkTarget`을 구해 `browser_tab`이 아니면(null 포함) `declined`. `browser_tab`이면 `offer(ref, url)`의 결과로 `pane` 또는 `declined`.
   - `offer(ref, url)`: `deps.ids.request()`로 request id를 만들고, 모든 shell 창에 `TERMINAL_BRIDGE_OPEN_CHANNEL`로 `{ request, terminal_ref: ref, url }`을 보낸다. `ack(request, true)`가 오면 true. `ACK_TIMEOUT_MS = 1500` 안에 오지 않으면 false(shim의 3000ms보다 짧아야 한다). 첫 true로 끝나고, 끝난 request의 늦은 ack는 버린다. `ack(request, false)`는 무시해도 된다(renderer는 연 때만 답한다).
   - `openLink({ terminal_ref, url })`: `isRelayableUrl`이 아니면 아무것도 안 한다. terminal이 bind된 것(표의 값에 있음)이 아니면(coding 탭 등) 바로 `deps.openExternal(url)`. 그렇지 않으면 `linkTarget`이 `browser_tab`일 때 `offer`가 true면 끝, 아니면 `deps.openExternal(url)`.
   - 요청을 거절한 이유를 log에 남기지 않는다(URL에 OAuth state가 들 수 있다). 남겨야 하면 origin과 path만(`external-link.ts`의 `externalLinkRecord`).
2. `bridge_test.ts`: socket 없이 fake deps(`windows`가 보낸 것을 모으고, `timers`를 손으로 돌린다)로 `handleLine`만 test한다. 셋: (a) 알 수 없는 key·bind되지 않은 key·버전이 틀린 줄은 `declined`이고 창에 아무것도 보내지 않는다, (b) 설정이 `system_browser`(web URL이면 `web_links`, `localhost` URL이면 `local_links`)이면 `declined`이고 창에 보내지 않는다, (c) `browser_tab`이면 창에 push가 나가고 `ack(request, true)`로 `pane`, ack가 없으면 timer가 돌아 `declined`이다. 이 셋이 key 검사와 "browser 탭으로 넘기는 조건"이라는 권한 경계를 지킨다.
3. `socket.ts`의 `listenBridge`: `node:net` unix socket 서버. 연결마다 `setTimeout(SOCKET_TIMEOUT_MS)`로 끊고, 받은 byte가 `MAX_REQUEST_BYTES`를 넘으면 끊고, 첫 개행까지를 한 줄로 `handleLine`에 넘기고, 답은 `{"result":"pane"|"declined"}` + 개행 한 줄로 `end`한다(`MAX_REPLY_BYTES` 이하). 연결마다 요청 하나다. listen 뒤 socket file을 `0600`으로 `chmod`한다. `stop()`은 서버를 닫는다. 실제 socket을 여는 test는 쓰지 않는다.
4. `wiring/bridge.ts`의 `createBridgeWiring(ctx)`:
   - `process.platform === "win32"`이면 `{ bridge: null, stop() {} }`.
   - `prepareRunDir`(bb-shim)에 `ctx.dataRoot`, `process.env`, `os.tmpdir()`, `process.getuid()`, `process.pid`, 진짜 fs, 진짜 `process.kill(pid, 0)` 검사를 넘기고, `writeShim`으로 `process.execPath`를 써 넣고, `listenBridge`를 연다. 어느 단계든 실패하면 `ctx.log`에 한 줄 남기고 `{ bridge: null, ... }`로 돌려준다(shell 탭은 지금처럼 OS browser를 쓴다). 앱이 실패 때문에 못 뜨면 안 된다.
   - `readPrefs`: `ctx.coreInternal("memory", "settings", "list", { keys: [두 key] })`의 결과 value를 `linkPrefsOf`에 넘긴다. 실패면 `linkPrefsOf(undefined)`(기본값). core 연결 전에도 던지지 않는다.
   - `windows`: `ctx.windows`에서 `isDestroyed()`가 아닌 창의 `webContents.send`. `openExternal`: `checkExternalUrl`을 통과한 URL만, `ctx.headless.headless`이면 아무것도 안 하고, 아니면 `shell.openExternal(url)`(실패는 `ctx.log`).
   - `stop()`은 서버를 닫고 run dir을 지운다. 둘 다 오류를 삼킨다.
5. `terminal/ipc.ts`: `createTerminalIpc`의 deps에 `bridge?: TerminalBridge`를 더한다.
   - `open`: `host.request` 전에 `deps.bridge?.issue()`를 부르고 null이 아니면 요청에 `env`를 싣는다. 답이 ok이면 `bridge.bind(issued.key, reply.runtime.terminal_ref)`.
   - `close`: 답이 ok이고 `runtime.state === "exited"`이면 `bridge?.revoke(value.terminal_ref)`.
   - 새 method `link`와 `bridgeAck`(`TerminalIpc` type에도): 둘 다 `checkCaller` 뒤 `checkInput`(`terminalLinkSchema`, `terminalBridgeAckSchema`). `link`는 `bridge?.openLink(...)`를 부르고 `{ ok: true, value: null }`, `bridgeAck`는 `bridge?.ack(request, opened)`. `focus`처럼 `guarded`를 쓰지 않고 직접 쓴다(`guarded`는 `TerminalReply` 전용이다).
6. `terminal/controller.ts`: `registerTerminalIpc`·`removeTerminalIpc`의 channel 목록에 `TERMINAL_LINK_CHANNEL` → `link`, `TERMINAL_BRIDGE_ACK_CHANNEL` → `bridgeAck`를 더한다(주석의 "채널 여덟 개"도 맞춘다).
7. `wiring/coding.ts`: `register(ctx)`에서 `createBridgeWiring(ctx)`를 `createTerminalIpc` 앞에서 부르고 `bridge`를 넘긴다. 반환 값의 `stop()`이 `bridge` wiring의 `stop()`도 부른다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "알 수 없는 key와 bind되지 않은 key는 browser 탭으로 아무것도 열지 못하고, 설정이 `system_browser`이면 `declined`이고, ack가 없으면 `declined`이다" (`bridge_test.ts`의 셋).
- 남지 않음: 없음(새 file과 새 method).
- 손으로(lead가 한다. worker는 하지 않는다): socket이 `0600`, 폴더가 `0700`인지, 앱을 끄면 폴더가 사라지는지, `gh auth login --web` 따위. README "손으로 확인".

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`desktop/main.ts`는 고치지 않았다)
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음". 알고 있는 것: host가 죽은 뒤 사람이 다시 시작한 shell(supervisor의 `reopenMessage`)은 env 없이 열려 bridge가 없다.
