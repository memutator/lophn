# phone capability: 사용자 앱이 폰 기능을 넓게 쓴다

상태: 단계 1은 `feat/phone-capability` branch에 지었다(2026-11-21. change-log `phone-capability-screens`, `architecture/phone-screen.md`·`remote.md`). emulator(release build, 개발 core, 손으로 지은 앱)에서 여덟 기능 전부, grant 없음과 거둠, preview의 stand-in, 폰에서 도는 앱의 offline 사용을 보았고, headless Electron에서 desktop preview의 stand-in과 선언하지 않은 기능의 거절을 보았다. 실제 폰과 실제 QR 스캔 끝까지는 보지 못했다. 단계 2와 3은 아직 열지 않았다. 이 문서의 나머지는 2026-11-21 사람이 방향을 낸 뒤 planner가 쓴 로드맵이고 사람의 검수 전이다. `(agent)`로 적은 것은 planner가 근거를 적어 정한 것이라 검수에서 뒤집을 수 있다.
배경 문서: `project-docs/architecture/{phone-screen,remote,app-sync,activation,app-call,phone-home-screen}.md`, `project-docs/products/roadmap/mobile.md`("폰 기능").
조사: worker 둘의 코드 조사(2026-11-21, main `8be849625`). Orca의 직접 배포는 `stablyai/orca` release 기록과 `harness-lab/orca`.

## 사람의 말 (원문, 2026-11-21)

> 왜 이런 근본적인 한계가 있어? 그럼 저런 것들을 우리가 sdk로 열어줘야한다는거임?

> 그래서 제약없이 사용자의 니즈에 맞는 앱을 만들기 위한 가장 좋은 방향이 뭐라는건데

> 어디에 배포하는냐에 따라 구별해서 개발하고 그런 것도 가능한가? 예를 들어서 ios 에서 배포할 때는 remote 기능까지만 넣고 play store에서 배포할 때는 여느 기능을 제한해서 넣고 우리가 직접 배포할 때는 풀로 열고

> 일단 3단계는 제외하자 1,2 단계를 넓히는 방식으로 먼저 가자

## 왜

- 사용자 앱의 폰 화면은 lophn 폰 앱이 내려받아 돌리는 JS bundle이다. native module은 APK에 든 것만 쓸 수 있고, 그것도 lophn이 guest에 넘기지 않는다. 그래서 앱이 쓸 수 있는 폰 기능은 lophn이 연 만큼이고 지금은 위치 하나다.
- 기능을 쓰는 예가 생길 때 하나씩 열면(`mobile.md`의 옛 방침) 열 때마다 폰 앱을 새로 build해 깔아야 한다. 앱 agent가 "그 기능은 아직 없다"고 답하고 사람은 lophn 새 판을 기다린다.
- 방향은 브라우저다. 폰 앱이 기능을 넓게 싣고, 앱이 못 쓰는 이유는 "lophn이 안 만들었다"가 아니라 "사람이 허락하지 않았다"만 남긴다.

## 지금 코드

### 화면과 host 사이

- guest와 host 사이 message는 `packages/protocol/apps/phone-screen.ts`가 정한다. guest → host는 넷(`ready`, `call`, `fatal`, `local_change`), host → guest는 넷(`init`, `reply`, `event`, `appearance`)이다. 둘 다 닫힌 strictObject union이다.
- 화면이 보는 `lophnApp`은 `place`, `callOperation`, `events.subscribe`뿐이다(`PhoneLophnApp`, 같은 file). 폰 기능을 부르는 member가 없다.
- 호출은 guest의 counter id와 `pending` Map으로 짝짓는다(`packages/mobile/guest/bridge.ts`). 이 길에는 timeout이 없다. session이 닫히면 늦은 답을 버리고 guest의 promise는 끝나지 않는다.
- 크기: `callOperation` 입력은 64 KiB(`PHONE_CALL_INPUT_MAX_BYTES`), message 하나는 8 MiB + 1 KiB(`PHONE_MESSAGE_MAX_BYTES`)다. JSON만 지나가서 bytes는 base64 글이어야 한다.
- guest가 받는 native module은 넷이다(`GUEST_MODULES`, `packages/mobile/src/apps/guest/modules.ts`: `RNCSafeAreaContext`, `KeyboardController`, `ReanimatedModule`, `WorkletsModule`). 폰에서 도는 앱에만 `LophnAppDb`가 origin에 묶여 더해진다(host가 guest마다 따로 묶어 주는 module의 본보기). Expo package는 guest에 넘기지 않는다(`packages/mobile/plugins/with-guest-runtime.js`).
- 화면 bundle이 require할 수 있는 module은 여덟이다(`PHONE_HOST_MODULES`). `lophnApp`의 모양이나 이 목록이 바뀌면 `PHONE_BASE_FORMAT`(지금 3)을 올리고, 옛 폰은 `phone_too_old`로 거절한다(`phoneCanRun`).

