# mobile-phone-contract

앱의 폰 화면이 core, 폰 앱의 host, 폰의 guest runtime 사이에서 지키는 모양을 한 file에 먼저 고정한다: 화면이 쓸 수 있는 host module 목록, 화면 bundle의 manifest(`phone.json`)와 호환 검사, host와 guest가 주고받는 bridge 메시지, guest가 부르는 전역 이름. 폰이 받을 화면 목록 route `apps/phone_screens`의 모양도 여기서 정한다(handler는 `mobile-phone-reads`). 계약 task라 코드는 이 모양과 그 검사 함수뿐이고 옛 계약을 지우지 않는다.

- 단위: phone-screen (wave 2)
- 선행: mobile-phone-target
- 소유(이 task만 고친다):
  - `packages/protocol/apps/phone-screen.ts`(새 file)
  - `packages/protocol/apps/phone-screen_test.ts`(새 file)
  - `packages/protocol/apps/phone.ts`(`apps/phone_screens` route를 더하는 만큼만. file은 `mobile-phone-target`이 만들었다)
- 공유 줄 허락(한 줄씩만 더하고 보고의 "넘길 줄"에 적는다): `packages/protocol/apps/mod.ts`(`export * from "./phone-screen.ts"`), `packages/protocol/apps/registry.ts`(route를 목록에)
- 읽을 것:
  - 판정: `/home/pyosechang/projects/lophn/reports/mobile-program/app-screens-spike.md`의 "Recommended architecture"(특히 3~6)와 "2. Isolation", "3. Bridge", "4. Lifecycle". 이 task가 따르는 결정은 이 계획 `README.md`의 "정한 것"(spike 판정)이다
  - 본보기: `packages/protocol/apps/phone.ts`(`appPhoneTarget`: `defineRead`, `withReadCommon`), `packages/protocol/apps/calls/limits.ts`(`CALL_RESULT_MAX_BYTES`), `packages/protocol/apps/views.ts`(`app_views/call`의 입력 상한과 outcome 모양. `mobile-views-core`가 만들었다)
  - kit이 내놓는 이름: mobile-app 계획의 `packages/design/native/mod.ts`(아직 main에 없을 수 있다. mobile-app 계획의 lead worktree `/home/pyosechang/projects/lophn/.claude/worktrees/plan-mobile-app/packages/design/native/`를 읽기만 한다)
  - 이 file이 쓰이는 곳(뒤의 task): 빌드(`mobile-build-phone`)가 manifest를 쓰고, `mobile-phone-reads`가 읽고, `mobile-phone-guest`와 `mobile-phone-apps`가 폰에서 검사하고 bridge를 구현한다. 폰 앱은 Metro로 `packages/protocol`을 직접 읽으므로 이 file은 zod와 `packages/base`만 import한다
- 계약(이 task가 고정한다. 뒤의 task가 바꾸자고 하면 고치지 말고 보고한다):

### host module 목록

`PHONE_HOST_MODULES`(readonly 문자열 목록): 화면 source가 import할 수 있는 bare module의 전부다. 폰의 base bundle이 `globalThis.require`로 이 이름들만 내주고, 화면 build는 이 이름들만 external로 둔다. 시작 목록은 spike의 base와 같다: `react`, `react/jsx-runtime`, `react-native`, `react-native-svg`, `react-native-safe-area-context`, `react-native-reanimated`, `lucide-react-native`, `@lophn/ui-native`, `@lophn/app-ui-native`. kit의 `mod.ts`가 실제로 내놓는 것과 맞는지 읽어 보고 빠진 것이 있으면(예: 화면이 직접 쓸 이유가 없는 `react-native-reanimated`를 빼도 되는지) 보고한다. 이 밖의 module을 화면에 허락하는 일은 이 목록을 바꾸는 일이고 폰 앱 판이 올라가야 한다(`PHONE_BASE_FORMAT`).

### manifest (`screens/<key>/phone.json`)

```
phoneManifestSchema (strict): {
  format: 1,
  entry: "phone.js",
  size: number,            // phone.js bytes
  sha256: string(64 hex),  // phone.js
  base: number,            // 이 화면이 요구하는 PHONE_BASE_FORMAT (build 때의 값)
  kit: { "@lophn/ui-native": string(x.y.z), "@lophn/app-ui-native": string(x.y.z) },  // build 때 화면이 기댄 판
  modules: string[]        // phone.js가 실제로 require하는 host module(PHONE_HOST_MODULES의 부분집합)
}
const PHONE_BASE_FORMAT = 1   // base bundle의 약속(전역 이름, 메시지)이 바뀔 때 올린다
```

### 호환 검사

`phoneCanRun(manifest, host)`: `host`는 폰이 알리는 `{base: number, kit: string, app_ui_native: string, modules: string[]}`(폰 앱이 자기 `packages/design/native/package.json`과 `packages/sdk/app-ui-native/package.json`의 판을 읽어 채운다). 결과 `{ok: true} | {ok: false, reason}`이고 reason은 둘로 가른다(사람에게 하는 말이 다르다):
- `phone_too_old`: `manifest.base > host.base`, 또는 kit·app-ui-native 판이 폰의 것보다 **새롭다**(semver 세 칸 비교, major가 더 크면 새롭다), 또는 `manifest.modules`에 폰이 모르는 이름이 있다. 폰은 화면을 열지 않고 "update the lophn app"을 말한다.
- `screen_too_old`: kit·app-ui-native의 major가 폰의 것보다 **작다**(옛 major로 지은 화면은 폰이 약속을 지키지 않는다). 폰은 "ask lophn on your computer to update this app"을 말한다. 같은 major에서 옛 판은 `ok`다.
- 둘 다 해당하면 `phone_too_old`가 앞선다.

