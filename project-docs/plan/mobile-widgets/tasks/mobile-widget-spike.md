# mobile-widget-spike

**opus high.** 폰 위젯과 홈 화면 아이콘을 짓기 전에 Android emulator에서 길을 확인하고 판정 보고서를 쓴다. 코드는 버린다. 판정이 `mobile-widget-store`, `mobile-widget-native`, `mobile-widget-screens`, `mobile-shortcut-native`의 brief를 정한다.

- 단위: widget-spike (wave 1)
- 선행: 없음. lead가 `plan/mobile-app` branch(폰 앱이 `packages/mobile`에 있다)에서 버릴 worktree를 만들어 준다. 그 branch의 commit은 합치지 않는다
- 소유(이 task만 고친다):
  - 없음(버릴 worktree 안에서만 고친다. 보고서는 `/home/pyosechang/projects/lophn/reports/mobile-program/widget-spike.md` 한 file이다)
- 읽을 것:
  - 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/widgets-survey.md`의 2.1(위젯), 2.2(홈 화면 아이콘), 7(읽어서 못 정한 것)
  - 계획 `README.md`의 "정한 것"(native 층의 가정, best effort 새로 하기, 위젯 머리에 아이콘 없음, native는 cache에 적힌 글만 그린다)
  - 폰 앱: `packages/mobile/README.md`(dev build, 개발 core와 pairing), `packages/mobile/src/connection/connection.ts`(Noise 연결과 `call`), `packages/mobile/src/data/mod.ts`, `packages/mobile/app.json`, `packages/mobile/package.json`(Expo 58.0.25, RN 0.88.1), native module 본보기는 `packages/mobile/modules`(있으면)나 Expo 문서의 local module
  - 위젯이 그릴 값: 조사 3의 `WidgetValue`(node 넷)
- 계약:
  - 쓰는 것: 개발 core(`tools/remote-dev.ts`, direct). 사람의 `~/.lophn`과 실제 relay를 쓰지 않는다
  - 내놓는 것: 보고서. 물음마다 답(확인한 것과 못 한 것을 가른다), 잰 숫자, 추천하는 길, 네 native brief에 고칠 것

## 할 일

emulator는 port 5604, Metro 8244: `-read-only -memory 2048 -port 5604`로 띄우고 모든 adb 명령에 `-s emulator-5604`를 붙이고 끝나면 `adb -s emulator-5604 emu kill`로 끈다. gradle은 `--no-daemon -Pkotlin.compiler.execution.strategy=in-process`. 사람의 실제 폰(serial `R3CT90K6G2X`)에는 어떤 명령도 보내지 않는다. `pkill`·`killall`과 `ps`로 process 찾기를 하지 않는다.

1. S1 module 길: (a) 얇은 자체 Expo module(Kotlin, `AppWidgetProvider` 둘: 2x2와 4x2, RemoteViews)이 JS runtime 없이 앱 files 폴더의 JSON cache 하나를 읽어 `text`·`stat`·`progress`·`list` node를 그리는지 짓는다(가로 `ProgressBar`, `LinearLayout`에 쌓은 `TextView`, collection view 없이). (b) `react-native-android-widget`이 RN 0.88·Expo 58에서 build되고 앱이 죽은 채 다시 그리는지 30분 안에서 확인한다. 둘의 build 크기 차이와 다시 그리는 데 JS가 드는지를 적는다.
2. S2 configure activity: 놓을 때 launcher(emulator 기본 launcher)가 configure activity를 띄우는지, 그 activity가 폰 앱의 RN 화면(예: `lophn://widget/bind?id=<n>`로 main activity를 여는 길과 두 번째 RN activity 없이)으로 고르게 하고 결과를 돌려줄 수 있는지. launcher가 configure를 건너뛸 때 placeholder("Tap to choose")에서 같은 화면을 여는 길.
3. S3 앱이 죽은 채 새로 하기: 위젯의 새로 하기 누름과 주기 update(`updatePeriodMillis`)에서 (a) `goAsync` 안의 headless JS가 개발 core에 Noise로 붙고 route 하나(`apps/list` 같은 읽기)를 부르고 cache를 쓰고 다시 그리기까지 끝내는지, 걸린 시간(냉시작 포함 3번 잰다), (b) 안 되면 WorkManager 일로 하는 길과 그 시간. `adb -s emulator-5604 shell am force-stop dev.lophn.mobile`로 죽인 뒤와 recent에서 쓸어 없앤 뒤를 가른다. Android 15의 background 제한을 emulator image 판과 함께 적는다.
4. S4 `requestPinAppWidget`: emulator launcher가 지원하는지(`isRequestPinAppWidgetSupported`), 성공 callback(`PendingIntent`)이 새 `appWidgetId`와 우리가 넣은 extras를 받는지, 놓기를 취소하면 무엇이 오는지.
5. S5 아이콘 그림: `app.icon`의 세 모양(png·webp base64, svg base64, `{lucide}` 이름)을 화면에 보이지 않는 채 PNG(예: 192x192)로 바꾸는 길. `react-native-svg`(15.16.0)의 offscreen 그림이나 다른 JS 길, 안 되면 Kotlin에서 svg를 그리는 길. lucide는 `lucide-react-native`의 path를 쓰는지.
6. S6 pinned shortcut: `ShortcutManagerCompat.requestPinShortcut`의 확인 창, 같은 id로 다시 부를 때, `disableShortcuts(ids, message)` 뒤 누름이 보이는 글, `enableShortcuts`, 아이콘이 보이는 모양, 앱을 다시 깐 뒤 남는지. 누름 intent `lophn://open?host=..&app=..`가 앱을 그 자리로 여는지(`scheme`을 app.json에 잠시 더해 본다).
7. 보고서 `/home/pyosechang/projects/lophn/reports/mobile-program/widget-spike.md`: 물음 S1~S6마다 답, 숫자, 그림 path(`.dev-data/mobile-widget-spike/shots/`), 판정(가정대로 가는가: 자체 module, cache로 그림, headless JS로 새로 하기, configure+placeholder 둘 다, 아이콘 그림 길), 네 brief에 고칠 것(파일, 이름, 단계). 버린 코드에서 옮겨 쓸 만한 Kotlin 조각은 보고서에 짧게 붙인다.

## 끝남

- 보고서가 S1~S6에 모두 답한다(못 한 것은 왜 못 했는지와 무엇이 있으면 되는지).
- emulator와 Metro, 개발 core를 모두 껐다.
- 위험 test: 없음(spike)
- 남지 않음: 없음(버릴 worktree)

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴 가운데 해당하는 것. 더해서: 판정 한 줄, 가정과 다른 것 목록, 사람이나 planner가 정해야 할 갈림(있으면).
