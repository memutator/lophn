# coding-agent-session

core 쪽 coding session을 새로 짠다. Router가 부르는 `CodingTransport`(맡기기, 앱마다 줄, 메시지 넣기, 멈추기), 그 앱 하나 범위 token 발급·회수, hook 수신과 agent event 변환, shell main 터미널 요청(여는·넣는·멈추는) 보내기와 결과 받기, session 끝 정리, 기동 때 복구, 완료 보고·claim 만료·보고 없는 끝으로 call을 닫는 Reactor handler를 만든다.

- 단위: coding-agent (wave 3)
- 선행: `coding-agent-tickets`(같은 `core/apps/tickets`를 고친다)
- 소유(이 task만 고친다):
  - `packages/core/apps/tickets/coding/`(새 폴더. core에는 coding transport를 둘 module 위치가 없어 tickets 소유 폴더 아래에 둔다. 아래 보고 "정한 것" 참고)
- 읽을 것:
  - spec: S6 2·5·6·7·8장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/coding-agent.md`
  - spec: S3 4·5·7장(call 상태, 앱 줄, 입력 넣기) — `.../specs/agent-call.md`
  - spec: S1 5·6·10장(call 닫음 handler, agent event, 꺼짐) — `.../specs/event.md`
  - inventory: `I3.3#15`, `I3.6#1`, `I3.6#2`, `I3.6#4`, `I3.6#5`(끝 표의 나머지 중 coding session 쪽), `I3.6#8`, `I3.6#9`, `I3.6#10`, `I3.6#11`, `I3.6#12`, `I3.6#13`, `I3.6#15`, `I3.6#17`
  - 결정: `../README.md` 3장 #4, #6, #60, #66·67, #74
  - 계약: `packages/protocol/coding-agent/{transport,token,hook,message,source-diff,harness-report,terminal-requests,harness-adapter,hook-signal,launch-plan}.ts`, `ticket/ports.ts`(`TicketSessionEnd`)
- 계약:
  - 쓰는 것:
    - `CodingTransport`(구현한다), `CodingTokens`(발급·회수. 구현은 events 단위의 `core/server/identity`. fake로 짓는다), `CodingSessionLookup`(구현한다), `TicketSessionEnd`(tickets 구현. fake로 짓는다)
    - `launchPlanOf`, `hookSignalOf`, `HARNESS_ADAPTERS`, `canLaunch`, `canDeliverMessages`
    - agent event를 Bus에 내는 port와 Reactor handler 등록 port(contract-events의 `core/events/ports.ts`), Router의 `CallStore`(`move`, `read`, `openReceivedBy`)와 `InputTransport`(contract-calls-places의 `core/router/ports.ts`), 앱 source 폴더 읽기(contract-app-calls의 `core/apps/ports.ts`), Settings 기본 실행 옵션(contract-platform의 `protocol/config`). 이름이 계약에 없으면 가장 가까운 port를 쓰고 "계약 바꾸기 요청"에 적는다.
    - domain event `CodingSessionEndedUnreported`·`TicketCompletionReported`·`TicketClaimExpired`(contract-events)
  - 내놓는 것: `createCodingSessions(...)`가 `CodingTransport`, `CodingSessionLookup`, hook·message·harness·terminal 결과 route handler, Reactor handler 셋, 기동 때 `recover()`를 돌려준다. core 조립 목록은 이것을 묶는다.

## 할 일

