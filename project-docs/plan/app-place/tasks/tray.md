# tray

앱 process가 tray 항목 값(짧은 글, tone)을 낸다. 사람이 켠 앱의 `tray` 화면이 작업 표시줄 오른쪽 tray에 항목으로 보인다. 누르면 그 화면이 popup으로 뜬다. 작업 표시줄이 꺼져 있으면 title bar 오른쪽 icon으로 보인다.

- 단위: tray (wave 4)
- 선행: shell-sidebar-slots
- 소유(이 task만 고친다):
  - `packages/sdk/cap-notify/**`
  - `packages/core/apps/runtime/entrypoint/cap-host.ts`
  - `packages/core/apps/permissions/broker/{server.ts,notify.ts}`
  - `packages/core/apps/tray/**` (새로)
  - `packages/protocol/apps/tray.ts` (새로)
  - `packages/protocol/events/transient.ts` (`AppTrayChanged`만)
  - `packages/core/main/app-supervisor/assembly.ts` (tray port 줄만)
  - `packages/core/main/daemon/wiring/apps.ts` (tray 줄만)
  - `packages/shell/main/desktop/core/allowlist.ts` (tray read 한 줄)
  - `packages/shell/renderer/shell/taskbar/**`
  - `packages/shell/renderer/shell/tray/**` (새로)
  - `packages/shell/renderer/shell/shell-frame.tsx`, `packages/shell/renderer/shell/shell-frame.module.css`
  - `packages/shell/renderer/workspace/workspace-window.tsx`
  - `packages/shell/renderer/desktop/settings/quick-launch/**`
  - `packages/core/config/shell-settings.ts` (`shell.tray` 선언만)
  - `packages/design/i18n/catalog/{shell.ts,workspace-settings.ts}`
  - `tools/wireframes/pages/screens/shell.tsx`, `tools/wireframes/pages/screens/shell/**`, `tools/wireframes/mock/**`
  - 추가 소유: `packages/shell/renderer/desktop/dev-mock/app-space.ts` (앱 화면 목록만)
- 읽을 것:
  - 계획: `project-docs/plan/app-place/README.md`의 정한 것 10, 11
  - roadmap: `project-docs/products/roadmap/app-place.md`의 "tray"
  - architecture: `project-docs/architecture/app-notice.md`(cap-notify 흐름), `project-docs/architecture/event.md`(transient event와 snapshot)
  - 본보기 길(cap-notify `send`의 끝에서 끝):
    - SDK: `packages/sdk/cap-notify/notify.ts`, `host.ts`, `guide.md`
    - 앱 process: `packages/core/apps/runtime/entrypoint/cap-host.ts`
    - broker: `packages/core/apps/permissions/broker/server.ts`, `notify.ts`(`createNotifyService`), `access.ts`(`notifyGranted`)
    - port: `packages/core/main/app-supervisor/assembly.ts`(`NoticePostPort`)
    - core route: `packages/protocol/apps/notice.ts`(`appNoticePost`, actor `app`), `packages/core/apps/notices/commands.ts`
    - event: `packages/protocol/events/transient.ts`(`AppNoticePosted`), `packages/core/main/daemon/wiring/apps.ts`가 bus에 낸다
    - shell: `packages/shell/renderer/desktop/connection/events/waiting-store.ts`(condition과 snapshot read)
  - wave 2·3이 만든 것: `EmbeddedView`의 `place`, 작업 표시줄의 `tray` slot(`renderer/shell/taskbar/`), Settings › Quick launch의 "Sidebar panels" 묶음
  - 화면 규칙: `.claude/skills/ui-design/SKILL.md`
