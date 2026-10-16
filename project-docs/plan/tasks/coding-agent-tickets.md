# coding-agent-tickets

`core/apps/tickets`를 새 ticket 모델로 고친다. App Engineer가 만들고 고치고 확인(`verify`)하고 취소하며, coding agent가 claim하고 완료 보고한다. claim의 주인은 coding session이다. 확인됨은 App Engineer가 정하고 program은 판정하지 않는다. 화면 읽기, readiness, 채택 질문, 자동 확인, 수리 ticket 예약을 지운다. token이 앱 하나만 열도록 검사한다.

- 단위: coding-agent (wave 3)
- 선행: 없음. 계약 고정 뒤에 열린다. 다른 module은 fake port로 짓는다.
- 소유(이 task만 고친다):
  - `packages/core/apps/tickets/`(`coding/`는 제외. `coding-agent-session`이 가진다)
- 읽을 것:
  - spec: S6 3·8·9장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/coding-agent.md`
  - spec: S1 5장(ticket event) — `.../specs/event.md`, S7 5장(`TicketVerified`가 activation을 연다) — `.../specs/activation.md`, S9 9장 — `.../specs/annotation.md`
  - inventory: `I1.3#5`, `I1.6#20`, `I1.6#21`, `I1.6#22`, `I1.6#23`, `I1.6#24`, `I2.1#8`, `I2.1#9`, `I2.1#12`, `I2.6#26`, `I2.6#27`, `I2.6#28`, `I2.6#29`, `I2.6#30`, `I2.6#31`, `I2.6#32`, `I2.6#33`, `I2.6#34`, `I2.6#35`, `I3.6#18`, `I3.6#19`, `I3.6#20`, `I3.6#21`
  - 결정: `../README.md` 3장 #66·67
  - 계약: `packages/protocol/coding-agent/ticket/`(values, routes, claims, ports), `token.ts`(`CodingSessionLookup`), `transport.ts`(`CodingTransport`). domain event 4개(`TicketVerified`, `TicketCompletionReported`, `TicketClaimExpired`, `CodingSessionEndedUnreported`)는 contract-events의 `protocol/events`다.
- 계약:
  - 쓰는 것:
    - 위 계약 file. 새 ticket route는 deep import(`.../coding-agent/ticket/mod.ts`)로 쓴다.
    - `CodingSessionLookup.appOf(session)`(session → app). 구현은 coding-agent-session이다. 이 task는 fake로 짓는다.
    - `CodingTransport.stop(…)`(ticket 취소가 돌고 있는 session을 멈추게 한다). 구현은 coding-agent-session이다.
    - S2·S4의 Gate는 거치지 않는다. coding agent의 tool call은 harness의 일이다(S2 5장).
  - 내놓는 것:
    - `TicketSessionEnd`(`ticket/ports.ts`)의 구현: `settle(session)`과 `settleAll()`. session이 끝나면 claim을 반납하고, 완료 보고가 없었으면 같은 tx에서 `CodingSessionEndedUnreported`를 낸다. `settleAll()`은 기동 때 쓴다(살아 있는 session이 없으므로 claim을 가진 모든 session을 정산).
    - `checkTicketClaim`: release 준비가 지금 claim을 확인하는 `TicketClaimCheck` port 구현(`session` 기준).
    - ticket 표와 읽기: `createReaderRegistration`·schema step.

## 할 일

