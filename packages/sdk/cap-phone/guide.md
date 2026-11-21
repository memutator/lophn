# @lophn/cap-phone

## 목적

앱이 사람의 폰 기능을 쓰는 client다. 폰은 그 사람의 기준 폰이고, background나 연속 읽기는 없다. 앱이 폰을
깨우지 않는다. import는 grant를 주지 않는다. 같은 함수 이름을 두 곳에서 쓴다.

- **폰 화면**(`phone.tsx`)과 폰에서 도는 backend, desktop의 폰 화면 preview: 요청이 그 폰의 lophn 앱으로 직접 간다.
  컴퓨터를 거치지 않으므로 컴퓨터가 꺼져 있어도, 폰에서 도는 앱에서도 된다. 모든 기능을 쓰지만 lophn 폰 앱이 앞에 있을
  때만 답한다(뒤에 있으면 `unavailable`, `phone_in_background`. 화면의 timer가 뒤에서 부르지 못한다).
- **컴퓨터에서 도는 앱 backend**(command·operation·flow·시작 코드): broker를 거쳐 기준 폰으로 간다. 위치와 연결
  상태만 열려 있고, lophn 폰 앱이 앞에 떠 있을 때만 답한다.

**폰에서 도는 backend의 operation 안에서는 빠른 기능만 부른다.** 그 operation은 호출 하나가 3초 안에 끝나야 하고 넘으면
rollback되어 `unavailable`이 되며 곧 화면이 죽는다. 오래 걸리거나 화면을 띄우는 `getLocation`, `scanCode`, `shareText`,
`openLink`, `capturePhoto`, `pickPhotos`, `pickFiles`, `shareFile`은 화면(단추 handler나 effect)에서 부르고 결과를 operation에 넘긴다. `getNetwork`, `playHaptic`, 클립보드는 operation
안에서 불러도 된다.

desktop 화면(`main.tsx`)에서는 부르지 못한다(`unavailable`). 폰 화면 bundle에는 이 package가 순수 JS로 묶인다.
녹음, 영상, 연락처, 달력, 지문, 센서, background 일은 아직 없다.

## 공개 API와 type

```ts
import {
  getLocation, getNetwork, playHaptic, readClipboard, writeClipboard,
  scanCode, openLink, shareText, getPhoneAccess,
  capturePhoto, pickPhotos, pickFiles, shareFile,
} from "@lophn/cap-phone";
```

| 함수 | 기능(`phone.use`의 capability) | 부르는 곳 | 돌려주는 것 |
| --- | --- | --- | --- |
| `getLocation({ accuracy?, maxAgeMs? })` | `location.get` | 화면, backend | `{ lat, lon, accuracyM, at }` |
| `getNetwork()` | `network.get` | 화면, backend | `{ online, type }`, `type`은 `"wifi"`·`"cellular"`·`"other"`·`"none"` |
| `playHaptic(kind)` | `haptics.play` | 화면 | `{}`. `kind`는 `"light"`·`"medium"`·`"heavy"`·`"selection"`·`"success"`·`"warning"`·`"error"` |
| `readClipboard()` | `clipboard.read` | 화면 | `{ text }`. 글만 읽고 클립보드에 글이 없으면 `null` |
| `writeClipboard(text)` | `clipboard.write` | 화면 | `{}` |
| `scanCode()` | `code.scan` | 화면 | `{ cancelled: true }` 또는 `{ cancelled: false, format, text }` |
| `openLink(url)` | `link.open` | 화면 | `{}`. scheme은 `https`·`http`·`tel`·`sms`·`mailto`·`geo`뿐이고 그 밖은 `invalid_input` |
| `shareText(text, { title? })` | `share.text` | 화면 | `{}`. 폰의 공유 sheet가 열린다 |
| `capturePhoto()` | `camera.capture` | 화면 | `{ cancelled: true }` 또는 `{ cancelled: false, file }`. `file`은 앱 file의 손잡이 |
| `pickPhotos({ max? })` | `photos.pick` | 화면 | `{ cancelled: true }` 또는 `{ cancelled: false, files }`. `max`는 1~10(기본 1) |
| `pickFiles({ types?, max? })` | `files.pick` | 화면 | `pickPhotos`와 같다. `types`는 content type이나 `image/*` 같은 무늬 10개까지 |
| `shareFile(file, { title? })` | `share.file` | 화면 | `{}`. 손잡이의 file을 폰의 공유 sheet로 보낸다 |
| `getPhoneAccess()` | | 어디서나 | `{ capabilities, standIn }`(동기) |