1. **session 표(메모리)**(`sessions.ts`): `session → { app, ticket, call, harness, state, external_session, queue }`. 상태는 S6 6장대로 `running`, `waiting`, `idle`, `unknown`을 agent event에서 계산하고 알려 주지 않은 것은 `unknown`이다. `CodingSessionLookup.appOf`를 구현한다. 앱 하나에 끝나지 않은 session은 하나뿐이다(S6 2장 2). lophn이 꺼지면 이 표는 사라진다(S1 10장, 입력함은 메모리).
2. **transport**(`transport.ts`, `I3.6#1`, `I3.6#13`): 메서드는 `tx`를 받는 동기 `Result`다(Router의 `InputTransport.deliver`가 같은 tx 안에서 부른다). token 발급·session 표 기록은 tx 안에서 하고, 터미널 요청 frame 전송 같은 비동기 side effect는 commit 뒤에 한다(commit 뒤 훅이 contract-events에 없으면 계약 바꾸기 요청에 적는다).
   - `start`: 감지 보고(`harness-report`가 쌓은 메모리 표)에서 실행 파일을 찾는다. 연결 안 된 제품이면 `not_connected`, `canLaunch`가 아니면 `cannot_launch`, 앱 source 폴더가 없으면 `no_source_folder`로 이유와 함께 돌려준다(실행 옵션을 바꿔 다시 맡길 수 있게). 새 앱의 source 폴더 준비(req-1130)는 앱 쪽 기존 기능을 port로 부르고, 없으면 보고한다.
   - 그 앱에 끝나지 않은 session이 없으면 session id(`ses_…`)를 만들고 `CodingTokens.issue({session, app})`로 token을 만든 뒤 `launchPlanOf`(env에 `CODING_TOKEN_ENV`를 넣는다)로 plan을 짜서 `open` 터미널 요청을 보낸다. 있으면 줄에 세우고 `queued`를 돌려준다.
   - 실행 옵션은 call의 `options`를 쓰고, 빠진 칸은 Settings 기본(contract-platform)으로 채운다(#74).
   - token은 원문을 저장하지 않고 plan의 env에만 담는다. log와 오류에 넣지 않는다.
3. **앱마다 줄**(`lines.ts`, `I3.6#2`): 줄은 메모리다. 앞 session이 끝나면(`SessionEnded`) 다음 call을 연다. 기다리는 동안 `stop`으로 줄에서 뺄 수 있다. `lines()`로 읽는다. lophn이 꺼졌다 켜지면 줄은 없다. 줄에 있던 call을 `failed`(이유: lophn 재시작)로 돌리는 일은 Router 몫이다.
4. **hook 수신**(`hook.ts`, `I3.6#8`, `I3.6#9`): `codingHook` handler. 호출한 coding principal에서 session을 알고, `hookSignalOf(harness, event, payload)`를 부른다. `null`이면 event를 내지 않고 `accepted: false`다. 아니면 S1 agent event(`SessionStarted`, `TurnStarted`, `TurnEnded`, `PermissionRequested`, `PermissionResolved`, `SessionEnded`)로 바꿔 Bus에 낸다. `SessionStarted`에는 hook이 실제로 준 외부 session ID만 잇는다. hook이 없는 제품(hermes, openclaw)은 터미널 `open` 결과가 ok일 때 core가 `SessionStarted`를 낸다(외부 ID 없음). 상태를 계산하고 session snapshot에 낸다.
5. **메시지 넣기**(`I3.6#10`, `transport.send`): idle일 때만 `input` 터미널 요청을 보낸다. 도는 중이면 session의 대기열(메모리)에 두고 `TurnEnded`로 idle이 되면 하나씩 넣는다. 상태가 `unknown`이거나 `canDeliverMessages`가 아니면 넣지 않고 `no_turn_end_signal`·`state_unknown`으로 거절한다("이 harness는 turn 끝을 알리지 않는다"). 사람이 그 탭에 focus해 있으면 shell main이 쥐고 기다린다(요청 설계). 넣은 결과가 ok면 `MessageReceived`를 낸다. 첫 prompt도 argv로 넘긴 경우 `open`이 ok일 때, `paste_after_hook`이면 `SessionStarted` hook을 받은 뒤 `input`으로 넣어 `MessageReceived`를 낸다.
6. **coding agent의 메시지**(`message.ts`, `I3.6#11`): `codingMessageSend` handler. 보낸 쪽 coding session과 근거 ticket을 Router에 "열린 session, 없으면 새 session"으로 맡긴 App Engineer에게 넣는다. ledger에는 안 쓴다.
7. **source diff**(`source-diff.ts`, `I3.6#12`): `codingSourceDiff` handler. release bundle을 읽는 port(contract-app-calls와 contract-releases-problems의 것)로 두 release의 source를 비교한다. source가 보존되지 않았으면 `{ preserved: false, reason }`. 읽는 port가 계약에 없으면 이 handler는 그 port를 가정한 type만 두고 보고한다.
8. **harness 보고**(`harnesses.ts`): `harnessReport`로 받은 감지 결과를 메모리 표에 쓴다. `harnessList`는 제품마다 감지, version, login, `can_launch`, `can_deliver_messages`를 돌려준다.
9. **터미널 결과와 끝**(`terminal.ts`, `I3.6#4`, `I3.6#15`): `codingTerminalFrameSchema` frame을 shell main에 보내는 쪽(Gateway 송신 port는 contract-events의 것)과 `codingTerminalResult`·`codingTerminalExited` handler. `exited`가 오면 `SessionEnded`를 내고, `TicketSessionEnd.settle(session)`을 부르고, `CodingTokens.revoke(session)`을 하고, 줄의 다음 call을 연다. 완료 보고가 있으면 session은 그대로 남거나 끝난다(S6 8장, harness가 정한다).
10. **멈추기**(`transport.stop`, S6 2장 3, 8장 표): call cancel이나 ticket 취소 때 줄에서 빼거나 `stop` 터미널 요청을 보내 session을 멈추고 token을 회수한다. call cancel이면 ticket은 열린 채 남고(claim은 풀린다), ticket 취소면 ticket은 `cancelled`다(tickets 쪽이 처리).
11. **call 닫는 Reactor handler 셋**(`close-call.ts`, `I3.3#15`): `TicketCompletionReported` → call을 `done`, `TicketClaimExpired`·`CodingSessionEndedUnreported` → `failed`로 닫고, 맡긴 App Engineer("열린 session, 없으면 새 session")에 그 사실을 새 입력으로 넣는다. 끌 수 없다. 같은 일 안에서 닫는다. 같은 사실이 Router의 실패 알림으로 한 번 더 가지 않게 한다. 어느 call인지는 session으로 찾는다: `CodingSessionEndedUnreported`는 subject가 session이라 `CallStore.openReceivedBy(tx, session)`으로 찾는다. `TicketCompletionReported`·`TicketClaimExpired`는 subject가 ticket이고 payload에 session이 없다(contract-events). 살아 있는 session 표의 ticket → session으로 찾고, 재시작으로 표가 없으면 찾지 못한다. 그 경우를 막으려면 두 event의 payload에 `session`이 필요하다. 계약 바꾸기 요청에 적는다.
12. **기동 때 복구**(`recover.ts`, `I3.6#17`, `I3.6#5` 중 coding 몫): `recover()`가 `TicketSessionEnd.settleAll()`을 부른다(살아 있는 session이 없으므로 claim이 남은 모든 session을 정산하고, 보고가 없었으면 `CodingSessionEndedUnreported`가 남는다). token은 저장하지 않으므로 회수할 것이 없다. 부르는 위치(core 조립 목록과 기동 순서)는 lead 몫이다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: 해당 없음(새 폴더). `grep -rn "LOPHN_CONNECTION\|observeStream\|ObservationStore\|connection_revoked" packages/core/apps/tickets/coding`이 0줄이다.

## 보고

- 바꾼 file
- 등록할 것:
  - core 조립 목록(wiring)에 `createCodingSessions`가 돌려준 transport, lookup, route handler 다섯(`codingHook`, `codingMessageSend`, `codingSourceDiff`, `harnessReport`·`harnessList`, `codingTerminalResult`·`codingTerminalExited`), Reactor handler 셋, `recover()`(기동 때 한 번)
  - Router에 `CodingTransport` 주입, shell main의 route allowlist에 `coding_agent_terminals.result`·`.exited`와 `coding_agent_harnesses.report`
- 안 쓰게 된 export: 없음(새 폴더)
- 정한 것:
  - 폴더 위치: coding transport 코드가 `core/apps/tickets/coding/`에 있다. 앱 module의 일부로 두는 이유는 token·claim·ticket과 같은 session 수명을 쓰기 때문이다. 별도 module이 낫다고 보면 소유 바꾸기에 적는다.
  - 사람이 focus한 탭에 `input`을 넣을 때의 기한(없는지, 무한한지)
  - 완료 보고 뒤 session을 core가 멈추는지 harness가 끝내게 두는지
- 계약 바꾸기 요청:
  - 위 "쓰는 것"에서 이름이 계약에 없던 port
  - call 닫기 handler가 call을 찾는 방법

- (lead가 더함, coding-agent-tickets가 넘긴 것) reader Worker에 `CodingSessionLookup` 등록이 필요하다. ticket `list`·`show`의 앱 범위 검사가 `snapshot.port(CodingSessionLookup)`을 쓰고, 없으면 `unavailable`이다.
- (lead가 더함, annotation-core가 넘긴 것. 추가 소유, lead 승인: `storage/ledger/reads.ts`의 `port`, `apps/tickets/commands.ts`의 ref 줄) reader의 `snapshot.port`는 등록한 값을 그대로 돌려주는 정적 map이라 snapshot sql이 필요한 lookup(`TicketAnnotationLookup`, `CodingSessionLookup`)을 못 낸다. `connectionAuthFromSnapshot`처럼 snapshot을 받는 factory를 지원하게 한다(추천). 그다음 reader에 `TicketAnnotationLookup`(`annotationLookup(snapshot.sql)`)을 등록한다. 지금 `ticket.show`의 annotation은 늘 null이다. ticket 생성·취소 command가 같은 tx에서 `addRef(sql, annotationId, "ticket", ticketId)`·`removeRefs`(annotations/mod.ts)를 부르게 한다. 안 부르면 ticket 근거 annotation이 sweep에 지워진다.