1. **schema와 모델**(`schema.ts`, `model.ts`):
   - `tickets.state`를 `open, claimed, reported, verified, failed, cancelled`로. 내용은 `goal`과 `check`(JSON 한 값) 열로 줄이고 `title`·`what`·`why`·`kind`·`inspect`·`preserve`·`problems`·`readiness`·`needs` 열, `ticket_adoption_questions`·`ticket_problems`·`ticket_conditions` 표, `tickets_no_readiness_change` trigger, `ticket_open_repair_problems` 예약 표와 `OPEN_REPAIR_GUARD`를 지운다(`I1.6#20`, `I2.6#26`, `I2.6#27`, `I2.6#35`). 목록 제목은 `goal` 첫 줄로 계산한다. 개발 data는 schema를 고쳐 지우고 새로 만든다. migration을 만들지 않는다.
   - 불변 규칙을 풀어 닫히기 전에는 목표·check·근거를 고칠 수 있게 한다(`I2.6#29`): `tickets_no_identity_change`, `ticket_references`의 `IMMUTABLE` trigger를 지운다. 닫힌(`verified`, `cancelled`) ticket은 고칠 수 없다.
   - `ticket_references`에서 문서 판 칸(`address`, `section`, `version`)을 지우고 근거 kind를 `problem, ticket, release, file, annotation`으로(`I2.6#26`, `I3.6#21`). `check`의 kind는 `test_command, app_test, text`(`I2.6#27`, `I3.6#20`). check 결과(`pass`/`fail`/`inconclusive`와 이유)는 `ticket_check_results`에 보고(completion_seq)마다 한 줄 쓴다. `text` check는 program이 돌리지 않고 `ticket.verify`의 `note`가 App Engineer의 판단이다.
   - `ticket_claims`의 주인을 `session`(ses id)으로(`I2.6#30`). `connection`·`connectionOf`·`connectionAuthSyncPort`·반납 이유 `connection_revoked`를 지운다. 반납 이유는 `ended`, `expired`다.
   - `model.ts`에서 `readinessOf`, `adoptionMatches`, `readyKindsComplete`, `humanConfirmationCoupled`, `createActorAllowed`의 옛 규칙을 지우고(`I1.6#20`, `I1.6#21`), 취소 주체는 사람이나 App Engineer로 한다(`I2.6#32`). `cancelActorAllowed`의 `machine`을 지운다(`I1.6#24`).
2. **채택 질문 의존 끊기**(`I1.3#5`): `ports.ts`가 `core/lophn-agent/tools/handoff`의 `adoptionOf`를 import하지 않게 한다. ticket 생성 검사에서 채택 질문 검사를 지운다(`QUESTION_ADOPTIONS_PORT`).
3. **명령**(`commands.ts`, `claims.ts`, `report.ts`): 계약의 route와 같은 이름으로.
   - `ticket.create`(`make_ready` 지움), `ticket.update`(`I3.6#18`, 닫히기 전에 목표와 check 고침), `ticket.verify`(`I3.6#19`: 보고된 ticket만. 같은 tx에서 `result: verified`면 상태를 `verified`로 두고 `TicketVerified`를 낸다, `failed`면 `failed`. `I2.1#8`), `ticket.cancel`(`I2.6#32`: 취소하면 그 ticket의 coding session을 `CodingTransport.stop`으로 멈추고 token을 회수한다. call은 `cancelled`).
   - `claim`: `open`이나 `failed` ticket을 claim할 수 있다. readiness 조건을 뺀다(`I2.6#31`). 주인은 호출한 coding session이다. `expiry.ts`의 60분 기한과 60초 sweep은 그대로(`I2.1#9`). 만료하면 claim을 정리하고 `TicketClaimExpired`를 낸다(`ticketClaimReleased(reason=expired)` 대신). 시작·갱신·반납은 event가 아니다.
   - `report_completion`: 이름과 `TicketCompletionReported` payload 확인(`I2.1#12`): Reactor가 맡긴 App Engineer와 call을 찾는 데 필요한 칸(ticket, 앱, session, release)이 들어 있는지 본다. 문서 판 `outputs`를 지운다.
   - `ticket.verify`의 결과가 `failed`여도 ticket은 다시 claim할 수 있다.
