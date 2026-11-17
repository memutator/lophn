# phone-home-screen

사용자 앱이 폰의 홈 화면에 닿는 길이다. 앱이 선언한 위젯의 값을 폰의 native 위젯이 그리고(위젯), 앱 하나를 홈 화면의 아이콘으로 둘 수 있고(홈 화면 아이콘), 위젯·아이콘·알림을 누르면 폰 앱의 한 곳이 열린다(open target). 셋 다 Android만이다. 앱 안의 폰 화면은 `phone-screen.md`, 폰 앱 자체와 core→폰 요청 길은 `remote.md`, 앱이 위젯 값을 내는 SDK와 grant는 `app-notice.md`가 맡는다.

## 문제

- 사람이 앱의 값 하나(오늘의 주문 수, 한도의 남은 양)를 보려고 폰 앱을 열고 앱을 찾아 화면을 열어야 한다. 홈 화면에서 한눈에 보이는 길이 없다.
- 앱 agent가 만든 앱이 폰의 홈 화면에 무엇이든 그리게 두면 AI가 쓴 코드가 사람의 홈 화면 모양을 정한다. 위젯은 web이나 React Native 화면이 아니라 Android의 `RemoteViews`로만 그려지므로 모양을 자유롭게 줄 수도 없다.
- 위젯은 폰 앱 process가 죽어 있을 때도 그려져야 하고, Android가 시키는 때에 새로 해야 한다. JS runtime이 없으면 못 그리는 구조면 앱이 꺼진 폰에서 위젯이 빈다.
- 컴퓨터가 꺼졌거나 앱이 지워졌거나 폰에서 컴퓨터를 지웠을 때 위젯이 옛 값을 새 값처럼 보이거나 남의 data를 보이면 안 된다.
- 알림, 위젯, 홈 화면 아이콘이 각자 "앱을 연다"를 따로 풀면 같은 URL·data 해석이 셋이 된다. 밖에서 온 값(다른 앱의 알림, 사람이 친 URL)을 믿는 곳도 셋이 된다.

## 목표와 비목표

- 목표: 앱이 선언한 위젯의 값을 정해진 node 넷으로 내면 폰의 위젯이 그 값을 가져온 시각과 같이 그린다. 앱이 죽은 폰에서도 마지막 값이 그려지고 새로 하기는 best effort다.
- 목표: 앱 하나를 홈 화면의 아이콘으로 두고, 앱이나 컴퓨터가 없어지면 아이콘이 쓰이지 않게 한다.
- 목표: 알림 누름, 위젯 누름, 아이콘 누름, `lophn://` URL이 하나의 해석(open target)을 지난다.
- 비목표: push로 위젯을 새로 하는 것(앱 내용이 Expo와 Google로 가고, 푸시 규칙은 글에 상태와 제목만 싣는다). 위젯 안의 이미지, 단추, 줄마다의 행동, 앱이 정하는 layout. dynamic shortcut과 launcher 길게 누르기 목록. 앱 화면마다의 아이콘. 폰에서 도는 앱(단계 7)의 위젯과 아이콘. iOS. 위젯이나 아이콘을 앱이 스스로 놓는 길(놓는 것은 사람이 launcher에서 한다).

## 모델

```
앱 선언: widgets [{key, label, screen?}] (최대 4)
앱 process: setWidget(key, {v:1, rows}) / clearWidget(key)   ← @lophn/cap-notify 1.3.0, grant notify.send
   │ broker (live 자식, 선언 ∩ grant) ──▶ core app_widget.set (memory, actor app) ──▶ StateChanged{widgets}
   ▼
core: (앱, key)마다 마지막 값 하나와 받은 시각. memory뿐
   │ app_widgets/list (read, 폰이 부른다. 선언한 widget마다 한 줄, 값이 없으면 null)
   ▼
폰 JS (store): bindings(놓인 위젯 id → {컴퓨터, 앱, key}) + 읽은 값 ──▶ cache 만들기
   │ 앱 폴더의 두 file: widgets/bindings.json, widgets/cache.json
   ▼
폰 native(Kotlin): cache만 읽어 RemoteViews를 그린다 (JS runtime 없이). 위젯 누름 ─▶ lophn://open?... ──▶ open target
```

