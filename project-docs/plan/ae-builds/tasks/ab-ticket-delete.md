# ab-ticket-delete

ticket을 지운다: 표 6개, claim·연장·만료, 완료 보고와 요약 upload, check와 verdict, examples gate(`checker/`), ticket tool과 route, ticket event(`TicketCompletionReported`, `TicketClaimExpired`, `CodingSessionEndedUnreported`, `TicketVerified`)와 그 wiring(roadmap "지우는 것" 표의 ticket, examples gate 줄). 바깥에서 ticket에 기대던 것은 앞 wave가 뗐다(release, coding 연결, CLI, 근거 링크, package). test runner 안에서 ticket을 import하는 examples 조각도 여기서 지운다(나머지 test runner는 ab-runner-delete). 옛 표는 migration 없이 지운다(AGENTS.md "호환성").

정한 것(flesh):
- `CodingSessionEndedUnreported`의 정의는 `CodingSessionEnded`(subject `ses_…`, payload `{ app }`)로 줄여 남기고 쓰는 곳은 두지 않는다. 이유: README가 coding session 끝에 새 event를 두지 않기로 해서(ab-coding-detach는 command 안에서 call을 닫는다) ticket event를 지우고 ab-runner-delete가 `VerificationRecorded`를 지우면 `DOMAIN_EVENTS`가 빈다. 그러면 Reactor, commit publisher, events wiring의 type이 서지 않는다(빈 `z.discriminatedUnion`은 type 오류이고 `never`에서 `event.seq`를 읽지 못한다. 확인함). 그 코드는 `reactor-remove`의 rr-reactor가 domain event와 함께 지운다. rr-coding-end의 계약("끝 event의 정의는 남지만 쓰는 곳이 없다")과 같은 모양이다.
- id prefix `tkt`는 이 task가 지우지 않는다(ab-runner-delete가 지운다). 이유: ab-runner-delete가 지울 `packages/protocol/problems/tests.ts`(79, 260줄)와 `VerificationRecorded` payload가 아직 `idSchema("tkt")`를 쓴다.
- coding session 앱 조회(`CodingSessionLookup`)의 reader 등록을 annotations 등록으로 옮긴다. 이유: 지금 reader Worker에 그 port를 내는 곳은 `packages/core/apps/tickets/register.ts` 44줄뿐이고, ticket 밖에서 읽는 곳은 `annotations.get`의 coding agent 범위 판정(`packages/core/apps/annotations/reads.ts` 37)이다. 옮기지 않으면 coding agent의 `annotations.get`이 늘 `unavailable`이다.

