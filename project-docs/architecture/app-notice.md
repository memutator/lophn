# app-notice

사람에게 "답할 것"(승인·질문)이 아닌 것을 알리는 길이다. 저장은 ledger 표 `notices` 하나다. 줄의 출처는 둘이다. **app**: 캘린더의 일정 알림, 사용량 앱의 한도 경고처럼 앱 process가 `@lophn/cap-notify`의 `notify()`로 남긴 알림. **program**: release 켜짐·실패, 앱 멈춤 같은 일을 core가 직접 남긴 기록. 줄은 **휘발**이거나 **영구**다. 휘발 줄은 사람이 지우면 사라지고, 영구 줄은 지워도 읽음으로만 바뀌어 남아 사람이 나중에 찾을 수 있다. 받는 쪽은 사람뿐이다. agent에게 사실을 보내거나 lophn의 반응을 일으키는 길이 아니다. 사람의 폰에 push로 알리는 것(`attention.md`)도 받는 쪽이 사람이다. 같은 SDK package가 앱이 늘 보이고 싶은 짧은 상태(tray 값)와 폰의 홈 화면 위젯의 값도 낸다. 그것은 알림이 아니라 저장하지 않는 값이다.

## 문제

- 앱이 사람에게 닿는 길이 없었다. 캘린더의 "일정 전에 알려 줘"나 사용량 앱의 한도 경고는 갈 곳이 없었다. 앱끼리·job이 서로 반응하게 하는 길은 반응을 믿게 할 장치(저장, 구독자 cursor, 재시도, 멱등 key)가 다시 필요해 처음에는 열지 않았고, 그 첫 단계로 "앱 → 사람" 알림만 열었다. 앱 event(앱 → 앱의 알림)는 그 약속을 하지 않는 길로 나중에 열렸다(`architecture/event.md`). 이 문서의 알림과는 받는 쪽(사람이 아니라 앱)과 저장(없음)이 다르다.
- core는 사람에게 알릴 길이 없었다. release 결과, 앱 멈춤, data migration, lophn 업데이트가 어디에도 남지 않아 사람이 "예전에 release한 것"을 찾을 수 없었다. release 결과는 `releases` 표에만 있어 앱 상세에서만 보였다.
- 알림이 모두 휘발이면 지우는 순간 사라진다. 놓치면 안 되는 기록(SDK 업데이트 필요 같은 것)과 지나가는 알림(수마다 뜨는 일정 알림)을 같은 취급으로 둘 수 없다.
- 앱이 쓴 글이 lophn의 기록처럼 보이면 안 된다. 또 주기적으로 같은 사실을 다시 확인하는 앱, 고장 난 앱이 목록과 표를 채우면 안 된다.

## 목표와 비목표

- 목표: 앱과 core가 사람에게 알리고, 사람이 Inbox에서 지우거나 나중에 찾는다. 영구/휘발은 알리는 쪽이 고른다(앱은 기본이 휘발). 알림은 재시작을 넘어 남는다.
- 목표: 앱 알림과 program 기록을 같은 표에 두어 Inbox 하나가 거르고 찾는다.
- 비목표: 알림에 반응하는 길. core 로직도 agent도 알림에 반응하지 않는다. 앱 event(`architecture/event.md`)는 알림을 거치지 않는 별개의 길이고, event로 도는 job은 2026-11-11에 별개의 길로 열렸다(`architecture/job.md`. 사람이 승인한 job이 도는 것이고 알림에는 반응하지 않는다).
- 비목표: 앱이 열린 알림을 스스로 거두는 길. 같은 key로 덮는 것만 있다. 지우는 것은 사람의 일이다.
- 비목표: 정책. 언제 알릴지, 영구로 남길지는 앱이 가진다. lophn은 한도나 일정이 무엇인지 모르고 보여 주기만 한다.
- 비목표: 놓친 toast를 다시 띄우는 것. toast는 shell 정책이고 정본은 표다.

## 모델

### 줄

`notices`의 한 줄:

| 칸 | 뜻 |
|---|---|
| `id` | `ntc_…` |
| `source` | `app` 또는 `program` |
| `app` | nullable. lophn 전체에 관한 기록은 null |
| `project` | nullable. program 줄에는 아직 project가 없어 비어 있다 |
| `kind` | app 줄은 `app`. program 줄은 아래 목록 |
| `key` | nullable. 같은 사실을 대신하는 데 쓴다 |
| `title`(≤120), `body`(≤500) | 사람이 읽는 글 |
| `persistent` | 영구 여부 |
| `action` | nullable JSON. 줄을 누르면 할 일 |
| `created_at`, `read_at` | `read_at`은 nullable(안 읽음) |