### 위젯

- **선언.** 앱 선언(`@lophn/declaration` 4.7.0)의 칸 `widgets`는 `{key, label, screen?}`의 목록이고 앱마다 4개까지다. `key`는 소문자·숫자·`_`이고 글자로 시작하며 32자까지다. `screen`을 주면 이 앱의 `phone` 화면의 key여야 한다(누르면 그 화면이 열린다). 선언이 목록을 정하므로 폰이 값이 오기 전에도 고르는 목록을 보이고, core가 선언 밖 key의 값을 거절하고, 새 release가 위젯을 빼면 목록에서 빠진다.
- **값.** `{v: 1, tone?, rows}`이고 `rows`는 1~6개의 node다. node는 넷이다: `text`(글 48자까지, style `title`·`body`·`caption`), `stat`(값 12자, label 24자), `progress`(0~1, label 24자 선택), `list`(1~5줄, 줄마다 글 32자와 trail 12자 선택). tone은 `neutral`·`good`·`warn`·`bad`(tray와 같다)이고 위젯 값의 tone은 자기 tone이 없는 node의 기본이다. 값 전체가 JSON으로 4096 byte까지다. 앱은 rows 밖을 그리지 못한다. 머리(앱 이름과 위젯 label)와 꼬리(가져온 시각)는 폰이 그린다.
- **core.** 값은 `(앱, key)`마다 마지막 하나와 받은 시각을 memory에만 둔다(ledger 없음. lophn을 다시 켜면 비고 앱이 시작할 때 다시 낸다). `app_widget.set`은 앱 자격만 부르고 앱은 입력이 아니라 자식 credential이 정한다. `value: null`이 지우기다. 보관한 앱은 `conflict`, 선언 밖 key는 `invalid_input`이다. `app_widgets.list`는 보관하지 않은 앱 중 켜진 release가 있는 앱의 선언된 위젯마다 한 줄(앱 id와 이름, key, label, screen, 값, 받은 시각)을 싣고, 읽을 때 보관된 앱과 선언에서 빠진 key의 값을 지운다. 위젯 머리에 앱 아이콘이 없어 icon 칸이 없다.
- **폰의 두 file.** bindings는 놓인 위젯 id마다 어느 컴퓨터의 어느 앱의 어느 key를 보이는지다. cache는 위젯 id마다 그릴 것 전부다: 상태(`ok`·`gone`·`computer_removed`), 머리 글, 꼬리 글, stale 여부, 누르면 열 URL, rows. 위젯에 보이는 모든 글("Updated 14:05", "Offline 14:05", "Tap to choose", "This widget is no longer available", "Computer removed", "Waiting for your computer", "Nothing to show yet")은 폰의 TS가 i18n catalog로 만들어 cache에 적고 native는 적힌 글만 그린다. 두 file은 폰 앱의 private 폴더에 있고 TS는 그 폴더의 `widgets/` 밖을 읽고 쓰지 못한다. bindings file은 native만 쓴다: 놓기 callback과 JS의 binding 바꾸기(고르기, 놓이지 않은 id 정리)가 모두 native의 같은 잠금 안에서 읽고 바꾸고 쓰므로 서로 덮지 않는다. JS는 바꿀 것만 native에 넘긴다.
- **그리기.** provider는 둘로 고정이다(2x2와 4x2. Android가 provider를 build 때 manifest에 요구해 앱마다 둘 수 없다). 어느 앱을 보이는지는 provider가 아니라 binding이다. native는 cache에서 위젯 id의 항목을 읽어 `RemoteViews`로 그린다(node마다 작은 layout 하나, 목록은 줄을 쌓는다. 작은 위젯은 아래가 잘린다). cache가 없거나 깨졌거나 모르는 모양이면 그 위젯은 "Tap to choose"가 된다. 상태가 `gone`·`computer_removed`면 rows 없이 그 글만 보인다. stale이면 rows를 흐리게 그린다. 위젯 글은 시스템 글꼴이다.
- **새로 하기(best effort).** 폰의 `refreshWidgets()`가 위젯이 묶인 컴퓨터마다 `app_widgets/list`를 읽어 cache를 다시 쓰고 native에 다시 그리게 한다. 계기: 폰 앱이 앞으로 올 때와 뒤로 갈 때, 연결된 동안 컴퓨터가 `StateChanged`의 `widgets`·`apps`·`releases`를 낼 때, 컴퓨터를 지웠을 때, 위젯의 새로 하기 아이콘, 위젯을 놓거나 고를 때, Android의 주기 update(30분 단위로 요청하고 system이 늦춰 30~52분 간격이다). 폰 앱이 죽어 있으면 위젯의 broadcast 안에서(`goAsync` 아래) 같은 process에 React host를 띄워 headless JS 일감을 25초 한도로 돌린다. 겹치는 호출은 하나로 합친다(한 번 도는 동안 온 것은 끝난 뒤 한 번 더, 방금 끝난 3초 안의 broadcast는 버린다). 컴퓨터마다 8초 안에 못 닿으면 그 컴퓨터는 닿지 못한 것이다. 폰 앱이 살아 있으면 연결을 그대로 쓰고 죽어 있으면 한 번 붙어 한 번 부르고 닫는다. 죽은 process의 새로 하기는 release build의 emulator에서 0.6~1.2초였고 그 대부분(약 0.7초)이 handshake다.
- **stale과 offline.** 위젯은 가져온 시각을 폰의 시계 모양(24시간이나 am/pm)으로 늘 보인다("Updated 14:05". 위젯은 흘러가는 시계를 그리지 못해 "방금"이나 "N분 전"을 쓰지 않는다). 마지막 시도가 실패했으면 마지막으로 가져온 값을 흐리게 두고 꼬리를 "Offline 14:05"로 바꾼다. 한 번도 못 가져왔으면 "Waiting for your computer"와 "Offline"이다. 가져왔는데 그 앱의 그 key가 목록에 없으면(앱이 보관됐거나 새 release가 위젯을 뺐다) `gone`이다. 폰이 그 컴퓨터를 지웠으면 `computer_removed`이고 rows를 지운다. 위젯은 스피너를 그리지 않고 다른 컴퓨터나 다른 앱의 값을 그 자리에 그리지 않는다. 값이 아직 없는 위젯은 "Nothing to show yet"이다.
- **놓기.** 사람이 launcher의 위젯 목록에서 lophn 위젯을 끌어 놓으면 launcher가 configure activity를 띄우고, 그 activity는 UI 없이 폰 앱의 "Choose a widget"(`lophn://widget/bind?id=<n>&from=configure`)을 열고 그 화면의 답을 기다린다(고르면 binding을 쓰고 위젯이 놓이고, 닫기 단추면 launcher가 위젯을 지운다. 시스템 Back이면 placeholder로 남는다). configure를 건너뛰는 launcher를 위해 binding이 없는 위젯은 "Tap to choose"이고 그것을 누르면 같은 화면(`lophn://widget/bind?id=<n>`)이 열린다. 앱 menu의 "Add widget"은 launcher의 `requestPinAppWidget`으로 위젯을 새로 놓는다(4x2 하나). launcher가 보이는 확인에서 사람이 더하면 native의 callback receiver가 새 id를 받아 binding을 쓴다(취소하면 아무것도 오지 않아 id를 JS에 약속할 수 없다). "Choose a widget"은 연결된 컴퓨터마다 앱의 위젯을 지금 값과 같이 보이고 앱 menu에서 열면 그 앱의 것만이다. 새로 하기는 놓인 위젯 id만 binding으로 남긴다.
- **누름.** 위젯의 몸을 누르면 앱의 폰 화면(선언의 `screen`, 없으면 앱의 첫 폰 화면이거나 앱 workspace)이 열리고, `gone`과 `computer_removed`는 그 컴퓨터의 Inbox가 열린다. 새로 하기 아이콘은 위 새로 하기를 돈다.

