# remove-platform-renderer

renderer에서 notification chip, Ask toast, Settings의 Backup·Update·Notifications 패널을 지우고, Things to confirm 화면 안의 notification 기록(Notifications 탭과 notification 읽기)을 걷는다. 대기 pill(`space-decisions.tsx`)은 남긴다. Things to confirm 화면 본체(대기 요청 목록·지난 결정·질문 묶음 카드)와 그 data 층(`context.tsx`, `source.ts`, `core-source.ts`, `model.ts`)은 새 대기 목록과 event client가 오기 전까지 남긴다(아래 "정한 것").

- 단위: remove-platform (wave 1)
- 선행: remove-documents-ui (같은 renderer file `desktop/entry.tsx`·`main.tsx`·`dev-mock/*`를 고쳐서 순서를 건다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/lophn-space/things-to-confirm/`
  - `packages/shell/renderer/desktop/lophn-space/settings/backup/`
  - `packages/shell/renderer/desktop/lophn-space/settings/update/`
  - `packages/shell/renderer/desktop/lophn-space/settings/notifications/`
  - `packages/shell/renderer/desktop/notification-chip/`
- 추가 소유(lead 승인, 2026-10-16. 소유와 같이 고친다. 지운 것을 가리키는 줄만 고친다. core·shell 조립이 wiring file로 쪼개졌으면 그 줄이 옮겨 간 wiring file이 대신한다. "등록 file(lead)"도 지운 것을 가리키는 줄만 뺀다. 모두 지운 곳을 쓰던 곳이다):
  - 지울 file: `packages/shell/renderer/workspace/notice-ask.tsx`, `packages/shell/renderer/workspace/ask-view.ts`
  - 고칠 file: `packages/shell/renderer/desktop/lophn-space/settings/settings-screen.tsx`, `packages/shell/renderer/desktop/{entry.tsx, main.tsx, intents.tsx}`, `packages/shell/renderer/desktop/dev-mock/{admin.ts, requests.ts, mod.ts}`, `packages/shell/renderer/desktop/lophn-space/lophn-space.tsx`, `packages/shell/renderer/desktop/launcher/{launcher.tsx, project-card.tsx}`(notification을 읽던 부분만)
- 읽을 것:
  - spec: S1 8장·12장·13장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - 삭제 목록: `/home/pyosechang/projects/lophn/project-docs/tmp/notes/removed.md` 1장(backup, restore, Secrets export·import), 2장(notifications, install-and-update)
  - inventory: `U1.1#1`, `U1.1#2`, `U1.1#3`(notification 기록 부분만), `U1.5#6`, `U1.5#4`, `U1.5#5`(Settings Notifications·Update 패널. ownership 폴더가 이 단위라 이 task가 한다) — `../assignment.md`에서 이 task가 맡은 줄. 표는 `/home/pyosechang/projects/lophn/project-docs/tmp/ui-inventory.md` 1.1, 1.5장
  - 순서 제약: `/home/pyosechang/projects/lophn/project-docs/tmp/ui-inventory.md` 5장(Things to confirm 화면은 새 대기 목록 뒤에 지운다)
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`, `code-map.md`
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음(지우기만 한다)

## 할 일

1. 지운다. (U1.1#1, U1.1#2, U1.5#4, U1.5#5, U1.5#6)
   - `notification-chip/notification-chip.tsx`, `ask-agent-toast.tsx`. `space-decisions.tsx`(pill)와 pill이 쓰는 `notification-chip.module.css` 클래스는 남긴다. chip 전용 클래스만 css에서 뺀다.
   - `settings/backup/`(복원 계획·목록·secret export·import 창), `settings/update/`, `settings/notifications/` 폴더 전부(`core-source.ts`, `source.ts`, `testdata/`, panel 포함).
   - `workspace/notice-ask.tsx`, `workspace/ask-view.ts`(부르는 곳이 chip의 Ask toast뿐인 죽은 코드).
2. `things-to-confirm/` 안의 notification 기록만 걷는다. (U1.1#3의 이 부분)
   - `things-to-confirm.tsx`의 Notifications 탭(`tab-notifications`)과 읽음 표시·OS 표시 실패 줄·`markRead`.
   - `source.ts`의 `NotificationRow`와 `RequestSource`의 notification 읽기 항목(`notifications`, `unread`, `markRead`), `core-source.ts`의 `NotificationValue`·`readNotifications`·`notificationOf`와 `notifications/list`·`notifications/read` 호출, `model.ts`의 `notificationTarget`·`notificationOrder`·`chipQueue`, `labels.ts`의 notification 계기 이름과 `noticeTitle`, `testdata/fake-source.ts`의 notification.
   - 대기 요청 목록, 지난 결정 목록, 기간 filter, 질문 묶음 카드, 요청 카드, `context.tsx`는 지우지 않는다. `placeWaiting`(pill이 쓴다)과 `confirmsWithoutWindow`(conversation이 쓴다)도 남긴다.
3. 지운 곳을 쓰던 곳을 고친다(추가 소유가 승인됐으면): `settings-screen.tsx`의 `backup`·`update`·`notifications` prop, 탭 목록과 panel, `entry.tsx`의 `coreBackupSource`와 update·notifications source 연결, `dev-mock/{admin,requests,mod}.ts`의 해당 항목, `main.tsx`의 `NotificationChip` 마운트와 chip 쪽 prop, `lophn-space.tsx`의 notification 쓰임. `intents.tsx`는 OS notification 클릭 intent를 말하는 주석만 고친다(`lophn://things-to-confirm/…` 링크는 그대로 쓴다).
4. wording key는 고치지 않는다(wording-split의 생성물). 쓰는 곳 없는 key는 cleanup이 지운다.
5. gallery: `settings-update`, `settings-notifications` page가 지운 panel을 그린다. gallery 파일(`tools/wireframes/pages.ts`, `frames/screens.tsx`)은 lead 소유이므로 고치지 말고 보고에 적는다.
6. `deno task check`를 돈다. `deno task wireframes`도 돌려 본다(gallery가 깨지면 위 두 page 때문이다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(지우기만 한다)
- 남지 않음: `grep -rn "NotificationChip\|AskAgentToast\|NoticeAsk\|NotificationsPanel\|UpdatePanel\|BackupPanel\|coreBackupSource\|NotificationRow\|chipQueue" packages tools`가 0줄이다(wording key 이름은 제외).

## 보고

- 바꾼 file
- 등록할 것: `tools/wireframes/pages.ts`·`frames/screens.tsx`의 `settings-update`, `settings-notifications` page 삭제. renderer router·`desktop/screens` 쪽에 지운 panel route가 있으면 적는다
- 안 쓰게 된 export: `ipc/restore.ts`, `ipc/update.ts`, `ipc/notifications.ts`(remove-platform-shell이 지운다). renderer에서 `RestoreOutcome`·`UpdateNoticeValue` 같은 IPC type을 가져다 쓰던 곳이 모두 사라졌는지 적는다
- 정한 것: Things to confirm 화면 본체를 지우지 않은 것. 근거는 (1) ui-inventory 5장이 새 대기 목록 뒤에 지우라고 하고, (2) 남기는 pill·launcher·workspace·app-space·main이 이 화면으로 가는 링크와 data 층을 같이 쓰며, (3) 이 화면을 대신할 대기 목록은 wave 3 screens-data가 짓는다는 것이다. README 2.2와 ownership.md는 폴더째 지우라고 적었으니 lead가 정해 달라(아래 걱정)
- 걱정: `U1.1#3`의 화면 본체가 이 task에서 안 지워진다. lead가 지금 지우기로 정하면 pill·launcher·workspace·app-space·main·intents의 이동 코드까지 끊는 별도 task가 필요하다
- 계약 바꾸기 요청: 없음
