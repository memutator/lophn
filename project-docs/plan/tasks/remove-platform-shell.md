# remove-platform-shell

shell main·IPC·preload에서 OS notification 표시, backup 복원 통로, update 적용 통로를 지운다. renderer 쪽 화면은 `remove-platform-renderer`가 이미 지웠다. 이 통로들은 대체 없이 없어진다(notification은 보류, backup·update는 지운다).

- 단위: remove-platform (wave 1)
- 선행: remove-platform-renderer
- 소유(이 task만 고친다):
  - `packages/shell/main/desktop/os-notification.ts`
  - `packages/shell/main/desktop/core/restore.ts`
  - `packages/shell/main/desktop/core/restore-ipc.ts`
  - `packages/shell/ipc/notifications.ts`
  - `packages/shell/ipc/restore.ts`
  - `packages/shell/ipc/update.ts`
  - `packages/shell/preload/restore-api.ts`
- 추가 소유(lead 승인, 2026-10-16. 소유와 같이 고친다. 지운 것을 가리키는 줄만 고친다. core·shell 조립이 wiring file로 쪼개졌으면 그 줄이 옮겨 간 wiring file이 대신한다. "등록 file(lead)"도 지운 것을 가리키는 줄만 뺀다.):
  - 지울 file: `packages/shell/main/desktop/core/update-ipc.ts`
  - 고칠 file: `packages/shell/main/desktop/main.ts`(osNotifications, restoreIpcMain, updateIpcMain 조립), `main/desktop/headless.ts`(`OsNotifier`), `main/desktop/wording.ts`(OS notification 문구), `main/desktop/core/connection.ts`(`restorePipe`, 복원 뒤 새 hello 처리, `UPDATE_STOP_MS`), `main/desktop/core/supervise.ts`(`restore()`와 restore schema import, `confirmStop`), `main/desktop/core/allowlist.ts`(notifications·backups route), `packages/shell/preload/shell.ts`(`lophnRestore`, `lophnUpdate`)
- 읽을 것:
  - spec: S1 13장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - 삭제 목록: `/home/pyosechang/projects/lophn/project-docs/tmp/notes/removed.md` 1장(backup, restore), 2장(notifications, install-and-update)
  - inventory: `I1.9#6`, `I1.9#8`, `I1.11#2`, `U2.5#5`(OS notification 설정을 읽던 `os-notification.ts` 부분만) — `../assignment.md`에서 이 task가 맡은 줄
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음(지우기만 한다). `window.lophnRestore`, `window.lophnUpdate` preload 노출이 없어진다

## 할 일

1. 지운다. (I1.9#6, I1.9#8, I1.11#2)
   - `main/desktop/os-notification.ts`(`createOsNotifications`, `OsNotifier`), `ipc/notifications.ts`(`OS_NOTIFICATIONS_KEY`)
   - `main/desktop/core/restore.ts`, `restore-ipc.ts`, `ipc/restore.ts`, `preload/restore-api.ts`
   - `ipc/update.ts`, `main/desktop/core/update-ipc.ts`(추가 소유)
2. 쓰던 곳을 고친다(추가 소유가 승인됐으면).
   - `main/desktop/main.ts`: `createOsNotifications` 조립과 `osNotifications.arrived(events)` 호출, `registerRestoreIpc`/`removeRestoreIpc`, `registerUpdateIpc`/`removeUpdateIpc`와 두 `*IpcMain` 객체, tray의 `notifications-unavailable` notice. 이 파일에서 문서 복원(`createRestorer`, `../editor/restore.ts`)은 `remove-documents-ui` 몫이니 건드리지 않는다.
   - `headless.ts`의 `OsNotifier` 가짜와 `osNotifyFails` 모드, `wording.ts`의 OS notification 문구.
   - `core/connection.ts`의 `restorePipe()`와 복원 뒤 새 hello 처리, `core/supervise.ts`의 `restore(message)`와 `restorePlanRequestSchema`·`restoreRequestSchema` import. `protocol/supervision`의 restore schema는 `remove-platform-backup`이 지운다. 이 task가 먼저 쓰는 곳을 없앤다.
   - `confirmStop`과 `UPDATE_STOP_MS`는 update 정상 정지 전용이다. 다른 곳이 안 쓰면 같이 지운다. 쓰는 곳이 있으면 남긴다.
   - `core/allowlist.ts`에서 notifications·backups route 허용을 뺀다. 앱 data export(`worker:apps/export`)와 문서 export(`worker:documents/export`) 항목은 `remove-app-extras-apps`, `remove-documents-core`가 지우니 건드리지 않는다.
   - `preload/shell.ts`의 `lophnRestore`·`lophnUpdate` 노출과 import. renderer 전역 type 선언(`window.lophnRestore` 등)이 있으면 그것도 지운다.
3. `U2.5#5`: `os-notification.ts`가 읽던 `shell.os_notifications` 설정 항목(`core/config/shell-settings.ts`)은 platform 몫이다. 이 task는 읽는 쪽만 지운다.
4. `deno task check`를 돈다(shell main은 `npm --prefix packages/shell/main run check`가 따로 돈다. check가 부른다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(지우기만 한다)
- 남지 않음: `grep -rn "os-notification\|OS_NOTIFICATIONS_KEY\|RESTORE_PLAN_CHANNEL\|RESTORE_SUBMIT_CHANNEL\|UPDATE_READ_CHANNEL\|UPDATE_NOTICE_CHANNEL\|UPDATE_APPLY_CHANNEL\|lophnRestore\|lophnUpdate\|createRestoreApi\|registerRestoreIpc\|registerUpdateIpc" packages tools`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 없음
- 안 쓰게 된 export: `core/config/shell-settings.ts`의 `shell.os_notifications`, `protocol/supervision/supervision.ts`의 `restore*Schema` 다섯(remove-platform-backup이 지운다), `core/install-and-update`의 `updateNotice`(remove-platform-install이 지운다)
- 정한 것: `confirmStop`·`UPDATE_STOP_MS`를 지웠는지 남겼는지와 이유
- 계약 바꾸기 요청: 없음(IPC 채널과 preload 노출이 줄었음을 contract-shell에 알린다)
