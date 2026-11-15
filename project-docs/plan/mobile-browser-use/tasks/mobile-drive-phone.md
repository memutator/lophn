# mobile-drive-phone

폰 쪽을 짓는다: 앱 화면 menu의 "Preview from lophn" 줄(컴퓨터에서 그 앱의 preview가 돌 때만), preview 화면(preview bundle을 받아 `app_views/open {mode: "preview"}`로 연다), core의 `drive.*` 요청에 답하는 drive controller(그 view가 지금 이 폰이 연 preview view일 때만 native module을 부른다), 요청이 오는 동안의 "<agent> is driving this screen" 줄과 [Take control]·[Hand back], preview가 열린 동안 화면 켜 두기.

- 단위: drive-phone (wave 3)
- 선행: mobile-drive-native, mobile-drive-preview-read, mobile-drive-contract, mobile-drive-core. **`mobile-app`, `mobile-user-apps`, `mobile-widgets` 계획이 main에 land된 뒤에 띄운다**(앱 화면은 `mobile-phone-apps`, 요청 답하기 표는 `mobile-phone-location`의 것이다)
- 소유(이 task만 고친다). land된 실제 file 이름이 다르면 먼저 확인한다(`mobile-phone-apps`, `mobile-phone-location`의 보고):
  - `packages/mobile/src/apps/drive`(새 폴더: preview view 등록부, controller, take control 상태, `drive.*` handler, node test)
  - `packages/mobile/src/apps/bundle.ts`(preview target으로 화면 file을 받는 만큼)
  - `packages/mobile/src/screens/apps`(menu 줄, preview 화면, driving 줄)
  - `packages/mobile/src/data/apps.ts`와 `packages/mobile/src/data/apps.test.ts`(`previews`를 읽는 만큼)
  - `packages/design/i18n/catalog/mobile-drive.ts`(lead가 빈 file로 만들어 packages/design/i18n/en.ts 에 올려 둔다. 문구는 이 file에만 더한다)
- 한 줄씩 허락(공유 file. 줄만 더하고 "넘길 줄"에 적는다): `packages/mobile/src/link/answer.ts`(`PHONE_HANDLERS`에 `drive.*` 넷), `packages/mobile/src/app/nav.ts`(preview 화면으로 가는 갈 곳 하나가 필요하면)
- 읽을 것:
  - 결정: 계획 `README.md`의 "정한 것" 전부(preview만, 열기가 동의, driving 줄과 take control, 사람의 손 입력은 늘 된다, 화면 켜 두기, guest 위에 전체를 덮는 view를 두지 않기)
  - 계약: `packages/protocol/phone/drive.ts`, `packages/protocol/phone/kinds.ts`, `packages/protocol/apps/phone.ts`(`previews`), `packages/protocol/apps/views.ts`(`app_views/open`의 `mode: "preview"`, `AppViewEvent`의 `rebound`·`lost`), `packages/protocol/apps/calls/screen.ts`(`apps/screen_file`의 target `{mode: "preview", app, process_nonce}`)
  - native: `packages/mobile/modules/lophn-drive/index.ts`와 `mobile-drive-native`의 보고(API, 오류 code·reason)
  - 폰 앱: `packages/mobile/src/link/answer.ts`(`PHONE_HANDLERS`, `answerRequest`: 앱이 active가 아니면 handler 없이 `phone_in_background`, 입력은 kind schema로 검사), `packages/mobile/src/screens/apps`(앱 화면, ⋯ menu, 상태 화면), `packages/mobile/src/apps/{bundle.ts,guest/mod.ts}`(`GuestScreen`의 `view`·`key`, bundle cache와 hash 검사), `packages/mobile/src/data/apps.ts`
  - 기준 화면: `tools/wireframes/drafts/phone/apps.tsx`(`Orders`의 위 줄, `AppMenu`의 줄 모양, 그림 `/home/pyosechang/projects/lophn/screenshot/phone-wireframes/3-apps.png`). 새 wireframe은 없다: menu 줄은 `AppMenu`의 다른 줄과 같은 모양, preview 표시와 driving 줄은 kit의 줄 조각으로 앱 화면 위 줄 아래에 한 줄씩 둔다
  - spike `/home/pyosechang/projects/lophn/reports/mobile-program/drive-spike.md`의 S6(Back은 host 화면을 닫는다), "Release build differences"(전체를 덮는 형제 view)
- 계약:
  - 쓰는 것: 위 계약과 native API. kit(`@lophn/ui-native`)으로 짓는다
  - 문구: `@lophn/i18n`의 `t()`. desktop catalog에 같은 문장이 있으면 그 key, 없을 때만 `mobile-drive.ts`에 `mobile.`으로 시작하는 key. 문장 조각을 잇지 않는다(ICU 한 문장)
  - 내놓는 것: 폰의 `hello.capabilities`에 `drive.snapshot`, `drive.act`, `drive.screenshot`, `drive.wait`가 오른다(`phoneCapabilities()`가 `PHONE_HANDLERS`에서 만든다)

## 할 일

