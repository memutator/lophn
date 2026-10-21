# pr-problem-refs

problem id를 가리키는 참조 갈래를 지운다: call의 refs `{ kind: "problem" }`와 ticket 근거 `{ kind: "problem" }`. `problems` 표가 없어지면(`pr-problems-core`) 이 둘이 가리킬 곳이 없고, ticket 근거 검사는 그 표를 SQL로 읽다가 `unavailable`로 닫힌다.

- 단위: problem-refs (wave 3)
- 선행: pr-reactions. reaction이 만들던 problem ref를 거기서 지운다.
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/calls.ts`
  - `packages/protocol/coding-agent/ticket/values.ts`
  - `packages/core/apps/tickets/schema.ts`
  - `packages/core/apps/tickets/ports.ts`
  - `packages/core/apps/tickets/commands.ts`
  - `packages/core/apps/tickets/tickets_test.ts`
  - `packages/core/apps/agent-tools/ticket.ts`
  - `packages/core/lophn-agent/run-loop/input-text.ts`
  - `packages/core/lophn-agent/run-loop/input-text_test.ts`
  - `packages/core/lophn-agent/tools/bundles/call.ts`
  - `packages/shell/renderer/conversation/agent-tab-source.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts`
  - `packages/shell/renderer/conversation/agent-tab-fake-source.ts`
  - `packages/shell/renderer/conversation/thread/sender-chip.tsx`
  - `packages/design/wording` (key만)
- 읽을 것:
  - architecture: `project-docs/architecture/agent-call.md`(봉투의 body와 refs, "보낸 쪽의 대화 원문은 넘기지 않는다. body와 refs만 간다"), `project-docs/architecture/agent-definition.md`(Router가 넣는 입력의 `lophn-` tag와 근거 줄)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-tickets`, `router`, `run-loop`, `agent-tools`, `shell`, `project-docs/module-catalog.yaml`의 `packages/core/apps`, `packages/core/lophn-agent`, `packages/shell/renderer`
  - 제품 결정: `project-docs/plan/problem-remove/README.md` "뼈대 검토에서 정한 것"의 "problem을 가리키던 곳은 같이 지운다", AGENTS.md "호환성"(옛 표·schema step은 migration 없이 고치고 개발 data는 새로 만든다)
  - 본보기(코드): `packages/core/storage/migration/migrations.ts`(이미 적용된 step의 글이 바뀌면 `history_mismatch`로 거절한다), `packages/core/apps/tickets/reads.ts`(근거 행을 `{ kind, id }`로 그대로 푼다)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것:
    - call refs 갈래: `ticket | file | session | annotation`(`packages/protocol/lophn-agent/calls.ts`)
    - ticket 근거 갈래: `ticket | release | file | annotation`(`packages/protocol/coding-agent/ticket/values.ts`, tickets 표의 CHECK). 옛 행은 migration 없이 버린다(개발 data는 새로 만든다).
    - 지운다: `TicketEvidenceLookup`의 `problemApp`(tickets `ports.ts`), call tool과 `ticket.create` 설명의 problem 줄, 화면 근거 칩의 problem 갈래

## 할 일

1. call refs(`packages/protocol/lophn-agent/calls.ts` `refSchemas` 83-91): problem 갈래(87)를 지운다.
2. ticket 근거(`packages/protocol/coding-agent/ticket/values.ts`): `ticketEvidenceSchema`(91-97)와 `ticketEvidenceReadSchema`의 둘째 갈래(118-123)에서 problem을 지우고, 90줄 주석의 "문제,"를 뺀다.
3. tickets 표(`packages/core/apps/tickets/schema.ts`): `ticket_references.kind`의 CHECK(64)를 `('ticket', 'release', 'file', 'annotation')`로 바꾸고, 5줄 주석의 cross-owner FK 목록에서 `problems`를 뺀다. step을 새로 더하지 않고 있는 step의 글을 고친다. 옛 개발 data는 `history_mismatch`로 기동이 거절되니 `.dev-data/`를 지우고 새로 만든다(AGENTS.md "호환성").
4. 근거 조회(`packages/core/apps/tickets/ports.ts`): `TicketEvidenceLookupPort.problemApp`(20)과 그 구현(46)을 지운다. `appOf`(32-42)의 table 인자는 `"releases"` 하나가 되므로 `releaseApp` 구현으로 접거나 타입을 줄인다. 17-18줄 주석("problem, release", "두 표")을 고친다.
5. 근거 검사(`packages/core/apps/tickets/commands.ts` `checkEvidence` 263-272): problem 갈래를 지워 `item.kind === "release"`일 때만 `lookup.releaseApp`으로 본다. 오류 글(`evidence ${item.kind} is not in this app`)은 release 하나에 맞춘다.
6. tool 설명
   - `packages/core/apps/agent-tools/ticket.ts` 79줄 `ticket.create` 설명: "(problem, ticket, release, file, annotation)" → "(ticket, release, file, annotation)"
   - `packages/core/lophn-agent/tools/bundles/call.ts` 37줄: "ticket|problem|file|session|annotation" → "ticket|file|session|annotation"
7. 받은 입력 글(`packages/core/lophn-agent/run-loop/input-text.ts` `refText` 46-59): `case "problem"`(49-50)을 지운다.
8. 화면
   - `packages/shell/renderer/conversation/agent-tab-source.ts` 89줄 `EvidenceRef.kind`에서 `"problem"`을 뺀다.
   - `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts` `refsOf`의 `case "problem"`(151-152)을 지운다.
   - `packages/shell/renderer/conversation/thread/sender-chip.tsx`: `EVIDENCE_LABEL`의 `problem`(29)을 지우고 120줄 주석의 "problem·"을 뺀다.
   - `packages/shell/renderer/conversation/agent-tab-fake-source.ts`의 `sender-chips`(423-433): 재시작 멈춤은 더 reaction이 아니므로 남는 activation 실패 reaction 예로 바꾸고 근거를 ticket으로 바꾼다(예: event "Activation failed", body "Release … failed to activate (migration_failed). Read the evidence and make a ticket that fixes the cause.", refs `[{ kind: "ticket", text: "…", target: fakeId("tkt", 12) }]`). 아래 lophn 봉투가 `reaction.refs`를 그대로 쓰니 같이 맞는지 본다.
9. wording: `packages/design/wording/catalog/conversation.ts`의 `conversation.label.evidence-problem`(124)을 지우고 `deno task wording`, `deno run --allow-read tools/check-wording.ts`를 돌린다.
10. test: `packages/core/apps/tickets/tickets_test.ts`와 `packages/core/lophn-agent/run-loop/input-text_test.ts`는 problem 근거를 쓰지 않는다. type check가 깨질 때만 맞춘다.

## 끝남

- `deno task check`가 통과한다. 화면을 건드렸으니 `deno run -A packages/shell/renderer/build.ts`도 된다.
- 위험 test: 없음. 갈래를 지우는 일이고, 남는 release 근거의 "이 앱의 것" 검사는 바뀌지 않는다.
- 남지 않음: `grep -rn -E "kind: z\.literal\(\"problem\"\)|kind: \"problem\"|case \"problem\"|problemApp|evidence-problem" packages tools --include=*.ts --include=*.tsx | grep -v packages/protocol/problems/`가 0줄이고, `grep -n "'problem'" packages/core/apps/tickets/schema.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없으면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