- **program kind**: `release_activated`, `release_failed`, `release_rolled_back`, `app_unavailable`, `app_data_migrated`, `app_data_restored`, `lophn_updated`, `sdk_update_needed`, `session_stopped_by_app`, `phone_changed`, `app_sync_away`. `lophn_updated`·`sdk_update_needed`·`phone_changed`는 앱이 없고 나머지는 앱이 있다. kind 목록은 계약(protocol의 schema)이 정하고 표에는 CHECK를 걸지 않아 종류를 더해도 표를 다시 짜지 않는다.
- **action**: 지금은 `{kind: "open_home_skill", skill, args}` 하나다. 화면은 종류로만 그리고 실행한다. app 줄은 action이 없다(앱이 home skill을 열 수 없다).
- **key와 대신하기**: 같은 `(source, app, key)`는 줄 하나다(key가 있을 때. 앱 없는 program 줄끼리도 같다). 새로 오면 그 줄의 내용·시각·`persistent`·`action`을 바꾸고 안 읽음으로 되돌린다(id 그대로). 영구 줄이 읽음이었어도 안 읽음으로 돌아온다.
- **수명**: program 줄은 늘 영구이고 DB trigger가 지우기를 막는다. 앱 줄만 command가 지운다. 앱 줄은 휘발과 영구를 따로 세어 앱마다 휘발 50개, 영구 200개까지이고 넘으면 오래된 것부터 지운다. 앱을 보관하면 그 앱의 휘발 줄이 지워지고 영구 줄은 남는다(보관한 앱의 줄도 `notices.list`로 읽히고 Inbox의 열린 목록에서는 빠진다). 앱을 영구히 지우면(`app.delete`) 그 앱의 app 줄은 영구 줄까지 지워지고 program 줄은 trigger 때문에 남는다.
- **옛 표**: 옛 표 `app_notices`는 ledger step `apps.notices.unified`가 줄을 앱이 쓴 휘발·안 읽은 줄로 옮기고 지웠다.

### program 줄이 생기는 곳

| kind | 언제 | key |
|---|---|---|
| `release_activated` | release가 켜짐 | 없음 |
| `release_rolled_back` | 이미 켜졌던 release를 다시 켬(사람이 이전으로 돌아감). params는 지금까지 켜 있던 release와 돌아간 release | 없음 |
| `release_failed` | activation 실패. 복원했으면 reason에 이전 release로 돌아갔다는 말이 붙는다 | 없음 |
| `app_unavailable` | 앱이 사용 불가가 됨(시작 실패, crash loop, 예기치 않은 종료, activation의 복원 실패·종료 확인 불가). 같은 사실의 재전송은 쓰지 않는다 | `app_unavailable`(앱마다 한 줄. 되풀이되면 그 줄을 안 읽음으로 되돌린다) |
| `app_data_migrated`, `app_data_restored` | 앱 data migration이 적용됨, 백업에서 복원됨. 복원은 새로 기록할 때만 | 없음 |
| `lophn_updated` | 제품 판이 바뀐 기동(아래 "제품 판 marker") | 없음 |
| `phone_changed` | 사람의 기준 폰이 바뀜(새 pairing이나 기준 바꾸기. `devices`의 `is_primary` 기기 id가 core가 마지막으로 본 id와 달라짐, 지운 뒤 다른 기기가 기준이 된 것 포함. 이름 바꾸기와 연결 갱신은 id가 같아 알리지 않는다). 폰 화면(`places`에 `phone`)을 가진 활성 앱이 하나 이상일 때만 앱 없는 줄 하나 | `phone_changed`(되풀이를 한 줄로 합친다) |
| `app_sync_away` | sync 폴더로 data를 주고받는 앱(`sync_to`)이 이 컴퓨터에서 다른 기계의 흔적 정리 경계(horizon) 밖으로 떨어졌거나, 내보내기가 이 컴퓨터의 변경을 held로 두었음(`architecture/folder-sync.md`). held 수가 늘면 다시 쓴다. 떨어져 있음이 끝나거나 사람이 held를 풀어 수가 줄면 같은 줄을 "따라잡았다"로 바꾼다 | `app_sync_away`(앱마다 한 줄) |
| `sdk_update_needed` | 제품 판이나 설치된 SDK 판이 바뀐 기동의 SDK 감지(`architecture/ui-kit.md`의 "SDK 상태 read"와 "SDK 업데이트 감지와 맡기기"). 필수 SDK가 있거나 아직 검토하지 않은 SDK 메모(`unreviewed`)가 있는 앱이 하나라도 있을 때 앱 없는 줄 하나 | `sdk_update_needed`(다음 기동이 개수를 새로 쓰고 안 읽음으로 되돌린다) |

`sdk_update_needed`의 params는 `{required, available}`(옮겨야 하는 앱 수, 필수는 아니지만 home이 아직 검토하지 않은 새 메모가 있는 앱 수)이고 글은 "SDK updates for your apps" / "3 apps must update, 2 can use new SDK features."이다. action은 `open_home_skill` `update-apps` + 빈 args(전체)다. 앱마다 줄을 만들지 않는 것은 각 앱을 두고 갈지 올릴지(그리고 새 SDK 기능을 쓸지) 숲으로 보는 일이 사람이 아니라 home lophn의 몫이기 때문이다. 앱마다 있던 옛 `sdk_update_needed` 줄(앱 있음)은 program 줄이라 지울 수 없어 남고 단추도 그대로 동작한다.

