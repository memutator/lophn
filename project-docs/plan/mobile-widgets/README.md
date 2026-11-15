# mobile-widgets: 사람의 앱이 폰 홈 화면에 위젯과 아이콘을 두고, 앱 backend가 core를 거쳐 폰의 위치를 묻는다

- 목표: roadmap 단계 8. (1) 앱이 선언한 위젯의 내용을 `@lophn/cap-notify`로 data(정해진 node 넷)로 내고 폰의 native 위젯이 그것을 그린다. (2) 앱 하나를 폰 홈 화면의 pinned shortcut으로 둔다. (3) core에서 폰으로 가는 요청 길(`request`/`response` frame과 `PhoneLink`)을 한 번 일반으로 짓고, 그 위의 첫 기능으로 앱 backend가 `@lophn/cap-phone`과 grant `phone.use`를 거쳐 폰의 위치(`location.get`)를 한 번 읽는다. 위젯 누름, shortcut 누름, 알림 누름은 open target 하나로 연다.
- 재료: `project-docs/products/roadmap/mobile.md`(단계 8, "위젯"·"홈 화면 아이콘"·"폰 기능"), 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/widgets-survey.md`(사실, 설계, 계약. 아래 "정한 것"이 다르면 이것이 이긴다), `project-docs/architecture/{remote,activation,app-call,app-notice,approval,event,ui-kit}.md`, wireframe `tools/wireframes/drafts/phone/apps.tsx`의 `AppMenu`("Add to Home screen" 줄), 먼저 도는 계획 넷(`mobile-app`, `mobile-user-apps`, `mobile-push`, `mobile-coding-agents`)의 README와 `tasks/`(각 lead worktree `.claude/worktrees/plan-<계획>`).
- 범위 밖: agent가 폰 기능을 부르는 길(`phone/request` route, `lophn phone location`, 기기마다의 스위치. roadmap은 쓰는 예가 생길 때 기능과 caller를 하나씩 연다), camera와 그 밖의 기능, background 위치와 위치 연속 받기, 폰을 push로 깨워 답하게 하기, push로 위젯 새로 하기, 위젯 안의 이미지·단추·줄마다의 행동, dynamic shortcut, 위치 읽기의 banner와 기록, 폰에서 도는 앱(단계 7)의 위젯과 shortcut(`mobile-local-apps`가 정한다), iOS.
- 단위: `phone-link`(core→폰 요청 길: 계약, core의 link, 폰의 답), `phone-use`(앱의 길: SDK part, grant와 broker), `widgets`(계약, 선언, core, 폰 cache, native, 화면, 지침), `open-target`(누름 하나로 열기), `shortcuts`(홈 화면 아이콘), `widget-spike`, `widget-design`(wireframe). 소유 path는 brief가 정한다.
- 순서(wave는 앞 wave가 모두 merged일 때 열린다. 다른 계획의 land를 기다리는 task는 brief의 "선행" 둘째 문장이 그 land를 이름으로 적는다):
  - wave 1(지금): `mobile-widget-wireframes`, `mobile-widget-spike`, `mobile-widget-contract`, `mobile-phone-link-contract`.
  - wave 2: `mobile-cap-phone`(지금 된다), `mobile-widgets-decl`(**`mobile-user-apps` land 뒤**. declaration 4.6.0 위에 4.7.0).
  - wave 3: `mobile-widget-core`(`mobile-user-apps` land 뒤), `mobile-open-target`(**`mobile-push`와 `mobile-user-apps` land 뒤**).
  - wave 4~7(`mobile-app`, `mobile-user-apps`, `mobile-push` land 뒤. spike 판정을 lead가 읽은 뒤): `mobile-widget-store` → `mobile-widget-native` → `mobile-widget-screens`(사람이 wireframe을 본 뒤) → `mobile-shortcut-native`. native build file(`packages/mobile/{app.json,package.json,package-lock.json}`)을 고치는 task가 겹치지 않게 한 줄로 세웠다.
  - wave 8~10(**`packages/core/remote`를 같이 고치는 task가 main에 있은 뒤**: `mobile-user-apps`의 `mobile-remote-gate`, `mobile-push`의 `mobile-push-device`, `mobile-coding-agents`의 `mobile-terminal-device-grant`. 곧 세 계획의 land 뒤): `mobile-phone-link` → `mobile-phone-use-grant` → `mobile-phone-location`과 `mobile-widgets-guidance`.
  - wave 번호는 다른 계획이 land되는 순서를 짐작한 것이다(위젯 길이 core/remote 길보다 먼저 열린다). land 순서가 다르면 lead가 brief의 wave 숫자만 바꾸고 `status.py build`를 다시 돌린다. 두 길은 wave 10의 지침 task 말고는 서로 기대지 않는다.
  - land는 계획 끝에 한 번. 그래서 SDK 판(declaration 4.7.0, app-ui 2.16.0, cap-notify 1.3.0, cap-phone 1.0.0)은 land 전까지 어느 앱에도 가지 않고 뒤 task가 같은 판 안에서 guide와 메모를 고친다.

## 정한 것

- (planner) core에서 폰으로 가는 요청 길은 하나를 일반으로 짓는다. remote channel에 `request`/`response` frame을 더하고 core 서비스 `PhoneLink.call({device, kind, input, deadline_ms})`를 `packages/core/remote`에 둔다. 폰은 답하는 kind를 `hello.capabilities`에 적는다. frame 칸은 `kind`다: `location.get` 같은 폰 기능은 kind의 한 갈래이고, 단계 10이 같은 길에 `drive.*` kind를 더한다(그 조사가 낸 event와 답 route 길 대신). 응답의 bytes는 `value` 안 base64로 16 MiB frame 상한 안에 싣는다. 단계 10이 frame을 바꾸지 않는다.
- (planner) 앱의 길만 짓는다. 앱 backend가 새 SDK part `@lophn/cap-phone` 1.0.0과 broker를 거쳐 부르고, 새 permission kind 하나 `phone.use`(scope `{capability}`)를 앱마다 한 번 기존 activation 동의 카드로 묻는다. 기능은 `location.get`(앞에 떠 있을 때, 한 번) 하나다.
- (planner) 폰이 앞에 없거나 닿지 않으면 `unavailable`이고 `details.reason`이 이유다(survey 2.3의 표). 폰을 push로 깨우지 않는다.
- (planner) 위치 읽기는 lophn banner를 띄우지 않고 기록을 쓰지 않는다. 동의 카드가 동의이고 Android가 자기 위치 표시를 띄운다.
- (planner) 위젯은 선언한다: `@lophn/declaration` 4.7.0의 `widgets` 칸. `mobile-local-apps`가 자기 칸으로 4.8.0을 쓴다. land 순서가 바뀌면 lead가 land 때 판을 다시 매긴다(메모 file 이름, `Previous:`, pin).
- (planner) 위젯 새로 하기는 best effort다(앱을 열 때, 연결된 동안 `StateChanged{widgets}`, Android의 주기 update, 위젯의 새로 하기 아이콘). 위젯은 늘 가져온 시각을 보이고 마지막 시도가 실패했으면 "Offline <시각>"을 보인다. push로 새로 하지 않는다.
- (planner) native 위젯 층은 survey의 기본(얇은 자체 Kotlin Expo module `lophn-widgets`, 고정 provider 둘, configure activity와 picker, JS runtime 없이 cache file로 그리는 RemoteViews)을 가정으로 brief를 쓰고, 그 전에 `mobile-widget-spike`가 정한다. **lead는 spike 판정을 읽고 `mobile-widget-store`, `mobile-widget-native`, `mobile-widget-screens`, `mobile-shortcut-native` brief를 다시 본 뒤에 띄운다.**
- (planner) 홈 화면 아이콘은 앱마다 pinned shortcut 하나다(고정 id, 아이콘은 `app.icon`, 앱이나 컴퓨터가 없어지면 disable).
- (planner) 알림 누름, 위젯 누름, shortcut 누름은 open target 하나(`OpenTarget`, parser 하나, `scheme: "lophn"`)로 연다. push 계획의 알림 `data` 모양을 그대로 쓴다.
- (planner) iOS와 camera 등 다른 기능은 task가 없다.
- (agent) survey와 다르게, 또는 survey가 정하지 않아 정한 것:
  - `phone.use`는 ledger schema step이 하나 든다. 표 `grants`의 `kind` CHECK가 kind를 나열해서다(`packages/core/apps/permissions/schema.ts`, `notify.send` 때의 `apps.permissions.notify_kind`와 같은 표 다시 만들기). survey는 "schema step 없음"이라 했다. step은 WIRINGS 맨 뒤 wiring(`remoteWiring`)의 `schemaStepsAfterTeams`와 lock 끝에 붙고, 기존 grant 행이 모두 남는지가 위험 test다.
  - `PermissionKind`가 vendored declaration file(`packages/protocol/apps/declaration/types.ts`)에 있어 `phone.use`는 선언 쪽 변경이다. 그래서 `widgets` 칸과 `phone.use`를 declaration 4.7.0 task 하나(`mobile-widgets-decl`)가 한다. declaration file은 zod 정본을 import할 수 없어 아는 기능 목록은 그 안의 literal(`PHONE_CAPABILITIES`)이다. `@lophn/app-ui`가 declaration을 정확한 판으로 pin해 app-ui도 2.16.0으로 올린다.
  - broker는 core가 아니라 앱 supervisor process에 있다(`packages/core/main/app-supervisor/`). 그래서 broker는 grant를 본 뒤 자식 app credential로 core memory route `app_phone.request`를 부르고(tray의 `app_tray.set`과 같은 길), 그 handler가 늦게 채우는 wiring 칸 `phoneLink`로 기준 폰(`devices.is_primary`)을 부른다.
  - 앱 쪽 이름은 `capability`(grant scope, broker body), link 쪽 이름은 `kind`다. 앱 기능에서는 같은 문자열이다.
  - `@lophn/cap-phone`은 live가 아닌 mode(preview, test)에서 broker를 부르지 않고 고정 stand-in 위치에 `standIn: true`를 돌려준다(`cap-notify`의 non-live 동작과 같은 규칙).
  - 위젯 머리는 앱 이름과 위젯 label만이다. 앱 아이콘을 그리지 않는다(위젯 길에서 SVG를 그림으로 바꾸지 않으려고). 그래서 `app_widgets.list`는 icon 칸이 없다. 앱 아이콘은 shortcut만 쓴다.
  - 위젯에 보이는 글(시각 줄, "Tap to choose", "no longer available")은 TS가 `t()`로 만들어 cache file에 적고 native는 적힌 글만 그린다. 문구가 i18n catalog 한 곳에 있다.
  - `lophn app widgets` 같은 CLI는 두지 않는다(tray에도 없고, `app_widgets.list`는 사람 자격만 읽는다).
  - 옛 폰은 `request`를 받지 않는다. core는 폰이 `hello.capabilities`에 적은 kind만 묻는다. 그래서 `REMOTE_PROTOCOL_VERSION`을 올리지 않는다.
- worker는 `sonnet-high`로 띄운다. 어려운 task(`mobile-widget-spike`, `mobile-widget-native`, `mobile-shortcut-native`, `mobile-phone-link`)는 opus high다(planner). brief 머리에 적었다.

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `mobile-widget-wireframes` | 위젯 모양(2x2, 4x2, node 넷, stale·offline, "Tap to choose", 없어진 위젯), "Choose a widget", 앱 menu의 두 줄, 동의 카드의 위치 줄 wireframe |
| 1 | `mobile-widget-spike` | (opus high) emulator에서 위젯 module 길, configure activity, 앱이 죽은 채 새로 하기, `requestPinAppWidget`, 아이콘 그림 만들기, pinned shortcut을 확인하고 판정 보고서를 쓴다 |
| 1 | `mobile-widget-contract` | `WidgetValue`(node 넷), `app_widget.set`, `app_widgets.list`, change 이름 `widgets`, 모양 test |
| 1 | `mobile-phone-link-contract` | `request`/`response` frame 모양(독립 module), kind 목록과 `location.get`, `unavailable` 이유, 앱 route `app_phone.request`와 broker body |
| 2 | `mobile-cap-phone` | 새 SDK part `@lophn/cap-phone` 1.0.0(`getLocation`, stand-in, guide, 첫 판 메모) |
| 2 | `mobile-widgets-decl` | `@lophn/declaration` 4.7.0: `widgets` 칸과 `phone.use` kind, app-ui 2.16.0, pin과 메모. `mobile-user-apps` land 뒤 |
| 3 | `mobile-widget-core` | core 메모리 위젯 값과 두 route, broker `notify/widget`, `cap-notify` 1.3.0 `setWidget`·`clearWidget` |
| 3 | `mobile-open-target` | `OpenTarget`과 parser 하나, `lophn://` scheme과 Linking, 알림 누름을 그 위로. `mobile-push` land 뒤 |
| 4 | `mobile-widget-store` | 폰의 `refreshWidgets()`, cache와 binding file, stale·offline 규칙, 위젯 글, allowlist의 `app_widgets/list` |
| 5 | `mobile-widget-native` | (opus high) Expo module `lophn-widgets`: provider 둘, configure, RemoteViews로 node 넷, 누름과 새로 하기, 주기 update |
| 6 | `mobile-widget-screens` | "Choose a widget" 화면, 앱 menu의 "Add widget", 놓기 전 placeholder 연결 |
| 7 | `mobile-shortcut-native` | (opus high) Expo module `lophn-shortcuts`, 아이콘 그림, "Add to Home screen", 앱이나 컴퓨터가 없어지면 disable |
| 8 | `mobile-phone-link` | (opus high) frame을 remote channel에 더하고 `PhoneLink`(기기 찾기, deadline, 닫힘, 모르는 답 버리기), wiring 칸 `phoneLink` |
| 9 | `mobile-phone-use-grant` | `phone.use` grant(ledger step, facts, 동의 카드 줄, App details), broker `phone/request`, core route `app_phone.request` |
| 10 | `mobile-phone-location` | 폰이 `request`에 답하는 일반 고리와 `location.get`(`expo-location`, OS 권한, 앞에 있을 때만) |
| 10 | `mobile-widgets-guidance` | 앱 agent 지침(`design-app`의 Widgets와 Phone location, guide 맞춤, 메모의 Instruction diff) |

