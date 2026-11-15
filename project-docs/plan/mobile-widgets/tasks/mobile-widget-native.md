# mobile-widget-native

**opus high.** 폰 홈 화면 위젯의 native 층을 짓는다: 얇은 자체 Expo module `lophn-widgets`(Kotlin). 고정 provider 둘(작은 2x2, 넓은 4x2), 놓을 때의 configure activity, `widgets/cache.json`을 읽어 RemoteViews로 node 넷을 그리기(JS runtime 없이), 누름과 새로 하기의 PendingIntent, 주기 update, background 새로 하기를 headless JS로 돌리기. `mobile-widget-store`의 `WidgetNative`를 실제 module로 바꾼다.

**spike 판정 뒤에 lead가 이 brief를 다시 본다**(계획 `README.md` "돌리기 전에"). 아래는 가정(자체 module, cache로 그림, headless JS로 새로 하기, configure와 placeholder 둘 다)이다. 판정의 Kotlin 조각과 숫자를 그대로 쓴다.

- 단위: widgets (wave 5)
- 선행: mobile-widget-store, mobile-widget-spike, mobile-widget-wireframes
- 소유(이 task만 고친다):
  - `packages/mobile/modules/lophn-widgets`(새 폴더 전체: `expo-module.config.json`, `index.ts`, `android/`)
  - `packages/mobile/plugins/widgets`(새 폴더. module의 `AndroidManifest.xml` 합치기로 안 되는 것이 있을 때만)
  - `packages/mobile/src/widgets/native.ts`
  - `packages/mobile/app.json`
  - `packages/mobile/package.json`
  - `packages/mobile/package-lock.json`
- 한 줄씩 허락(보고의 "넘길 줄"에 적는다): `packages/mobile/index.ts`(headless task `LophnWidgetRefresh` 등록 한 줄), `packages/mobile/src/app/root.tsx`(`useWidgetRefresh()` 한 줄)
- 읽을 것:
  - 판정: `/home/pyosechang/projects/lophn/reports/mobile-program/widget-spike.md`(S1~S4 전부)
  - 그릴 것: `packages/mobile/src/widgets/{native.ts,cache.ts}`(cache 모양, `WidgetNative`), `packages/protocol/apps/widget.ts`(node 넷과 한도), wireframe `tools/wireframes/drafts/phone/widgets.tsx`와 그 보고의 칸 크기·글자 크기·색(사람이 승인한 그림. 숫자를 옮긴다)
  - 색: `packages/design/native`의 token(tone 넷과 바탕·글 색, light·dark)
  - 폰 앱: `packages/mobile/README.md`(dev build), `packages/mobile/app.json`, 다른 native 작업이 더한 module과 plugin(`packages/mobile/modules`, `packages/mobile/plugins`)
  - 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/widgets-survey.md`의 2.1, 계획 `README.md`의 "정한 것"
- 계약:
  - 쓰는 것: cache file과 binding file의 모양, `refreshWidgetsInBackground()`(headless task `LophnWidgetRefresh`), `lophn://` URL(`mobile-open-target`), 위젯을 고르는 URL `lophn://widget/bind?id=<appWidgetId>`(`mobile-widget-screens`가 연다)
  - 내놓는 것(`modules/lophn-widgets/index.ts`):
    - `WidgetNative`의 구현: `readText(name)`, `writeText(name, text)`(앱 files 폴더의 `widgets/` 아래만), `placedIds()`(두 provider의 `getAppWidgetIds`), `redraw(ids?)`
    - `isPinSupported(): boolean`, `requestPin(size: "small" | "wide", bind: {host, app, key}): Promise<number | null>`(launcher가 지원하면 놓기를 청하고, 놓이면 그 id에 binding을 쓰고 새로 한다. callback이 id를 주지 않으면 `null`이고 placeholder가 남는다)

## 할 일