### 홈 화면 아이콘

- 앱 menu의 "Add to Home screen"이 launcher에 앱의 pinned shortcut 하나를 청한다. launcher가 자기 확인을 보인다. id는 `lophn:<컴퓨터 key>:<앱 id>`로 고정이라 같은 앱을 다시 청하면 이미 있는 아이콘이다(그때 launcher는 확인을 보이지 않아 사람에게 아무 일도 안 일어난 것처럼 보이므로, 이미 놓인 앱의 menu에는 그 줄을 감춘다). 이름은 앱 이름이고 누르면 `lophn://open?host=…&app=…&kind=app`으로 앱의 폰 화면이 열린다.
- 그림은 앱의 `icon`으로 폰 JS가 그린다. png나 webp는 그대로 쓰고, svg와 lucide는 화면 밖에 올린 `<Svg>`를 192px의 PNG로 읽어 만들며(그래서 앱이 앞에 있을 때만 된다), 아이콘이 없거나 그려지지 않으면 앱 이름의 첫 글자를 앱의 tone 위에 올린 그림이고 그것도 안 되면 native가 lophn의 mark를 쓴다. native는 그림을 launcher의 adaptive 모양(108 중 가운데 72)에 맞춰 흰 바탕에 놓는다. launcher는 lophn 배지를 모서리에 붙인다.
- 아이콘의 신원은 폰이 따로 들고 있는 목록이 아니라 Android가 가진 pinned id다. 폰은 아이콘을 놓은 컴퓨터마다(화면에 있는지와 상관없이) 그 컴퓨터가 붙을 때, 그 컴퓨터의 앱이나 release가 바뀔 때(`StateChanged`), 폰 앱이 앞으로 올 때 `apps/phone_screens`를 읽어 그 컴퓨터의 pinned id를 견준다. 앱이 목록에서 사라졌으면(보관, 삭제, 폰 화면을 잃음, 켜진 release 없음) 그 아이콘을 쓸 수 없게 하고(disable. 지우지는 않는다) 앱이 돌아오면 다시 쓸 수 있게 한다(enable). 폰이 컴퓨터를 지우면 그 컴퓨터의 아이콘을 모두 쓸 수 없게 한다. 쓸 수 없게 된 아이콘을 누르면 보이는 글은 launcher가 정한다(Pixel Launcher는 우리 글이 아니라 자기 글 "Shortcut isn't available"을 보인다).