- 모든 결과는 live가 아니면 `standIn: true`를 달고 온다(아래 "preview"). 값이 없는 기능은 `{}`나 `{ standIn: true }`다.
- `getLocation`: `lat`·`lon`은 도(degree), `accuracyM`은 미터, `at`은 잰 시각(ISO 8601 UTC)이다. `accuracy`는
  `"low"`, `"balanced"`(기본), `"high"`다. 정확할수록 폰이 오래 걸리고 배터리를 쓴다. `maxAgeMs`는 0~300000의 정수이고
  기본은 0이다. 이 시간 안에 잰 위치가 폰에 있으면 새로 재지 않고 그것을 쓴다.
- `scanCode()`는 lophn의 전체 화면 스캐너를 화면 위에 연다. 사람이 닫으면 `cancelled: true`로 끝난다(오류가 아니다).
  화면은 그대로 두고, 한 번에 스캐너 하나라서 열린 동안의 두 번째 호출은 `conflict`다.
- `openLink`·`shareText`·`shareFile`은 앱의 data를 폰 밖으로 내보낼 수 있다. 선언의 `reason`에 그렇게 쓴다.
- **사진과 file(`capturePhoto`, `pickPhotos`, `pickFiles`, `shareFile`).** 이 기능들은 bytes가 아니라 앱 file의 손잡이(`{ file, type,
  size, name?, width?, height? }`, 작은 JSON)를 답한다. 앱 file은 바뀌지 않는 bytes이고 이름은 내용의 sha256이다(`@lophn/cap-store`
  guide). 손잡이를 operation의 입력·출력으로 넘기고 DB row에는 JSON 글로 둔다. operation 입력은 64 KiB까지라 bytes를 넣지 않는다.
  화면은 `@lophn/app-ui-native`의 `useAppFile(handle)`로 그리고, 컴퓨터의 backend는 `@lophn/cap-store`의 `readAppFile(handle)`로
  bytes를 읽는다(폰에서 도는 backend는 bytes를 못 읽고 손잡이만 넘긴다).
  - `capturePhoto`는 카메라를, `pickPhotos`는 시스템 사진 선택기를(사진만, OS 권한 없이), `pickFiles`는 시스템 file 선택기를
    연다. 사람이 그냥 닫으면 `cancelled: true`다(오류가 아니다). 사진은 JPEG 품질 0.8로 다시 압축해 넣는다.
  - 사진을 `pickPhotos`로 고른 손잡이의 `name`은 시스템 사진 선택기가 붙인 미디어 이름(`19.jpg` 같은 것)이라 원래 file 이름이 아닐 수 있다: 사진의 `name`을 사람에게 의미 있는 글로 보이지 않는다(`pickFiles`의 `name`은 고른 file의 이름이다).
  - file 하나는 64 MiB까지다. 넘으면 `invalid_input`이고 메시지로 사람에게 보인다.
  - **컴퓨터에서 도는 앱**에서는 file이 컴퓨터에 올라간 뒤에 답한다. 컴퓨터에 1분 안에 닿지 못하거나 올리지 못하면 `unavailable`이고
    손잡이가 없다(`reason`: `no_connection`은 1분 안에 연결이 없었다, `transfer_broken`은 올리다 끊겼다, `refused`는 컴퓨터가 받지 않았다. 컴퓨터의 말이 message에 있다): 사람에게 "컴퓨터에 닿을 때 다시 해 주세요"라고 알린다. 카메라나 선택기에서 돌아온 직후 연결이 잠깐 끊겨 있는 것은 이 1분 안에 이어진다. **폰에서 도는 앱**은 폰의 앱 폴더에 두고 손잡이를
    바로 답한다. 컴퓨터에서도 도는 앱이면 다음에 컴퓨터와 맞출 때(row보다 먼저) 올라간다.
  - 한 번에 하나만 연다(열린 동안의 두 번째 호출은 `conflict`). 응답 시한은 10분이다.
  - 앱 file은 지우지 않는다(앱을 지울 때 같이 지워진다). "영구 삭제" 약속을 앱에 두지 않는다.
  - 없는 것: 영상, 녹음, 사진 보관함에 저장, agent에 사진 넘기기, desktop에서 file 고르기, `sync`로 표를 보내는 앱의 file을 다른 컴퓨터로
    옮기기. 사람에게 아직 없다고 말한다.
