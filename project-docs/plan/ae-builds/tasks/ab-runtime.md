# ab-runtime

App Engineer가 앱 하나를 한 turn에 짓지 못하게 막던 넷을 고친다(README "정한 것"의 첫 묶음, roadmap "App Engineer 혼자 코딩한 실험"): 제품 기본 turn 한도를 model call 30에서 150으로 올리고, Anthropic 요청의 대화 끝에 cache 표시를 달고, 입력 없는 tool이 "입력 없음 / `null` / `{}`"를 모두 받게 하고, `shell.run`의 PATH에 lophn이 쓰는 `deno`의 폴더를 넣는다.

정한 것(flesh. planner 확인 필요. 소유에 뼈대 밖 file을 더했다):
- 입력 없는 tool의 `null`은 model이 tool 인자 글을 `null`로 보낼 때만 생긴다. 지금 그 글은 adapter의 완성 판정(`verifiedJson`, `verifiedJsonObject`)이 응답 전체를 `partial`로 세우고, 넘어가도 `run-loop/tool-batch.ts`의 `parseToolArgs`가 "tool arguments are not a JSON object"로 닫는다. 빈 글은 이미 `{}`다(`parseToolArgs` 92줄). 그래서 `tools/schema.ts`의 `checkInput`, `tools/work.ts`의 `unchanged`, `app-tool/input.ts`의 `toolInput`은 늘 object를 받고 고칠 것이 없다. 고칠 자리는 adapter 셋과 `parseToolArgs`다.
- 앱 process가 tool 입력을 받는 곳(`packages/protocol/apps/blueprint/schema.ts`의 `validateInput`)은 `inputSchema: null`인 tool에 `{}`나 `null`이 오면 "tool accepts no input"으로 거절한다. `preview.call`(ab-preview), 앱 화면, 앱끼리 부르기가 모두 이 자리를 지나고, 이제 App Engineer가 그 코드를 쓴다. 같은 규칙으로 맞춘다.
- deno는 `Deno.execPath()` 하나다. `LOPHN_DENO`는 어디서도 설정하지 않는다: supervision이 runtime child와 앱 supervisor를 모두 `denoCommand: Deno.execPath()`로 띄우고 env에 `LOPHN_DENO`를 넣지 않는다(`packages/core/main/daemon/wiring/supervision.ts` 16, 36줄). 그래서 runtime child의 `Deno.execPath()`가 앱 process의 deno와 같다. `Deno.execPath()`는 Deno 2.9에서 권한이 필요 없다. `runtime-permissions.ts`는 고치지 않는다.

