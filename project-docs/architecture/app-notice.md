# app-notice

사람에게 "답할 것"(승인·질문)이 아닌 것을 알리는 길이다. 저장은 ledger 표 `notices` 하나다. 줄의 출처는 둘이다. **app**: 캘린더의 일정 알림, 사용량 앱의 한도 경고처럼 앱 process가 `@lophn/cap-notify`의 `notify()`로 남긴 알림. **program**: release 켜짐·실패, 앱 멈춤 같은 일을 core가 직접 남긴 기록(`architecture/event.md`의 "program이 agent session을 스스로 열지 않는다"와 같은 선이다. 받는 쪽은 사람뿐이다). 줄은 **휘발**이거나 **영구**다. 휘발 줄은 사람이 지우면 사라지고, 영구 줄은 지워도 읽음으로만 바뀌어 남아 사람이 나중에 찾을 수 있다. 받는 쪽은 사람뿐이다. agent에게 사실을 보내거나 lophn의 반응을 일으키는 길이 아니다. 계약은 `packages/protocol/apps/notice.ts`, 규칙은 `packages/core/apps/notices/`, program 쓰기 길은 `packages/core/main/daemon/wiring/notices.ts`, broker는 `packages/core/apps/permissions/broker/notify.ts`, SDK는 `packages/sdk/cap-notify/`, 화면은 `packages/shell/renderer/desktop/connection/waiting/`와 `packages/shell/main/desktop/wiring/notice.ts`다.

## 표

`notices`(`packages/core/apps/notices/schema.ts`의 `apps.notices.unified`): `id`(`ntc_…`), `source`(`app`|`program`), `app`(nullable. lophn 전체에 관한 기록은 null), `project`(nullable), `kind`, `key`(nullable), `title`(≤120), `body`(≤500), `persistent`, `action`(nullable JSON), `created_at`, `read_at`(nullable).

- `kind`: app 줄은 `app`. program 줄은 `release_activated`, `release_failed`, `release_rolled_back`, `app_unavailable`, `app_data_migrated`, `app_data_restored`, `lophn_updated`, `sdk_update_needed`(둘은 앱이 없다. 목록은 protocol zod가 정한다. 표에 CHECK를 걸지 않아 종류를 더해도 표를 다시 짜지 않는다).
- `action`: 줄을 누르면 할 일. 지금은 `{kind: "open_home_skill", skill, args}` 하나다. 화면은 종류로만 그리고 실행한다. app 줄은 action이 없다(앱이 home skill을 열 수 없다).
- 같은 `(source, app, key)`는 줄 하나다(key가 있을 때). 새로 오면 그 줄의 내용·시각·`persistent`·`action`을 바꾸고 안 읽음으로 되돌린다(id 그대로).
- program 줄은 항상 영구이고 DB trigger가 지우기를 막는다(`notices_program_no_delete`). 앱 줄만 command가 지운다.
- 옛 표 `app_notices`는 ledger step `apps.notices.unified`가 줄을 앱이 쓴 휘발·안 읽은 줄로 옮기고 지웠다.

### program 줄을 어디서 쓰나

| kind | 쓰는 곳 | key |
|---|---|---|
| `release_activated`, `release_rolled_back` | `activation.complete`(`packages/core/apps/releases/commands.ts`). 이미 켜졌던 release를 다시 켠 것은 `release_rolled_back` | 없음 |
| `release_failed` | `activation.fail`(같은 file). 복원했으면 reason에 이전 release로 돌아갔다는 말이 붙는다 | 없음 |
| `app_unavailable` | `app.record_unavailable`(`packages/core/apps/runtime/commands.ts`): `start_failed`, `crash_loop`, `unexpected_exit`, activation의 복원 실패·종료 확인 불가. 같은 사실의 재전송은 쓰지 않는다 | `app_unavailable`(앱마다 한 줄, 되풀이되면 그 줄을 안 읽음으로 되돌린다) |
| `app_data_migrated`, `app_data_restored` | `activation.record_data_change`, `activation.record_data_restore`(`packages/core/apps/data/commands.ts`). 복원은 새로 기록할 때만 | 없음 |
| `lophn_updated` | `notices.observe_version`(아래 "제품 판 marker") | 없음 |
| `sdk_update_needed` | 제품 판이나 설치된 SDK 판이 바뀐 기동의 SDK 감지(`packages/core/apps/sdk-status/detect.ts`, 앱 wiring의 `productStartListeners`). 필수나 가능 SDK가 있는 앱이 하나라도 있으면 앱 없는 줄 하나. params는 `{required, available}`(옮겨야 하는 앱 수, 필수는 아니지만 새 판이 있는 앱 수), 글은 "SDK updates for your apps" / "3 apps must update, 2 can use new SDK features.", action은 `open_home_skill` `update-apps` + 빈 args(전체) | `sdk_update_needed`(앱 없는 줄 하나, 다음 기동이 개수를 새로 쓰고 안 읽음으로 되돌린다) |

