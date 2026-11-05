# os-fix-cli-path

packaged macOS·Windows에서 harness agent와 lophn 터미널이 `lophn` CLI를 찾게 한다. Linux는 `/usr/bin/lophn`이 PATH에 있어 그대로 되지만 macOS·Windows는 CLI가 앱 안(`packagedInstall(...).cli`)에만 있고 PATH에 없다.

- 단위: os (wave 3)
- 선행: os-package
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness/host.ts`
  - `packages/shell/main/desktop/wiring/agent.ts`
  - `packages/shell/terminal-host/env.ts`(터미널 PATH에 CLI 폴더를 더하는 줄만, 필요할 때만)
- 읽을 것:
  - `packages/shell/main/desktop/paths.ts` `packagedInstall(resourcesPath, platform)`(`cli`: linux `/usr/bin/lophn`, darwin `<Resources>/bin/lophn`, win32 `<설치 root>\bin\lophn.cmd`)
  - `packages/shell/main/desktop/wiring/coding.ts:98-110`(packaged·개발에서 CLI 경로를 고르는 지금 방식)
  - `packages/shell/main/extensions/bundled/harness/host.ts:42-50` `harnessEnv`: 개발 실행의 `LOPHN_CLI` 폴더를 PATH 앞에 둔다. `cli.startsWith("/")`, `lastIndexOf("/")`, `:`로 잇는다.
  - `packages/shell/main/desktop/wiring/agent.ts:255-265`: 터미널 `gui` 함수에 넣는 CLI 경로. `LOPHN_CLI`가 없으면 `"lophn"`.
  - `project-docs/architecture/terminal-agent.md`, `harness-gui.md`(터미널 env, CLI 환경)
- 계약:
  - 쓰는 것: `packagedInstall`의 `cli`
  - 내놓는 것: 없음

## 할 일

1. CLI 경로 하나를 고르는 규칙을 한 곳에 둔다: 개발은 `LOPHN_CLI`(절대 경로일 때), packaged는 `packagedInstall(process.resourcesPath).cli`. `coding.ts`에 이미 같은 규칙이 있으면 그것을 export해 쓰고(`coding.ts`는 export 한 줄만 고친다. 소유 밖이면 보고) 사본을 만들지 않는다.
2. `harnessEnv`: 그 CLI의 폴더(`dirname`)를 PATH 앞에 `node:path` `delimiter`로 둔다. Linux packaged(`/usr/bin`)는 이미 PATH에 있으니 그대로 둬도 된다. Windows env 이름이 `Path`일 수 있으니 대소문자를 가리지 않고 읽는다.
3. 터미널: packaged macOS·Windows의 lophn 터미널에서 `lophn`이 쳐지게 CLI 폴더를 터미널 env의 PATH 앞에 둔다(터미널 env를 만드는 곳이 `terminal-host/env.ts`인지 `wiring/agent.ts`인지 코드로 보고 한 곳만). macOS의 launcher 이름은 `lophn`, Windows는 `lophn.cmd`라 PATH에 폴더만 있으면 된다.
4. `agent.ts`의 `gui` 함수 CLI 경로도 1의 규칙을 쓴다.

## 끝남

- `npm run check:full`이 통과한다. `node packages/shell/renderer/build.ts`가 된다. `project-docs/plan/tools/lead/boot.sh`가 통과한다.
- Linux 개발 실행(`LOPHN_CLI`)과 Linux packaged 동작이 바뀌지 않는다.
- 위험 test: 없음.
- 남지 않음: `grep -n 'startsWith("/")' packages/shell/main/extensions/bundled/harness/host.ts`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
