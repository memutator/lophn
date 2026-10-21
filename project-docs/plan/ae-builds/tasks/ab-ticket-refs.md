# ab-ticket-refs

call의 근거 링크에서 `ticket` 갈래를 지운다: protocol의 `CallRef`, 받은 turn의 글, call tool 설명, 대화 화면의 근거 chip과 그 문구. ticket 링크를 만들던 곳(Router의 coding 맡기기, coding 끝 알림, `ReleaseActivationFailed` reaction)은 앞 wave가 지웠다. ticket 모듈 자체는 ab-ticket-delete가 지운다. 화면은 `ui-design` skill(gallery는 renderer의 fake source로 그린다), 문구는 `wording` skill이다.

정한 것: gallery fake의 첫 envelope(보낸 쪽 `reaction`, "Activation failed", "make a ticket")을 남은 reaction인 coding session 끝 알림으로 바꾼다. 이유: ab-reaction-core가 `ReleaseActivationFailed`를 지워서 지금 fake는 없는 일과 ticket을 그린다. 뒤 계획의 `project-docs/plan/reactor-remove/tasks/rr-screens.md` 할 일 3이 이 모양에서 보낸 쪽만 program으로 바꾼다.

- 단위: ticket (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/calls.ts`(`CallRef`의 ticket 갈래와 그 주석만)
  - `packages/core/lophn-agent/run-loop/{input-text.ts,input-text_test.ts}`
  - `packages/core/lophn-agent/tools/bundles/call.ts`(설명 글만)
  - `packages/shell/renderer/conversation/{agent-tab-core-source-thread.ts,agent-tab-source.ts,agent-tab-fake-source.ts}`
  - `packages/shell/renderer/conversation/thread/sender-chip.tsx`
  - `packages/design/wording/catalog/`
- 읽을 것:
  - 계획: `project-docs/plan/ae-builds/README.md`의 "App Engineer가 coding agent에게 맡기는 흐름을 막는다"와 "화면"(대화의 근거 chip의 ticket 갈래를 지운다)
  - 앞 task: `project-docs/plan/ae-builds/tasks/ab-router.md`("내놓는 것": `launchCoding`과 `call` 설명의 coding 맡기기를 지운다. ticket 근거 링크는 이 task), `ab-coding-detach.md`("내놓는 것": coding 폴더가 ticket ref를 만들지 않고, 끝 알림은 고정 글 하나 `CODING_REACTION_TEXTS`다), `ab-reaction-core.md`(`session-opening.ts`를 지운다). 뒤 task: `ab-ticket-delete.md`(ticket 모듈과 `packages/protocol/coding-agent/ticket/`)
  - 뒤 계획: `project-docs/plan/reactor-remove/tasks/rr-screens.md` 할 일 3(이 fake의 `sender-chips`를 이어서 고친다)
  - 화면: `.claude/skills/ui-design/SKILL.md`("먼저 알아둘 것"), `.claude/skills/wording/SKILL.md`("key를 지우기 전에")
  - architecture: `project-docs/architecture/agent-call.md` 21줄(보낸 쪽 넷), 43줄(body와 refs만 간다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `router`, `run-loop`, `agent-tools`, `shell`, `design`; `project-docs/module-catalog.yaml`의 `packages/protocol`, `packages/core/lophn-agent`, `packages/shell/renderer`
  - 코드(줄은 main `dd956b49f`)
    - `packages/protocol/lophn-agent/calls.ts` 83-94(주석 83, `refSchemas` 84-90의 ticket 갈래 86). 받은 메시지 기록과 입력의 refs(`packages/protocol/lophn-agent/inputs.ts` 26, 57), Router command 입력(`packages/core/router/commands.ts` 46)은 이 schema를 그대로 쓴다. 따로 고칠 것이 없다.
    - `packages/core/lophn-agent/run-loop/input-text.ts` 45-56(`refText`, `case "ticket"` 47-48). `input-text_test.ts`는 ticket ref를 쓰지 않는다(reaction 예는 wave 2의 ab-reaction-core가 바꾼다).
    - `packages/core/lophn-agent/tools/bundles/call.ts` 38(`refs: links {kind: ticket|file|session|annotation, ...}`). 34, 37, 39줄의 coding agent 문장은 ab-router가 wave 1에서 고친다.
    - `packages/shell/renderer/conversation/agent-tab-source.ts` 88-94(`EvidenceRef.kind`)
    - `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts` 147-160(`refsOf`, `case "ticket"` 150-151)
    - `packages/shell/renderer/conversation/thread/sender-chip.tsx` 27-32(`EVIDENCE_LABEL`), 119(주석 "ticket·파일·annotation")
    - `packages/shell/renderer/conversation/agent-tab-fake-source.ts` 389-448(`case "sender-chips"`. `reaction` envelope 390-399와 그 ticket ref 393-397, lophn envelope이 `reaction.refs`를 빌리는 403, coding envelope의 ticket ref 410-414, 받은 글 423-440). 이 scene은 gallery `new-agent-sender-chips`(`tools/wireframes/pages/screens/agent.tsx` 59-64)가 그리고 마지막 chip(coding)의 panel을 열어 둔다.
    - `packages/shell/renderer/conversation/agent-view.tsx` 498-500: `onOpenRef`는 `file`만 연다. 고칠 것이 없다(소유 밖).
    - wording: `packages/design/wording/catalog/conversation.ts` 115(`conversation.label.evidence-ticket`)
    - type check가 못 잡는 곳: main 기준 `packages/core/apps/tickets/coding/close-call.ts` 43-48, `message.ts` 26-33은 refs를 `as CallRef[]`로 만든다. ab-coding-move가 `packages/core/apps/coding/`으로 옮기고 ab-coding-detach가 ticket ref를 지운다. 그래서 할 일 1의 grep으로 본다.
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: `CallRef`는 `file | session | annotation` 셋이다(받은 메시지 기록의 refs도 같다). 받은 turn의 글에 `ticket …` 줄이 없다. call tool 설명의 refs 종류에 ticket이 없다. renderer `EvidenceRef.kind`에 `ticket`이 없고 wording `conversation.label.evidence-ticket`이 없다. fake source(gallery)의 ticket 근거 링크는 다른 갈래로 바뀐다.

## 할 일

근거: README "App Engineer가 coding agent에게 맡기는 흐름을 막는다"(ticket을 지운다)와 "화면". ticket ref를 만드는 곳은 앞 wave가 모두 지웠고 받는 쪽만 남았다.

1. 먼저 확인한다. 다르면 고치지 말고 file:줄을 보고하고 멈춘다.
   - `git grep -n 'kind: "ticket"\|ref.kind === "ticket"' -- packages tools tests/harness ':!packages/core/apps/tickets' ':!packages/core/problems' ':!packages/protocol/coding-agent/ticket'`가 이 task 소유 file(renderer `conversation/`의 `agent-tab-source.ts`, `agent-tab-core-source-thread.ts`, `agent-tab-fake-source.ts`)에만 나온다.
   - `packages/core/events/reactor/session-opening.ts`가 없고(ab-reaction-core), `packages/core/router/router.ts`에 `launchCoding`이 없다(ab-router).
2. protocol: `calls.ts` `refSchemas`에서 `kind: z.literal("ticket")` 줄을 지운다. 주석의 "annotation은 ticket evidence와 같은 {kind, id} 꼴이다"는 비교할 것이 없어지므로 지운다("근거 링크."만 남긴다).
3. core
   - `input-text.ts` `refText`의 `case "ticket"`을 지운다.
   - `input-text_test.ts`는 ticket을 쓰지 않으면 고치지 않는다.
   - `call.ts` 설명의 `refs: links {kind: ticket|file|session|annotation, ...}`에서 `ticket|`를 지운다. ab-router가 고친 다른 문장은 그대로 둔다.
4. renderer(gallery는 이 fake source로 그린다)
   - `agent-tab-source.ts`: `EvidenceRef.kind`에서 `"ticket"`을 지운다.
   - `agent-tab-core-source-thread.ts`: `refsOf`의 `case "ticket"`을 지운다.
   - `sender-chip.tsx`: `EVIDENCE_LABEL`의 `ticket`을 지우고, 119줄 주석의 "ticket·"을 뺀다.
   - `agent-tab-fake-source.ts`의 `case "sender-chips"`("정한 것")
     - `reaction` envelope: sender를 `{ kind: "reaction", event: "Coding session ended" }`로, 맡긴 글을 `packages/core/apps/coding/close-call.ts`의 `CODING_REACTION_TEXTS` 값(영어 그대로)으로, refs를 끝난 coding session 하나(`{ kind: "session", text: "Claude Code · Eval board", target: sessionId(9) }`)로 바꾼다. 받은 글 `received(1, …)`의 "Eval board stopped restarting after 5 crashes in 2 minutes."도 같은 고정 글로 바꾼다.
     - lophn envelope은 `reaction.refs`를 빌리지 않고 annotation 근거 하나를 갖는다(예: `{ kind: "annotation", text: "Scenario list", target: fakeId("ann", 12) }`).
     - coding envelope: ticket ref를 지우고, 실제 coding 메시지처럼 보낸 coding session ref(`{ kind: "session", text: "Claude Code · Eval board", target: sessionId(9) }`)와 지금의 file ref를 둔다.
     - 그래서 scene 전체에 file, session, annotation 세 갈래가 다 보인다. 변수 이름과 다른 글은 그대로 둔다.
5. wording(`wording` skill)
   - `conversation.label.evidence-ticket`을 지운다. 지우기 전에 앞부분 `conversation.label.evidence-`로 `packages`와 `tools`를 grep한다(catalog 제외). main 기준 쓰는 곳은 `sender-chip.tsx`의 `EVIDENCE_LABEL` 하나이고 template 호출은 없다.
   - catalog에서 이 task가 고치는 것은 `conversation.ts`와 그 생성물 `conversation.placeholders.ts`뿐이다.
   - `deno task wording`으로 placeholders를 다시 만든다(손으로 고치지 않는다). `deno run --allow-read tools/check-wording.ts`를 돈다.
6. 개발 data에 ticket ref가 든 받은 메시지나 call 행이 있으면 읽기에서 걸린다. migration을 만들지 않고 개발 data를 지우고 새로 만든다(AGENTS.md "호환성").

## 끝남

- `deno task check`가 통과한다. renderer를 고쳤으니 `deno run -A packages/shell/renderer/build.ts`도 된다.
- `deno task wireframes`가 되고, gallery `new-agent-sender-chips`의 열린 panel에 Ticket 줄이 없고 Session과 File 근거가 보인다(보는 법은 ui-design "확인").
- 위험 test: 없음. union 갈래 지우기와 화면, 문구다. 받은 turn의 글은 `input-text_test.ts`가 이미 본다(`.claude/skills/write-test/SKILL.md` "쓰지 않는 test").
- 남지 않음
  - `git grep -n 'kind: "ticket"\|z.literal("ticket")\|case "ticket"\|=== "ticket"\|evidence-ticket' -- packages tools ':!packages/core/apps/tickets' ':!packages/core/problems' ':!packages/protocol/coding-agent/ticket'`가 0줄이다.
  - `git grep -n -i "ticket" -- packages/protocol/lophn-agent packages/core/lophn-agent/run-loop packages/core/lophn-agent/tools/bundles/call.ts packages/shell/renderer/conversation`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없으면 "없음"(예상: 없음)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
