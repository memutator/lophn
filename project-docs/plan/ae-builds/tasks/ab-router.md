# ab-router

call의 받는 곳이 coding agent면 Router가 받지 않는다. 새 coding session을 여는 Router 길(`launchCoding`)을 지우고, call tool 설명에서 coding agent에게 맡기는 말을 지운다(README "App Engineer가 coding agent에게 맡기는 흐름을 막는다"). coding 쪽 연결 장치(`CodingTransport` port와 그 구현, PTY launch)는 그대로다(README "범위 밖").

정한 것: 거절 code는 `invalid_input`이다. 이유: 권한의 문제가 아니라 그런 받는 곳이 지금 없는 것이다. 누가 보내도 같은 답이고 다시 시도할 일이 아니다. 받는 곳이 role `coding_agent`로 풀리면 모두 거절한다(`{role: "coding_agent", place}`로 부른 것, coding session id로 부른 것). call 행을 남기지 않는다.

- 단위: router (wave 1)
- 선행: ab-coding-move. 같은 wave에서 `router-registration.ts`를 고친다.
- 소유(이 task만 고친다):
  - `packages/core/router/{router.ts,router_test.ts}`
  - `packages/core/main/daemon/wiring/router-registration.ts`
  - `packages/core/lophn-agent/tools/bundles/call.ts`(`call` tool의 설명과 입력만)
- 읽을 것:
  - 계획: `project-docs/plan/ae-builds/README.md`의 "App Engineer가 coding agent에게 맡기는 흐름을 막는다"(받는 곳이 `coding_agent`로 풀리면 `invalid_input`, call 행 없음, 연결 장치는 그대로)
  - architecture: `project-docs/architecture/agent-call.md`의 흐름 그림(13~18줄)과 "coding agent에게 맡기기는 Router가 session을 열지 않고 coding transport가 연다"(59~60줄). 이 task로 틀린다. 문서는 계획 끝에 lead가 고친다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `router`, `project-docs/module-catalog.yaml`의 `packages/core/router`
  - 코드(줄은 main `dd956b49f`)
    - `packages/core/router/router.ts`: `RouterDeps.coding`(36~52), `close` 주석(72), `Resolved`의 null target(88~92), `open`의 coding 갈래(110~112), `resolve`(121~165), `launchCoding`(266~327), `route`의 `target === null` 갈래와 줄에 선 coding 맡기기의 `receiver`(352~370)
    - `packages/core/router/model.ts`의 `addressingOf`(받는 곳의 네 꼴: `resolved`, `session`, `named`, `named_or_session`)
    - `packages/core/router/ports.ts`의 `TargetSession.agent`(coding session은 `withCodingSessions.find`가 `{role: "coding_agent", app}`, `transport: "harness"`로 준다)
    - `packages/core/main/daemon/wiring/router-registration.ts`: `withCodingSessions`(38~88), `coding.start`(133~135). ab-coding-move 뒤 import 경로는 `../../../apps/coding/`이다.
    - `packages/core/lophn-agent/tools/bundles/call.ts`: `callToolInput`(16~19), `call` 설명(32~40)
    - `packages/protocol/lophn-agent/calls.ts`의 `callSendInputSchema`(177~186. `options`는 남는다)
- 계약:
  - 쓰는 것: `CallTo`, `CallAgent`(`packages/protocol/lophn-agent/calls.ts`)
  - 내놓는 것: `RouterDeps`에 `coding`이 없다. Router의 `route`는 받는 곳이 role `coding_agent`로 풀리면 `err({ code: "invalid_input" })`이다(call 행 없음). `launchCoding`이 없고 풀린 받는 곳의 `target`은 null이 아니다. `router-registration.ts`는 `coding.start`를 넘기지 않는다. 그 밖의 coding 몫(`withCodingSessions`, harness 배달과 취소 갈래)은 그대로다. `call` tool 설명에 coding agent에게 맡기는 길이 없고, tool 입력에서 `options`(coding 실행 옵션 `{harness, model}`)를 뺀다(`callSendInputSchema.omit`). protocol `callSendInputSchema`의 `options` 칸은 남는다(coding 연결 장치가 쓴다). ticket 근거 링크(`refs`의 `ticket`)는 ab-ticket-refs가 지운다.

