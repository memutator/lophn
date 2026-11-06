# Windows 확인 handoff

Windows(듀얼부팅, x64)에서 도는 session이 읽는다. Linux session이 2026-11-06에 썼다.

## 왜

cross-os 계획이 main `d5e3aaac8`에 land되었다. macOS·Windows에서 build·기동·설치가 되도록 코드를 바꿨지만 **Linux에서만 돌려 봤다**. Windows용 동작은 코드와 `platform: "win32"`를 넘긴 unit test로만 확인했고, 실제 Windows에서는 한 번도 돌지 않았다. CI(`.github/workflows/os.yml`)도 돌리지 않았다.

이 session의 일: 실제 Windows에서 CI와 같은 단계, e2e, 손으로 하는 확인을 돌리고, 깨진 것을 고치고, 결과를 이 file 끝에 적는다.

먼저 읽을 것:
- `AGENTS.md`: 저장소 규칙. 아래 "지킬 것"은 그중 이 일에 걸리는 것이다.
- `project-docs/architecture/platform.md`: OS마다 무엇이 다른가, Windows에서 꺼진 기능 표.

## 지킬 것

- push, force push, 실제 model provider 호출은 사람에게 묻는다. 개발은 `npm run dev`가 붙이는 fake provider로 한다.
- `%USERPROFILE%\.lophn`을 만들거나 건드리기 전에 묻는다. 개발은 `.dev-data/`에 쓰고, 설치본은 `--home <임시 폴더>`나 `LOPHN_HOME`으로 띄운다.
- Linux 동작을 바꾸지 않는다. 여기서는 Linux check를 돌릴 수 없으니 Linux가 지나는 길은 건드리지 않는다.
- OS마다 다른 규칙은 `packages/base/os/`에 두고 platform을 인자로 받는다. base와 protocol은 `process.platform`이나 node 내장을 읽지 않는다(check가 막는다).
- subprocess·Worker·서버·브라우저를 띄우는 test나 E2E를 새로 만들기 전에 묻는다.
- 작업은 branch `win/verify`(main에서)에서 하고, 고친 것마다 commit한다. 끝내기 전에 `npm run check`를 돌린다.

## 0. 준비

- **Node 24.20.0**: CI와 같은 판이다.
- **Git for Windows**: agent shell tool이 `bash.exe`를 쓴다. `LOPHN_GIT_BASH`가 먼저이고, 없으면 `%ProgramFiles%\Git\bin\bash.exe` 등을 찾는다. POSIX 꼴 npm script를 돌릴 때도 Git Bash를 쓴다.
- **Visual Studio Build Tools는 필요 없어야 한다.** native 의존은 `node-pty`(N-API prebuild)와 `esbuild`(binary 받기)뿐이다. `npm ci`가 C++ compile을 하려 들면 그것이 결함이다.
- clone은 `C:\src\lophn`처럼 짧은 path에 한다. `git config --global core.longpaths true`도 켜 둔다. 공백·한글 path는 기본 단계가 통과한 뒤에 따로 본다.

## 1. 코드 가져오기

origin(`https://github.com/memutator/lophn.git`) main에 올라가 있다. `git clone`이나 `git pull`로 받는다.

확인:
- `git merge-base --is-ancestor d5e3aaac8 HEAD && echo ok`
- `git status`가 깨끗해야 한다. `.gitattributes`가 `eol=lf`라서 CRLF로 바뀐 file이 보이면 그것부터 본다. 그대로 두면 biome fmt가 모든 file에서 깨진다.

## 2. CI와 같은 4단계 (PowerShell)

`os.yml`이 Windows runner에서 돌 단계와 같다. 차례로 돌리고, 하나가 깨지면 고친 뒤 다음으로 간다.

```powershell
npm ci
npm run check:full
node tools/ci/boot-core.ts
node tools/package/main.ts --dir
```

