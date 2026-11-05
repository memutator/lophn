# os-process

core의 process 제어와 IPC를 세 OS에서 돌게 한다(README 정한 것 4, 7, 8). 지금은 Linux 전용 fail-closed 검사 때문에 macOS·Windows에서 core가 child를 하나도 못 띄운다(platform/io, agent runtime, apps supervisor, flow가 다 막힌다).

- 단위: os (wave 2)
- 선행: os-base. wave 1이 merge된 plan branch에서 시작한다.
- 소유(이 task만 고친다):
  - `packages/core/supervision/`
  - `packages/core/main/app-supervisor/`
  - `packages/core/main/flow-host/{host.ts,check.ts,channel.ts}`
  - `packages/core/main/daemon/main.ts`, `packages/core/main/daemon/core.ts`, `packages/core/main/agent-runtime/main.ts`
  - `packages/core/main/daemon/wiring/supervision.ts`
  - `packages/core/diagnostics/snapshot.ts`
  - `packages/core/apps/runtime/`
  - `packages/core/apps/releases/prepare/environment.ts`
  - `packages/core/apps/declaration/{extract.ts,check.ts}`
  - `packages/core/apps/registration/source-folder.ts`
  - `packages/core/apps/packages/template/scaffold.ts`
  - `packages/core/apps/permissions/broker/server.ts`
  - `packages/core/server/serve.ts`
  - `packages/core/lophn-agent/tools/shell/`, `packages/core/lophn-agent/tools/bundles/shell.ts`
  - `packages/core/lophn-agent/extensions/adapters/mcp-stdio.ts`
  - `packages/protocol/apps/{socket-slots.ts,app-start.ts}`
- 소유 밖: 봉인·data root·symlink·권한 path는 `os-fs`, shell·coding-agent는 `os-shell`의 것이다. `packages/core/apps/releases/prepare/from-source.ts`의 kill 한 줄도 `os-fs`가 고친다.
- 읽을 것:
  - `packages/base/os/`(wave 1이 만든 `signalTree`, `treeGone`, `nodeTreeDeps`, `ipcPath`, `ipcPathLimit`, `homeOf`)
  - `packages/core/supervision/responsiveness/{group.ts,process.ts,supervisor.ts}`: `KILL_UTILITY="/usr/bin/kill"`, `supportsProcessGroupEnforcement(os) === "linux"`, `checkKillAdapter()`가 false면 supervisor `start()`가 모두 UNAVAILABLE, `process.ts:46-56`이 Linux 밖에서 spawn을 던진다.
  - `project-docs/architecture/layers.md`, `job.md`, `run.md`의 supervision·app process 절(어떤 child가 어떤 신호로 끝나는가)
- 계약:
  - 쓰는 것: `packages/base/os/`
  - 내놓는 것: 없음(내부 구현). socket 경로의 꼴이 바뀌는 `packages/protocol/apps/socket-slots.ts`는 이 task가 쓰는 쪽까지 같이 고친다.

## 할 일

1. supervision(정한 것 4):
   - `group.ts`: `/usr/bin/kill` adapter(`runKillUtility`, `NO_SUCH_PROCESS`, `ADAPTER_*`)를 지우고 `signalGroup`·`confirmGroupGone`을 `signalTree`·`treeGone`(platform과 deps를 받는다)으로 옮긴다. `GROUP_CONFIRM_MS`와 poll은 그대로. `supportsProcessGroupEnforcement`와 `checkKillAdapter`는 지우고 supervisor의 시작 검사도 지운다.
   - `process.ts:46-56`: Linux 밖에서 던지는 것을 지운다. `detached: true`는 POSIX에서만(Windows의 `detached`는 새 console을 연다), Windows는 `windowsHide: true`.
   - supervisor가 "group이 없어졌음을 확인한 뒤 자원을 푼다"는 뜻은 그대로다.
