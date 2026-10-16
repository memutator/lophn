# requirements migration — 이번 범위 (2026-10-12)

사람 결정은 `../docs-review.md` 4~5장에 있다. 이번에 옮기는 것은 새 requirements 파일이 아직 없는 catalog 요소다. context, agent, shell, notifications, install-and-update, events는 뺀다. 이미 파일이 있는 core-apps, core-projects, coding-agent, core-storage도 뺀다.

## 1. 읽는 것과 읽지 않는 것

- 옛 요구는 `/home/pyosechang/projects/lophn/.claude/worktrees/agent-review/docs/requirements/`에 있다(main `fc84298d`와 같다). 읽기만 한다.
- 거르는 기준:
  - `removed.md`: 지운 것, 보류, 바뀐 모델
  - `terms.md`: 말 표
  - `../../requirements/README.md`: 요구 규칙
  - `../../boundary-catalog.yaml`: subject로 쓸 ID
- 옛 `docs/`의 다른 파일(intent, domain-model, flows, architecture, plan, open-issues …)은 읽지 않는다.

## 2. 분류 묶음 (1단계)

| 묶음 | 옛 파일 | 결과 파일 |
|---|---|---|
| problems-a | problems/closing, feedback, grouping, problem-codes | `triage/problems-a.md` |
| problems-b | problems/repairs, reporting, snapshots, tests | `triage/problems-b.md` |
| server-supervision | platform/api, identity, responsiveness, security | `triage/server-supervision.md` |
| approvals-config | platform/approvals, settings | `triage/approvals-config.md` |
| secrets-diagnostics-base | platform/secrets, diagnostics, redaction | `triage/secrets-diagnostics-base.md` |
| sdk | apps/sdk | `triage/sdk.md` |

## 3. 새 파일과 ID 범위 (2단계)

| 새 파일 | subject로 쓸 catalog ID | `interfaces` 칸 | ID 범위 |
|---|---|---|---|
| `core-problems.yaml` | problems | — | req-0100 ~ req-0199, 넘치면 req-0650 ~ req-0699 |
| `core-server.yaml` | server, core-api | core-api | req-0200 ~ req-0249 |
| `core-supervision.yaml` | supervision, child-supervision-protocol | child-supervision-protocol | req-0250 ~ req-0299 |
| `core-approvals.yaml` | approvals | — | req-0300 ~ req-0349 |
| `core-config.yaml` | config | — | req-0350 ~ req-0399 |
| `core-secrets.yaml` | secrets | — | req-0400 ~ req-0449 |
| `core-diagnostics.yaml` | diagnostics | — | req-0450 ~ req-0499 |
| `sdk.yaml` | sdk, sdk-api | sdk-api | req-0500 ~ req-0599 |
| `base.yaml` | base | — | req-0600 ~ req-0649 |

subject가 이 표 밖(예: shell, apps, app-runtime, agents, events, storage)으로 가야 하는 옛 요구는 이번에 쓰지 않는다(`defer-other`).

## 4. 분류표 형식 (1단계 결과)

옛 요구 하나(`**[Rn]**`)마다 한 줄이다. 줄 머리에 이미 지운 표시(`~~`)가 있거나 "버린 것" 절에 있는 것은 `drop-removed`로 한 줄만 적는다.

```markdown
| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| closing R3 | candidate | problems | 한 문장 보장 | 판정할 수 있는 관찰; 둘째 관찰 | |
| closing R4 | drop-removed | | | | run 단위 revert(removed.md 1) |
```

| 판정 | 뜻 | 채우는 칸 |
|---|---|---|
| `candidate` | 새 요구로 옮긴다 | subject, 요지, 확인 |
| `drop-removed` | 지운 것이나 보류에 걸린다 | 이유(removed.md의 어느 줄인지) |
| `drop-conflict` | 바뀐 모델과 부딪힌다 | 이유(어느 줄과 부딪히는지) |
| `drop-dup` | 이미 있는 새 요구나 이 표의 다른 candidate가 덮는다 | 이유(req-xxxx 또는 "closing R2") |
| `drop-detail` | 보장이 아니라 구현 세부, 화면 문구, 내부 이름 | 이유 |
| `defer-other` | 보장은 맞지만 subject가 이번 범위 밖이다 | subject, 요지 |
| `ask` | 사람이 정해야 한다 | 이유(무엇을 정해야 하는지) |

