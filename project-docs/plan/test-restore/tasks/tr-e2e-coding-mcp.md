# tr-e2e-coding-mcp

새 e2e flow 하나: coding agent가 coding token으로 core MCP endpoint(`POST /mcp`)를 불러 자기 앱 preview의 tool을 부른다. 호출은 preview로만 가고 live 앱에는 가지 않는다(live ledger와 data가 그대로다).

- 단위: e2e (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/e2e/app-release_test.ts`
  - `tests/support/app/activate.ts`
  - `tests/support/coding/mcp.ts` (새 file. token으로 `/mcp`를 부르는 helper)
  - 제품 bug일 때만: `packages/core/apps/mcp/`, `packages/core/apps/preview/`
- 읽을 것:
  - AGENTS.md, `.claude/skills/write-test/SKILL.md`
  - architecture: `project-docs/architecture/testing.md`("앱 길", "case 고르는 규칙", "E2E 실행 폴더"), `project-docs/architecture/coding-agent.md`("지키는 것"의 첫 항목: CLI와 MCP endpoint, preview만), `project-docs/architecture/app-call.md`(61~64줄: MCP tools/list·tools/call, `previewOnly`, preview는 invocation을 남기지 않는다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `coding-agent-mcp`·`app-runtime`·`app-data`·`external-coding-agent`, `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 코드: `packages/core/apps/mcp/serve.ts`(`createCodingMcpTools`, `NO_PREVIEW`), `packages/core/apps/mcp/serve_test.ts`(이미 가짜 deps로 보는 것), `packages/core/server/mcp.ts`(`createMcpEndpoint`), `packages/core/server/server.ts`(`CODING_MCP_PATH` 분기), `packages/core/apps/preview/service.ts`(`start`·`get`·`current`), `packages/core/server/identity/coding-token.ts`(`CODING_TOKEN_OPERATIONS`)
  - 본보기: `tests/e2e/app-release_test.ts`의 첫 test, `tests/support/app/activate.ts`의 `handOff`, `tests/e2e/coding_test.ts`의 `unclaimed-end` 행(터미널 끝 → Project Manager 알림 turn)
- 계약:
  - 쓰는 것: `packages/protocol/coding-agent/mcp.ts`, `packages/protocol/apps/previews.ts`의 `previewsStart`·`previewsGet`, coding token은 Gateway `coding_terminal` frame의 `plan.env`로만 받는다(testing.md "앱 길")
  - 내놓는 것: `activate.ts`는 고치지 않는다(있는 `handOff`로 된다). 고쳐야 하면 export 이름과 모양은 그대로 두고 더하기만 한다. 다른 e2e task와 `tests/eval/restore/`가 이 file을 import한다

## 할 일

자리와 길(정한 것): `deliverRelease`의 token은 첫 release가 activate되기 전에 `exitTerminal`로 회수된다. live 앱이 돌고 token이 살아 있는 때가 필요하므로, 첫 test에서 `Notes`가 live로 뜬 뒤(지금 117~122줄의 live `list_items` 호출 뒤, 126줄 `first.gateway.close()` 앞) `handOff`로 같은 앱에 coding session을 하나 더 연다. 새 앱도 새 core도 띄우지 않는다. 그래서 `activate.ts`는 고치지 않을 것으로 본다. 고쳐야 하면 더하기만 한다.

1. `tests/support/coding/mcp.ts`(새 file): helper 하나 `mcpRequest(core: Core, token: string, method: string, params?: unknown): Promise<{ status: number; body: unknown }>`.
   - `POST ${core.baseUrl}${CODING_MCP_PATH}`, header `authorization: Bearer <token>`, `content-type: application/json`, `mcp-protocol-version: MCP_PROTOCOL_VERSION`(둘 다 `packages/protocol/coding-agent/mod.ts`). Origin header는 넣지 않는다.
   - body는 `{ jsonrpc: "2.0", id: 1, method, params }`. server는 상태가 없어(`createMcpEndpoint`) id를 셀 필요가 없다. 응답 body는 늘 끝까지 읽는다(자원 정리 검사).
   - 근거: `packages/core/server/mcp.ts`. 결과는 JSON-RPC `result`이고, 앱 실패와 preview 없음은 오류가 아니라 `result.isError: true`다. 모르는 tool은 `error.code -32602`, 거절(token 범위)은 HTTP 오류 body다.
2. `tests/e2e/app-release_test.ts`의 첫 test를 `async (t)`로 바꾸고, 위 자리에 step 하나를 넣는다: `await t.step("coding-mcp-preview-only: coding agent의 MCP 호출은 그 앱의 preview에만 닿고 live ledger와 data는 그대로다", ...)`. step으로 두면 출력에 step 시간이 따로 찍혀 10초 예산을 잴 수 있다. 단계(6 이하):
   1. `const handed = await handOff(core, fake, first, { goal: "Check the app tools on a preview" })`. `handed.token`, `handed.terminal`만 쓴다. `handed.call`은 journal의 첫 `tc_call` 결과라 앞 맡기기의 call id일 수 있으니 쓰지 않는다. 같은 Project Manager session에서 provider tool id(`tc_create`·`tc_call`)가 다시 나와도 core의 tool call id는 새로 만든다(`packages/core/lophn-agent/run-loop/core-ports.ts`의 `newId("tcl")`, `app-activation_test.ts`가 같은 session에 `deliverRelease`를 여러 번 부르며 통과한다).
   2. live invocation 수를 먼저 센다: `(await core.call(appInvocations, { app: first.app })).invocations.length`(`packages/protocol/apps/mod.ts`).
   3. preview 없이 MCP: `initialize` → `tools/list` → `tools/call {name: "add_item", arguments: {title: "from preview"}}`. 마지막은 `result.isError === true`이고 `result.content[0].text`가 `unavailable:`로 시작한다(`NO_PREVIEW`). 이때 tools/list는 활성 release의 선언이다.
   4. preview 시작은 coding agent의 길로 한다: `const cli = codingCli(core, handed.token)`, `cli.run("app preview start", { input: { app: first.app, bundle_hash: record.bundle_hash, release: delivered.release, fixture_hash: null } })` → `process_nonce`. `record`는 위에서 읽은 `releasesGetRecord` 결과다(release와 bundle이 맞지 않으면 `conflict`). `until("preview가 ready", ...)`로 `core.call(previewsGet, { app: first.app, process_nonce })`의 `observation?.ready`를 기다린다.
   5. preview로 MCP: `tools/call add_item {title: "from preview"}`(isError 없음), `tools/call list_items`(arguments 없이. `inputSchema: null` tool이다) → `structuredContent.rows`의 title에 `"from preview"`가 있다.
   6. 정리: `cli.run("app preview stop", { app: first.app, process_nonce })`. `const turn = (await turnsOf(core, first.ae)).length`, `exitTerminal(core, handed.terminal)`, `waitTurnEnd(core, first.ae, turn)`. 보고 없는 끝의 알림 turn은 `handOff`가 줄에 미리 건 `noted`가 받는다(`scriptAe`의 `text` 꼬리).
3. 단정 셋(서로 다른 곳, testing.md 규칙 4):
   - MCP 응답: tools/list의 이름이 `["add_item", "list_items"]`(정렬해서), preview 없는 호출이 `unavailable:`, preview의 `list_items`에 `"from preview"`.
   - ledger: 6 뒤에 다시 센 `app.invocations` 수가 2에서 센 수와 같다(preview 호출은 invocation을 남기지 않는다. app-call.md 59줄).
   - live data: 그 다음에 live `appCallTool`(`target: { mode: "live", app: first.app, release: null }`, `tool: "list_items"`)의 rows에 `"from preview"`가 없다. 이 호출은 invocation을 하나 더하므로 ledger 단정 뒤에 한다.
   - fake 대답: 행 몫은 0이다(`handOff`가 거는 것만 쓴다).
4. 머리 주석에 이 step의 세 질문을 한 덩이로 더한다(testing.md 규칙 1).
   - contract: `coding-agent-mcp`(MCP tools/call은 token 앱의 지금 도는 preview로만 가고, 없으면 `unavailable`이며 live는 어떤 경우에도 부르지 않는다), `app-data`(live data와 ledger).
   - 현실적 회귀: preview가 없거나 ready 전일 때 호출이 live로 떨어진다, preview 호출이 live ledger나 live process로 간다(target·`previewOnly` 섞임), coding token의 operation 목록에 `coding.mcp`가 빠져 실제 token으로는 endpoint가 닫힌다, server가 `/mcp`를 route하지 않는다.
   - 왜 지금 test로 못 잡나: `serve_test.ts`는 preview와 호출 길을 가짜 deps로 끼운다. 실제 token 발급(Gateway frame) → server 인증 → 앱 호출 길 → supervisor의 preview process는 process를 건너야 보인다.
5. 제품 bug를 찾으면(규칙 8) test를 맞추지 않는다. `packages/core/apps/mcp/`, `packages/core/apps/preview/`에서 고친다. 원인이 `packages/core/main/daemon/wiring/coding-mcp.ts`(wiring은 lead만 고친다)나 그 밖이면 고치지 말고 보고의 "계약 바꾸기 요청"에 file과 줄을 적는다.
6. 정한 것(보고에 옮긴다): MCP 주소는 `core.baseUrl + CODING_MCP_PATH`로 짓는다. plan argv의 `--mcp-config`를 읽는 것은 이 flow의 단정이 아니고 `handOff`의 반환에 칸을 더해야 한다. 다른 앱 token으로 tools/list를 막는 행은 두지 않는다(`serve_test.ts`와 `coding_test.ts`의 `other-app`이 token 범위를 본다).

## 끝남

- `deno task check:full`이 통과한다.
- `deno task e2e:deps`를 한 번 돌린 뒤 `deno test --allow-all --no-check tests/e2e/app-release_test.ts`가 10번 연속 통과한다. 끝난 뒤 `/tmp/lophn-e2e-*`와 core process(`pgrep -f packages/core/main/daemon/main.ts`)가 남지 않는다.
- 시간: 출력의 `coding-mcp-preview-only` step이 10초 안이다. file 전체는 지금 33초(log)에서 10초 넘게 늘지 않는다.
- 위험 test: "coding agent의 MCP tools/call은 preview가 없으면 unavailable이고, preview가 있으면 그 preview에만 닿아 live invocation과 live data가 그대로다"(이 e2e step). 새 unit test는 없다(`serve_test.ts`가 판정을 이미 본다).
- 남지 않음: `git diff --stat main -- tests/support/app/activate.ts`가 0줄이거나 더한 줄뿐이다.

## 보고

- 바꾼 file
- 통과한 check, 10번 돌린 결과와 step 시간
- 등록할 것: `project-docs/architecture/testing.md`의 `tests/support` 표 `coding/` 줄에 `mcpRequest`, 앱 길 절에 MCP preview step 한 줄(lead가 계획 끝에 고친다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 위 할 일 6과 worker가 더 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: `activate.ts`의 모양을 바꿔야 하거나 wiring에 bug가 있으면 여기 적는다
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
