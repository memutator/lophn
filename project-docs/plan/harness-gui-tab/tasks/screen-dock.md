# screen-dock

채팅 화면의 composer 위 dock이 acp-more 계약을 그리고 보낸다. lophn agent와 harness GUI가 같이 쓴다. 사람이 찾은 것(README 정한 것 14): subagent 보기와 todo가 없고, omp role이 없다. 정한 것 15대로 dock에 todo(plan), subagent(자식 대화 보기, 멈추기, 말 넣기), background task(멈추기), 대기열, 켜고 끄기, goal, role, 사용 한도를 넣는다. 기준은 데스크톱 앱들의 composer 위 줄이다(`ui-reference.md` §0 composer dock).

- 단위: screen (wave 6)
- 선행: screen-thread(같은 `agent-view.tsx`를 고친다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/dock/`(새로)
  - `packages/shell/renderer/conversation/{agent-view.tsx,agent-view.module.css,agent-view-model.ts,agent-tab-gui-source.ts,agent-tab-fake-source.ts}`(dock mount와 새 입력 줄)
  - `packages/shell/renderer/conversation/{queued,model-picker,session-rewind,composer}/`
  - `packages/shell/renderer/icons/conversation.ts`
  - `packages/design/i18n/catalog/conversation.ts`(여러 task가 key만 더한다)
  - `tools/wireframes/pages/screens/{harness-gui.tsx,conversation.tsx}`, `tools/wireframes/pages/screens/agent-tab/`, `tools/wireframes/mock/agents-data.ts`
- 읽을 것:
  - 점검 보고 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/`:
    - `ui-reference.md` §0(composer dock), §4-7(subagent, todo, background task, model·role), §21(대기열), 부록 A
    - 각 `audit-{claude,codex,opencode,omp}.md`의 "adapter·화면에서 고칠 것" 화면 줄
  - architecture: `project-docs/architecture/agent-chat.md`, `harness-gui.md`, `acp.md`
  - ui-design skill(바뀌는 화면마다 gallery page)
- 계약:
  - 쓰는 것: acp-more의 subagent detail과 `children`, `stop_child`·`steer_child`, `tasks`·`stop_task`, `limits`, `context.parts`, `toggles`·`set_toggle`, `goal`·`set_goal`, `roles`·`use_role`, `hidden_restored`, plan `cancelled`와 capability. screen-thread가 남긴 화면
  - 내놓는 것: dock component(`conversation/dock/`). thread-index가 고칠 `agent-view.tsx`는 이 task가 끝낸 꼴이다

할 일: (살 단계가 채운다)
