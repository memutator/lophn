# bb-shim

앱이 켜질 때마다 만드는 per-run 폴더(`0700`)와 그 안의 `$BROWSER` shim 두 file(sh 하나, JS 하나)을 만든다. shim은 URL 하나를 받아 bridge socket에 묻고, `pane` 답이 아니면 OS opener(`xdg-open`, `open`)로 연다. Electron을 node로 띄워(`ELECTRON_RUN_AS_NODE=1`, terminal host와 같은 방식) 사용자 PATH의 `node`를 기대하지 않는다. shim은 설치 묶음에 file로 싣지 않고 main이 폴더에 써 넣는다(sh에 실행 file 경로 `process.execPath`를 박아야 하고, packaged와 dev에서 그 경로가 다르므로).

- 단위: bb-shim (wave 2)
- 선행: bb-policy
- 소유(이 task만 고친다):
  - `packages/shell/main/browser-bridge/run-dir.ts`
  - `packages/shell/main/browser-bridge/shim.ts`
- 읽을 것:
  - 계획: `project-docs/plan/browser-bridge/README.md`("정한 것": 폴더 자리, shim 두 file)
  - 제품 결정: `project-docs/products/roadmap/browser-tab.md`의 "무엇을 만드나" 2(shim)
  - 가져올 동작(코드를 복사하지 않고 계약만 따른다): `../rea/project/desktop-embeded-browser/src/shim/browser-shim.js`(opener로 넘길 때 bridge env를 지운다, 마지막 인자가 URL, 종료 코드 4)
  - 본보기(socket 자리): `packages/core/apps/runtime/processes/socket-dir.ts`(`createSocketDirectory`, `socketRootKey`, `SOCKET_PATH_MAX_BYTES`. shell은 core를 import하지 못하므로 같은 규칙을 여기 따로 쓴다)
  - 본보기(Electron을 node로): `packages/shell/main/terminal/supervisor.ts`의 `spawnNodeHost`
  - 이 task가 쓰는 것: bb-policy(`BRIDGE_ENV`, `BRIDGE_KEY_PATTERN`, `MAX_REQUEST_BYTES`, `MAX_REPLY_BYTES`, `SOCKET_TIMEOUT_MS`)
- 계약:
  - 쓰는 것: `policy.ts`의 상수.
  - 내놓는 것(다른 task가 이 이름으로 부른다):
    - `run-dir.ts`: `prepareRunDir(deps): RunDirResult`
      ```ts
      type RunDirDeps = {
        dataRoot: string;
        env: Readonly<Record<string, string | undefined>>; // XDG_RUNTIME_DIR만 읽는다
        tmpdir: string;
        uid: number;
        pid: number;
        fs: {
          mkdir(path: string, mode: number): void;     // recursive
          chmod(path: string, mode: number): void;
          list(path: string): string[];                 // 없으면 []
          remove(path: string): void;                   // recursive, force
        };
        isAlive(pid: number): boolean;
      };
      type RunDirResult =
        | { ok: true; value: { dir: string; socket: string; shim: string; script: string } }
        | { ok: false; error: { code: "invalid_input" | "unavailable"; message: string } };
      ```
      `shim`은 sh file(`BROWSER`가 되는 것), `script`는 그 sh가 Electron으로 돌리는 JS file의 경로다. 두 file을 쓰는 일은 아래 `writeShim`이 한다.
    - `shim.ts`: `writeShim(deps: { write(path: string, text: string, mode: number): void }, paths: { shim: string; script: string }, execPath: string): void`. sh에는 `execPath`를 single quote로 안전하게 쓴다.

## 할 일

1. `run-dir.ts`의 `prepareRunDir`: 
   - 바탕 폴더는 `env.XDG_RUNTIME_DIR`가 비지 않았으면 `<XDG_RUNTIME_DIR>/lophn`, 아니면 `<tmpdir>/lophn-<uid>`. 그 아래 `<dataRoot의 sha256 앞 12자리 hex>`(core의 `socketRootKey`와 같은 값), 그 아래 이번 실행의 폴더 `shell-<pid>`가 `dir`이다. `socket`은 `<dir>/b.sock`, `shim`은 `<dir>/browser`, `script`는 `<dir>/browser.js`.
   - 경로(특히 socket)가 104 byte(UTF-8) 이상이면 `invalid_input`으로 돌려준다(`sun_path` 한도. TCP로 바꾸지 않는다). 폴더는 만들지 않는다.
   - 폴더는 `0700`으로 만든다(`mkdir` 뒤 `chmod`로 umask를 이긴다). 만들지 못하면 `unavailable`.
   - 시작할 때 `<dataRoot 키 폴더>` 안의 `shell-<숫자>` 항목 중 내 pid가 아니고 `isAlive`가 false인 것을 지운다(앱이 죽어 남은 것). 다른 이름의 항목(core의 socket 폴더 등)은 건드리지 않는다.
