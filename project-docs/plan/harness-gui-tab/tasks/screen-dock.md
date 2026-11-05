# screen-dock

채팅 화면의 composer 위 dock이 acp-more 계약을 그리고 보낸다. lophn agent와 harness GUI가 같이 쓴다. 사람이 찾은 것(README 정한 것 14): subagent 보기와 todo가 없고, omp role이 없다. 정한 것 15대로 dock에 todo(plan), subagent(자식 대화 보기, 멈추기, 말 넣기), background task(멈추기), 대기열, 켜고 끄기, goal, role, 사용 한도를 넣는다. 기준은 데스크톱 앱들의 composer 위 줄이다(`ui-reference.md` §0 composer dock).

- 단위: screen (wave 6)
- 선행: screen-thread(같은 `agent-view.tsx`를 고친다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/dock/`(새로)
  - `packages/shell/renderer/conversation/{agent-view.tsx,agent-view.module.css,agent-view-model.ts,agent-thread.tsx,thread-layout.ts,thread-layout_test.ts,use-model-picker.ts,agent-tab-source.ts,agent-tab-gui-source.ts,agent-tab-fake-source.ts}`(dock·subagent 줄·자식 보기·새 입력 줄)
  - `packages/shell/renderer/conversation/{queued,model-picker,session-rewind,composer,activity,status-view}/`
  - `packages/shell/renderer/icons/conversation.ts`
  - `packages/design/i18n/catalog/conversation.ts`(여러 task가 key만 더한다)
  - `tools/wireframes/pages/screens/{harness-gui.tsx,conversation.tsx,agent-pages.tsx}`, `tools/wireframes/pages/screens/agent-tab/`, `tools/wireframes/mock/agents-data.ts`
- 읽을 것:
  - 점검 보고 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/`:
    - `ui-reference.md` §0(composer dock), §4-7(subagent, todo, background task, model·role), §21(대기열), 부록 A
    - 각 `audit-{claude,codex,opencode,omp}.md`의 "adapter·화면에서 고칠 것" 화면 줄
  - architecture: `project-docs/architecture/agent-chat.md`, `harness-gui.md`, `acp.md`
  - ui-design skill(바뀌는 화면마다 gallery page)
- 계약:
  - 쓰는 것: acp-more의 subagent detail과 `children`, `stop_child`·`steer_child`, `tasks`·`stop_task`, `limits`, `context.parts`, `toggles`·`set_toggle`, `goal`·`set_goal`, `roles`·`use_role`, `hidden_restored`, plan `cancelled`와 capability. screen-thread가 남긴 화면
  - 내놓는 것: dock component(`conversation/dock/`). thread-index가 고칠 `agent-view.tsx`는 이 task가 끝낸 꼴이다

## 할 일

줄여 쓴 path: `CV` = `packages/shell/renderer/conversation/`. ACP 이름은 acp-more가 고정한 것을 따른다.

1. **thread view에 새 상태를 싣는다**.
   - `CV/thread-layout.ts`의 `layoutOf`는 지금 `entries, turn, queued, pending, live, session, plan`만 낸다. `AcpState.tasks`와 `AcpState.children`(자식 id → 자식 `AcpState`)을 `ThreadView`(`CV/agent-tab-source.ts`)에 더한다. 자식은 읽을 때 같은 `layoutOf`로 펼치므로 view에는 state 그대로 둔다.
   - tool detail `subagent`는 `entryOf`에서 새 entry `ThreadSubagent {kind: "subagent", tool, agent, description, child, state, model, last, startedAt, durationMs}`가 된다. 지금 `generic`처럼 tool 묶음에 섞지 않는다.
2. **대화 안 subagent 줄**(`ui-reference.md` §4 lophn 할 일 1).
   - 새 `CV/activity/subagent-row.tsx`를 만든다.
     - 한 줄은 `[상태 mark] {agent} · {description} · {경과}`다. 상태 mark는 `CV/activity/tool-state-mark.tsx`, 경과는 `CV/activity/worked-for.tsx`의 시간 글을 쓴다.
     - 도는 동안은 아래에 `last` 한 줄을 흐리게 보인다.
     - `child`가 있으면 줄 전체가 단추이고, 누르면 3의 자식 보기를 연다.
   - `CV/agent-thread.tsx`의 `itemsOf`에 `case "subagent"`를 더한다. agent 덩어리 안에 `add()`로 넣는다.
   - props에 `onOpenChild(child)`를 더하고 `AgentView`가 넘긴다.
3. **자식 대화 보기**(`ui-reference.md` §4 lophn 할 일 3. OpenCode `subagent-bar.tsx`, Codex Subagents tab).
   - `CV/agent-view.tsx`의 `Layer`에 `{kind: "child", child}`를 더한다. 지금 rewind·permissions처럼 대화 위 한 겹(`styles.layer`)으로 연다. 이 대화는 탭 하나라 sheet나 split보다 지금 층이 맞다.
   - 머리 한 줄: [← 돌아가기] · 상태 · agent · model · 경과.
   - 본문은 `layoutOf(children[child])`를 `AgentThread`로 그린다.
     - 읽기만 한다: `readOnly`, `can` 모두 false, rewind·fork·resend는 빈 함수다.
     - 자식 상태가 갱신되면 같이 바뀐다. `child_update`는 reducer가 접는다.
   - 아래 줄:
     - capability `steer_child`가 있고 자식이 도는 중이면 한 줄 입력과 [Send]를 둔다. 보내면 `act steer_child {child, text}`다.
     - capability `stop_child`가 있으면 [Stop]이다. `act stop_child {child}`를 보낸다.
   - gui source의 `toolCallBody`(screen-thread가 items에서 찾게 한 것)가 자식의 tool도 찾게 `children`까지 본다(`CV/agent-tab-gui-source.ts`).
4. **composer dock**(`ui-reference.md` §0 공통 자리, nornzach `WorkspaceDock`).
   - 새 `CV/dock/composer-dock.tsx`를 만든다.
     - card를 같은 규칙으로 쌓는다. 순서는 Goal → Todo → Running → Queue다.
     - 내용이 없는 card는 그리지 않는다. card가 하나도 없으면 dock도 없다.
     - card는 접힌 요약 한 줄이 기본이다. 머리를 누르면 그 card 하나만 펼친다. 다른 card를 펼치면 앞 card는 접힌다.
     - 펼친 card는 최대 높이가 있고 안에서 scroll한다. 높이 끌기는 두지 않는다.
   - 자리: `CV/agent-view.tsx`의 `.bottom` 안, 지금 `QueuedMessages` 자리다. 승인·질문 카드 아래, composer 위다.
   - card 넷:
     1. **Todo**: 새 `CV/dock/plan-card.tsx`(OpenCode todo pill, nornzach Tasks card).
        - 지금 `CV/composer/plan-list.tsx`(`AgentComposer`의 `plan` prop, `agent-composer.tsx`의 `PlanList`)를 옮긴다. composer 쪽 `plan` prop과 `PlanList`는 지운다.
        - 접힌 요약: `● {진행 중 항목} · {끝난 수}/{전체}`.
        - 펼치면 목록이다. 10개가 넘으면 남은 것은 다 보이고, 끝난 것은 최근 3개와 "N more"다.
        - `cancelled`는 줄을 긋고 흐리게 한다. 상태 mark는 design `StatusMark`다.
     2. **Running**: 새 `CV/dock/running-card.tsx`(OpenCode activity capsule, nornzach Agents card, `ui-reference.md` §4 할 일 2, §6).
        - subagent 줄: items 중 subagent detail이고 `state === "running"`인 것이다. 줄은 `상태 · agent · last 한 줄 · 경과 · [Stop]`이다. 줄을 누르면 3을 연다.
        - background 줄: `tasks` 중 `state === "running"`인 것이다. 줄은 `[kind 아이콘] description · 경과(started_at) · [Stop]`이다.
          - [Stop]은 capability `tasks`일 때 `act stop_task {task}`다.
          - 줄을 누르면 `output`이 있을 때 그 글을 design `CodeBlock`으로 펼친다.
        - [Stop]은 hover·focus 때 경과 자리에 보인다(OpenCode). 키보드로도 닿는다.
        - 5개가 넘으면 5개와 "+N more"를 보이고, card를 펼치면 다 보인다.
        - 경과는 1초마다 다시 센다. `tool-line.tsx`의 도는 줄 timer와 같다.
     3. **Goal**: 새 `CV/dock/goal-card.tsx`. meta `goal`이 null이 아닐 때만 그린다.
        - 접힌 요약은 objective 한 줄과 status다.
        - 펼치면 detail, [Pause]/[Resume](`set_goal {objective, paused}`), [Clear](`set_goal {objective: null}`)다. capability `goal`일 때만 단추가 있다.
     4. **Queue**: 지금 `CV/queued/queued-messages.tsx`를 card 안으로 옮긴다. 동작(Send now, 고치기, 순서, 지우기)은 그대로다. 요약은 "Queued · N"이다.
5. **명령이 여는 dock**. screen-thread가 둔 `opens` 처리(`CV/agent-view.tsx`의 `runSlash`)에 dock 값을 더한다(값 이름은 acp-more가 고정한 것).
   - goal: 인자가 있으면 `set_goal {objective: 인자, paused: false}`다. 없으면 Goal card를 펼친다. goal이 없으면 인자를 기다린다(screen-thread의 인자 받기 규칙).
   - subagent·task 목록: Running card를 펼친다.
6. **켜고 끄기**(Codex plan mode, omp fast/slow, OpenCode auto-accept).
   - meta `toggles`마다 composer 입력칸 안 줄(`CV/composer/session-controls.tsx`, `ModeMenu` 옆)에 chip 하나를 둔다.
     - chip은 `aria-pressed`, label, `description` tooltip이다.
     - 누르면 `act set_toggle {id, on: !on}`이다.
   - capability `toggles`가 없거나 목록이 비면 없다. `AgentComposer`에 `toggles` prop을 더하고 `AgentView`가 meta에서 넘긴다.
7. **role**(정한 것 18. `ui-reference.md` §7, `audit-omp.md` §3).
   - `CV/model-picker/model-picker.tsx` 맨 아래에 "Roles" 절을 둔다. meta `roles`가 null이 아니고 capability `roles`일 때만이다.
   - 줄은 role label · 지금 model(`VendorIcon`과 이름. model이 null이면 "—") · kind 묶음(chat / model)이다.
   - 줄을 누르면 `act use_role {role}`다. 이 session만 그 role의 model로 바꾼다.
   - role 배정을 바꾸는 줄이나 submenu는 두지 않는다. props는 `CV/use-model-picker.ts`를 거친다.
8. **사용 한도와 context 분해**(`/usage`, `/context`. `ui-reference.md` §2 표, §14).
   - screen-thread가 `opens` status·usage·context를 지금 status layer(`CV/status-view/status-view.tsx`)로 보냈다. 그 안에 두 절을 더한다.
   - Limits 절: `usage.limits`마다 한 줄이다. label · 막대(`used_percent`. null이면 막대 없이 `left` 글) · "resets {시각}"(`resets_at`).
     - 막대 색은 status-summary의 80/90% 단계를 그대로 쓴다(`contextLevel`).
   - Context 절: `usage.context.parts`가 비지 않으면 줄마다 label · token(`compactTokens`) · 창 대비 %다. 지금 창 막대 아래에 둔다.
9. **숨긴 것 되살리기**(`hidden_restored`): reducer(acp-more)가 item을 제자리로 돌리면 `CV/session-rewind/hidden-range.tsx`의 숨긴 구간 줄은 저절로 사라진다. 화면 코드는 없다. gallery 장면 하나로 그 결과를 본다.
10. **fake와 gallery**(ui-design skill).
    - `CV/agent-tab-fake-source.ts`의 `harness` 장면에 넣는다:
      - plan 5개(하나 `cancelled`)
      - 도는 subagent 하나(자식 대화 몇 줄)
      - 도는 shell task 하나(output 몇 줄)
      - toggle 둘
      - goal 하나
      - roles(chat 셋, model 하나)
      - limits 둘
      - context parts 넷
    - `tools/wireframes/pages/screens/harness-gui.tsx` `SCRIPT`에도 같은 갱신을 넣고 page를 더한다:
      - `harness-gui-dock`: 접힌 dock
      - `harness-gui-dock-running`: Running card 펼침
      - `harness-gui-subagent`: 자식 보기 layer. `click`으로 연다
      - `harness-gui-roles`: picker를 연 모습
      - `harness-gui-status-limits`: status layer
    - lophn 장면 page를 더하면 `agent-pages.tsx`에 그 줄을 넣는다.
    - 문구는 `packages/design/i18n/catalog/conversation.ts`에 key로 둔다. 새 lucide 아이콘(dock card 머리, shell task, agent task)은 `packages/shell/renderer/icons/conversation.ts`에 둔다.
11. 문서: `project-docs/architecture/agent-chat.md`의 composer 위 자리(대기열, 계획) 설명을 dock으로 고칠 문장을 보고의 "넘길 줄"에 적는다.

## 끝남

- `npm run check`가 통과한다. `node packages/shell/renderer/build.ts`가 선다.
- 위험 test: 없음. 화면이다. 자식 갱신을 접는 규칙은 acp-more의 `reduce_test.ts`가 본다.
- 남지 않음:
  - `grep -rn "PlanList\|plan-list" packages/shell/renderer tools/wireframes`가 0줄이다. dock의 `plan-card`로 옮겼다.
  - `grep -n "<QueuedMessages" packages/shell/renderer/conversation/agent-view.tsx`가 0줄이다. dock 안에서만 쓴다.
- `npm run wireframes`가 되고, 위 harness-gui page들이 renderer component로 그려진다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. `agent-chat.md`에 넣을 문장을 "넘길 줄"에 적는다.
