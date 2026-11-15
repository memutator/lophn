# mobile-widget-core

core가 앱 위젯의 값을 받고 내준다. 앱 process가 `@lophn/cap-notify` 1.3.0의 `setWidget(key, value)`·`clearWidget(key)`를 부르면 broker(`/_lophn/broker/notify/widget`, `notify.send` grant)를 거쳐 core memory route `app_widget.set`이 값을 메모리에 둔다. 폰은 `app_widgets.list`로 선언된 위젯과 마지막 값을 읽는다. tray(`app_tray.set`)와 같은 길이다.

- 단위: widgets (wave 3)
- 선행: mobile-widget-contract, mobile-widgets-decl. `mobile-user-apps` land 뒤다(`mobile-widgets-decl`이 그 뒤라서)
- 소유(이 task만 고친다):
  - `packages/core/apps/widgets`(새 폴더: `mod.ts`, `handlers.ts`, `handlers_test.ts`)
  - `packages/core/apps/permissions/broker/notify.ts`
  - `packages/core/apps/permissions/broker/notify_test.ts`
  - `packages/sdk/cap-notify`
  - `packages/core/agent-workspaces/skills/migrate-sdk/cap-notify-1.3.0.md`(새 file)
- 한 줄씩 허락(공유 file. 필요한 줄만 더하고 보고의 "넘길 줄"에 적는다. 다른 계획도 같은 file에 줄을 더한다):
  - packages/core/apps/permissions/broker/server.ts: `BROKER_ROUTES.notifyWidget`와 `routes()`의 `notify.widget` 한 줄
  - packages/core/main/app-supervisor/assembly.ts: `NoticePostPort`의 `setWidget`(자식 credential로 `app_widget/set`을 부른다. `setTray` 옆)
  - packages/core/main/daemon/wiring/apps.ts: `createWidgets(...)` 만들기와 memory handler 둘(`tray` 옆)
  - packages/core/apps/register.ts: `memoryRoutes`에 두 route
  - packages/core/apps/control.ts: `APP_CHILD_OPERATIONS`와 `appsOperationPolicies`에 `app_widget.set`(`appTraySet`과 같은 줄)
  - packages/protocol/apps/mod.ts(`export * from "./widget.ts"`)와 packages/protocol/apps/registry.ts(`APP_WIDGET_ROUTES`)