`app_sync_away`의 params는 `{held, back?}`(풀리지 않은 held 변경 수, 따라잡았으면 `back: true`)이다. 글은 떨어져 있을 때 "This app was away from your other computers too long" / "2 changes are held on this computer. Ask the app's agent to apply or discard them.", 따라잡았으면 "This app caught up with your other computers" / "It is no longer away. 1 change is still held on this computer. …"(없으면 "Nothing is held.")이다. action은 없다: held는 사람이 그 앱의 agent에게 맡겨 `lophn app sync-held`로 푼다. core의 folder wiring이 내보내기 run 앞뒤의 떨어져 있음(ledger)과 held 수를 보고 `noticeRecorder`로 쓴다. program 줄은 지울 수 없어서 "떨어져 있었다"를 거두는 길이 같은 key 줄을 바꾸는 것이다. 마지막으로 알린 held 수는 core 메모리라 재시작하면 잊는다(이슈 `folder-away-notice-count-in-memory`).

`phone_changed`의 params는 `{apps}`(폰 화면이 있는 활성 앱 수)이고 글은 "Your phone changed" / "2 apps have phone screens drawn for the old phone. Ask lophn to redraw them."이다. action은 없다. 알리기만 하고 자동으로 다시 그리지 않는다(옛 폰 크기로 그린 화면을 새 크기로 다시 그리는 일은 사람이 lophn에게 맡긴다). core 안에서 Bus의 `remote_devices` `StateChanged`를 보고 `noticeRecorder`로 쓴다. 마지막으로 본 기준 id는 메모리에만 둔다(core가 시작할 때 지금 값). pairing은 core가 켜져 있어야 하므로 꺼진 사이의 변경은 없다.

release·data·runtime command는 상태를 바꾸는 자기 transaction 안에서 줄을 쓴다. 상태 변경과 줄이 한 commit이라 한쪽만 남지 않고, 응답을 잃은 재전송이 줄을 늘리지 않는다. 이미 commit된 뒤 core 안 다른 곳이 쓸 때는 core 안 machine 자격(`machine:notice-recorder`)으로 `notices.record`를 부른다. 그 길은 transaction 안에서 부르면 안 된다(쓰기 층을 따로 지난다).

### 제품 판 marker

`core_meta`(ledger step `apps.notices.product-version`)의 `product_version` 한 줄이 data root가 마지막으로 돈 제품 판이다. core가 켜져 ready가 된 뒤 root `package.json`의 `version`(개발은 repo root, 설치본은 `platform/package.json`)을 `notices.observe_version {version, fresh, sdks?}`로 낸다. 한 transaction에서 marker를 새 판으로 바꾸고, 판이 다르면 `lophn_updated {from, to}`를 쓴다(SDK 갱신 수는 싣지 않는다. 그 일은 `sdk_update_needed` 줄 하나가 한다). 새 data root(`fresh`: 이번 기동이 step을 전부 새로 적용했다)는 marker만 적는다. marker 없이 있던 옛 data root가 처음 켜지면 `from`을 모른 채(`unknown`) 한 번 쓴다.

같은 표의 `sdk_versions` 한 줄은 마지막으로 본 설치 SDK 판(part → 가장 높은 판, 정렬한 JSON)이다. 기동 때 `<data root>/sdk`의 설치 사본에서 읽어 `observe_version`의 `sdks`로 같이 내고, 적힌 것과 다르면 새로 적고 `sdks_changed`를 true로 돌려준다(행은 남기지 않는다. 새 data root는 적기만 하고 false, 적힌 것이 없던 옛 data root는 true). 표 모양이 그대로(키 값)라 migration은 없다. 사본을 못 읽으면 SDK 판은 견주지 않는다.

SDK 감지가 이 신호의 쓰는 쪽이다. core 안 다른 일이 같은 순간에 일하려면 시작 listener를 올린다. marker를 견준 직후 올린 순서대로 부르고 `{version, from, changed, sdksChanged}`를 받는다. 던져도 core 기동과 다른 listener에 영향이 없다(log만 남는다). `changed`는 판이 바뀐 기동, `from`은 바뀌기 전 판(새 data root·옛 data root는 null), `sdksChanged`는 설치된 SDK 판이 지난 기동과 달랐다(제품 판이 같아도 true일 수 있다)는 뜻이다.

### 흐름

