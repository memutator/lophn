# app-tool-names

앱 tool의 wire 이름을 `domain__<domain>__<tool>`(+hash)에서 `<domain>_<tool>`로 바꾸고, 그 이름이 내장 tool·다른 tool과 겹치지 않게 domain 이름과 선언 검사를 막는다.

- 단위: deferred-tools (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/app-tool/name.ts`
  - `packages/core/lophn-agent/tools/app-tool/name_test.ts`
  - `packages/core/main/tool-names_test.ts` (새 file)
  - `packages/protocol/lophn-agent/tool-catalog.ts`
  - `packages/protocol/apps/channel-values.ts`
  - `packages/protocol/domains/values.ts`
  - `packages/protocol/apps/declaration/` (`types.ts`, `tools.ts`, `value.ts`와 그 test)
  - `tests/e2e/app-call_test.ts`, `tests/e2e/operator_test.ts` (앱 tool 이름 문자열만)
  - `tests/eval/checks/app/calls.ts`, `tests/eval/checks/app/fixtures.ts`, `tests/eval/versions/components.ts`, `tests/eval/scenarios/calendar/calendar-api.scenario.ts`
- 읽을 것:
  - 계획: `project-docs/plan/deferred-tools/README.md`의 "정한 것"(사람 4, agent의 "묶음 규칙"). 이 brief보다 앞선다.
  - architecture: `project-docs/architecture/app-call.md` 118줄, `project-docs/architecture/domain.md` 42·56줄, `project-docs/architecture/eval.md` 79줄(시나리오 n)
  - 지금 코드: `tools/app-tool/name.ts`의 `appToolName`, `protocol/lophn-agent/tool-catalog.ts`의 `DOMAIN_TOOL_PREFIX`, `toWireToolName`, `TOOL_NAME_MAX`, `protocol/apps/channel-values.ts`의 `toolNameSchema`, `protocol/apps/declaration/types.ts`의 `DOMAIN_NAME`, `protocol/domains/values.ts`의 `domainNameSchema`
- 계약:
  - 쓰는 것: 내장 tool 이름 목록 `TOOL_ORDER`(`packages/core/agent-roles/tool-lists.ts`, 읽기만)
  - 내놓는 것: 앱 tool wire 이름 `<domain>_<tool의 . → _>`. 예약 domain 이름 목록(protocol 한 곳)

## 할 일

1. **이름 규칙(`appToolName`).** `${domain}_${tool}`에서 `.`을 `_`로 바꾼다. 64자(`TOOL_NAME_MAX`) 이하면 그대로, 넘을 때만 앞을 잘라 hash를 붙인다. `DOMAIN_TOOL_PREFIX`를 지운다. 주석은 새 규칙과 이유(domain 이름에 `_`가 없어 첫 `_` 앞이 domain, 내장 `<자원>_<동사>`와 같은 꼴)만 남긴다.
2. **예약 domain 이름.** 내장 tool wire 이름의 첫 `_` 앞(자원 이름: `file`, `pdf`, `image`, `shell`, `web`, `session`, `skill`, `tool`, `app`, `domain`, `declaration`, `package`, `release`, `preview`, `kind`, `settings`, `visual`, `instructions`, `operator`, `workflow`, `job`)과 `mcp`는 domain 이름으로 쓰지 못한다.
   - 목록은 protocol 한 곳(`tool-catalog.ts`)에 둔다. `domainNameSchema`와 선언의 domain 검사(`DOMAIN_NAME`를 쓰는 곳)가 같은 목록을 본다. 사본을 만들지 않는다.
   - `packages/core/main/tool-names_test.ts`: 모든 내장 tool(`TOOL_ORDER`)의 wire 이름 첫 `_` 앞이 예약 목록에 든다. 새 내장 자원을 더하고 예약을 잊으면 앱 tool 이름과 겹쳐 session의 tool 목록 전체가 `conflict`로 막히기 때문이다.
3. **한 앱 안의 겹침.** 선언 검사(`protocol/apps/declaration/tools.ts`)가 wire 이름(`.` → `_`)이 같아지는 두 tool을 거절한다. 오류 문장에 두 tool 이름을 쓴다.
4. **쓰는 곳 고치기.** `domain__`을 쓰는 곳을 새 이름으로 고친다: `protocol/apps/channel-values.ts` 주석, e2e 두 file, eval `checks/app/calls.ts`(앱 tool 알아보기), `checks/app/fixtures.ts`, `versions/components.ts`의 `WORLD_TOOL`, `scenarios/calendar/calendar-api.scenario.ts`. 앱 tool을 접두사로 알아보던 곳은 접두사 대신 기록의 다른 값(예: tool 호출 기록의 앱·origin)으로 가린다. 그런 값이 없으면 보고한다.
   - eval 시나리오 file을 고치면 그 시나리오의 `n`을 하나 올린다(`architecture/eval.md` 79줄).
5. **test.** `name_test.ts`를 새 규칙에 맞게 고친다(설계와 안 맞는 옛 test는 지운다). 3의 거절은 declaration test에 하나 둔다. 그 밖의 test는 새로 쓰지 않는다.

## 끝남

- `deno task check:full`이 통과하고 `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다.
- 위험 test: "모든 내장 tool의 자원 이름이 domain 예약 목록에 든다."
- 남지 않음: `git grep -n "domain__\|DOMAIN_TOOL_PREFIX" packages tests tools`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 안 쓰게 된 export
- 정한 것: 문서에 답이 없어 worker가 정한 것. 특히 eval이 앱 tool을 알아보는 방법
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
