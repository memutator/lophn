# mail-link

mail의 main thread 쪽을 짠다: agent가 부르는 보내는 입구(`calls/send_remote`), 다른 컴퓨터가 부르는 받는 입구(`a2a/mail`), outbox를 link로 내보내는 drain. 판정은 이 기계의 자료로 한다(명단, call 정책, 터미널 입력 허락). 본보기는 다른 컴퓨터의 앱 command 호출이다.

- 단위: mail (wave 1)
- 선행: mail-router
- 소유(이 task만 고친다):
  - `packages/core/remote/{mail-entry.ts,mail-drain.ts,mail_test.ts}` (새 file)
  - `packages/core/remote/call.ts`
  - `packages/core/main/daemon/wiring/mail.ts` (새 file)
  - `packages/core/main/daemon/wiring/context.ts`
- flows(줄만 고친다): `project-docs/flows/areas/agents.yaml`(`calls/send_remote`, `a2a/mail`의 flow), `project-docs/flows/areas/core-platform.yaml`(drain의 `system:` flow 하나), `project-docs/flows/tests/core-rest.yaml`
- 읽을 것:
  - 계획 README "정한 것"(받는 쪽 입구, 보내는 쪽 검사, mail은 응답을 기다리지 않는다, outbox, reply·실패·취소, 결과를 모르는 mail, 옛 판의 상대)
  - `project-docs/plan/machine-a2a/tasks/mail-router.md` "계약" 전부
  - architecture: `project-docs/architecture/remote.md` "컴퓨터끼리의 연결", "넘기는 call의 요청한 쪽", "이름 풀기", "연결 하나의 한도"; `project-docs/architecture/approval.md`의 "다른 기계로 넘긴 call"; `project-docs/architecture/agent-call.md` 지키는 것 4·20(본문 준비, redaction)
  - 본보기: `packages/core/apps/calls/forward.ts`(보내는 쪽 검사, `machines.call`의 `by`, `LOST`), `packages/core/apps/calls/remote-entry.ts`(받는 쪽 입구), `packages/core/remote/call.ts`(`by` 거르기, `REQUESTER`), `packages/core/main/daemon/wiring/app-calls.ts`(memory handler가 machine 자격으로 writer 명령을 부르는 꼴), `packages/core/main/daemon/wiring/router.ts`의 `prepareBodies`(본문 blob 준비)
- 계약:
  - 쓰는 것: `mail-router`가 고정한 `a2aMail`, `callSendRemote`, `mailSchema`, `mailAppliedSchema`, writer 명령 `callsMailSend`·`callsMailApply`·`callsMailRefuse`·`callsMailSent`, topic `MAIL_QUEUED_TOPIC`, 함수 `pendingMails`·`outboxPeers`·`remoteReach`·`remoteWorkspaceOf`(`packages/core/router/mod.ts`), `ctx.machineLinks`(`RemoteMachines`), `ctx.deviceKind`, `ctx.terminalInputGrant`, `ctx.machine.id`
  - 내놓는 것: late key `mailInbox: { apply(input: { mail: Mail; origin: Id<"mch">; via: "link" | "folder" }): Promise<Result<MailApplied>> }`(`context.ts`). 폴더 길(`mail-carry`)이 같은 입구로 적용한다. origin이 명단의 컴퓨터가 아니면 `forbidden`이고, 허락(skip)은 `ctx.computerGranted(origin)`으로 본다.

## 할 일

1. `wiring/mail.ts`(새 wiring `mail`): machine 자격 `MAIL_CONTEXT`(principal `machine:mail`, operations는 `calls/mail-*` 넷)를 `records()`로 남기고, memory handler 둘과 drain을 낸다. writer는 `ctx.writer`(접은 writer)로 부른다. `withAfterCommit`로 `MAIL_QUEUED_TOPIC`을 받아 그 peer의 drain을 깨운다. 읽기는 `openConnection(ctx.ledgerPath)`로 연 main thread 연결로 한다(`app-calls.ts`와 같다).
2. 보내는 입구 `calls/send_remote`(`remote/mail-entry.ts`의 handler, actor agent). 순서(forward.ts와 같은 자리, 다른 점은 줄마다 적었다):
   1. `ctx.conditions.session`이 없으면 `forbidden`. `remoteReach(sql, session, policy)`: private이면 `forbidden`, 받은 mail로 열린 session이면 `forbidden`(forward.ts의 hop 검사와 같은 뜻이다).
   2. 할당 검사는 없다: 명단의 컴퓨터는 mail을 받는다(roadmap 정한 것 5). forward.ts와 다른 점이다.
   3. `ctx.machineLinks.resolve(to.machine)`. 이 컴퓨터면 `invalid_input`("that is this computer; send the call without --on"), 없으면 그 `not_found`, 같은 이름 여럿이면 그 `invalid_input`.
   4. 주소: session 꼴은 그대로, agent 꼴은 `remoteWorkspaceOf`로 workspace를 기계를 건너는 꼴로 바꾼다.
   5. 본문: 글 block만(`image`, `resource_link`, `resource`가 있으면 `invalid_input` "only text goes to another computer"). `redactBlocks(createProductRedactor(ctx.knownSecrets), body)`. 글 byte가 `MAIL_TEXT_MAX_BYTES`를 넘으면 `invalid_input`.
   6. `callsMailSend {session, turn: ctx.conditions.turn ?? null, dedup, self: ctx.machine.id, peer: {machine, computer: name}, address, reply, body}`. 결과 `{call, state, fail_reason}`를 그대로 돌려준다. link는 기다리지 않는다(README: command lane을 쥐지 않는다).
