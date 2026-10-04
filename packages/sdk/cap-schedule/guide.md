# @lophn/cap-schedule

## 목적

직접 명령과 automation의 같은 handler 등록, 실제 invocation 문맥, log 문맥, 실제
통계 요약, 오류 상세, 처리되지 않은 예외 수집을 제공한다(apps/sdk#R27). 별도 job
구현 없이 앱 호출과 비동기 callback의 출처를 잇는다.

## 공개 API와 type

```ts
import {
  command,
  currentContext,
  runWith,
  traceName,
} from "@lophn/cap-schedule";
```

- `command(definition)` — 명령 handler를 등록한다. automation도 같은 handler를
  쓴다.
- `runWith(context, work)` — invocation 문맥 안에서 업무를 돌린다.
- `currentContext()` — 현재 invocation 문맥(앱·release·mode·invocation)을
  읽는다.
- `registeredCommands()` — 등록된 handler 목록이다.
- `traceName(name)` — 내부 trace 이름을 만든다(최대 64자,
  `TRACE_NAME_MAX_CHARS`).
- `readResult(source, query)` — 읽기 명령 결과를 coverage·freshness와 함께
  돌려준다.
- type: `InvocationContext`, `RegisteredHandler`, `SchedulePort`, `ReadQuery`,
  `ReadSource`, `ReadCoverage`, `ReadFreshness`, `ReadContinuation`

## 요구 permission

없다. handler 등록과 문맥 전달은 앱 프로세스 안의 일이다.

## peer 의존

정확한 peer는 없다(단독 사용).

## 예제

```ts
import { command, runWith } from "@lophn/cap-schedule";

command({
  key: "usage.sync",
  async handler(input, context) {
    await runWith(context, () => sync());
  },
});
```

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