```
 앱 process: notify({ title, body?, key?, persistent? })   (command·operation·flow·시작 코드. 앱 UI view는 못 부른다)
   │ broker /_lophn/broker/notify/send
   ▼
 app supervisor broker: live 자식인가, 지금 release의 선언 ∩ grant에 notify.send가 있나 → 아니면 forbidden
   │ 그 자식의 app credential로
   ▼
 core notices.post (actor app. 앱은 credential이 정한다. 입력에 source·app·kind·action이 없다)
   · 같은 (app, key)의 줄이 있으면 그 줄을 바꾼다. 없으면 새 줄(source app, kind app)
   · 상한을 넘으면 오래된 것부터 지운다(휘발 앱마다 50, 영구 앱마다 200, 따로 센다)

 core 안 다른 곳: machine 자격으로 notices.record(kind, params, app?, project?, key?, action?)
   · actor machine만. 사람·agent·앱·renderer는 못 부른다
   · 글(title·body)은 core의 고정 template + 매개변수로 만든다. 입력에 글을 싣는 칸이 없다
   · 영구 줄이다

   ▼ commit 뒤
 Bus: NoticePosted(줄 한 건) / 휘발 줄이 빠지면 NoticeClosed { id } / 영구 줄이 읽음이 되면 NoticeRead { id, read_at }
   ▼ Gateway
 shell main: toast(lophn 창에 focus) 또는 OS 알림. 누르면 그 앱 공간을 연다(앱 없는 줄은 Inbox)
 renderer Inbox: 휘발 줄은 Now의 Notifications에, 안 읽은 영구 줄은 배지와 History 탭 머리의 수로 센다. ready 뒤 notices.open으로 맞춘다
 core 주의(attention): 안 읽은 앱 줄과 알려야 하는 program 기록이면 보고 있지 않은 폰에 push(제목만). 누르면 그 앱, 앱 없는 줄은 Inbox

 사람: 줄의 [x] → notices.dismiss → 휘발이면 줄 지움(NoticeClosed), 영구이면 read_at만 채움(NoticeRead)
 사람: notices.mark_read { ids } → 영구 줄을 한꺼번에 읽음으로
 앱 보관: 그 앱의 휘발 줄을 지우고, 안 읽은 줄마다 NoticeClosed. 영구 줄은 남는다
```

### Inbox

Inbox는 탭 둘이다.

- **Now**: 위에 답할 것(승인·질문·동의·공유·job 묶음. 동작은 `architecture/approval.md`), 그 아래 **Notifications**(끝난 탭과 휘발 줄. [x]로 지우면 끝), 맨 아래 방금 결정한 줄. 방금 결정한 줄은 결정 직후 허락·거절·cancelled를 확인하는 화면 메모리라 기록과 다른 일이어서 남겼다.
- **History**: 영구 줄(`notices.list`의 `persistent: true`)을 최근 것부터 cursor로 잇는다. `app`·`project`·종류(`source`나 `kind` 하나)·`query`·기간(`since`·`until`)으로 거르고 찾는다. 기간은 사람이 고른 달력 날짜를 지역 자정으로 풀어 보낸다. 안 고르면 거르지 않는다. [Reset filters]는 기간도 되돌리고 [Load more]·[Mark all read]는 거른 줄에만 쓴다. 안 읽은 줄은 앞에 점이고 줄 오른쪽 끝에 읽음 단추가 있고, action이 있으면 그 단추가 선다. [Mark all read]는 보이는 안 읽은 줄(≤200)을 `notices.mark_read`로 읽음으로 바꾼다. 앱이 있는 줄을 누르면 그 앱이 열린다. History 탭은 열 때 읽고 `NoticePosted`(영구)가 오면 첫 page를 다시 읽으며 `NoticeRead`는 있는 줄만 고친다. 종류 거르기는 core `kind`가 하나만 받아 "앱이 한 것"·"lophn이 한 것"(source)과 program 종류 하나씩이다. project 칸은 program 줄에 아직 project가 없어 비어 있다.
- **배지**: sidebar 배지는 "볼 것"이다(대기 항목 + 끝난 탭 + 휘발 알림 + 안 읽은 영구 기록). History 탭 머리의 숫자(`History (2)`)도 그대로 있다. 읽음으로 바꾸면(줄의 단추, [Mark all read], action 단추) 배지가 준다.
- **action 단추**: `action.kind`로만 그린다(`open_home_skill`은 [Ask lophn]). 누르면 renderer가 home의 lophn agent로 새 session을 열고(`sessions.open`) 첫 말로 `/<skill> <args>`를 보낸 뒤(`acp.send`, Agent 탭이 첫 말에 하는 것과 같은 source) 그 대화를 열고 줄을 읽음으로 바꾼다. 사람이 누른 것이 명령이라 program이 session을 스스로 여는 것(`architecture/event.md`)이 아니고 새 core route도 없다.
- 앱 상세 Activity 탭 위쪽 Records가 그 앱의 영구 줄(최근 20, 보관해도 남은 것)을 보이고 그 아래가 호출 기록이다.

### tray 값

앱이 늘 보이고 싶은 짧은 상태(사용량 앱의 `84%`)는 알림이 아니라 tray 값이다. 앱 process가 `@lophn/cap-notify`(1.1.0부터)의 `setTray({text, tone?})`나 `clearTray()`를 부른다. text는 1~16자, tone은 `neutral`·`good`·`warn`·`bad`(기본 neutral)다.

```
 앱 process: setTray({ text, tone? }) / clearTray()
   │ broker /_lophn/broker/notify/tray   (live 자식인가, 선언 ∩ grant에 notify.send가 있나 → 아니면 forbidden)
   ▼
 core app_tray.set (memory route, actor app) → 앱마다 마지막 값 하나를 memory에 둔다 → StateChanged(tray)
   ▼ Gateway
 renderer: tray 변경(StateChanged)과 ready 때 app_tray.list(actor user)로 다시 읽어, 설치된 앱의 `tray` 자리 화면 항목에 글과 tone을 붙인다
```

