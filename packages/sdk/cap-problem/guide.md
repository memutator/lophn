# @lophn/cap-problem

## 목적

앱이 자기 문제를 이름과 message로 보고한다. 추가 permission이 필요 없다. 같은
앱이 같은 이름으로 보고하면 한 문제로 묶인다. problem을 직접 닫거나 상태를
바꾸는 API는 없다.

## 이름으로 묶기

- 같은 앱이 같은 이름으로 보고하면 한 문제로 묶인다. 원인이 다르면 이름을
  나눈다.
- 이름은 원인을 말하고 안정적이다. id나 시각처럼 바뀌는 값을 넣지 않는다.
  바뀌는 값은 `details`에 둔다.
- 보고할 곳: 거절로 끝나는 업무 분기, 외부 호출 실패, 조용히 넘어가는 fallback.
- 보고하지 않을 곳: 잡히지 않은 예외와 handler가 던진 `Error`. 앱 진입점이
  저절로 보고한다.

## 공개 API와 type

```ts
import {
  createExceptionObserver,
  createProblemReporter,
  reportProblem,
} from "@lophn/cap-problem";
```

- `reportProblem(name, message, details?)` — 앱 code가 문제를 보고한다.
  - `name`은 문제를 묶는 key다. 1~120자이고 공백만이거나 제어 문자가 있으면 안
    된다. 선언해 둘 필요는 없다.
  - `message`는 이번 발생을 설명하는 글이다. 공백만이면 안 된다.
  - `details`는 JSON으로 보낼 수 있는 값이다. 선택이다.
  - `{ report_id, completion }`을 돌려주고 업무 응답을 막지 않는다. transport는
    앱 진입점이 설치한 reporter가 쥐고 있어 앱 code는 모른다. 진입점이
    reporter를 설치하지 않은 곳(단위 test)에서는 보내지 않고 `completion`이 실패
    값으로 끝난다. 이름이나 message가 올바르지 않아도 던지지 않고 실패 값으로
    끝난다.
- `installProblemReporter(reporter)` — 진입점이 transport를 넣어 만든 reporter를
  설치한다. 앱 code는 부르지 않는다.
- `createProblemReporter(deps)` — 이름과 message 보고 client를 만든다.
- `createExceptionObserver(deps)` — 처리되지 않은 예외를 모아 보낸다. 오류
  이름이 없거나 비면 `UnknownError`로 보낸다. 처리되지 않은 오류는 오류 이름과
  앱 source 위치로 묶인다.
- type: `ProblemReporterDeps`, `ExceptionObserver`, `ExceptionObserverDeps`

## 요구 permission

없다.

## peer 의존

정확한 peer는 없다(단독 사용).

## 예제

```ts
import { reportProblem } from "@lophn/cap-problem";

const reported = reportProblem(
  "sync_server_unreachable",
  "서버에 연결하지 못해 동기화를 건너뛰었다",
  { command: "sync", attempt: 3 },
);
await reported.completion;
```

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
