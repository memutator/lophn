# @lophn/cap-save

## 목적

앱이 선언한 문서 key에 새 version을 저장하는 client다(apps/sdk#R30). 문서
place를 고르는 API가 아니다. 저장은 호출한 앱 자리의 `(앱 자리, key)` 문서로만
가고, 기대 version 충돌과 재전송 중복은 documents/versions가 판정한다. import는
grant를 주지 않는다.

## 공개 API와 type

```ts
import { saveDocument } from "@lophn/cap-save";
```

- `saveDocument({ key, baseVersion, idempotencyKey })` — command 안에서 부른다.
  `{ saved, version }`을 돌려준다. 성공 응답은 실제 version이 확정된 뒤에 온다.
  - `key`: blueprint `documents[].key`로 선언하고 `document.save` grant를 받은
    key.
  - `baseVersion`: 이 저장이 이어받는 version. 첫 저장이면 `null`. 다른
    version이 이미 쌓였으면 `conflict`다.
  - `idempotencyKey`: 같은 저장을 다시 보낼 때 같은 값. 같은 값은 version을
    하나만 만든다. 응답이 유실되면 같은 값으로 다시 부르면 된다(client도 일시
    실패에는 같은 값으로 2회 다시 보낸다). 끝내 실패하면
    `error.outcome === "unknown"`이다.
- `createSaveClient({ host?, sleep?, standIn? })` — host를 바꿔 끼운다.
- `createSaveStandIn()` — preview·test의 문서 대역이다. live가 아닌 mode에서는
  documents에 나가지 않고 같은 규칙을 메모리에서 지킨다.
- 거절은 `CapabilityError`다. `forbidden`이면 `permission`(`document.save`)과
  `scope`(`{ key }`)를 알린다.
- `checkDeclaration(blueprint)` — 이 package를 쓰는 선언이 `document.save`를
  빠뜨렸는지 검사한다.
- type: `SaveClient`, `SaveRequest`, `SaveResult`, `CapabilityError`,
  `DeclarationCheck`

## 요구 permission

`document.save` — 선언한 문서 key. 선언하지 않은 key는 grant가 있어도 거절된다.

## peer 의존

정확한 peer는 없다(단독 사용).

## 예제

```ts
import { saveDocument } from "@lophn/cap-save";

const saved = await saveDocument({
  key: "weekly-report",
  baseVersion: null,
  idempotencyKey: `report-${invocationId}`,
});
```

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