### 컴퓨터가 폰에 묻는 길

- kind 표는 `PHONE_KINDS`(`packages/protocol/phone/kinds.ts`)이고 다섯이다: `location.get`과 `drive.*` 넷. 폰의 handler 표는 `PHONE_HANDLERS`(`packages/mobile/src/link/answer.ts`)이고 그 key가 `hello.capabilities`가 된다.
- 폰의 handler는 앱이 앞에 있을 때만 답하고, kind의 deadline(1~60초)을 넘긴 답은 버린다. 위치 handler는 handler 52줄과 native port 37줄이다.
- 앱의 길은 backend에서만 열린다: `@lophn/cap-phone` 1.0.0의 `getLocation` → broker → `app_phone.request` → 기준 폰. broker 요청 body는 1 MiB까지다.

### 기능 하나를 더할 때 고치는 곳

`remote.md`의 결정은 "kind 표의 한 항목과 폰의 handler 하나"라고 적었지만 코드는 그렇지 않다.

- 손으로 적은 기능 목록이 셋이고 서로 맞는지 보는 test가 없다: `PHONE_KINDS`, `phoneCapabilitySchema`(`packages/protocol/apps/phone-request.ts`의 `z.enum`), `PHONE_CAPABILITIES`(`packages/protocol/apps/declaration/types.ts`).
- 동의 카드와 앱 상세의 글이 `capability === "location.get"` 삼항 둘이다(`packages/shell/renderer/desktop/connection/waiting/model.ts`, `packages/shell/renderer/app-frame/app-detail/model.ts`). 모르는 기능은 이름이 그대로 보인다. 폰은 같은 code를 import해 쓴다.
- `PHONE_CAPABILITIES`는 `@lophn/declaration`(4.12.0)에 묶여 나가서 기능을 더하면 그 SDK의 bytes가 바뀐다. 그것을 정확히 pin하는 `@lophn/app-ui`(2.23.0)와 `@lophn/app-ui-native`(1.9.3)도 같이 올라가고 판마다 `migrate-sdk` 메모가 든다.
- grant 표(`grants`)는 scope를 JSON 글로 들어 기능을 더해도 schema step이 없다. broker, `app_phone.request`, `PhoneLink`는 기능을 가리지 않는다.

### 허락

- grant는 컴퓨터의 ledger에만 있고 앱 supervisor의 broker만 본다. 앱마다이고 release마다가 아니다. 쓸 수 있는 범위는 지금 release의 선언 ∩ active grant다.
- 폰은 grant를 전혀 모른다. `apps/phone_screens`의 항목에 permission도 grant도 없고(`packages/protocol/apps/phone.ts`), 이 route가 따르는 변경은 `releases`와 `app_runtime`뿐이라 grant를 거둬도 폰이 다시 읽지 않는다. 폰에서 도는 앱의 설치 기록(`Installed`, `packages/mobile/src/apps/local/folder.ts`)에도 없다.
- `runs_on: ["phone"]` 앱은 `phone.use`를 선언할 수 있고 activation도 거치지만, process와 broker가 없어 그것을 보는 곳이 없다.

### APK에 든 것

- 있다: `expo-camera`(pairing QR), `expo-image-picker`(대화에 사진 붙이기), `expo-clipboard`, `expo-haptics`(쓰는 곳 없음), `expo-location`, `expo-network`, `expo-notifications`, `expo-file-system`, `expo-secure-store`. React Native core의 `Share`, `Linking`, `Vibration`.
- 없다: 문서 고르기, 공유 sheet로 file 보내기, 공유 받기(intent filter), 인쇄, 음성 인식과 읽기, 녹음과 재생, 센서, 밝기, 화면 켜두기, 화면 방향, 연락처, 캘린더, 지문, 배터리, 기기 정보, 블루투스, NFC, 사진 보관함.
- `packages/mobile/app.json`에 build 갈래(flavor)가 없고 Android뿐이다.