- `getPhoneAccess()`: 지금 이 코드가 쓸 수 있는 기능의 이름(`capabilities`)이다(선언∩사람이 허락한 것∩이 폰 앱이
  가진 것). 못 쓰는 기능의 단추를 감추는 데 쓴다. 폰 화면과 그 preview에서만 알고 컴퓨터의 backend에서는 빈 목록이다. 이 목록은
  화면이 열릴 때 읽은 값이고 화면이 열려 있는 동안 바뀌지 않는다. 요청은 늘 지금의 grant로 다시 확인하므로 목록에 있어도
  `forbidden`일 수 있다.
- `createPhoneClient({ host?, phone? })` — 시험이나 preview에서 host(broker 길)나 `lophnApp.phone`(폰 화면 길)을 바꿔 끼운다.
- 거절과 실패는 `CapabilityError`(`code`, `reason`, `permission`, `scope`)다.
  - `forbidden`이고 `permission`이 `phone.use`면 grant가 없다. `scope`는 `{ capability: "<이름>" }`다.
  - `forbidden`이고 `reason`이 `os_permission_denied`면 사람이 폰에서 lophn의 위치나 카메라 권한을 거절했다.
  - `unavailable`이면 `reason`이 다음 중 하나다. `no_phone`(기준 폰이 짝지어져 있지 않다), `phone_unreachable`(폰과
    연결이 없다), `unsupported`(이 폰 앱이 그 기능을 갖고 있지 않다), `phone_in_background`(폰 앱이 앞에 있지 않다), `location_off`(폰의 위치 서비스가 꺼져 있다), `timeout`(제때 답이 없다), 컴퓨터에서 도는 앱의 사진·file에서는 `no_connection`·`transfer_broken`·`refused`(위). 화면 전용 기능을
    컴퓨터의 backend나 desktop 화면에서 부르면 `unavailable`(`reason` 없음)이다. 앱 process 밖이라 host가 없을 때도 같다.
  - `conflict`는 스캐너나 카메라·선택기가 이미 열려 있다는 뜻이다. 입력이 틀리면 `invalid_input`이고 폰에 묻기 전에 난다.
- `checkDeclaration(declaration)` — 이 package를 쓰는 선언이 `phone.use`를 빠뜨렸는지 검사한다.
- type: `PhoneClient`, `PhoneLocation`, `PhoneNetwork`, `PhoneClipboardText`, `PhoneScan`, `PhoneCapture`, `PhonePicked`,
  `PhoneFileHandle`, `PhoneDone`, `PhoneAccess`,
  `PhoneCapabilityName`, `HapticKind`, `LocationOptions`, `LocationAccuracy`, `CapabilityError`, `DeclarationCheck`

## 요구 permission

`phone.use` — scope는 `{ capability: "<이름>" }`이고 `reason`을 쓴다. **쓰는 기능마다 하나씩** 선언하고 activation 때
사람이 기능마다 한 번 허락한다. 허락했어도 위치, 스캐너, 카메라는 처음 부를 때 폰이 OS 권한을 따로 묻는다(사진 선택기와 file 선택기는 묻지 않는다). 요청은 그 사람의
기준 폰 하나로만 간다.

