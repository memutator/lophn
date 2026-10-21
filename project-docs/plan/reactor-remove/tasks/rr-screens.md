# rr-screens

Reactor가 없어져 뜻을 잃은 화면 조각을 지운다. Diagnostics의 `events` 구성 요소와, 대화의 보낸 쪽 chip 가운데 실제 source가 만들지 않는 `reaction` 갈래다. `ui-design` skill로 gallery(renderer의 fake source)부터 맞추고 문구는 `wording` skill이다.

- 단위: screens (wave 2)
- 선행: rr-reactor. core가 `events` component 점검을 내지 않아야 `DIAGNOSTIC_COMPONENTS`에서 뺄 수 있다.
- 소유(이 task만 고친다):
  - `packages/protocol/diagnostics/diagnostics.ts`(`DIAGNOSTIC_COMPONENTS`만)
  - `packages/shell/renderer/desktop/settings/diagnostics/`
  - `packages/shell/renderer/conversation/{agent-tab-source.ts,agent-tab-fake-source.ts}`(`Sender`의 `reaction` 갈래와 `sender-chips` 장면만)
  - `packages/shell/renderer/conversation/thread/sender-chip.tsx`
  - `packages/design/wording/catalog/{workspace-settings.ts,workspace-settings.placeholders.ts,conversation.ts,conversation.placeholders.ts}`(지우는 key만. placeholders는 `deno task wording`이 만든다)
  - `tools/wireframes/pages/screens/agent.tsx`(`new-agent-sender-chips` 설명만)