1. provider 둘(`LophnWidgetSmall` 2x2, `LophnWidgetWide` 4x2)과 그 `appwidget-provider` XML(`updatePeriodMillis` 1800000, `configure` activity, `resizeMode`, 미리보기 그림). manifest의 receiver와 activity.
2. 그림: cache의 `widgets[id]`를 읽어 RemoteViews를 만든다. 머리(`title`, 오른쪽 끝 새로 하기 아이콘), 본문(`text` 세 style, `stat`, 가로 `ProgressBar`의 `progress`, 쌓은 `TextView`의 `list`. collection view를 쓰지 않는다), 꼬리(`footer`). `stale`이면 본문을 흐리게. `gone`·`computer_removed`는 `strings`의 글 한 줄. cache에 없는 id는 "Tap to choose"(`strings.tap_to_choose`, cache가 없으면 영어 고정 글)와 누르면 `lophn://widget/bind?id=<id>`. 작은 위젯은 아래 줄이 잘린다. cache가 깨졌거나 모르는 모양이면 그 위젯을 "Tap to choose"처럼 그리고 앱이 죽지 않는다.
3. 누름: 본문은 `open_url`의 VIEW intent, 새로 하기는 broadcast → `goAsync`(또는 판정이 정한 WorkManager) 안에서 headless task `LophnWidgetRefresh`를 띄운다. 주기 update도 같은 길이다.
4. configure activity: 판정 S2대로. 가정은 바로 `RESULT_OK`로 위젯을 남기고 앱을 `lophn://widget/bind?id=<id>`로 연다(두 번째 RN activity를 두지 않는다).
5. `src/widgets/native.ts`를 실제 module로, `index.ts`와 `root.tsx`의 한 줄.
6. dev build를 다시 짓고 emulator(port 5608, Metro 8248)에서 확인한다: `-read-only -memory 2048 -port 5608`, 모든 adb 명령에 `-s emulator-5608`, 끝나면 `adb -s emulator-5608 emu kill`, gradle은 `--no-daemon -Pkotlin.compiler.execution.strategy=in-process`, 사람의 실제 폰(serial `R3CT90K6G2X`)에는 아무 명령도 보내지 않는다. 개발 core(`tools/remote-dev.ts`)와 위젯을 내는 작은 앱(`mobile-widget-core` 보고의 앱 꼴)으로: 두 크기를 놓기(판정이 적은 길로), node 넷과 tone 넷, Offline(개발 core를 끈 뒤 새로 하기), gone(앱 보관), 앱을 `am force-stop`한 뒤 새로 하기 아이콘, 본문 누름이 앱 화면을 여는 것, dark. 그림은 `.dev-data/mobile-widget-native/shots/`.

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check`가 통과한다. dev build가 지어진다.
- 그림이 wireframe과 같은 구조·크기·색이다(lead가 대조한다).
- 위험 test: 없음(native 그림. 깨진 cache에서 죽지 않는 것은 emulator에서 손으로 보고 보고에 적는다)
- 남지 않음: 없음

- flows catalog: 이 task가 더하거나 지우는 test file과 입구의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 더한 의존성과 판, manifest에 더한 것, 앱이 죽은 채 새로 하기의 걸린 시간(3번), 놓기 길(configure, placeholder, `requestPin`)마다 된 것, 그림 목록, dev build를 짓는 데 바뀐 것.

## lead가 더함 (spike 판정 `reports/mobile-program/widget-spike.md`, 2026-11-16)

가정은 맞고 다섯 곳이 바뀐다. 보고서의 "Different from the assumptions", "Changes for the four native briefs", "Kotlin worth moving"를 먼저 읽는다. 이 brief의 본문과 다르면 아래가 맞다. spike의 코드는 `/home/pyosechang/projects/lophn-worktrees/spike-widgets`(branch `spike/widgets`)에 있다(읽기만).

- 배경 새로 하기는 RN의 `HeadlessJsTaskService`가 아니라 위젯 broadcast 안에서 `goAsync` 아래 `ReactHost`를 그 process에서 띄워 `HeadlessJsTaskContext.startTask`로 돈다(Android 12 이상이 배경에서 service 시작을 거절한다). service, `WAKE_LOCK`, WorkManager가 없다. provider는 `exported="false"`.
- 두 provider 모두 `widgetFeatures="reconfigurable"`이고 `configuration_optional`을 주지 않는다(launcher가 늘 고르는 화면을 연다). configure activity는 RN 화면의 답을 기다린다(hold). 답 없이 다시 resume되면 OK로 끝낸다. module 함수 `finishConfigure(id, ok)`를 둔다.
- `requestPin`은 boolean(창을 띄웠는지)만 돌려준다. 취소하면 아무것도 오지 않아 id를 약속할 수 없다. binding은 native의 callback receiver(mutable PendingIntent)가 extras로 적는다.
- `onUpdate`가 provider마다 와서 연달아 두세 번 온다. 한 번의 새로 하기로 합친다. progress 색은 API 31 이상은 `setColorStateList`, 아래는 tone마다 layout.
- 죽은 채 새로 하기는 release build(`assembleRelease`)에서 확인한다(dev client로는 안 된다). `am force-stop` 뒤에는 Android가 위젯을 회색 card로 가리고 한 번 누를 때까지 아무것도 새로 하지 않는다. 고칠 수 없는 Android의 규칙이니 결함이 아니라 본 것으로 적는다.
- 이 launcher의 2x2 칸은 세로에서 약 172x224 dp로 wireframe의 130x130보다 크다. layout은 위에 붙이고 넘치면 자른다.
- shortcut(pin, disable, enable)을 이 module에 같이 둔다(Kotlin module 하나, prebuild 한 번). `mobile-shortcut-native`는 둘째 module을 만들지 않는다.
