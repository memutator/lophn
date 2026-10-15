# @lophn/cap-schedule

## 목적

command handler 등록, 실제 invocation 문맥, log 문맥, 실제 통계 요약, 오류 상세,
처리되지 않은 예외 수집을 제공한다(apps/sdk#R27). 별도 job 구현 없이 앱 호출과
비동기 callback의 출처를 잇는다.

## 공개 API와 type

```ts
import {
  command,
  currentContext,
  runWith,
  traceName,
} from "@lophn/cap-schedule";
```

- `command(name, handle)` — blueprint에 선언한 command key의 handler를 등록한다.
  handler는 입력 하나를 받고 결과를 돌려주거나 `CommandRejection`을 던진다.
- `runWith(context, work)` — invocation 문맥 안에서 업무를 돌린다.
- `currentContext()` — 현재 invocation 문맥(앱·release·mode·invocation)을
  읽는다.
- `registeredCommands()` — 등록된 handler 목록이다.
- `traceName(name)` — 내부 trace 이름을 만든다(최대 64자,
  `TRACE_NAME_MAX_CHARS`).
- `readResult(source, query)` — 읽기 명령 결과를 coverage·freshness와 함께
  돌려준다.
- `withRevert(result, { receipt, revision })` — 되돌리기를 지원하는 write
  command의 성공 값을
  `{result, revert:{invocation, receipt, expected_revision}}`로 만든다.
  `receipt`는 변경 직전 상태를 가리키는 앱 내부 참조, `revision`은 변경 직후 앱
  revision(양의 정수 문자열)이다. handler가 이 값을 돌려주면 lophn이 command
  결과의 `revert`로 올린다. invocation이 없는 실행(release 없는 preview)은
  `revert`가 빠진다.
- `CommandRejection(code, message)` — handler가 효과 전에 호출을 받지 않겠다고
  알린다(`invalid_input|forbidden|conflict|unavailable`). 안내 문장에 입력·상태
  값을 넣지 않는다.
- `connectAppCommands(app, commands)` — 다른 앱의 command를 쓰는 client를
  준비한다(apps/sdk#R40). 쓸 수 있는 command는 blueprint `app_connections` 선언
  ∩ 사람이 허락한 앱 쌍 ∩ 대상 앱의 현재 command다. 돌려주는 client의
  `call(command, input?, {requestKey?, proof?})`는 대상 앱의 같은 handler·입력
  검사·confirm 규칙으로 간다. 현재 invocation이 부모로 전달되고 호출자 신원은
  lophn이 정한다. 전송이 끊기면 `{kind: "unknown"}`이고 자동으로 다시 부르지
  않는다. 허락 없는 앱·command는 없는 것처럼 거절된다. 대상 command가
  confirm=true면 `call`이 사람 확인 흐름(approval 요청 → 짧은 poll로 대기 →
  서명된 proof)으로 가서 같은 입력으로 다시 보낸다. `confirm: true`로 처음부터
  그 흐름을 쓰고, `confirmTimeoutMs`(기본 5분)를 넘으면 unavailable이다.
- type: `InvocationContext`, `RegisteredHandler`, `SchedulePort`, `ReadQuery`,
  `ReadSource`, `ReadCoverage`, `ReadFreshness`, `ReadContinuation`,
  `RejectionCode`, `AppCommandsClient`, `AppCommandOutcome`, `AppResult`

## 요구 permission

handler 등록과 문맥 전달은 요구 permission이 없다. `connectAppCommands`는
import만으로 아무것도 열지 않는다. blueprint `app_connections`에 대상 앱과
command와 목적을 선언하고 사람이 방향 있는 앱 쌍과 command 범위를 허락해야 한다.

## peer 의존

정확한 peer는 없다(단독 사용).

## 예제

```ts
import { command } from "@lophn/cap-schedule";

command("usage.sync", async (input) => {
  return await sync(input);
});
```

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
