# rp-fetch-check

core main graph에서 bare `fetch(`와 `globalThis.fetch`를 막는 check를 만든다.

- 단위: tools (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tools/check-source.ts`
  - `tools/check-source_test.ts` (없으면 새 file)
- 읽을 것:
  - 이슈: `project-docs/issues/mistakes.md`의 "core main에서 전역 fetch로 자기 HTTP를 불러 problem을 보고했다"("막기")
  - AGENTS.md "코드"(네트워크는 인자로 받는다)
  - 주석이 말하는 규칙: `packages/core/problems/reporting/adapters/core-client.ts` 2줄, `packages/core/problems/tests/work/runner-service.ts` 106줄("property access로만 부른다")
  - `tools/check.ts`(단계 목록), `tools/deps-imports.ts`(import graph를 읽는 길이 있으면 쓴다)

## 할 일

1. core daemon 진입점(`packages/core/main/daemon/main.ts`)에서 닿는 graph의 file에서 식별자 그대로의 `fetch(`와 `globalThis.fetch`를 막는다. property access(`deps.fetch(`, `client.fetch(`)는 허용한다. child worker 진입점에서만 닿는 file은 graph가 달라 빠진다.
2. 지금 코드가 통과해야 한다. 걸리는 곳이 있으면 고치지 말고 목록을 보고한다.
3. 위반 하나를 잡는 test 한 행.
4. 주석의 "EXTERNAL_FETCH tripwire"가 이 check를 가리키게 이름을 맞춘다(주석은 `packages/core/problems`에 있고 이 task 소유 밖이니, 이름을 check 쪽에 `EXTERNAL_FETCH`로 두는 것으로 맞춘다).

## 끝남

- `deno task check`가 통과하고 이 check가 그 안에서 돈다.
- 위험 test: "core main graph의 bare fetch는 check가 막는다"

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴대로(바꾼 file, 통과한 check, 정한 것, 넘길 줄, 계약 바꾸기 요청, 무겁게 짠 것, 알려진 미완 동작).