### 큰 data

- 앱이 file이나 사진을 둘 자리가 없다. computer의 backend는 SQLite(`@lophn/cap-store`, BLOB 칸은 된다)와 `@lophn/cap-fs`(절대 path, 컴퓨터만)를 쓰고, 폰에서 도는 앱은 SQLite file 하나뿐이다. 호출 하나의 changeset은 8 MiB까지다(`APP_SYNC_CHANGE_MAX_BYTES`).
- 화면이 사진을 받아도 `callOperation` 입력이 64 KiB라 backend로 넘길 수 없다. 폰에서 도는 앱의 guest 안 호출도 같은 한도다.
- guest의 그림은 kit의 `Icon`과 `data:` URI뿐이고 network 그림은 실패한다.
- 대화의 사진 올리기(`acp/image_upload`)는 5 MiB까지 base64 frame 하나다. 조각으로 나르는 것은 `carry/put`(8 MiB 조각)이 한다.

### preview와 drive

- desktop의 폰 화면 preview는 web build를 보통 앱 view로 띄운다. `lophnApp`은 `packages/shell/preload/app-tool.ts`가 주고 native module은 `packages/core/apps/releases/ui-build/phone/web-shims.ts`가 대신한다.
- `@lophn/cap-phone`은 live가 아니면 폰에 닿지 않고 고정 위치에 `standIn: true`를 붙여 준다. `@lophn/cap-notify`와 `@lophn/cap-secret`도 같은 꼴이다.
- drive는 guest의 view tree만 본다. host가 띄운 카메라나 고르기 화면은 볼 수도 누를 수도 없고 그동안 요청은 `covered`다.

## 무엇을 만드나

### 폰 기능 표 하나, 들어오는 길 둘

- 폰 기능은 표 하나의 항목이다: 이름, 입력과 출력 schema, deadline, 사람의 손이 드는지(`interactive`), 들어오는 길, 동의 카드에 보일 글의 key. 기능 목록 셋과 글 삼항 둘은 이 표에서 나오거나 type으로 이 표와 맞춘다.
- 폰의 handler 표도 하나다. 들어오는 길은 둘이다.
  - **화면 길(새로 만든다).** guest가 host에 폰 기능 message를 보내고 host가 handler를 돌려 `reply`로 답한다. 컴퓨터를 거치지 않는다. 폰에서 도는 앱의 backend도 같은 guest 안이라 같은 길을 쓴다.
  - **backend 길(지금 있다).** 컴퓨터의 backend → broker → core → 폰.
- 사람의 손이 드는 기능(카메라, 고르기, code 읽기, 지문, 공유)과 사람이 지금 하는 일에 붙은 기능(클립보드, 진동)은 화면 길만 연다. 조용히 읽는 기능(위치, 배터리, 연결 상태, 기기 정보)은 두 길을 다 연다.
- 화면 길의 호출은 기능마다 deadline이 있다. 사람이 고르기를 닫으면 오류가 아니라 "고르지 않음"으로 답한다. session이 닫히면 걸린 호출을 끝낸다.

### 허락

- permission은 지금의 `phone.use {capability}` 그대로다. 앱이 선언하고 activation 동의 카드에서 기능마다 한 번 허락한다. OS 권한은 폰이 처음 쓸 때 묻는다.
- 폰이 허락을 본다. `apps/phone_screens`가 앱마다 "선언 ∩ grant의 폰 기능 목록"을 싣고 `app_grants` 변경을 따른다. host는 화면 길의 호출마다 그 view의 앱이 그 기능을 가졌는지 본다. 앱과 view는 host가 아는 값이고 guest가 낸 값은 쓰지 않는다.
- 폰에서 도는 앱은 그 목록을 설치 기록에 같이 둔다. 컴퓨터에 닿지 않아도 쓰고, 거둔 것은 다음에 컴퓨터에 닿을 때 반영된다.
- 화면은 지금 쓸 수 있는 기능 목록(허락 ∩ 이 폰이 가진 것)을 `init`으로 받는다. 없는 기능은 단추를 감출 수 있고, 불러도 `forbidden`이나 `unavailable`(`unsupported`)로 답한다.

### 기능마다 켜고 끈다

