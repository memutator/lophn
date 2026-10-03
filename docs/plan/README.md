---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---
# 구현 계획

`docs/`의 모든 intent, requirements, domain model, architecture, flow가 첫 판의 범위다. 덜어 내는 것은 없다.

## 문서 모양

- 이 문서는 lead가 쓴다. slice 목록과 순서, 팀 사이의 선행 관계를 둔다.
- 팀마다 계획 문서 하나: `docs/plan/<팀>.md` (type `plan`, concerns에 그 최상위). 그 팀의 작업을 [tasks.md](../dev/tasks.md)의 모양으로 쓰고, 작업마다 `slice:` 줄로 어느 slice에 속하는지 적는다. 작업 id는 `<팀>#T<n>`이다.
- 다른 팀의 작업에 기대면 `선행:`에 그 id를 적는다.

## slice

slice는 사람이 처음부터 끝까지 해 볼 수 있는 한 줄기다. 그 slice의 flow가 E2E로 돌면 끝난다. 위에서부터 차례로 시작하되, 선행이 끝난 slice는 겹쳐서 진행한다.

| slice | 끝나면 도는 flow | 선행 |
|---|---|---|
| skeleton | (뼈대: core 시작, shell 창, ledger, API, event, 개발 환경, check 명령) | 없음 |
| documents | first-project, project-workspace, edit-document, find-documents, organize-documents, restore-document, write-series | skeleton |
| context | build-context, define-terms | documents, agent |
| agent | connect-provider, manage-provider-accounts, steer-agent-work, resume-agent-session, review-agent-work, answer-question, approve-action, ask-lophn-help, edit-instructions, add-agent-extension, view-agent-visuals | documents |
| apps | new-app, change-app, restore-app-release, run-app-automation, manage-app-permissions, use-app-command, connect-apps, ask-app-hint | agent |
| coding-agent | connect-coding-agent, manage-coding-access, start-coding-agent, manage-tickets | apps |
| problems | report-app-problem, app-broken, verify-app-repair | coding-agent |
| operator | set-up-operator, receive-operator-report, manage-operator | context, apps |
| operations | install-lophn, update-lophn, backup-and-restore, catch-up-notifications, work-offline | problems |

여러 slice에 걸치는 flow는 갈래를 나눠 돈다.

- organize-documents: documents slice에서는 사람이 직접 고르는 이동만, lophn의 추천과 question 갈래는 agent slice에서 돈다.
- view-agent-visuals: 표·차트·도표는 agent slice, 앱 카드 갈래는 apps slice에서 돈다.
- new-app은 apps와 coding-agent에 걸친다. apps slice에서는 coding agent 대신 fixture 앱으로 등록·release까지 돌리고, coding-agent slice에서 처음부터 끝까지 돈다.

## 팀

| 팀 | 계획 문서 |
|---|---|
| contracts | `docs/plan/contracts.md` |
| platform | `docs/plan/platform.md` |
| documents | `docs/plan/documents.md` |
| apps | `docs/plan/apps.md` |
| problems | `docs/plan/problems.md` |
| lophn-agent | `docs/plan/lophn-agent.md` |
| coding-agent | `docs/plan/coding-agent.md` |
| shell | `docs/plan/shell.md` |

구조와 역할은 [team.md](../dev/team.md)에 있다.
