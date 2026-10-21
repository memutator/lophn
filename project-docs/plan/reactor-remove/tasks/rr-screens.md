# rr-screens

Reactor가 없어져 뜻을 잃은 화면 조각을 지운다. Diagnostics의 `events` 구성 요소와, 대화의 보낸 쪽 chip 가운데 실제 source가 만들지 않는 `reaction` 갈래다. `ui-design` skill로 gallery(renderer의 fake source)부터 맞추고 문구는 `wording` skill이다.

- 단위: screens (wave 3)
- 선행: rr-reactor
- 소유(이 task만 고친다):
  - `packages/protocol/diagnostics/diagnostics.ts`(`DIAGNOSTIC_COMPONENTS`만)
  - `packages/shell/renderer/desktop/settings/diagnostics/`
  - `packages/shell/renderer/conversation/{agent-tab-source.ts,agent-tab-fake-source.ts}`
  - `packages/shell/renderer/conversation/thread/sender-chip.tsx`
  - `packages/design/wording/catalog/`
  - `tools/wireframes/pages/screens/agent.tsx`(`new-agent-sender-chips` 설명만)
- 읽을 것:
  - 계획: `project-docs/plan/reactor-remove/README.md`의 "목표"(Reactor를 지운다)
  - 앞 task: `project-docs/plan/reactor-remove/tasks/rr-reactor.md`의 "정한 것"(core가 `events` component 점검을 내지 않는다), `rr-program-from.md`의 "정한 것"(입력 종류 `reaction`은 coding session 끝 알림 하나로 남는다)
  - 화면: `.claude/skills/ui-design/SKILL.md`("먼저 알아둘 것": gallery는 renderer component를 fake source로 그린다), `.claude/skills/wording/SKILL.md`("key를 지우기 전에")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `diagnostics`, `shell`, `design`; `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
  - 코드(줄은 main `dd956b49f`)
    - `packages/protocol/diagnostics/diagnostics.ts` 49-57(`DIAGNOSTIC_COMPONENTS`)
    - `packages/shell/renderer/desktop/settings/diagnostics/model.ts` 13-14(`componentName`), `testdata/fake-source.ts` 17. gallery page `settings-diagnostics`는 `packages/shell/renderer/desktop/dev-mock/admin.ts`의 `fakeDiagnostics`로 그린다.
    - `packages/shell/renderer/conversation/agent-tab-source.ts` 78-86(`Sender`), `thread/sender-chip.tsx` 34-60(`senderLabel`), `agent-tab-fake-source.ts`의 `case "sender-chips"`(389-448). 실제 source의 `senderOf`(`agent-tab-core-source-thread.ts` 111-130, `agent-tab-data.ts` 63-77)는 program 입력을 `{ kind: "program", label: null }`로 그리고 `reaction`을 만들지 않는다.
    - wording: `packages/design/wording/catalog/workspace-settings.ts` 111(`settings.label.component-events`), `conversation.ts` 212-213(`conversation.label.sender-reaction`, `conversation.label.sender-reaction-unknown`)
    - `tools/wireframes/pages/screens/agent.tsx` 59-64(`new-agent-sender-chips` 설명 "program의 reaction")
- 계약:
  - 쓰는 것: `DIAGNOSTIC_COMPONENTS`(`packages/protocol/diagnostics/diagnostics.ts`)
  - 내놓는 것: `DIAGNOSTIC_COMPONENTS`는 `core`, `ledger`, `app-runtime`, `sandbox`, `agent-runtime`이다. 대화의 `Sender`는 `agent`, `coding`, `program` 셋이다.

## 할 일

근거: README "목표". Reactor와 그 점검이 없으니 화면이 보일 `events` 상태가 없고, `reaction` chip은 실제 data가 만들지 않는 갈래다(AGENTS.md "죽은 코드는 지운다").

1. 먼저 확인한다. 다르면 고치지 말고 보고하고 멈춘다.
   - `git grep -n "component: \"events\"" -- packages/core`가 0줄이다(rr-reactor).
   - Settings › Reactions(`packages/shell/renderer/desktop/settings/reactions/`)와 gallery page `new-settings-reactions`가 없다(ae-builds).
2. Diagnostics
   - `DIAGNOSTIC_COMPONENTS`에서 `"events"`를 뺀다. `git grep -n "\"events\"" -- packages/core packages/shell`로 component 이름으로 쓰는 곳이 남지 않았는지 본다(`events/list` 같은 route 이름은 다른 것이다).
   - `model.ts`의 `case "events"`와 `testdata/fake-source.ts`의 `events` 줄을 지운다.
3. 대화의 `reaction` 보낸 쪽(앞 계획 land 뒤 확인. ae-builds가 이 fake를 이미 바꿨으면 그 모양에서 `reaction`만 뺀다)
   - `agent-tab-source.ts`의 `Sender`에서 `reaction` 갈래를, `sender-chip.tsx`의 `case "reaction"`을 지운다.
   - `agent-tab-fake-source.ts`의 `sender-chips`: `reaction` envelope을 program이 보낸 coding session 끝 알림으로 바꾼다. 보낸 쪽은 `{ kind: "program", label: null }`(chip은 `conversation.label.sender-program-unknown`, "lophn"), 받은 글과 맡긴 글은 core의 고정 문구(coding 폴더 `close-call.ts`의 `CODING_REACTION_TEXTS` 값, 영어 그대로)다. 뒤 envelope이 `reaction.refs`를 빌려 쓰면(403) 그 refs를 그 자리에 옮긴다. 변수 이름도 맞춘다.
   - gallery page 설명(`agent.tsx` 63)의 "program의 reaction"을 "lophn이 보낸 알림"으로 고친다.
4. wording(`wording` skill)
   - 지운다: `settings.label.component-events`, `conversation.label.sender-reaction`, `conversation.label.sender-reaction-unknown`. 지우기 전에 앞부분(`settings.label.component-`, `conversation.label.sender-`)으로 `packages`와 `tools`를 grep해 template 호출이 없는지 본다.
   - `deno task wording`으로 placeholders를 다시 만든다(손으로 고치지 않는다). `deno run --allow-read tools/check-wording.ts`를 돈다.

## 끝남

- `deno task check`가 통과한다. renderer를 고쳤으니 `deno run -A packages/shell/renderer/build.ts`도 된다.
- `deno task wireframes`가 되고, gallery `settings-diagnostics`에 Event stream 줄이 없고 `new-agent-sender-chips`의 첫 chip이 lophn 보낸 쪽으로 그려진다.
- 위험 test: 없음. 화면과 문구다(`.claude/skills/write-test/SKILL.md` "쓰지 않는 test").
- 남지 않음
  - `git grep -n "component-events\|sender-reaction" -- packages tools`가 0줄이다.
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