| 단계 | 통과의 모습 | 의심 가는 곳 |
|---|---|---|
| `npm ci` | exit 0. node-pty를 compile하지 않는다 | `packages/shell/main`의 postinstall(`node build.ts rebuild`)은 Linux만 rebuild한다. Electron binary 받기 |
| `check:full` | 모든 단계 `통과` | POSIX mode(0600·0444), symlink, `/bin/sh`, `/` path를 가정한 test. 그 test가 POSIX 규칙을 보는 것이면 platform 인자로 고치거나 `skip: process.platform === "win32"`에 이유를 단다. 동작이 틀린 것이면 코드를 고친다 |
| `boot-core.ts` | `boot 1 exit 0`, `boot 2 exit 0` | named pipe(`\\.\pipe\lophn-<hash>-<name>`), `taskkill` tree 끄기, `node.cmd`·`npm.cmd` shim, 읽기 전용 sdk 사본 지우기 |
| `package --dir` | `build/win/` 아래 `win-unpacked/`에 `lophn-desktop.exe`, `platform/`, `extensions/`, `desktop/`, `skills/`, `bin\lophn.cmd` | `platform/node_modules/@lophn/*`가 junction이 아니라 copy인가 |

## 3. e2e

Linux에서는 25개가 다 통과한다. `npm run e2e`·`e2e:deps` script는 `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron …`이라는 POSIX 꼴이어서 cmd.exe에서는 안 돈다. 그래서 Git Bash에서 바로 돌린다.

```bash
# 한 번. network를 쓴다(template 앱의 npm 의존을 .dev-data/e2e/npm-cache에 받는다).
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe tests/support/app/prepare-deps.ts
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe --test --test-concurrency=1 'tests/e2e/*_test.ts'
```

이 두 script를 OS와 상관없이 돌게 고치는 것(예: env를 넣고 electron을 띄우는 작은 `tools/` 입구)도 이 일에 들어간다.

## 4. 사람과 같이 보는 것 (`npm run dev`)

`npm run dev`는 data root로 `.dev-data/`를 쓰고 fake provider를 붙인다. 화면은 사람이 보고, 이 session은 log와 process를 본다.