- 단위: ticket (wave 4)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/tickets/`(지운다)
  - `packages/protocol/coding-agent/ticket/`(지운다)
  - `packages/protocol/coding-agent/registry.ts`
  - `packages/core/apps/agent-tools/ticket.ts`(지운다), `packages/core/apps/agent-tools/mod.ts`
  - `packages/core/agent-roles/tool-lists.ts`
  - `packages/core/main/agent-tools_test.ts`
  - `packages/core/main/daemon/wiring/apps-tickets.ts`(지운다)
  - `packages/core/main/daemon/registration.ts`
  - `packages/core/storage/ledger/{team-module.ts,writer-assembly.ts}`
  - `packages/protocol/events/domain.ts`
  - `packages/core/apps/annotations/{register.ts,ports.ts,reads.ts,retention.ts,schema.ts,blobs.ts,mod.ts}`
  - `packages/core/problems/tests/{examples-request.ts,mod.ts,request-ports_test.ts}`(`examples-request.ts`와 `request-ports_test.ts`는 지운다)
  - `packages/core/events/reactor/reactor_test.ts`, `packages/core/storage/ledger/domain-event_test.ts`(예시 event만)
- 읽을 것:
  - 계획: `project-docs/plan/ae-builds/README.md`의 "정한 것" 가운데 "App Engineer가 coding agent에게 맡기는 흐름을 막는다"(coding session 끝은 새 event 없이 그 command가 call을 닫는다), "옛 표, event, route, schema step은 migration 없이 고치거나 지운다"
  - roadmap: `project-docs/products/roadmap/problem-ticket.md`의 "지우는 것" 표(ticket, examples gate 줄), "정한 것(agent)"의 "ticket을 지운다", "examples gate와 그 실행기를 지운다"
  - architecture: `project-docs/architecture/coding-agent.md`(ticket 절차), `project-docs/architecture/annotation.md` 23-25·49·62·68줄(ticket 근거 ref), `project-docs/architecture/event.md`(domain event). 지금 동작이고 이 task로 틀린다. 문서는 계획 끝에 lead가 고친다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-tickets`, `coding-agent`, `storage`; `project-docs/module-catalog.yaml`의 `packages/core/apps`, `packages/core/main`, `packages/core/storage`
  - 앞 task(brief는 `project-docs/plan/ae-builds/tasks/`): `ab-coding-move.md`·`ab-coding-detach.md`(coding 폴더가 `packages/core/apps/coding/`으로 옮겨 ticket을 모른다), `ab-cli.md`(CLI의 ticket 명령), `ab-publish.md`(`sourceRelativePathSchema`를 apps protocol로), `ab-release-activate.md`(`TicketVerified` 계기), `ab-release-prepare.md`(claim 검사, `ticket_source`), `ab-ticket-refs.md`(`CallRef`의 ticket 갈래)
  - 같은 wave: `ab-runner-delete`가 이 task 뒤에 `domain.ts`, `ids.ts`, 등록 칸을 고친다. `ab-prompt`가 agent-roles의 지침 글을 고친다.
  - 코드(줄은 main `dd956b49f`)
    - 지울 폴더: `packages/core/apps/tickets/`(coding 폴더가 빠진 뒤 약 2.5k줄. 표 `tickets`, `ticket_references`, `ticket_claims`, `ticket_completions`, `ticket_check_results`, `ticket_verdicts`, step `coding-agent.tickets.tables`, blob purpose `ticket_summary`), `packages/protocol/coding-agent/ticket/`(565줄)
    - `packages/core/apps/tickets/register.ts`: `createReaderRegistration` 40-48(`CodingSessionLookup`와 `TicketAnnotationLookup` reader port), `ticketDefinitions` 50-68
    - `packages/core/main/daemon/wiring/apps-tickets.ts` 전체(examples check와 보고 check handler, `VerificationRecorded`·`TicketCompletionReported` Reactor 등록, claim 만료 timer, summary upload). 60초 timer의 `prunePrepared`는 `wiring/storage.ts` 64-68이 따로 돌리므로 잃지 않는다.
    - `packages/protocol/coding-agent/registry.ts` 2, 6
    - `packages/core/apps/agent-tools/mod.ts` 6, 11; `packages/core/agent-roles/tool-lists.ts` 27-28, 60-63, 109-114
    - `packages/core/main/agent-tools_test.ts` 4, 11-39
    - 등록 칸: `packages/core/storage/ledger/team-module.ts` 48, `writer-assembly.ts` 176, `packages/core/main/daemon/registration.ts` 113-115, 121
    - annotations: `register.ts` 10, 33-36, 43-49; `ports.ts` 50-53(`AnnotationLookup`); `reads.ts` 1, 16, 122-125(`annotationLookup`); `retention.ts` 1-2, 7, 25-34(`removeRefs`. 부르는 곳은 tickets뿐이다); `schema.ts` 6, 49; `blobs.ts` 1; `mod.ts` 10, 13, 16
    - `packages/core/apps/coding/lookup.ts`(`codingSessionLookup`. ab-coding-move가 옮겼다)
    - `packages/protocol/events/domain.ts`: ticket event 넷과 `DOMAIN_EVENTS`·`domainEventSchema`의 그 줄(ab-reaction-core가 `ReleaseActivationFailed`와 `DomainEventKind` 표를 이미 지웠다)
    - `packages/core/problems/tests/mod.ts` 6(`requestExamples`)
    - `packages/core/events/reactor/reactor_test.ts` 9, 48, 98, 112; `packages/core/storage/ledger/domain-event_test.ts` 9, 67-68, 86
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것:
    - 위 지운 폴더와 file이 없다. role tool 목록과 `TOOL_ORDER`에 `ticket.*`가 없다.
    - `DOMAIN_EVENTS`는 `CodingSessionEnded`와 `VerificationRecorded`뿐이다(`VerificationRecorded`는 ab-runner-delete가 지운다). `CodingSessionEnded`는 정의만 있고 쓰는 곳과 Reactor handler가 없다(위 "정한 것").
    - team 등록 칸 `ticketDefinitions`가 없다. id prefix `tkt`는 남는다(ab-runner-delete가 지운다).
    - annotation 참조 주인은 `session_message` 하나다(`annotation_refs.owner_kind`, `RefOwner`). annotations는 tickets를 import하지 않는다. `AnnotationLookup`, `annotationLookup`, `removeRefs`가 없다. step `apps.annotations.tables`를 그 자리에서 고친다(개발 data는 지우고 새로 만든다).
    - reader Worker의 `CodingSessionLookup` port는 annotations의 `createReaderRegistration`이 낸다.
    - test runner는 tickets를 import하지 않는다(examples 요청 조각과 그 test가 없다).
  - 등록할 것(lead): `packages/core/main/daemon/assembly.ts`의 `ticketDefinitions` import(10)와 `TEAMS` 줄(60), `createTicketPortsRegistration` import(11)와 `TEAMS` 줄(61), `TEAM_MODULES`의 tickets URL 둘(81-82), `appsTicketsWiring` import(14)와 `WIRINGS` 줄(121). worker는 지운 것을 가리키는 이 줄들만 빼서 check를 통과시키고 여기 적는다(orchestrate review의 예외). `packages/protocol/coding-agent/mod.ts`는 ticket을 다시 내보내지 않는다(확인함).