## 돌리기 전에

- 지금 띄워도 되는 것은 wave 1과 `mobile-cap-phone`뿐이다. 나머지는 `packages/mobile`, `packages/design/native`, `packages/protocol/remote/**`, `packages/core/remote/**`, declaration file(단계 6이 판을 올린다) 가운데 하나를 고친다. 각 brief의 "선행" 둘째 문장이 기다릴 land를 적었다. `status.py ready`는 다른 계획의 land를 모르니 lead가 띄우기 전에 main에 그 commit이 있는지 본다.
- `mobile-widget-spike`: lead가 `plan/mobile-app` branch(폰 앱이 `packages/mobile`에 있다)에서 버릴 worktree를 하나 만들어 준다. 그 branch는 합치지 않는다. 보고서는 `/home/pyosechang/projects/lophn/reports/mobile-program/widget-spike.md`다.
- spike 판정 뒤: 판정이 가정(자체 Kotlin module, cache file로 그림, headless JS로 새로 하기)과 다르면 lead가 네 native brief(`mobile-widget-store`, `mobile-widget-native`, `mobile-widget-screens`, `mobile-shortcut-native`)를 판정에 맞춰 고친 뒤 띄운다. 큰 갈림(예: 앱이 죽은 채로는 새로 하기가 안 된다, 그래서 위젯이 앱을 열 때만 새로 된다)은 planner에게 올린다.
- 다른 계획과 같은 file을 만지는 곳(lead가 합칠 때 두 쪽을 다 남긴다):
  - `tools/wireframes/drafts/phone/index.tsx`: `mobile-coding-wireframes`가 `FLOWS`에 "10 Coding agents and terminal"을 더했다(그 plan branch). 이 계획은 "11"을 더한다.
  - `packages/protocol/events/changes.ts`(`CHANGE_NAMES`), `packages/protocol/apps/{mod,registry}.ts`, `packages/core/apps/register.ts`, `packages/core/main/daemon/wiring/{apps,context}.ts`, `packages/core/main/app-supervisor/assembly.ts`, `packages/core/apps/permissions/broker/server.ts`, `packages/core/apps/control.ts`, `package-lock.json`: brief가 한 줄씩 허락하고 보고의 "넘길 줄"에 적게 했다.
  - `packages/core/storage/migration/schema-steps.lock.json`과 `wiring/remote.ts`의 `schemaStepsAfterTeams`: `mobile-phone-use-grant`가 step 하나를 끝에 붙인다. `mobile-push-device`·`mobile-terminal-device-grant`의 `devices` step이 먼저 main에 있으니 그 뒤다.
  - `packages/shell/renderer/desktop/connection/waiting/model.ts`(push 계획 `mobile-attention-desktop`의 폴더)와 `packages/design/i18n/catalog/data.ts`(user-apps `mobile-phone-changed-notice`): 두 계획 land 뒤에 고치므로 그 위에서 고친다.
  - `packages/mobile/src/screens/apps`(앱 화면의 ⋯ menu, user-apps `mobile-phone-apps`), `packages/mobile/src/push`(push `mobile-push-phone`), `packages/mobile/src/app/nav.ts`: 이 계획의 task는 줄만 꽂는다(brief가 줄을 적었다). land된 실제 file 이름은 띄우기 전에 lead가 brief에 맞춘다.
