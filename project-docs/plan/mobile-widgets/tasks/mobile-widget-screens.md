# mobile-widget-screens

폰 앱 안의 위젯 화면을 wireframe대로 짓는다: "Choose a widget"(놓인 위젯이나 놓을 위젯에 어느 컴퓨터·앱·위젯을 묶을지 고른다), 앱 menu의 "Add widget" 줄, 놓았지만 고르지 않은 위젯을 누를 때(`lophn://widget/bind?id=<n>`) 그 화면으로 가는 길.

**사람이 `mobile-widget-wireframes`를 승인한 뒤, spike 판정으로 lead가 이 brief를 다시 본 뒤에 띄운다**(계획 `README.md` "사람이 할 것", "돌리기 전에").

- 단위: widgets (wave 6)
- 선행: mobile-widget-native, mobile-widget-wireframes, mobile-open-target. 아래 `packages/mobile/...` path는 land된 실제 이름을 먼저 확인한다(앱 화면의 ⋯ menu는 `mobile-user-apps`의 `mobile-phone-apps`가 지었다)
- 소유(이 task만 고친다):
  - `packages/mobile/src/screens/widgets`(새 폴더: "Choose a widget" 화면과 그 조각)
  - `packages/mobile/src/open`(`OpenTarget`에 `{kind: "widget_bind", widget: number}` 갈래, URL `lophn://widget/bind?id=<n>`, 그 갈래의 열기와 test 표의 줄을 더하는 만큼만)
  - `packages/design/i18n/catalog/mobile-widgets.ts`
- 한 줄씩 허락(보고의 "넘길 줄"에 적는다): `packages/mobile/src/app/nav.ts`(갈 곳 `{name: "widget-pick", widget?: number, app?: {host, id}}` 하나), 갈 곳을 화면에 잇는 file(`packages/mobile/src/app/routes.tsx` 등. 한 줄), 앱 화면의 ⋯ menu file(`packages/mobile/src/screens/apps` 안. "Add widget" 줄 하나), `packages/mobile/src/widgets/store.ts`(컴퓨터 하나의 위젯 목록을 읽는 내보내기가 없으면 그 하나)
- 읽을 것:
  - 기준: `tools/wireframes/drafts/phone/widgets.tsx`(Choose a widget, 앱으로 좁힌 모양, 빈 상태, 앱 menu의 "Add widget"), `apps.tsx`의 `AppMenu`, `phone.module.css`(px를 그대로 dp로). 그림은 `.dev-data/mobile-widget-wireframes/shots/`(그 task의 보고)
  - kit: `packages/design/native/mod.ts`(export마다 윗줄이 쓰임새)
  - 폰 앱: `packages/mobile/src/widgets/{store.ts,native.ts}`(`bindWidget`, `refreshWidgets`, `requestPin`, `isPinSupported`), `packages/mobile/src/open/{target.ts,linking.ts}`, `packages/mobile/src/app/nav.ts`, `packages/mobile/src/data/mod.ts`(pairing한 컴퓨터 목록)
  - 계획 `README.md`의 "정한 것"과 "돌리기 전에"(dev build APK 경로)
- 계약:
  - 쓰는 것: `app_widgets/list`(store를 거쳐), `@lophn/ui-native`, `@lophn/i18n`의 `t()`
  - 문구: desktop catalog(`packages/design/i18n/catalog/*.ts`)에 같은 문장이 있으면 그 key를 쓰고, 없을 때만 `mobile-widgets.ts`에 `mobile.widget.`으로 시작하는 key를 더한다. 문장 조각을 이어 붙이지 않는다(ICU 한 문장)

## 할 일

1. `widget_bind` 갈래: `target.ts`의 type과 parser와 URL, `linking.ts`가 그 갈래에서 `widget-pick(widget)`을 연다, `target.test.ts` 표에 URL 줄(틀린 id는 `null`).
2. "Choose a widget": pairing한 컴퓨터마다 묶음, 앱마다 위젯 줄(label과 지금 값의 작은 미리보기는 wireframe대로). 닿지 않는 컴퓨터는 묶음 머리에 그 상태 한 줄. 위젯을 선언한 앱이 없으면 빈 상태. `widget`이 있으면(놓인 위젯에서 왔다) 고르면 `bindWidget(id, …)`와 `refreshWidgets("bind")`를 하고 화면을 닫는다. `app`이 있으면(앱 menu에서 왔다) 그 앱의 위젯만 보이고, 고르면 크기(wireframe대로)와 함께 `requestPin`을 부른다. `null`이 오면 "홈 화면에서 위젯을 눌러 고르세요" 같은 안내를 wireframe의 글로 보인다.
3. 앱 menu에 "Add widget" 줄: 그 앱이 위젯을 선언했고 `isPinSupported()`일 때만.
4. lead가 지은 dev build(README "돌리기 전에"의 APK)를 emulator(port 5610, Metro 8250)에 깔아 확인한다: `-read-only -memory 2048 -port 5610`, 모든 adb 명령에 `-s emulator-5610`, 끝나면 `adb -s emulator-5610 emu kill`, 사람의 실제 폰(serial `R3CT90K6G2X`)에는 아무 명령도 보내지 않는다. 개발 core(`tools/remote-dev.ts`)와 위젯을 내는 작은 앱으로: placeholder 누름에서 고르기까지, 앱 menu에서 놓기까지, 빈 상태, dark. 그림은 `.dev-data/mobile-widget-screens/shots/`.

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check`가 통과한다.
- 그림이 wireframe과 같은 구조·크기·색이다(lead가 대조한다).
- 위험 test: 없음(화면. `target.test.ts`의 기존 위험 test 표에 `widget_bind` 줄을 더한다)
- 남지 않음: 없음

- flows catalog: 이 task가 더하거나 지우는 입구와 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 더한 i18n key 목록, 넘길 줄 목록, 그림 목록, `requestPin`이 id를 준 경우와 안 준 경우에 본 것.

## lead가 더함 (spike 판정 `reports/mobile-program/widget-spike.md`, 2026-11-16)

가정은 맞고 다섯 곳이 바뀐다. 보고서의 "Different from the assumptions", "Changes for the four native briefs", "Kotlin worth moving"를 먼저 읽는다. 이 brief의 본문과 다르면 아래가 맞다. spike의 코드는 `/home/pyosechang/projects/lophn-worktrees/spike-widgets`(branch `spike/widgets`)에 있다(읽기만).

- "Choose a widget"이 `from=configure`로 열렸으면 고르거나 닫을 때 `finishConfigure(id, true|false)`를 부른다(native가 앱을 뒤로 보낸다). 아니면 `bindWidget`과 다시 그리기만 한다. 앱 menu의 "Add widget"은 `requestPin`이 true면 더 보일 것이 없다(위젯이 묶인 채 나타난다).