### open target

- 밖에서 폰 앱으로 오는 지시 넷(알림 누름, 위젯 누름, 아이콘 누름, 사람이나 다른 앱이 친 `lophn://` URL)이 `OpenTarget` 하나와 해석 함수 하나를 지난다. 모양은 넷이다: `session`(컴퓨터와 session), `app`(컴퓨터, 앱, 화면 선택), `inbox`(컴퓨터), `widget_bind`(놓인 위젯 id, configure 여부. 컴퓨터를 이름 짓지 않는다).
- 알림은 push 메시지의 `data`로, 나머지는 URL로 온다: `lophn://open?host=<컴퓨터 key>&kind=session&session=…|app&app=…[&screen=…]|inbox`와 `lophn://widget/bind?id=<n>[&from=configure]`. 해석 함수는 lophn이 만든 모양이 아니거나(다른 앱의 알림, 빠진 칸, 모르는 kind, 틀린 URL), `host`가 이 폰이 pairing하지 않은 컴퓨터면 아무것도 열지 않는다. 앱이 컴퓨터 목록을 읽기 전에 온 지시는 목록이 읽힐 때까지 기다린다. 열 수 없는 것을 버리므로 나중에 그 컴퓨터를 pairing해도 그때 열리지 않는다.
- 터미널 coding agent의 알림(`term:`으로 시작하는 session)은 폰이 열 수 없는 대화여서 알림 쪽에서 Inbox로 바꾼다. 알림만 그런 session을 가리키므로 이 규칙은 해석 함수 밖에 있다. 목록에 없는 session은 8초를 기다린 뒤 Inbox를 연다.
- 앱이 떠 있는 채 온 URL은 listener가 받고, 꺼져 있다가 시작한 앱은 시작 때의 URL이나 마지막 알림 응답으로 받는다. 어느 쪽이든 같은 해석 함수 하나를 지난다.

## 지키는 것

