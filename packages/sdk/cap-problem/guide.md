# @lophn/cap-problem

## 목적

추가 permission 없이 자기 앱의 선언 code로 보고·해소 주장·변경 메모를
전달한다(apps/sdk#R26). problem을 직접 닫는 API는 제공하지 않는다.

## 공개 API와 type

```ts
import {
  createExceptionObserver,
  createProblemReporter,
  reportProblem,
} from "@lophn/cap-problem";
```

- `reportProblem(code, details?)` — 앱 code가 선언 code로 보고한다.
  `{ report_id, completion }`을 돌려주고 업무 응답을 막지 않는다. transport는 앱
  진입점이 설치한 reporter가 쥐고 있어 앱 code는 모른다. 진입점이 reporter를
  설치하지 않은 곳(단위 test)에서는 보내지 않고 `completion`이 실패 값으로
  끝난다.
- `installProblemReporter(reporter)` — 진입점이 transport를 넣어 만든 reporter를
  설치한다. 앱 code는 부르지 않는다.
- `createProblemReporter(deps)` — 선언 code의 보고·해소 주장·변경 메모 전달
  클라이언트를 만든다.
- `createExceptionObserver(deps)` — 처리되지 않은 예외를 선언 code 보고로
  모은다.
- type: `ProblemReporterDeps`, `ExceptionObserver`, `ExceptionObserverDeps`

## 요구 permission

없다. 자기 앱의 선언 code 보고는 추가 permission을 요구하지 않는다.

## peer 의존

정확한 peer는 없다(단독 사용).

## 예제

```ts
import { reportProblem } from "@lophn/cap-problem";

// blueprint problem_codes에 선언한 code만 보고한다. code는 문자열 literal이다.
const reported = reportProblem("sync_failed", { command: "sync" });
await reported.completion;
```

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