- 기능 하나는 handler 하나와 그 OS 권한 선언 한 묶음이고, build가 목록으로 뺄 수 있다. 뺀 기능은 handler 표에 없어 폰이 가졌다고 말하지 않는다.
- 배포처별 판(직접 배포는 전부, Play는 일부, iOS는 remote만)은 이 문서의 범위가 아니다. 그 판을 낼 때 목록만 다르게 주면 되도록 이 모양만 지킨다.

### preview

- live가 아니면 폰의 실제 data에 닿지 않는다. desktop preview와 폰의 preview 화면 모두 기능마다 정해진 stand-in 값에 `standIn: true`를 붙여 답한다.

### 앱 file 자리 (단계 2)

- 사진, file, 녹음을 내는 기능은 bytes가 아니라 file 손잡이(id, content type, 크기)를 답한다. host가 bytes를 그 앱의 file 자리에 쓴다.
- 화면은 손잡이로 그림을 그리고(host가 그 guest의 앱 것만 풀어 준다), operation에는 손잡이만 넘긴다. backend는 SDK로 bytes를 읽는다.
- computer에서 도는 앱의 file은 폰이 컴퓨터로 올린다. 폰에서 도는 앱의 file은 폰에 남고 컴퓨터에 닿을 때 따라간다.
- 이것은 새 저장소라 sync, rewind, 지우기, 한도를 같이 정해야 한다. 단계 2를 열 때 따로 조사하고 architecture 문서로 쓴다.

## 정한 것

- 방향은 폰 앱이 기능을 넓게 싣고 허락으로 가르는 것이다. 쓰는 예가 생길 때 하나씩 여는 `mobile.md`의 방침을 바꾼다. (사람, 2026-11-21)
- background(주기 수집, 장소 도착, 위치 따라가기, 깨어날 때 앱 code 돌리기)는 이 일에서 뺀다. (사람, 2026-11-21)
- 배포 형식은 접어 둔다. 기능마다 켜고 끌 수 있게만 만든다. (사람, 2026-11-21)
- 화면이 host에 직접 묻는 길을 만든다. 이유: 사람의 손이 드는 기능은 사람이 그 화면 앞에 있을 때 시작되고, 컴퓨터를 돌아오면 컴퓨터가 꺼졌을 때와 폰에서 도는 앱에서 못 쓴다. (agent)
- guest에 native module을 더 넘기지 않는다. host가 기능을 돌리고 결과만 넘긴다. 이유: `phone-screen.md` 지키는 것 5(guest에 secret, file, network를 가진 module을 더하지 않는다)를 그대로 둔다. (agent)
- permission kind를 늘리지 않는다. 이유: `remote.md`가 `phone.use {capability}` 하나로 기능을 늘리기로 이미 정했다. (agent)
- 기능 목록은 선언 SDK에 그대로 적어 둔다(아무 이름이나 받지 않는다). 이유: 앱 agent가 틀린 이름을 선언 검사에서 바로 안다. SDK 판은 기능을 묶어 열 때마다 한 번 오른다. (agent)
- 폰 기능을 읽은 기록은 남기지 않는다. 이유: 위치가 그렇다(`remote.md`: 동의는 동의 카드이고 읽는 것을 보이는 것은 OS다). (agent)
- preview는 stand-in이다. 이유: `@lophn/cap-phone`, `@lophn/cap-notify`, `@lophn/cap-secret`이 그렇다. (agent)
- 링크 열기와 공유는 연다. 이유: desktop 화면에 이미 `openExternal`이 있고 AGENTS.md가 사용자 앱을 공격자로 보지 않는다. 앱 data가 URL이나 공유로 나갈 수 있다는 것은 동의 카드의 글이 말한다. (agent)
- 사진과 file은 단계 1에 넣지 않는다. 이유: 받은 bytes를 backend로 넘길 길이 없다(입력 64 KiB). 한도를 올려 base64를 SQLite에 넣는 길은 목록 읽기와 sync log와 rewind가 모두 그 bytes를 끌고 다닌다. (agent)

## 단계

