# mcp-failures

외부 MCP tool 호출의 실패 다섯을 고친다: stdio server process가 죽어도 연결이 `connected`로 남는 것(tools #37), 재연결 횟수가 영영 줄지 않는 것(#38), server의 `isError` 본문을 버리는 것(#14), 24 KiB를 넘는 MCP·extension 결과를 통째로 비우는 것(#7), 보낸 뒤 답을 못 받은 호출을 "tool is unavailable"로 뭉개는 것(#19의 MCP 쪽).

- 단위: tools (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/extensions/{mcp-connections,mcp-toolkit,mcp-tools}.ts`
  - `packages/core/lophn-agent/extensions/mcp-toolkit_test.ts`
  - `packages/core/lophn-agent/tools/extension-tools.ts`
  - `packages/core/lophn-agent/tools/{result,mod}.ts` (안 쓰게 되는 `limitJson`을 지우는 데만)
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md` 지키는 것 36·37(결과를 줄이는 것은 runtime의 일이고 결과는 버리지 않는다)과 비목표("앱과 MCP의 tool 결과를 감싸지 않는다"), `project-docs/architecture/approval.md` 지키는 것 3(MCP 판정과 연결 쪽 거절)과 "결과 본문을 믿는 문제" 줄
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`(boundary `lophn-agent`)
  - 계획 README "정한 것": "MCP `isError` 본문은 감싸지 않고 model에게 준다"
  - 조사(선택): main checkout의 `research_notes/error-handling-verify/tools-session.md` #7 #14 #19 #37 #38(commit하지 않아 worktree에는 없다. main checkout 절대 경로로 읽는다)
- 계약:
  - 쓰는 것: `ToolResult`(`packages/protocol/lophn-agent/tool-values.ts`의 `status`가 `success | failure | not_executed | uncertain`), spill 표시 `SpillableResult`(`packages/core/lophn-agent/tools/spill.ts`, `executeToolCall`이 `spillLarge`로 줄인다), `StdioSpawn.exited`(`packages/core/lophn-agent/extensions/adapters/mcp-stdio.ts`, 고치지 않는다)
  - 내놓는 것: 다른 task가 기대는 것은 없다. `McpToolCall`의 결과 꼴이 바뀌지만 쓰는 곳은 이 task의 file과 `packages/core/lophn-agent/run-loop/prepare.ts`의 type import뿐이다(prepare.ts는 고치지 않아도 된다)

## 할 일

순서는 #37 → #38 → #14 → #7 → #19다. 앞의 것이 뒤의 것이 기대는 상태를 만든다.

1. **stdio server 죽음 감지(#37), `mcp-connections.ts`.** 지금: stdio server process가 죽으면 `stdioTransport`의 읽기 loop가 기다리던 요청만 "pipe가 끊겼다"로 끝내고 `entry.state`는 `connected`로 남는다. 그래서 `call()`이 `no_connection`을 한 번도 내지 않고, `mcp-toolkit.ts`의 재연결 길(`no_connection` → `connections.reconnect` → `requery`)이 돌지 않으며, 그 뒤 모든 호출이 기한까지 기다렸다 `uncertain`으로 끝난다.
   - `McpTransport`에 `exited: Promise<string> | null`을 더한다. stdio는 `spawn.exited`가 풀리면 "MCP server process exited (code N)"(signal이면 signal 이름) 글로 풀리고, HTTP(`openHttp`)는 `null`이다.
   - `stdioTransport` 안에서 `spawn.exited`가 풀리면 아직 `pending`인 요청을 모두 err로 끝내고 비운다. 손자 process가 stdout pipe를 쥐고 있으면 읽기 loop가 끝나지 않으므로 exit를 따로 본다. 이 요청들은 이미 보냈으므로 `call()`에서 지금처럼 `uncertain`이 된다.
   - `connectOnce`에서 `entry.transport = transport`를 둔 뒤 `transport.exited`를 본다: 풀렸을 때 `entry.transport`가 아직 그 transport이면 `entry.transport = null`, `state`가 `connected`이면 `failed_temporary`로, `entry.error`에 그 글을 두고, `transport.close()`를 기다리지 않고 부른다(stderr와 자원 정리). `closeEntry`가 먼저 transport를 비웠으면 아무것도 하지 않는다.
   - 그러면 다음 `call()`은 `no_connection`이고 toolkit이 이미 있는 길로 다시 연결하고 목록을 다시 읽는다.
2. **재연결 횟수 reset(#38), `mcp-connections.ts`.** 지금: `entry.retryCount`가 `acquire`에서 만들 때만 0이고 `reconnect`마다 늘기만 해서, 한 assignment 동안 server가 세 번 죽으면 그 뒤로는 다시 붙지 않는다(`retryCount >= 3`이면 거절). `call()`에서 `tools/call`이 답을 받으면(`response.ok`, `isError`여도) `entry.retryCount = 0`으로 둔다. 시각 기반 reset은 두지 않는다. 상한의 뜻은 "답을 한 번도 못 받은 채 이어진 재연결 세 번"이 된다.
3. **`isError` 본문(#14), `mcp-connections.ts`·`mcp-toolkit.ts`·`mcp-tools.ts`.** 지금: server가 `isError: true`로 답하면 `call()`이 `{kind: "failure", code: "tool_error", message: "tool이 오류로 답했다"}`로 바꾸며 본문을 버리고, toolkit이 그것을 `unavailable`로, `executeToolCall`(`packages/core/lophn-agent/tools/work.ts`)이 "tool is unavailable"로 바꿔 model은 server가 무슨 오류를 냈는지 모른다.
   - `call()`은 `isError`여도 `{kind: "success", result}`를 돌려준다. `CallOutcome`의 `failure` 갈래는 이것 말고 내는 곳이 없으니 지우고, toolkit `call()`의 `sent.kind === "failure"` 갈래도 지운다.
   - `mcp-tools.ts`의 `invoke`가 결과의 `isError === true`를 보고 `status: "failure"`, `summary: "tool <tool> of server <server> returned an error"`, `content`는 server 결과 그대로인 `ToolResult`를 돌려준다. 감싸지 않는다(`wrapUntrusted` 등을 쓰지 않는다. approval.md가 MCP 결과를 감싸지 않기로 했다). handler가 `ok`로 돌려주므로 `executeToolCall`은 그 summary와 content를 그대로 model에 싣고 outcome은 `failure`다.
4. **큰 결과(#7), `mcp-tools.ts`·`tools/extension-tools.ts`.** 지금: 두 곳이 `limitJson`으로 24 KiB를 넘는 결과의 `content`를 `null`로 비우고 `spill` 표시가 없어, `spillLarge`가 전체를 file에 쓰지 않고 model은 빈 결과만 받는다.
   - `mcp-tools.ts` `invoke`(성공과 #14의 `isError` 둘 다)는 server 결과 전체를 `content`로 두고 `spill: { arrayKeys: [] }`를 단 `SpillableResult`를 돌려준다. `limitJson`을 쓰지 않는다.
   - `tools/extension-tools.ts` `resultOf`의 글 갈래도 이어 붙인 글 전체를 `content`로 두고 `spill: { arrayKeys: [] }`를 단다. 이미지 하나뿐인 갈래는 지금처럼 둔다(base64를 spill file로 보내지 않는다).
   - `limitJson`은 쓰는 곳이 없어진다. `packages/core/lophn-agent/tools/result.ts`의 함수와 `packages/core/lophn-agent/tools/mod.ts`의 re-export를 지운다.
5. **보낸 뒤 실패의 결과 불명(#19 MCP 쪽), `mcp-toolkit.ts`·`mcp-tools.ts`.** 지금: `call()`은 요청을 보낸 뒤의 실패(기한 초과, pipe 끊김, 중단)를 `uncertain`으로 내지만, toolkit이 `uncertain`과 `not_executed`를 똑같이 `err({code: "unavailable"})`로 바꿔 model은 "tool is unavailable"만 보고, `ToolResult.status`가 `uncertain`이 아니라 turn의 `unknown_effects`에도 오르지 않는다. 그래서 model이 결제·전송 같은 외부 호출을 그대로 다시 부른다.
   - `McpToolCall`(`mcp-tools.ts`)의 결과를 `Result<McpAnswer>`로 바꾼다. `McpAnswer = { kind: "answered"; result: unknown } | { kind: "uncertain" }`. 보내기 전 거절(재조회 중, 꺼진 server, 회수된 설정, 재연결 실패)은 지금처럼 err다.
   - toolkit `call()`: `sent.kind === "success"`면 `answered`, `uncertain`이면 `ok({kind: "uncertain"})`, `not_executed`는 지금처럼 err.
   - `invoke`: `uncertain`이면 `status: "uncertain"`, `summary: "The call to tool <tool> of server <server> was sent but no answer came back. It may have taken effect; check before calling it again."`, `content: null`인 결과를 돌려준다(`summary`는 schema상 400자 이하다. 이름이 길면 자른다). `executeToolCall`이 outcome을 `uncertain`으로 기록한다(재시도 규칙 `packages/core/lophn-agent/run-loop/retry.ts`는 이미 uncertain을 read tool만 다시 부른다).
   - `createMcpToolHandlers`도 같은 `invoke`를 쓰므로 따로 고칠 것이 없다.
6. test(아래 "끝남"의 위험 test)를 `mcp-toolkit_test.ts`에 더한다. 지금 file의 가짜 `McpConnections`가 아니라 진짜 `createMcpConnections`에 가짜 `openStdio`를 끼운다: `StdioSpawn` 꼴(`stdin`은 `WritableStream`, `stdout`은 `ReadableStream`, `exited`는 test가 푸는 promise)로 줄 단위 JSON-RPC에 `initialize`·`tools/list`·`tools/call`을 답하는 작은 가짜 server다. `wait`·`deadline`도 주입해 실제로 기다리지 않는다. process를 띄우지 않는다.

정한 것:
- stderr 끝을 `entry.error`나 model 문장에 싣지 않는다. `ConnectionView.error`를 보여 주는 곳이 지금 없고(`views()`는 `failed_auth`와 빈 secret 자리만 본다), model 문장에 server의 자유 글을 늘리지 않는다. 종료 code만 남긴다.
- spill의 `arrayKeys`는 빈 목록이다. MCP 결과는 대개 큰 text block 하나라, `content` 배열을 덜어 내는 `fitJson`은 그 block을 통째로 빼서 미리보기가 빈다. 빈 목록이면 미리보기가 pretty JSON의 머리다.
- uncertain을 err의 `details` 표시가 아니라 `McpToolCall` 결과 꼴로 나른다. 두 file 안의 type이고, 표시를 빼먹어도 컴파일이 잡는다.
- #38의 reset은 "답을 받은 `tools/call`"에서 한다. 시간이 지나면 reset하는 안은 죽기를 되풀이하는 server를 계속 다시 띄운다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "stdio MCP server process가 끝나면 다음 호출은 다시 연결해 실행되고 결과 불명으로 끝나지 않는다"
  - "보낸 뒤 기한 안에 답이 없는 MCP 호출은 uncertain으로 끝난다"
- 남지 않음: `grep -rn "limitJson" packages tests`가 0줄이다. `grep -rn "tool_error" packages/core/lophn-agent/extensions tests`가 0줄이다(`packages/protocol/lophn-agent/turn-values.ts`의 `tool_error`는 다른 값이라 남는다).

## 보고

`.claude/skills/orchestrate/brief-template.md` "보고" 꼴. **무겁게 짠 것**과 **알려진 미완 동작**을 빠뜨리지 않는다. 바뀐 model-facing 동작(isError 본문, uncertain 문장, spill된 MCP 결과)을 lead가 `project-docs/architecture/agent-definition.md`에 옮길 수 있게 한 줄씩 적는다.