2. kill 자리: tree를 남기는 `child.kill("SIGKILL")`을 `signalTree(child.pid, "SIGKILL", platform, deps)`로 바꾼다. 자리: `main/app-supervisor/release-runner.ts:50`, `main/app-supervisor/data-runner.ts:43`, `apps/declaration/extract.ts:78,101,135`, `lophn-agent/extensions/adapters/mcp-stdio.ts:159,170`, `main/flow-host/check.ts:97`(SIGTERM), `apps/packages/template/scaffold.ts:130`(`killSignal`). 이 자리의 child가 `detached`가 아니면(POSIX에서 group leader가 아니면) `-pid`가 없는 group이라 `absent`가 나온다. 그 자리는 spawn에 `detached`(POSIX)를 더하거나, group이 아닌 것을 알고 `child.kill`을 남긴다. 어느 쪽인지 자리마다 보고한다.
3. signal: `main/daemon/main.ts:50-51`, `main/app-supervisor/main.ts:198-199`, `main/agent-runtime/main.ts:525-526`의 SIGINT·SIGTERM은 Windows에서 Electron main의 `kill()`로 오지 않는다. 그쪽 끝남은 stdin EOF와 stop 메시지로 이미 되는지 확인하고, 안 되면 stdin `end`에도 같은 정리를 건다. `diagnostics/snapshot.ts:135`·`core.ts:419`의 SIGUSR2는 win32에서 걸지 않는다.
4. RSS: `apps/runtime/observations/memory.ts:64-68` `procRssReader`는 Linux `/proc`만 읽고 다른 OS는 `undefined`(85% watchdog이 조용히 꺼진다). macOS는 `ps -o rss= -p <pid>`, Windows는 지금처럼 `undefined`로 두고 그 사실을 보고의 "알려진 미완 동작"에 적는다. reader는 platform과 spawn을 인자로 받는다.
5. node shim(`supervision/security/node-shims.ts`, `node-command.ts`): `run/bin/node`·`npm`의 `#!/bin/sh` script를 win32에서는 `node.cmd`·`npm.cmd`(`@"<execPath>" …` 꼴, `ELECTRON_RUN_AS_NODE=1` set)로 쓴다. PATH는 `node:path` `delimiter`로 잇는다. `launch-spec.ts:28` `entry.startsWith("/")`는 `isAbsolute`로.
6. child env: `apps/releases/prepare/environment.ts:9-16`, `main/app-supervisor/release-runner.ts:32`, `main/app-supervisor/main.ts:77`, `main/daemon/wiring/supervision.ts:40,43`, `lophn-agent/tools/shell/env.ts:7-16`의 env 목록에 win32일 때 `SystemRoot`, `ComSpec`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, `TMP`, `Path`(Windows env 이름은 대소문자를 안 가린다. 읽을 때 가리지 않고 찾는다)를 더한다. `TMPDIR ?? "/tmp"`는 `os.tmpdir()`(조립에서 받은 값)로. `apps/registration/source-folder.ts:43` `GIT_CONFIG_GLOBAL: "/dev/null"`은 win32에서 `NUL`.
7. IPC(정한 것 7): `apps/runtime/processes/socket-dir.ts:46-60`(`XDG_RUNTIME_DIR`, `TMPDIR`, `getuid?.() ?? 0`), `protocol/apps/socket-slots.ts:7-13`(`${dir}/b${slot}.sock`), `main/app-supervisor/main.ts:70-99`(`workspaceOf`, `socketPathsOf`, 낡은 socket `rmSync`)를 `ipcPath`로 바꾼다. win32는 socket directory를 만들지 않고 pipe 이름만 낸다(낡은 pipe를 지울 일이 없다). 길이 검사(`apps/runtime/entrypoint/limits.ts:29` `SOCKET_PATH_MAX_BYTES`, `wire-check.ts:93`, `protocol/apps/app-start.ts`)는 `ipcPathLimit(platform)`. `server/serve.ts:76-79,211`, `apps/runtime/entrypoint/{http.ts:34,main.ts:192-245}`, `main/app-supervisor/control-http.ts:15,80`, `apps/permissions/broker/server.ts:217`은 경로 문자열만 받으면 된다. 확인만 하고 고칠 것이 있으면 고친다.
8. agent shell tool(정한 것 8): `lophn-agent/tools/shell/run.ts`
   - `:109` `spawn("/bin/sh", ["-c", LAUNCH, "sh", command])`와 `:18-19` `LAUNCH`(`command -v setsid … exec setsid`)를 지운다. POSIX는 `spawn("/bin/sh", ["-c", command], { detached: true })`(Node가 setsid한다), win32는 Git Bash `bash.exe`로 `["-c", command]`, `windowsHide: true`.
   - Git Bash 찾기: env `LOPHN_GIT_BASH`가 있으면 그것, 없으면 `%ProgramFiles%\Git\bin\bash.exe`, `%ProgramFiles(x86)%\Git\bin\bash.exe`, `%LOCALAPPDATA%\Programs\Git\bin\bash.exe` 차례. 못 찾으면 tool 결과가 `unavailable`이고 글은 "Windows의 shell tool은 Git for Windows(bash)가 필요하다. 설치하거나 LOPHN_GIT_BASH에 bash.exe 경로를 둔다". 찾기는 fs와 env를 인자로 받는다.
   - `:82-92` `killGroup`(`/usr/bin/kill -KILL -- -pid`)은 `signalTree`.
   - `tools/bundles/shell.ts:34` 설명의 "with /bin/sh"는 "POSIX sh(Windows는 Git Bash)"로.
   - `classify.ts`·`protocol/approvals/shell-rules.ts`는 고치지 않는다(bash라 규칙이 그대로 맞다).

## 끝남

- `npm run check:full`이 통과한다. `project-docs/plan/tools/lead/boot.sh`와 `node tools/ci/boot-core.ts`가 Linux에서 통과한다.
- Linux 동작이 바뀌지 않는다: 앱 하나를 띄우고 끄는 기존 test(`packages/core/apps`, `packages/core/supervision`의 test)가 통과한다.
- 위험 test: "Windows에서 Git Bash를 못 찾으면 shell tool이 `unavailable`로 끝나고 아무것도 띄우지 않는다(가짜 fs·env)" 하나. 그 밖의 kill·group 규칙은 `packages/base/os/tree_test.ts`가 본다.
- 남지 않음: `grep -rn "/usr/bin/kill\|supportsProcessGroupEnforcement\|checkKillAdapter\|setsid" packages/core`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 할 일 2의 자리마다 tree 신호로 바꿨는지, `child.kill`을 남겼는지와 그 이유를 적는다.