3. 받는 입구 `a2a/mail`(`remote/mail-entry.ts`, actor user = 기기 자격):
   1. principal이 `device:`이고 `ctx.deviceKind(principal) === "computer"`가 아니면 `forbidden`("only a computer in the roster sends mail").
   2. 요청한 쪽이 `agent`가 아니면 `forbidden`. 이를 위해 `remote/call.ts`가 `apps/remote_call`처럼 `a2a/mail`에도 `REQUESTER`를 자격 옆에 싣는다(한 줄. 다른 route는 그대로).
   3. 기기 id로 명단의 컴퓨터를 찾는다(`ctx.machineLinks.computers()`). `mail.from.machine`이 그 컴퓨터의 기계가 아니거나 `mail.to_machine !== ctx.machine.id`면 `forbidden`. 터미널 입력 허락은 받을지에는 보지 않는다(README. 본보기와 다른 점).
   4. 공통 적용 `applyMail(mail, origin, via)`(아래 4)로 넘긴다.
4. 공통 적용(link와 폴더가 같이 쓴다. `mailInbox.apply`로도 낸다): 본문 준비 → `callsMailApply {mail, origin: {machine, computer}, skip_allowed: ctx.computerGranted(machine), via}`.
   - 본문 준비는 `prepareBodies(ctx.bodyPrepare, MAIL_CONTEXT, ...)`로 받는 session 기록에 쓰일 글을 미리 blob으로 만든다: call·reply의 body(redaction을 한 번 더 거친다), 실패 reply면 `FAILURE_TEXTS[reason]`, cancel이면 `CANCEL_TEXT`.
   - 결과가 `not_found`·`forbidden`·`invalid_input`·`conflict` 오류면(tx가 되돌아가 본 기록도 없다) `callsMailRefuse {mail, origin, reason}`(conflict는 `closed`, 나머지는 `not_found`)를 부르고 `{delivery: "failed", reason, session: null}`. `unavailable`·`internal`은 오류 그대로 돌려준다(보낸 쪽이 다음 drain에 같은 id로 다시 보낸다).
5. drain(`remote/mail-drain.ts`): peer마다 한 번에 하나. 깨우는 때: `MAIL_QUEUED_TOPIC`, bus `StateChanged`의 change `remote_devices`(link 상태가 바뀜), 60초 timer(`ctx.clock`, timer는 주입), 기동 뒤 한 번.
   - `outboxPeers` → peer마다 `ctx.machineLinks.list()`에서 connected가 아니면 넘긴다. `pendingMails(sql, peer)`를 seq 순으로 보낸다: `machineLinks.call(device, {resource: "a2a", method: "mail", body: {mail}}, by)`. lane과 deadline은 기본(120초)이다. `by = {kind: "agent", agent: mail.from.agent, session: mail.from.session, name: mail.from.name}`(받는 쪽은 종류만 믿는다).
   - 답: ok면 `callsMailSent {result: {kind: "acked", applied}}`. `unavailable`이고 `details.sent === true`면 `{kind: "unknown"}`을 적고 그 peer를 멈춘다(받는 쪽이 id로 걸러 다음에 다시 보내도 한 번만 돈다. README "결과를 모르는 mail"). `not_found`(그 route를 모른다)나 `invalid_input`(그 판이 이 mail의 꼴을 읽지 못한다)이면 `{kind: "refused"}`(call은 `old_version`으로 닫힌다)이고 다음 줄로 간다. 그대로 두면 그 peer의 줄이 영영 막힌다. 그 밖의 오류(`unavailable` sent false, `forbidden` 등)는 그 peer를 멈추고 다음 때에 다시 한다.
6. `context.ts`: late key `mailInbox`(위 "내놓는 것").

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`packages/core/remote/mail_test.ts`. handler 입력에서 writer와 Router까지 한 번 이어 본다. core 전체가 무거우면 실제 writer·Router 등록과 SQLite ledger 하나로):
  - "명단의 컴퓨터가 아닌 기기(폰, 모르는 기기, from.machine이 link의 기계와 다른 mail)가 보낸 mail은 Router에 닿지 않는다"
  - "터미널 입력 허락이 없는 컴퓨터가 보낸 mail로 열린 session은 skip인 agent여도 묻는 session이고, 허락이 있는 컴퓨터면 agent의 skip을 따른다"
  - "private workspace의 session과 받은 mail로 열린 session은 send_remote가 forbidden이고 outbox에 줄이 생기지 않는다"
  - "drain에서 상대가 not_found로 답하면 call이 old_version으로 닫히고, 답을 잃으면 delivery가 unknown으로 남아 다음 drain에 같은 mail id가 다시 간다"
- 남지 않음: `grep -rn "a2a/mail_v2\|sendRemoteV2" packages tests`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `mailWiring`(→ `packages/core/main/daemon/assembly.ts`의 `WIRINGS`, `routerWiring` 뒤이고 `remoteWiring` 앞. `remoteWiring`은 schema step 순서 때문에 맨 뒤에 남는다. `machineLinks` 같은 late key는 부를 때 `ctx.peek`로 읽으므로 순서와 상관없다), `MAIL_ROUTES`가 아직 등록되지 않았으면 같이(→ `packages/protocol/lophn-agent/registry.ts`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". (늦게 온 mail의 hold와 만료는 wave 2다. 이 task에서는 link가 다시 붙어 늦게 간 mail도 바로 돈다)