앱마다 줄을 만들지 않는 것은 각 앱을 두고 갈지 올릴지(그리고 새 SDK 기능을 쓸지) 숲으로 보는 일이 사람이 아니라 home lophn의 몫이기 때문이다. 줄마다 [Ask lophn]이 있으면 home을 거칠 이유가 없어진다(0.20.0 정정 항목). 앱마다 있던 옛 `sdk_update_needed` 줄(앱 있음)은 ledger에 남고 단추도 그대로 동작한다.

release·data·runtime command는 자기 tx 안에서 `recordProgramNotice(tx, input)`(`packages/core/apps/notices/commands.ts`)를 부른다. 상태 변경과 줄이 한 commit이라 한쪽만 남지 않고, 응답을 잃은 재전송이 줄을 늘리지 않는다. 이미 commit된 뒤 core 안 다른 wiring이 쓸 때는 `ctx.noticeRecorder`(`notices.record`)를 쓴다. 그 값은 tx 안에서 부르면 안 된다(machine 자격으로 쓰기 층을 따로 지난다).

### 제품 판 marker

`core_meta`(ledger step `apps.notices.product-version`)의 `product_version` 한 줄이 data root가 마지막으로 돈 제품 판이다. core가 켜져 ready가 된 뒤 notices wiring의 `afterReady`가 root `package.json`의 `version`(개발은 repo root, 설치본은 `platform/package.json`)을 `notices.observe_version {version, fresh}`로 낸다. 한 tx에서 marker를 새 판으로 바꾸고, 판이 다르면 `lophn_updated {from, to}`를 쓴다(SDK 갱신 수는 싣지 않는다. 그 일은 `sdk_update_needed` 줄 하나가 한다). 새 data root(`fresh`: 이번 기동이 step을 전부 새로 적용했다)는 marker만 적는다. marker 없이 있던 옛 data root가 처음 켜지면 `from`을 모른 채(`unknown`) 한 번 쓴다.

같은 표의 `sdk_versions` 한 줄은 마지막으로 본 설치 SDK 판(part → 가장 높은 판, 정렬한 JSON)이다. `afterReady`가 `<data root>/sdk`의 설치 사본에서 읽어(`readInstalledVersions`) `observe_version`의 `sdks`로 같이 내고, 적힌 것과 다르면 새로 적고 `sdks_changed`를 true로 돌려준다(행은 남기지 않는다. 새 data root는 적기만 하고 false, 적힌 것이 없던 옛 data root는 true). 표 모양이 그대로(키 값)라 migration은 없다. 사본을 못 읽으면 SDK 판은 견주지 않는다.

SDK 감지(`architecture/ui-kit.md`의 "SDK 상태와 감지")가 이 listener의 쓰는 쪽이다. 같은 순간에 다른 일을 하려면 `ctx.productStartListeners`(`wiring/context.ts`)에 `(start: {version, from, changed, sdksChanged}) => void | Promise<void>`를 올린다(build·start에서). marker를 견준 직후 올린 순서대로 부르고, 던져도 core 기동과 다른 listener에 영향이 없다(log만 남는다). `changed`는 판이 바뀐 기동, `from`은 바뀌기 전 판(새 data root·옛 data root는 null), `sdksChanged`는 설치된 SDK 판이 지난 기동과 달랐다(제품 판이 같아도 true일 수 있다)는 뜻이다.

## 흐름