1. 앱이 폰의 홈 화면에 내보내는 것은 선언한 key의 값이고 node 넷의 data뿐이다. 4096 byte를 넘는 값, 모르는 node, 길이를 넘는 글, 범위 밖의 progress, 줄 수 밖의 rows·items는 core(와 SDK)가 거절한다. 앱은 rows 밖을 그리지 못한다.
2. 위젯 값은 자기 앱의 것만 쓴다. 앱은 입력에 없고 자식 credential이 정한다. 선언하지 않은 key는 `invalid_input`이다. 사람 자격은 쓰지 못한다(`forbidden`). 보관된 앱과 선언에서 빠진 key의 값은 목록에 나가지 않는다.
3. 위젯 값은 memory에만 있고 push에도 ledger에도 싣지 않는다. 앱 내용이 Expo나 Google을 지나지 않는다.
4. 값을 내려면 `notify.send` grant가 있어야 한다(broker가 요청마다 선언 ∩ grant와 live 자식을 본다). preview와 test에서 `setWidget`은 아무것도 하지 않는다.
5. native 위젯은 JS 없이 두 file만으로 그린다. 깨지거나 없는 cache가 위젯이나 폰 앱을 죽이지 않고 위젯은 "Tap to choose"로 선다.
6. 폰이 컴퓨터를 지우면 그 컴퓨터에 묶인 위젯은 다음 cache에서 rows가 지워진 `computer_removed`가 된다. 다른 컴퓨터의 값이 그 자리에 들어가지 않는다.
7. 위젯은 값이 낡은 것을 낡았다고 보인다. 꼬리의 시각은 값을 가져온 시각이고 지금이 아니다. 실패한 시도는 마지막 값을 지우지 않고 흐리게 둔다.
8. 위젯의 새로 하기는 best effort이고 약속하지 않는다. 폰 앱이 강제 종료됐거나 컴퓨터가 꺼져 있으면 마지막 값이 남는다. push로 깨우거나 새로 하지 않는다.
9. 밖에서 온 open 지시는 lophn이 만든 모양이고 pairing한 컴퓨터의 것일 때만 무언가를 연다. 아니면 아무 화면도 열리지 않는다.
10. 아이콘이 없어진 앱을 가리키면 쓸 수 없게 된다. 아이콘을 쓸 수 없게 하는 일이 틀려도 data를 잃지 않고 다음에 목록을 읽을 때 다시 맞춰진다.

## 경계와 계약

- boundary `app-runtime`(위젯 값 memory와 두 route, broker `notify/widget`), `app-releases`(선언의 `widgets`), `remote-protocol`(폰 route 목록의 `app_widgets/list`), `mobile`(폰의 store, cache, native module, 화면, open target), `sdk-api`(`@lophn/cap-notify`의 `setWidget`·`clearWidget`).
- route: `app_widget.set`(memory, actor app, changes `widgets`), `app_widgets.list`(memory, actor user, 폰이 부른다). 위젯 값이 바뀌면 `StateChanged`의 change 이름 `widgets`(`event.md`). 폰의 아이콘은 기존 `apps/phone_screens`(어느 앱이 있는지)와 `apps/icon`(그림)을 읽는다. 새 CLI는 없다.
- SDK: `@lophn/cap-notify` 1.3.0의 `setWidget(key, value)`·`clearWidget(key)`. broker 경로 `/_lophn/broker/notify/widget`. 선언 `@lophn/declaration` 4.7.0(`widgets`와 permission kind `phone.use`), `@lophn/app-ui` 2.16.0과 `@lophn/app-ui-native` 1.1.0(declaration의 정확한 판 pin을 따라 올렸다).
- 폰의 저장: 앱 private 폴더의 `widgets/bindings.json`과 `widgets/cache.json`. native module 이름은 `LophnWidgets`(위젯, 놓기, 아이콘 pin·disable·enable 모두 한 module). headless 일감 이름은 `LophnWidgetRefresh`. URL scheme은 `lophn`.
- ledger step이 없다. 값은 memory이고 binding은 폰 file이다.

## 결정

