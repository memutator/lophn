# mobile-push-phone

폰 앱이 알림을 받는다: `expo-notifications`를 더하고, 알림 채널을 만들고, Paired 화면에서 알림 허락을 묻고, Settings › Notifications 화면을 짓고, push token과 설정을 pairing한 모든 컴퓨터에 보내고, 앱이 앞에 있는지와 보고 있는 session을 core에 보고하고, 알림을 누르면 그 session이나 앱이나 Inbox로 간다. 알림 글은 core가 정해 보내고(OS가 그린다) 폰은 글을 만들지 않는다.

**시작 조건: 계획 `phone-app`이 main에 올라가 `packages/mobile`이 있어야 한다.** 이 task는 그 계획이 지은 Paired와 Settings 화면, 앱 root, data 층 위에 선다. lead가 확인하고 아래 "소유"의 화면 file path를 채운 뒤에만 띄운다.

- 단위: mobile-push (wave 3)
- 선행: mobile-push-device
- 소유(이 task만 고친다):
  - `packages/mobile/src/push`(새 폴더: 알림 설정 저장, token 등록, presence 보고, 알림 누름 처리, 화면)
  - `packages/mobile/package.json`
  - `packages/mobile/package-lock.json`
  - `packages/mobile/app.json`
  - `packages/mobile/README.md`
  - `packages/design/i18n/catalog/mobile-notifications.ts`
  - (lead가 `phone-app`이 land된 뒤 채운다) Paired 화면 file, Settings 목록 화면 file, 앱 root가 provider를 올리는 file. 이 file들은 이 task가 필요한 줄만 고친다