```
 앱 process: notify({ title, body?, key?, persistent? })   (command·operation·flow·시작 코드. 앱 UI view는 못 부른다)
   │ broker /_lophn/broker/notify/send
   ▼
 app supervisor broker: live 자식인가, 지금 release의 선언 ∩ grant에 notify.send가 있나 → 아니면 forbidden
   │ 그 자식의 app credential로
   ▼
 core notices.post (actor app, 앱은 credential이 정한다. 입력에 source·app·kind·action이 없다)
   · 같은 (app, key)의 줄이 있으면 그 줄을 바꾼다. 없으면 새 줄(source app, kind app)
   · 상한을 넘으면 오래된 것부터 지운다: 휘발은 앱마다 50개, 영구는 앱마다 200개(따로 센다)

 core 안 다른 wiring: ctx.noticeRecorder({ kind, params, app?, project?, key?, action? })
   │ core 안 machine 자격(machine:notice-recorder)으로 쓰기 층을 지난다
   ▼
 core notices.record (actor machine만. 사람·agent·앱·renderer는 못 부른다)
   · 글(title·body)은 `program-text.ts`의 고정 template + 매개변수로 만든다. 입력에 글을 싣는 칸이 없다
   · lophn_updated만 app이 없고 나머지는 앱이 있어야 한다. 영구 줄이다

   ▼ commit 뒤 (apps wiring의 after_commit)
 Bus: NoticePosted(줄 한 건) / 휘발 줄이 빠지면 NoticeClosed { id } / 영구 줄이 읽음이 되면 NoticeRead { id, read_at }
   ▼ Gateway
 shell main: toast(lophn 창에 focus) 또는 OS 알림. 누르면 그 앱 공간을 연다
 renderer Inbox: 휘발 줄은 Now의 Notifications에, 안 읽은 영구 줄은 History 탭 머리의 수로 센다. ready 뒤 notices.open으로 맞춘다

 사람: 줄의 [x] → notices.dismiss → 휘발이면 줄 지움(NoticeClosed), 영구이면 read_at만 채움(NoticeRead)
 사람: notices.mark_read { ids } → 영구 줄을 한꺼번에 읽음으로
 앱 보관: 그 앱의 휘발 줄을 지우고, 안 읽은 줄마다 NoticeClosed. 영구 줄은 남는다
```

읽기: `notices.list`(필터 `source`·`app`·`project`·`kind`·`persistent`·`unread`·`query`(title·body 부분 일치)·`since`·`until`(`created_at` 기간. since 포함, until 미포함, ISO 시각)·`cursor`·`limit`(≤200, 기본 50), 최근 것이 먼저, 보관한 앱의 줄도 읽힌다), `notices.open`(안 읽은 줄 전부. Inbox가 쓴다. 보관한 앱의 줄은 뺀다). 쓰기: `notices.post`(app), `notices.record`(machine), `notices.observe_version`(machine), `notices.dismiss`·`notices.mark_read`(user).

## 지키는 것

