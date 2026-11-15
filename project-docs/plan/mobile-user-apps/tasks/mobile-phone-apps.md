# mobile-phone-apps

폰 앱이 컴퓨터에서 도는 사용자 앱의 폰 화면을 연다: 앱 목록의 입구, 앱 화면(lophn의 위 한 줄 + guest), 화면 bundle을 받아 hash를 확인하고 cache하는 길, view binding(`app_views/*`)과 앱 event, 새 판과 컴퓨터가 안 닿을 때와 호환이 안 될 때의 상태. guest 자체(`GuestScreen`)는 `mobile-phone-guest`가 지었고 이 task는 그 위의 앱 쪽이다.

- 단위: phone-host (wave 7)
- 선행: mobile-phone-guest, mobile-remote-gate, mobile-phone-reads. **`mobile-app` 계획이 main에 land된 뒤여야 한다**(이미 `mobile-phone-guest`가 그 뒤다)
- 소유(이 task만 고친다). 아래 `packages/mobile/...` path 가운데 land된 뒤 이름이 다른 것은 실제 path를 먼저 확인한다(`mobile-app` 계획의 `mobile-frame`·`mobile-home`·`mobile-places` 보고):
  - `packages/mobile/src/apps`(`guest/`는 `mobile-phone-guest`의 것이라 이 task는 읽기만이다. 그 밖의 새 file: 앱 화면, 화면 bundle cache, view 열기·event·상태)
  - `packages/mobile/src/screens/apps`(새 폴더: 앱 화면과 그 ⋯ menu)
  - `packages/mobile/src/data/apps.ts`(새 file)와 `apps.test.ts`(새 file)
  - `packages/mobile/src/data/mod.ts`(내보내기 한 줄)
  - `packages/mobile/src/data/sample.ts`(sample 컴퓨터에 앱과 폰 화면 한 개를 더하는 만큼만)
  - `packages/mobile/src/app/nav.ts`(갈 곳 `app(id, screen?)` 한 개를 더하는 만큼만)
  - `packages/mobile/src/screens/home`, `packages/mobile/src/screens/workspace`, 그리고 sidebar가 있는 `packages/mobile/src/app`(앱을 누르면 폰 화면이 있는 앱은 앱 화면으로 가게 하는 입구 줄만)
  - `packages/design/i18n/catalog/mobile-apps.ts`(lead가 빈 file로 만들어 `packages/design/i18n/en.ts`에 올려 둔다. 문구는 이 file에만 더한다)
- 읽을 것:
  - 기준: `tools/wireframes/drafts/phone/apps.tsx`(`Orders`, `AppMenu`, `NeedsComputer`와 "New version is live" toast, 그림 `/home/pyosechang/projects/lophn/screenshot/phone-wireframes/3-apps.png`), `phone.module.css`. 이 task가 짓는 것: 앱 화면(위 한 줄: sidebar 단추, 앱 표식과 이름, ⋯), ⋯ menu의 Sessions about this app·Activity·Release 줄과 Ask lophn to change this app, 컴퓨터가 안 닿을 때 화면, 새 판 toast. 짓지 않는 것(이 계획 밖): Annotate this screen, Add to Home screen, New app, 폰에서 도는 앱(Calendar)
  - guest: `packages/mobile/src/apps/guest/mod.ts`(`GuestScreen`, `guestHostInfo`, `ensureBase`와 `mobile-phone-guest`의 보고: 사용법과 상태), 계약 `packages/protocol/apps/phone-screen.ts`(`phoneCanRun`, manifest, `phoneManifestSchema`)
  - route: `packages/protocol/apps/phone.ts`(`apps/phone_screens`), `packages/protocol/apps/views.ts`(`app_views/open|call|close`, `AppViewEvent`), 화면 file route `packages/protocol/apps/calls/screen.ts`(`apps/screen_file`: 폰 자격으로는 `{content_type, base64}`로 온다. `packages/core/remote/call.ts`)
  - 폰 data 층: `packages/mobile/src/data/{link.ts,hooks.tsx,mod.ts}`(컴퓨터마다 `CoreSource`: `call`과 `watch`, 연결 상태), `sample.ts`
  - hash: `packages/mobile/package.json`의 `@noble/hashes`(sha256)
  - 규칙: 이 계획 `README.md`의 "정한 것"(spike 판정 3·4·5), 계획 `mobile-app`의 `README.md`와 `packages/mobile/README.md`