- 위젯은 앱이 선언한다(`widgets` 칸). 이유: 폰의 고르기 목록이 값이 오기 전에도 있어야 하고, core가 선언 밖 key를 거절해야 하고, 새 release가 위젯을 빼면 따라 빠져야 한다. 버린 안: 값을 처음 낼 때 위젯이 생기게 하기(앱 process가 돌기 전에는 고르기가 비고 검사할 곳이 없다). (agent)
- 위젯의 모양은 정해진 node 넷의 data이고 앱이 layout을 정하지 못한다. 이유: 위젯은 `RemoteViews`로만 그려져서 web·RN 화면을 올릴 수 없다. 모양을 앱이 정하면 AI가 쓴 코드가 홈 화면에 무엇이든 그린다. 버린 안: 앱이 내는 HTML이나 JSX, 자유로운 layout tree. (agent)
- 값은 새 permission 없이 기존 `notify.send` grant로 낸다. 이유: 위젯 값도 앱이 사람에게 보이는 것이고 보이게 하는 것은 사람이 위젯을 놓는 일이다. 버린 안: 위젯용 SDK part와 permission, 값의 저장(앱 process가 시작할 때 다시 내고 폰이 마지막 값을 cache로 갖는다). (agent)
- 값은 core memory에만 둔다. 이유: tray와 같다. 앱이 오래 살아 값을 다시 낼 수 있어 저장할 이유가 없다. 대가: 컴퓨터를 다시 켜면 앱이 다시 낼 때까지 위젯의 값이 비어 있다. (agent)
- 폰의 native 층은 얇은 자체 Kotlin module 하나(`lophn-widgets`)이고 cache file에서 JS 없이 그린다. 이유: 앱이 죽은 폰에서 위젯이 그려지고 새로 되어야 한다. 버린 안: `react-native-android-widget`(매 그림마다 JS 한 번이 들고 provider 이름이 build에 고정된다. 앱이 죽은 채 새로 하기가 되기는 했다), `expo-widgets`(Android는 부분 집합이고 앱마다 위젯을 놓을 수 없다), server가 구동하는 위젯(lophn에 공개 server가 없고 data가 사람의 것이다). spike가 emulator에서 확인했다. (agent, spike 판정)
- 위젯 provider를 둘(2x2, 4x2)로 두고 어느 앱인지는 binding이 정한다. 이유: Android가 provider를 build 때 manifest에 요구해서 앱마다 만들 수 없다. 대가: 위젯 목록에는 lophn 위젯 두 종만 보이고 앱은 고르는 화면에서 정해진다. (agent)
- 위젯 머리는 앱 이름과 위젯 label이고 앱 아이콘을 그리지 않는다. 이유: 위젯 길에서 svg를 그림으로 바꾸지 않으려고 했다(그림은 폰 JS가 앱이 앞에 있을 때만 그릴 수 있어 새로 하기와 함께 돌지 못한다). 아이콘은 홈 화면 아이콘만 쓴다. (agent)
- 위젯의 글을 TS가 `t()`로 만들어 cache에 적고 native는 그리기만 한다. 이유: 문구가 i18n catalog 한 곳에 있다. 대가: native가 모르는 새 상태는 글 없이 "Tap to choose"로 떨어진다. (agent)
- 새로 하기는 best effort다. 이유: Android가 위젯 새로 하기 간격을 주기 update로 30분 아래로 보장하지 않고 폰 socket은 앱이 뒤에 있으면 죽는다. 폰이 사람의 data를 푸시로 받지 않는다는 규칙이 있어 silent push로 깨우지 않는다. 그래서 꼬리가 가져온 시각을 늘 보인다. (agent)
- 죽은 폰 앱의 새로 하기는 RN의 `HeadlessJsTaskService`가 아니라 위젯 broadcast 안에서 `goAsync` 아래 React host를 띄워 돈다. 이유: Android 12 이상은 배경에서 service 시작을 거절한다(emulator에서 3번 중 3번 거절됐다). 이 길은 service도 `WAKE_LOCK`도 WorkManager도 요구하지 않는다. provider는 `exported="false"`다. (agent, spike 판정)
- configure는 폰 앱 화면의 답을 기다린다(hold). 답 없이 다시 보이면 placeholder로 남긴다. 이유: configure activity가 답을 바로 OK로 하면 사람이 Home을 눌렀을 때 위젯이 사라지고, 답을 기다리기만 하면 Back에서 보이지 않는 activity가 launcher 위에 남는다. (agent, spike 판정)
- `requestPin`은 위젯 id를 돌려주지 않고 boolean만 돌려준다. binding은 native의 callback receiver가 쓴다. 이유: 사람이 launcher의 확인을 취소하면 아무것도 오지 않아 id를 약속할 수 없다. (agent, spike 판정)
- 홈 화면 아이콘은 앱마다 pinned shortcut 하나이고 id가 고정이다. 이유: Android가 pinned shortcut을 id로 복원하므로 폰이 자기 id를 만들어 들 필요가 없고, 같은 앱을 다시 청해도 아이콘이 둘이 되지 않는다. 앱의 화면마다 아이콘을 두는 안은 버렸다(앱의 화면이 앱 안에서 서로 이어진다). 아이콘의 존재 목록을 폰이 따로 쓰지 않고 Android의 pinned id를 쓴다(목록이 둘로 갈리지 않는다). (agent)
- 아이콘은 지우지 않고 쓸 수 없게 한다(disable). 이유: 앱이 돌아오면 같은 아이콘이 다시 쓰이고, 잘못 쓸 수 없게 해도 data를 잃지 않고 다음 목록 읽기에서 다시 쓸 수 있게 된다. 쓸 수 없게 된 아이콘에 보이는 글은 launcher가 정하므로 그 글은 test하지 않는다. (agent)
- 아이콘의 그림은 폰 JS가 그리고(화면 밖 `<Svg>`) native는 adaptive 모양에 맞춘다. 이유: svg와 lucide를 Kotlin에서 따로 그리는 길(androidsvg)은 의존이 하나 늘고, 폰 앱이 이미 둘 다 그린다. (agent, spike 판정)
- 위젯과 홈 화면 아이콘이 같은 Kotlin module(`lophn-widgets`) 하나에 산다. 이유: native module을 둘 두면 prebuild와 build 설정이 둘이다. (agent, 계획의 lead가 spike 뒤 정했다)
- 알림, 위젯, 아이콘, URL이 open target 하나를 지난다. 이유: 밖에서 온 값을 믿는 곳이 한 곳이어야 한다. 알림의 `data` 모양을 그대로 쓴다. 터미널 session의 알림 규칙은 알림만 그런 session을 가리켜 해석 밖에 둔다. (agent)
- 폰은 알림이나 URL을 누른 사람을 공격자로 보지 않는다. 이유: URL은 누구든 칠 수 있지만 최악이 사람 자기 폰 앱의 한 화면을 여는 것이다(`AGENTS.md`의 "속도"). 그래도 모양과 컴퓨터를 보는 것은 앱이 모르는 앱의 알림을 열지 않게 하려는 것이다. (agent)