- 값은 저장하지 않는다. core를 다시 켜면 비고, 앱 process가 시작할 때 다시 낸다. 앱 process는 오래 살아 timer로 값을 바꿀 수 있다. 보관한 앱이나 없는 앱의 `set`은 거절하고 `list`는 보관한 앱의 값을 뺀다.
- 항목은 선언하면 나오고 사람이 끈다. 설치된 앱이 `tray` 자리 화면을 선언하면 값을 내기 전에도 항목이 생긴다(값이 없으면 아이콘만 보인다). 사람이 Settings › Quick launch의 Tray에서 끄면 그 화면이 설정 `shell.tray_off`(`{app, screen}[]`, 최대 20, 기본 `[]`)에 쌓이고 항목이 빠진다. 같은 곳의 위·아래 단추로 순서를 옮기면 그때 보이는 줄 전부의 순서가 `shell.tray_order`(`{app, screen}[]`, 최대 64, 기본 `[]`)에 쓰인다. 거기 없는 화면(새로 설치한 앱)은 뒤에 선언 순서로 선다. 보일 항목이 하나도 없으면 아무것도 그리지 않는다(값도 읽지 않는다).
- popup 크기는 화면 선언의 `tray`(`width`·`height`, 숫자면 고정이고 `{min?, max?}`면 내용에 맞춘다)로 앱이 정한다(`architecture/app-call.md`). 값(`setTray`)과 별개다. 내용에 맞추는 popup은 처음 열 때 앱 page가 내용 크기를 알릴 때까지(길어야 0.6초) 보이지 않게 그리고, 항목마다 마지막 내용 크기를 창 메모리에 두어 다시 열면 처음부터 그 크기로 뜬다. 기본 크기로 떴다가 줄어드는 것을 보이지 않는다.

### 위젯 값

폰의 홈 화면 위젯에 보이는 값도 tray 값처럼 알림이 아니라 저장하지 않는 값이다. 앱이 선언(`widgets`: 최대 4개 `{key, label, screen?}`)한 위젯마다 앱 process가 `@lophn/cap-notify`(1.3.0부터)의 `setWidget(key, {v: 1, rows})`나 `clearWidget(key)`를 부른다. 값은 정해진 node 넷(`text`, `stat`, `progress`, `list`)의 data 1~6줄이고 JSON으로 4096 byte까지다.

```
 앱 process: setWidget(key, value) / clearWidget(key)
   │ broker /_lophn/broker/notify/widget   (live 자식인가, 선언 ∩ grant에 notify.send가 있나 → 아니면 forbidden)
   ▼
 core app_widget.set (memory route, actor app) → (앱, key)마다 마지막 값과 받은 시각을 memory에 둔다 → StateChanged(widgets)
   ▼ Gateway(폰 gate)
 폰: 연결된 동안 StateChanged와 앱이 앞에 올 때, 위젯의 새로 하기 때 app_widgets/list(actor user)로 읽어 cache에 쓰고 native 위젯이 그린다
```

- 값은 저장하지 않는다. core를 다시 켜면 비고 앱 process가 시작할 때 다시 낸다. 값을 받는 쪽은 사람이 홈 화면에 놓은 위젯뿐이다. 보관한 앱이나 없는 앱의 `set`은 거절하고(`conflict`, `not_found`) 선언에 없는 key는 `invalid_input`이다. `list`는 보관한 앱의 값과 선언에서 빠진 key의 값을 내지 않는다.
- 위젯의 모양과 폰이 새로 하는 길, 놓기는 `architecture/phone-home-screen.md`다. 위젯 값은 push로 가지 않는다(앱 내용이 Expo와 Google을 지나지 않는다).

## 지키는 것