- 계약:
  - 쓰는 것: 위 route·event·계약 file과 `GuestScreen`. kit(`@lophn/ui-native`)으로 짓는다(폰 앱의 일반 화면이다. guest 안이 아니다)
  - 문구: `@lophn/i18n`의 `t()`로 쓴다. desktop catalog(`packages/design/i18n/catalog/*.ts`)에 같은 문장이 있으면 그 key를 쓰고, 없을 때만 `mobile-apps.ts`에 `mobile.`으로 시작하는 key를 더한다. 문장 조각을 이어 붙이지 않는다(ICU 한 문장)
  - 내놓는 것: 앱 화면. 화면이 하나 이상인 앱은 첫 폰 화면이 앱 화면의 본문이고, 나머지 폰 화면은 ⋯ menu의 줄로 연다. `params`가 필수인 화면은 목록에서 빠진다(폰에서 인자를 줄 곳이 없다)

## 할 일

1. `data/apps.ts`: 컴퓨터마다 `apps/phone_screens`를 읽어(연결이 `ready`가 될 때마다 다시, `StateChanged`로 다시) 폰 화면이 있는 앱 목록을 낸다(`useCoreRead`의 방식). 앱 하나의 첫 폰 화면과 나머지, `running`, manifest를 준다. sample 컴퓨터에 앱 하나와 fixture 폰 화면(`phone.js`를 `mobile-phone-guest`의 fixture에서)과 가짜 `app_views/*` 답을 더한다.
2. 화면 bundle cache(`src/apps/bundle.ts`): `phoneCanRun(manifest, guestHostInfo())`가 `ok`일 때만 받는다. 파일 위치는 앱 files 폴더의 `phone-screens/<컴퓨터>/<bundle_hash>/<screen>/phone.js`(내용이 `bundle_hash`로 고정이라 cache key가 그것이다. 한 번 받으면 그 key로는 다시 받지 않는다). 받기: `apps/screen_file`(target live, 그 release, screen, path `phone.js`)로 base64를 받아 bytes로 풀고 `size`와 `sha256`이 manifest와 다르면 버린다(쓰지 않는다, 오류 상태). 앱마다 가장 최근 두 bundle만 남기고, 컴퓨터를 지우거나 앱이 목록에서 사라지면 지운다. `phone_too_old`면 "Update the lophn app to open this screen"을, `screen_too_old`면 "Ask lophn on your computer to update this app"을 보인다(화면을 띄우지 않는다).
3. 앱 화면(`src/screens/apps`): 위 줄은 wireframe `Orders`의 것이다. 본문은 `GuestScreen`이다. 열 때: view id를 만들고(무작위, 8~64자. 호스트가 정한다), bundle 준비 → `app_views/open {view, mode: "live", app, release: null, screen, place: "phone", params: {}}`(`release: null`이라 활성 release를 따른다) → `GuestScreen`에 `call`·`subscribe`·`place`·`scheme`·`locale`을 준다. `call(operation, input)`은 `app_views/call {view, operation, input}`의 `outcome`을 돌려준다. Result 오류는 `not_found`(core가 view를 모른다, 재시작 등)면 `app_views/open`을 같은 인자로 다시 불러(resume) 한 번 다시 부르고, 그 밖은 `{ok: false, error: {code: "unavailable", message}}`로 바꾼다. 화면을 떠나면 `app_views/close`를 부른다(기다리지 않는다). 앱 테마가 바뀌면 guest에 `appearance`를 보낸다.
4. event와 상태: `AppViewEvent`를 컴퓨터의 `watch`로 받는다(조건 `types: ["AppViewEvent"]`. 연결이 다시 붙으면 `watch`를 다시 걸고 `app_views/open`으로 resume한다). 그 view의 것만 본다(`payload.view`). `kind: "event"`는 guest의 `subscribe` 쪽으로, `rebound`는 `apps/phone_screens`를 다시 읽어 manifest가 달라졌으면(새 `bundle_hash`) 새 bundle을 받아 `key`를 바꿔 guest를 다시 띄우고 위에 한 줄 "Updated to Release N"을 보인다(wireframe의 toast. `What changed`는 짓지 않는다), 같으면 아무것도 하지 않는다. `lost`의 `app_stopped`·`app_archived`는 "<앱>이 <컴퓨터>에서 도는 중이 아니다" 상태를, `evicted`는 resume(`open` 다시)을 한다. 컴퓨터 연결이 `offline`이면 wireframe `NeedsComputer`("<앱> runs on <컴퓨터>", 컴퓨터가 돌아오면 저절로 열린다, [Try again])를 보이고 연결이 돌아오면 resume으로 다시 연다. `GuestScreen`의 `failed`는 오류 상태와 [Try again](`key`를 바꿔 다시 띄움)이다.
5. ⋯ menu(sheet): wireframe `AppMenu`대로 앱 표식과 이름, "Runs on <컴퓨터>", Ask lophn to change this app(그 앱 workspace의 새 session 입력 sheet로. 이미 `mobile-places`가 앱 workspace에 둔 입력과 같은 길을 `useNav()`로 연다), Sessions about this app(앱 workspace의 Sessions), Activity, 지금 release 한 줄, 폰 화면이 둘 이상이면 그 화면 줄들. 이 줄들이 가는 곳이 land된 `mobile-places`에 없으면 `useNav()`로 갈 수 있는 곳까지만 잇고 없는 것은 보고한다.
6. 입구: Home의 Apps 줄과 sidebar의 앱 workspace 줄이 폰 화면이 있는 앱이면 앱 화면(`nav.ts`의 `app`)으로, 없는 앱은 지금처럼 앱 workspace로 간다. 입구 줄만 고치고 그 화면 file의 나머지는 건드리지 않는다.
7. 확인: (a) sample 컴퓨터로 앱 화면, ⋯ menu, `NeedsComputer`, 새 판 toast, 호환 거절 둘, 오류 상태 화면 그림을 찍는다. (b) 개발 core(`tools/remote-dev.ts`의 길, `packages/mobile/README.md`)에 pairing해 실제 data로 앱 하나를 연다: 개발 core에서 앱을 만들고(`lophn app create`) 폰 화면을 손으로 쓴 source로 두고 `lophn release prepare`로 release하면(model provider를 부르지 않는다) 폰 목록에 나타나고 열려 operation이 불리는지, 앱을 다시 release하면 새 판으로 바뀌는지, core를 멈추면 `NeedsComputer`로 가고 다시 켜면 열리는지를 본다. 못 본 것은 "확인 못 함"으로 적는다. emulator는 port 5598, Metro 8238이다(아래 규칙). 이 확인은 `mobile-phone-guest`가 지은 dev build의 APK(lead가 알려 준다)를 깔고 native module을 더하지 않는다.
8. flows catalog: 이 task가 더하거나 지우는 route, CLI 명령, IPC channel, test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## Android 확인 규칙

