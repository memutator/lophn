# mail-hold

늦게 온 mail과 만료를 다룬다: 보낸 시각보다 10분 넘게 늦게 닿은 call mail은 돌지 않고 받는 기계의 대기 목록에 서며 사람이 [Start now]를 고를 때만 돈다. [Skip]이면 보낸 쪽 call이 `skipped`로 닫힌다. mail은 7일 뒤 만료되고, 만료된 mail은 받는 쪽이 버리며 보낸 쪽 call은 `expired`로 닫힌다. card는 `mail-hold-card`가 그린다.

- 단위: mail (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/mail.ts`
  - `packages/protocol/remote/allowlist.ts`
  - `packages/core/router/{router.ts,model.ts,ports.ts,commands.ts,mail-store.ts,mod.ts,mail-hold_test.ts}`
  - `packages/core/remote/{mail-entry.ts,mail-drain.ts}`
  - `packages/core/main/daemon/wiring/mail.ts`
- flows(줄만 고친다): `project-docs/flows/areas/agents.yaml`(`mail/holds`, `mail/decide_hold`, `a2a/mail`의 held·expired 갈래), `project-docs/flows/areas/sessions.yaml`(`calls/mail-decide`, `calls/mail-sweep`), `project-docs/flows/tests/core-rest.yaml`
- 읽을 것:
  - 계획 README "정한 것"(늦게 온 mail, 만료), roadmap `a2a-multi-device.md` "늦게 온 mail"과 정한 것 1·11·12·16
  - `project-docs/plan/machine-a2a/tasks/mail-router.md` "계약"(`mail_seen`의 state와 `mail` 칸, `mailAppliedSchema`의 `held`, `state` mail, 실패 이유 `expired`·`skipped`)과 `mail-link.md`(공통 적용, drain timer)
  - architecture: `project-docs/architecture/job.md` 21·24·39와 결정의 "10분"(hold의 본보기), `project-docs/architecture/attention.md`(대기 목록), `project-docs/architecture/remote.md`의 `REMOTE_TERMINAL_DENIED`(사람의 결정을 남기는 route)
  - 본보기: `packages/protocol/jobs/jobs.ts`의 `jobHolds`·`jobDecideHold`, `packages/core/jobs/`의 decide_hold handler
- 계약:
  - 쓰는 것: wave 1이 낸 Router `applyMail`, 표 `mail_seen`·`mail_outbox`, `MAIL_LATE_MS`, `MAIL_EXPIRY_MS`, `ctx.computerGranted`
  - 내놓는 것(`mail.ts`, `mail-hold-card`가 쓴다):
    - `mailHoldSchema = z.strictObject({ origin: idSchema("mch"), mail: idSchema("mal"), computer: z.string(), from: mailAuthorSchema, address: remoteAddressSchema, reply: callReplySchema, text: z.string(), sent_at: atSchema, arrived_at: atSchema, expires_at: atSchema })`. `text`는 본문 글을 500자까지 자른 것이다.
    - `mailHolds = defineMemory({ resource: "mail", method: "holds", name: "mail.holds", input: z.strictObject({}), output: z.strictObject({ holds: z.array(mailHoldSchema) }), actors: ["user"], errors: ["invalid_input", "forbidden", "unavailable"] })`. 오래된 것부터.
    - `mailDecideHold = defineMemory({ resource: "mail", method: "decide_hold", name: "mail.decide_hold", input: z.strictObject({ origin: idSchema("mch"), mail: idSchema("mal"), decision: z.enum(["run_now", "skip"]) }), output: mailAppliedSchema, actors: ["user"], errors: ["invalid_input", "forbidden", "not_found", "conflict", "unavailable"] })`. 이미 정했거나 만료됐으면 `conflict`, 없으면 `not_found`.
    - `StateChanged` change 이름 `mail_holds`(held 줄이 생기고, 정해지고, 만료될 때).
    - `MAIL_HOLD_ROUTES = [mailHolds, mailDecideHold]`.

## 할 일

1. Router `applyMail`: call mail에 대해 (가) `tx.now() > expires_at`이면 돌리지 않고 `seen` state `expired`, 실패 reply mail(`expired`), `{delivery: "failed", reason: "expired"}`. (나) `tx.now() - sent_at > MAIL_LATE_MS`이면 돌리지 않고 `seen` state `held`에 mail JSON을 두고 `{delivery: "held"}`, `via === "folder"`면 `state` mail(`held`)을 넣는다. 늦은 판정은 call mail에만 한다(reply·cancel·state는 늦어도 바로 적용한다). cancel mail이 held 줄의 call을 가리키면 그 줄을 `cancelled`로 닫는다(session을 열지 않는다). 만료된 reply·cancel·state mail은 본 것으로만 적는다.
2. writer 명령(`commands.ts`, machine만):
   - `callsMailDecide` `calls/mail-decide`: input `{ origin, mail, decision, skip_allowed: z.boolean() }`, output `mailAppliedSchema`. held 줄이 없으면 `not_found`, held가 아니면 `conflict`, 만료면 줄을 `expired`로 닫고 실패 mail을 낸 뒤 `conflict`. `run_now`면 늦은 판정 없이 wave 1의 받는 길로 돌리고(`skipAllowed`는 지금의 허락) 줄을 `started`, `state` mail(`running`, session)을 넣는다. `skip`이면 줄을 `skipped`, 실패 reply mail(`skipped`).
   - `callsMailSweep` `calls/mail-sweep`: input `{}`, output `{ expired: number }`. (가) outbox에서 만료된 줄: call mail이고 그 행이 끝나지 않았으면 행을 `failed(expired)`로 끝내 보낸 session에 늦은 실패로 알리고 줄을 지운다. 다른 kind는 지운다. (나) 만료된 held 줄을 `expired`로 닫고 실패 mail. (다) held가 아닌 `mail_seen` 줄 가운데 `2 * MAIL_EXPIRY_MS`보다 옛 것을 지운다(같은 mail이 그 안에 다시 와도 한 번만 돈다).
   - 바뀐 다른 컴퓨터 call 행은 `StateChanged{agent_calls}`, held 줄은 `StateChanged{mail_holds}`.
3. main thread(`remote/mail-entry.ts`, `wiring/mail.ts`):
   - `mail/holds`: main thread 연결로 held 줄을 읽어 `mailHoldSchema`로.
   - `mail/decide_hold`: held mail의 본문을 `prepareBodies`로 준비하고 `callsMailDecide`를 `skip_allowed: ctx.computerGranted(origin)`으로 부른다. 결과에 따라 drain을 깨운다(state·실패 mail이 나간다).
   - drain timer(60초)가 돌 때 `callsMailSweep`도 부른다(`remote/mail-drain.ts`).
4. allowlist: `REMOTE_ALLOWED_ROUTES`에 `mailHolds`, `mailDecideHold`. `REMOTE_TERMINAL_DENIED`에 `mailDecideHold`(사람의 결정을 남기는 route라 `screen` 요청과 폰만 받는다. `jobDecideHold`와 같다).
5. 알림: 새 held 줄에 push와 toast는 내지 않는다(정한 것: 대기 목록 card만. job의 `JobHeld` push를 따라가는 것은 요구가 생기면 한다).

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`packages/core/router/mail-hold_test.ts`, SQLite와 Router. decide는 handler 입력에서 Router까지 한 번):
  - "만료된 call mail은 받는 기계에서 session을 열지 않고, 보낸 기계의 call은 sweep에서 expired로 닫혀 보낸 session에 한 번 알린다"
  - "10분 넘게 늦게 온 call mail은 session을 열지 않고 대기 목록에 서며, Start now에서만 열리고 Skip이면 skipped 실패 mail이 돌아간다"
  - "held mail의 Start now는 그때 그 컴퓨터의 터미널 입력 허락으로 skip을 정한다"
- 남지 않음: `grep -rn "job_runs" packages/core/router packages/core/remote/mail-entry.ts`가 0줄이다(hold를 job 표에 얹지 않았다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `MAIL_HOLD_ROUTES`(→ `packages/protocol/lophn-agent/registry.ts`), `wiring/mail.ts`의 `MAIL_CONTEXT` operations가 바뀌었으면 그 사실
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
