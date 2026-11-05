# @lophn/cap-notify

## 목적

앱 process가 사람에게 알리는 client다. 알림은 사람의 Inbox에 한 줄로 남고 toast나 OS
알림으로도 뜬다. 받는 쪽은 사람뿐이다. agent에게 사실을 보내거나 lophn의 반응을
일으키는 길이 아니다. 앱 UI view(브라우저 쪽)에서는 부르지 못하고, command·
operation·flow·시작 코드에서 부른다. import는 grant를 주지 않는다.

## 공개 API와 type

```ts
import { notify } from "@lophn/cap-notify";
```

- `notify({ title, body?, key? })` — `{ notified: true }`를 돌려준다.
  - `title`은 필수이고 1~120자다. `body`는 일반 글이고 500자까지다. 앞뒤 공백은 지운다.
  - `key`는 선택이고 1~64자의 영문자·숫자·`_.:-`다. 같은 앱에 같은 `key`의 열린 알림이
    있으면 새 알림이 그것을 대신한다: 내용이 바뀌고, 맨 뒤로 옮겨지고, toast나 OS 알림이
    다시 뜬다. 30분마다 한도를 다시 확인하는 앱이 Inbox를 채우지 않게 한다. `key`가
    없으면 부를 때마다 알림이 하나 늘어난다.
  - 앱마다 열린 알림은 50개까지다. 넘으면 오래된 것부터 지운다.
  - 사람이 Inbox에서 지우면 사라진다. 지우지 않은 알림은 앱이나 lophn을 다시 켜도 남는다.
  - 알림을 누르면 이 앱이 열린다.
- `createNotifyClient({ host? })` — 시험이나 preview에서 host를 바꿔 끼운다. live가 아닌
  mode에서는 사람에게 닿지 않고 `{ notified: true, standIn: true }`만 돌려준다.
- 거절은 `CapabilityError`다. grant가 없으면 `forbidden`이고 `permission`은
  `notify.send`다. 입력이 한도를 넘으면 `invalid_input`이다.
- `checkDeclaration(declaration)` — 이 package를 쓰는 선언이 `notify.send`를 빠뜨렸는지
  검사한다.
- type: `NotifyClient`, `NotifyRequest`, `NotifyResult`, `CapabilityError`,
  `DeclarationCheck`

## 요구 permission

`notify.send` — scope는 없다(`scope: {}`). 선언하고 activation 때 사람이 허락해야 한다.

## peer 의존

없다(단독 사용).

## 예제

```ts
import { notify } from "@lophn/cap-notify";

// 선언: permissions에 { kind: "notify.send", scope: {}, reason: "한도가 낮으면 알린다" }
await notify({
  title: "Account X weekly limit is under 10%",
  body: "Resets on Monday.",
  key: "limit:account-x",
});
```

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