2. `shim.ts`:
   - `shimSources(paths, execPath): { sh: string; script: string }`을 순수 함수로 두고 `writeShim`이 쓴다. `sh`는 `#!/bin/sh`로 시작해 `ELECTRON_RUN_AS_NODE=1 exec '<execPath>' '<script 경로>' "$@"` 한 줄이다. 경로의 `'`는 `'\''`로 바꾼다. `sh`는 `0700`, `script`는 `0600`으로 쓴다.
   - `script`(JS 본문)의 동작. CommonJS, 의존성은 `node:net`·`node:child_process`뿐이다.
     1. 마지막 인자를 URL로 본다. 인자가 없으면 아무것도 안 하고 exit 0.
     2. `process.env[BRIDGE_ENV]`를 JSON으로 읽어 `socket`(비지 않은 string)과 `key`(`BRIDGE_KEY_PATTERN`)가 있으면 bridge 설정이다. 아니면 설정 없음.
     3. 설정이 있고 URL이 relayable이면 socket에 연결해 `{"v":1,"key":<key>,"url":<url>}` + 개행 한 줄을 보내고 개행이 올 때까지 답을 읽는다(답 1024 byte 초과, 연결 오류, 연결이 먼저 닫힘, 3000ms 초과는 모두 실패). 답이 `{"result":"pane"}`이면 exit 0. 그 밖(`declined`, 실패)은 다음 단계(OS opener)로 간다. relayable의 뜻은 `policy.ts`의 `isRelayableUrl`과 같다: 절대 http/https, userinfo 없음, 8192자 이하(JS 본문 안에 같은 검사를 따로 쓴다. main이 다시 검사하므로 이쪽은 쓸데없는 접속을 줄이는 용도다).
     4. OS opener: darwin은 `open <인자>`, 그 밖은 `xdg-open <인자>`(받은 마지막 인자 그대로). 자식 env는 `process.env`에서 `BROWSER`, `BRIDGE_ENV`, `ELECTRON_RUN_AS_NODE`를 뺀 것이다(빼지 않으면 `xdg-open`이 `$BROWSER`인 이 shim을 다시 부르거나, opener가 Electron 앱일 때 node처럼 뜬다). `detached`, `stdio: "ignore"`로 띄우고, 종료 코드 0이면 exit 0. 띄우지 못했거나 0이 아니면 exit 4. 3000ms 안에 끝나지 않으면 GUI opener가 남아 있는 것이므로 exit 0.
     5. 어떤 경우에도 URL이나 key를 stdout/stderr에 쓰지 않는다.
   - `BRIDGE_ENV` 이름과 상수는 `policy.ts`에서 가져와 본문 문자열에 끼워 넣는다(이름을 두 곳에 손으로 적지 않는다).
3. 손으로 확인한다(test file을 남기지 않는다). scratchpad에서 Node로 임시 unix socket 서버를 띄워 `script`를 `node`로 돌려 본다: `pane` 답이면 exit 0, `declined`이면 opener로 간 것, 서버가 없으면 opener로 간 것, userinfo가 든 URL은 접속 없이 opener로 간 것, opener는 PATH 앞에 가짜 `xdg-open`을 둬서 인자와 env(`BROWSER`·`BRIDGE_ENV`·`ELECTRON_RUN_AS_NODE`가 없는지)를 기록해 확인한다. 이 확인은 subprocess를 띄우므로 file로 남기지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(소유 path에 test를 남기지 않는다. socket이나 subprocess를 띄우는 test는 사람에게 묻기 전에는 새로 만들지 않는다. 판정 함수는 `bb-policy`가 test한다).
- 남지 않음: 없음(새 file).

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