4. **session 끝**(`I3.6#4` 중 tickets 몫): `TicketSessionEnd.settle(session)`. session이 끝나면 그 session의 claim을 반납한다. 완료 보고가 있었으면 상태는 `reported`로 둔다. 없었으면 같은 tx에서 `CodingSessionEndedUnreported`를 낸다. claim이 없던 session은 아무것도 하지 않는다. `settleAll()`은 claim이 남은 session마다 같은 일을 한다(`I3.6#17`의 tickets 몫).
5. **읽기**(`reads.ts`, `I2.6#33`): `ticket.list`, `ticket.show`만 남긴다. `show`는 내용, 상태, claim, 완료 보고, check 결과를 돌려주고, 근거 annotation은 값(메모, component, source 위치, release, screenshot 파일 경로)으로 풀어 싣는다(`I3.6#21`; annotation 조회 port는 contract-app-calls가 정한 것을 쓰고 없으면 보고). 화면 읽기(`screen_list`, `screen_detail`, `screenStateOf`, `nextActionOf`)를 지운다(`I1.6#22`).
6. **보고 때 검사**(`checks.ts`, `checker/`, `worker/checker.ts`, `I2.6#28`, `I1.6#23`): 보고가 접수될 때 check가 `app_test`나 `test_command`면 그 보고의 release로 돌려 결과와 근거를 `ticket.record_checks`로 남긴다. `text` check는 돌리지 않는다. 판정은 하지 않는다. `checker/judge.ts`(`outcomeOf`, `repairCoverageGap`)와 `ticketConfirmed`·`ticketCheckFailed` 발행을 지운다. 깨우는 방식은 internal subscription(`checker/connection.ts`의 machine:ticket-check-feed)이 아니라 `TicketCompletionReported`에 대한 Reactor handler다. handler 등록 port는 contract-events의 `core/events/ports.ts`다(`I6#5`는 lead 몫이지만 이 구독자의 대체는 여기서 한다).
7. **수리 ticket**: `prepare.ts`(사람 화면 repair 준비)와 `ticket-repair-prepare`를 부르는 곳을 지운다(`I1.6#22`). `problem-work.ts`의 `RepairTicketFact`는 state만 싣는다(`I2.6#34`).
8. **정리**: `register.ts`에서 옛 visibility 정책(`notificationsOnlyVisibility`, `visibleToProblemsWork` 등)과 notifications·problems.work 연결을 지운다(visibility 장치 자체는 events 몫). `mod.ts`의 export를 새 모양에 맞춘다. 앱 하나 범위 검사(아래 위험 test)는 `inScope`를 `CodingSessionLookup`으로 바꿔 한다.

- (lead가 더함, releases-problems-problem-state가 넘긴 것) `core/apps/tickets/ports.ts`가 `select status from problems`를 쓴다. problems 표의 열은 이제 `state`다(실행 때 실패한다). 맞춘다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "coding token은 앱 하나만 연다". 앱 A의 coding session으로 앱 B의 ticket을 읽거나 claim하거나 renew하거나 report하면 `forbidden`이고 ticket 상태가 그대로다(handler 수준, fake `CodingSessionLookup`).
- 남지 않음: `grep -rn "check_failed\|readiness\|adoption\|needs_confirmation\|human_confirmation\|reproduction_test\|ticketConfirmed\|ticketCheckFailed\|connection_revoked\|screenStateOf\|ticket_open_repair" packages/core/apps/tickets`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것:
  - core 조립 목록(wiring)에 새 `register.ts`의 reader registration, schema step, ticket claim sweep timer(`CLAIM_SWEEP_INTERVAL_MS`), `TicketSessionEnd`·`TicketClaimCheck` 구현, Reactor handler(checker 깨우기)
  - `packages/protocol/coding-agent/registry.ts`의 ROUTES를 `ticket/`의 `TICKET_ROUTES`로 교체
- 안 쓰게 된 export: `packages/protocol/coding-agent/ticket-*.ts`, `ports.ts`, `repair-context.ts`가 쓰는 옛 ticket 값 가운데 이 module이 더는 import하지 않는 것
- 정한 것:
  - check 결과 칸의 모양
  - claim 반납 이유 이름
  - checker worker를 남긴 모양(상시 worker 대신 한 번 도는 일로 바꿨는지)
  - 다른 module(`core/apps/releases`, `core/problems`, `core/apps/register.ts`, `core/lophn-agent/tools/bundles/ticket.ts`)이 이 module의 어느 export를 import하는지와 깨질 곳(소유 밖이라 고치지 않는다)
- 계약 바꾸기 요청: 계약의 ticket route와 표가 맞지 않으면 여기에 적는다.

- (lead가 더함, releases-problems-activation가 넘긴 것) activation이 `ReleasePrepared`·`ReleaseActivated`·`ReleaseSuperseded` 등 release event를 더 내지 않는다. 이 event를 깨움 신호로 읽던 tickets checker는 `releases.activated_at` 열이나 `TicketVerified` 흐름으로 바꾼다.
