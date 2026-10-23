# bs-agent-gate

session 도중 사람이 끈 MCP server의 tool을 부를 때 거절하고, shell 물음을 사람이 이유를 적어 거절하면 그 이유가 agent의 tool 결과에 실리게 한다. `project-docs/issues/approval.md`의 두 이슈를 고친다.

- 단위: agent (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/extensions/mcp-toolkit.ts`
  - `packages/core/lophn-agent/extensions/mcp-toolkit_test.ts`
  - `packages/core/lophn-agent/tools/work.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/approval.md`("묻는 길"의 "거절 이유는 agent에게 그대로 간다"), `project-docs/architecture/agent-definition.md`(tool 목록 고정과 notice)
  - 이슈: `project-docs/issues/approval.md` 두 항목("지금", "고치려면"의 추천안)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`(boundary `lophn-agent`)
  - 계획: `project-docs/plan/bug-sweep/README.md`의 "위험 test"
- 계약:
  - 쓰는 것: `McpSourceOptions`·`McpToolkit.call(session)`(`packages/core/lophn-agent/run-loop/prepare.ts`), `ToolGateResult`의 `rejected`(`reason: string | null`, `packages/protocol/approvals/tool-gate.ts`). 둘 다 바꾸지 않는다.
  - 내놓는 것: 없음(동작만 바뀐다).

이슈와 코드가 어긋난 곳(중요): 이슈는 `call()`이 "session 시작 때 고정한 server 상태만 본다"고 하지만 지금 코드는 조금 다르다. `prepare.ts`가 turn을 시작할 때마다 `kit.source(session, options)`를 부르고, `source()`가 session의 `known` 표를 비우고 그 turn의 합친 server 목록(`mcp_off`가 이미 빠진 것)으로 다시 채운다. 그래서 꺼진 server는 **다음 turn부터는** `call()`의 `known` 검사("서버 설정이 등록되어 있지 않다")에 이미 걸린다. 뚫려 있는 곳은 **도는 turn 안**(한 turn에 tool을 여러 번 부르거나 오래 도는 unattended turn)이다. 아래 1번은 그 틈을 막는다. 또 `mcp_off`는 layer(project 설정의 `mcp_off`, agent 정의의 `off`)별로 있는데 call 때 다시 읽을 수 있는 것은 전역·project 층뿐이다(agent 정의 층은 turn 시작에 정한 값 `options.agent`를 쓴다). 이 한계는 보고의 "알려진 미완 동작"에 적는다. 그 밖의 설명(`serversOf`, `mcp_off`를 `detach`하는 곳이 없음, `toolsNotice`)은 맞다. `work.ts`의 `rejected` 갈래는 이슈의 197-203줄이 지금 197-205줄 근처다.

## 할 일

1. **MCP `call()`이 부를 때 지금 층을 읽는다 (`mcp-toolkit.ts`).**
   - `createMcpToolkit` 안에 `source()`가 받은 `options`를 session(assignment)별로 기억하는 표(`known`과 같은 꼴)를 둔다.
   - `makeToolkit`의 `call()`이 돌려주는 함수에서, 연결을 쓰기 전(상태 `stateOf` 검사와 `known` 검사 사이나 뒤)에 `serversOf(options.place ?? null, options.agent)`를 다시 읽는다. 읽기가 실패하면 거절한다(fails closed). 결과에 `invoke.server`가 없거나 `enabled`가 아니거나 `options.skip`에 있으면 거절한다: `err({ code: "unavailable", message: "..." })`로 "server was turned off"를 뜻하는 글을 준다(`mcp-tools.ts`의 `invoke`가 모든 err를 `unavailable`+message로 tool 결과에 싣는다). 거절은 연결을 끊거나 `detach`하지 않는다.
   - 근거: `project-docs/issues/approval.md` 첫 항목의 추천안(call마다 설정 읽기가 하나 는다). 앱 tool이 call 때 지금 할당을 읽는 것과 같은 꼴이다.
2. **shell 거절 이유 (`work.ts`의 `askGate`, `case "rejected"`).** `result.reason`이 비어 있지 않으면 summary를 `the person rejected this tool call: <reason>`로 한다. `null`이거나 빈 문자열이면 지금 글 그대로다. `outcome`(`not_executed`/`rejected`)은 그대로 둔다. `denied`처럼 이유를 이미 붙이는 갈래의 꼴을 따른다.
3. **test.** 아래 위험 test 하나를 `mcp-toolkit_test.ts`에 더한다. work.ts 거절 이유는 test를 두지 않는다(위험이 아니다).
4. 문서(`approval.md`, `agent-definition.md`)는 lead가 고친다. 이 task는 문서를 고치지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`packages/core/lophn-agent/extensions/mcp-toolkit_test.ts`): "session 도중 끈 MCP server의 tool은 그 session에서 부르면 거절된다." 방법: 이 file의 가짜(`toolkit()` helper의 `machine`·`connections`)를 쓴다. `machine`이 읽는 설정을 변수로 바꿀 수 있게 하고(필요하면 `settings`를 바꾸는 쪽을 helper에서 꺼낸다. project 층의 `mcp_off`를 보려면 `machine`이 route 이름으로 갈라 `projectExtensionSettingsRead`에 `{ mcp_servers: [], mcp_off: ["shared"] }`를 주게 한다), `source("asg", { place })`를 부른 뒤 설정을 끈 상태로 바꾸고 `call()`을 부르면 `ok: false`이다. 끄기 전에는 같은 호출이 가짜 `connections.call`의 성공을 돌려주는 것으로 거절이 설정 변화 때문임을 함께 본다. 실제 MCP server나 subprocess는 띄우지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 정한 것: 거절 message, 기억한 options의 범위
- 알려진 미완 동작: agent 정의 층의 `mcp_off`는 turn 시작 값이다(위 설명). 없으면 "없음"
- 무겁게 짠 것 (없으면 "없음")
