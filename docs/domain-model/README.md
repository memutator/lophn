---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---
# domain model

lophn이 **무엇을 기억하는가**를 concern별로 적는다. 파일 하나 = concern 하나: `docs/domain-model/<concern id>.md`.

여기에는 데이터의 모양과 규칙만 둔다.
- 넣는 것: entity와 값의 필드·타입·제약, 상태와 전이, 관계, ledger 표, command, event, 정책(값이 있는 규칙)
- 넣지 않는 것: 왜 필요한가, 누가 어떤 일을 하나(일 목록), 사용 흐름 이야기, 이전 설계와의 비교. 이런 것은 requirements와 flow에 둔다.

## entity 지도

ID를 가진 entity는 30개다. 나머지(blueprint, problem code, context item, preset 구성 같은 것)는 entity 안의 값이거나 ID 없는 기록이다. 표 이름은 각 파일의 "ledger 표"에서 가져왔다.

| concern | entity (접두사) | ledger 표 |
|---|---|---|
| [platform/ledger](platform/ledger.md) | | `events`, `command_results`, `subscriber_cursors` |
| [platform/blob-store](platform/blob-store.md) | | `blob_refs` |
| [platform/secrets](platform/secrets.md) | | `secrets` |
| [platform/settings](platform/settings.md) | | `setting_choices`, `setting_revisions`, `settings_state` |
| [platform/backup-and-migration](platform/backup-and-migration.md) | | `schema_migrations` |
| [platform/approvals](platform/approvals.md) | ApprovalRequest `apr` | `approval_requests`, `approval_uses` |
| [platform/notifications](platform/notifications.md) | Notification `ntf` | `notifications` |
| [documents/projects](documents/projects.md) | Project `prj` | `projects`, `project_folders`, `project_tracking_patterns` |
| [documents/versions](documents/versions.md) | Document `doc`, Version `ver` | `documents`, `versions` |
| [documents/series](documents/series.md) | Series `ser` | `series`, `series_instances`, `series_keys` |
| [documents/addressing](documents/addressing.md) | | `place_names`, `document_names` |
| [documents/contexts](documents/contexts.md) | Context `ctx` | `contexts`, `context_items`, `context_watch_changes` |
| [documents/terms](documents/terms.md) | Term `trm` | `terms`, `term_evidence` |
| [documents/outline-and-search](documents/outline-and-search.md) | SavedView `viw` | `saved_views` (그 밖은 ledger 밖 derived store 표 9개) |
| [apps/registration](apps/registration.md) | App `app` | `apps` |
| [apps/releases](apps/releases.md) | Release `rel` | `releases`, `release_tests` |
| [apps/permissions](apps/permissions.md) | Grant `grt` | `grants` |
| [apps/invocations](apps/invocations.md) | Invocation `inv` | `invocations` |
| [apps/sdk](apps/sdk.md) | Package `pkg` | `packages`, `package_versions` |
| [problems/reporting](problems/reporting.md) | Report `rpt` | `reports` |
| [problems/grouping](problems/grouping.md) | Problem `prb` | `problems` |
| [problems/snapshots](problems/snapshots.md) | Snapshot `snp` | `snapshots` |
| [problems/tests](problems/tests.md) | Verification `vrf` | `verifications`, `verification_reports` |
| [lophn-agent/presets](lophn-agent/presets.md) | Preset `pst` | `presets`, `preset_revisions` |
| [lophn-agent/assignments](lophn-agent/assignments.md) | Assignment `asg` | `assignments`, `assignment_revisions`, `assignment_outputs`, `assignment_read_apps`, `assignment_read_commands` |
| [lophn-agent/scheduling](lophn-agent/scheduling.md) | | `assignment_schedule_occurrences` |
| [lophn-agent/conversation](lophn-agent/conversation.md) | Session `ses`, Message `msg` | `sessions`, `messages` |
| [lophn-agent/questions](lophn-agent/questions.md) | Question `qst` | `questions` |
| [lophn-agent/revert](lophn-agent/revert.md) | Revert `rvt` | `reverts`, `revert_changes`, `revert_change_sources`, `revert_change_compensations` |
| [lophn-agent/harness/run-loop](lophn-agent/harness/run-loop.md) | Run `run` | `runs` |
| [lophn-agent/harness/waiting-and-recovery](lophn-agent/harness/waiting-and-recovery.md) | | `run_wait_resolutions` |
| [lophn-agent/harness/provider](lophn-agent/harness/provider.md) | Provider `pvd` | `providers`, `provider_credentials`, `provider_credential_model_blocks` |
| [lophn-agent/harness/model](lophn-agent/harness/model.md) | | `agent_model_slots` |
| [lophn-agent/harness/tools](lophn-agent/harness/tools.md) | ToolCall `tcl` | `tool_calls` |
| [lophn-agent/harness/usage](lophn-agent/harness/usage.md) | ModelCall `mcl` | `model_calls`, `model_call_supplements` |
| [coding-agent/connection](coding-agent/connection.md) | CodingAgentConnection `cac` | `coding_agent_connections` |
| [coding-agent/tickets](coding-agent/tickets.md) | Ticket `tkt` | `tickets`, `ticket_references`, `ticket_adoption_questions`, `ticket_conditions`, `ticket_problems`, `ticket_open_repair_problems`, `ticket_claims`, `ticket_completions`, `ticket_check_results` |

