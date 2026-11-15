# mobile-drive-native

**opus high.** 폰 앱의 local Expo module `lophn-drive`(Kotlin, Android)를 짓는다. host가 정한 view id로 guest(`SandboxReactNativeView`)를 찾고, 그 Android view tree를 걸어 node 목록을 내고, View.draw로 screenshot을 찍고, guest의 직계 자식에 touch를 넣고, InputConnection으로 글을 친다. spike의 버릴 code를 옮겨 쓰되 spike의 일곱 변경을 넣고 adb broadcast 입구는 버린다. JS에서 부르는 API는 `mobile-drive-phone`이 쓴다.

- 단위: drive-phone (wave 2)
- 선행: mobile-drive-contract. **`mobile-app`, `mobile-user-apps`, `mobile-widgets` 계획이 main에 land된 뒤에 띄운다**(guest runtime `mobile-phone-guest`와 dev build 길이 있어야 한다)
- 소유(이 task만 고친다):
  - `packages/mobile/modules/lophn-drive`(새 폴더: `expo-module.config.json`, `android/build.gradle`, `android/src/main/...`, `index.ts`, `src/`의 TS 감싸개와 node test)
  - `packages/mobile/guest/fixtures`(drive fixture 화면 하나를 더하는 만큼)
  - `packages/mobile/guest/lab`(drive 시나리오를 돌리는 lab 화면을 더하는 만큼)
  - `packages/mobile/plugins`(sandbox R8 keep 규칙이 release build에 빠져 있을 때만. 있으면 고치지 않는다)
- 읽을 것:
  - 판정과 버릴 code(읽기만. 옮겨 쓰고 이 task의 file로 만든다): `/home/pyosechang/projects/lophn/reports/mobile-program/drive-spike.md` 전부(특히 "Kotlin approach per action, and the pitfalls", "Release build differences", "Survey changes"), `/home/pyosechang/projects/lophn-worktrees/spike-app-screens/mobile/modules/lophn-drive/**`(`Drive.kt`: `find`, `snapshot`, `role`, `name`, `flags`, `isSecure`, `tapScreen`, `drag`, `type`, `intoView`, `shot`, `encode`), `/home/pyosechang/projects/lophn-worktrees/spike-app-screens/mobile/guest/{screen-drive.tsx,proguard-sandbox.pro}`
  - 계약: `packages/protocol/phone/drive.ts`(`driveNodeSchema`, act 모양, screenshot 출력, `DRIVE_SCREENSHOT_BYTES_MAX`, 거절 이유 `no_preview`·`screen_off`·`phone_in_background`, `conflict` 이유 `stale_ref`·`off_screen`)
  - guest: `packages/mobile/src/apps/guest/mod.ts`(`GuestScreen`의 `view`가 `origin`이다), `packages/mobile/guest/{lab,fixtures}`와 `packages/mobile/README.md`의 guest 절(lab을 여는 `EXPO_PUBLIC_LOPHN_GUEST_LAB=1`, base·화면 bundle 짓기, dev build와 release build), `packages/mobile/plugins`(R8 keep 규칙이 거기 있는지)
  - 계획 `README.md`의 "정한 것"과 "돌리기 전에"
- 계약:
  - 쓰는 것: 위 계약의 모양. `@callstack/react-native-sandbox`의 public class(`SandboxReactNativeView`, `delegate.origin`). library를 patch하지 않는다(spike S10: 필요 없었다)
  - 내놓는 것(`packages/mobile/modules/lophn-drive/index.ts`. 실패는 throw하지 않고 `Result`로 준다. 오류 code는 일곱 가운데 하나, `details.reason`은 계약의 이름):
    - `snapshot(view): Promise<Result<DriveSnapshot>>`(계약의 `drive.snapshot` 출력 그대로)
    - `act(view, snapshot, act): Promise<Result<{}>>`(계약의 `act`)
    - `screenshot(view, format): Promise<Result<DriveScreenshot>>`(긴 변 1080 px, JPEG q80. 1 MiB를 넘으면 q60으로 한 번 더, 그래도 넘으면 `internal`)
    - `waitText(view, text, timeoutMs): Promise<Result<{found: boolean}>>`(UI thread에서 200 ms마다 tree의 이름·값·글을 본다)
    - `keepScreenOn(on: boolean): void`(창의 `FLAG_KEEP_SCREEN_ON`)
    - 모든 요청 공통: activity가 `RESUMED`가 아니면 `unavailable`(`phone_in_background`), 창 focus가 없거나 `PowerManager.isInteractive`가 false면 `unavailable`(`screen_off`), 그 view id의 guest가 붙어 있지 않으면 `unavailable`(`no_preview`)

