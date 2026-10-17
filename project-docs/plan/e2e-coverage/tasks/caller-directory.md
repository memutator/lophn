# caller-directory

agent(Operator, lophn 등)가 app-api tool을 부르면 늘 `unavailable`("this dependency is not attached")이다. `packages/core/main/daemon/wiring/apps.ts`의 `callers`가 `ctx.peek.callerDirectory?.agentToolCall(...) ?? notAttached()`를 쓰는데, `callerDirectory`는 `wiring/context.ts`에 선언만 있고 채우는 wiring이 없다. operator-app-api와 app-data-rewind worker가 따로 찾았다.

- 단위: fix (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/session/caller-directory.ts`(새 file)
  - `packages/core/main/daemon/wiring/apps.ts`(`callers`의 그 자리)
- 읽을 것:
  - operator-app-api worker의 제안 patch: `/tmp/claude-1000/-home-pyosechang-projects-lophn/6236d925-7f3b-40dd-8fbd-3662cb9fc71e/scratchpad/caller-directory.patch`(`createCallerDirectory(sql)`이 `tool_calls`와 `turns`로 그 tool call이 running turn의 것인지 보고, `loadSession`으로 `agentRefOf`·`placeOf`를 돌려준다). 출발점이고 그대로 믿지 않는다.
  - `project-docs/architecture/app-call.md`("지키는 것": 누가 부르는지), `layers.md`(다른 module의 표를 SQL로 직접 읽지 않는다)
- 계약: 쓰는 것 `ctx.peek.callerDirectory`의 type(`wiring/context.ts`). 내놓는 것 없음.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 정한 것

- 다른 module의 표를 main wiring에서 SQL로 직접 읽지 않는다. `tool_calls`·`turns`·session을 읽는 판정은 lophn-agent 쪽 함수(`caller-directory.ts`)가 하고 wiring은 그것을 부른다(patch의 배치가 이 규칙에 맞는지 본다).
- `callerDirectory`를 채우는 자리는 지금 선언한 Late/peek 칸이다. 그 칸을 다른 이름으로 바꾸지 않는다.

## 할 일

1. 고치기 전 실패: lophn이나 Operator의 app-api tool 호출이 `failure/unavailable`인 것을 보인다. 이 branch에는 그 E2E가 아직 없다. 임시로 `git show operator/operator-app-api:tests/e2e/operator_test.ts > tests/e2e/operator_test.ts`로 가져와 `app-api` 행을 돌리고(commit하지 않고 끝나면 지운다) 실패 출력 한 줄을 적는다.
2. 고친다. 3. 같은 행이 통과한다. `tests/e2e/app-release_test.ts` 한 번.

## 끝남

- `deno task check:full`, core 기동 두 번이 통과한다.
- 가져온 `operator_test.ts`의 `app-api` 행이 통과한다(나머지 행은 operator-app-api의 몫).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 찾은 제품 bug: 증상, 재현하는 행, 의심 file. 고쳤으면 "고치기 전 코드에서 그 행이 실패한 것"의 출력 한 줄
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