- lead가 `mobile-widget-screens` 전에 `packages/design/i18n/catalog/mobile-widgets.ts`를 빈 file로 만들어 `packages/design/i18n/en.ts`에 올린다(`mobile-app`과 같은 길). `mobile-widget-store`(위젯 글)와 `mobile-shortcut-native`(disable 글)도 이 file에 key를 더한다. 그래서 이 file은 `mobile-widget-store` 전에 만든다.
- emulator: 이 계획의 port는 5604~5612(Metro 8244~8252)다. `mobile-widget-spike` 5604·8244, `mobile-open-target` 5606·8246, `mobile-widget-native` 5608·8248, `mobile-widget-screens` 5610·8250, `mobile-shortcut-native` 5612·8252, `mobile-phone-location` 5604·8244(spike는 wave 1에서 끝났다). AVD `lophn-phone`을 `-read-only -memory 2048 -port <port>`로 띄우고 모든 adb 명령에 `-s emulator-<port>`를 붙이고 끝나면 `adb -s emulator-<port> emu kill`로 끈다. gradle은 `--no-daemon -Pkotlin.compiler.execution.strategy=in-process`. `pkill`·`killall`과 `ps`로 process를 찾아 죽이는 일은 하지 않는다. 사람의 실제 폰(serial `R3CT90K6G2X`)에는 어떤 명령도 보내지 않는다.
- 개발 core는 `packages/mobile/README.md`의 `tools/remote-dev.ts` 길(direct)을 쓴다. 사람의 `~/.lophn`, 실제 relay(`wss://lophn-relay.fly.dev`), 실제 model provider를 쓰지 않는다. 위젯·위치를 내는 앱은 worker가 손으로 쓴 작은 앱(`tests/support/app/` 꼴)이다.
- `mobile-widget-native` merge 뒤 lead가 plan branch에서 dev build(x86_64)를 한 번 지어 `/tmp/lophn-mobile-widgets-x86_64.apk`에 두고 `mobile-widget-screens` worker에게 알린다(그 task는 native module을 더하지 않는다).

