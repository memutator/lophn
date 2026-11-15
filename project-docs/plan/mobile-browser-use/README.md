# mobile-browser-use: lophn agent가 사람의 폰에 뜬 앱 preview를 보고 다룬다

- 목표: roadmap 단계 10. 컴퓨터의 lophn agent가 사람의 폰에 뜬 앱 preview 화면을 보고(screenshot), 구조를 읽고(snapshot), 누르고 치고 scroll한다. 도구를 새로 만들지 않는다: `lophn tab open --phone <app> [--screen <key>]`로 연 `phone` 탭에 기존 `lophn browser snapshot|act|screenshot|wait|read`를 쓴다. 요청은 core에서 폰으로 가는 길(`PhoneLink`, kind `drive.*`)로 가고, 폰 앱의 native module(`lophn-drive`)이 guest 화면의 Android view tree를 읽고 입력을 넣는다.
- 재료: `project-docs/products/roadmap/mobile.md`(단계 10, "추천대로 가려는 것"), spike 보고서 `/home/pyosechang/projects/lophn/reports/mobile-program/drive-spike.md`(실제로 돈 것과 "Survey changes"의 일곱), 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/browser-use-survey.md`(사실, 설계. 아래 "정한 것"이 다르면 이것이 이긴다), spike의 버릴 code(읽기만) `/home/pyosechang/projects/lophn-worktrees/spike-app-screens/mobile/{modules/lophn-drive,guest/screen-drive.tsx,guest/proguard-sandbox.pro}`, `project-docs/architecture/{browser-tab,remote,app-call,ui-kit}.md`, 먼저 land되는 계획(`mobile-app`, `mobile-user-apps`, `mobile-widgets`, `mobile-coding-agents`)의 README와 `tasks/`(각 lead worktree `.claude/worktrees/plan-<계획>`).
- 범위 밖: live 화면 다루기, 폰을 깨우거나 lophn 앱을 앞으로 부르기, push로 사람을 부르기, lophn 자신의 화면·다른 앱·system UI·OS dialog, `navigate`·`evaluate`·`logs`·`hover`·`select`·`fill_login`·`press Back`, 좌표 누르기, 화면 흘려 보이기, iOS, 새 자동 emulator E2E test(사람에게 먼저 묻는다).
- 단위: `drive-contract`(kind와 탭 target의 모양), `drive-core`(core의 phone 탭과 preview 목록), `drive-kit`(kit의 Input label과 판), `drive-phone`(native module과 폰 쪽), `drive-agent`(CLI와 agent 지침), `drive-check`(lead가 돌리는 끝 확인). 소유 path는 brief가 정한다.
- 순서(wave는 앞 wave가 모두 merged일 때 열린다):
  - **이 계획의 모든 task는 `mobile-app`, `mobile-user-apps`, `mobile-widgets` 계획이 main에 land된 뒤에 띄운다.** `packages/protocol/lophn-agent/host-queue.ts`, `packages/core/host-queue`, `packages/core/main/daemon/wiring/host-queue.ts`를 고치는 task(`mobile-drive-contract`, `mobile-drive-core`)는 `mobile-coding-agents`의 `mobile-host-link-cleanup`이 main에 있은 뒤에 띄운다. 각 brief의 "선행" 둘째 문장이 같은 말을 한다.
  - wave 1: `mobile-drive-contract`, `mobile-drive-preview-read`, `mobile-drive-kit`. 서로 기대지 않고 file이 겹치지 않는다.
  - wave 2: `mobile-drive-core`(opus high), `mobile-drive-native`(opus high), `mobile-drive-cli`. 계약 위에 나란히 선다.
  - wave 3: `mobile-drive-phone`(폰 쪽 화면과 답하기. native module과 preview 목록 위).
  - wave 4: `mobile-drive-guidance`(앱 agent 지침. 도구와 폰 동작이 다 선 뒤. kit 메모에 Instruction diff를 더한다).
  - wave 5: `mobile-drive-verify`(lead가 emulator에서 끝까지 돌려 본다).
  - land는 계획 끝에 한 번.

## 정한 것

- (planner) 요청은 폰 link로 간다. core가 `ctx.phoneLink.call({device, kind: "drive.snapshot" | "drive.act" | "drive.screenshot" | "drive.wait", input: {view, ...}, deadline_ms})`를 부르고 폰이 `response`로 답한다. screenshot은 `value` 안 base64다(1 MiB 상한). 폰은 `drive.*`를 `hello.capabilities`에 적고, 적지 않은 폰은 agent에게 `unavailable`이다. 그래서 `AppViewEvent`의 `drive` 갈래, `app_views/drive_answer`·`drive_image` route, 그 allowlist 줄은 없다. kind는 `mobile-widgets`가 만든 `packages/protocol/phone/kinds.ts`에 더한다.
- (planner) preview만 다룬다. live는 다루지 않는다(desktop과 같은 규칙). 사람이 폰에서 앱 menu의 "Preview from lophn"(컴퓨터에서 그 앱의 preview가 돌 때만 보인다)을 여는 것이 동의다. 동작마다 묻지 않는다. 요청이 오는 동안 폰은 "<agent> is driving this screen" 줄과 [Take control]을 보인다. take control 뒤 act는 `conflict`, 읽기는 된다, [Hand back]으로 돌려준다. 사람의 손 입력은 늘 된다.
- (planner) 보기와 입력은 폰 앱의 Kotlin Expo module `packages/mobile/modules/lophn-drive`가 spike대로 한다(view id로 guest를 찾고, Android view tree를 걷고, View.draw screenshot, 직계 자식 touch dispatch, InputConnection 글). Accessibility service, adb, guest 쪽 tree는 쓰지 않는다. spike의 일곱 변경을 넣는다: scroll container 안 화면 밖 줄을 `[offscreen]`으로 싣기, 누르기 전에 native로 화면 안에 들이고 clamp한 점을 누르지 않기, 앱이 앞에 있고 화면이 켜졌을 때만 답하기(아니면 `unavailable`), 글을 친 뒤 soft keyboard 내리기, screenshot 기본 JPEG q80·긴 변 1080 px, sandbox library의 R8 keep 규칙(`mobile-phone-guest` brief에 lead가 이미 넣었다. 이 계획은 다시 넣지 않고 build에 있는지만 본다), guest 위에 화면 전체를 덮는 view를 두지 않기.
- (planner) 대상 모양: core의 같은 탭 표에 `phone` 탭 종류. 되는 act는 click, type, fill, press Enter, scroll이다. navigate, evaluate, logs, hover, select, fill_login, press Back은 정한 문장과 `invalid_input`이다. snapshot 글은 desktop과 같은 줄 말이고 ref 번호는 core가 매기며 page 글은 `browser.snapshot`처럼 untrusted로 싼다.
- (planner) 그 앱 workspace의 session(이나 사람)만 그 앱의 phone 탭을 연다(`--preview`와 같은 검사). 기기는 그 앱의 preview view를 열어 둔 기기다. preview view가 없거나, 연결이 없거나, 앞에 없으면 곧바로 `unavailable`이고, 정한 문장이 agent에게 사람에게 부탁하라고 말한다.
- (planner) 폰은 preview view가 열린 동안 화면을 켜 둔다. 컴퓨터에서 깨우거나 앞으로 부르지 못한다.
- (planner) kit: `Input`이 label(없으면 placeholder)을 accessibility label로 갖고, 누르는 조각은 role을 지킨다. testID에 기대지 않는다. `mobile-sdk-kit` 뒤라 kit 판을 올리고 `sdk-note` 메모를 쓴다.
- (planner) 일꾼은 `sonnet-high`, `mobile-drive-native`와 `mobile-drive-core`는 opus high다. 이 계획의 emulator port는 5614~5620, Metro 8254~8260이다.
- (agent) survey와 결정이 정하지 않아 정한 것:
  - phone 탭은 앱마다 하나다(single key `phone:<app>`). 기기와 view는 부를 때마다 다시 고른다(그 앱의 열린 preview view 가운데 기기 owner의 가장 최근 쓴 것). 사람이 preview를 닫고 다시 열어 view id가 바뀌어도 탭이 그대로 쓰인다. survey의 `<app>:<device>`보다 단순하다.
  - ref: 폰이 snapshot마다 `snapshot` id와 자기 node 번호를 내고, core가 탭 counter로 `eN`을 매겨 `eN → (view, snapshot, node)`를 든다. 마지막 snapshot이 아닌 ref는 폰에 묻지 않고 `conflict`다. survey의 "core가 counter 시작값을 보낸다"보다 두 쪽 상태가 어긋날 곳이 적다.
  - 모든 `drive.*` 입력에 `by`(부르는 agent의 이름. 사람 token이면 "Someone on your computer")를 싣는다. 폰의 "<agent> is driving" 줄이 쓴다.
  - `drive.wait`는 `{found}`를 답하고, 못 찾으면 core가 desktop wait와 같은 `unavailable` 문장을 낸다.
  - `browser/screenshot`의 `media_type`을 `image/png | image/jpeg`로 넓힌다(기본 JPEG). CLI는 JPEG이면 `.jpg`로 쓴다.
  - 폰이 preview를 알고 받는 길은 `apps/phone_screens` 출력에 `previews` 칸을 더하는 것뿐이다(새 route 없음). preview bundle의 file은 이미 `apps/screen_file`(target preview)이, preview view는 이미 `app_views/open {mode: "preview"}`가 준다(`mobile-remote-gate`가 폰에 연 route). 그래서 폰 gate task는 없다.
  - `phone` 탭의 `tabs/show`는 `invalid_input`(탭이 폰에 있다), `tabs/close`는 core 표에서만 지운다. desktop shell에는 탭이 생기지 않는다.
  - kit 판은 `@lophn/ui-native` 0.2.0(minor)이다. Input label과 `mobile-drive-guidance`의 지침 변경이 같은 판에 든다(land가 한 번이라 같은 메모에 Instruction diff를 더한다).
  - 새 wireframe은 짓지 않는다. 바뀌는 화면은 `mobile-phone-apps`의 앱 화면에 menu 줄 하나, preview 표시, 위 줄 하나뿐이고 kit 조각으로 짓는다. lead가 그림을 그 앱 화면 wireframe과 대조한다.

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `mobile-drive-contract` | `drive.*` kind 넷의 입력·출력, 오류 이유, 정한 문장, `tabs/open`의 `phone` target, screenshot media type |
| 1 | `mobile-drive-preview-read` | `apps/phone_screens`에 지금 도는 preview의 폰 화면과 manifest를 싣는다 |
| 1 | `mobile-drive-kit` | kit `Input`의 accessibility label, `@lophn/ui-native` 0.2.0과 메모 |
| 2 | `mobile-drive-core` | core의 `phone` 탭: 열기 검사, 기기·view 고르기, `PhoneLink` 호출, ref 번호, snapshot 글, 오류 문장 (opus high) |
| 2 | `mobile-drive-native` | Kotlin Expo module `lophn-drive`: 찾기, snapshot, screenshot, 누르기, 글, scroll, wait, 거절 규칙, 화면 켜 두기. debug와 release에서 확인 (opus high) |
| 2 | `mobile-drive-cli` | `lophn tab open --phone`, browser 명령 설명, JPEG 저장, `lophn-agent` skill 글 |
| 3 | `mobile-drive-phone` | 폰: "Preview from lophn" 줄과 preview 화면, `drive.*` 답하기, "is driving" 줄과 take control, 화면 켜 두기 |
| 4 | `mobile-drive-guidance` | 앱 agent 지침: 폰에서 확인하는 때와 길, 한계. kit 메모의 Instruction diff |
| 5 | `mobile-drive-verify` | lead가 emulator와 개발 core로 끝까지 돌려 보고 `packages/mobile/README.md`에 drive 절을 쓴다 |

## 돌리기 전에

- 다른 계획과 같은 file을 만지는 곳(모두 그 계획들이 land된 뒤라 그 위에서 고친다):
  - `packages/protocol/phone/kinds.ts`(`mobile-phone-link-contract`가 만들었다), `packages/mobile/src/link/answer.ts`(`mobile-phone-location`이 만든 handler 표. `mobile-drive-phone`이 줄만 더한다).
  - `packages/mobile/src/screens/apps`, `src/apps`, `src/data/apps.ts`(`mobile-phone-apps`), `packages/mobile/guest`(`mobile-phone-guest`), `packages/protocol/apps/phone.ts`·`packages/core/apps/phone/screens.ts`(`mobile-phone-target`·`mobile-phone-reads`), `packages/cli/commands/tab.ts`와 host queue file(`mobile-preview-phone`, `mobile-host-link-cleanup`).
  - 준비 중인 계획 `mobile-local-apps`(id `mobile-local-*`, `mobile-sync-*`)가 `packages/mobile/src/apps`·`src/screens/apps`를 같이 고칠 수 있다. 그 task가 running이면 `status.py ready`가 소유 겹침으로 막는다.
  - `project-docs/flows/`: 모든 task가 자기 입구와 test file의 줄만 고친다. 충돌은 lead가 푼다.
- 등록 file(`packages/protocol/phone/mod.ts`의 export, `packages/core/main/daemon/wiring/context.ts`의 늦은 칸, `package-lock.json`)은 lead의 것이다. brief가 한 줄을 허락한 곳만 task가 고치고 "넘길 줄"에 적는다.
- `mobile-drive-phone` 전에 lead가 `packages/design/i18n/catalog/mobile-drive.ts`를 빈 file로 만들어 `packages/design/i18n/en.ts`에 올린다(`mobile-app`과 같은 길).
- `mobile-drive-native` merge 뒤 lead가 plan branch에서 dev build(x86_64)를 한 번 지어 `/tmp/lophn-mobile-drive-x86_64.apk`에 두고 `mobile-drive-phone` worker에게 알린다(그 task는 native module을 더하지 않는다).
- emulator: `mobile-drive-native` port 5614·Metro 8254, `mobile-drive-phone` 5616·8256, `mobile-drive-verify` 5618·8258(5620·8260은 남긴다). AVD `lophn-phone`을 `-read-only -memory 2048 -port <port>`로 띄우고 모든 adb 명령에 `-s emulator-<port>`를 붙이고 끝나면 `adb -s emulator-<port> emu kill`로 끈다. gradle은 `--no-daemon -Pkotlin.compiler.execution.strategy=in-process`. `pkill`·`killall`과 `ps`로 process를 찾아 죽이는 일은 하지 않는다. 사람의 실제 폰(serial `R3CT90K6G2X`)에는 어떤 명령도 보내지 않는다.
- 개발 core는 `packages/mobile/README.md`의 `tools/remote-dev.ts` 길을 쓴다. 사람의 `~/.lophn`, 실제 relay(`wss://lophn-relay.fly.dev`), 실제 model provider를 쓰지 않는다. 앱의 폰 화면 source는 worker가 손으로 쓴다.

