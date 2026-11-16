# always-boot

`always-mark`의 port 칸과 `always-os`의 구현을 core 입구에서 잇는다. 설치 layout으로 뜬 core만 OS port를 받고, OS service가 띄운 core는 ready 전 실패(다른 core가 이미 도는 것 포함)에 exit 0으로 끝나 OS가 되풀이해 띄우지 않으며, Linux에서 service가 띄운 core도 browser가 필요할 때 앱 창을 열 수 있다. Windows 제거는 lophn이 쓴 `Run` 값을 지운다.

- 단위: always-boot (wave 2)
- 선행: always-mark, always-os
- 소유(이 task만 고친다):
  - `packages/core/main/daemon/main.ts`
  - `packages/core/main/daemon/shell-launcher.ts`
  - `packages/core/main/daemon/shell-launcher_test.ts`
  - `packages/core/main/daemon/entry-layout.ts`(새 file)
  - `packages/core/main/daemon/entry-layout_test.ts`(새 file)
  - `packages/shell/main/electron-builder.yml`
  - `packages/shell/main/packaging/installer.nsh`(새 file)
  - 한 줄씩 허락: packages/core/always-on/os 안에서 port 모양을 `ports.ts`에 맞추는 최소 수정(type이 어긋날 때만. "넘길 줄"에 적는다), project-docs/flows의 이 task 줄
- 읽을 것:
  - 계획: `project-docs/plan/always-on/README.md`의 "정한 것"(설치 layout만 등록, 설치 묶음은 등록하지 않음, Windows 제거), `tasks/always-mark.md`와 `tasks/always-os.md`의 "계약"
  - architecture: `project-docs/architecture/platform.md`의 "core 수명"(기동 알림 첫 줄, 끝나는 길, core가 shell을 띄운다), "설치 묶음", 지키는 것 6·8·10
  - 지금 코드: `packages/core/main/daemon/main.ts`(`startCore` 호출, 기동 실패의 `process.exit(1)`), `packages/core/main/daemon/shell-launcher.ts`(`createShellLauncher`가 `packages/shell`이 있는지로 개발 저장소를 가르는 것), `packages/core/install-and-update/instance-lock.ts`(다른 core가 lock을 쥐면 `conflict`), `packages/shell/main/electron-builder.yml`(`nsis`), `tools/package/{linux,mac,win}.ts`, `tools/verify-linux-install.ts`(설치 layout core를 빈 data root로 띄운다)
  - electron-builder NSIS의 `include`, `customUnInstall` macro, `${isUpdated}`(업데이트가 옛 판의 uninstaller를 부를 때 참)
- 계약:
  - 쓰는 것: `CoreOptions.alwaysOn?: AlwaysOnHost`(`always-mark`), `createAlwaysOnOs(deps)`(`always-os`)
  - 내놓는 것: 환경 이름 `LOPHN_SERVICE`(`1`이면 OS service가 띄운 core다. 등록 글이 넣는다). platform.md "환경 이름"에 lead가 올린다.

## 할 일

1. `entry-layout.ts`: `installedLayout(platformRoot: string, exists: (path: string) => boolean): boolean`(설치 묶음의 `platform/`에는 `packages/shell`이 없다). `shell-launcher.ts`의 개발 저장소 판정도 이 함수를 쓴다(같은 사실을 두 곳에서 따로 보지 않는다).
2. `main.ts`: 설치 layout일 때만 `alwaysOn: (dataRoot) => createAlwaysOnOs({ platform: process.platform, dataRoot, execPath: process.execPath, coreEntry: <이 file의 경로>, corePid: process.pid, uid, home, env: process.env, exec, spawn, files, hash })`를 `startCore`에 넘긴다. `exec`는 `execFile`(shell 없이, 기한), `spawn`은 `windowsHide`, `hash`는 sha256 hex. 저장소 layout(개발 `npm run dev`·`dev:core`, test의 core, eval, `tools/ci/boot-core.ts`)은 칸을 넘기지 않는다. 설치 확인 도구(`verify-linux-install`)의 core는 칸을 받지만 빈 data root라 `always-on.json`이 없어 OS를 부르지 않는다(`always-mark`의 규칙. 확인만 한다).
3. 기동 실패: `process.env.LOPHN_SERVICE === "1"`이면 `start_failed` 줄을 쓴 뒤 exit 0(`conflict`로 lock을 잃은 것 포함). 이유를 주석 한 줄로: OS service는 0이 아닌 끝을 crash로 보고 다시 띄우는데, ready 전 실패는 다시 띄워도 같고 lock을 잃은 것은 이미 core가 있다는 뜻이다. ready 뒤의 비정상 끝(writer 죽음, 종료 기한)은 지금처럼 0이 아니어서 OS가 다시 띄운다.
4. `shell-launcher.ts`: Linux에서 `LOPHN_SERVICE=1`이고 env에 `DISPLAY`와 `WAYLAND_DISPLAY`가 둘 다 없으면, 앱을 띄울 때 `systemctl --user show-environment`(기한 2초, 주입)에서 `DISPLAY`, `WAYLAND_DISPLAY`, `XAUTHORITY`, `XDG_SESSION_TYPE`, `XDG_CURRENT_DESKTOP`, `DBUS_SESSION_BUS_ADDRESS`만 가져와 띄우는 env에 넣는다(화면 세션이 user manager에 올린 값). 없으면 지금처럼 띄우고 실패는 지금 길로 간다(화면 없는 Linux는 browser 탭이 실패한다. platform.md). `shell-launcher_test.ts`에 그 경우를 더한다.
5. Windows 제거: `electron-builder.yml`의 `nsis.include: packaging/installer.nsh`. `installer.nsh`의 `customUnInstall`은 `${isUpdated}`가 아닐 때만 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`과 `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run`에서 이름이 `lophn-core-`로 시작하는 값을 모두 지운다(지우는 동안 index가 밀리지 않게). 사람의 data root는 건드리지 않는다.
6. 설치 묶음이 아무것도 등록하지 않는지 본다: `tools/package/*`와 `packages/base/install/*`에 systemd unit, LaunchAgent, `Run` 값을 쓰는 곳이 없다(보고에 grep 결과). deb `postinst`는 그대로다. deb·mac에서 지운 뒤 남는 항목은 `always-os`의 글이 실행 파일이 없으면 아무것도 하지 않게 했다(보고에 확인).
7. flows: core 기동 flow(`core-boot`)의 `start_failed` 갈래에 service일 때 exit 0, core가 shell을 띄우는 flow의 Linux 화면 env, 새 test file. `node tools/flows.ts check`.

## 끝남

- `npm run check`가 통과한다(port 모양이 type으로 맞는다).
- 위험 test: "저장소 layout(`packages/shell`이 있음)에서는 `installedLayout`이 false라 core 입구가 OS port를 만들지 않는다"(`entry-layout_test.ts`). 개발·test core가 사람의 OS에 등록하지 않는 경계다.
- subprocess를 띄우는 test는 만들지 않는다(`show-environment`는 주입한 fake).
- 남지 않음: `grep -rn "packages\", \"shell\"" packages/core/main/daemon`에 `entry-layout.ts` 말고 같은 판정이 없다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: `installer.nsh` 본문, 6의 grep 결과, Windows에서 사람이 확인할 것(제거 뒤 `Run` 값 없음, 업데이트 뒤 남음), lead가 고칠 목록(`architecture/platform.md`의 환경 이름 `LOPHN_SERVICE`, 설치 묶음 표, 끝나는 길).
