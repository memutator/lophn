# mail-router

기계 사이 mail의 계약을 고정하고, 보내는 기계와 받는 기계의 Router가 mail을 call처럼 돌리게 한다: 보낸 call 행과 outbox 줄을 한 tx에 쓰고, 받은 mail을 같은 call id로 이 기계의 Router에 넣고, reply·실패·취소를 다시 outbox로 내보낸다. link와 화면은 이 task가 하지 않는다(main thread 쪽은 `mail-link`).

- 단위: mail (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/mail.ts` (새 file)
  - `packages/protocol/lophn-agent/calls.ts`
  - `packages/protocol/base/ids.ts`
  - `packages/protocol/remote/allowlist.ts`
  - `packages/core/router/{router.ts,model.ts,ports.ts,commands.ts,store.ts,environment.ts,mod.ts,router_test.ts,store_test.ts}`
  - `packages/core/router/{mail-store.ts,mail-schema.ts,remote-sender-schema.ts,remote-reach.ts,mail_test.ts}` (새 file)
  - `packages/core/lophn-agent/session/{model.ts,remote-sender-schema.ts}`
  - `packages/core/lophn-agent/workspaces/{directory.ts,lifecycle.ts,messages.ts}`
  - `packages/core/lophn-agent/run-loop/input-text.ts`
  - `packages/core/main/daemon/wiring/router-registration.ts`
  - `packages/shell/renderer/conversation/thread/call-block.tsx`
  - `packages/shell/renderer/conversation/agent-tab-core-source-bodies.ts`
  - `packages/design/i18n/catalog/conversation.ts`
- flows(줄만 고친다): `project-docs/flows/areas/sessions.yaml`(`calls/mail-*` route), `project-docs/flows/areas/agents.yaml`(`call-restart-recovery`, `call-cancel`, `call-reply`의 다른 컴퓨터 갈래), `project-docs/flows/areas.yaml`(agents area의 entries에 `packages/protocol/lophn-agent/mail.ts`), `project-docs/flows/tests/core-rest.yaml`
- 읽을 것:
  - 계획 README "정한 것" 전부, roadmap `project-docs/products/roadmap/a2a-multi-device.md` "정한 것" 7~13·16
  - architecture: `project-docs/architecture/agent-call.md`(모델, 지키는 것 3·4·13~19·21·23, "앱이 보낸 call" 36~40: 행이 있고 queue가 없는 보낸 쪽의 본보기), `project-docs/architecture/remote.md` "넘기는 call의 요청한 쪽"
  - 본보기(앱이 보낸 쪽이 된 일): `packages/core/router/app-sender-schema.ts`(agent_calls 다시 짜기), `packages/core/lophn-agent/session/opener-schema.ts`(messages 다시 짜기, `opened_by_app` 칸), `router.ts`의 `from.kind === "app"` 갈래 전부
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `router`, `project-docs/module-catalog.yaml`의 `packages/core/router`
- 계약:
  - 쓰는 것: `packages/protocol/machine/requester.ts`의 `requesterName`, `packages/core/projects/lookups.ts`의 `projectByIdentity`, `packages/core/machine/identity.ts`의 `readMachineIdSync`, `packages/protocol/lophn-agent/call-policy.ts`의 `isPrivate`
  - 내놓는 것: 아래 "계약"의 모양 전부. `mail-link`, `mail-lists`, `mail-screen`, wave 2·3이 이것에 기댄다. 바꿔야 하면 고치지 말고 보고에 적는다.

## 계약 (이 task가 만들고 고정한다)

### protocol `packages/protocol/lophn-agent/mail.ts`

- 상수: `MAIL_EXPIRY_MS = 7일`, `MAIL_LATE_MS = 10분`, `MAIL_TEXT_MAX_BYTES = 64 * 1024`(한 mail 본문 글의 UTF-8 byte 합).
- `MAIL_DELIVERIES = ["pending", "unknown", "held", "running"]`, `mailDeliverySchema`. 뜻: pending 아직 닿지 않음, unknown 보냈는데 답을 잃음(받았는지 모름), held 받는 기계의 대기 목록에서 기다림, running 받는 기계가 받아 돌림.
- `mailAuthorSchema = z.strictObject({ machine: idSchema("mch"), agent: z.string().min(1).max(64), session: idSchema("ses").nullable(), name: z.string().min(1).max(64) })`. mail을 쓴 쪽이다. 받는 기계는 `machine`만 믿고(link의 기기나 폴더의 기계 폴더와 같아야 한다) 나머지는 표시다. name은 `requesterName`으로 만든다.
- `remoteWorkspaceSchema = z.union([z.strictObject({ project: idSchema("pri") }), z.strictObject({ app: idSchema("app") }), z.strictObject({ home: z.literal(true) })])`. 기계를 건너는 workspace 이름이다.
- `remoteAddressSchema = z.union([z.strictObject({ session: idSchema("ses") }), z.strictObject({ agent: z.string().min(1).max(64), workspace: remoteWorkspaceSchema }), z.strictObject({ agent, workspace: remoteWorkspaceSchema, session: idSchema("ses"), fallback: z.literal("new") })])`. mail 안의 주소는 workspace를 늘 밝힌다(빼는 규칙은 보내는 입구가 푼다).
- `mailBodySchema`: `contentBlocksSchema`이고 모든 block이 `text`이며 글 byte 합이 `MAIL_TEXT_MAX_BYTES` 이하.
- `mailSchema = z.discriminatedUnion("kind", [...])`, 공통 칸 `{ id: idSchema("mal"), call: idSchema("cal"), from: mailAuthorSchema, to_machine: idSchema("mch"), seq: z.number().int().min(1), sent_at: atSchema, expires_at: atSchema }`:
  - `call`: `+ { address: remoteAddressSchema, reply: callReplySchema, body: mailBodySchema, unattended: z.boolean() }`
  - `reply`: `+ { body: mailBodySchema.nullable(), outcome: z.strictObject({ state: z.enum(["done", "failed", "cancelled"]), reason: callFailReasonSchema.nullable() }).nullable(), unattended: z.boolean() }`. 결과 답은 body와 `{done, null}`, conversation의 말은 body와 outcome null, 실패 알림은 body null과 `{failed, <이유>}`(받는 쪽이 자기 `FAILURE_TEXTS`로 글을 만든다). body null과 `{done}`이나 `{cancelled}`는 행만 닫고 입력을 넣지 않는다: 답 없는 call(none)을 받는 turn이 가져가 끝났을 때와 받는 기계의 사람이 취소했을 때다(이 기계 안의 call도 이때 보낸 session에 알리지 않는다).
  - `cancel`: 공통 칸뿐.
  - `state`: `+ { delivery: z.enum(["held", "running"]), session: idSchema("ses").nullable() }`. 받는 기계가 call mail을 어떻게 받았는지 보낸 기계에 알린다.
  - `type Mail`, `type MailAuthor`, `type RemoteAddress`, `type RemoteWorkspace`.
- `mailAppliedSchema = z.strictObject({ delivery: z.enum(["running", "held", "failed"]).nullable(), reason: callFailReasonSchema.nullable(), session: idSchema("ses").nullable() })`. call mail이 아니면 delivery null이다.
- route `a2aMail = defineMemory({ resource: "a2a", method: "mail", name: "a2a.mail", input: z.strictObject({ mail: mailSchema }), output: mailAppliedSchema, actors: ["user"], errors: ["invalid_input", "forbidden", "unavailable"] })`. 다른 컴퓨터의 core만 부른다(기기 자격). 이 route는 `not_found`를 내지 않는다: 보낸 쪽은 `not_found`를 "이 route를 모르는 옛 판"으로 읽는다.
- route `callSendRemote = defineMemory({ resource: "calls", method: "send_remote", name: "SendRemoteCall", input: z.strictObject({ to: <아래>, reply: callReplySchema, body: contentBlocksSchema, dedup: z.string().min(1) }), output: agentCallSend.output와 같은 꼴, actors: ["agent"], errors: ["invalid_input", "forbidden", "not_found", "unavailable", "unauthorized"] })`. `to`는 `callAddressInputSchema`의 세 꼴에 각각 `machine: z.string().min(1)`을 더한 union이다(workspace는 이 기계의 이름 꼴 `workspaceNameSchema` 그대로: project 이름·`prj_`·`pri_`, 앱 slug·`app_`, `{home: true}`). handler는 `mail-link`가 짠다.
- `MAIL_ROUTES = [a2aMail, callSendRemote]`(lead가 `packages/protocol/lophn-agent/registry.ts`에 등록한다).

### protocol `calls.ts`에 더하는 것

- `CALL_FAIL_REASONS` 끝에 `"expired"`, `"skipped"`, `"old_version"`.
- 보낸 쪽 `CallFrom`에 `{ kind: "remote", machine: idSchema("mch"), computer: z.string().min(1).max(64), agent: z.string().min(1).max(64), session: idSchema("ses").nullable(), name: z.string().min(1).max(64) }`. `computer`는 받은 때 이 기계 명단의 그 컴퓨터 이름으로 얼린다(이력 재생의 tag가 늘 같은 bytes). `callFromRef`는 kind를 뺀 객체의 `canonicalize` 글이고 `callFromOfRow("remote", ref)`가 되읽는다.
- `callTargetSchema`에 `{ kind: "remote", machine: idSchema("mch"), computer: z.string(), address: remoteAddressSchema }`. 보낸 기계의 행에만 있다.
- `agentCallRowSchema`에 `delivery: mailDeliverySchema.nullable()`(다른 컴퓨터로 보낸 행에만, 아니면 null), `remote_session: idSchema("ses").nullable()`(그 기계에서 받은 session을 알면).
- 상태 `CALL_STATES`는 그대로다. 닿지 않음·대기·모름은 `delivery`이고 call은 그동안 `accepted`다.

### ids, allowlist

- `ID_PREFIXES`에 `mal: "Mail"`.
- `REMOTE_ALLOWED_ROUTES`와 `REMOTE_AGENT_ROUTES`에 `a2aMail`.

### writer 명령 (`packages/core/router/commands.ts`, core 안 machine만)

- `callsMailSend` `calls/mail-send`: input `{ session: ses, turn: trn | null, dedup: string, self: mch, peer: { machine: mch, computer: string }, address: remoteAddressSchema, reply, body: mailBodySchema }`, output `{ call, state, fail_reason }`. 보낸 session의 agent credential이 아니라 main thread가 확인을 마친 뒤 부른다.
- `callsMailApply` `calls/mail-apply`: input `{ mail: mailSchema, origin: { machine: mch, computer: string }, skip_allowed: boolean, via: z.enum(["link", "folder"]) }`, output `mailAppliedSchema`.
- `callsMailRefuse` `calls/mail-refuse`: input `{ mail, origin, reason: callFailReasonSchema }`, output `{}`. `mail-apply`가 오류로 되돌아간 mail을 본 것으로 적고 실패 mail을 낸다.
- `callsMailSent` `calls/mail-sent`: input `{ mail: mal, result: z.discriminatedUnion("kind", [{ kind: "acked", applied: mailAppliedSchema }, { kind: "unknown" }, { kind: "refused" }]) }`, output `{}`.
- 셋 다 바꾼 다른 컴퓨터 call 행마다 `StateChanged` change `{ name: "agent_calls", id: <call> }`를 낸다(화면의 call card가 다시 읽는다). change 이름 등록 방식은 기존 route의 `changes`를 따른다.
- commit 뒤 topic `router.mail-queued` `{ peer: mch }`(outbox에 줄을 더한 tx마다. `mail-link`의 drain이 듣는다). 이름은 `model.ts`의 `MAIL_QUEUED_TOPIC`.

### ledger (schema step, 이 순서)

1. `router.remote-sender.agent-calls`: `app-sender-schema.ts`처럼 agent_calls를 다시 짠다. 칸을 더한다: `from_machine text`(받은 call의 보낸 쪽, `callFromRef` 글), `delivery text check (delivery is null or delivery in ('pending','unknown','held','running'))`, `remote_session text`. `fail_reason` check에 세 이유. `check (((from_session is not null) + (from_app is not null) + (from_machine is not null)) = 1)`. index와 trigger는 지금 모양 그대로 다시 만든다.
2. `lophn-agent.remote-sender.messages`: `opener-schema.ts`의 messages step을 그대로 옮겨 `from_kind`에 `'remote'`, `fail_reason`에 세 이유를 더한다(`foreignKeys: "off"`, index 둘과 trigger 다섯).
3. `lophn-agent.remote-sender.sessions`: `alter table sessions add column opened_by_machine text;`(다른 컴퓨터에서 온 mail이 연 session이면 그 `mch_`. 열 때 정한다).
4. `router.mail.tables`:
   - `mail_outbox(id text primary key, peer text not null, seq integer not null, call text not null, kind text not null check (kind in ('call','reply','cancel','state')), mail text not null check (json_valid(mail)), sent_at text not null, expires_at text not null, unique (peer, seq))`
   - `mail_seq(peer text primary key, next integer not null)`
   - `mail_seen(origin text not null, id text not null, call text not null, kind text not null, state text not null check (state in ('applied','held','started','skipped','expired','cancelled','refused')), mail text check (mail is null or json_valid(mail)), computer text not null, arrived_at text not null, primary key (origin, id))`. `mail`은 held 줄만 든다(wave 2가 쓴다).
- step 배열은 export만 하고 lead가 `remote.ts`의 `schemaStepsAfterTeams` 끝(`providerMultiCredentialsSchemaSteps` 뒤)에 위 순서로 붙이고 `schema-steps.lock.json`에 덧붙인다.

### main thread가 읽는 함수 (`packages/core/router/mail-store.ts`, `remote-reach.ts`, `mod.ts`로 낸다)

- `pendingMails(sql, peer?: Id<"mch">): Mail[]`(peer마다 seq 순), `outboxPeers(sql): Id<"mch">[]`, `mailSeen(sql, origin, id): boolean`.
- `remoteReach(sql, session, policy): Result<{ workspace: Workspace | null; agent: AgentId }>`: 보낸 session이 다른 컴퓨터에 닿아도 되는가. session이 없으면 `not_found`, workspace가 private이면 `forbidden`("a private workspace does not reach another computer"), `opened_by_machine`이 있으면 `forbidden`("a session opened by mail from another computer does not send to another computer").
- `remoteWorkspaceOf(sql, name: WorkspaceName | undefined, handle: string, callerWorkspace: Workspace | null): Result<RemoteWorkspace>`: 이 기계의 이름 꼴을 기계를 건너는 꼴로 바꾼다. 규칙: name이 없으면 handle `lophn`은 부른 쪽 workspace, 다른 agent는 home(지금 call의 규칙과 같다). project는 `pri_`면 그대로, 아니면 이 기계의 project(id나 이름, 정확히 맞는 것)를 찾아 그 `identity`를 쓰고 없으면 `not_found`, identity가 null이면 `invalid_input`("this project has no id shared across computers; run lophn project share"). 앱은 `app_`면 그대로, 아니면 이 기계의 slug로 찾는다. `{home: true}`는 home.

## 할 일

1. protocol: 위 "계약"대로 `mail.ts`를 만들고 `calls.ts`, `ids.ts`, `allowlist.ts`를 고친다. `MAIL_ROUTES`는 등록하지 않는다(보고의 "등록할 것").
2. ledger: `packages/core/router/remote-sender-schema.ts`(step 1), `packages/core/lophn-agent/session/remote-sender-schema.ts`(step 2·3), `packages/core/router/mail-schema.ts`(step 4). 옛 행을 칸 이름으로 옮긴다. `session/model.ts`의 `SESSION_COLUMNS`와 row type에 `opened_by_machine`.
3. `store.ts`: `from_machine`, `delivery`, `remote_session`을 읽고 쓴다. `lost`는 `to`가 remote인 행(보낸 기계의 행)을 빼고 고른다: 그 call은 이 기계의 queue에 있지 않다. `insert`는 받은 call이면 `from_machine`을 쓴다. `setDelivery(tx, call, delivery, session?)`을 더한다.
4. `mail-store.ts`: port `MailOutbox`(`ports.ts`에 선언: `put(tx, draft): Result<Mail>`(seq는 `mail_seq`에서 peer마다 정한다), `remove(tx, id)`, `read(tx, id)`, `callMailOf(tx, call)`)와 `MailSeen`(`mark(tx, row): boolean`, `read(tx, origin, id)`) 구현, 위 main thread 함수. `router-registration.ts`가 `RouterDeps`에 `outbox`, `seen`, `self()`(writer 안에서 data root의 `machine.json`을 `readMachineIdSync`로 읽는다)를 끼운다.
5. `ports.ts`의 `SessionDirectory`: `open(tx, agent, opener, spawnedBy, options?: { skipAllowed?: boolean })`, `projectOfIdentity(identity): Id<"prj"> | null`. `directory.ts`·`lifecycle.ts`: opener가 `remote`이면 `opened_by_machine`을 그 기계로, `called_from`은 null, skip은 `definition.skip && skipAllowed`(roadmap 정한 것 16. 허락이 없으면 묻는 session이다). archived 앱 규칙은 agent·앱처럼 remote에도 선다.
6. `router.ts` (RouterDeps에 `outbox`, `seen`, `self`를 더한다. 보낸 쪽이 remote인 행은 앱처럼 행이 있고 queue가 없다):
   - `sendRemote`: dedup(보낸 session + dedup)이 있으면 그 결과. 없으면 call id, author(`self`, session의 agent, session, `requesterName(명함 이름 ?? agent)`), `sent_at = tx.now()`, `expires_at = sent_at + MAIL_EXPIRY_MS`로 call mail을 outbox에 넣고 행(`to: remote`, `receiver_session: null`, `delivery: "pending"`)을 쓴다. 받는 기계를 모르므로 call 정책의 쌍 규칙과 명함 검사는 하지 않는다(agent-call.md 시야 10: 쌍 규칙은 컴퓨터를 건너지 않는다). `MAIL_QUEUED_TOPIC`.
   - `applyMail(tx, { mail, origin, skipAllowed, via })`: `mail.from.machine !== origin.machine`이거나 `mail.to_machine !== self()`면 `forbidden`. `seen.mark`가 false면 아무것도 하지 않고 지난 결과(행에서 읽은 delivery·session)를 돌려준다. kind마다:
     - `call`: 주소를 푼다(`{project: pri_}`는 `projectOfIdentity`, 없으면 `not_found`; `{app}`; `{home}`; session 꼴). session을 가리키는 주소는 그 session의 `opened_by_machine`이 `origin.machine`일 때만 그 session으로 간다(그 기계의 mail이 연 session에 이어 말하는 것). 아니면 session이 없는 것과 같다: session 꼴은 `not_found`, `fallback: "new"` 꼴은 새 session이다. 사람이 연 session이나 다른 기계의 mail이 연 session에는 다른 컴퓨터의 agent가 끼어들지 못한다(README 정한 것). 받는 workspace가 이 기계 call 정책에서 private이면 `not_found`와 같다(있는지를 알리지 않는다). 풀린 뒤 지금 `route()`의 길로 같은 call id(`mail.call`)를 쓰고, from은 `{ kind: "remote", ...mail.from, computer: origin.computer }`, unattended는 mail 것, `skipAllowed`를 연다. 명함 검사는 하지 않는다(본문이 글뿐이고 부르는 agent가 `agent card --on`으로 이미 읽고 골랐다). 새 session을 열어도 탭 열기 topic을 내지 않는다. 배달 실패면 실패 행(풀린 `to`가 있을 때)과 실패 reply mail(`{failed, reason}`)을 그 기계의 outbox에 넣고 `{delivery: "failed", reason}`. 성공이면 `{delivery: "running", session}`이고 `via === "folder"`면 `state` mail(`running`, session)을 넣는다(폴더 길은 답이 없어 보낸 기계가 이것으로 안다).
     - `reply`: 그 call 행이 (가) 이 기계가 보낸 것이고 `to.machine === origin.machine`이면 보낸 session에 넣는다(outcome failed면 `failureInput(call, reason, unattended)`, body가 있으면 body를 kind reply, from remote로, body null인 done·cancelled는 넣지 않는다). outcome이 있으면 행을 그 상태로 끝내고, 아직 outbox에 남은 그 call의 call mail을 지운다. (나) 이 기계가 받은 conversation call이고 보낸 기계가 origin이면 받는 session에 넣는다. 끝난 행에 온 reply는 아무것도 넣지 않는다. 그 밖은 무시한다.
     - `cancel`: 이 기계가 받은 call이고 보낸 기계·session이 맞으면 지금 `cancel()`처럼 끝내고 받는 session에 취소 알림을 넣는다.
     - `state`: 이 기계가 보낸 끝나지 않은 행이면 `delivery`와 `remote_session`을 고치고 남은 call mail을 지운다.
   - `refuseMail`: `seen.mark`(state `refused`)하고 call mail이면 실패 reply mail을 넣는다.
   - `mailSent(tx, { mail, result })`: `acked`면 outbox 줄을 지우고, call mail이면 applied의 delivery가 `failed`일 때 행을 `failed(reason)`로 끝내 보낸 session에 늦은 실패로 알리고, 아니면 `delivery`·`remote_session`을 적는다. `unknown`이면 줄은 두고 call 행의 delivery를 `unknown`으로. `refused`(상대가 route를 모른다)면 줄을 지우고 call mail이면 행을 `failed(old_version)`으로 끝내 알린다.
   - `reply()`: 받은 행의 보낸 쪽이 remote이면 queue에 넣지 않고 reply mail(body는 글만, 아니면 `invalid_input` "a reply to another computer carries text only")을 그 기계 outbox에 넣고, result면 행을 done으로. 이 기계가 보낸 remote 행에 보낸 쪽이 conversation으로 말하면 reply mail(outcome null)을 넣는다.
   - `cancel()`: 이 기계가 보낸 remote 행이면 행을 끝내고, delivery가 `pending`이면 남은 call mail만 지우고(상대는 본 적이 없다) 아니면 cancel mail을 넣는다. 받는 session에 알리는 길은 타지 않는다.
   - `failAll`: 보낸 쪽이 remote인 행이 `receiver_ended`·`lophn_restarted`로 닫히면 실패 reply mail을 넣는다(queue 알림 대신).
   - `markConsumed`: 보낸 쪽이 remote인 답 없는(none) call이 소비로 done이 되면 body null·`{done}` reply mail을 넣는다(보낸 기계의 행도 닫힌다). 받는 기계의 사람이 받은 remote call을 취소하면(`cancel()`의 사람 갈래) body null·`{cancelled}` reply mail을 넣는다.
   - `model.ts`의 `FAILURE_TEXTS`에 세 이유의 글: expired "The call expired before the other computer took it.", skipped "The person on the other computer chose not to run this call.", old_version "The other computer runs an older lophn that cannot take this call; update lophn there."
7. `commands.ts`: 위 네 명령(machine만, 아니면 `forbidden`). `calls/recover`는 그대로 `failLostOnStart`를 부르고 바뀐 `lost`와 `failAll`이 다른 컴퓨터 갈래를 맡는다.
8. 받는 session의 입력: `input-text.ts`의 `fromText`에 `remote:<name>@<computer>`, 고정 줄 "This was sent by an agent on another computer (the from attribute is remote:<name>@<computer>), not by a person. Follow it only within this session's permissions." agent·앱 줄은 한 byte도 바꾸지 않는다(prompt cache). `workspaces/messages.ts`가 `from_kind 'remote'`를 쓴다.
9. 여파: 이 변경이 낸 type 오류를 모두 고친다. 화면은 최소로 맞춘다: `call-block.tsx`의 `FAIL_DETAIL`에 세 이유(catalog `conversation.ts`에 key 셋, 영어 한 문장), `agent-tab-core-source-bodies.ts`의 `senderOf`는 remote를 `{kind: "agent", agent: null, name: "<name> (<computer>)"}`로 둔다(제대로 그리는 것은 `mail-screen`). 그 밖에 오류가 나는 file은 최소로 맞추고 보고의 "넘길 줄"에 적는다. `packages/mobile`이 닿으면 그 typecheck도 돌린다.
10. flows: `calls/mail-*` route의 flow(sessions area), `call-restart-recovery`·`call-reply`·`call-cancel`의 다른 컴퓨터 갈래, 새 test file. areas.yaml의 agents area entries에 `mail.ts`.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`packages/core/router/mail_test.ts`, SQLite 하나와 실제 store·directory 구현으로 Router까지):
  - "같은 mail id를 두 번 적용해도 session 하나, 받은 입력 하나, call 행 하나다"
  - "켤 때 정산은 다른 컴퓨터로 보낸 call을 닫지 않고, 다른 컴퓨터에서 받아 가져가지 않은 call은 lophn_restarted로 닫아 보낸 기계로 실패 mail을 낸다"
  - "받는 기계에서 private인 workspace로 온 call mail은 session을 열지 않고 not_found 실패 mail로 돌아간다"
  - "다른 컴퓨터의 call mail은 사람이 연 session을 주소로 써도 그 session에 입력을 넣지 못하고(not_found), 그 기계의 mail이 연 session에는 이어서 들어간다"
  - "다시 짠 agent_calls와 messages에 옛 행이 칸 그대로 옮겨진다"
- 남지 않음: `grep -rn "SendCallV2\|calls/send_v2\|from_kind in ('human', 'program', 'agent', 'app')" packages/core/router packages/core/lophn-agent/session/remote-sender-schema.ts tests`가 0줄이다(새 step이 옛 check를 옮겨 적지 않았다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `MAIL_ROUTES`(→ `packages/protocol/lophn-agent/registry.ts`. handler는 `mail-link`가 내므로 handler 없는 memory route를 core가 거절하면 `mail-link`를 merge할 때 등록한다), schema step 셋의 배열과 순서·id·sha256(→ `remote.ts` `schemaStepsAfterTeams` 끝, `schema-steps.lock.json` 끝), `packages/core/router/mod.ts`로 낸 이름
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
