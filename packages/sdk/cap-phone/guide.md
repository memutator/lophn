# @lophn/cap-phone

## 목적

앱 backend가 사람의 폰에서 위치를 한 번 읽는 client다. 폰은 그 사람의 기준 폰이고, lophn
폰 앱이 앞에 떠 있을 때만 답한다. 앱이 폰을 깨우지 않으며 background나 연속 위치는 없다.
요청마다 폰에서 위치를 한 번 재서 돌려준다. 앱 UI view(브라우저 쪽)에서는 부르지 못하고,
command·operation·flow·시작 코드에서 부른다. import는 grant를 주지 않는다.

## 공개 API와 type

```ts
import { getLocation } from "@lophn/cap-phone";
```

- `getLocation({ accuracy?, maxAgeMs? })` — `{ lat, lon, accuracyM, at }`를 돌려준다. 인자는 모두 선택이다.
  - `lat`·`lon`은 도(degree), `accuracyM`은 미터, `at`은 잰 시각(ISO 8601 UTC)이다.
  - `accuracy`는 `"low"`, `"balanced"`(기본), `"high"`다. 정확할수록 폰이 오래 걸리고 배터리를 쓴다.
  - `maxAgeMs`는 0~300000의 정수이고 기본은 0이다. 이 시간 안에 잰 위치가 폰에 있으면 새로 재지
    않고 그것을 쓴다. 0이면 매번 새로 잰다.
- `createPhoneClient({ host? })` — 시험이나 preview에서 host를 바꿔 끼운다. live가 아닌
  mode(`preview`, `test`)에서는 폰에 닿지 않고 서울시청의 고정 위치(`accuracyM: 50`, `at`은 지금)에
  `standIn: true`를 붙여 돌려준다.
- 거절과 실패는 `CapabilityError`다.
  - `forbidden`이고 `permission`이 `phone.use`면 grant가 없다. `scope`는 `{ capability: "location.get" }`다.
  - `forbidden`이고 `reason`이 `os_permission_denied`면 사람이 폰에서 lophn의 위치 권한을 거절했다.
  - `unavailable`이면 `reason`이 다음 중 하나다. `no_phone`(기준 폰이 짝지어져 있지 않다),
    `phone_unreachable`(폰과 연결이 없다), `unsupported`(폰 앱이 위치를 지원하지 않는 판이다),
    `phone_in_background`(폰 앱이 앞에 있지 않다), `location_off`(폰의 위치 서비스가 꺼져 있다),
    `timeout`(제때 답이 없다). 앱 process 밖이라 host가 없을 때도 `unavailable`이다(`reason` 없음).
  - 입력이 틀리면 `invalid_input`이고 폰에 묻기 전에 난다.
- `checkDeclaration(declaration)` — 이 package를 쓰는 선언이 `phone.use`를 빠뜨렸는지 검사한다.
- type: `PhoneClient`, `PhoneLocation`, `LocationOptions`, `LocationAccuracy`, `CapabilityError`,
  `DeclarationCheck`

## 요구 permission

`phone.use` — scope는 `{ capability: "location.get" }`이고 `reason`을 쓴다. 선언하고 activation 때
사람이 한 번 허락해야 한다. 허락했어도 처음 부를 때 폰이 OS 위치 권한을 따로 묻는다.
요청은 그 사람의 기준 폰 하나로만 간다.

## peer 의존

없다(단독 사용).

## 실패를 다루는 법

폰은 사람 손에 있어서 위치를 못 읽는 일이 정상 경로다. `unavailable`이면 앱이 사람에게 다음 일을
보인다: `phone_in_background`·`phone_unreachable`이면 "폰에서 lophn을 열어 주세요", `location_off`면
"폰의 위치 서비스를 켜 주세요", `no_phone`이면 "폰을 lophn에 연결해 주세요". 같은 호출을 되풀이해
부르지 않는다. 사람이 다시 시도할 길(버튼, 다음 실행)에서 한 번 더 부른다. `os_permission_denied`도
폰 설정에서 위치를 허용하라고 알린다.

## 예제

```ts
import { CapabilityError, getLocation } from "@lophn/cap-phone";

// 선언: sdk_dependencies에 { name: "@lophn/cap-phone", version: "1.0.0" },
//       permissions에 { kind: "phone.use", scope: { capability: "location.get" }, reason: "근처 가게를 찾는다" }
export async function nearby() {
  try {
    const here = await getLocation({ accuracy: "balanced", maxAgeMs: 60_000 });
    return { ok: true, lat: here.lat, lon: here.lon };
  } catch (error) {
    if (error instanceof CapabilityError && error.code === "unavailable") {
      // 되풀이하지 않고 사람에게 다음 일을 보인다.
      return { ok: false, next: "폰에서 lophn을 열어 주세요", reason: error.reason };
    }
    throw error;
  }
}
```

## version 정책

판마다 바뀐 점과 앱 code를 옮기는 법은 `migrate-sdk` skill의 메모 `<이름>-<판>.md`(예: `declaration-4.0.0.md`)에 있다(이 SDK의 판을 올리면 그 메모를 같이 쓴다).

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다(예: 폰이 답하는 kind를 더하는 함수).
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
