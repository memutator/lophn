# mobile-open-target

알림 누름, 위젯 누름, 홈 화면 shortcut 누름이 모두 같은 것으로 폰 앱의 한 자리를 열게 한다: `OpenTarget` 하나와 parser 하나(`parseOpenTarget`). push 계획의 알림 `data` 모양을 그대로 받고, 같은 것을 URL(`lophn://open?...`)로도 받는다. 앱에 `scheme: "lophn"`을 더하고 Linking으로 URL을 받는다. 알림 누름은 이 parser 위로 옮긴다.

- 단위: open-target (wave 3)
- 선행: 없음. **`mobile-push`와 `mobile-user-apps` 계획이 main에 land된 뒤에 띄운다**(`mobile-push-phone`이 알림 누름과 `parseNotificationData`를, `mobile-phone-apps`가 갈 곳 `app(id, screen?)`을 냈다). 아래 `packages/mobile/...` path는 land된 실제 이름을 먼저 확인한다(lead가 띄우기 전에 맞춘다)
- 소유(이 task만 고친다):
  - `packages/mobile/src/open`(새 폴더: `target.ts`, `target.test.ts`, `linking.ts`)
  - `packages/mobile/app.json`(`expo.scheme: "lophn"` 한 줄)
  - `packages/mobile/src/push`(알림 누름이 `parseOpenTarget`과 `openTarget`을 부르게 하는 만큼만. `parseNotificationData`와 그 test는 `open/`으로 옮겨 지운다)
  - `packages/mobile/src/app/root.tsx`(Linking 듣기를 다는 한 곳만)
- 읽을 것:
  - push 계획: `.claude/worktrees/plan-mobile-push/project-docs/plan/mobile-push/tasks/mobile-push-phone.md`의 7(알림 누름의 규칙: `data.host`가 pairing한 컴퓨터면 그 컴퓨터를 고르고 `session`·`app`·`inbox`를 연다, 모르면 Inbox, `term:` session은 Inbox, 모양이 틀리면 `null`)과 `mobile-attention-core.md`의 `PushMessage.data` 모양
  - 폰 앱: `packages/mobile/src/app/nav.ts`(`Place`, `useNav().open`), `packages/mobile/src/data/mod.ts`(컴퓨터 store와 고르기), `packages/mobile/src/push/`(지금 누름 처리), user-apps의 갈 곳 `app`
  - 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/widgets-survey.md`의 2.4, 계획 `README.md`의 "정한 것"
- 계약:
  - 쓰는 것: 알림 `data {host, kind: "session" | "app" | "inbox", session?, app?}`, 컴퓨터 key(`host`는 컴퓨터의 공개 key 글)
  - 내놓는 것(`packages/mobile/src/open/target.ts`. React Native를 import하지 않는 순수 file):
    - `type OpenTarget = {kind: "session", host, session} | {kind: "app", host, app, screen?} | {kind: "inbox", host}`
    - `parseOpenTarget(value: unknown, pairedHosts: ReadonlySet<string>): OpenTarget | null`. 알림 `data` 객체(선택 칸 `screen`이 더해질 수 있다)와 URL 글 둘 다 받는다. 모양이 틀리거나 `host`가 pairing한 컴퓨터가 아니면 `null`
    - `openUrl(target: OpenTarget): string`: `lophn://open?host=<key>&kind=<kind>&session=<id>` | `...&kind=app&app=<id>[&screen=<key>]` | `...&kind=inbox`(값은 URL encode)
    - `packages/mobile/src/open/linking.ts`: `useOpenTargets()`(앱 root가 한 번 단다): 앱이 떠 있을 때의 URL과 꺼져 있다 열릴 때의 첫 URL을 받아 parse하고, 그 컴퓨터를 고르고, 갈 곳을 연다(`session` → 그 session, `app` → `app(id, screen?)`, `inbox` → Inbox). `null`이면 아무것도 열지 않는다
    - 뒤 task가 기댄다: `mobile-widget-store`(위젯 누름 URL을 `openUrl`로 만든다), `mobile-shortcut-native`(shortcut intent), `mobile-widget-screens`(`widget_bind` 갈래를 이 file에 더한다)

## 할 일

1. `target.ts`: type, parser, `openUrl`. push의 `term:` 규칙(Inbox로)은 push 쪽 누름 처리에 남긴다(알림만의 규칙이다).
2. `target.test.ts`: push의 `parseNotificationData` test 표를 옮겨 `parseOpenTarget`에 맞추고 URL 줄과 pairing하지 않은 `host` 줄을 더한다(위험 test). 옛 함수와 test는 지운다.
3. `app.json`에 `"scheme": "lophn"`. `linking.ts`와 `root.tsx`의 한 줄. 알림 누름(`packages/mobile/src/push`)이 같은 dispatcher를 부르게 한다.
4. native 설정이 바뀌었으니 `packages/mobile/README.md`대로 dev build를 다시 짓는다.
5. emulator(port 5606, Metro 8246)에서 확인한다: `-read-only -memory 2048 -port 5606`, 모든 adb 명령에 `-s emulator-5606`, 끝나면 `adb -s emulator-5606 emu kill`, gradle은 `--no-daemon -Pkotlin.compiler.execution.strategy=in-process`, 사람의 실제 폰(serial `R3CT90K6G2X`)에는 아무 명령도 보내지 않는다. 개발 core(`tools/remote-dev.ts`)와 pairing한 뒤 `adb -s emulator-5606 shell am start -a android.intent.action.VIEW -d "lophn://open?..."`로 session, app, inbox를 앱이 떠 있을 때와 `am force-stop` 뒤 둘 다 연다. 모르는 host URL이 아무것도 열지 않는 것, push 계획의 "Send a test notification" 누름이 그대로 도는 것을 본다. 그림은 `.dev-data/mobile-open-target/shots/`.

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check`가 통과한다.
- 위험 test: "`parseOpenTarget`은 lophn이 만든 모양이 아닌 값(다른 앱의 알림, 빠진 칸, 이상한 type, 모르는 URL)과 pairing하지 않은 컴퓨터의 `host`에서 `null`을 내고 아무 화면도 열지 않는다"(push의 같은 test를 옮겨 늘린다. 새 file은 `target.test.ts` 하나)
- 남지 않음: `grep -rn "parseNotificationData" packages/mobile/src`가 0줄이다.

- flows catalog: 이 task가 더하거나 지우는 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: URL 꼴 셋의 예, cold start에서 첫 URL을 읽은 API 이름, 그림 목록.