1. **길과 작은 값의 기능. 끝남(2026-11-21, branch `feat/phone-capability`).** 계획과 다른 점: preview는 모든 기능에 stand-in을 주지 않고 preview 선언이 선언한 기능에만 주며 선언하지 않은 기능은 live처럼 `forbidden`이다(폰의 preview와 desktop preview 모두. 목록은 core가 `app_views/open`의 답으로 준다). 화면 길도 폰 앱이 앞에 있을 때만 답한다. 기능 표를 하나로 맞추고(목록 셋, 글 삼항 둘), 화면 길, 폰의 허락 확인, 기능마다 켜고 끄기, preview stand-in을 만든다. 새 native 의존 없이 여는 기능: 진동, 클립보드 글 읽기와 쓰기, QR·바코드 읽기, 위치(화면 길 추가), 연결 상태, 링크 열기(전화, 문자, 메일 쓰기 화면 포함), 글 공유. `PHONE_BASE_FORMAT`과 SDK 판(`@lophn/cap-phone`, `@lophn/declaration`, `@lophn/app-ui`, `@lophn/app-ui-native`)이 오르고 지침(`design-app`의 `phone-features.md`, guide 셋, `prompts/app.md`)을 고친다.
2. **앱 file 자리와 media.** 사진 찍기, 사진 고르기, file 고르기, 녹음과 재생, file 공유, 사진 저장, 클립보드 그림.
3. **나머지 묶음.** 지문 확인, 연락처, 캘린더, 음성 인식과 읽기, 센서, 배터리, 기기 정보, 화면 켜두기와 밝기와 방향, 인쇄, 걸음 수와 건강 정보(앱을 열 때 지난 기록 읽기). 계속 받는 값(센서, 음성)은 host → guest `event`로 보낸다.

단계 1은 한 줄로 한다(`planner-persona`의 "어떻게 할지 고르기"): protocol의 표, 폰의 host, SDK가 서로 기대고 같은 file을 고친다. 단계 1이 끝나면 기능 하나가 handler 하나라 단계 3은 병렬 계획으로 열 수 있다.

## 하지 않는 것

- background와 폰을 깨우는 일. `remote.md` 지키는 것 16("background 위치를 읽지 않는다, 폰을 깨우지 않는다")은 그대로다.
- 배포처별 판, 서명 key, 앱 id, 직접 배포의 update 길. 따로 정한다.
- iOS.
- lophn agent가 폰 기능을 부르는 길(CLI, tool). 쓰는 예가 생길 때 연다(`remote.md` 결정).
- 다른 앱이 lophn으로 공유해 보내는 것 받기. 어느 앱이 받는지 고르는 화면이 따로 든다.
- 블루투스, NFC. 기능 하나가 아니라 기기마다 protocol이 다른 일이다. 쓰는 앱이 생길 때 본다.
- 문자 읽기, 통화 기록, 다른 앱의 알림, 사용 시간, 접근성. Play 심사에 걸려 배포 형식과 같이 정한다.

## 확인하지 않은 것

- 카메라나 고르기 activity가 떠 있는 동안 Android가 lophn process를 죽이면 guest가 새로 떠서 결과를 잃는다. 얼마나 자주인지, 결과를 되찾을 길이 필요한지. 단계 1의 스캐너는 같은 activity 안의 화면이라 이 문제가 없다. 단계 2의 카메라 촬영과 고르기는 다른 activity에서 결과가 온다.
- 단계 2가 풀어야 할 것: (1) 폰 앱이 뒤로 가 연결이 끊기면 컴퓨터에서 도는 앱의 guest가 새로 떠 화면 상태를 잃는다(이슈 `phone-guest-remounts-after-background`. 폰에서 도는 앱은 영향이 없다). 다른 activity의 결과를 받으려면 같은 guest가 살아 있어야 한다. (2) 열린 요청의 결과를 process가 죽은 뒤 되찾는 길.
- OS 대화가 그것을 연 요청을 끊지 않는 것은 알려졌다: 위치 요청은 OS 권한 대화와 Play services의 위치 설정 대화 뒤에 답했다(emulator, 2026-11-21). host가 폰 앱이 앞에 있는지를 요청이 시작할 때만 보기 때문이다. 고르기 activity가 뜨는 동안 `AppState`가 어떻게 되는지는 단계 2에서 본다.
- 기능 하나하나가 Expo module로 실제로 되는지와 Android 판마다의 차이는 단계 1의 기능만 emulator로 보았다. 걸음 수와 건강 정보(Health Connect)를 앞에 있을 때 지난 기록까지 읽을 수 있는지는 단계 3.
- 실제 폰. 지금까지 폰 기능은 emulator에서만 보았다(`remote.md` "열린 것").