- emulator는 `lophn-phone` AVD를 `-read-only -memory 2048 -port 5598`로 띄우고 모든 adb 명령에 `-s emulator-5598`을 붙인다. 끝나면 `adb -s emulator-5598 emu kill`로 끈다. Metro는 port 8238이다. gradle을 돌려야 하면 `--no-daemon -Pkotlin.compiler.execution.strategy=in-process`. 사람의 실제 폰(serial `R3CT90K6G2X`)에는 어떤 명령도 보내지 않는다. `pkill`·`killall` 금지. 실제 relay, 실제 model provider, 사람의 `~/.lophn`을 쓰지 않는다. 그림은 `.dev-data/mobile-phone-apps/shots/`에 둔다.

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check:full`이 통과한다.
- 위험 test(데이터와 sandbox 경계라 둔다. React Native 없이 node test):
  - "받은 화면 bundle은 manifest의 `size`와 `sha256`이 맞을 때만 cache에 남고 열린다. 다르면 쓰지 않고 지운다"와 "`phone_too_old`·`screen_too_old`인 화면은 받지도 띄우지도 않는다"
  - "view event는 자기 view의 것만 guest로 간다(다른 view의 `AppViewEvent`는 무시)"
- 그림이 wireframe(`Orders`, `AppMenu`, `NeedsComputer`, 새 판 toast)과 같은 구조·크기·색이다(lead가 대조한다).
- 소유 밖 file을 고치지 않았다(위 입구 줄 제외).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 그림 목록, wireframe과 다르게 한 곳과 이유, 실제 core로 확인한 것과 못 한 것, `nav.ts`에 더한 갈 곳, 입구 줄을 고친 file 목록.
