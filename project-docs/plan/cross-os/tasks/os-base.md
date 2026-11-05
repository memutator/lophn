# os-base

OS마다 다른 순수 규칙을 `packages/base/os/`에 모으고(README 정한 것 3, 4, 7), Windows와 공백·한글 path에서 깨지는 `new URL(…, import.meta.url).pathname`을 모두 `fileURLToPath`로 바꾸고, `~/.lophn`을 찾는 곳이 Windows home을 쓰게 한다. wave 2 task 넷이 이 module을 쓴다.

- 단위: os (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/base/os/`(새로)
  - `packages/base/mod.ts`(export 줄만)
  - `tools/check-source.ts`(규칙 하나)
  - `packages/core/main/daemon/core.ts`, `packages/cli/main.ts`(home 해석 줄만)
  - 아래 할 일 2의 grep에 걸리는 packages와 tests/support의 file(그 줄과 import 줄만)
- 소유 밖(고치지 않는다): tools의 check·deps 도구와 shell main의 build.ts·package.json(`os-ci`의 것), tools/dev.ts(다른 계획의 `app-check`가 고치는 중), tools/package-linux.ts(`os-package`가 다시 쓴다).
- 읽을 것:
  - `AGENTS.md` "코드"(Clock·IdSource처럼 인자로 받는다, 전역 mutable 상태 없음)
  - `packages/core/supervision/responsiveness/group.ts`(지금 group 신호의 결과 꼴 `ok | absent | failed`. 이 task는 고치지 않는다. 새 함수가 같은 결과 꼴을 낸다)
  - `packages/core/apps/runtime/processes/socket-dir.ts`, `packages/protocol/apps/socket-slots.ts`(지금 socket 경로 꼴과 104 byte 검사. 이 task는 고치지 않는다)
  - `tools/check-deps.ts`의 package 의존 표(base는 아무것도 import하지 않는다)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것(`packages/base/os/mod.ts`, `packages/base/mod.ts`에서도 export):
    - `type OsPlatform = "linux" | "darwin" | "win32" | string`
    - `homeOf(env: Readonly<Record<string, string | undefined>>, platform: OsPlatform): string | undefined`: POSIX는 `HOME`, win32는 `USERPROFILE`, 없으면 `HOMEDRIVE`+`HOMEPATH`. 빈 값은 없음으로 친다.
    - `ipcPath(dir: string, name: string, platform: OsPlatform): string`: POSIX는 `<dir>/<name>.sock`, win32는 `\\.\pipe\lophn-<dir의 sha256 앞 16 hex>-<name>`. hash는 `packages/base/hash.ts`에 동기 함수가 없으면 `node:crypto` `createHash`를 쓴다(base가 이미 node 내장을 쓰는지 보고 맞춘다).
    - `ipcPathLimit(platform: OsPlatform): number`: linux 107, darwin 103(NUL 뺀 sun_path byte), win32 256.
    - `type TreeResult = "ok" | "absent" | "failed"`
    - `type TreeDeps = { kill(pid: number, signal: NodeJS.Signals | 0): void; run(command: string, args: string[]): Promise<{ code: number | null }> }`
    - `signalTree(pid: number, signal: "SIGTERM" | "SIGKILL", platform: OsPlatform, deps: TreeDeps): Promise<TreeResult>`: pid가 1 이하나 정수가 아니면 `failed`. POSIX는 `deps.kill(-pid, signal)`, 던진 error의 `code`가 `ESRCH`면 `absent`, 그 밖은 `failed`. win32는 신호와 상관없이 `deps.run("taskkill", ["/PID", String(pid), "/T", "/F"])`, code 0이면 `ok`, 128이면 `absent`, 그 밖은 `failed`.
    - `treeGone(pid: number, platform: OsPlatform, deps: Pick<TreeDeps, "kill">): boolean`: POSIX는 `kill(-pid, 0)`, win32는 `kill(pid, 0)`. `ESRCH`면 true, 성공이나 다른 error는 false.
    - `nodeTreeDeps(): TreeDeps`: `process.kill`과 `child_process.spawn`(shell 없이, stdio ignore, 1초 넘으면 끄고 `{code: null}`)로 만든 실제 deps. 조립하는 곳이 부른다.

## 할 일

1. `packages/base/os/`를 만든다: 위 계약의 함수들. file은 `home.ts`, `ipc.ts`, `tree.ts`, `mod.ts` 정도로 나눈다. `packages/base/mod.ts`에 export를 더한다.
2. `grep -rn "import.meta.url).pathname\|import\.meta\.url)\.pathname" packages tests/support --include=*.ts --include=*.tsx`(node_modules 빼고)에 걸리는 곳을 모두 `fileURLToPath(new URL(…, import.meta.url))`로 바꾼다. 조사로 확인한 core·sdk 쪽 자리(줄은 대략): `packages/core/apps/control.ts:867`, `packages/core/apps/releases/prepare/from-source.ts:141-143`, `packages/core/apps/packages/template/files.ts:13`, `packages/core/apps/packages/builtin.ts:195-198`(`file://${folder}/…`로 URL을 손으로 만드는 곳은 `pathToFileURL`), `packages/core/agent-workspaces/skills/root.ts:4`, `packages/core/main/daemon/wiring/{supervision.ts:97,sdk-install.ts:8,storage.ts:219}`, `packages/core/lophn-agent/register.ts:187`, `packages/core/main/app-supervisor/{release-runner.ts:21,data-runner.ts:9}`, `packages/core/supervision/security/node-shims.ts:13`, `packages/core/apps/runtime/observations/stack-frames.ts:270`, `packages/sdk/cap-fs/fs.ts:56`, `packages/sdk/flow/entry.ts:40`(`"file://" + path.split("/")…`는 `pathToFileURL`). tests: `tests/support/core/process.ts:21`, `tests/support/app/{deps.ts:7,prepare-deps.ts:24,source.ts:53}`. shell 쪽도 grep으로 찾는다. `.pathname`을 path가 아니라 URL로 쓰는 곳(HTTP route)은 그대로 둔다.
3. `~/.lophn`을 찾는 곳을 `homeOf(env, process.platform)`로 바꾼다: `packages/core/main/daemon/core.ts:98` 근처, `packages/cli/main.ts:73`과 `:106` 근처. path는 `node:path` `join`으로 잇는다. child env에 HOME을 넘기는 목록(`supervision.ts`, `app-supervisor/main.ts`, `data-runner.ts` 등)은 `os-process`의 일이라 건드리지 않는다.
4. `tools/check-source.ts`에 규칙 하나: `packages/` 아래 `.ts`·`.tsx`(test 포함)에서 `import.meta.url).pathname`을 금지하고 "fileURLToPath를 쓴다"를 낸다. 기존 규칙 표 꼴을 따른다. `tools/`·`tests/`는 이 규칙 밖이다.

## 끝남

- `npm run check:full`이 통과한다. `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다.
- 위험 test: "`signalTree`가 POSIX에서 `-pid`로 보내고 ESRCH를 `absent`로, win32에서 taskkill code 128을 `absent`로 센다(가짜 deps)" 하나. `packages/base/os/tree_test.ts`.
- 남지 않음: `grep -rn "import.meta.url).pathname" packages tests/support`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