- 읽을 것:
  - 계획: `project-docs/plan/reactor-remove/README.md`의 "목표"(Reactor를 지운다)와 "정한 것"(Diagnostics의 `events` 점검을 지운다. 입력 종류 `reaction`은 coding session 끝 알림 하나로 남는다)
  - 앞 task: `project-docs/plan/reactor-remove/tasks/rr-reactor.md`의 "정한 것"(core가 `events` component 점검을 내지 않는다)
  - 화면: `.claude/skills/ui-design/SKILL.md`("먼저 알아둘 것": gallery는 renderer component를 fake source로 그린다), `.claude/skills/wording/SKILL.md`("key를 지우기 전에")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `diagnostics`, `shell`, `design`; `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
  - 코드(줄은 main `15f282fcd`. 다른 계획 `agent-definition`의 ad-commands도 `agent-tab-source.ts`, `agent-tab-fake-source.ts`, `agent.tsx`, `conversation.ts`를 고친다. 그쪽이 먼저 main에 land했으면 줄 대신 아래 이름(`Sender`, `case "sender-chips"`, `new-agent-sender-chips`, key 이름)으로 찾는다)
    - `packages/protocol/diagnostics/diagnostics.ts` 50-57(`DIAGNOSTIC_COMPONENTS`, `"events"` 53)
    - `packages/shell/renderer/desktop/settings/diagnostics/model.ts` 13-14(`componentName`), `testdata/fake-source.ts` 17. gallery page `settings-diagnostics`(`tools/wireframes/pages/screens/settings.tsx` 60)는 `packages/shell/renderer/desktop/dev-mock/admin.ts`의 `fakeDiagnostics`로 그린다.
    - `packages/shell/renderer/conversation/agent-tab-source.ts` 78-86(`Sender`, `reaction` 84), `thread/sender-chip.tsx`(머리 주석 1-3, `senderLabel`의 `case "reaction"` 48-51, `HEAD.reaction` 104), `agent-tab-fake-source.ts`의 `case "sender-chips"`(393-457. `reaction` envelope 394-403, 쓰는 곳 435·452)와 `CODING_ENDED_TEXT`(86-87, core의 `CODING_REACTION_TEXTS.ended`와 같은 글). 실제 source의 `senderOf`(`agent-tab-core-source-thread.ts` 111-131, `agent-tab-data.ts` 63-77)는 program 입력을 `{ kind: "program", label: null }`로 그리고 `reaction`을 만들지 않는다.
    - wording: `packages/design/wording/catalog/workspace-settings.ts` 109(`settings.label.component-events`), `conversation.ts` 208(`conversation.label.sender-head-saw`, `HEAD.reaction`만 쓴다), 211-212(`conversation.label.sender-reaction`, `conversation.label.sender-reaction-unknown`)
    - `tools/wireframes/pages/screens/agent.tsx` 59-65(`new-agent-sender-chips` 설명 63 "program의 reaction")
- 계약:
  - 쓰는 것: `DIAGNOSTIC_COMPONENTS`(`packages/protocol/diagnostics/diagnostics.ts`)
  - 내놓는 것: `DIAGNOSTIC_COMPONENTS`는 `core`, `ledger`, `app-runtime`, `sandbox`, `agent-runtime`이다. 대화의 `Sender`는 `agent`, `coding`, `program` 셋이다.

## 할 일

근거: README "목표". Reactor와 그 점검이 없으니 화면이 보일 `events` 상태가 없고, `reaction` chip은 실제 data가 만들지 않는 갈래다(AGENTS.md "죽은 코드는 지운다").

1. 먼저 확인한다(rr-reactor 뒤). `git grep -n "component: \"events\"" -- packages/core`가 0줄이다. 아니면 고치지 말고 보고하고 멈춘다.
2. Diagnostics
   - `DIAGNOSTIC_COMPONENTS`에서 `"events"`를 뺀다. `git grep -n "\"events\"" -- packages/core packages/shell`로 component 이름으로 쓰는 곳이 남지 않았는지 본다(`events/list` 같은 route 이름, wiring 이름 `name: "events"`, SQL 표 이름은 다른 것이다).
   - `model.ts`의 `case "events"`와 `testdata/fake-source.ts`의 `events` 줄을 지운다.
3. 대화의 `reaction` 보낸 쪽
   - `agent-tab-source.ts`의 `Sender`에서 `reaction` 갈래를 지운다. `sender-chip.tsx`의 `case "reaction"`과 `HEAD`의 `reaction` 칸을 지우고, 머리 주석의 "program의 reaction"을 "lophn이 보낸 알림"으로 고친다.
   - `agent-tab-fake-source.ts`의 `sender-chips`: `reaction` envelope의 보낸 쪽을 `{ kind: "program", label: null }`(chip은 `conversation.label.sender-program-unknown`, "lophn")로 바꾼다. 글은 지금처럼 `CODING_ENDED_TEXT`, refs는 그대로 둔다. 변수 이름(`reaction`)도 뜻에 맞게 바꾼다.
   - gallery page 설명(`agent.tsx` 63)의 "program의 reaction"을 "lophn이 보낸 알림"으로 고친다.
4. wording(`wording` skill)
   - 지운다: `settings.label.component-events`, `conversation.label.sender-reaction`, `conversation.label.sender-reaction-unknown`, `conversation.label.sender-head-saw`. 지우기 전에 앞부분(`settings.label.component-`, `conversation.label.sender-`)으로 `packages`와 `tools`를 grep해 template 호출이 없는지 본다.
   - `deno task wording`으로 placeholders를 다시 만든다(손으로 고치지 않는다). `deno run --allow-read tools/check-wording.ts`를 돈다.

## 끝남

- `deno task check`가 통과한다. renderer를 고쳤으니 `deno run -A packages/shell/renderer/build.ts`도 된다.
- `deno task wireframes`가 되고, gallery `settings-diagnostics`에 Event stream 줄이 없고 `new-agent-sender-chips`의 첫 chip이 lophn 보낸 쪽으로 그려진다.
- 위험 test: 없음. 화면과 문구다(`.claude/skills/write-test/SKILL.md` "쓰지 않는 test").
- 남지 않음
  - `git grep -n "component-events\|sender-reaction\|sender-head-saw" -- packages tools`가 0줄이다.
  - `git grep -n "kind: \"reaction\"" -- packages/shell`가 0줄이다.
  - `git grep -n "\"events\"" -- packages/protocol/diagnostics packages/shell/renderer/desktop/settings/diagnostics`가 0줄이다.

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
