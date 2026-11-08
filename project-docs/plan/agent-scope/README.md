# agent-scope

- 목표: 사람이 Agents 화면에서 agent 정의의 workspace 범위를 보고 고른다. 화면과 문서가 지금 코드와 맞게 한다.
- 재료: `project-docs/products/roadmap/agent-surface.md`의 단계 0, `reports/agent-definition-workspace-and-call-paths.md`(2026-11-08 조사), `project-docs/architecture/{agent-definition,agent-call}.md`, `project-docs/products/change-log/0.20.0.md`(범위 고르기 없음 기록), `project-docs/products/change-log/0.22.0.md`(앱 삭제가 범위 agent를 지움).
- 범위 밖: 만든 뒤 범위 바꾸기, CLI `lophn agent create`의 범위(agent 자격은 지금처럼 부른 session의 workspace로 정해진다), project 삭제, `agent-surface` 계획의 팀·탭.

## 정한 것

- workspace의 Agents 탭 목록은 전역 agent와 그 workspace 범위 agent만 보인다. 범위 agent를 다른 workspace에서 열면 `not_found`인데 목록에 보여서 헷갈리기 때문이다.
- 목록 카드, 명함, 편집기에 범위를 표시한다(전역 / `<name> · project` / `<name> · app`, i18n `agents.label.workspace*`가 이미 있다).
- 새 agent의 범위는 편집기에서 고른다. 기본값은 화면을 연 workspace이고, home이면 전역이다. core user actor는 이미 `workspace`를 받으므로 core는 바꾸지 않는다.
- 명함의 runtime 줄은 harness 값(`claude-code`, `codex`, `opencode`)을 그대로 보인다. 지금은 `bare`가 아니면 모두 `lophn`으로 보인다(`packages/shell/renderer/workspace/agents/agent-card.tsx:27-33`). bug다.
- 문서는 코드에 맞춘다: `agent-definition.md:85`(앱 삭제는 범위 agent를 지운다, `packages/core/main/daemon/wiring/apps-delete.ts:65-84`), `agent-definition.md:30`·`:69`(앱 command는 `tools[]`가 아니라 `lophn` 명령), `agent-call.md:18`(지운 `coding_agent` 대상).

## task

| wave | id | 하는 일 |
|---|---|---|
| 1 | `ascope-ui` | Agents 목록 거르기, 범위 표시, 편집기 범위 고르기, 명함 runtime bug, 위 문서 고치기 |

## lead가 할 일

- `project-docs/plan/tools/lead/lead.sh agent-scope`가 연 worktree에서만 일한다. task 하나라 brief 없이 worker prompt에 위 정한 것과 소유 path(`packages/shell/renderer/workspace/agents/`, `packages/design/i18n/catalog/agents.ts`, 위 문서 둘)를 바로 써도 된다. `status.py`를 쓰려면 `tasks/ascope-ui.md`를 template 꼴로 쓴다.
- 화면 작업이라 새 test는 붙이지 않는다(AGENTS.md "테스트"). `dev:mock`의 fake source(`fake-source.ts`, `fake-data.ts`)에 범위 agent가 보이게 맞춘다.
- `reports/agent-definition-workspace-and-call-paths.md`는 사람이 두고 간 file이다. 고치지 않는다.
- 끝나면 changelog 열린 판에 항목을 남긴다.