## 사람이 할 것

- 실제 폰에서 처음 확인하기 전에 한 번: guest runtime과 `lophn-drive` module이 다 든 dev build를 실제 폰에 깐다. 깔기 전에 planner가 사람에게 묻는다(roadmap 규칙). 이미 깔린 build와 서명 key가 다르면 Android가 update를 거절해 지우고 다시 깔아야 하고, 그러면 pairing을 다시 한다.
- 실제 폰으로 볼 때마다: 폰 잠금을 풀고, lophn 앱을 열고, 그 앱 화면의 menu에서 "Preview from lophn"을 연다(앱을 앞에 둔다). Developer options, USB, Accessibility 권한, adb는 필요 없다.
- iOS는 이 계획에 없다(단계 6의 Apple 질문이 먼저다).

## lead가 할 일

- merge 때마다: `npm run check`. `packages/mobile`을 고친 task는 `cd packages/mobile && npm run typecheck && npm test`도, worker가 남긴 emulator 그림(`.dev-data/<id>/shots/`)을 `tools/wireframes/drafts/phone/apps.tsx`의 앱 화면과 대조한다. 공유 줄은 보고의 "등록할 것"·"넘길 줄"대로 합친다.
- `mobile-drive-core` 뒤: 보고의 위험 test 이름으로 주인 검사와 기기 고르기가 test되는지 본다.
- `mobile-drive-native` 뒤: 보고의 debug·release 표(spike S1~S7과 같은 항목)를 읽고 dev build를 짓는다(위 "돌리기 전에").
- `mobile-drive-verify`(wave 5)를 직접 돈다. 실제 폰 확인은 사람이 build를 깐 뒤 따로 한 번 한다(planner가 묻는다).
- 끝에: `architecture/browser-tab.md`(phone 탭: 대상, 되는 것과 안 되는 것, 오류 문장, take control이 폰에 있음), `architecture/remote.md`(`drive.*` kind와 preview만, 화면 켜 두기), `architecture/ui-kit.md`(Input label), `boundary-catalog.yaml`·`module-catalog.yaml`(`packages/mobile/modules/lophn-drive`, `packages/protocol/phone/drive.ts`, `packages/core/host-queue/phone.ts`), `project-docs/flows/`(`flows` skill로 마지막 대조), roadmap `mobile.md` 단계 10과 "browser-use와 닿는 곳"의 옛 WebView CDP 문단, `sdk-note`(`@lophn/ui-native` 0.2.0과 `supported_from`), change-log `0.23/mobile-browser-use.yaml`(preview만, Android만, 실제 폰 확인을 했는지), 이슈 정리(`wrap-plan`). 실제 폰에 새 build를 까는 것은 사람에게 묻는다.