1. 받는 쪽은 사람뿐이다. Bus에서 `NoticePosted`를 받아 사람이 아닌 쪽에 일을 하는 core 코드를 두지 않는다. 예외는 하나다: 주의(`attention.md`)가 `NoticePosted`를 받아 사람의 폰에 push를 보낸다. 받는 쪽이 사람이라 이 약속을 깨지 않는다. agent에게 알릴 일이면 agent가 앱 tool로 읽는다. 다른 앱에 알릴 일은 알림이 아니라 앱 event다.
2. 권한은 grant `notify.send`(scope 없음)다. 앱이 선언하고 activation 때 사람이 허락한다. broker가 요청마다 지금 release의 선언 ∩ grant를 본다. preview·test 자식과 옛 release의 자식은 거절한다. SDK는 live가 아닌 mode에서 broker를 부르지 않고 `standIn`을 돌려준다. tray 값과 위젯 값도 같은 권한이다. grant가 없는 앱의 `setTray`와 `setWidget`은 거절되고 값이 바뀌지 않는다.
3. 앱은 입력에서 앱도 출처도 종류도 고르지 못한다. 어느 앱의 줄인지는 자식의 app credential이 정한다. app credential이 닿는 operation은 다른 앱 호출, `notices.post`, `app_tray.set`, `app_widget.set`, 앱 event 발행(`app_events.publish`), 폰에 묻는 `app_phone.request`(`remote.md`)뿐이다. 앱은 program 줄을 쓰지 못하고 다른 앱의 줄도 쓰지 못한다.
4. program 줄에는 앱이 쓴 글이 들어가지 않는다. 글은 core의 template과 매개변수(짧은 식별자, release 이름, core가 정한 이유 코드)로 만든다. 앱 이름이나 앱 출력을 이유 칸에 그대로 싣지 않는다. 예외 하나: `release_failed`·`app_unavailable`의 reason은 core가 기록한 실패 summary다(release의 `failure.summary`, runtime reason). migration script 실패 summary에는 그 script가 낸 글이 섞일 수 있어 200자로 자른다.
5. 같은 key는 대신한다. 주기적으로 같은 사실을 다시 확인하는 앱이 Inbox를 채우지 않게 하려는 것이다. 대신한 줄은 id가 같아 `NoticeClosed` 없이 `NoticePosted`만 다시 나가고, toast도 다시 뜬다. 영구 줄이 읽음이었어도 안 읽음으로 돌아온다.
6. program 기록은 상태를 바꾸는 command와 같은 transaction에서 쓴다. 상태만 바뀌고 줄이 없거나 줄만 있는 일이 없고, 재전송이 줄을 늘리지 않는다.
7. 남기는 기간: program 줄은 지우지 않는다. 앱이 영구로 남긴 줄은 앱마다 최근 200개, 휘발 줄은 앱마다 50개다. 고장 난 앱이 표를 끝없이 키우지 못하게 한다.
8. 정본은 표다. 줄은 사람이 지우거나(휘발) 상한에 밀리거나 앱이 보관될 때까지(휘발) 재시작을 넘어 남는다. toast는 shell 정책이라 놓친 것을 다시 띄우지 않는다.
9. toast·OS 알림 규칙: app 줄은 모두 띄운다. program 줄은 사람이 알아야 하는 `release_failed`·`release_rolled_back`·`app_unavailable`·`app_data_restored`·`sdk_update_needed`·`session_stopped_by_app`·`phone_changed`·`app_sync_away`만 띄우고 `release_activated`·`app_data_migrated`·`lophn_updated`는 Inbox에만 남긴다. 앱 없는 줄은 `sdk_update_needed`·`phone_changed`만 띄우고(`lophn_updated`는 Inbox에만) 누르면 Inbox를 연다.
10. 기동 중에 쓴 줄은 toast가 뜨지 않는다. core가 `ready`를 내기 전에 쓴 줄이라 shell이 아직 connect하지 못했고 event 구독이 없다(놓친 알림은 다시 띄우지 않는다). shell 없이 도는 core(앱을 Quit한 뒤, CLI나 로그인 시작이 띄운 core)가 쓴 줄도 같다. 그 줄은 배지와 History로만 보인다.
11. `kind`·`action`이 가리키는 일은 사람이 단추를 눌러야 시작된다. program이 session을 스스로 열지 않는다.
12. tray 값과 위젯 값은 저장하지 않는다. 알림과 달리 재시작 뒤 다시 내는 것은 앱 몫이다.
13. 못 본 turn 끝(`unseen`)은 notice 줄이 아니고 core가 든다. desktop은 `unseen/list`로 읽고 `unseen/dismiss`로 지우기만 하며 StateChanged의 `unseen`이 오면 다시 읽는다. 서고 꺼지는 규칙과 폰에서 읽으면 desktop 점이 꺼지는 것은 `attention.md`가 맡는다. shell main은 못 본 끝을 들지 않는다.
14. 폰 push의 계기가 되는 `NoticePosted`는 안 읽은 앱 줄과 사람이 알아야 하는 program 기록(`release_failed`·`release_rolled_back`·`app_unavailable`·`app_data_restored`·`sdk_update_needed`)이다. 글에는 notice의 제목만 싣고 본문을 싣지 않는다.

## 경계와 계약

- **route**: `notices.post`(actor app, 자기 앱만), `notices.record`·`notices.observe_version`(machine), `notices.dismiss`·`notices.mark_read`(user), `notices.list`·`notices.open`(user·machine). tray는 memory route `app_tray.set`(app)·`app_tray.list`(user), 위젯 값은 memory route `app_widget.set`(app)·`app_widgets.list`(user, 폰이 부른다).
  - `notices.list`: 필터 `source`·`app`·`project`·`kind`·`persistent`·`unread`·`query`(title·body 부분 일치)·`since`·`until`(`created_at` 기간. since 포함, until 미포함, ISO 시각)·`cursor`·`limit`(≤200, 기본 50). 최근 것이 먼저이고 보관한 앱의 줄도 읽힌다.
  - `notices.open`: 안 읽은 줄 전부(휘발 + 안 읽은 영구). Inbox가 쓴다. 보관한 앱의 줄은 뺀다.
  - `notices.mark_read`: 영구 줄을 읽음으로. 휘발·이미 읽은·없는 id는 건너뛰고 오류가 아니다.