- 단위: runtime (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/turn-values.ts`
  - `packages/core/lophn-agent/models/binding.ts`
  - `packages/core/lophn-agent/models/binding_test.ts`(새 file. flesh가 더함)
  - `packages/core/lophn-agent/providers/adapters/messages.ts`
  - `packages/core/lophn-agent/providers/adapters/{compat.ts,responses.ts}`(`verifiedJsonObject`만. flesh가 더함)
  - `packages/core/lophn-agent/run-loop/tool-batch.ts`(`parseToolArgs`만. flesh가 더함)
  - `packages/protocol/apps/blueprint/schema.ts`(`validateInput`만. flesh가 더함)
  - `packages/core/lophn-agent/tools/{schema.ts,work.ts}`
  - `packages/core/lophn-agent/tools/app-tool/input.ts`
  - `packages/core/lophn-agent/tools/shell/{env.ts,env_test.ts}`
  - `packages/core/lophn-agent/tools/runtime-permissions.ts`
- 읽을 것:
  - 계획: `project-docs/plan/ae-builds/README.md`의 "정한 것" 첫 묶음(turn 한도, 대화 cache, 입력 없는 tool, shell PATH)
  - roadmap: `project-docs/products/roadmap/problem-ticket.md`의 "App Engineer 혼자 코딩한 실험"(model call 85번, cache 없는 대화, 입력 없음 / `null` / `{}`)
  - 이슈: `project-docs/issues/agent-definition.md`의 "Anthropic 요청이 대화에 cache 표시를 달지 않아 긴 turn이 매 call 대화 전체를 cache 없이 낸다"(추천: 마지막 message의 마지막 content block에 표시)
  - architecture: `project-docs/architecture/agent-definition.md`의 조립 그림(18-23줄. system 층 셋이 cache 경계다)과 "shell은 환경 변수 허용 목록만 넘긴다"(54줄)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `lophn-agent`, `apps`, `protocol`; `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `packages/protocol`
  - 코드(줄은 main `dd956b49f`)
    - turn 한도: `packages/protocol/lophn-agent/turn-values.ts`의 `DEFAULT_TURN_LIMITS`(77-81). 설정 선언의 기본값이 이것이다(`packages/core/lophn-agent/run-loop/limits.ts` 36-47). eval은 설정으로 15를 쓴다(`tests/eval/provider/settings.ts`).
    - cache: `packages/core/lophn-agent/prompt-assembly/layers.ts`의 `anthropicSystem`(42-48. `cache !== false`인 system block마다 표시), `prompt-assembly/turn-prompt.ts`의 `CACHED`(180. role, instructions, place 셋), `models/binding.ts`의 `anthropicMessages`(59-110. content는 늘 block 배열이다)와 `anthropicPacker`(112-132. 127줄 `boundaries`가 모두 false), `providers/adapters/messages.ts`의 머리 주석(11-12), `CacheBoundaries`(14-18), `markLast`(54-67. 배열의 마지막 원소에 단다. messages에 쓰면 message 객체에 달린다), `buildRequest`(146-173. 부르는 곳은 `anthropicPacker` 하나다)
    - 입력: `run-loop/tool-batch.ts`의 `parseToolArgs`(87-102)와 쓰는 곳(159-171, 268-277), `providers/adapters/messages.ts`의 `verifiedJson`(451-460, 쓰는 곳 418), `providers/adapters/compat.ts`의 `verifiedJsonObject`(89-98, `chat-completions.ts` 382가 쓴다), `providers/adapters/responses.ts`의 `verifiedJsonObject`(372-381, 쓰는 곳 367), `tools/work.ts`의 `executeToolCall`(109-127), `tools/app-tools.ts`의 handler(76-87. `inputSchema === null`이면 앱에 `input`을 싣지 않는다), `packages/protocol/apps/blueprint/schema.ts`의 `validateInput`(315-333), 그것을 부르는 `packages/core/apps/runtime/entrypoint/invoke.ts`(90)
    - shell: `tools/shell/env.ts`(`SHELL_ENV_NAMES`, `shellEnvironment`, `readShellEnvironment`), `tools/shell/run.ts`(116-124. `clearEnv: true`에 `readShellEnvironment()`), `tools/runtime-permissions.ts`(`BASE_ENV`, `allow_env`), 앱 deno 규칙 `packages/core/main/app-supervisor/main.ts`(119, 131, 141)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것:
    - `DEFAULT_TURN_LIMITS.model_attempts`는 150이다. `stall_ms`, `active_ms`는 그대로다. role마다 다른 한도는 없다.
    - Anthropic 요청은 지금의 system 표시(최대 셋)에 더해 `messages`의 마지막 message의 마지막 content block에 `cache_control`을 단다(합쳐 API 상한 4개 안). message 객체 자체에는 달지 않는다.
    - 입력 schema가 빈 object인 tool은 입력 없음, `null`, `{}`를 모두 `{}`로 받는다. 내장 tool(`z.strictObject({})` 입력)과 선언 `inputSchema`가 `null`인 앱 tool 둘 다다. 앱 tool은 그때 앱에 입력을 보내지 않는다(지금처럼 `input` 칸이 없다). 칸이 있는 입력은 지금처럼 엄격하다.
    - 앱 process의 입력 검사(`validateInput`)는 `inputSchema: null`인 tool에 입력 없음, `null`, `{}`를 모두 "입력 없음"(`value: undefined`)으로 받는다. 칸이 있는 schema는 그대로다.
    - `shell.run` 자식의 PATH 맨 앞에 lophn이 쓰는 deno(`Deno.execPath()`)가 있는 폴더가 붙는다. 자식에게 넘기는 env 이름 목록(`SHELL_ENV_NAMES`)은 늘지 않는다.

## 할 일

1. turn 한도(README "정한 것"): `turn-values.ts`의 `model_attempts`를 30에서 150으로 바꾼다. 위에 "왜" 주석 한 줄: 앱 하나를 짓는 turn에 model call이 약 85번 들었고, 오래 도는 turn은 `active_ms`(30분)와 `stall_ms`가 멈춘다.
2. 대화 cache(이슈의 추천).
   - `messages.ts`: `CacheBoundaries`, `buildRequest` 입력의 `boundaries`, `markLast`를 지운다. 셋 다 늘 false로만 불려 죽은 코드다(system 표시는 `anthropicSystem`이 이미 단다). 대신 `buildRequest`가 `pairedMessages`를 거친 messages의 마지막 message에서 `content` 배열의 마지막 block에 `cache_control: CACHE_CONTROL`을 단 새 배열을 싣는다. 원본 배열과 객체는 고치지 않는다. 마지막 message가 없거나 `content`가 빈 배열이거나 배열이 아니면 그대로 둔다(packer는 늘 배열을 만든다).
   - 머리 주석(11-12줄)을 고친다: 대화 끝 표시 하나이고, system 층 표시(최대 셋, `turn-prompt.ts`의 `CACHED`)와 합쳐 Anthropic 상한 4개 안이다. tools는 system 앞이라 role 층 표시가 함께 덮는다.
   - `binding.ts`: `anthropicPacker`의 `boundaries` 줄과 112줄 주석의 "adapter의 경계 표시는 모두 끈다"를 지운다.
   - 대화 끝 block은 turn마다 새로 생긴 tool 결과나 사람 글이라 다음 call은 앞 call이 쓴 prefix를 읽는다. 대화 중간 표시(이슈의 둘째 안)는 하지 않는다.
3. 입력 없는 tool(위 "정한 것").
   - `tool-batch.ts`의 `parseToolArgs`: JSON `null`도 빈 글처럼 `{ ok: true, value: {} }`이다. 위 주석 "비어 있으면 인자 없는 호출이다"에 `null`을 더한다. 이력에 남는 `tool_use.input`도 `request.input`이라 `{}`가 된다(`run-loop/turn.ts` 544-550).
   - adapter 셋의 완성 판정: `messages.ts`의 `verifiedJson`, `compat.ts`와 `responses.ts`의 `verifiedJsonObject`가 `null`을 완성으로 본다(빈 글처럼). 배열, 숫자, 문자열, 깨진 JSON은 지금처럼 완성이 아니다.
   - `validateInput`(`blueprint/schema.ts` 319-323): `schema === null`이면 `value`가 `undefined`, `null`, 또는 key 없는 plain object일 때 `{ ok: true, value: undefined }`다. 그 밖은 지금처럼 "tool accepts no input"이다. 입력 hash(`canonicalInputHash`, `inputHashOf`)는 검사한 값으로 세므로 셋 모두 JSON `null`의 hash가 된다. 이 file은 SDK `@lophn/blueprint` 설치 사본에 vendor되는 순수 file이다(`packages/core/apps/packages/vendor.ts`). import를 더하지 않는다(`tools/deps-blueprint.ts`가 본다).
   - `tools/schema.ts`, `tools/work.ts`, `app-tool/input.ts`는 고치지 않는다. 위 둘을 고친 뒤 실행기에 오는 입력은 늘 object다. 고칠 일이 보이면 보고한다.
4. shell PATH(README "정한 것").
   - `env.ts`: `shellEnvironment(parentEnv, deno)`가 `deno`(실행 파일 경로)의 폴더를 PATH 맨 앞에 붙인다(`node:path`의 `dirname`, 구분자 `:`. shell은 `/bin/sh`라 POSIX뿐이다). 부모 PATH가 없으면 그 폴더 하나다. `readShellEnvironment()`가 `Deno.execPath()`를 넘긴다. `SHELL_ENV_NAMES`는 그대로다.
   - `env_test.ts`: 있는 test("shell 환경에 lophn token과 secret이 나가지 않는다")는 secret 경계를 지키므로 지우지 않고 새 인자에 맞춰 기대값(PATH 앞에 deno 폴더)만 고친다.
   - `runtime-permissions.ts`는 고치지 않는다(위 "정한 것").
5. 이슈를 닫는 것은 lead다(위 이슈).

## 끝남

- `deno task check`가 통과한다.
- 바꾼 곳의 test가 통과한다: `deno test --no-check packages/core/lophn-agent/models packages/core/lophn-agent/tools/shell packages/core/lophn-agent/run-loop packages/protocol/apps/blueprint tests/harness/wire tests/harness/loop`
- 위험 test: "Anthropic 요청은 대화 끝 content block에 cache 표시를 달고 표시는 넷을 넘지 않는다". `models/binding_test.ts`의 순수 test 하나다. `anthropicPacker({ model: "m", maxTokens: 1000, images: false })`에 system 넷(`role`, `instructions`, `place`는 `cache: true`, `skills`는 `cache: false`. `turn-prompt.ts`가 만드는 모양), tool 하나, messages 셋(user 글, assistant `tool_use`, user `tool_result`)을 넣는다. 판정: 마지막 message의 마지막 block의 `cache_control`이 `{ type: "ephemeral" }`이고, message 객체에는 `cache_control`이 없고, body 전체의 `cache_control` 수가 4다. 넷을 넘으면 Anthropic이 요청을 모두 거절하므로 둔다(planner가 순수하고 쌀 때만 허락했다).
- 남지 않음
  - `git grep -n "final_user\|markLast\|CacheBoundaries" -- packages`가 0줄이다.
  - `git grep -n "model_attempts: 30" -- packages`가 0줄이다.
  - `git grep -n "LOPHN_DENO" -- packages/core/lophn-agent`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(목록 file을 고치지 않는다). 없으면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 문서는 lead가 고친다: `project-docs/architecture/agent-definition.md` 조립 그림의 "대화" 줄에 cache 경계가 하나 더 생긴다.
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 예: 지침이 바뀐 turn은 notice가 대화 끝에 붙어 그 turn 동안 대화 cache가 덜 맞는다(`prompt-assembly/turn-prompt.ts`의 `noticesOf`).
