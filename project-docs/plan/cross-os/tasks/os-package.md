# os-package

Linux `.deb`만 만들던 package 도구를 세 OS로 넓힌다(README 정한 것 1, 10). CI가 macOS·Windows에서 서명 없는 앱을 build할 수 있게 하고, packaged 앱이 OS마다 맞는 자리에서 platform·desktop·extension·skill·CLI를 찾게 한다.

- 단위: os (wave 2)
- 선행: os-base, os-ci. wave 1이 merge된 plan branch에서 시작한다.
- 소유(이 task만 고친다):
  - `tools/package-linux.ts`(지우고 `tools/package/`로 옮긴다), `tools/package/`(새로), `tools/verify-linux-install.ts`(import 줄만)
  - `packages/base/install/`
  - `packages/shell/main/{package.json,electron-builder.yml}`
  - `packages/shell/main/scripts/`(지운다)
  - `packages/shell/main/packaging/`
  - `packages/shell/main/desktop/paths.ts`
  - `packages/shell/main/desktop/wiring/coding.ts`
  - `.github/workflows/os.yml`(package 단계만 더한다)
- 소유 밖: root `package.json` script는 lead가 등록한다. `packages/shell/main/build.ts`는 고치지 않는다(필요하면 보고).
- 읽을 것:
  - `tools/package-linux.ts` 전체(13 단계: shell·renderer build → `npm install --omit=dev --workspaces=false --ignore-scripts` → `electron-builder --linux dir` → `/opt/lophn` 배치, `platform/`은 `packages/core`·`packages/cli`와 그 `@lophn/*` 의존만 `package-lock.json`에서 골라 `npm ci --omit=dev --ignore-scripts` → `extensions/`, `desktop/`, `skills/`, `sdk` symlink → launcher → deb)
  - `packages/base/install/linux-install.ts`(`linuxInstallLayout`, `cliLauncher`, `devCliLauncher`, `hookStdoutCase` 등)
  - `packages/shell/main/desktop/paths.ts:54-64` `packagedInstall`(`root = dirname(process.resourcesPath)`), 그것을 쓰는 `wiring/core.ts:25-27`, `wiring/extensions.ts:269`, `wiring/context.ts:210-213`
  - `packages/shell/main/desktop/wiring/coding.ts:101,104`(packaged CLI가 Linux만 `/usr/bin/lophn`, 다른 OS는 `null`이라 harness 찾기·hook·skill 등록이 꺼진다)
  - `project-docs/architecture/harness-gui.md:43`(root `package.json` `overrides`가 Claude Agent SDK의 OS별 `claude` 사본을 빈 package로 바꾼 이유. 세 OS 모두 그대로다)
- 계약:
  - 쓰는 것: `.github/workflows/os.yml`(`os-ci`가 만든 job `os`)
  - 내놓는 것: `node tools/package/main.ts [--target linux|mac|win] [--dir] [--out <dir>]`. `--target`이 없으면 지금 OS. `--dir`은 설치 묶음 없이 풀린 앱까지만(CI가 쓴다).

## 할 일