- 옛 요구 하나에 독립 보장이 둘이면 `R3a`, `R3b`처럼 줄을 나눈다.
- 요지와 확인은 README 2장(있는 것만 적는다)을 따른다. 지운 것이나 화면에 무엇이 없음을 적지 않는다.
- 요지와 확인에 옛 ID, 의도 참조, 코드 경로, `terms.md`에서 "쓰지 않음"인 말을 쓰지 않는다.
- 파일 끝에 판정마다 개수를 적는다.

## 5. 두 번째 범위: apps, coding-agent (2026-10-12)

사람(원문 그대로): "coding agent, apps도 작성해줘"

옛 요구 수가 많아(apps 181개, sdk 제외; coding-agent 172개) 처음부터 catalog 자식 요소의 파일로 나눈다. 원래 `core-apps.yaml`에 있던 req-0029(subject app-data)는 `core-app-data.yaml`로 옮긴다.

### 분류 묶음

| 묶음 | 옛 파일 | 결과 파일 |
|---|---|---|
| apps-1 | apps/blueprint, registration, releases, preview | `triage/apps-1.md` |
| apps-2 | apps/runtime, invocations, connections | `triage/apps-2.md` |
| apps-3 | apps/permissions, data, automations, agent-context | `triage/apps-3.md` |
| coding-1 | coding-agent/mcp-server, cli | `triage/coding-1.md` |
| coding-2 | coding-agent/connection, harnesses, sessions, guides | `triage/coding-2.md` |
| coding-3 | coding-agent/tickets, repair-context | `triage/coding-3.md` |

### 새 파일과 ID 범위

| 새 파일 | subject로 쓸 catalog ID | `interfaces` 칸 | ID 범위 |
|---|---|---|---|
| `core-apps.yaml` | apps, app-spi | app-spi | req-0700 ~ req-0799 |
| `core-app-releases.yaml` | app-releases | — | req-0800 ~ req-0849 |
| `core-app-runtime.yaml` | app-runtime, app-capability, app-direct-protocol | app-capability, app-direct-protocol | req-0850 ~ req-0949, 넘치면 req-1250 ~ req-1349 |
| `core-app-data.yaml` | app-data | — | req-0950 ~ req-0999 |
| `core-app-packages.yaml` | app-packages, package-spi | package-spi | req-1000 ~ req-1049 |
| `coding-agent.yaml` | coding-agent, coding-agent-harness-api | coding-agent-harness-api | req-1050 ~ req-1149, 넘치면 req-1350 ~ req-1399 |
| `coding-agent-mcp.yaml` | coding-agent-mcp, coding-agent-mcp-interface | coding-agent-mcp-interface | req-1150 ~ req-1199 |
| `coding-agent-cli.yaml` | coding-agent-cli, coding-agent-cli-interface | coding-agent-cli-interface | req-1200 ~ req-1249 |

- MCP와 CLI에 같이 걸리는 보장은 부모 `coding-agent`를 subject로 둔다.
- ticket은 catalog에 요소가 없다. ticket의 요구는 `apps`를 subject로 둔다(리팩터링 계획이 코드를 core의 apps 아래에 둔다). ticket·claim 모델이 남는지는 아직 정하지 않았다(`../migration-questions.md` 2번).

### 이번 분류의 바뀐 점

- 사람이 "다 가져오고 파일을 읽으면서 핑퐁하겠다"고 했다. 그래서 `ask` 줄도 요지와 확인을 새 말로 채운다. 쓰기 단계는 그 줄을 `# 정할 것:` 주석과 함께 요구로 쓴다.
- 열린 질문에 걸리는 옛 요구는 `ask`로 둔다(요지 채움).
  - ticket·claim 모델
  - 앱이 화면 상태를 agent에게 보여 주는 기능(옛 agent-context)
  - automation이 주기 실행(보류)을 가리키는지