- 받는 쪽은 사람뿐이다. Bus에서 `NoticePosted`를 받아 일을 하는 core 코드를 두지 않는다. agent에게 알릴 일이면 agent가 앱 tool로 읽는다.
- 권한은 grant `notify.send`(scope 없음)다. 앱이 선언하고 activation 때 사람이 허락한다. broker가 요청마다 지금 release의 선언 ∩ grant를 본다. preview·test 자식과 옛 release의 자식은 거절한다. SDK는 live가 아닌 mode에서 broker를 부르지 않고 `standIn`을 돌려준다.
- 앱은 입력에서 앱도 출처도 종류도 고르지 못한다. 어느 앱의 줄인지는 자식의 app credential이 정한다. app credential이 닿는 operation은 다른 앱 호출과 `notices.post`, `app_tray.set`뿐이다. 앱은 program 줄을 쓰지 못하고 다른 앱의 줄도 쓰지 못한다(`commands_test.ts`).
- program 줄에는 앱이 쓴 글이 들어가지 않는다. 글은 core의 template과 매개변수(짧은 식별자, release 이름, core가 정한 이유 코드)로 만든다. 앱 이름이나 앱 출력을 이유 칸에 그대로 싣지 않는다. 예외 하나: `release_failed`·`app_unavailable`의 reason은 core가 기록한 실패 summary다(release의 `failure.summary`, runtime reason). migration script 실패 summary에는 그 script가 낸 글이 섞일 수 있어 200자로 자른다.
- 같은 key는 대신한다. 주기적으로 같은 사실을 다시 확인하는 앱이 Inbox를 채우지 않게 하려는 것이다. 대신한 줄은 id가 같아 `NoticeClosed` 없이 `NoticePosted`만 다시 나가고, toast도 다시 뜬다. 영구 줄이 읽음이었어도 안 읽음으로 돌아온다.
- 남기는 기간: program 줄은 지우지 않는다. 앱이 영구로 남긴 줄은 앱마다 최근 200개, 휘발 줄은 앱마다 50개다. 고장 난 앱이 표를 끝없이 키우지 못하게 한다.
- 정본은 표다. 줄은 사람이 지우거나(휘발) 상한에 밀리거나 앱이 보관될 때까지(휘발) 재시작을 넘어 남는다. toast는 shell 정책이라 놓친 것을 다시 띄우지 않는다.
- toast·OS 알림 규칙(`wiring/notice.ts`): app 줄은 모두 띄운다. program 줄은 사람이 알아야 하는 `release_failed`·`release_rolled_back`·`app_unavailable`·`app_data_restored`·`sdk_update_needed`만 띄우고 `release_activated`·`app_data_migrated`·`lophn_updated`는 Inbox에만 남긴다. 앱 없는 줄은 `sdk_update_needed`만 띄우고(`lophn_updated`는 Inbox에만) 누르면 Inbox를 연다(NoticeTarget `inbox`). 기동 중에 쓴 줄은 toast가 뜨지 않는다: `afterReady`는 core가 부모(shell main)에게 hello를 보내기 전에 돌아 shell의 event 구독이 아직 없다(놓친 알림은 다시 띄우지 않는다). 그 줄은 배지와 History로만 보인다.
- Inbox(`desktop/connection/waiting/`)는 탭 둘이다. **Now**: 위에 답할 것(승인·질문·동의·공유·job 묶음. 동작은 `approval.md`), 그 아래 **Notifications**(끝난 탭과 휘발 줄. [x]로 지우면 끝), 맨 아래 방금 결정한 줄(`SettledList`는 결정 직후 허락·거절·cancelled를 확인하는 화면 메모리라 기록과 다른 일이라 남겼다). **History**: 영구 줄(`notices.list`의 `persistent: true`)을 최근 것부터 cursor로 잇고 `app`·`project`·종류(`source`나 `kind` 하나)·`query`·기간(`since`·`until`. 필터 바의 `DateRangeFilter`가 고른 달력 날짜를 지역 자정으로 풀어 보낸다. 안 고르면 거르지 않는다)로 거르고 찾는다. 기간도 [Reset filters]로 돌아가고 [Load more]·[Mark all read]는 거른 줄에만 쓴다. 안 읽은 줄은 앞에 점이고 줄 오른쪽 끝에 읽음 단추, action이 있으면 그 단추가 선다. [Mark all read]는 보이는 안 읽은 줄(≤200)을 `notices.mark_read`로 읽음으로 바꾼다. 앱이 있는 줄을 누르면 그 앱이 열린다. History 탭은 열 때 읽고 `NoticePosted`(영구)가 오면 첫 page를 다시 읽으며 `NoticeRead`는 있는 줄만 고친다. 종류 거르기는 core `kind`가 하나만 받아 "앱이 한 것"·"lophn이 한 것"(source)과 program 종류 하나씩이다. project 칸은 program 줄에 아직 project가 없어 비어 있다.
- 배지와 개수: sidebar 배지는 "볼 것"이다(대기 항목 + 끝난 탭 + 휘발 알림 + 안 읽은 영구 기록). 안 읽은 영구 기록도 세는 것은 SDK 업데이트 같은 놓치면 안 되는 program 기록이 배지에 없어서 사람이 몰랐기 때문이다(0.20.0 정정 항목). History 탭 머리의 숫자(`History (2)`)는 그대로다. 읽음으로 바꾸면(줄의 단추, [Mark all read], action 단추) 배지가 준다.
- action 단추: `action.kind`로만 그린다(`open_home_skill`은 [Ask lophn]). 누르면 renderer가 home의 lophn agent로 새 session을 열고(`sessions.open`) 첫 말로 `/<skill> <args>`를 보낸 뒤(`acp.send`, Agent 탭이 첫 말에 하는 것과 같은 source) 그 대화를 열고 줄을 읽음으로 바꾼다(`desktop/connection/waiting/notice-action.ts`). 사람이 누른 것이 명령이라 program이 session을 스스로 여는 것(`event.md`)이 아니고 새 core route도 없다. 앱 줄은 action이 없어 단추가 없다.
- 앱 상세 Activity 탭 위쪽 Records가 그 앱의 영구 줄(최근 20, 보관해도 남은 것)을 보이고 그 아래가 호출 기록이다(`app-frame/app-detail/`).

