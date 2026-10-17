# context-chip

context chip이 agent에게 `SendMessage.attached`로 전해지게 한다. 새 session 첫 말과 열린 session(PM 포함)의 composer가 같은 길로 chip을 싣고, 열린 PM session을 찾는 함수를 하나로 합친다. 계약(`SendMessage.attached`)은 이미 있고 core는 고치지 않는다.

- 단위: context-chip (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/composer/types.ts`
  - `packages/shell/renderer/conversation/agent-view.tsx`
  - `packages/shell/renderer/conversation/agent-tab-source.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-commands.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-sessions.ts`
  - `packages/shell/renderer/conversation/agent-tab-fake-source.ts`
  - `packages/shell/renderer/conversation/delivery-state.ts`
  - `packages/shell/renderer/conversation/delivery-state_test.ts`
  - `packages/shell/renderer/conversation/drafts.ts` (`Outgoing`을 만드는 곳이 있을 때만)
  - `packages/shell/renderer/conversation/attached-chips.ts` (새 file)
  - `packages/shell/renderer/conversation/attached-chips_test.ts` (새 file)
  - `packages/shell/renderer/workspace/kinds/agent.tsx`
  - `packages/shell/renderer/workspace/kinds/context.tsx`
  - `packages/shell/renderer/workspace/kinds/host.ts`
  - `packages/shell/renderer/workspace/agent/agent-tab.tsx`
  - `packages/shell/renderer/workspace/agent/tab-fields.ts`
  - `packages/shell/renderer/workspace/contexts/context-violations-model.ts`
  - `packages/shell/renderer/workspace/reactions/project-manager.ts`
  - `packages/shell/renderer/workspace/sidebar/panel-sessions.ts`
  - `packages/shell/renderer/workspace/workspace.tsx` (`openedPmSession`·`askPm` 자리만)
  - `tools/wireframes/pages/screens/agent-chat.tsx` (chip 한 칸을 새 type에 맞추는 만큼만)
  - `tools/wireframes/pages/screens/contexts/pm-session.tsx` (열린 session의 chip 한 상태)
- 읽을 것:
  - 이슈: `project-docs/issues/shell.md`의 "context chip이 agent에게 chip으로 전해지지 않는다"(지금 동작, 고치려면)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`(module `packages/shell/renderer`), `lophn-agent`(`agent-sessions`)
  - skill: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`, `.claude/skills/write-test/SKILL.md`
  - architecture 문서에 chip 절은 없다. 새로 쓰지 않는다(changelog와 이슈 닫기는 lead가 한다).
- 계약:
  - 쓰는 것: `packages/protocol/lophn-agent/inputs.ts`의 `sendMessage.input.attached`(`attachedChipSchema`: `{kind:"context", context: ctx id, name}` | `{kind:"file", path}` | `{kind:"violation", context: ctx id, path, rule}`). 바꾸지 않는다.
  - 내놓는 것: 없다(renderer 안에서 끝난다). 다른 task가 기대는 것 없음.

## core 쪽 확인(고치지 않는다)

`packages/core/lophn-agent/session/message-commands.ts`의 `sendWith`가 `attachedText(input.attached)`(`run-loop/input-text.ts`)를 만들어 Router 입력 본문 앞에 `<lophn-attached kind=... name=...>` 줄로 붙인다. 입력함의 그 본문이 turn의 user 입력이 되고(`run-loop/prepare.ts`, `turn.ts`가 `inputText`로 읽는다), `INPUT_TAGS.attached`의 뜻은 built-in 지침이 가진다. steer도 같은 본문이다. 즉 `attached`로 보내기만 하면 agent가 chip을 chip으로 받는다. core(`packages/core/lophn-agent`)와 protocol은 고치지 않는다. 지금 renderer가 항상 `attached: []`로 보내서 안 될 뿐이다.

알아둘 것: 이 길은 chip을 message 본문(blob)에 남기지 않는다. 대화 화면에는 보낸 글만 보이고, 본문에서 chip을 다시 만들 수 없어 `retryTurn`(`attached: []`)은 chip 없이 다시 보낸다. 본문에 `attached` part를 더하는 일은 이 task가 하지 않는다(아래 "정한 것").

## 지켜야 할 것(계획 README)

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다. (이 task는 core를 안 건드린다.)
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.
- protocol을 바꾸면 쓰는 쪽(shell, coding agent CLI)을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다. (이 task는 protocol을 안 바꾼다. renderer의 `AgentTabSource`·`ContextChipView`를 바꾸면 쓰는 곳과 fake source와 wireframe을 같은 변경에서 고친다.)
- secret 값은 보호 메모리와 전송 직전 attach 밖으로 나가지 않는다(log, event, ledger, model 입력 금지). (이 task와 닿는 곳 없음.)

그 밖에 AGENTS.md: 경계에서는 공통 오류 코드와 `SourceResult`만 쓴다. 새 E2E·브라우저·subprocess test를 만들지 않는다. 호환 장치(옛 field 읽기)를 두지 않는다.

## 할 일

1. **`ContextChipView`에 context id 칸을 더한다**(`conversation/composer/types.ts`). 칸 이름은 `context: string`(ctx id)이고 필수다. 지금 `id`는 위반 key(`keyText`)나 check id라서 `attachedChipSchema`의 `context: idSchema("ctx")`를 채울 수 없다. 근거: 이슈 "고치려면".
   - `violationChips(label, violations)`(`workspace/contexts/context-violations-model.ts`)가 context id를 인자로 받아 칸을 채운다. 호출하는 곳: `workspace/kinds/context.tsx`의 `onSendViolations`(탭의 `contextOf(tab)` 값을 넘긴다)와 `workspace/reactions/project-manager.ts`의 `contextChips`(이미 `context`를 가졌다. 위반이 없을 때 쓰는 `[{ id: check, label }]`에도 `context`를 넣는다).
   - `tools/wireframes/pages/screens/agent-chat.tsx`의 `{ id: "chip", label: chip }`에 ctx 모양의 값을 넣어 type을 맞춘다.
2. **chip → `AttachedChip` 변환을 한 함수로 둔다**(새 file `conversation/attached-chips.ts`). 위반이 있는 chip(`chip.violation`)은 `{kind:"violation", context, path: violation.file, rule: violation.rule}`, 없으면 `{kind:"context", context, name: label}`. 근거: `attachedChipSchema`(strictObject)가 모양을 정하고, 틀리면 `SendMessage`가 `invalid_input`으로 거절해 첫 말이 안 나간다.
3. **`sendText`가 chip을 `attached`로 싣는다.**
   - `SendInput`(`agent-tab-source.ts`)에 `chips: readonly ContextChipView[]`를 더한다. `sendText`(`agent-tab-core-source-commands.ts`)는 `attached: attachedOf(input.chips)`로 보낸다. 같은 file의 `runCommand`가 `sendText`를 부르므로 `chips: []`를 넘긴다. `retryTurn`의 `attached: []`는 그대로 둔다(본문에 chip이 없다. 보고의 "알려진 미완 동작").
   - fake source(`agent-tab-fake-source.ts`)의 `send`는 chip을 쓰지 않는다. type만 맞춘다.
   - `Outgoing`(`delivery-state.ts`)에 `chips`를 더해 `startSend`가 받는다. 결과를 모르는 말을 같은 id·key로 다시 보낼 때(`sendAgain`) 첫 시도가 core에 닿지 않았다면 chip이 빠지면 안 된다. `delivery-state_test.ts`의 `Outgoing` 값을 새 칸에 맞춘다.
4. **`openSession`에서 안 쓰는 `contexts`를 지운다.** `AgentTabSource.openSession`의 `contexts` 인자(`agent-tab-source.ts`)와 `agent-tab-core-source.ts`의 `{ id, contexts: _contexts }`, fake source의 같은 자리를 지운다. 이유: `opening_context`는 사건 순번(`source_seq`)과 target을 요구해 chip으로 채울 수 없고(`sessions.ts`의 `openingContextSchema`), chip은 첫 말의 `attached`로 간다. 쓰이지 않는 인자는 지운다(AGENTS.md "죽은 코드는 지운다"). `agent-tab-core-source-sessions.ts`의 `openSession` 주석("첫 context는 싣지 않는다 ...")을 이 설명으로 고친다. `agent-view.tsx`의 `ensureSession` 호출도 맞춘다.
5. **chip 상태를 탭이 갖게 한다(controlled).** 지금 `AgentView`의 `chips`는 mount 때 `props.contextChips`로 한 번 채운 `useState`라서, 이미 열려 있는 탭에는 chip을 붙일 길이 없다.
   - `AgentView`(`agent-view.tsx`)의 `contextChips` prop을 값의 원본으로 삼고, 바꿀 때 부르는 `onContextChips(next)` prop을 더한다. 안의 `useState`와 `setChips`는 없앤다. ✕(`onRemoveChip`), `/new`(`startNew`), 보낸 뒤의 비우기가 모두 `onContextChips`다. `AgentComposer`에는 `session === null ? chips : []` 대신 `chips`를 그대로 넘긴다(composer는 chip을 이미 그리고 `canSend`도 chip을 센다. `agent-composer.tsx`는 고치지 않는다).
   - `AgentTab`(`workspace/agent/agent-tab.tsx`)과 agent 탭 kind(`workspace/kinds/agent.tsx`)의 `render`가 `onContextChips`를 `host.patchTab(tab.key, ...)`로 이어 `tab.fields.chips`를 바꾼다(비면 field를 지운다). 지금 `onSession`이 chips를 지우는 자리는 그대로 두되(새 session이 열리면 첫 context는 쓸모를 다한다), 열린 session의 탭에서는 보낸 뒤 `onContextChips([])`가 지운다. `serialize`는 chips를 저장하지 않으므로 그대로다.
   - `app-frame/agent-pane.tsx`도 `AgentView`를 쓴다(chip 없이). 두 prop은 optional이라 고치지 않아도 되는지 확인하고, 안 되면 보고의 "넘길 줄"에 적는다.
6. **보낼 때 chip을 싣는다**(`agent-view.tsx`).
   - `dispatch`가 `startSend({..., chips})`로 `Outgoing`에 chip을 담고 곧바로 `onContextChips([])`로 비운다. `deliver`는 `source.send({..., chips: outgoing.chips})`를 부른다. `ensureSession`은 이제 chip을 비우지 않는다(`setChips([])` 줄 삭제).
   - 글이 비고 chip만 있을 때: 보낼 글은 지금처럼 `chipText`(chip 라벨들)로 채운다. `userMessageContentInputSchema`가 글 part를 요구하는 모양이고 `send()`가 빈 글을 거르기 때문이다. 조건 `&& session === null`은 뺀다(열린 session의 composer도 chip만으로 `canSend`다).
7. **열린 session에 chip을 붙이는 길을 `openAgent`에 둔다**(`workspace/kinds/agent.tsx`). `openAgent(host, {agent, name, session, chips})`에서 `reusable`이 session이 같은 탭을 찾으면, 그 탭의 `fields.chips`에 입력의 chip을 더한다(`id`가 같은 것은 건너뛴다. `host.patchTab`)고 그 탭을 고른다. 새 session(`session === null`) 쪽 `reusable`(같은 chip id면 같은 탭) 규칙은 그대로다.
8. **열린 PM session 찾는 함수를 하나로 합친다.** `workspace/workspace.tsx`의 `openedPmSession`과 `workspace/reactions/project-manager.ts`의 `openedSession`은 같은 일(이 project의 안 끝난 PM session 가운데 마지막 것)이다. `workspace/sidebar/panel-sessions.ts`(이미 `agentByRole`·`SessionEntry`가 있다)에 `openedProjectManagerSession(entries, project)` 하나를 두고 둘 다 그것을 쓴다. 옛 두 함수는 지운다. 근거: 이슈 "고치려면"의 마지막 문장.
9. **열린 PM session에도 chip을 붙인다.**
   - `askPm`(`workspace.tsx`): draft가 비었을 때만 `파일 - 규칙` 글을 채우던 분기를 지운다. 열린 session이 있으면 `openAgent(host, {agent, name, session, chips})`, 없으면 `openAgent(host, {agent, name, chips})`다. 그 분기 위쪽에서 `drafts`/`localDrafts`를 더 안 쓰게 되면 그 선언도 확인한다(다른 곳이 쓰면 둔다).
   - `openProjectManager`(`reactions/project-manager.ts`): 열린 session이 있어도 chip을 읽은 뒤(`contextChips(...).then`) `openAgent(..., session, chips)`로 연다. 이제 두 경로가 session 유무만 다르다. 근거: 이슈 "영향"(같은 위반이 열린 session에서는 글, 새 탭에서는 chip이던 어긋남).
   - `workspace/kinds/host.ts`의 `askProjectManager` 주석("chips는 넘길 위반 근거이고, 없으면 빈 탭이다")을 새 동작에 맞춘다.

## 정한 것(문서에 답이 없어 추천안으로 진행)

- **보낸 chip을 message 본문에 남기지 않는다.** `content.parts`에 `attached` part를 더하면 대화 화면에도 chip이 보이고 retry 때 다시 싣을 수 있지만, part에는 ctx id가 없어 `context` chip을 복원할 수 없고, 이슈가 요구한 범위(`attached` 배열로 싣기)를 넘는다. 프로토타입이라 `attached` 배열만 싣는다. 사람이 원하면 후속 task다.
- **`openSession`의 `contexts`는 지운다**(위 4번). lead 지시가 "버리지 않고"였으나 core 계약에 chip을 `opening_context`로 옮길 길이 없다. chip은 첫 말의 `attached`로 가므로 같은 일을 하는 셈이다.
- **새 wording key는 없다.** 보이는 문구가 바뀌지 않는다. 필요해지면 wording skill 순서대로 하되 catalog는 이 task가 소유하지 않으니 보고에 적는다.

## 끝남

- `deno task check`가 통과한다. 그리고 renderer 번들: `deno run -A packages/shell/renderer/build.ts`.
- 위험 test: 한 개. `conversation/attached-chips_test.ts`에서 "context chip과 위반 chip이 `sendMessage.input` schema를 통과하는 `attached`로 바뀐다"(위반이 있는 chip은 `violation`, 없는 것은 `context`, `context` 칸은 ctx id). 이유: 모양이 틀리면 core가 거절해 첫 말이 안 나간다. 화면(composer가 chip을 그리는지), 열린 PM session을 찾는 규칙, `openAgent`의 chip 합치기는 test하지 않는다(화면·내부 구현). 새 E2E·브라우저·subprocess test는 쓰지 않는다.
- 남지 않음:
  - `grep -rn "attached: \[\]" packages/shell` 의 결과는 `retryTurn`의 한 줄뿐이다(이유 주석을 단다). `sendText`에는 없다.
  - `grep -rn "openedPmSession\|openedSession(" packages` 가 0줄이고, 새 함수 `openedProjectManagerSession` 정의는 한 곳이다(`grep -rn "role === \"project_manager\"" packages/shell/renderer/workspace`로 둘째 찾기가 안 남았는지도 본다).
  - `grep -rn "contexts: _contexts\|contexts: chips" packages` 가 0줄이다.
- (화면) 모양은 바뀌지 않는다(composer가 열린 session에서도 같은 chip을 그린다). ui-design skill대로 `deno task wireframes`가 되는지 본다. 열린 session에 chip이 붙은 한 상태만 `pages/screens/contexts/pm-session.tsx`의 `WorkingSession`에 `ChatShell`의 `chip`·`onChip`으로 보이게 하고(`NewSession`이 쓰는 방식 그대로, 새 CSS·gallery 전용 prop 없이), 설명 문구(page description)가 사실과 어긋나면 고친다. page를 새로 만들거나 `GROUPS`를 건드리지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 예상(새 file은 `conversation/` 안의 두 개뿐). module-catalog·boundary-catalog 등록이 필요하면 적는다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 위 "정한 것" 외에 더 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳(`app-frame/agent-pane.tsx` 등)
- 계약 바꾸기 요청: 없음 예상. 본문에 chip을 남기려면 protocol 변경이 필요하다는 점만 적는다
- **무겁게 짠 것**: 없음 | `무엇 / 왜 / 줄인다면 / 어디`
- **알려진 미완 동작**: (1) 보낸 chip이 대화 화면에 안 보인다. (2) `retryTurn`은 chip 없이 다시 보낸다. 둘 다 고치려면 message 본문에 `attached` part와 ctx id가 필요하다.