## 할 일

근거: README "정한 것"과 roadmap "지우는 것" 표. 지우는 이름마다 먼저 `git grep -nw <이름> -- packages tools`로 읽는 곳을 본다. 읽는 곳이 check 밖(`tests/e2e`, `tests/eval`, `tools/check.ts`의 `NOT_CHECKED`)에만 남으면 그대로 지우고 보고에 적는다.

1. 먼저 확인한다(앞 wave land 뒤). 아래와 다르면 고치지 말고 file:줄을 보고하고 멈춘다(앞 wave의 빠짐).
   - `git grep -n "apps/tickets\|coding-agent/ticket\|\.\./tickets/\|\./ticket/" -- packages tools ':!packages/core/apps/tickets' ':!packages/protocol/coding-agent/ticket'`가 이 task 소유(`agent-tools/ticket.ts`, `annotations/{ports.ts,register.ts}`, `main/agent-tools_test.ts`, `wiring/apps-tickets.ts`, `problems/tests/{examples-request.ts,request-ports_test.ts}`, `coding-agent/registry.ts`)와 `packages/core/main/daemon/assembly.ts` 안에만 있다. 상대 경로(`../tickets/`, `./ticket/`)도 보므로 skeleton의 grep보다 넓다. main `dd956b49f`에는 coding 폴더 import(wiring 넷), `releases/commands.ts`, `agent-tools/package.ts`, `coding-token.ts`·test, `packages/coding-agent/connection/ticket-ops.ts`, protocol `cli-commands.ts`·`launch-plan.ts`·`message.ts`가 더 걸린다. 앞 wave가 모두 뗐어야 한다.
   - `git grep -n "reactor\.on(" -- packages/core`가 `wiring/apps-tickets.ts`의 둘(`TicketCompletionReported`, `VerificationRecorded`)뿐이다. coding의 끝 셋은 ab-coding-detach가, `TicketVerified`는 ab-release-activate가 뗐다.
   - `git grep -nE "TicketSessionEnd|TicketClaimCheck|ticketIdSchema|kind: \"ticket\"|ticket_source" -- packages ':!packages/core/apps/tickets' ':!packages/protocol/coding-agent/ticket' ':!packages/core/problems' ':!packages/protocol/problems'`가 0줄이다.