## peer 의존

없다(단독 사용).

## preview

live가 아니면(desktop의 폰 화면 preview, 폰의 "Preview from lophn", test) 폰에 닿지 않고 기능마다 정해진 값이
`standIn: true`와 함께 온다. 폰의 preview에서 **선언하지 않은 기능은 live처럼 `forbidden`**이다. 그러니 preview의 `forbidden`은
선언에 그 `phone.use`를 더하라는 뜻이다(desktop의 폰 화면 preview와 폰의 preview가 같다). 값은: 위치는 서울시청, 연결은 wifi로 online, 클립보드는 예시 글, 스캔은 `https://example.com`을
읽은 QR이다. `capturePhoto`·`pickPhotos`는 64x64 단색 그림 하나의 손잡이를, `pickFiles`는 짧은 글 file 하나의 손잡이를 답한다(두 file은
preview에 있어 `useAppFile`로 그릴 수 있다). 진동, 복사, 링크 열기, 공유(`shareText`, `shareFile`)는 아무 일도 하지 않는다. 그래서 preview에서는 실제 폰의 반응을 볼 수 없다. 마지막
확인은 사람이 폰에서 한다. 이 모양은 화면과 backend 모두 같다.

## 네트워크와 한계

폰 화면에는 여전히 network가 없다(`fetch`, WebSocket 없음). 링크는 폰의 다른 앱에서 열린다. 위 표에 없는 것(영상,
녹음, 연락처, 달력, 지문, 센서, background 일)은 없다. 사람에게 아직 없다고 말한다.

## 실패를 다루는 법

폰은 사람 손에 있어서 못 읽는 일이 정상 경로다. `unavailable`이면 앱이 사람에게 다음 일을 보인다:
`phone_in_background`·`phone_unreachable`이면 "폰에서 lophn을 열어 주세요", `location_off`면 "폰의 위치 서비스를 켜 주세요",
`no_phone`이면 "폰을 lophn에 연결해 주세요", `unsupported`면 "lophn 폰 앱을 올려 주세요". 같은 호출을 되풀이해 부르지 않는다.
사람이 다시 시도할 길(버튼, 다음 실행)에서 한 번 더 부른다. 못 얻어도 앱의 나머지는 돌아야 하므로 화면이나 command가 폰을
기다리며 멈추지 않게 한다. `os_permission_denied`는 폰 설정에서 허용하라고 알린다. 허락이 없는 `forbidden`(`permission`이
`phone.use`)은 grant가 없다는 뜻이다(사람이 거뒀거나 선언하지 않았다). 거둔 grant는 폰이 컴퓨터를 다시 읽을 때 반영된다.

## 예제

```tsx
// src/screens/scan/phone.tsx. 선언: sdk_dependencies에 { name: "@lophn/cap-phone", version: "1.2.0" },
// permissions에 { kind: "phone.use", scope: { capability: "code.scan" }, reason: "Read a code to add it" }
import { CapabilityError, getPhoneAccess, scanCode } from "@lophn/cap-phone";

export async function scan(): Promise<string> {
  if (!getPhoneAccess().capabilities.includes("code.scan")) return "Scanning is not available here";
  try {
    const result = await scanCode();
    return result.cancelled ? "" : result.text;
  } catch (error) {
    if (error instanceof CapabilityError && error.reason === "os_permission_denied") {
      return "Allow the camera for lophn in the phone's settings";
    }
    throw error;
  }
}
```

## version 정책

판마다 바뀐 점과 앱 code를 옮기는 법은 `migrate-sdk` skill의 메모 `<이름>-<판>.md`(예: `declaration-4.0.0.md`)에 있다(이 SDK의 판을 올리면 그 메모를 같이 쓴다).

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다(예: 폰이 답하는 기능을 더하는 함수).
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
