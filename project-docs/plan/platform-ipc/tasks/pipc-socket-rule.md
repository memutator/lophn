# pipc-socket-rule

socket 자리 규칙을 base의 순수 함수로 뽑고 core가 그것을 쓰게 한다. shell 사용자는 다음 task에서 옮기므로 이번에는 기존 shell과 Windows gate를 건드리지 않는다.

- 단위: pipc-socket (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/base/os/socket-dir.ts` (새 file)
  - `packages/base/os/socket-dir_test.ts` (새 file)
  - `packages/base/os/mod.ts`
  - `packages/base/mod.ts`
  - `packages/core/apps/runtime/processes/socket-dir.ts`
- 읽을 것:
  - 계획: `project-docs/plan/platform-ipc/README.md`, `project-docs/products/roadmap/platform-ipc.md`
  - architecture: `project-docs/architecture/platform.md`의 OS 규칙·앱 IPC·불변 조건
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `base`·`apps`, `project-docs/module-catalog.yaml`의 `packages/base`·`packages/core/apps`
  - 규칙: `tools/check-deps.ts`의 `PACKAGE_DEPENDENCIES`와 `portable-import`, `.claude/skills/write-test/SKILL.md`
  - 사용자: `packages/core/main/app-supervisor/main.ts`의 `workspaceOf`, `packages/core/apps/runtime/processes/mod.ts`
  - 기존 규칙: `packages/base/os/ipc.ts`, `packages/protocol/apps/socket-slots.ts`, `packages/shell/main/browser-bridge/run-dir.ts`
- 계약:
  - 쓰는 것: 기존 `ipcPath(dir, name, platform)`·`ipcPathLimit(platform)`과 `APP_SOCKET_SLOTS`, `appBrokerSocketPath`·`appDirectSocketPath`를 바꾸지 않는다.
  - 내놓는 것: `packages/base/os/socket-dir.ts`의 `socketDirectoryPath(deps)`를 `os/mod.ts`·`base/mod.ts`로 export한다. 입력은 `{ dataRoot: string; xdgRuntimeDir: string | undefined; tempParent: string; uid: number; platform: OsPlatform; hash(text: string): string }`, 결과는 base의 `Result<string, { code: "invalid_input"; message: string }>`다. `hash`는 동기 SHA-256 hex를 돌려주며 앞 12자를 고르는 것은 이 함수 한 곳이다.
  - 내놓는 것: POSIX 결과는 `XDG_RUNTIME_DIR/lophn/<key>` 또는 `<tempParent>/lophn-<uid>/<key>`, win32 결과는 file 폴더가 아닌 pipe namespace용 `dataRoot`다. uid 검사는 POSIX만 한다. 이 함수는 FS·process 전역을 읽지 않는다.
  - 유지하는 것: core의 `createSocketDirectory`·`slotSockets`·`SOCKET_SLOTS` 공개 모양은 유지한다. core wrapper가 Node hash와 FS를 연결하고 POSIX 0700 폴더를 만든다. 다음 task는 base 함수만 import하며 core는 import하지 않는다.

## 할 일

1. `packages/core/apps/runtime/processes/socket-dir.ts:35-64`의 SHA-256 key·XDG/tmp·uid·win32 분기를 위 순수 함수로 모은다. `packages/base/os/ipc.ts`의 FNV pipe hash로 POSIX key까지 바꾸지 않는다. 근거는 platform의 OS 규칙 자리와 계획의 기존 경로 유지 결정이다.
2. core `createSocketDirectory`는 새 함수를 먼저 부르고, 성공한 POSIX 경로만 기존 `ensureDir(directory, 0o700)`로 만든다. `platform ?? process.platform`과 `createHash("sha256")`는 Node인 core wrapper에 둔다. `workspaceOf` 호출과 `processes/mod.ts` export가 그대로 type check되게 한다.
3. core가 새 함수를 쓰게 된 뒤 기존 private `socketRootKey`와 중복 자리 계산을 지운다. `slotSockets`의 slot 판정과 UTF-8 byte `> ipcPathLimit(platform)` 검사는 앱 socket 경계이므로 남긴다. 실제 길이 검사는 `createSocketDirectory`가 아니라 `slotSockets`에 있다.
4. 위험 test 하나로 data root가 다른 실행이 같은 socket namespace를 쓰지 않는다는 규칙을 표로 본다(POSIX XDG/tmp, win32, POSIX 잘못된 uid). 주입한 hash로 순수 함수를 실행하고 결과 경로·거절을 본다. 새 process·서버나 소스 글 검사는 만들지 않는다.
5. 작업 중 바꾼 test만 돌리고 끝에 `npm run check`를 돌린다. shell의 중복 규칙은 다음 task가 옮길 때까지 남긴다. 정의부터 지워 다른 사용자를 깨지 않는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "data root가 다른 실행은 같은 socket namespace를 쓰지 않는다"가 순수 unit test로 통과한다.
- 앱 socket 경로와 slot 수, POSIX 0700 준비, Windows에서 폴더를 만들지 않는 동작이 바뀌지 않는다.
- 새 base 함수는 Node import와 runtime OS 전역이 없고, shell→core import 예외를 더하지 않는다.
- 남지 않음: core `socket-dir.ts`에 기존 private `socketRootKey`와 자리 규칙 사본이 없다. shell의 사본은 아직 이 task의 삭제 대상이 아니다.

## 사람에게 물을 것

- 없음. subprocess·서버·브라우저·E2E test를 새로 만들 필요가 생기면 만들기 전에 사람에게 묻는다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 보고 꼴을 따른다. 등록할 것, 안 쓰게 된 export, 계약 바꾸기 요청, 무겁게 짠 것, 알려진 미완 동작을 빼지 않는다.