- [ ] 창이 뜨고 core가 ready가 된다.
- [ ] session을 하나 만들어 fake model과 한 turn을 돈다.
- [ ] agent shell tool이 Git Bash로 돈다(agent에게 `ls`, `pwd`를 시킨다). 사람의 `!` shell도 돈다.
- [ ] 터미널 탭: ConPTY shell이 뜨고 입력·resize·닫기가 된다.
- [ ] 앱 만들기 → 실행 → 재시작 → 지우기. `.dev-data\apps\<앱>\bundles\` 아래 사본 옆에 `<hash>.sealed`가 생긴다. bundle 연결이 junction이다.
- [ ] 앱을 끄고, `npm run dev`를 Ctrl+C로 끝낸다. 작업 관리자(혹은 `Get-Process electron,node`)에 남은 process가 없다. 신호는 win32에서 `SIGBREAK`이고, tree 끄기는 `taskkill /T`다.
- [ ] harness(claude 등)가 깔려 있으면 `.cmd`로 감지된다.
- [ ] `platform.md`의 "Windows에서 꺼진 기능" 표대로 꺼져 있다. 반쯤 도는 채로 남아 있으면 안 된다.

## 5. 설치본

```powershell
node tools/package/main.ts --target win   # NSIS. 산출물은 build\win\
```

- 설치한 뒤 `lophn-desktop.exe --home C:\tmp\lophn-home`으로 띄운다. `%USERPROFILE%\.lophn`을 쓰지 않는다.
- lophn 터미널에서 `lophn`을 쳐 `bin\lophn.cmd`가 돈다(PATH 앞에 그 폴더가 있다).
- harness agent가 `lophn`을 찾는다.
- 지우기(uninstall)가 설치 폴더를 다 지운다.

## Linux에서 짐작한 약한 곳

- **dev CLI launcher**: `npm run dev`가 쓰는 `.cache/dev-cli/lophn`은 sh script 하나뿐이다(`packages/base/install/linux-install.ts` `devCliLauncher`). shell main은 이 경로를 `LOPHN_CLI`로 받는다. 그래서 Windows 개발 실행에서는 터미널의 `lophn`, harness 감지, hook이 안 될 수 있다. 설치본은 `lophn.cmd`가 따로 있다.
- **e2e npm script**: 위 3번에서 말한 대로 POSIX 꼴이다.
- **봉인 사본 지우기**: 0444는 Windows에서 read-only attribute가 된다. 그런 사본을 지우는 곳이 여럿이다(표지 없는 사본 다시 쓰기, 앱 지우기, `boot-core.ts`·test 뒷정리). 그리고 junction 안쪽을 따라가 지우지 않는지 본다.
- **node-pty**: prebuild가 Electron에서 load되는지 본다(terminal-host).

## 끝나면

1. 아래 "결과"를 채운다.
2. 고치지 못한 것은 `issue` skill로 `project-docs/issues/platform.md`에 올린다.
3. `project-docs/architecture/platform.md`의 "다른 OS 확인" 끝 문단("macOS·Windows는 아직 … 돌려 보지 않았다")을 사실대로 고친다.
4. `npm run check`를 돌린다.
5. 돌려보내기: 사람에게 물은 뒤 `win/verify` branch를 origin에 push한다. Linux session이 fetch → review → Linux `check:full` → land한다.

## 결과

판: Windows 11 Home x64 10.0.26200(개발자 모드 꺼짐), Node 24.20.0, npm 11.19.0, Git 2.55.0.windows.3. branch `win/verify`.

| 단계 | 결과 |
|---|---|
| `npm ci` | 통과. C++ compile 없음(node-pty는 prebuild, esbuild는 binary) |
| `check:full` | 통과(test 523, 그중 Windows symlink 권한으로 건너뜀 7) |
| `boot-core.ts` | 통과(boot 1·2 exit 0, 임시 data root 남지 않음) |
| `package --dir` | 통과. 구성이 표와 같고 `@lophn/*`는 copy다. 이 PC에서는 winCodeSign cache를 손으로 풀어야 했다(platform.md) |
| e2e | 89 중 87 통과. 남은 하나(registration, 하위 test 포함 2)는 30초 제한을 넘은 것이고 따로 돌리면 13–17초에 통과한다 |
| 4. `npm run dev` | 사람과 같이 볼 차례. 아직 안 함 |
| 5. 설치본 | NSIS build 통과(`build/win/builder/lophn Setup 0.18.0.exe`). 설치·실행·지우기는 아직 안 함 |

고친 제품 결함(Windows에서 실제로 틀렸다):
- 앱 화면 file·아이콘·public skill: realpath를 `/`로 견줘 늘 not_found였다(`apps/screens`).
- agent shell tool: child env에 `ProgramFiles`·`LOPHN_GIT_BASH`가 없어 Git Bash를 못 찾았다(`child-env.ts`).
- 설치본 harness 감지: `lophn.cmd`를 shell 없이 execFile해 `spawn EINVAL`이었다(`coding-connection.ts`).
- ledger 경로에서 data root 구하기(agent 정의·workspace·annotation): `/`로만 잘랐다.
- SDK 사본: `file:..\..` 의존과 `sdk/` 판정이 `\` 때문에 틀려 사본이 복사되지 않았다(`sdk-sync.ts`).
- harness extension 끄기: Windows의 rmdir은 file에 ENOENT를 낸다(`harness-run.ts`).
- migration `artifacts.container`·workspace data: `\` 꼴의 옛 rewind root를 옮기지 못했다.

고친 개발 도구: 전부 도는 빠른 `npm run check`가 file 목록을 biome 명령줄에 늘어놓아 `ENAMETOOLONG`이던 것(`tools/check.ts`), `npm run dev`의 repo root(`URL.pathname`)와 dev `lophn.cmd`, e2e npm script 입구(`tools/electron-node.ts`), design token 생성기의 biome 호출, `tests/eval` 경로, e2e 지원 코드(`/proc`, `XDG_RUNTIME_DIR`, Windows env, `USERPROFILE` 격리), test의 POSIX 가정.

못 고친 것: 없음. symlink 권한이 없는 PC에서 file symlink test는 이유를 달고 건너뛴다. 권한이 있는 PC(GitHub runner)에서는 돈다.

같이 알 것: 같은 시각 다른 session(`test/shell-e2e`)이 ledger 경로 문제를 따로 고쳤다(`packages/core/storage/ledger/location.ts`). 합칠 때 `agents/store.ts`·`workspace-store.ts`·`annotations/store.ts`에서 충돌한다. 둘 중 하나만 남긴다.
