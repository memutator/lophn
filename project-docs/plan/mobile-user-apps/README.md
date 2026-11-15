# mobile-user-apps: lophn agent가 사람의 앱에 폰 화면을 짓고, 폰 앱이 그것을 띄운다

- 목표: 앱 선언에 `phone` 자리를 더하고, 앱 agent가 폰 UI kit(React Native)으로 쓴 폰 화면을 release하면 폰 앱이 그 화면을 받아 돌린다. 화면이 어느 앱·release의 것인지, 어떤 operation을 부를 수 있는지, 어떤 event를 받는지(view binding)는 core가 쥐어 desktop과 폰이 같은 로직을 따로 들지 않는다. agent는 등록한 기준 폰의 크기를 읽고, desktop preview로 자기가 쓴 폰 화면을 확인한다.
- 재료: `project-docs/products/roadmap/mobile.md`("사용자 앱을 폰에 띄우기", 단계 6, 진행), 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/app-place-survey.md`, spike 보고서 `/home/pyosechang/projects/lophn/reports/mobile-program/app-screens-spike.md`(brief를 쓸 때 읽는다), `project-docs/architecture/{app-call,remote,ui-kit,browser-tab,event}.md`, `project-docs/issues/preview-screen-cannot-call-operation.yaml`.
- 범위 밖: 폰에서 backend가 도는 앱(단계 7), 위젯·홈 화면 아이콘·폰 기능(단계 8), iOS, 폰 화면의 실제 폰 확인(단계 10. 이 계획의 확인은 desktop preview까지), 폰 화면을 desktop 탭에 띄우기(roadmap은 desktop에 web 화면을 둔다).
- 단위: `app-place`(선언의 `phone` 자리, agent가 읽는 기준 폰), `app-views`(view binding을 core로, shell main을 그 위로), 그리고 spike 뒤에 열리는 `phone-screen`(빌드, 읽기, desktop preview), `phone-sdk`(kit과 hook을 SDK part로), `phone-host`(폰 쪽 gate와 host), `app-guidance`(agent 지침). 소유 path는 brief가 정한다.
- 순서:
  - wave 1: `mobile-place-decl`, `mobile-views-core`, `mobile-phone-target`을 나란히. 서로 기대지 않고 `phone-app`의 path와도 겹치지 않아 지금 띄운다.
  - wave 2: `mobile-shell-views`(shell main이 core의 view binding을 쓰게 하고 옛 로직을 지운다. `mobile-views-core`, `mobile-place-decl` 뒤). 지금 brief가 있는 것은 여기까지다.
  - 이어서(spike 판정 뒤 brief를 쓴다): 빌드 길(`mobile-build-phone`, wave 2), 읽기·preview(wave 3), SDK part(wave 3, `phone-app`이 main에 올라간 뒤), 폰 gate·notice(wave 4), 폰 host와 agent 지침(wave 5).
  - land는 계획 끝에 한 번. 그래서 SDK 판 4.6.0과 app-ui 2.15.0은 land 전까지 어느 앱에도 가지 않고, 뒤 task가 같은 판 안에서 guide와 메모를 고칠 수 있다.

## 정한 것

- 사용자 앱의 폰 화면은 폰 UI kit으로 쓴 React Native이고, 폰 앱은 앱마다 native build 없이 그 bundle을 받아 돌린다(사람, 2026-11-15). desktop 화면과 폰 화면은 서로 다른 source file이다. 한 화면이 반응하지 않는다. 앱 하나가 두 화면을 갖고 operation과 data는 하나다.
- `phone`은 한 화면의 `places`에 혼자 선다(`["phone"]`). 이유: source가 DOM이 아니라 RN이라 desktop 자리와 한 key에 두 program을 두지 않는다.
- view binding(어느 앱·release의 view인지, 부를 operation, 받을 event, release가 바뀔 때 다시 묶기)은 core가 쥔다. 신원은 host가 붙인다. page가 낸 값은 신원이 아니다. 이유: desktop과 폰이 같은 로직을 두 벌 들지 않게 한다.
- 기본 앱 template은 폰 의존을 갖지 않는다. agent가 폰 화면을 더할 때 의존을 더한다. 이유: 모든 앱이 install 시간과 bundle 크기를 내지 않게 한다.
- 사람에게는 기준 폰이 바뀔 때만 알린다(옛 크기로 그린 폰 화면을 다시 그려야 해서). 폰 화면의 쓰기에는 앱 operation이 이미 요구하는 것 말고 다른 확인을 더하지 않는다.
- agent는 등록된 기준 폰을 read route로 읽고(`apps/phone_target`), 자기가 쓴 폰 화면은 desktop preview(react-native-web)로 확인한다. 실제 폰 확인은 단계 10이다.
- worker는 `sonnet-high`로 띄운다(사람).
- (agent) survey와 다르게 정한 것:
  - `@lophn/app-ui`도 판을 올린다(2.15.0). 이 SDK가 `@lophn/declaration`을 정확한 판으로 의존해(`packages/sdk/app-ui/package.json`) declaration만 올리면 `npm ci`가 깨진다. survey는 "bump 없음"이라 했다.
  - `AppViewEvent`의 owner 거르기는 Gateway session의 `owner` 옵션 하나로 한다(`mobile-views-core`). owner를 주지 않은 session은 `AppViewEvent`를 받지 않는다(기본이 막기). 폰 host는 뒤 task가 같은 옵션에 기기 principal을 준다.
  - core는 앱 `AppViewChanged`마다 그 앱의 모든 view에 `rebound`를 낸다(binding이 같아도). grant가 바뀌어 같은 binding이지만 shell이 CSP host를 다시 읽어야 하는 경우가 있어서다. survey는 binding이 바뀐 때만이라 했다.
  - core view 표는 owner당 64개를 넘으면 가장 오래 안 쓴 view를 내보낸다(`lost`, `evicted`). core가 shell보다 오래 살아 shell이 다시 뜨면 옛 view가 남는다. survey의 "64개면 conflict"는 core 재시작까지 막힌다.
  - `app_views/call`이 preview view의 operation도 preview bundle 선언으로 판정해 부른다. 이슈 `preview-screen-cannot-call-operation`이 닫힌다. 폰 화면을 preview로 확인하려면 필요하다.

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `mobile-place-decl` | `phone` 자리와 혼자 서는 규칙, 같은 literal이 적힌 아홉 곳, `@lophn/declaration` 4.6.0과 `@lophn/app-ui` 2.15.0(메모, pin) |
| 1 | `mobile-views-core` | core의 view 표와 `app_views/{open,call,close}`, `AppViewEvent`, Gateway owner 거르기, release가 바뀔 때 다시 묶기 |
| 1 | `mobile-phone-target` | agent가 기준 폰의 크기·DPR·OS를 읽는 `apps/phone_target`과 `lophn app phone-target` |
| 2 | `mobile-shell-views` | shell main이 연결·호출·event·다시 묶기를 core `app_views/*`로 바꾸고 옛 로직과 test를 지운다 |
| 2 | `mobile-build-phone` | 폰 화면 빌드 길: source 규약, bundle과 manifest, desktop preview용 web 진입, 선언과 어긋남 검사. **spike 판정 뒤 brief를 쓴다** |
| 3 | `mobile-phone-reads` | 폰이 받을 화면 목록을 한 번에 내는 `apps/phone_screens`. **spike 판정 뒤 brief를 쓴다** |
| 3 | `mobile-preview-phone` | `lophn tab open --preview <app> --screen <key>`가 폰 화면을 기준 폰 틀로 연다. **spike 판정 뒤 brief를 쓴다** |
| 3 | `mobile-sdk-kit` | 폰 kit(`packages/design/native`)을 SDK part로 등록(vendor 규칙, guide, 메모). **spike 판정 뒤 brief를 쓴다. `phone-app`이 land된 뒤** |
| 3 | `mobile-sdk-phone-hooks` | `@lophn/app-ui-native`(`useOperation`·`useEvent`·`usePlace`와 RN 단추, 오류 경계). **spike 판정 뒤 brief를 쓴다** |
| 4 | `mobile-remote-gate` | 폰 gate: 기기 owner로 `AppViewEvent`를 내려 보내기, allowlist, 연결이 닫히면 view 지우기. **spike 판정 뒤 brief를 쓴다. `phone-app`이 land된 뒤** |
| 4 | `mobile-phone-changed-notice` | 기준 폰이 바뀌면 폰 화면이 있는 앱 수를 알리는 notice. **brief는 `phone-app`이 land된 뒤에 쓴다**(notice 종류와 폰 Inbox가 걸린다) |
| 5 | `mobile-phone-host` | 폰 앱의 앱 목록, 앱 화면(top bar, runtime, bridge), bundle cache, "컴퓨터 필요"·"새 판" 상태. **spike 판정 뒤 brief를 쓴다. `phone-app`이 land된 뒤** |
| 5 | `mobile-agent-guidance` | `design-app`의 "Phone screens", `AGENTS.md.tmpl`, template test와 sample, app prompt, `migrate-sdk` Instruction diff. **spike 판정 뒤 brief를 쓴다** |

## 돌리기 전에

- wave 1은 지금 띄운다. `phone-app`이 쓰는 path(`mobile/`, `packages/design/native`, `protocol/remote/allowlist.ts`, `core/remote`)를 건드리지 않는다.
- 다른 계획과 같은 file을 만지는 곳(lead가 합칠 때 두 쪽을 다 남긴다):
  - `packages/protocol/events/transient.ts`: `mobile-views-core`가 event 하나를 더한다. `mobile-push`의 `mobile-attention-core`(wave 1)가 이 file을 소유하고 `mobile-coding-agents`의 `mobile-terminal-core`(wave 4)도 event를 더한다. 모두 더하기만이라 먼저 merge된 쪽에 나중 쪽이 rebase한다.
  - `package-lock.json`(`mobile-place-decl`의 workspace 판 줄). 충돌하면 lead가 `npm install --package-lock-only`로 다시 만든다.
  - `project-docs/flows/`(`areas/*.yaml`, `areas.yaml`, `tests/*.yaml`): 모든 task가 자기 입구와 test file의 줄을 더한다. 충돌은 lead가 푼다.
  - `packages/protocol/apps/{mod.ts,registry.ts}`, `packages/core/apps/register.ts`, `packages/core/main/daemon/wiring/apps.ts`: task마다 자기 route와 handler 줄만 더한다(brief가 줄을 허락한다). 이 계획의 wave 1끼리도 겹치니 lead가 두 쪽을 다 남긴다.
- `mobile-coding-agents`와 겹쳐 순서가 정해지는 것(그 계획의 폴더는 이 계획을 쓸 때 아직 없었다. 열리면 `grep`으로 다시 확인한다):
  - `mobile-host-link-shell`(shell main `desktop/wiring/{context,surface}.ts`)은 `mobile-shell-views`와 file이 겹치지 않는다. `mobile-shell-views`는 `context.ts`를 고치지 않고 `ctx.appConnector`라는 이름을 slim한 채로 둔다.
  - 뒤의 `mobile-preview-phone`은 `protocol/lophn-agent/host-queue.ts`와 `core/main/daemon/wiring/host-queue.ts`를 고치는데 `mobile-host-link`가 같은 file을 소유한다. `mobile-host-link`가 먼저 merge된 뒤에 띄운다.
- `mobile-push`와 겹쳐 순서가 정해지는 것: `mobile-push-device`가 `packages/core/remote/**`, `protocol/remote/{routes,allowlist}.ts`, `wiring/remote.ts`를 소유하고 `mobile-push-phone`이 폰 앱을 고친다. 뒤의 `mobile-remote-gate`와 `mobile-phone-host`가 같은 path를 쓰므로 `phone-app`과 `mobile-push-device`가 merge된 뒤에 띄운다. `mobile-shell-views`는 `mobile-attention-desktop`이 소유한 `wiring/agent.ts`와 `desktop/core/allowlist.ts`를 고치지 않는다.
- ledger schema step과 새 core wiring은 이 계획의 wave 1~2에 없다(메모리 route와 읽기뿐). 생기면 lead가 등록한다.
- emulator는 wave 1~2에 쓰지 않는다.
- spike 보고서(`/home/pyosechang/projects/lophn/reports/mobile-program/app-screens-spike.md`)가 나오면 lead가 읽고, 표의 "brief를 쓴다" task를 쓰게 planner에게 넘긴다(번들 형식, kit과 React를 앱 화면에 주는 길, bridge, react-native-web 가능 여부가 정한다. react-native-web이 안 되면 preview 길과 kit의 web shim task가 바뀐다).

## 사람이 할 것

- 없다(계정, key, 비용이 드는 일이 없다). iOS 배포에서 App Store 지침 2.5.2(내려받은 코드로 앱 기능을 바꾸기)·4.7.2(내려받은 코드에 native API를 내주기)는 iOS를 여는 계획에서 사람과 정한다(roadmap "폰에서 혼자 도는 앱" 남은 확인 4).

## lead가 할 일

- merge 때마다: `npm run check`. wave 1~2는 desktop과 core만 바꾸므로 `cd packages/mobile`은 필요 없다.
- `mobile-views-core` merge 뒤: 이슈 `preview-screen-cannot-call-operation`을 닫는다(`issue` skill). `mobile-shell-views` merge 뒤 shell에서 desktop 앱 화면이 열리고 operation이 불리는지 `npm run dev`로 한 번 본다.
- 끝에: `architecture/{app-call,remote,ui-kit,browser-tab,workspace-layout,event}.md`(view binding이 core로, `phone` 자리, 폰 화면의 빌드와 bundle, `app_views/*`, 기기 owner 거르기), `boundary-catalog.yaml`·`module-catalog.yaml`(`design/native`의 SDK part, `sdk/app-ui-native`), `project-docs/flows/`(`flows` skill), roadmap `mobile.md` 단계 6, `sdk-note`(declaration 4.6.0, app-ui 2.15.0과 뒤 part들, `supported_from` 그대로인지), change-log `0.23/mobile-user-apps.yaml`(실제 폰 확인은 단계 10이라는 것과 desktop preview는 web emulation이라는 것을 적는다), 이슈 정리(`wrap-plan`).
