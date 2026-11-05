# os-ci

macOS·Windows runner에서 `npm ci`와 `npm run check:full`이 돌고 core를 두 번 띄워 볼 수 있게 check 도구와 install을 고치고, GitHub Actions workflow를 둔다(README 정한 것 2). 이 task는 workflow를 실제로 돌리지 않는다(push는 사람 확인 뒤 lead가 한다).

- 단위: os (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `.github/workflows/os.yml`(새로)
  - `.gitattributes`(새로)
  - `tools/ci/`(새로: `boot-core.ts`)
  - `tools/check.ts`, `tools/check-deps.ts`, `tools/deps-workspace.ts`
  - `packages/shell/main/package.json`(`postinstall`·`rebuild` script 줄만)
  - `packages/shell/main/build.ts`(node-pty rebuild 부분만)
- 소유 밖: root `package.json`의 script는 lead가 등록한다(보고의 "등록할 것"에 적는다).
- 읽을 것:
  - `tools/check.ts` 전체(fmt, lint, deps, source, modules, docs, package별 tsc, style, kit, token, shell main check·test, Electron-as-node test)
  - `project-docs/plan/tools/lead/boot.sh`(core를 새 data root로 두 번 띄우는 지금 방식. bash·GNU `timeout`이라 CI에서 못 쓴다)
  - `packages/core/supervision/security/node-command.ts`의 `npmCommand()`(Windows에서 npm을 띄우는 이미 있는 길)
  - `packages/shell/main/desktop/core/supervise.ts:40-58`(Electron main이 core를 띄우는 방식: `process.execPath`, `ELECTRON_RUN_AS_NODE`, stdio pipe, hello frame)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: `node tools/ci/boot-core.ts`(exit 0이면 core가 새 data root로 두 번 떴다가 깨끗이 끝났다). `.github/workflows/os.yml`의 job 이름 `os`와 matrix `os: [ubuntu-latest, macos-latest, windows-latest]`. `os-package`가 이 workflow에 package 단계를 더한다.

## 할 일

1. `.gitattributes`: `* text=auto eol=lf`(biome `lineEnding: lf`. Windows checkout이 CRLF면 fmt가 모든 file에서 깨진다). binary(png, ico, icns, woff2 등)는 `binary`.
2. `tools/check.ts`:
   - `:23` `BIOME_CMD`, `:169` `TSC`가 `node_modules/.bin/{biome,tsc}`를 shell 없이 띄운다. Windows에서는 `.cmd`라 안 된다. `process.execPath`로 JS 입구(`node_modules/typescript/bin/tsc`, `node_modules/@biomejs/biome/bin/biome`)를 띄운다. 실제 file 이름은 `node_modules`에서 확인한다.
   - `:293-294` `spawn("npm", …)`은 Windows에서 `npm.cmd`라 안 된다. `npmCommand()`와 같은 길(npm의 `npm-cli.js`를 `process.execPath`로)로 바꾼다.
   - `:25,327,360`의 `require("electron")`은 이미 OS마다 맞다. 그대로 둔다.
3. `tools/check-deps.ts:297` `checkRepo`의 `root.startsWith("/") ? root : cwd + "/" + root`를 `path.resolve`로 바꾸고, 비교에 쓰는 path는 `\`를 `/`로 바꿔 둔다. `tools/deps-workspace.ts:10-18`의 `normalize()`·`inside()`도 같다. check가 다루는 repo 안 상대 path는 `/` 꼴로 통일한다.
4. node-pty rebuild: `packages/shell/main/package.json`의 `postinstall`·`rebuild`(`electron-rebuild -f -m ../../../node_modules/node-pty`)와 `packages/shell/main/build.ts:106-118`이 OS마다 source compile을 강제한다. node-pty 1.1.0은 `prebuilds/{darwin,win32}-{x64,arm64}`(N-API)를 싣고 Linux만 prebuild가 없다. Linux에서만 rebuild하게 한다(작은 node script를 `packages/shell/main/scripts/`에 두지 말고 build.ts 안 함수와 `postinstall`의 `node -e` 한 줄이나 build.ts 안 함수 호출로). N-API prebuild가 Electron에서 load되는지는 CI가 본다.
5. `tools/ci/boot-core.ts`: `boot.sh`를 node로 옮긴다. 새 임시 data root(`os.tmpdir()` 아래, POSIX는 0700)를 두 번 만들어 매번 core daemon(`packages/core/main/daemon/main.ts`, boot.sh가 넘기는 인자 그대로)을 `require("electron")` binary와 `ELECTRON_RUN_AS_NODE=1`로 띄우고, stdin을 열어 둔 채 hello(혹은 boot.sh가 성공으로 보는 신호)를 기다렸다가 stdin을 닫고 exit code 0을 확인한다. 40초 넘으면 끄고 실패. env는 `LOPHN_HOME`, `HOME`, `PATH`와 Windows의 `SystemRoot`·`USERPROFILE`·`TEMP`·`TMP`·`APPDATA`·`LOCALAPPDATA`를 넘긴다. 끝나면 data root를 지운다(`chmod -R u+w`에 해당하는 것 뒤에). 실패하면 core stderr 끝 200줄을 찍는다. pkill·ps를 쓰지 않는다.
6. `.github/workflows/os.yml`:
   - `on: workflow_dispatch`와 `push: branches: ["ci/**"]`만. 다른 trigger 없음.
   - matrix `os: [ubuntu-latest, macos-latest, windows-latest]`, `fail-fast: false`.
   - 단계: checkout(LF), setup-node `node-version: 24.20.0`(지금 Linux와 같은 판), npm cache, `npm ci`, `npm run check:full`, `node tools/ci/boot-core.ts`. Linux job은 node-pty rebuild에 필요한 것(build-essential은 runner에 있다)만 확인한다.
   - action은 판을 정확히 고정한다(AGENTS.md "의존성은 판을 정확히 고정한다"): tag가 아니라 commit SHA와 주석의 판. 실제 SHA는 `gh api repos/actions/checkout/git/ref/tags/<tag>` 따위로 확인한다(push는 하지 않는다).
   - `check:full`은 단계 하나로 두고 `timeout-minutes`를 건다(job 60).
7. Linux에서 `node tools/ci/boot-core.ts`와 `npm run check:full`을 돌려 본다. workflow YAML은 `node -e` + `yaml` package로 parse해 본다.

## 끝남

- `npm run check:full`이 통과한다. `node tools/ci/boot-core.ts`가 Linux에서 exit 0이다. `project-docs/plan/tools/lead/boot.sh`도 그대로 통과한다.
- 위험 test: 없음(CI 도구다. subprocess test를 새로 만들지 않는다).
- 남지 않음: `grep -n "node_modules/.bin" tools/check.ts`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 등록할 것에 root `package.json`의 `"ci:boot": "node tools/ci/boot-core.ts"` 같은 script가 필요한지 적는다.