## 사람이 할 것

- `mobile-widget-wireframes`가 낸 gallery Drafts › Phone app의 "11 Widgets and home screen"을 보고 승인한다. 승인 전에 `mobile-widget-screens`와 `mobile-shortcut-native`를 띄우지 않는다. 같이 볼 문구: 동의 카드의 "Use your phone's location" 줄, 위젯의 "Updated 14:05"·"Offline 14:05"·"Tap to choose"·"This widget is no longer available".
- 계정, key, 비용은 들지 않는다. 나중에 Play Store에 낼 때 위치 사용의 data-safety 신고가 든다(이 계획 밖). 실제 폰에 새 build를 까는 것은 사람에게 묻는다.

## lead가 할 일

- merge 때마다: `npm run check`. `packages/mobile`을 고친 task는 `cd packages/mobile && npm run typecheck && npm test`도, worker가 남긴 emulator 그림(`.dev-data/<id>/shots/`)을 wireframe 그림과 대조한다. 어긋나면 같은 worker에게 돌려보낸다. 공유 줄은 task 보고의 "등록할 것"·"넘길 줄"대로 합친다.
- `mobile-widget-spike` 뒤: 보고서를 읽고 위 "돌리기 전에"대로 native brief를 다시 본다.
- `mobile-phone-link` 뒤: memory 전송 test가 기기 주소와 deadline을 지키는지 보고의 test 이름으로 확인한다. `mobile-phone-use-grant` 뒤: 개발 core에서 grant가 없는 앱이 `forbidden`, grant가 있고 폰이 없으면 `unavailable`(`no_phone`)인지 한 번 본다.
- 끝에: `architecture/remote.md`(폰으로 가는 `request`/`response`, `PhoneLink`, kind와 `hello.capabilities`, 위젯 cache와 open target), `architecture/activation.md`·`approval.md`(`phone.use`, 동의 한 번), `architecture/app-notice.md`나 새 `architecture/widget.md`(위젯 값의 길: 선언, 메모리 값, 폰 cache, best effort), `boundary-catalog.yaml`·`module-catalog.yaml`(`packages/protocol/phone`, `core/apps/widgets`, `core/apps/phone-request`, `sdk/cap-phone`), `project-docs/flows/`(`flows` skill로 마지막 대조), roadmap `mobile.md` 단계 8(agent 길은 열지 않았다는 것), `packages/mobile/README.md`(위젯·shortcut 개발 길), `sdk-note`(declaration 4.7.0, app-ui 2.16.0, cap-notify 1.3.0, cap-phone 1.0.0과 `supported_from`), change-log `0.23/mobile-widgets.yaml`(위젯 새로 하기는 best effort, agent 길·camera·iOS는 열지 않았다는 것), 이슈 정리(`wrap-plan`).
