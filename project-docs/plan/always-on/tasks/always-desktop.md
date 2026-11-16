# always-desktop

desktop에서 표시를 켜고 끄고 사실을 본다: Settings › Remote에 자기 section component "Keep running"을 두어 스위치 둘("Keep lophn running on this computer", "Keep this computer awake")과 OS 등록의 사실을 보인다. 같은 일을 하던 tray "Start at login"과 `autostart.ts`를 지우고, 옛 판에서 켜 둔 등록은 새 판의 첫 실행이 표시 켜기로 옮긴 뒤 지운다.

- 단위: always-desktop (wave 2)
- 선행: always-mark
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/settings/remote/keep-running-section.tsx`(새 file)
  - `packages/shell/renderer/desktop/settings/remote/keep-running-section.module.css`(새 file)
  - `packages/shell/renderer/desktop/settings/remote/source.ts`
  - `packages/shell/renderer/desktop/settings/remote/core-source.ts`
  - `packages/shell/renderer/desktop/settings/remote/testdata/fake-source.ts`
  - `packages/shell/main/desktop/autostart.ts`(지운다)
  - `packages/shell/main/desktop/autostart-migrate.ts`(새 file)
  - `packages/shell/main/desktop/os-entry`
  - `packages/shell/main/desktop/tray.ts`
  - `packages/shell/main/desktop/launch-mode.ts`
  - `packages/shell/main/desktop/main.ts`
  - `packages/shell/main/desktop/wiring/desktop.ts`
  - 한 줄씩 허락: packages/shell/renderer/desktop/settings/remote/remote-panel.tsx에 section을 다는 한 줄(machine-identity의 "This computer" 바로 아래), packages/shell/main/desktop/core/allowlist.ts의 `RENDERER_MEMORY_ROUTES`에 `memory:always_on/status`·`memory:always_on/set`과 주석 한 줄, i18n catalog packages/design/i18n/catalog/workspace-settings.ts(`settings.*` key 더하기)와 packages/design/i18n/catalog/common.ts(`common.label.tray-start-at-login` 지우기), project-docs/flows의 이 task 줄
- 읽을 것:
  - 계획: `project-docs/plan/always-on/README.md`의 "정한 것"(표시, 옛 autostart, `Stop lophn`, keep-awake), `tasks/always-mark.md`의 "계약"(`AlwaysOnStatus`, `always_on/set`)
  - architecture: `project-docs/architecture/settings.md`(Settings 화면 원칙), `project-docs/architecture/platform.md`("autostart는 core만 띄운다", "launch intent", 지키는 것 8)
  - 본보기(화면): gallery `tools/wireframes/pages/screens/settings-pages.tsx`의 `SettingsRemote`(실제 panel을 `testdata/fake-source.ts`로 그린다), machine-identity의 "This computer" section(자기 file의 group 꼴), `settings/remote/remote-panel.tsx`의 켜기 줄
  - 지금 코드: `packages/shell/main/desktop/autostart.ts`(`readAutostart`, `migrateAutostart`, `verifiedExecPath`, XDG `lophn.desktop`, Electron login item), `tray.ts`(`autostart` 항목), `wiring/desktop.ts`(`autostartOs`, `migrateAutostart` 호출, tray actions), `main.ts`와 `launch-mode.ts`(`openedAtLogin`, `wasOpenedAtLogin`), `os-entry/entry.ts`(`verifiedExecPath`를 쓴다), shell main이 core memory route를 부르는 길 `ctx.coreInternal("memory", …)`(`wiring/coding.ts`)
- 계약:
  - 쓰는 것: `always_on/status`, `always_on/set`(memory, actors `user`)
  - 내놓는 것: 없음(화면). `--core` launch intent는 남는다(Windows `Run` 값이 쓴다).

## 할 일

1. `source.ts`의 `RemoteSettingsSource`에 `alwaysOn(): Promise<SourceResult<AlwaysOnView>>`와 `setAlwaysOn(input: { keepRunning?: boolean; keepAwake?: boolean }): Promise<SourceResult<AlwaysOnView>>`(화면 쪽 type은 `AlwaysOnStatus`의 칸을 camelCase로). `core-source.ts`는 memory route 둘로, fake source는 메모리로 짓고 option으로 상태 하나하나를 줄 수 있게 한다.
2. `keep-running-section.tsx`(자기 group. remote가 꺼져 있어도 보인다):
   - 스위치 "Keep lophn running on this computer". 설명: "lophn starts when you log in and keeps running after you close its window, so scheduled jobs run and your phone can reach this computer. Stop lophn stops it until you log in again or open lophn."
   - 켜져 있을 때 사실 한 줄: `registered`면 "Starts when you log in". `not_registered`면 경고 "lophn couldn't set itself to start at login." + [Try again](`setAlwaysOn({ keepRunning: true })`). `off_in_system`이면 경고 "Turned off in your system's startup settings." + OS별 자리(`mechanism`: launchd "System Settings › General › Login Items", windows_run "Settings › Apps › Startup", systemd "`systemctl --user`") + [Turn on again](같은 set. 사람이 lophn에서 다시 켜는 것이라 OS의 끔을 푼다). `unavailable`이면 이유 글(`development_build` "Not available in a development build", `no_service_manager` "This computer has no systemd user session, so lophn can't start at login.", `unverified_path` "lophn is installed in a path it can't register safely.", `os_failed` "The system refused the change." + [Try again]).
   - 꺼져 있는데 `registered`(지우기 실패)면 "lophn is still set to start at login." + [Try again](`keepRunning: false`).
   - 개발 core(`login_reason` `development_build`)는 스위치를 disabled로 두고 이유 글을 보인다.
   - 스위치 "Keep this computer awake"(표시가 켜져 있을 때만 enabled, 기본 꺼짐). 설명: "Stops this computer from going to sleep on its own while lophn runs. Closing the lid or choosing Sleep still puts it to sleep." `awake`가 `unavailable`이면 이유 글(`no_inhibitor` "This system has no way for lophn to keep it awake.", `os_failed`).
   - 저장 실패는 이 pane의 다른 줄과 같은 오류 글(`settings.error.value-not-saved`). 열 때와 바꾼 뒤 `status`를 다시 읽는다(core가 OS에 다시 묻는다).
3. `remote-panel.tsx`에 section 한 줄. `allowlist.ts`에 memory route 둘.
4. tray와 autostart:
   - `tray.ts`의 `autostart` 항목과 `readAutostart`·`writeAutostart` action을 지운다. `Stop lophn`·Quit은 그대로다.
   - `autostart.ts`를 지운다. `verifiedExecPath`와 `ExecutableProbe`·`nodeExecutableProbe`는 `os-entry`가 쓰므로 `os-entry/` 안의 file로 옮긴다.
   - `launch-mode.ts`·`main.ts`의 `openedAtLogin`(macOS `wasOpenedAtLogin`)을 지운다. macOS 등록은 이제 LaunchAgent가 core를 바로 띄운다. `--core` intent는 남긴다(Windows `Run` 값).
   - `autostart-migrate.ts`: packaged일 때만, 옛 등록(Linux `$XDG_CONFIG_HOME/autostart/lophn.desktop`의 `--core`·`--tray` entry, macOS·Windows Electron login item `openAtLogin`)이 있으면 core에 붙은 뒤 `ctx.coreInternal("memory", "always_on", "set", { keep_running: true })`를 부르고, 성공했을 때만 옛 등록을 지운다(실패하면 남겨 로그인 시작을 잃지 않는다. 다음 실행이 다시 한다). `wiring/desktop.ts`의 `migrateAutostart` 호출을 이것으로 바꾼다. 옛 file 글과 login item을 읽는 코드는 이 file 하나에만 둔다.
   - 한 번 알림: 옮기기가 성공하면 shell 쪽 표지(shell data의 작은 file 하나, 예 `<root>/shell/keep-running-notice.json`)를 남기고, 그 뒤 desktop 창이 처음 열릴 때 알림 하나를 보인다: "lophn now keeps running on this computer after you close its window, and starts when you log in. You can turn this off in Settings › Remote." + [Open settings](Settings › Remote를 연다) + 닫기. 보이거나 닫으면 표지를 지워 다시 보이지 않는다. 그들에게는 동작이 바뀐다(idle일 때 core가 멈추지 않는다). 알림 자리는 이미 있는 창 안 알림(notice·toast) 꼴을 쓴다. 새 알림 장치를 만들지 않는다. 쓰는 file과 IPC가 늘면 소유를 보고에 적는다.
5. i18n: 새 문구는 `workspace-settings.ts`의 `settings.*` key(이웃 key 꼴을 따른다. 예 `settings.heading.keep-running`, `settings.label.keep-running`, `settings.note.keep-running`, `settings.label.keep-awake`, `settings.note.keep-awake`, `settings.status.starts-at-login`, `settings.warning.login-not-registered`, `settings.warning.login-off-in-system`, `settings.reason.*`, `settings.button.try-again`). `common.label.tray-start-at-login`을 지운다.
6. gallery: `SettingsRemote`가 새 section을 그리는지 보고, 상태별 페이지(등록됨, OS에서 꺼짐, 개발 build)를 `settings-pages.tsx` 이웃 꼴로 더할지는 보고에 적는다(더하면 `tools/wireframes/pages/screens/settings-pages.tsx`는 넘길 줄).
7. flows: `autostart-toggle` flow와 `ui:tray-autostart` 입구를 지우고, `autostart-migrate`를 새 옮기기로 고치고, Settings의 스위치 둘 flow(area `shell-desktop`, entry `route:always_on/set`)를 더하고, `journeys/setup.yaml`의 `login-autostart`와 `update-start`의 autostart 걸음을 새 flow로 고친다. `grep -rn "autostart" project-docs/flows`에 지운 id가 남지 않게. `node tools/flows.ts check`.

## 끝남

- `npm run check`가 통과한다.
- `npm run wireframes`가 되고, gallery의 `SettingsRemote`가 "Keep running" section을 실제 component로 그린다.
- 위험 test: 없음(화면과 문구. 옮기기의 "성공했을 때만 지운다"는 순서로 지킨다).
- 옮겨진 data root로 desktop을 처음 열면 알림이 한 번 보이고, 다시 열면 보이지 않는다(개발 앱에서 표지 file을 손으로 두어 확인한다).
- 남지 않음: `grep -rn "readAutostart\|writeAutostart\|migrateAutostart\|openedAtLogin\|tray-start-at-login" packages tools tests`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: gallery 그림 path(켜짐·등록됨, OS에서 꺼짐, 개발 build), 사람이 macOS·Windows에서 볼 것(옛 login item이 옮겨지는지, Login Items·Startup apps에 lophn이 어떻게 보이는지), lead가 고칠 목록(`architecture/platform.md`의 "autostart는 core만 띄운다"와 launch intent, `architecture/remote.md`의 Settings › Remote 서술).