- 읽을 것:
  - 기준(화면): `tools/wireframes/drafts/phone/start.tsx`의 `Paired`(알림 묻는 카드와 두 단추 `Turn on notifications`·`Not now`), `more.tsx`의 `Notifications`(스위치 일곱)와 Settings 목록의 `Notifications` 줄(값 `On`), 그림 `/home/pyosechang/projects/lophn/screenshot/phone-wireframes/{1-start-and-pair,8-settings}.png`. `inbox.tsx`의 `Lock`은 OS가 그리는 알림이라 짓지 않는다(글은 core가 정한다)
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/push-survey.md`의 3.5, 3.7, 8(Expo 폰 쪽 사실), 7(알려지지 않은 것: SDK 58에서 cold start 알림 누름을 읽는 API는 설치한 판의 문서로 확인한다)
  - 앞 task의 계약: `packages/protocol/attention/`(`presence/report`, `pushPrefsSchema`), `packages/protocol/remote/routes.ts`의 `devices/set_push`(`mobile-push-device`), 그 brief `project-docs/plan/mobile-push/tasks/mobile-push-device.md`와 `mobile-attention-core.md`의 push 글 모양(`PushMessage`: `data { host, kind, session?, app? }`, 채널 `needs-you`·`finished`·`apps`)
  - 폰 앱: `packages/mobile/README.md`(Android에서 띄우기, pairing), `packages/mobile/src/data/mod.ts`(컴퓨터 store, 연결, route 부르기), `packages/mobile/src/app/nav.ts`(`useNav()`로 session·workspace·inbox를 연다), 계획 `phone-app`의 `README.md` "정한 것"
  - 문구: `@lophn/i18n`의 `t()`. desktop catalog에 같은 문장이 있으면 그 key를 쓰고, 없을 때만 `mobile-notifications.ts`에 `mobile.`로 시작하는 key를 더한다(문장 조각을 이어 붙이지 않는다)
- 계약:
  - 쓰는 것: `devices/set_push`, `presence/report`(폰 allowlist에 있다), 위 push 글의 `data` 모양
  - 내놓는 것: 없음(밖으로 내놓는 계약이 없다)

## 할 일

1. 의존성: `expo-notifications`를 판을 정확히 고정해 더한다(`npx expo install expo-notifications` 뒤 `package.json`에서 `~`·`^`를 지운다. 필요하면 `expo-constants`도). `app.json`의 `plugins`에 `expo-notifications`를 더한다. `android.googleServicesFile`은 쓰지 않는다(사람이 Firebase를 만든 뒤 lead가 더한다). native module이 늘었으니 `README.md`대로 prebuild와 gradle로 dev build를 다시 짓는다(`/tmp/lophn-phone-app-x86_64.apk`는 쓸 수 없다). README의 알림 절(dev token, 계정이 필요한 부분)을 쓴다.
2. 채널: 앱이 시작할 때(허락을 묻기 전에) `needs-you`(importance high), `finished`, `apps`(default) 채널을 만든다. 이름과 설명은 `t()`.
3. 허락과 token(`packages/mobile/src/push`): Paired 화면에 wireframe대로 알림 묻는 카드와 두 단추를 더한다(`phone-frame`이 뺀 부분). `Turn on notifications`는 허락을 묻고(`requestPermissionsAsync`), 허락되면 token을 받는다(`getExpoPushTokenAsync({ projectId })`, projectId는 app config의 `extra.eas.projectId`). `Not now`는 알림 끔으로 두고 Home으로 간다. token을 받을 수 없을 때(projectId가 없는 지금의 build): dev build(`__DEV__`)에서는 앱이 처음 쓸 때 만들어 저장해 둔 고정 가짜 token `ExponentPushToken[lophn-dev-<무작위>]`를 쓰고, 그 밖의 build에서는 알림을 "이 build에서는 쓸 수 없다"로 두고(설정의 줄과 화면에 한 줄) 등록하지 않는다. 허락이 거절됐으면 Notifications 화면에 한 줄과 시스템 설정을 여는 단추(`Linking.openSettings()`)를 보인다.
4. 설정(Settings › Notifications): wireframe `Notifications`를 옮긴다. 스위치 일곱(`needs_you`, `long_finish`, `app_update`, `job_missed`, `my apps notify`=`app_notify`, `quiet_when_present`, `show_names`)과 맨 아래 한 줄. 기본값은 wireframe의 켜짐·꺼짐(`job_missed`만 꺼짐)이다. 설정 값은 폰 하나에 둔다. 저장은 앱이 이미 Appearance 같은 설정에 쓰는 저장소를 쓴다(새 저장소 의존성을 더하지 않는다). `show_names`의 부제에 "켜면 session 제목이 Expo와 Google을 지난다"는 뜻을 쓴다(wireframe 부제 'Off shows only "An agent needs you"'와 함께 두 줄이 되게 하고, 문장은 catalog에서). Settings 목록의 `Notifications` 줄은 값(`On`·`Off`)을 보인다. 개발 build에서만 이 화면 맨 아래에 "Send a test notification" 줄을 둔다(아래 7의 확인용 local 알림).
5. 등록: 컴퓨터에 연결이 서고(붙을 때마다)와 설정·token이 바뀔 때, pairing한 모든 컴퓨터에 `devices/set_push { token, prefs }`를 보낸다(알림이 꺼졌거나 token이 없으면 `token: null`). 연결이 없는 컴퓨터는 다음에 붙을 때 보낸다. token 회전은 `addPushTokenListener`로 받는다. 보내기는 `packages/mobile/src/data`의 공개 API로만 한다. 그 안을 고쳐야 하면 한 줄만 고치고 "넘길 줄"에 적는다.
6. presence 보고: 앱이 앞에 있는지(`AppState`)와 지금 열린 session 화면(`useNav()`의 현재 위치에서 sessionRef 하나, 없으면 빈 목록)을 `presence/report { focused, looking }`로 보낸다(`idle_ms`는 보내지 않는다). 앞뒤가 바뀔 때, session 화면이 열리고 닫힐 때, 앞에 있는 동안 30초마다 연결된 모든 컴퓨터에 보낸다. 뒤로 가는 순간에는 한 번 `focused: false`를 보낸다(못 보내도 core가 90초 뒤에 지운다).
7. 알림 누름: `setNotificationHandler`로 앱이 앞에 있을 때는 배너를 그리지 않는다. 누르면(앱이 떠 있을 때는 `addNotificationResponseReceivedListener`, 꺼져 있다가 열릴 때는 설치한 판 문서가 말하는 cold start 읽기 API) `data`를 읽어 `data.host`(컴퓨터의 공개 key)가 pairing한 컴퓨터면 그 컴퓨터를 고르고, `kind`가 `session`이면 그 session을, `app`이면 그 앱 workspace를, `inbox`거나 해석할 수 없으면(`term:`로 시작하는 터미널 session 포함) Inbox를 연다. `data`를 읽는 함수(`parseNotificationData`)는 `unknown`을 받아 모양이 틀리면 `null`을 낸다(알림은 인터넷을 지나온 것이다).
8. 확인(emulator, port 5580, Metro 8220): 규칙은 아래. 개발 core(`npm run dev:core`, fake push server가 같이 뜬다)와 pairing해 Paired에서 허락을 묻는 것, Settings › Notifications의 저장과 `devices/set_push` 전송(개발 core에서 `devices/push_targets`는 폰이 못 부르니 core 쪽 확인은 fake가 받는 글로 한다), 앱을 뒤로 보내고 core에서 승인 대기를 일으켜 fake push server가 받은 글 한 줄(제목, `data`)을 보는 것, "Send a test notification"으로 같은 `data`의 local 알림을 띄워 누르면 해당 화면으로 가는 것(앱이 떠 있을 때, 완전히 꺼져 있을 때 둘)을 본다. 허락 거절은 `adb -s emulator-5580 shell pm revoke dev.lophn.mobile android.permission.POST_NOTIFICATIONS`로 본다. 그림은 `.dev-data/mobile-push-phone/shots/`에 둔다(Paired, Notifications light·dark, Settings 줄, 알림 shade 한 장). fake push server는 폰에 알림을 그리지 못한다는 것, 실제 FCM 배달은 이 task에서 못 본다는 것을 보고에 적는다.

emulator 규칙: AVD `lophn-phone`, `-read-only -memory 2048 -port 5580`, 모든 adb 명령에 `-s emulator-5580`, gradle은 `--no-daemon -Pkotlin.compiler.execution.strategy=in-process`, 끝나면 `adb -s emulator-5580 emu kill`. 사람의 실제 폰(serial `R3CT90K6G2X`)에는 어떤 명령도 보내지 않는다. pkill·killall 금지.

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check`가 통과한다.
- 위험 test: "`parseNotificationData`는 lophn이 보낸 모양이 아닌 `data`(다른 앱의 알림, 빠진 칸, 이상한 type)에서 `null`을 내고 아무 화면도 열지 않는다"(`packages/mobile/src/push`, React Native를 import하지 않는 순수 함수라 node로 돈다)
- 그림이 wireframe(`Paired`, `Notifications`)과 같은 구조·크기·색이다(lead가 대조한다).
- 소유 밖 file은 위 허락한 줄 말고 고치지 않았다.
- 남지 않음: 없음(지우는 것이 없다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 더한 의존성과 판, 그림 목록, wireframe과 다르게 한 곳과 이유, 실제 core로 확인한 것과 못 한 것(특히 cold start 알림 누름과 실제 FCM 배달), 고친 남의 file의 줄, 사람이 계정을 만든 뒤 lead가 해야 할 한 줄(`app.json`의 `extra.eas.projectId`, `android.googleServicesFile`).