- **event(남지 않는다)**: `NoticePosted`(줄 한 건), `NoticeClosed { id }`, `NoticeRead { id, read_at }`. tray 값이 바뀌면 `StateChanged`의 `tray`, 위젯 값이 바뀌면 `widgets`(`architecture/event.md`).
- **SDK**: `@lophn/cap-notify`. `notify({ title, body?, key?, persistent? })`(1.2.0부터 persistent. 기본은 휘발), `setTray`·`clearTray`(1.1.0부터), `setWidget`·`clearWidget`(1.3.0부터). broker 경로는 `/_lophn/broker/notify/send`, `/_lophn/broker/notify/tray`, `/_lophn/broker/notify/widget`이다.
- **grant**: `notify.send`(scope 없음). Access 탭에 "notifications" 줄로 보이고 거둘 수 있다.
- **ledger**: 표 `notices`, 표 `core_meta`(`product_version`, `sdk_versions`). step `apps.notices.unified`는 앱 팀 목록이 아니라 `notices` wiring에 있다(낸 때 step 목록의 끝에 붙어야 했다). 그 뒤에 낸 step은 이 wiring이 아니라 WIRINGS 맨 뒤 wiring에 붙는다.
- **설정**: `shell.tray_off`, `shell.tray_order`. 앱을 지우면(`app.delete`) 둘에서 그 앱이 빠진다.
- **shell main**: toast·OS 알림 규칙(위 "지키는 것" 9)과 NoticeTarget(`app` 그 앱 공간, `inbox`)이다. 창과 잇는 IPC channel은 `shell:notice-visible`(그 session 탭이나 앱 화면이 창에 보이는지), `shell:notice-open`(toast를 눌렀다), `shell:notice-toast`와 `shell:notice-reveal`(main이 창에 보낸다)뿐이다. 못 본 끝을 나르던 `shell:notice-unseen-get`, `shell:notice-unseen`, `shell:notice-dismiss`는 없다. renderer가 core의 `unseen/list`와 `unseen/dismiss`를 직접 부른다. shell main은 보이는 것을 core에도 알린다(`presence/report`).
- **화면 선언**: `tray` 자리와 `tray: {width?, height?}`는 `architecture/app-call.md`의 선언 계약이다.

## 결정