1. `tools/package/`: `main.ts`(인자, 공통 단계)와 `linux.ts`·`mac.ts`·`win.ts`. 공통 단계(shell·renderer build, shell main production install, platform tree, extensions, desktop, skills)는 한 번만 짠다. `cp -a`·`rsync`·`du`·`md5sum`·`sh -c find…`는 Linux deb 단계에만 남기고 공통 단계는 `node:fs` `cp`(filter)로. `new URL(..).pathname`은 `fileURLToPath`. `sdk` symlink는 코드가 읽지 않으니(주석이 검증용이라고 한다) `verify-linux-install.ts`가 쓰는지 보고 안 쓰면 지운다.
2. mac(정한 것 10): `electron-builder --mac --arm64`(dmg, `--dir`이면 `dir`), `-c.mac.identity=null`, env `CSC_IDENTITY_AUTO_DISCOVERY=false`. `platform/`·`desktop/`·`extensions/`·`skills/`는 `extraResources`(혹은 builder 뒤 `Contents/Resources/`에 복사)로 `process.resourcesPath` 안에 둔다. `paths.ts` `packagedInstall`은 darwin이면 `root = process.resourcesPath`, 그 밖은 지금 그대로. CLI launcher `Contents/Resources/bin/lophn`(sh, 0755, Electron binary는 `Contents/MacOS/lophn-desktop`). 아이콘은 builder가 512 png에서 만드는지 보고 안 되면 `.icns`를 `packaging/`에 둔다.
3. win(정한 것 10): `electron-builder --win --x64`(nsis, `--dir`이면 `dir`). platform tree는 `npm ci --omit=dev --ignore-scripts --install-links`(workspace를 junction이 아닌 copy로). CLI launcher `bin\lophn.cmd`(`set ELECTRON_RUN_AS_NODE=1`, `"%~dp0..\lophn-desktop.exe" "%~dp0..\platform\packages\cli\main.ts" %*`, `LOPHN_HOME` 기본 `%USERPROFILE%\.lophn`). `.ico`가 필요하면 `packaging/`에 둔다.
4. `packages/base/install/`: `linux-install.ts`의 값은 그대로 두고 mac·win 배치 값(launcher 상대 경로, 글)을 `mac-install.ts`·`win-install.ts`로 더한다. `hookStdoutCase`처럼 sh에 묶인 글은 win32 쪽에 쓰지 않는다(Windows hook은 꺼져 있다).
5. `wiring/coding.ts:101`: packaged CLI 경로를 OS마다(`linux` `/usr/bin/lophn`, `darwin` `<resourcesPath>/bin/lophn`, `win32` `<install root>\bin\lophn.cmd`). `:104` `LOPHN_CLI.startsWith("/")`는 `isAbsolute`.
6. `packages/shell/main/package.json`: Linux 전용 `desktopName`은 builder `linux` 절로 옮길 수 있으면 옮긴다. 죽은 `stage`·`dist` script와 `scripts/stage.ts`(`"type":"module"`에서 `__dirname`, 없는 `node-pty-prebuilt`)를 지운다. `electron-builder.yml`의 mac·win 절을 위 배치에 맞춘다(서명·notarize 설정은 넣지 않는다).
7. `.github/workflows/os.yml`에 `node tools/package/main.ts --dir` 단계를 `boot-core` 뒤에 더한다. 산출물 upload는 하지 않는다(용량·비용).
8. Linux에서 `node tools/package/main.ts --target linux`로 `.deb`가 전과 같은 배치로 나오는지 본다(`dpkg-deb -c`로 file 목록을 전과 비교). `--dir`도 돌려 본다. mac·win target은 Linux에서 build까지 안 되면(dmg는 macOS가 필요하다) 그 사실만 보고한다.

## 끝남

- `npm run check:full`이 통과한다. `node tools/package/main.ts --target linux`의 `.deb` file 목록이 전과 같다(옮긴 path가 있으면 이유와 함께 보고).
- 위험 test: 없음.
- 남지 않음: `grep -rn "package-linux" tools packages project-docs/architecture AGENTS.md`가 0줄이다(문서에 남은 것은 보고하면 lead가 고친다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 등록할 것에 root `package.json`에 둘 script(`"package": "node tools/package/main.ts"`)를 적는다.

## 더할 것 (lead가 더함)

- `os-ci`가 `packages/shell/main/package.json`의 `postinstall`·`rebuild`를 `node build.ts rebuild`(Linux만 node-pty rebuild)로 바꿨다. 그 두 줄은 그대로 둔다.
- `.github/workflows/os.yml`의 job `os` 단계는 `npm ci` → `npm run check:full` → `node tools/ci/boot-core.ts`다. 그 뒤에 package 단계를 더한다.
- `packages/base/os/`(`homeOf` 등)를 쓸 수 있다. base는 node 내장을 import하지 않는다(spawn 같은 것은 인자로 받는다).
