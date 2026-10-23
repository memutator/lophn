# defer-by-tool

숨김을 role별 목록에서 tool 정의의 `defer: true`로 옮기고, 앱 tool도 숨기고, `tool.load`가 묶음 이름을 받게 하고, 불러온 tool이 session 동안 남게 한다. wave 1이 남긴 role별 숨김 코드는 모두 지운다.

- 단위: deferred-tools (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/tool-lists.ts`
  - `packages/core/main/agent-tools.ts`
  - `packages/core/main/agent-tools_test.ts`
  - `packages/core/main/agent-runtime/product-driver.ts`
  - `packages/core/lophn-agent/tools/` (`tools/app-tool/`는 빼고. `app-tool-names` task가 가진다)
  - `packages/core/lophn-agent/run-loop/`
  - `packages/core/lophn-agent/prompt-assembly/`
  - `packages/core/lophn-agent/session/` (이력 재료를 읽는 곳을 고쳐야 할 때만)
  - `packages/core/lophn-agent/models/binding.ts`
  - `packages/core/lophn-agent/providers/definitions.ts`
  - 추가 소유(해당 tool 정의에 `defer: true` 한 줄만): `packages/core/workflows/agent-tools.ts`(`workflow.list`, `workflow.check`), `packages/core/apps/agent-tools/release.ts`(`release.list`, `release.get`), `packages/core/apps/agent-tools/visual.ts`(`visual.show`), `packages/core/apps/agent-tools/package.ts`(`package.publish`), `packages/core/domains/agent-tools.ts`(`domain.list`, `domain.get`), `packages/core/jobs/agent-tools.ts`(`job.*` 넷), `packages/core/agent-roles/tools/operator.ts`(`operator.update`)
- 읽을 것:
  - 계획: `project-docs/plan/deferred-tools/README.md`의 "지금"과 "정한 것" 전부. 이 brief보다 앞선다.
  - architecture: `project-docs/architecture/agent-definition.md`(흐름, cache 표시, 44·45줄)
  - Claude Code 조사: `/home/pyosechang/projects/rea/project/claude-code/search-tool/README.md`, `source/deferral-policy.js`(`shouldDefer`, `alwaysLoad`), `source/discovered-tools.js`(이력에서 불러온 이름을 모으는 곳)
  - Anthropic [Tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)의 "Continuing the conversation": API는 이력 전체의 `tool_reference`를 펼친다.
  - wave 1 diff: `git show 137e011a1`
- 계약:
  - 쓰는 것: `ToolDefinition`과 `defineTool`(`tools/registry.ts`, `tools/define.ts`, `tools/spi.ts`), dispatch `executeToolCall`(`tools/work.ts`, 바꾸지 않는다), 결과 조각 `tool_result_reference`(`prompt-assembly/model.ts`)
  - 내놓는 것: `ToolDefinition.defer?: true`, `tool.load` 입력 `{names: string[1..20]}`(wire 이름이나 묶음 이름)

## 할 일

1. **숨김을 tool의 성질로(정한 것 1).**
   - `ToolDefinition`에 `defer?: true`를 더하고 `defineTool`이 받게 한다. 주석 한 줄: Claude Code의 `shouldDefer`와 같고, 모든 role에 같다.
   - README의 15개 정의에 `defer: true`를 붙인다(`pdf.read`는 `bundles/file.ts`, `session.list`는 `bundles/call.ts`, 나머지는 추가 소유 file).
   - 지운다: `tool-lists.ts`의 `DEFERRED_TOOLS`와 `deferredToolNames`, `PreparerDeps.deferredTools`, `product-driver.ts`의 `deferredTools` 줄, `agent-tools_test.ts`의 "숨긴 목록의 이름마다 그 role 목록에 든다" test.
2. **한 session에서 숨는 것(정한 것 2, `run-loop/prepare.ts`).** 켜진 session의 숨긴 집합 = 고정 목록 가운데 `defer: true`인 내장 tool + `origin: "app"`인 tool 전부 + `origin: "external"`인 tool 전부. 앱 tool을 숨기지 않는다는 wave 1 주석과 분기를 지운다.
3. **묶음으로 불러오기(정한 것 3, `tools/bundles/tool.ts`).**
   - 항목 `g`는 wire 이름이 `g`와 같거나 `g_`로 시작하는 숨긴 tool에 맞는다. 맞은 tool 전부의 wire 이름을 `tool_reference`로 싣는다(중복 없이, 정렬).
   - 받기 규칙은 README "정한 것"의 "`tool.load`의 받기 규칙" 그대로다. 숨기지 않은 tool의 wire 이름이면 `invalid_input`, 아무 숨긴 tool에도 안 맞으면 `not_found`, 하나라도 틀리면 전체 실패다.
   - description: 고정 문장 + 묶음 규칙 한 줄(예로 `job`, 앱 domain, `mcp__<server>`) + 그 session의 숨긴 wire 이름 정렬 목록. 앱이 쓴 설명은 넣지 않는다.
4. **불러온 tool이 session 동안 남기(정한 것 5).**
   - 다음 turn부터 이력(`prompt-assembly/summary.ts`의 `sessionMaterial`, `run-loop/turn.ts`의 `historyOf`)에 앞 turn의 성공한 `tool.load` 호출(assistant `tool_use`)과 그 결과(`tool_result_reference`)를 그 turn의 사람 요청 뒤, 그 turn의 마지막 답 앞에 그대로 싣는다. 이미 저장된 tool 호출 기록을 읽는다. 새 표를 만들지 않는다.
   - compaction이 덮은 구간과 숨긴(rewind) 구간의 호출은 싣지 않는다.
   - 같은 이력은 같은 bytes다. 앞 turn들의 prefix가 turn마다 흔들리지 않게 한다.
   - deferral을 못 받는 turn에서는 wave 1처럼 `Loaded: a, b` 글로 그려진다(adapter는 그대로).
5. **청소(정한 것 6).** wave 1이 role별 숨김 때문에 만든 것 가운데 이제 안 쓰는 것을 지운다. 지우거나 이름을 바꾼 것은 `grep -rn`으로 주석과 오류 문장까지 고친다. wave 1에서 쓰던 `selectTools`의 `deferral` 같은 칸도 다시 보고, 가장 단순한 꼴로 둔다.
6. **test(`write-test`).**
   - 위험 test 하나를 고친다(`tools/bundles/tool_test.ts`): "`tool.load`는 그 session의 숨긴 tool만 펼친다." 이름 항목과 묶음 항목 둘 다, session 목록 밖 tool·숨기지 않은 tool이 같은 묶음 접두사를 가져도 펼쳐지지 않는 것을 본다.
   - 다른 test는 새로 쓰지 않는다. 이력 모양과 wire는 lead가 fake server로 본다.

## 끝남

- `deno task check:full`이 통과하고 `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다.
- 위험 test: "`tool.load`는 그 session의 숨긴 tool만 펼친다."
- 남지 않음: `git grep -n "deferredToolNames\|DEFERRED_TOOLS\|deferredTools" packages tests tools`가 0줄이다.
- `executeToolCall`과 Gate 쪽 diff가 없다(`git diff plan/deferred-tools -- packages/core/lophn-agent/tools/work.ts`가 0줄).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 안 쓰게 된 export
- 정한 것: 문서에 답이 없어 worker가 정한 것. 특히 이력에 앞 turn `tool.load`를 끼우는 위치와 읽는 기록
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