### 화면 목록 route (`packages/protocol/apps/phone.ts`)

```
apps/phone_screens  (name "app.phone_screens", read, actors ["user"], errors invalid_input, forbidden, unavailable)
  input  {}  (strict)
  output withReadCommon({ screens: [{
      app: AppId, app_name: string, icon: string | null,   // icon은 선언의 icon 값 그대로("lucide:<이름>") 또는 null
      screen: string, label: string, params?: InputSchema,
      release: ReleaseId, bundle_hash: sha256,
      manifest: phoneManifest,
      running: boolean                                      // 그 release의 앱 process가 지금 live로 도는가
  }] })
  reads: ["releases", "app_runtime"]
```
보관한 앱과 활성 release가 없는 앱은 싣지 않는다. 화면 file은 기존 file route `apps/screen_file`(target live, screen, path `phone.js`)로 받는다. 이 task는 route 정의까지만이고 handler는 `mobile-phone-reads`가 짓는다(그때까지 등록된 core는 handler가 없어 이 route를 부르면 `unavailable`이어도 된다. 등록 줄이 core 기동을 깨면 보고하고 등록은 `mobile-phone-reads`로 넘긴다).

### bridge 메시지 (host와 guest 사이. JSON 문자열, 한 방향 모양 하나)

guest → host (`phoneGuestMessageSchema`, discriminated by `type`):
- `{type: "ready"}`: guest가 시작했다. 첫 메시지가 떨어진 적이 있어(spike) guest는 `init`이 올 때까지 200 ms마다 최대 25번 다시 보낸다. host는 같은 view의 `ready`를 여러 번 받아도 `init`을 다시 보낼 뿐이다.
- `{type: "call", id: integer, operation: string, input: Json}`: `input`은 JSON 왕복이 같고 64 KiB 이하(`app_views/call`과 같다).
- `{type: "fatal", message: string(<= 2000)}`: guest의 root가 잡은 오류, 또는 화면 bundle 평가 중의 오류(`__lophnFatal`).

host → guest (`phoneHostMessageSchema`):
- `{type: "init", place: {place: "phone", params: {[k]: Json}, workspace: {kind, id, folders} | null}, scheme: "light"|"dark", locale: string}`: guest의 root는 이것을 받을 때까지 화면을 그리지 않는다(`usePlace`는 비동기 길이 없어서 `lophnApp.place`가 첫 render 전에 서 있어야 한다).
- `{type: "reply", id: integer, outcome: {ok: true, value: Json} | {ok: false, error: {code: string, message: string}}}`: `app_views/call`의 outcome 그대로다(앱 오류 code는 일곱 code가 아니라 그대로 간다).
- `{type: "event", source: string, event: string, payload: Json}`: 앱 event 하나. guest가 구독했는지는 guest가 거른다.
- `{type: "appearance", scheme: "light"|"dark"}`

guest가 만드는 전역: `globalThis.lophnApp = {place: PlaceValue, callOperation(operation, input): Promise<unknown>, events: {subscribe(source, event, listener): () => void}}`. `callOperation`은 실패를 `"<code>: <message>"` Error로 reject한다(desktop의 `lophnApp`과 같다. `@lophn/app-ui`의 `use-operation.ts`가 기대한다). 이 밖의 member(`commands`, `setTabHead`, `setKeepAlive`, `agent`, `sessions`, `agents`, `projects`, `openExternal`)는 없다. base가 내는 전역 이름: `PHONE_GUEST_GLOBALS = {mount: "__lophnMount", fatal: "__lophnFatal", require: "require"}`(화면 bundle의 진입이 `__lophnMount(Screen)`을 부르고 평가 전체를 `try{…}catch(e){__lophnFatal(e)}`로 감싼다).

크기: 메시지 하나는 8 MiB + 1 KiB 이하(reply의 value 상한이 `CALL_RESULT_MAX_BYTES`다).

## 할 일

1. `packages/protocol/apps/phone-screen.ts`에 위 상수, zod schema(`phoneManifestSchema`, `phoneGuestMessageSchema`, `phoneHostMessageSchema`, `phoneHostInfoSchema`)와 type, `phoneCanRun`을 짓는다. `phone.ts`에 `appPhoneScreens`를 더한다(`appPhoneTarget`처럼). `mod.ts`, `registry.ts`에 한 줄씩.
2. `phone-screen_test.ts`에 위험 test(아래)를 쓴다.
3. 문서: `project-docs/architecture/app-call.md`나 `remote.md`를 고치지 않는다(lead가 계획 끝에 한 번에 고친다). 대신 이 file 맨 위 주석에 이 file이 무엇을 고정하는지와 뒤 task들이 어디서 쓰는지를 적는다.
4. flows catalog: 새 route와 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 끝남

- `npm run check`가 통과한다. `project-docs/plan/tools/lead/boot.sh`가 통과한다.
- 위험 test: "`phoneCanRun`은 폰보다 새 kit 판이나 새 base로 지은 화면, 폰이 모르는 module을 쓰는 화면을 `phone_too_old`로 거절하고, 폰보다 옛 major의 화면을 `screen_too_old`로 거절하고, 같은 major의 옛 판은 받는다"(여러 case를 표 하나로), "guest 메시지 schema는 `call`의 64 KiB 넘는 input과 모르는 칸이 있는 메시지를 거절한다"
- 남지 않음: 없음(더하기뿐).
- `project-docs/flows/`가 check를 통과한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 최종 `PHONE_HOST_MODULES`와 kit의 `mod.ts`를 대조한 결과, 메시지 예 하나씩, 등록할 것·넘길 줄(`phone_screens` route 등록을 이 task에서 했는지).