## 할 일

1. module 뼈대: spike의 `expo-module.config.json`, `build.gradle`(`implementation project(':callstack_react-native-sandbox')`)을 옮긴다. `modules/` 아래라 autolink되는지 깨끗한 `expo prebuild` 뒤 compile로 확인한다(spike는 temp 사본에서만 봤다). BroadcastReceiver와 `tapxy`·`wintap`·`wincb`·`ax` 같은 실험 명령은 옮기지 않는다.
2. 찾기와 거절: 위 공통 규칙. guest는 `activity.window.decorView`에서 `SandboxReactNativeView && delegate?.origin == view && isAttachedToWindow`, 표면은 `getChildAt(0)`. 이 module은 view id를 받아 찾을 뿐 그 view가 preview인지 모른다(그 판단은 `mobile-drive-phone`의 controller가 먼저 한다).
3. snapshot: spike의 walk(목록에 넣는 조건, role tag와 class로 role, 이름 규칙: ScrollView는 자식 글을 이름으로 쓰지 않는다, 이름 있는 단추 안의 글·장식 svg는 건너뛴다). 화면 안의 node만 싣되 scroll container 안의 자식은 화면 밖이어도 `offscreen` flag로 싣는다(spike 변경 1). secure 입력은 값을 읽지 않고 비었는지만 보고 `••••`(spike `isSecure`: `inputType`과 transformation만 본다). node 번호는 snapshot마다 1부터, snapshot id는 증가하는 문자열. 표는 view마다 마지막 snapshot 하나: `node → (WeakReference<View>, role, name)`.
4. act: 표에서 node를 찾고 아직 붙어 있고 그 guest 아래이고 role·name이 같은지 본다(아니면 `conflict` `stale_ref`, snapshot id가 마지막이 아니어도 같다). 화면 밖이면 `requestRectangleOnScreen`으로 먼저 들이고, 들인 뒤에도 보이는 rect가 guest 안에 없으면 `conflict` `off_screen`(clamp한 점을 누르지 않는다. spike 변경 2). click은 DOWN, 50 ms 뒤 UP을 표면 좌표로 `surface.dispatchTouchEvent`(직계 자식). type·fill은 focus(누르기, 안 되면 `requestFocusFromJS`) 뒤 `onCreateInputConnection`의 `commitText`(fill은 전체 선택 뒤), 끝나면 `InputMethodManager.hideSoftInputFromWindow`로 keyboard를 내린다(spike 변경 4). press Enter는 `performEditorAction(IME_ACTION_DONE)`(node가 없으면 focus된 입력). scroll은 node면 그 node를 들이고, dy면 가장 가까운 scroll container(없으면 첫 scroll container)에 spike의 drag(끝에서 멈춰 fling 없음). EditText가 아닌 node에 type·fill은 `invalid_input`.
5. screenshot: `View.draw`를 `SandboxReactNativeView`에(PixelCopy를 쓰지 않는다), 긴 변 1080으로 줄여 JPEG q80(요청이 png면 PNG), base64. guest 영역만 찍힌다.
6. JS 감싸개(`index.ts`, `src/`): native 결과 JSON을 계약 schema로 검사해 `Result`로 낸다. 순수 부분(결과 검사, 오류 code 바꾸기)은 React Native를 import하지 않는 file로 나눠 `node --test`로 본다(`packages/mobile/README.md`의 `npm test` 규칙).
7. lab과 fixture: spike의 `screen-drive.tsx`를 `packages/mobile/guest/fixtures/`에 옮기고(kit Button, IconButton, Field 안 Input, secure Input, SegmentedControl, Checkbox, Switch, ScrollView 안 60줄, 8 s busy 단추, render 오류 단추, 줄 바꾸기 단추, 상태 글), lab에 "drive" 시나리오를 더한다: 위 fixture를 `GuestScreen`으로 띄우고 module API를 차례로 불러(snapshot → 이름으로 node 찾기 → click → type → fill → Enter → Row 59 scroll과 click → screenshot jpeg·png → waitText → 줄 바꾼 뒤 옛 ref → busy 중 snapshot·screenshot) 결과를 화면 글로 보인다(개발용이라 영어 그대로).
8. Android 확인(아래 규칙). **debug와 release 둘 다**에서 7의 시나리오와 spike S1~S7의 항목을 돌리고 숫자와 함께 표로 적는다: tree가 `uiautomator dump`의 누를 수 있는 node와 같은가(이름, bounds 2 px 안), Field label이 textbox 이름인가(`mobile-drive-kit`이 merge되었으면), 누르기가 host 단추에 새지 않는가(spike 6의 4), HOME 뒤와 `KEYCODE_SLEEP` 뒤 모든 요청이 `unavailable`인가, keyboard가 type 뒤에 내려가는가, `keepScreenOn(true)`에서 15 s timeout 화면이 5분 켜져 있는가, release build에 R8 keep 규칙이 들었는가(없으면 guest가 mount될 때 앱이 죽는다. 그때만 `packages/mobile/plugins`에 더한다), screenshot 크기와 ms(JPEG q80 1080).

