# @lophn/cap-notify

## 목적

앱 process가 사람에게 알리는 client다. 알림은 사람의 Inbox에 한 줄로 남고 toast나 OS
알림으로도 뜬다. 받는 쪽은 사람뿐이다. agent에게 사실을 보내거나 lophn의 반응을
일으키는 길이 아니다. 앱 UI view(브라우저 쪽)에서는 부르지 못하고, command·
operation·flow·시작 코드에서 부른다. import는 grant를 주지 않는다.

## 공개 API와 type

```ts
import { clearTray, notify, setTray } from "@lophn/cap-notify";
```

- `notify({ title, body?, key?, persistent? })` — `{ notified: true }`를 돌려준다.
  - `title`은 필수이고 1~120자다. `body`는 일반 글이고 500자까지다. 앞뒤 공백은 지운다.
  - `key`는 선택이고 1~64자의 영문자·숫자·`_.:-`다. 같은 앱에 같은 `key`의 열린 알림이
    있으면 새 알림이 그것을 대신한다: 내용이 바뀌고, 맨 뒤로 옮겨지고, toast나 OS 알림이
    다시 뜬다. 30분마다 한도를 다시 확인하는 앱이 Inbox를 채우지 않게 한다. `key`가
    없으면 부를 때마다 알림이 하나 늘어난다.
  - `persistent`는 선택이고 기본은 `false`다. 휘발(`false`) 알림은 사람이 Inbox에서 지우면 사라지고 앱마다 50개까지다.
    영구(`true`) 알림은 지우면 읽음으로만 바뀌고 기록으로 남아 사람이 나중에 찾을 수 있다. 앱마다 최근 200개까지이고
    넘으면 오래된 것부터 지운다. 휘발과 영구의 상한은 따로 센다. 앱이 처리한 결과나 사람이 나중에 찾을 일(예: 한도 초과로
    멈춘 사실, 큰 작업이 끝난 사실)은 영구로, 곧 지나가는 상태(예: 남은 한도 경고)는 휘발로 남긴다. 같은 `key`로 다시 부르면
    `persistent`도 새 값으로 바뀐다.
  - 지우지 않은 알림은 앱이나 lophn을 다시 켜도 남는다. 앱을 보관하면 휘발 알림은 지워지고 영구 알림은 남는다.
  - 알림을 누르면 이 앱이 열린다.
- `setTray({ text, tone? })`, `clearTray()` — 작업 표시줄 tray에 보이는 값을 바꾸거나 지운다.
  - `text`는 1~16자의 짧은 글이고 앞뒤 공백은 지운다. `tone`은 `"neutral"`(기본), `"good"`, `"warn"`,
    `"bad"`이고 글 색이 된다.
  - 값은 앱마다 하나이고 마지막 값만 남는다. 사람이 Settings › Quick launch › Tray에서 이 앱의 `tray`
    자리 화면을 켜 두었을 때만 보인다. 누르면 그 화면이 popup으로 뜬다. 앱 UI view에서는 부르지 못한다.
  - 값은 core 메모리에만 있어 lophn을 다시 켜면 사라진다. 앱이 시작 코드에서 다시 낸다.
  - 앱 process가 시작 코드나 timer에서 부른다. 사용량 앱이 몇 분마다 값을 바꾸는 식이다(아래 예제).
- `createNotifyClient({ host? })` — 시험이나 preview에서 host를 바꿔 끼운다. live가 아닌
  mode에서는 사람에게 닿지 않고 `notify`는 `{ notified: true, standIn: true }`만 돌려주며 `setTray`와
  `clearTray`는 아무것도 하지 않는다.
- 거절은 `CapabilityError`다(`setTray`와 `clearTray`도 같다). grant가 없으면 `forbidden`이고 `permission`은
  `notify.send`다. 입력이 한도를 넘으면 `invalid_input`이다.
- `checkDeclaration(declaration)` — 이 package를 쓰는 선언이 `notify.send`를 빠뜨렸는지
  검사한다.
- type: `NotifyClient`, `NotifyRequest`, `NotifyResult`, `TrayRequest`, `TrayTone`, `CapabilityError`,
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

// 사람이 나중에 찾을 기록은 영구로 남긴다.
await notify({ title: "Weekly report was sent", persistent: true });
```

```ts
import { setTray } from "@lophn/cap-notify";

// 앱 process의 시작 코드. 값은 lophn을 다시 켜면 사라지므로 시작할 때 한 번 내고 주기로 갱신한다.
async function refresh() {
  const left = await readRemainingPercent();
  await setTray({ text: `${left}% left`, tone: left < 10 ? "bad" : "good" });
}
await refresh();
setInterval(() => void refresh().catch(() => {}), 5 * 60_000);
```

## version 정책

판마다 바뀐 점과 앱 code를 옮기는 법은 `migrate-sdk` skill의 메모 `<이름>-<판>.md`(예: `declaration-4.0.0.md`)에 있다(이 SDK의 판을 올리면 그 메모를 같이 쓴다).

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
