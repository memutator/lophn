# fix-turn-wiring

fix-turns(`73353f37`)가 credential, 감독 pipe, 기록 route, 답 기록을 turn·session 모양으로 바꿨다. 남은 것은 그것을 잇는 등록 줄이다. 이게 없으면 child가 시작할 turn을 읽지 못하고 agent 자격 command가 모두 막힌다. agent-definition-register는 선행이 많아 늦으므로 이 줄만 먼저 넣고, turn 하나가 처음부터 끝까지 도는지 본다.

- 단위: router (wave 3 계약 고침)
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/register.ts`의 `runAdmissionPort` 줄과 run-loop 등록 줄(`createRunCommands` 등의 publish·별칭)만
  - `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`의 `startAgentRuntimeChild` 호출
  - router wiring의 `createLophnInputTransport` 호출(같은 `inbox`를 나눠 쓰려면)
  - `packages/core/main/daemon/runtime.ts`의 `createWorkspaceRelay({ runSession })`·`runSessionOf`, `packages/core/server/workspace.ts`의 `WorkspaceRelayDeps.runSession`
- 읽을 것:
  - fix-turns brief와 그 결과: `/home/pyosechang/projects/lophn/project-docs/plan/fixes/fix-turns.md`, `git show 89e2eb4a --stat`(main에서는 `73353f37`까지)
  - `/home/pyosechang/projects/lophn/project-docs/plan/tasks/agent-definition-register.md` 끝의 "(lead가 더함)" 항목(router-run-loop-turn이 넘긴 등록 줄)
  - 공통 규칙: `/home/pyosechang/projects/lophn/project-docs/plan/fixes/README.md`
- 계약: 바꾸지 않는다.

## 할 일

1. `register.ts`의 `runAdmissionPort`가 없는 `runs` 표를 읽는다. `select state from turns where id = ?`로 바꾼다(ledger가 `ctx.run`을 turn id로 채운다).
2. `startAgentRuntimeChild`에 `turns: createTurnSource({ inbox, starter: createTurnStarter({ inbox }) })`와 Bus에 내는 `publish`를 넘긴다. `inbox`는 router wiring의 `createLophnInputTransport`가 쓰는 것과 같은 것이어야 한다.
3. router-run-loop-turn이 넘긴 등록 줄 가운데 turn이 도는 데 필요한 것을 넣는다: `createRunCommands`에 `publish`, `createLophnInputTransport`에 `publish`, 켤 때 writer tx 안의 `interruptRunningTurns(tx, bus.publish, "restarted")`, places `EndDeps`의 `interruptRunningTurns(..., "session_ended", s)`. 넣은 줄은 agent-definition-register brief에서 빠지도록 보고에 적는다.
4. `createWorkspaceRelay({ runSession })`·`runSessionOf`·`WorkspaceRelayDeps.runSession`을 지운다.
5. 확인: 개발 data를 새로 만들어 core를 띄우고, session 하나에 메시지를 보내 turn이 시작되고 끝나는지 본다. model provider가 없으면 turn이 `configuration_unavailable`로 끝나는 것까지가 확인이다(그 경우 그 사실을 보고한다). fake provider나 test provider가 이미 있으면 그것으로 답 기록까지 본다. 확인용 script는 commit하지 않는다.

## 끝남

- `deno task check:full`이 통과한다. core가 기동 오류 없이 뜬다.
- 5번 확인 결과를 보고한다.
- 위험 test: 새로 쓰지 않는다.

## 보고

- 바꾼 file
- 5번 확인 결과(어디까지 돌았나, 막힌 곳)
- agent-definition-register brief에서 빼도 되는 줄
- 계약 바꾸기 요청: 없으면 "없음"
