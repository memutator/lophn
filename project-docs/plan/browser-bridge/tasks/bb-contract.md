# bb-contract

terminal에 bridge를 잇는 경계를 고정한다. (1) renderer ↔ main: terminal link를 누른 일(`openLink`), main이 "이 URL을 browser 탭으로 열어 달라"고 push하는 일(`onBridgeOpen`)과 renderer의 응답(`ackBridgeOpen`). (2) main ↔ terminal host: `open` 요청에 env를 더해 host가 shell에 넣고 다시 시작해도 같은 값을 쓰게 한다. (3) main 안: terminal IPC가 bridge를 부르는 모양(`TerminalBridge`). 구현(socket 서버, IPC handler, renderer)은 wave 2의 다른 task가 한다.

- 단위: bb-contract (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/ipc/terminal.ts`
  - `packages/shell/preload/terminal-api.ts`
  - `packages/shell/terminal-host/main.ts`
  - `packages/shell/main/browser-bridge/types.ts`
  - `tools/wireframes/mock/fake-terminal.ts`
  - `tools/wireframes/mock/app-space/coding-terminal.ts`
- 읽을 것:
  - 계획: `project-docs/plan/browser-bridge/README.md`("정한 것": 흐름, 왜 ack를 두는가)
  - architecture: `project-docs/architecture/coding-agent.md`(terminal 탭)
  - 본보기(계약): `packages/shell/ipc/terminal.ts`(`terminalFocusSchema`, `TerminalApi.onRuntime`, `TERMINAL_STATE_CHANNEL`), `packages/shell/preload/terminal-api.ts`(`onRuntime`의 `isRuntime`), `packages/shell/terminal-host/main.ts`(`HostRequest`, `Session`, `start`, `restart`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/ipc`, `packages/shell/terminal-host`
- 계약:
  - 쓰는 것: 없음.
  - 내놓는 것:
    - `ipc/terminal.ts`: channel `TERMINAL_LINK_CHANNEL = "shell:terminal-link"`(invoke), `TERMINAL_BRIDGE_ACK_CHANNEL = "shell:terminal-bridge-ack"`(invoke), `TERMINAL_BRIDGE_OPEN_CHANNEL = "shell:terminal-bridge-open"`(main → renderer push). schema `terminalLinkSchema = { terminal_ref, url: string max 8192 }`(strict), `terminalBridgeAckSchema = { request: string 1..64, opened: boolean }`(strict). type `TerminalLink`, `TerminalBridgeAck`, `TerminalBridgeOpen = { request: string; terminal_ref: string; url: string }`.
    - `TerminalApi`의 새 member: `openLink(input: TerminalLink): Promise<TerminalCall<null>>`, `ackBridgeOpen(input: TerminalBridgeAck): Promise<TerminalCall<null>>`, `onBridgeOpen(listener: (open: TerminalBridgeOpen) => void): () => void`.
    - `HostRequest`의 `open`에 선택 칸 `env?: Record<string, string>`.
    - `main/browser-bridge/types.ts`:
      ```ts
      export interface TerminalBridge {
        /** 새 shell에 줄 env. bridge가 꺼졌거나 사용자가 BROWSER를 두었으면 null. 이 호출은 key를 만들 뿐 표에 넣지 않는다. */
        issue(): { key: string; env: Record<string, string> } | null;
        /** open이 성공한 뒤 key를 그 terminal에 묶는다. 묶이지 않은 key의 요청은 declined다. */
        bind(key: string, terminalRef: string): void;
        /** 탭을 닫아 terminal이 끝났다. 그 terminal의 key를 버린다. */
        revoke(terminalRef: string): void;
        /** terminal에서 Ctrl/Cmd-click한 link. 설정에 따라 browser 탭 또는 OS browser로 연다. */
        openLink(input: { terminal_ref: string; url: string }): Promise<void>;
        /** renderer가 bridge push를 받아 browser 탭을 열었다고 답했다. */
        ack(request: string, opened: boolean): void;
      }
      ```

## 할 일

1. `ipc/terminal.ts`: 위 channel, schema, type, `TerminalApi` member를 더한다(`ref` 규칙은 기존 `ref`를 쓴다). 옛 것은 건드리지 않는다.
2. `preload/terminal-api.ts`: `openLink`·`ackBridgeOpen`은 `invoke`, `onBridgeOpen`은 `onRuntime`처럼 `transport.on`으로 듣고 모양(`request`·`terminal_ref`·`url`이 모두 string)만 확인한 뒤 listener를 부른다. 해지 함수를 돌려준다.
3. `terminal-host/main.ts`: `HostRequest`의 `open`에 `env?`를 더하고 `Session`에 `env`를 보관한다. `start(previous, request)`는 shell env를 `{ ...stripPlatformEnv(deps.env), ...(request.env ?? previous?.env) }`로 만든다(strip이 끝난 뒤에 덮어야 `LPN_` 값이 지워지지 않는다. `stripPlatformEnv`는 `LOPHN_`·`ELECTRON_` 이름과 `127.0.0.1:<port>`가 든 값을 뺀다). `restart()`가 같은 `terminal_ref`로 `start`를 부를 때도 같은 env가 따라가야 한다. `open-coding`은 건드리지 않는다.
4. `main/browser-bridge/types.ts`: 위 `TerminalBridge`를 그대로 둔다.
5. 쓰는 쪽을 같은 변경에서 맞춘다: `tools/wireframes/mock/fake-terminal.ts`의 `fakeTerminal`과 `tools/wireframes/mock/app-space/coding-terminal.ts`의 `CodingBridge`가 `TerminalApi`를 채우므로 새 member 셋을 아무것도 안 하는 구현으로 더한다(`openLink`·`ackBridgeOpen`은 `ok(null)`, `onBridgeOpen`은 `() => () => {}`).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(계약과 값 전달뿐이다. 판정은 `bb-policy`, 권한 경계의 test는 `bb-server`가 쓴다).
- 남지 않음: `grep -rn "TerminalApi" packages tools --include=*.ts --include=*.tsx`의 구현체(`createTerminalApi`, `fakeTerminal`, `CodingBridge`)가 모두 새 member 셋을 가진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