## 왜 이 모양인가

- 앱 event의 발행·구독이나 event로 시작하는 job을 열지 않고 사람에게 알리기만 열었다. 반응을 믿을 수 있게 하려면 저장, 구독자 cursor, 재시도, 멱등 key가 다시 필요하다(`event.md`가 Reactor를 지운 이유). 사람에게 알리기는 놓쳐도 표가 남아 그 짐이 없다.
- 정책(언제 알릴지, 영구로 남길지)은 앱이 가진다. lophn은 한도나 일정이 무엇인지 모르고 보여 주기만 한다.
- 표를 하나로 합친 것은 사람이 "예전에 release한 것"을 찾아야 하기 때문이다. release 결과는 `releases` 표에만 있어 앱 상세에서만 보였다. 앱 알림과 program 기록을 같은 표에 두면 Inbox 하나가 거르고 찾는다(`products/roadmap/inbox-history-sdk-migration.md`).
- program 줄의 글을 template으로 고정한 것은 앱이 쓴 글이 lophn의 기록처럼 보이는 일을 막으려는 것이다.
- 대신하기는 key로 한다. 앱이 열린 알림을 직접 지우는 길을 두지 않았다. 지우는 것은 사람의 일이다.
- schema step `apps.notices.unified`는 앱 팀 목록이 아니라 목록 맨 뒤 `notices` wiring에 있다. 낸 step 목록의 끝에만 새 step을 붙일 수 있어서다(`schema-steps.lock.json`).

## tray 값

앱이 늘 보이고 싶은 짧은 상태(사용량 앱의 `84%`)는 알림이 아니라 tray 값이다. 앱 process가 `@lophn/cap-notify`(1.1.0부터)의 `setTray({text, tone?})`나 `clearTray()`를 부른다. 계약은 `packages/protocol/apps/tray.ts`, core는 `packages/core/apps/tray/`, 화면은 `packages/shell/renderer/shell/tray/`다.

```
 앱 process: setTray({ text, tone? }) / clearTray()     (text 1~16자, tone은 neutral·good·warn·bad)
   │ broker /_lophn/broker/notify/tray   (live 자식인가, 선언 ∩ grant에 notify.send가 있나 → 아니면 forbidden)
   ▼
 core app_tray.set (memory route, actor app) → 앱마다 마지막 값 하나를 memory map에 둔다 → AppTrayChanged { app }
   ▼ Gateway
 renderer TrayHost: AppTrayChanged와 ready 때 app_tray.list(actor user)로 다시 읽어, 설치된 앱의 `tray` 화면 항목(설정 `shell.tray_off`에 든 것은 뺀다)에 글과 tone을 붙인다
```

- **값은 저장하지 않는다.** core를 다시 켜면 비고, 앱 process가 시작할 때 다시 낸다. 앱 process는 오래 살아 timer로 값을 바꿀 수 있다. 보관한 앱이나 없는 앱의 `set`은 거절하고 `list`는 보관한 앱의 값을 뺀다.
- **권한은 알림과 같은 `notify.send`다.** tray 값도 앱이 사람에게 보이는 것이라 새 permission kind를 두지 않았다. test는 "`notify.send` grant가 없는 앱의 `setTray`는 거절되고 값이 바뀌지 않는다"(`packages/core/apps/permissions/broker/notify_test.ts`).
- **tray 항목은 선언하면 나오고 사람이 끈다.** 설치된 앱이 `tray` 자리 화면을 선언하면 값을 내기 전에도 항목이 생긴다(값이 없으면 아이콘만 보인다). 사람이 Settings › Quick launch의 Tray에서 끄면 그 화면이 설정 `shell.tray_off`(`{app, screen}[]`)에 쌓이고 항목이 빠진다.
