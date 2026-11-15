# mobile-widget-contract

앱 위젯의 값 모양과 두 route의 계약을 고정한다. 값은 정해진 node 넷으로 된 data이고 폰의 native 위젯이 그린다. core handler(`mobile-widget-core`), 폰 cache(`mobile-widget-store`), native 그림(`mobile-widget-native`)이 모두 이것 하나에 기댄다.

- 단위: widgets (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/apps/widget.ts`(새 file)
  - `packages/protocol/apps/widget_test.ts`(새 file)
- 한 줄씩 허락(공유 file. 한 줄만 더하고 보고의 "넘길 줄"에 적는다): `packages/protocol/events/changes.ts`(`CHANGE_NAMES`에 `"widgets"`. 다른 계획이 같은 목록에 줄을 더한다)
- 읽을 것:
  - 본보기(같은 꼴의 메모리 값): `packages/protocol/apps/tray.ts`(`trayToneSchema`, `defineMemory`, broker 입력에 `process_nonce`·`mode`를 더하는 꼴)
  - 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/widgets-survey.md`의 2.1과 3
  - 계획 `README.md`의 "정한 것"(위젯 머리에 아이콘이 없어 list에 icon 칸이 없다)
- 계약:
  - 쓰는 것: `packages/protocol/base/route.ts`의 `defineMemory`, `packages/protocol/base/values.ts`의 `atSchema`, `packages/protocol/apps/channel-values.ts`의 `appIdSchema`·`processNonceSchema`·`runtimeModeSchema`, `tray.ts`의 `trayToneSchema`
  - 내놓는 것(모두 `widget.ts`에서 export. zod `strictObject`):
    - `WIDGET_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/`, `WIDGETS_MAX = 4`(앱 하나가 선언하는 위젯 수의 상한. 선언 검사는 `mobile-widgets-decl`이 같은 숫자를 literal로 쓴다), `WIDGET_VALUE_MAX_BYTES = 4096`
    - `widgetToneSchema` = `trayToneSchema`(`neutral|good|warn|bad`)
    - `widgetNodeSchema` = `kind`로 가르는 union:
      - `{kind:"text", text: 1..48자, tone?, style: "title"|"body"|"caption"}`
      - `{kind:"stat", value: 1..12자, label: 1..24자, tone?}`
      - `{kind:"progress", value: number 0..1, label?: 1..24자, tone?}`
      - `{kind:"list", items: {text: 1..32자, trail?: 1..12자, tone?}[1..5]}`
    - `widgetValueSchema` = `{v: 1, tone?, rows: widgetNodeSchema[1..6]}`, `JSON.stringify`한 UTF-8 byte가 `WIDGET_VALUE_MAX_BYTES` 이하(refine). type `WidgetValue`, `WidgetNode`
    - `appWidgetSet` = `defineMemory({resource: "app_widget", method: "set", name: "app_widget.set", changes: ["widgets"], input: {key: WIDGET_KEY_PATTERN, value: widgetValueSchema | null}, output: {set: true}, actors: ["app"], errors: ["invalid_input", "forbidden", "not_found", "conflict"]})`. `value: null`은 그 위젯의 값을 지운다
    - `appWidgetsList` = `defineMemory({resource: "app_widgets", method: "list", name: "app_widgets.list", input: {}, output: {widgets: AppWidget[]}, reads: ["widgets", "apps", "releases"], actors: ["user"], errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"]})`
    - `appWidgetSchema` = `{app: appIdSchema, app_name: string, key, label: string, screen: string | null, value: WidgetValue | null, at: atSchema | null}`. active 앱의 active release가 선언한 위젯마다 한 줄이다(값이 아직 없으면 `value`·`at`이 null)
    - `brokerWidgetInputSchema` = `appWidgetSet`의 입력에 `process_nonce`, `mode`를 더한 것(broker `POST /_lophn/broker/notify/widget`의 body)
    - `APP_WIDGET_ROUTES = [appWidgetSet, appWidgetsList] as const`
    - event는 새로 없다. 값이 바뀌면 `StateChanged{changes: [{name: "widgets", id: null}]}`이 난다(`changes`의 이름)

## 할 일

1. `packages/protocol/apps/widget.ts`에 위 모양을 쓴다. 파일 머리 주석에 왜 node가 넷뿐인가(위젯은 Android RemoteViews로만 그려 web이나 RN 화면을 띄울 수 없다)와 값이 메모리에만 있다는 것을 적는다.
2. `CHANGE_NAMES`에 `"widgets"`를 더한다(`tray` 옆).
3. route 등록(`packages/protocol/apps/{mod,registry}.ts`)은 handler를 붙이는 `mobile-widget-core`가 한다. 이 task는 등록하지 않는다. 등록 없이 check가 안 돌면 그 줄만 더하고 "넘길 줄"에 적는다.
4. `widget_test.ts`: 위험 test 하나(아래).

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "4 KiB를 넘는 값, 모르는 node kind, 길이를 넘는 글, 범위 밖 progress, 줄 수 밖의 `rows`·`items`는 `widgetValueSchema`가 거절한다"(AI가 쓴 앱의 값이 폰의 native 위젯에 닿는 경계다. 표 하나로 쓴다)
- 남지 않음: 없음(더하기만)

- flows catalog: 이 task가 더하거나 지우는 route, CLI 명령, IPC channel, test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 값 예 둘(넓은 위젯에 맞는 것, node 넷을 다 쓴 것)의 JSON과 byte 수.