## 열린 것

- 강제 종료한(`am force-stop`, 설정의 "강제 종료") 폰 앱의 위젯은 Android가 회색으로 가리고 사람이 한 번 누를 때까지 새로 하지 않는다. Android의 규칙이라 lophn이 고치지 못한다. 이 상태에서는 lophn의 글이 보이지 않는다.
- 쓸 수 없게 된 아이콘을 눌렀을 때의 글은 launcher가 정한다. Pixel Launcher는 자기 글을 보인다. 다른 launcher는 보지 못했다.
- 홈 화면에 놓인 아이콘은 앱의 이름과 그림이 바뀌어도 놓을 때의 것 그대로다(이슈 `shortcut-keeps-old-label-and-icon`). 위젯 글은 Pretendard가 아니라 시스템 글꼴이다(이슈 `widget-text-not-pretendard`). binding을 native 잠금 안에서 바꾸는 Kotlin과 모든 컴퓨터의 아이콘 정리는 dev build와 emulator에서 아직 보지 않았다.
- 다른 launcher(Pixel Launcher 밖), 실제 폰, 사람이 launcher의 놓기 확인을 취소하는 경우, 앱을 보관했을 때 놓인 위젯이 "no longer available"이 되는 것, 앱 agent가 실제 turn으로 만든 앱의 위젯은 보지 못했다(change-log `mobile-widgets`).
- 폰에서 도는 앱(단계 7)의 위젯과 아이콘은 `mobile-local-apps`가 정한다. iOS는 짓지 않았다.
