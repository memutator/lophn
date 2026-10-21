# @lophn/cap-problem

## 목적

앱이 실패 분기를 이름과 내용으로 앱 log에 error 한 줄로 남긴다. 추가
permission이 필요 없다.

- 줄 꼴은 `error <name>[: <message>][ <details JSON>]`이다. invocation 안에서
  부르면 머리에 `[inv=<id>]`가 붙는다. 줄은 redaction한 뒤 300자로 잘린다. App
  Engineer와 coding agent는 앱 log에서 이 줄을 찾는다.
- 이름은 원인을 말하고 안정적이다. id나 시각처럼 바뀌는 값을 넣지 않는다. 바뀌는
  값은 `details`에 둔다.
- 쓸 곳: 거절로 끝나는 업무 분기, 외부 호출 실패, 조용히 넘어가는 fallback.
- 쓰지 않을 곳: 잡히지 않은 예외와 handler가 던진 `Error`. 앱 진입점이 앱 log에
  저절로 쓴다.

## 공개 API와 type

```ts
import { createExceptionObserver, reportProblem } from "@lophn/cap-problem";
```

- `reportProblem(name, message?, details?)` — 앱 log에 error 한 줄을 쓴다.
  - `name`은 원인 이름이다. 선언해 둘 필요는 없다.
  - `message`는 이번 발생을 설명하는 글이다. 선택이다.
  - `details`는 JSON으로 보낼 수 있는 값이다. 선택이다.
  - 돌려주는 것이 없고 던지지 않는다. 줄바꿈은 공백으로 바뀐다.
- `createExceptionObserver(deps)` — 처리되지 않은 예외를 모아 보낸다. 앱
  진입점이 설치하고 앱 code는 부르지 않는다.
- type: `ExceptionObserver`, `ExceptionObserverDeps`

## 요구 permission

없다.

## peer 의존

정확한 peer는 없다(단독 사용).

## 예제

```ts
import { reportProblem } from "@lophn/cap-problem";

reportProblem("sync_server_unreachable", "sync failed", {
  command: "sync",
  attempt: 3,
});
```

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