2. 폴더와 file을 지운다: `git rm -r packages/core/apps/tickets packages/protocol/coding-agent/ticket packages/core/apps/agent-tools/ticket.ts packages/core/main/daemon/wiring/apps-tickets.ts packages/core/problems/tests/examples-request.ts packages/core/problems/tests/request-ports_test.ts`. 안의 `*_test.ts`도 같이 없어진다(`tickets_test.ts`, `checker/handler_test.ts`). `request-ports_test.ts`는 ticket 행에 묶인 examples 접수를 보던 test라 설계와 맞지 않아 지운다.
3. protocol: `packages/protocol/coding-agent/registry.ts`에서 `TICKET_ROUTES` import(2)와 `...TICKET_ROUTES,`(6)를 뺀다.
4. agent tool: `packages/core/apps/agent-tools/mod.ts`의 `TICKET_TOOLS`(6, 11)를 뺀다. `packages/core/agent-roles/tool-lists.ts`의 `READ_TOOLS`(27-28), `ROLE_WRITE_TOOLS.app_engineer`(60-63), `TOOL_ORDER`(109-114)에서 `ticket.*` 여섯을 뺀다.
5. `packages/core/main/agent-tools_test.ts` 첫 test: `ticketCreate` 대신 `appConnectSource`(`packages/protocol/apps/apps.ts`, route 이름 `app.connect_source`, tool `app.link_source`)로 바꾼다. App Engineer 상한에 route 이름이 들고 tool 이름(`app.link_source`)은 없으며, Project Manager와 Operator의 상한에는 없다. 판정과 `agentConditions` 부분은 그대로다. test 이름의 tool도 바꾼다. 이 test가 보는 위험은 "상한은 tool 이름이 아니라 route 이름이어야 한다"라서, route 이름과 tool 이름이 다른 App Engineer 전용 쓰기 tool을 고른다(`package.publish`는 둘이 같아 맞지 않는다).
6. 등록 칸
   - `packages/core/storage/ledger/team-module.ts`: `TeamModule.ticketDefinitions`(48)를 지운다.
   - `packages/core/storage/ledger/writer-assembly.ts`: `teamRegistration`의 `team.ticketDefinitions,`(176)를 지운다.
   - `packages/core/main/daemon/registration.ts`: `fromTickets`(113, 121)를 지우고 114-115 주석에서 "(tickets는 빠졌다)"를 뺀다.
   - `packages/core/main/daemon/assembly.ts`: 위 "등록할 것"의 줄만 뺀다.
7. annotations
   - `register.ts`: `TicketAnnotationLookup` import(10)와 `ports`(33-36)를 지운다. `createReaderRegistration`의 port Map에 `[CodingSessionLookup, snapshotPort((s) => codingSessionLookup(s.sql))]`를 넣고(import: `CodingSessionLookup`은 `packages/protocol/coding-agent/token.ts`, `codingSessionLookup`은 `../coding/lookup.ts`, `snapshotPort`는 `../../storage/ledger/mod.ts`), 47줄 주석을 "coding agent의 `annotations.get`이 자기 앱을 이 port로 찾는다"로 고친다. 안 쓰게 된 `defineTxPort`, `annotationLookup` import를 지운다.
   - `ports.ts`: `AnnotationLookup`(50-53)을 지운다. `reads.ts`: `annotationLookup`(122-125)과 그 type import(16)를 지우고 1줄 주석에서 ticket 근거를 뺀다.
   - `retention.ts`: `RefOwner`는 `"session_message"` 하나다. `removeRefs`(25-34)는 부르던 곳이 tickets뿐이라 지운다. 1-2줄 주석에서 ticket을 뺀다.
   - `schema.ts`: `annotation_refs.owner_kind`의 CHECK를 `IN ('session_message')`로, 6줄 주석을 "session 기록(session_message)이다"로 고친다. step `apps.annotations.tables`는 그 자리에서 고친다. migration을 만들지 않는다.
   - `blobs.ts` 1줄 주석의 "선언 방식은 tickets/blobs.ts와 같다."를 뺀다. `mod.ts`의 `annotationLookup`(10), `removeRefs`(13), `AnnotationLookup`(16) export를 뺀다.
8. `packages/protocol/events/domain.ts`
   - `ticketCompletionReported`, `ticketClaimExpired`, `ticketVerified`와 `DOMAIN_EVENTS`·`domainEventSchema`의 그 줄을 지운다.
   - `codingSessionEndedUnreported`를 `codingSessionEnded = defineEvent("CodingSessionEnded", { subject: idSchema("ses"), payload: z.strictObject({ app: idSchema("app") }) })`로 바꾸고 `DOMAIN_EVENTS`·`domainEventSchema`의 줄을 맞춘다. 위에 이유 한 줄을 단다("쓰는 곳이 없다. 목록이 비면 Reactor와 commit publisher의 type이 서지 않아 Reactor를 지울 때 같이 지운다" 같은 것).
   - 27줄 주석(완료 보고 session)은 event와 함께 지운다.