## 할 일

근거: README "call의 받는 곳이 role `coding_agent`로 풀리면 Router가 `invalid_input`으로 거절하고 call 행을 쓰지 않는다".

1. `router.ts`
   - 거절 함수 하나를 둔다. 예: `const notCoding = () => err({ code: "invalid_input" as const, message: "a coding agent does not take calls" })`.
   - `resolve`에서 받는 곳이 `coding_agent`이면 그 자리에서 거절한다. 행을 쓰는 `deliveryFailed`로 가지 않는다.
     - `named`, `named_or_session`: `directory.resolveAgent` 전에 `addressing.named.role === "coding_agent"`이면 거절. 앱 이름을 못 풀어도 같은 답이다.
     - `resolved`: `to.kind !== "open_session"`이고 `to.agent.role === "coding_agent"`이면 거절.
     - `directory.find`로 찾은 target(`open_session`, `open_session_or_new` 둘 다)의 `agent.role`이 `coding_agent`이면 거절.
   - `open`의 coding 갈래(110~112), `launchCoding` 전체, `RouterDeps.coding`, `route`의 `if (target === null) return launchCoding(…)`을 지운다. `Resolved`의 성공 갈래는 `target: TargetSession`이다(주석 90줄도 지운다).
   - `route`의 `receiver` 계산(366~370)에서 "앱 줄에 선 coding 맡기기" 갈래를 지우고 `target.session`으로 둔다. harness target은 이제 `route`에 오지 않는다.
   - 안 쓰게 된 import(`CodingStartResult`, `CodingOptions`, `Id`가 남으면 둔다)를 지운다.
   - `close` 주석(72줄) "Reactor handler(coding-agent)가 맡긴 call을 닫는다"를 "coding 쪽(coding session의 끝)이 맡긴 call을 닫는다"로 고친다. ab-coding-detach가 Reactor 없이 닫게 바꾸므로 Reactor를 말하지 않는다.
2. `router-registration.ts`: deps의 `coding: { start }`(133~135)를 지우고 38줄 주석의 "새 session은 Router가 transport start로 연다"를 지운다. `withCodingSessions`, transport의 harness `deliver`·`cancel`·`queued`는 그대로다.
3. `call.ts`
   - `callToolInput`의 `omit`에 `options: true`를 더한다.
   - `call` 설명: role 목록에서 `coding_agent`를 빼고, `conversation (Project Manager, App Engineer and coding agent only)`를 `(Project Manager and App Engineer only)`로, 39줄("To hand a ticket to a coding agent …")을 지운다. `refs`의 `ticket`은 ab-ticket-refs가 지우니 둔다. `session.list` 설명은 이 task 밖이다.
4. `router_test.ts`: 지금 coding 맡기기를 보는 test는 없다. 고칠 것이 없으면 그대로 둔다(아래 "위험 test").
5. 남은 흔적: `git grep -n "launchCoding\|deps\.coding\|coding\.start\|hand a ticket" -- packages`가 0줄인지 본다.

## 끝남

- `deno task check`가 통과한다.
- 바꾼 곳의 test: `deno test --no-check packages/core/router`
- 위험 test: 없음. 거절은 권한, secret, data의 경계가 아니고, Router에 coding session을 여는 길 자체가 없어져서 되살아날 회귀가 없다(AGENTS.md "속도").
- 남지 않음: `git grep -n "launchCoding\|deps\.coding\|coding: {" -- packages/core/router packages/core/main/daemon/wiring/router-registration.ts`가 0줄이다. `git grep -n "coding_agent\|coding agent" -- packages/core/lophn-agent/tools/bundles/call.ts`가 `session.list` 설명 한 줄뿐이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없을 것이다. 있으면 적는다.
- 안 쓰게 된 export: `CodingTransport.start`와 그 구현(`packages/core/apps/coding/transport.ts`)은 부르는 곳이 없어진다. 연결 장치라 지우지 않는다(README "범위 밖"). `withCodingSessions.resolveAgent`의 `coding_agent` 갈래도 닿지 않는다. 지우지 않고 적는다.
- 정한 것: 문서에 답이 없어 worker가 정한 것(거절 message 글, 거절을 둔 자리)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
