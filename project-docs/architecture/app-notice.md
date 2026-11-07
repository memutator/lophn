# app-notice

앱이 사람에게 알리는 길이다. 캘린더의 일정 알림, 사용량 앱의 한도 경고처럼 앱이 아는 일을 사람이 알아야 할 때 쓴다. 앱 process가 `@lophn/cap-notify`의 `notify()`를 부르면 알림이 `app_notices` 표에 남고, 사람의 Inbox에 한 줄로 뜨고, toast나 OS 알림으로도 뜬다. 받는 쪽은 사람뿐이다. agent에게 사실을 보내거나 lophn의 반응을 일으키는 길이 아니다(`architecture/event.md`). 계약은 `packages/protocol/apps/notice.ts`, 규칙은 `packages/core/apps/notices/`, broker는 `packages/core/apps/permissions/broker/notify.ts`, SDK는 `packages/sdk/cap-notify/`, 화면은 `packages/shell/renderer/desktop/connection/waiting/`와 `packages/shell/main/desktop/wiring/notice.ts`다.

## 흐름

```
 앱 process: notify({ title, body?, key? })      (command·operation·flow·시작 코드. 앱 UI view는 못 부른다)
   │ broker /_lophn/broker/notify/send
   ▼
 app supervisor broker: live 자식인가, 지금 release의 선언 ∩ grant에 notify.send가 있나 → 아니면 forbidden
   │ 그 자식의 app credential로
   ▼
 core app_notices.post (actor app, 앱은 credential이 정한다)
   · 같은 (app, key)의 열린 줄이 있으면 그 줄의 내용과 시각을 바꾼다(id 그대로). 없으면 새 줄
   · 앱마다 열린 줄이 50개를 넘으면 오래된 것부터 지운다
   ▼ commit 뒤 (apps wiring의 after_commit)
 Bus: AppNoticePosted(알림 한 건) / 지운 줄마다 AppNoticeClosed { id }
   ▼ Gateway
 shell main: toast(lophn 창에 focus) 또는 OS 알림. 누르면 그 앱 공간을 연다
 renderer Inbox: "From apps" 묶음에 줄을 더하거나 뺀다. ready 뒤 app_notices.list로 맞춘다

 사람: 줄의 [x] → app_notices.dismiss → 줄 지움 → AppNoticeClosed
 앱 보관: 그 앱의 줄을 모두 지우고 줄마다 AppNoticeClosed
```

## 지키는 것

- 받는 쪽은 사람뿐이다. Bus에서 `AppNoticePosted`를 받아 일을 하는 core 코드를 두지 않는다. agent에게 알릴 일이면 agent가 앱 tool로 읽는다.
- 권한은 grant `notify.send`(scope 없음)다. 앱이 선언하고 activation 때 사람이 허락한다. broker가 요청마다 지금 release의 선언 ∩ grant를 본다. preview·test 자식과 옛 release의 자식은 거절한다. SDK는 live가 아닌 mode에서 broker를 부르지 않고 `standIn`을 돌려준다.
- 앱은 입력에서 앱을 고르지 못한다. 어느 앱의 알림인지는 자식의 app credential이 정한다. app credential이 닿는 operation은 다른 앱 호출과 `app_notices.post` 둘뿐이다.
- 같은 key는 대신한다. 주기적으로 같은 사실을 다시 확인하는 앱이 Inbox를 채우지 않게 하려는 것이다. 대신한 줄은 id가 같아 `AppNoticeClosed` 없이 `AppNoticePosted`만 다시 나가고, toast도 다시 뜬다.
- 앱마다 열린 줄은 50개까지다. 고장 난 앱이 표를 끝없이 키우지 못하게 한다.
- 정본은 표다. 줄은 사람이 지우거나 앱이 보관될 때까지 재시작을 넘어 남는다. toast는 shell 정책이라 놓친 것을 다시 띄우지 않는다.
- Inbox에서 알림은 답할 것이 아니라 지우기만 하는 줄이다. 대기 항목(entries)과 따로 두고, 알림 단추의 수에는 더한다.

## 왜 이 모양인가

- 앱 event의 발행·구독이나 event로 시작하는 job을 열지 않고 사람에게 알리기만 열었다. 반응을 믿을 수 있게 하려면 저장, 구독자 cursor, 재시도, 멱등 key가 다시 필요하다(`event.md`가 Reactor를 지운 이유). 사람에게 알리기는 놓쳐도 표가 남아 그 짐이 없다.
- 정책(언제 알릴지)은 앱이 가진다. lophn은 한도나 일정이 무엇인지 모르고 보여 주기만 한다.
- 대신하기는 key로 한다. 앱이 열린 알림을 직접 지우는 길을 두지 않았다. 지우는 것은 사람의 일이다.

## tray 값

앱이 늘 보이고 싶은 짧은 상태(사용량 앱의 `84%`)는 알림이 아니라 tray 값이다. 앱 process가 `@lophn/cap-notify`(1.1.0)의 `setTray({text, tone?})`나 `clearTray()`를 부른다. 계약은 `packages/protocol/apps/tray.ts`, core는 `packages/core/apps/tray/`, 화면은 `packages/shell/renderer/shell/tray/`다.

```
 앱 process: setTray({ text, tone? }) / clearTray()     (text 1~16자, tone은 neutral·good·warn·bad)
   │ broker /_lophn/broker/notify/tray   (live 자식인가, 선언 ∩ grant에 notify.send가 있나 → 아니면 forbidden)
   ▼
 core app_tray.set (memory route, actor app) → 앱마다 마지막 값 하나를 memory map에 둔다 → AppTrayChanged { app }
   ▼ Gateway
 renderer TrayHost: AppTrayChanged와 ready 때 app_tray.list(actor user)로 다시 읽어, 설정 shell.tray에 켠 앱 화면 항목에 글과 tone을 붙인다
```

- **값은 저장하지 않는다.** core를 다시 켜면 비고, 앱 process가 시작할 때 다시 낸다. 앱 process는 오래 살아 timer로 값을 바꿀 수 있다. 보관한 앱이나 없는 앱의 `set`은 거절하고 `list`는 보관한 앱의 값을 뺀다.
- **권한은 알림과 같은 `notify.send`다.** tray 값도 앱이 사람에게 보이는 것이라 새 permission kind를 두지 않았다. test는 "`notify.send` grant가 없는 앱의 `setTray`는 거절되고 값이 바뀌지 않는다"(`packages/core/apps/permissions/broker/notify_test.ts`).
- **어떤 앱이 tray에 나오는지는 사람이 켠다.** 값을 냈어도 사람이 Settings › Quick launch의 Tray에서 그 앱의 `tray` 자리 화면을 켜야 항목이 생긴다. 켰는데 값이 없으면 아이콘만 보인다.