9. `packages/core/problems/tests/mod.ts`의 `requestExamples` export(6)를 뺀다. test runner의 다른 file은 고치지 않는다(`request-ports.ts`가 SQL 글로 `tickets` 표를 읽는 것은 ab-runner-delete가 폴더째 지운다).
10. 예시 event: `reactor_test.ts`와 `domain-event_test.ts`에서 `ticketVerified`를 `codingSessionEnded`로 바꾼다. subject는 `tx.newId("ses")`, payload는 `{ app: tx.newId("app") }`, `on("CodingSessionEnded", …)`, 기대 type `"CodingSessionEnded"`다. `domain-event_test.ts` 67줄 상태 행 id는 `tx.newId("app")`로 바꾼다. 판정은 그대로다.
11. 이 worktree의 `.dev-data/`에 옛 data root가 있으면 지운다. 지운 step(`coding-agent.tickets.tables`)과 고친 step(`apps.annotations.tables`)이 적용된 root는 `history_mismatch`로 뜨지 않는다(AGENTS.md "호환성").
12. 아래 "남지 않음"을 돌려 소유 file의 주석과 오류 글을 고친다. 소유 밖에 남은 것은 고치지 않고 보고한다.

## 끝남

- `deno task check`가 통과한다.
- 바꾼 곳의 test: `deno test --no-check -A packages/core/main/agent-tools_test.ts packages/core/apps/annotations packages/core/events packages/core/storage/ledger/domain-event_test.ts packages/core/problems`
- core가 뜬다: `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다(reader 등록과 schema step이 바뀐다. reader port 중복은 기동 때만 드러난다).
- 위험 test: 없음. 지우기만 한다. 같이 지우는 `tickets_test.ts`의 "coding token은 앱 하나만 연다"는 ticket route의 앱 범위였고 그 route가 없어진다. coding token이 앱 하나만 여는 것은 `packages/core/server/identity/coding-token_test.ts`가 그대로 본다. 첫 test(`agent-tools_test.ts`)는 대상만 바꿔 같은 권한 경계를 계속 본다.
- 남지 않음
  - `git grep -n -i "ticket" -- packages tools ':!packages/design/wording/rules.ts' ':!tools/context-review.ts' ':!packages/core/problems' ':!packages/protocol/problems' ':!packages/protocol/base/ids.ts' ':!packages/core/agent-roles/roles' ':!packages/core/agent-roles/place/place-data.ts' ':!packages/core/agent-roles/credentials.ts' ':!packages/core/lophn-agent/agents/resolve_test.ts' ':!packages/core/lophn-agent/tools/registry_test.ts' ':!packages/core/server/identity/registry_test.ts'`가 0줄이다. 뺀 것: wording 용어 규칙, 주석의 boundary ID(`app-tickets`), ab-runner-delete가 지울 test runner와 `tkt` prefix(`ids.ts`), 같은 wave ab-prompt의 지침 글, 실제 tool이 아닌 이름을 test 재료로 쓰는 test 셋(`ticket.list`, `ticket.create`, `ticket.show`). 남은 것은 file:줄로 보고한다.
  - `git grep -nwE "TICKET_ROUTES|TICKET_TOOLS|ticketDefinitions|createTicketPortsRegistration|appsTicketsWiring|TicketAnnotationLookup|TicketEvidenceLookup|AnnotationLookup|annotationLookup|removeRefs|requestExamples|ticketVerified|ticketCompletionReported|ticketClaimExpired|codingSessionEndedUnreported|TicketVerified|TicketCompletionReported|TicketClaimExpired|CodingSessionEndedUnreported" -- packages tools`가 0줄이다.
  - `git grep -n "CodingSessionLookup, snapshotPort" -- packages/core`가 `packages/core/apps/annotations/register.ts` 한 줄이다.
  - `git ls-files packages/core/apps/tickets packages/protocol/coding-agent/ticket`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 위 계약의 "등록할 것"(assembly.ts에서 뺀 줄을 줄 번호와 함께). 문서는 계획 끝 lead 몫이지만 README의 문서 목록에 없는 `project-docs/architecture/annotation.md`(ticket 근거 ref)도 틀리게 된다는 것을 적는다
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 1의 확인 결과
- check 밖에 남은 것: `tests/e2e`, `tests/eval`, check 밖 `tests/support`에서 지운 이름(`packages/protocol/coding-agent/ticket/mod.ts`의 route, ticket event)을 쓰는 file 목록
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것"을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 적어도: `CodingSessionEnded`는 쓰는 곳 없는 정의로 `reactor-remove`까지 남는다