- 읽을 것:
  - 본보기(같은 일을 tray로 한 것): `packages/core/apps/tray/handlers.ts`, broker `notify.ts`의 `tray`, `server.ts`의 `notifyTray`, app supervisor `assembly.ts`의 `notice.setTray`, `wiring/apps.ts`의 `createTray`(`:331` 근처)와 handler 등록(`:557` 근처), `control.ts`의 `appTraySet` 줄, SDK `packages/sdk/cap-notify/{notify.ts,guide.md}`의 `setTray`·`clearTray`
  - active release 선언 읽기 본보기: `packages/core/apps/routes.ts`의 `iconPathOf`(앱 icon 경로를 active release 선언에서 읽는다)
  - 계약: `packages/protocol/apps/widget.ts`(`mobile-widget-contract`), 선언의 `widgets` 칸(`mobile-widgets-decl`)
  - broker 규칙: `packages/core/apps/permissions/broker/access.ts`(선언∩grant, live 자식만, 거절은 `forbidden`과 `details {permission, scope}`)
  - skill `.claude/skills/sdk-note/SKILL.md`, 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/widgets-survey.md`의 2.1("How the app emits", "How the value reaches the phone")
- 계약:
  - 쓰는 것: `appWidgetSet`, `appWidgetsList`, `brokerWidgetInputSchema`, `widgetValueSchema`, 선언의 `WidgetDeclaration`
  - 내놓는 것:
    - `app_widget.set`: actor는 app만(다른 actor는 `forbidden`). 앱이 없으면 `not_found`, 보관됐으면 `conflict`, key가 active release의 `widgets`에 없으면 `invalid_input`. 값은 `(app, key)`마다 마지막 하나를 메모리에(`at`은 Clock). `value: null`이면 지운다. 바뀌면 `StateChanged{widgets}`(route의 `changes`)
    - `app_widgets.list`: active 앱마다 active release가 선언한 위젯 한 줄씩(`app`, `app_name`, `key`, `label`, `screen`, `value`, `at`). 보관된 앱의 값과 선언에서 빠진 key의 값은 읽을 때 지운다(tray와 같다. 앱 보관 command가 이 module을 모르게)
    - broker `POST /_lophn/broker/notify/widget`: body `brokerWidgetInputSchema`, `notify.send` grant, live 자식만(tray와 같은 판정)
    - SDK `@lophn/cap-notify` 1.3.0: `setWidget(key: string, value: WidgetValue): Promise<void>`, `clearWidget(key: string): Promise<void>`, type `WidgetValue`·`WidgetNode`·`WidgetTone`(SDK 안에 TS type으로 다시 쓴다. protocol을 import하지 않는다). live가 아니면 아무것도 하지 않는다(`setTray`와 같다). 입력이 한도를 넘으면 `CapabilityError` `invalid_input`(SDK가 먼저 4 KiB와 node 모양을 본다)

## 할 일

1. `packages/core/apps/widgets/handlers.ts`: `createWidgets({clock, appStatus, declaredWidgets})` → `{set, list}`(tray의 `createTray` 꼴). `declaredWidgets(app)`는 active release 선언의 `widgets`와 앱 이름을 주는 port이고 `wiring/apps.ts`가 `iconPathOf`처럼 `link.sql`로 잇는다. 목록은 active 앱 전체를 도는 port 하나(`appsWithWidgets()`)로 받는다.
2. broker `notify.ts`에 `widget(child, body)`를 더한다(`tray`와 같은 판정). `NoticePostPort`에 `setWidget`. `server.ts`, app supervisor `assembly.ts`의 줄. `notify_test.ts`의 tray 갈래 옆에 widget 갈래 한 줄(grant 없음 → `forbidden`, 같은 표에).
3. `wiring/apps.ts`, `register.ts`, `control.ts`, `protocol/apps/{mod,registry}.ts`의 등록 줄.
4. SDK `cap-notify` 1.3.0: `notify.ts`에 `setWidget`·`clearWidget`(`NOTIFY_WIDGET_PATH`), `mod.ts` 내보내기, `guide.md`에 위젯 절(무엇을 내나: node 넷과 한도, 선언한 key만, 값은 메모리에만 있어 앱이 시작 코드에서 다시 낸다, 사람이 폰 홈 화면에 그 위젯을 놓았을 때만 보인다, 폰은 늘 새로 하지 못해 가져온 시각을 보인다, 예제 하나). 메모 `cap-notify-1.3.0.md`(minor, `Previous: 1.2.0`, 한 줄 예. `## Instruction diff`는 `guide.md` 변경의 git diff. `mobile-widgets-guidance`가 지침 diff를 더한다). pin은 `sdk-note`의 grep으로 찾는다.
5. 개발 core에서 손으로 확인: 작은 앱(`tests/support/app/` 꼴, 위젯 하나를 선언하고 시작 코드에서 `setWidget`)을 띄워 `app_widgets/list`가 값을 내고 앱을 보관하면 그 줄이 빠지는지.

## 끝남

- `npm run check`가 통과한다. `node tools/check-sdk-notes.ts`가 통과한다.
- 위험 test: "app 자격만 자기 앱의 위젯 값을 쓰고(user 자격은 `forbidden`), 선언하지 않은 key는 `invalid_input`이며, 목록은 보관된 앱과 선언에서 빠진 key의 값을 내지 않는다"(`handlers_test.ts`. 앱의 data가 다른 앱이나 없어진 앱의 이름으로 폰에 가지 않는 경계다), broker의 grant 거절은 `notify_test.ts`의 기존 표에 한 줄
- 남지 않음: 없음(더하기만)

- flows catalog: 이 task가 더하거나 지우는 route, SDK export, broker 길, test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: `app_widgets.list` 출력 예(값이 있는 줄과 없는 줄), 앱 코드 예(`setWidget` 호출), 등록할 것과 넘길 줄 목록.
