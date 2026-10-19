# @lophn/cap-app-api

## 목적

tool handler 등록, 실제 invocation 문맥, 읽기 결과 모양, 다른 앱의 tool 호출을
제공한다. 모든 tool 호출은 core를 거치고, 앱 process는 core가 보낸 호출을
handler로 돌려준다.

## 공개 API와 type

```ts
import { currentContext, runWith, tool, traceName } from "@lophn/cap-app-api";
```

- `tool(name, handle)` — blueprint `tools`에 선언한 `name`의 handler를 등록한다.
  같은 이름을 두 번 등록하면 던진다. handler는 입력 하나를 받고 결과를
  돌려주거나 `ToolRejection`을 던진다.
- `runWith(context, work)` — invocation 문맥 안에서 업무를 돌린다.
- `currentContext()` — 현재 invocation 문맥(앱·release·mode·invocation·부른
  쪽)을 읽는다.
- `registeredTools()` — 등록된 tool 이름 목록이다.
- `traceName(name)` — 내부 trace 이름을 만든다(최대 64자,
  `TRACE_NAME_MAX_CHARS`).
- `readResult(source, query)` — 읽기 tool 결과를 coverage·freshness와 함께
  돌려준다.
- `ToolRejection(code, message)` — handler가 효과 전에 호출을 받지 않겠다고
  알린다(`invalid_input|forbidden|conflict|unavailable`). 안내 문장에 입력·상태
  값을 넣지 않는다.
- `connectTools(app, tools)` — 다른 앱의 tool을 부르는 client를 준비한다.
  `callTool(name, input?)`은 core를 거쳐 간다. 열지 않은 이름은 `forbidden`
  결과다. 현재 invocation이 부모로 자동으로 붙고 부른 쪽의 신원은 core가 정한다.
  돌려주는 `{ invocation, outcome }`의 `outcome`은 `succeeded`, `failed`(대상
  handler 오류), `denied`(Gate 막음 등 handler까지 가지 못함), `unknown`(결과
  모름) 가운데 하나다. `unknown`은 자동으로 다시 부르지 않는다. 호출 자체가
  실패하면 `ok: false`다.
- type: `InvocationContext`, `AppApiCaller`, `RegisteredHandler`, `ReadQuery`,
  `ReadSource`, `ReadCoverage`, `ReadFreshness`, `ReadContinuation`,
  `RejectionCode`, `ToolClient`, `ToolOutcome`, `ToolCallOutput`, `AppResult`

## write와 DB 변경

write·external tool이 도는 동안 SDK가 앱 DB 변경을 changeset으로 떠서 core에
돌려준다(rewind가 쓴다). 앱은 `@lophn/cap-store`가 주는 DB 연결 하나만 쓴다.
read tool은 DB를 바꾸지 않는다고 선언을 믿는다.

## 요구 permission

handler 등록과 문맥 전달은 요구 permission이 없다. `connectTools`는 import만으로
아무것도 열지 않는다. blueprint `app_connections`에 대상 앱과 tool과 목적을
선언하고 사람이 방향 있는 앱 쌍과 범위를 허락해야 한다.

## peer 의존

정확한 peer는 없다(단독 사용).

## 예제

```ts
import { tool } from "@lophn/cap-app-api";

tool("usage.sync", async (input) => {
  return await sync(input);
});
```

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