## Android 확인 규칙

- emulator는 `lophn-phone` AVD를 `-read-only -memory 2048 -port 5614`로 띄우고 모든 adb 명령에 `-s emulator-5614`를 붙인다. 끝나면 `adb -s emulator-5614 emu kill`로 끈다. Metro는 port 8254다.
- gradle은 `--no-daemon -Pkotlin.compiler.execution.strategy=in-process -PreactNativeArchitectures=x86_64`, release는 `--max-workers=1`(spike: 병렬이면 메모리 감시가 죽였다), debug 서명의 `assembleRelease`. daemon을 남기지 않는다.
- 손가락 입력 확인은 release build에서 한다(debug의 dev menu view가 손가락 입력을 guest에서 가로챈다. spike). 이 module의 직계 자식 dispatch는 debug에서도 된다.
- 사람의 실제 폰(serial `R3CT90K6G2X`)에는 어떤 명령도 보내지 않는다. `pkill`·`killall`과 `ps`로 process를 찾아 죽이는 일을 하지 않는다. 띄운 process는 직접 끈다. 실제 core·relay·model provider와 사람의 `~/.lophn`을 쓰지 않는다(이 task는 core 없이 lab으로 본다).
- 그림은 `.dev-data/mobile-drive-native/shots/`에 둔다.

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check`가 통과한다. 깨끗한 prebuild 뒤 debug와 release가 compile된다.
- 위험 test: "secure 입력의 글은 snapshot에 나가지 않고(`••••`나 빈 값), 표에 없거나 role·name이 바뀐 node와 화면 안으로 들이지 못한 node에는 touch를 넣지 않는다"(node test는 감싸개의 결과 검사까지. native 쪽은 8번 emulator 확인의 표로 보고한다. 이 확인이 통과하지 않으면 끝남이 아니다)
- 남지 않음: `grep -rn "dev.lophn.drive.CMD\|BroadcastReceiver" packages/mobile/modules`가 0줄이다.
- flows catalog: 이 task가 더하는 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: debug·release 확인 표(spike S1~S7 항목, 숫자), R8 keep 규칙이 어디 있었나, `index.ts`의 API와 오류 code·reason 표, dev build를 짓는 데 바뀐 것(lead가 `/tmp/lophn-mobile-drive-x86_64.apk`를 지을 명령), `packages/mobile/README.md`에 lead가 옮길 drive 절 초안(이 task는 README를 고치지 않는다).
