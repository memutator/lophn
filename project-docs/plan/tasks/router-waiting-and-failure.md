# router-waiting-and-failure

Router 두 곳을 줄인다. (1) call 목록(`callSendable`)이 lophn session의 `waiting`을 구별하지 않는다(내지도 못하던 값을 정직하게 뺀다). (2) agent가 보낸 call이 배달에 실패하면 같은 실패를 tool 결과와 새 입력 둘로 받는 이중 통지를 하나로 줄인다.

- 단위: router (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/router/{reads,router,router_test}.ts`
  - `packages/core/main/daemon/wiring/router.ts` (한 줄: `createCallBodyPreparer`)
- 읽을 것:
  - architecture: `project-docs/architecture/agent-call.md` ("지키는 것"의 "실패는 조용히 버리지 않는다", 실패 알림이 한 번만 가는 문장). 문서는 lead가 고친다.
  - 이슈: `project-docs/issues/agent-call.md`의 "Router describe가 lophn session의 waiting을 내지 못한다"(정한 것: B), "배달 실패의 응답 꼴이 보낸 쪽마다 셋이다"(정한 것: agent의 이중 통지만)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `router`, `project-docs/module-catalog.yaml`의 `packages/core/router`
  - 코드: `core/lophn-agent/tools/bundles/call.ts`(tool 결과: `call X failed: <reason>`, description "If it fails, the result says why")
- 계약:
  - 바꾸지 않는다. `RouteResult`, `callSend`/`callSendable` 출력과 `SENDABLE_SESSION_STATES`(protocol)는 그대로다. 특히 `SENDABLE_SESSION_STATES`의 `waiting`은 `protocol/events/snapshot.ts`의 session snapshot이 쓰므로 지우지 않는다.
  - 내놓는 것: 없음.

## 할 일

### waiting (B)

1. `packages/core/router/reads.ts`: `STATES`에서 `"waiting"`을 뺀다(`["running", "idle", "unknown"]`). `describe`(`router-registration.ts`)는 처음부터 `running`/`idle`만 내므로 그쪽은 건드리지 않는다. `STATES` 위에 "허락 기다림(waiting)은 reader가 못 봐서 구별하지 않는다. 구별이 필요해지면 turn 행에 적는 쪽을 본다" 한 줄 주석(왜만)을 쓴다.

### 이중 통지

2. `packages/core/router/router.ts`의 `deliveryFailed`: agent 분기에서 `notifyFailed(tx, from.session, call, reason)`과 그 `told` 처리를 지운다. tool 결과(`ok({ call, state: "failed", fail_reason, session: null })`)와 실패 call 행(`store.insert`)은 그대로 둔다. 사람·program·coding agent 분기는 건드리지 않는다.
   - 남는 `notifyFailed` 호출은 `failAll`(받은 session이 답 없이 끝남 `receiver_ended`, 켤 때 `lophn_restarted`)뿐이다. 그쪽은 tool 결과가 없는 뒤늦은 실패라 새 입력이 맞다.
   - `notifyFailed` 위 주석을 "배달 뒤에 늦게 알게 된 실패를 …"로 맞춘다.
3. `packages/core/main/daemon/wiring/router.ts`의 `createCallBodyPreparer`: `callSend`가 `Object.values(FAILURE_TEXTS)`를 blob으로 미리 준비하는 줄(`if (name === callSend.name) texts.push(...)`)을 지운다. 이제 `callSend`의 tx 안에서 쓰는 고정 문구가 없다(`receiver_ended`는 세션을 닫는 command 쪽, `lophn_restarted`는 `start` 쪽이 따로 준비한다). `import`가 남으면 정리한다. 다른 줄은 건드리지 않는다(고정 문구 준비 방식 자체를 줄일지는 다이어트 계획이 정한다).
4. `packages/core/router/router_test.ts`: "a call to a closed session fails as closed…" test의 단언을 고친다. 지금은 실패가 보낸 session에 입력으로 돌아간다고 단언한다(`delivered.map(to)`가 `[SENDER]`, `outcome`). 고친 뒤에는 받는 session에도 보낸 session에도 아무 입력이 가지 않고(`delivered`가 비어 있음) 결과가 `state: "failed"`, `fail_reason: "closed"`다. 같은 실패를 두 번 받지 않는다는 규칙이 이 test의 새 뜻이다. test를 새로 만들지 않는다. `failReceivedBy`처럼 늦은 실패의 알림을 단언하는 test가 있으면 그대로 둔다.

## 정한 것

- 이슈의 "정한 것"은 "agent가 같은 실패를 두 번 받는 것만 고친다"이고 어느 쪽을 남길지는 정하지 않았다. 이슈 "고치려면"에는 "agent는 입력 통지만 둔다"가 있지만, `call` tool의 결과가 이유를 바로 돌려주고(tool description도 그렇게 말한다) 그 결과를 없애면 tool 계약이 바뀐다. 그래서 **즉시 알 수 있는 배달 실패는 tool 결과로, 늦게 아는 실패(`receiver_ended`, `lophn_restarted`)는 새 입력으로** 한 번씩만 가게 했다. 반대로 가야 하면 lead가 알려 준다.
- `FAILURE_TEXTS`/`failureInput`은 남는다(사람 분기 message와 늦은 실패 알림이 쓴다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(`router_test.ts`의 기존 test를 새 규칙에 맞게 고친 것이 전부다).
- 남지 않음: `grep -n "notifyFailed" packages/core/router/router.ts`에 `deliveryFailed` 안의 호출이 없다(`failAll` 한 곳만). `grep -n "callSend.name) texts.push" packages/core/main/daemon/wiring/router.ts`가 0줄.
- core가 뜬다: `mkdir -m 700 -p $PWD/.dev-data/router-waiting-and-failure && export LOPHN_HOME=$PWD/.dev-data/router-waiting-and-failure`로 core를 띄워 기동 오류가 없는지 본다(`$!` PID만 끈다).

## 보고

- 바꾼 file
- 통과한 check
- 안 쓰게 된 export
- 정한 것
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