entity나 표 없이 값·정책만 가진 concern: platform/identity, redaction, security, diagnostics · documents/file-tracking, formats · apps/blueprint, runtime, automations, data, preview · problems/problem-codes, feedback, repairs, closing · lophn-agent/roles/*, handoff, extensions, observability, evaluation, harness/prompt-assemble, tool-judgment, safety · coding-agent/guides, repair-context, harnesses(catalog·관측·local receipt), sessions(시작 계획·derived 관측).

## 관계

```
 Project ─┐                     Context ──< context item >── Document · section · 앱 read command
          ├─ place ──< Document ──< Version
 App ─────┘                     Series ──< 멤버 Document (key 순서, 다음 이름 규칙)
  ├──< Release (blueprint는 blob) ──< release test ─── Verification
  ├──< Grant
  ├──< Invocation ─── Release
  └──< Problem ──< Report ─── Snapshot
          │            
          ├── interpretation ─── Version#section
          └── 열린 repair Ticket (많아야 하나)

 Ticket ─── App · Problem · acceptance check ─── Verification
   └──< claim ─── CodingAgentConnection(scope: 전체 | App 하나)

 Preset 고정 판 ──< Assignment(범위: Project | App | 전역) ──< Run ──< ModelCall ─── Provider
                                                         ├──< ToolCall
                                                         ├── source: 사람 요청 | 주기 회차 | handoff
                                                         └── Session ──< Message
 Question ─── Run (Session은 있을 때만)       Revert ─── Run 하나의 변경 전체
 ApprovalRequest ─── 정확한 대상·입력          Notification ←── 정해진 event
```

## 공통 규칙

- ID: `<접두사>_<ULID>`. ULID는 소문자 26자, 접두사는 소문자 세 글자. 접두사는 entity를 정의한 파일이 적고 겹치지 않는다(→ platform/ledger).
- 시각: UTC ISO 8601 밀리초 문자열. 기간: 밀리초 정수. 순서는 event seq로만 판단한다.
- 큰 내용은 blob(sha256)으로 두고 필드에는 해시만 둔다(→ platform/blob-store).
- 보관: `active` / `archived` 공통 상태. 보관 해제 event는 `…Unarchived`.
- event 이름: `<Entity><과거형 동사>`. envelope(seq, type, subject, actor, run, payload, at)는 platform/ledger가 정한다.
- 다른 concern의 entity는 정의하지 않고 `→ <concern id>`로 가리킨다.

## 파일 모양

필요한 절만 쓴다. 순서는 이대로.

````markdown
---
type: domain-model
concerns: [apps/releases]
---
# apps/releases

이 concern이 정의하는 것 한 문장.

## Release (`rel`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `rel` ID | 아니오 | PK | |
| `app` | `app` ID | 아니오 | → apps/registration | 이 release의 앱 |

### 상태

| 상태 | 뜻 |
|---|---|

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|

### 불변 조건

- 언제나 참이어야 하는 것. 예: 앱 하나에 active release는 많아야 하나.

## <값 이름> (값)

entity 안에 담기는 구조값. 필드 표는 entity와 같은 모양.

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|

## 정책

- **이름.** 규칙 한 문장(값 포함). 예: **claim 기한.** claim은 마지막 갱신에서 60분 뒤 끝난다.

## 정할 것

- 아직 정하지 않은 모양이나 값. 사람이 정할 것은 H 번호를 적는다.
````