- 계약:
  - 쓰는 것: 권한 `notify.send`, `useGlobalFloats`의 webview 그릇(popup page를 살려 두고 싶으면)
  - 내놓는 것:
    - SDK `setTray({text, tone?})`, `clearTray()`. `text`는 16자 이하, `tone`은 `"neutral"|"good"|"warn"|"bad"`다.
    - core route: 앱이 쓰는 `app_tray/set`(actor `app`)과 shell이 읽는 `app_tray/list`(`{app, text, tone, at}[]`).
    - transient event `AppTrayChanged {app}`
    - 설정 `shell.tray: {app, screen}[]`(최대 20, 기본 빈 목록)

## 할 일

1. **SDK**
   - `@lophn/cap-notify`에 `setTray`, `clearTray`를 더하고 판을 올린다(minor).
   - guide에 쓴다: 앱 process가 시작 코드나 timer에서 부르는 예(사용량 앱이 몇 분마다 값을 바꾸는 것), 권한 `notify.send`, 값은 lophn을 다시 켜면 사라지므로 앱이 시작할 때 다시 낸다.
   - pin이 있는 곳이 있으면 고친다.
2. **앱 process와 broker**: `cap-host.ts`와 broker `notify.ts`에 tray 길을 더한다. 검사는 `send`와 같다(`notifyGranted`, `liveOnly`).
3. **core** (`packages/core/apps/tray/`)
   - 앱마다 마지막 값을 memory map에 둔다. 저장하지 않는다(정한 것 10).
   - `set`은 값을 바꾸고 `AppTrayChanged`를 낸다. `list`는 지금 값들을 준다. 앱이 archive되면 값을 지운다.
   - route 등록과 wiring은 "등록할 것"으로 보고한다. `apps.ts`의 tray 줄은 이 task가 고친다.
4. **shell 설정과 켜기**
   - `shell.tray`를 선언하고 `QuickPrefs`에 더한다.
   - Settings › Quick launch에 "Tray" 묶음을 더한다. `tray` 자리를 가진 앱 화면마다 줄 하나와 Switch다. "Sidebar panels" 묶음과 같은 꼴이다.
5. **tray 항목** (`renderer/shell/tray/`)
   - 켠 `{app, screen}`마다 항목 하나다: 앱 아이콘, 값이 있으면 짧은 글, tone 색.
   - `AppTrayChanged`를 듣고 `app_tray/list`로 다시 읽는다(창이 뜰 때와 core가 다시 붙을 때도).
   - 작업 표시줄 `tray` slot에 그린다. `shell.taskbar`가 꺼져 있으면 title bar 오른쪽 panel 탭 옆에 아이콘으로 그린다.
6. **popup**
   - 항목을 누르면 그 위(작업 표시줄이면 위쪽, title bar면 아래쪽)에 popup이 뜬다. 본문은 그 앱의 `tray` 화면 `EmbeddedView`(`place: "tray"`, 지금 workspace)다.
   - 바깥을 누르거나 Esc를 누르면 닫힌다.
   - popup 크기는 정한 값(예: 360×480 CSS px)이고 화면 밖으로 나가지 않게 당긴다.
7. **gallery**: `shell` 영역에 tray 항목 둘(값 있음·없음)과 열린 popup page(id `shell-tray`)를 더한다.
8. **(lead가 더함) dev-mock 앱 화면**: `packages/shell/renderer/desktop/dev-mock/app-space.ts`의 앱 목록에는 `sidebar`·`tray` 자리 화면이 없어 `npm run dev:mock`에서 Sidebar panels와 Tray 묶음이 비어 보인다. mock 앱 하나에 `places: ["sidebar"]` 화면 하나와 `places: ["tray"]` 화면 하나를 더한다(wave 3 `shell-sidebar-slots`가 짚었다).

## 끝남

- `npm run check:full`이 통과한다. `node packages/shell/renderer/build.ts`와 `npm run wireframes`가 된다.
- 위험 test(권한 경계):
  - broker test: "`notify.send` grant가 없는 앱의 `setTray`는 거절되고 값이 바뀌지 않는다"
- `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`.

## 보고

brief-template의 보고 꼴. 등록할 것(protocol `mod.ts`, core route·event 등록)을 빠짐없이 적는다.