1. data: `data/apps.ts`가 `apps/phone_screens`의 `previews`를 읽어 앱마다 "지금 preview가 돈다"와 그 화면 목록을 낸다(이미 `StateChanged`로 다시 읽는다. 그대로 쓴다).
2. menu 줄: 앱 화면의 ⋯ menu에 "Preview from lophn"(그 앱의 preview가 돌 때만). 누르면 preview 화면으로 간다. preview에 폰 화면이 여럿이면 지금 앱 화면과 같은 key의 화면, 없으면 첫 화면이고, 나머지는 preview 화면의 menu에서 고른다.
3. preview 화면: `bundle.ts`가 target `{mode: "preview", app, process_nonce}`로 `phone.js`를 받아 manifest의 `size`·`sha256`으로 확인한다(같은 cache 규칙, key는 `bundle_hash`). view id를 새로 만들어 `app_views/open {view, mode: "preview", app, release: null, screen, place: "phone"}`, 본문은 `GuestScreen`. 위 줄 아래에 "Preview" 표시 한 줄(버리는 data라는 것을 사람이 안다). `rebound`면 새 bundle로 다시 띄운다(새 view id와 `key`. guest는 같은 origin이면 옛 bundle을 쓴다), `lost`(preview가 멈춤)면 "The preview stopped on <컴퓨터>" 상태와 닫기. 화면을 떠나면 `app_views/close`. 열린 동안 `keepScreenOn(true)`, 떠나면 false.
4. 등록부와 controller(`src/apps/drive/`): preview 화면이 mount되면 `{view, app, screen}`을 등록하고 unmount되면 지운다. live 앱 화면은 결코 등록하지 않는다. `drive.*` handler는 (a) `view`가 등록부에 없으면 native를 부르지 않고 `unavailable`(`no_preview`), (b) take control 중이면 act는 `conflict`(`taken_over`), 읽기는 그대로, (c) native를 부르고 결과를 그대로 낸다. 요청마다 `by`와 시각을 남겨 driving 줄을 띄운다. 순수 logic(등록부, 거절 순서, take control, 줄을 보일지)은 React Native를 import하지 않는 file로 나눠 `node --test`로 본다.
5. driving 줄: 마지막 요청이 60 s 안이면 위 줄 아래에 "<by> is driving this screen"과 [Take control]. 누르면 "You have control"과 [Hand back]. 줄은 layout 안의 한 줄이다(guest 위에 덮는 절대 위치 view, modal, 전체 화면 backdrop을 두지 않는다. 그런 형제 view가 있으면 사람의 손 입력이 guest에 닿지 않는다). take control 상태는 그 preview 화면을 떠나면 끝난다.
6. `answer.ts`에 handler 넷을 한 줄씩 올린다.
7. Android 확인(아래 규칙): lead가 지은 dev build(`/tmp/lophn-mobile-drive-x86_64.apk`)를 깔고 개발 core(`tools/remote-dev.ts`)에 pairing한다. 개발 core에서 앱을 만들고 폰 화면을 손으로 쓰고 `lophn preview start`(model provider를 부르지 않는다). 폰에서 Preview from lophn을 열고, 컴퓨터에서 사람 token으로 `lophn tab open --phone <app>`, `lophn browser snapshot|act|screenshot|wait`가 되는지, driving 줄이 뜨는지, Take control 뒤 act가 `conflict`이고 snapshot이 되는지, Hand back 뒤 다시 되는지, 화면을 떠나면 `unavailable`인지, HOME 뒤 `unavailable`인지 본다. 그림(앱 menu, preview 화면, driving 줄 둘, preview 멈춤 상태)은 `.dev-data/mobile-drive-phone/shots/`. 못 본 것은 "확인 못 함"으로 적는다.
8. flows catalog: 이 task가 더하는 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## Android 확인 규칙

- emulator는 `lophn-phone` AVD를 `-read-only -memory 2048 -port 5616`으로 띄우고 모든 adb 명령에 `-s emulator-5616`을 붙인다. 끝나면 `adb -s emulator-5616 emu kill`로 끈다. Metro는 port 8256이다. 이 task는 native module을 더하지 않는다(gradle을 돌려야 하면 `--no-daemon -Pkotlin.compiler.execution.strategy=in-process`).
- 사람의 실제 폰(serial `R3CT90K6G2X`)에는 어떤 명령도 보내지 않는다. `pkill`·`killall`과 `ps`로 process를 찾아 죽이는 일을 하지 않는다. 띄운 process는 직접 끈다. 실제 relay, 실제 model provider, 사람의 `~/.lophn`을 쓰지 않는다.

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check`가 통과한다.
- 위험 test(권한 경계라 둔다. React Native 없이 node test):
  - "이 폰이 연 preview view가 아닌 view id(live view, 닫힌 view, 모르는 id)의 `drive.*`는 native module에 닿지 않고 `unavailable`(`no_preview`)이다"
  - "take control 중에 act는 `conflict`(`taken_over`)이고 snapshot·screenshot·wait는 답한다"
- 그림이 `AppMenu`와 앱 화면 위 줄의 모양을 따른다(lead가 대조한다).
- 소유 밖 file을 고치지 않았다(허락한 줄 제외).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 그림 목록, 7번의 명령과 결과(snapshot 앞부분, screenshot file), 넘길 줄(`answer.ts`, `nav.ts`), 손 입력이 preview 화면에서 guest에 닿는지(release build가 아니면 "확인 못 함").