- 앱이 사람에게 알리기를 가장 먼저 열고(그때는 앱 event의 발행·구독과 event로 시작하는 job을 열지 않았다), 받는 쪽은 사람뿐이다. 앱 event는 2026-11-10에 저장·cursor·재시도 없는 알림으로 열렸다(`architecture/event.md`). 그래도 알림(`notices`)이 받는 쪽은 여전히 사람뿐이다. event로 도는 job은 2026-11-11에 열렸는데 저장·cursor·재시도 없이 켜져 있는 동안 온 event에만 반응하는 약속이라 알림과 다른 길이다(`architecture/job.md`). 사람에게 알리기는 놓쳐도 표가 남아 그 짐이 없다. 앱 event를 이야기하다 가장 실용적인 첫 단계로 골랐다. (사람, 2026-11-05. "받는 쪽은 사람뿐"은 agent 추천을 사람이 받음)
- 정책(언제 알릴지, 영구로 남길지)은 앱이 가진다. lophn은 보여 주기만 한다. (agent)
- 앱 알림은 Inbox에서 답할 것과 따로 두고, 표에 남기고, 같은 key는 대신한다. 이유: 주기적으로 같은 사실을 확인하는 앱이 목록을 채우지 않게. 앱이 열린 알림을 직접 지우는 길은 두지 않았다. (agent 추천을 사람이 받음)
- Inbox는 답할 것·알림(휘발)·기록(영구) 셋이다. 앱 알림도 영구/휘발을 고르고 기본은 휘발이다. 이유: 사람이 지난 release 같은 것을 찾을 수 있어야 하고 영구와 휘발을 가르고 싶어 했다. (사람, 2026-11-07)
- 앱 알림과 program 기록을 표 하나로 합친다. 이유: release 결과가 `releases` 표에만 있어 앱 상세에서만 보였다. 한 표면 Inbox 하나가 거르고 찾는다. (사람, 2026-11-07. `products/roadmap/inbox-history-sdk-migration.md`)
- program 기록은 지우지 않고 앱 영구 알림은 앱마다 200개로 자른다. (agent가 추천하고 사람이 받음)
- 같은 key는 영구 줄이어도 덮어쓰고 안 읽음으로 되돌린다. 그래서 key는 앱 멈춤처럼 상태를 나타내는 기록에만 쓴다. (agent)
- program 기록은 상태를 바꾸는 command의 transaction 안에서 쓴다. 재전송과 끊김에서 빠지거나 늘지 않는다. (agent)
- program 줄의 글은 core의 template으로 고정한다. 이유: 앱이 쓴 글이 lophn의 기록처럼 보이는 일을 막는다. (agent)
- 안 읽은 영구 기록도 sidebar 배지에 센다. 이유: 알림의 목적은 사람이 알게 하는 것이고, SDK 업데이트 같은 놓치면 안 되는 program 기록이 배지에 없어 사람이 몰랐다. 처음에는 "기록은 나중에 찾는 것이고 급한 것은 toast가 맡는다"며 세지 않았으나 뒤집었다. 버린 안: 줄마다 단추를 두고 배지에서 빼는 것. (사람, 2026-11-07)
- SDK 업데이트 줄은 앱 없이 하나다. 필수와 가능을 한 줄에 세고, 가능만 있어도 쓴다(앱 상세 Version 탭과 별개로 새 기능을 채택할지 판단하게 하려는 것). 가능은 "새 판이 있는 앱"이 아니라 "검토하지 않은 새 메모가 있는 앱"이다: home이 그대로 두기로 한 앱이 판이 바뀔 때마다 계속 세어지지 않는다(2026-11-11). 이유: 각 앱을 두고 갈지 올릴지, 새 기능을 쓸지 숲으로 보는 일은 사람이 아니라 home lophn의 몫이다. 사람은 SDK 변화가 무엇을 깨고 무엇을 가능하게 했는지 판단하지 못한다. 줄마다 [Ask lophn]이 있으면 home을 거칠 이유가 없다. 버린 안: 앱마다 줄과 단추(0.20.0 첫 모양). 새 kind를 만들지 않고 `sdk_update_needed`를 앱 없이 다시 썼다. (줄 하나·home이 숲을 봄·배지: 사람, 2026-11-07. 가능만 있어도 쓴다: 사람. kind 재사용과 필수·가능 한 줄: agent)
- 앱 없는 program 줄 중 `sdk_update_needed`와 `phone_changed`만 toast로 띄운다. (agent)
- 사람의 폰 push는 알림의 새 받는 쪽이 아니라 같은 사람에게 닿는 또 하나의 길이다. 그래서 "받는 쪽은 사람뿐이다"를 지키며 core가 `NoticePosted`를 받는 예외를 하나 둔다(주의). 이유: 앱의 `notify()`와 program 기록이 desktop 앞에 없는 사람에게 닿으려면 core가 보고 있는 기기를 알고 보내야 한다. 버린 안: shell main이 폰에 보내기(shell이 꺼져 있으면 폰에 닿지 않는다). (agent)
- 못 본 turn 끝(`unseen`)은 `notices` 표에 넣지 않고 core 메모리에 둔다. 이유: 보고 있는 host가 바뀌면 꺼지는 순간의 상태라 기록이 아니다. 폰에서 읽으면 desktop 점도 꺼져야 해서 정본이 shell main 메모리일 수 없었다. 버린 안: shell main이 들고 폰이 별도로 세기(점이 둘로 갈린다). (agent)
- tray 값은 새 SDK package·permission 없이 `@lophn/cap-notify`와 `notify.send`로 내고 core는 memory에만 둔다. 이유: tray 값도 앱이 사람에게 보이는 것이고, 앱 process가 오래 살아 timer로 값을 다시 낼 수 있어 저장이 필요 없다. 새 permission kind를 두지 않았다. (agent)
- 위젯 값도 새 permission 없이 `notify.send`로 내고 core는 memory에만 둔다. 이유: tray와 같다. 위젯 값도 앱이 사람에게 보이는 것이고 보이는 것은 사람이 위젯을 놓는 일이라 새 동의가 따로 필요 없다. 값의 모양은 정해진 node 넷으로 좁혔다(위젯은 Android의 `RemoteViews`로만 그려져 앱이 모양을 정할 수 없다). 버린 안: 위젯용 SDK part와 permission, 값의 저장(폰이 마지막 값을 cache로 갖고 앱이 시작할 때 다시 낸다). (agent)
- tray는 OS tray가 아니라 lophn 창 안의 것이다. 앱·sidebar panel·전역 float처럼 앱이 채우고 lophn은 자리만 준다. (사람)
- tray 항목은 켜는 쪽이 아니라 끄는 쪽(`shell.tray_off`)을 저장한다. 이유: 새로 설치한 앱이 목록 갱신 없이 바로 나온다. 옛 켠 목록(`shell.tray`)은 끈 목록의 보수로 옮기지 않고 지웠다(설치된 앱 전체를 알 수 없는 data step에서 보수를 만들 수 없다). (사람. 지움: agent)
- 순서는 끈 것 목록과 따로 `shell.tray_order` key를 둔다. 이유: 끈 것만 쌓는 모양을 그대로 두어 migration이 없다. (agent)
- tray popup 크기는 앱이 선언에 숫자나 범위로 직접 적고 실행 중 바꾸는 길(`setTray`·hook)은 두지 않는다. 이유: 열린 popup이 출렁인다. 범위 밖 값은 줄여 받지 않고 선언 오류로 거절해 앱 agent가 release 전에 알게 한다. (사람. 실행 중 바꾸기 제외·거절: agent)

## 열린 것

- 기동 중에 쓴 program 줄(`sdk_update_needed`)은 toast가 없다. 기동 뒤 Gateway가 붙으면 안 읽은 급한 줄을 `notices.open`으로 읽어 한 번 띄우는 안이 있다(작음, 급하지 않음). 이슈 `startup-program-notice-no-toast`.
- 실패 이유에는 앱의 migration script가 낸 글이 실릴 수 있다(앞 200자로 자른다).
- 복원된 실패는 toast가 둘(실패, data 복원) 뜰 수 있다.
- program 기록에 project가 비어 있다.
- 앱이 열린 알림을 스스로 거두는 길이 없다(같은 key로 덮기만 한다).
- History의 기간을 안 고른 상태가 "Custom range"로 보인다(기간 선택 component가 "전체" 상태를 모른다).
- 앱에 맞는 새 SDK 기능을 model이 실제로 잘 제안하는지는 eval이 없다.
- tray popup은 열 때마다 화면을 새로 load한다.
