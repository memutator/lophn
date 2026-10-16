# R1 조사: "이 session 동안" 허락의 수명 (2026-10-15)

질문: 사람이 권한 물음에 "이 session 동안 허락"을 고르면 그 허락은 어디에 남고, process가 꺼졌다 켜지거나 session을 resume하면 살아 있나.

- repo(모두 `git clone --depth 1`, 읽기만 함. 실행·install·build 안 함):
  - Codex `openai/codex` @ `e89b7c4` (2026-10-15). 경로는 `codex-rs/` 아래.
  - Gemini CLI `google-gemini/gemini-cli` @ `06d3298` (2026-10-14)
  - OpenCode `sst/opencode` @ `4397ee4` (2026-10-15). 지금 repo에는 `packages/core`, `packages/tui`로 갈라져 있다.
  - Goose `block/goose` @ `dd17bf2` (2026-10-15)
  - Cline `cline/cline` @ `0474213` (2026-10-15). `sdk/`와 `apps/cli/` 구조(SDK로 다시 쓴 판)다.
- 문서: Claude Code `code.claude.com/docs/en/permissions`, `code.claude.com/docs/en/sessions`(2026-10-15에 받음).
- Hermes, Codex의 결정 선택지, OpenCode 문서, Claude Code network 허락은 기존 조사를 인용만 한다.

## 1. 한눈에

| harness | session 범위 허락 | 저장 | 재시작 뒤 | resume 뒤 | "항상"과 차이 | 근거 |
|---|---|---|---|---|---|---|
| Claude Code | "Allow for this session" (파일 수정 등). Bash·WebFetch의 "don't ask again"은 처음부터 영구 | process 메모리. 영구 규칙은 `.claude/settings.local.json` | 사라짐 | 안 살아남음(복원 목록에 없음). `--fork-session`은 새 process라 명시적으로 안 따라옴 | session 허락은 메모리, "항상"은 settings 파일. 도구 종류마다 둘 중 하나로 정해져 있음 | permissions 문서 표(15~19줄), sessions 문서 "What a resumed session restores", `/branch` 표(219줄) |
| Codex | `ReviewDecision::ApprovedForSession` (`acceptForSession`) | `SessionServices`의 메모리 map(`tool_approvals`, `session_approved_hosts`, `granted_permissions_by_environment_id`) | 사라짐 | 안 살아남음. resume도 같은 Session 생성자를 지나며 빈 map으로 시작 | "항상" = `ApprovedExecpolicyAmendment`가 `$CODEX_HOME/rules/default.rules`에 씀. MCP는 `ApprovedMcpPolicyAmendment`가 설정에 씀 | `core/src/tools/sandboxing.rs:41-118`, `core/src/state/service.rs:70-72`, `core/src/session/session.rs:1749-1750`, `core/src/exec_policy.rs:56,875` |
| OpenCode | session 범위 선택지 없음. 선택지는 once / always / reject | "always"는 SQLite `permission` 표에 (project, action, resource)로 저장. session id 없음 | 남음 | 남음(session과 무관) | 문서는 "always = 현재 session 동안"이라 쓰지만 code는 project 영구 저장. 문서와 code가 어긋남 | `packages/core/src/permission.ts:299-307`, `permission/saved.ts`, `permission/sql.ts`, 문서 `packages/web/src/content/docs/permissions.mdx:200` |
| Gemini CLI | "Allow for this session"(`ProceedAlways`), "Allow tool for this session", "Allow all server tools for this session" | process 메모리의 `PolicyEngine` rule(`source: 'Dynamic (Confirmed)'`) | 사라짐 | 안 살아남음. session 기록(`ConversationRecord`)에 허락·policy 필드 자체가 없음 | "Allow for all future sessions"(`ProceedAlwaysAndSave`)는 `auto-saved.toml`에 씀(workspace 또는 user) | `packages/core/src/policy/config.ts:721-830`, `packages/core/src/services/chatRecordingTypes.ts:92-104`, `packages/cli/src/ui/components/messages/ToolConfirmationMessage.tsx:285-420` |
| Goose | 없음. `AllowOnce`, `AlwaysAllow`, `DenyOnce`, `AlwaysDeny`, `Cancel` | "AlwaysAllow"는 `permission.yaml`(config 디렉터리, 전역) | 남음 | 남음(session과 무관) | session 범위가 아예 없어서 "항상"만 있다. 대신 승인 mode(`goose_mode`)는 session 기록에 있다 | `crates/goose-provider-types/src/permission.rs`, `crates/goose/src/agents/state_machine/ops_tool_approval.rs:61-68`, `crates/goose/src/config/permission.rs:12,160-170,260-276`, `crates/goose/src/acp/server/tools.rs:111` |
| Cline | 도구 호출 단위 기억 없음. ACP의 `allow_always`도 `allow_once`와 똑같이 이번 한 번만 승인 | "자동 승인(Auto-approve tools)" 켜짐 상태가 ACP session 객체(메모리)에 있음. 전역 설정 `toolAutoApprove`는 따로 있음 | 사라짐(ACP session 객체) | `loadSession`이 session 객체를 새로 만들며 `autoApproveTools`를 launch 기본값으로 되돌림 | "항상" 기억은 없음. 전체 자동 승인은 session 토글과 전역 설정 둘 | `apps/cli/src/acp/permissions.ts:11-27,76-78`, `apps/cli/src/acp/acpAgent.ts:215,284,547-554,705-710`, `apps/cli/src/acp/auto-approve.ts`, `sdk/packages/core/src/services/global-settings.ts:68` |
| Hermes (기존) | session 허락 | 메모리, session이 끝나면 지움(`clear_session`) | (기존 조사에 없음. 메모리라 사라진다고 봄) | 확인 못함 | "항상" = `config.yaml`의 `command_allowlist`. `/yolo`만 session에 저장되어 재시작해도 남음 | `approval-hermes.md` 3장, 2장 |

## 2. harness별 상세

### Claude Code

- 문서 permissions 표의 "Yes, and don't ask again" 열: Bash는 "Permanently per repository and command", File modification은 "Until session end", WebFetch·WebSearch는 "Permanently per repository (and domain)". 곧 같은 문구의 선택지가 도구에 따라 session 한정이거나 영구다.
- 영구인 경우 `.claude/settings.local.json`에 rule을 쓴다. git 저장소 root에 쓰고 worktree는 main checkout으로 푼다(v2.1.211 이후). 다음 session부터 적용된다.
- 문서 permissions: "Sometimes a permission prompt offers only a one-time approval, with no 'don't ask again' option and no option to allow the action for the rest of the session. Claude Code offers those options only when the prompt can show you everything they would allow." 곧 session 허락을 줄 수 있는지는 prompt가 허락 범위를 다 보여 줄 수 있는지에 달렸다.
- sessions 문서 "What a resumed session restores": 대화 기록, model, agent, permission mode, active goal, 예약 task를 복원한다고 나열한다. session 허락은 목록에 없다.
- 같은 문서 `/branch` 표: `"Allow for this session" permission grants` -> "Carried over; the branch runs in the same process, so your existing grants still apply. If you fork into a separate process with `--fork-session`, the new process starts without them and you re-approve there." 곧 허락은 process에 묶여 있다고 명시한다.
- permission mode는 transcript에 저장되어 resume 때 복원된다. 그러나 `bypassPermissions`로 끝난 session은 terminal에서 resume해도 복원하지 않고 "The permission mode a new session would start in"으로 시작한다(sessions 문서 permission mode on resume 표). 넓은 허락은 되살리지 않는다는 선례다.
- 확인 못함: "resume하면 session 허락이 사라진다"를 한 줄로 못 박은 문장. 복원 목록에 없고 `--fork-session`에서 사라진다는 두 근거로 추론한 것이다.
- network 허락의 "Yes"는 session 동안(기존 조사, `code.claude.com/docs/en/sandboxing`). 저장 위치는 확인 안 함.

### Codex

- 메모리 map이 세 군데다.
  - `ApprovalStore`(`core/src/tools/sandboxing.rs:41-64`): 직렬화한 key -> `ReviewDecision`. `with_cached_approval`(72~118줄)이 `ApprovedForSession`일 때만 key마다 넣는다. 주석: "If the user approves for session, we store the decision for each key individually".
  - network host: `session_approved_hosts`, `session_denied_hosts`(`core/src/tools/network_approval.rs:274-275`).
  - `request_permissions` 응답의 `PermissionGrantScope::Session`이면 `SessionServices::record_granted_permissions`(`core/src/state/service.rs:113`)가 환경별 map에 병합한다. `Turn` 범위는 turn 안에만 남는다(`core/src/session/mod.rs:3385-3410`).
- 세 map 모두 `SessionServices`의 field이고 생성은 `core/src/session/session.rs:1749-1750`의 한 곳(`ApprovalStore::default()`, `Arc::default()`)이다. 같은 생성자가 `InitialHistory::Resumed`도 받는다(`session.rs:792,856`). 허락을 rollout(session 기록)에 쓰거나 되살리는 code는 못 찾았다.
- protocol 주석(`protocol/src/protocol.rs:4271-4274`): `ApprovedForSession`은 "the remainder of the session"까지 session-scoped approval cache를 자동 승인한다.
- "항상"에 해당하는 것은 따로 있다. `ApprovedExecpolicyAmendment`는 `persist_execpolicy_amendment`(`core/src/session/mod.rs:2776`)가 `$CODEX_HOME/rules/default.rules`에 쓴다. `ApprovedMcpPolicyAmendment`는 "across sessions"(`protocol.rs:4276-4278`)이고 `persist_*_mcp_tool_approval`이 설정에 쓴다. MCP 승인 mode가 `Prompt`·`Writes`면 session·amendment 선택은 once로 낮춘다(`core/src/mcp_tool_call.rs:2240-2252`).
- 확인 못함: app-server가 thread를 unload했다 다시 올릴 때(`thread/resume`)의 경로를 끝까지 따라가 보지는 않았다. 생성자가 하나라는 점에서의 추론이다.

### OpenCode

- 기존 조사와 문서는 "always = 현재 session 동안"이다(`permissions.mdx:200`: "approve future requests matching the suggested patterns (for the rest of the current OpenCode session)").
- 지금 code(@ `4397ee4`)는 다르다. `reply == "always"`이고 도구가 `save` 패턴을 줬으면 `PermissionSaved.add`로 SQLite `permission` 표에 쓴다(`packages/core/src/permission.ts:299-307`). 표의 key는 `(project_id, action, resource)` unique index이고 session id 열이 없다(`permission/sql.ts`). 평가 때 `savedRules()`가 project의 저장분을 합친다(`permission.ts:148-176`).
- 즉 지금 OpenCode의 "always"는 project 영구 허락이고, session 범위 선택지는 없다. TUI label은 "Always allow"(`packages/tui/src/util/permission.ts:162-168`).
- session 기록의 `permissions` 규칙(`session.permissions`)은 있다. 그러나 이는 API로 session을 만들거나 바꿀 때 넣는 규칙이고, 사람의 reply가 쓰는 곳이 아니다(`reply`는 `saved.add`만 부른다).
- 확인 못함: 문서가 맞던 이전 판의 code. depth 1 clone이라 history를 보지 않았다. 문서가 낡았을 가능성이 크다. 이 repo의 `CHANGELOG.md`나 git history를 더 보면 확인할 수 있다.
- pending 요청은 메모리(`pending` Map)이고 service가 닫히면 모두 reject로 끝낸다(`permission.ts:134-146`).

### Gemini CLI

- UI 선택지(`ToolConfirmationMessage.tsx`): "Allow once", "Allow for this session"(`ProceedAlways`), "Allow tool for this session"과 "Allow all server tools for this session"(MCP), "Allow for all future sessions"/"Allow tool for all future sessions"(`ProceedAlwaysAndSave`, 설정 `allowPermanentApproval`이 켜져 있을 때만).
- `updatePolicy`(`packages/core/src/policy/config.ts:721`)가 `UPDATE_POLICY` message를 받아 `policyEngine.addRule`(745, 783줄)로 메모리 rule을 넣는다. `message.persist`(795줄)일 때만 `getWorkspaceAutoSavedPolicyPath()` 또는 user의 `auto-saved.toml`(`config/storage.ts:28`)에 쓴다. 그래서 같은 code 경로의 `persist` 한 비트가 "session"과 "항상"을 가른다.
- "Always allow"는 현재 approval mode와 더 느슨한 mode에만 적용한다(`scheduler/policy.ts:129-145`, `MODES_BY_PERMISSIVENESS`).
- 파일 수정의 session 허락(`ProceedAlways` + edit 도구)은 rule 대신 `setApprovalMode(AUTO_EDIT)`로 가는 mode 전환이다(`scheduler/policy.ts:124-127`).
- `PolicyEngine`은 `Config` 생성자에서 만든다(`core/src/config/config.ts:1346`). session 기록 type `ConversationRecord`에는 sessionId, 메시지, summary, directories 등만 있고 허락·policy field는 없다(`chatRecordingTypes.ts:92-104`). 그래서 `--resume`은 새 Config로 시작해 session 허락이 없다. 이 부분은 type 정의와 생성 지점을 근거로 한 추론이며, resume 경로를 끝까지 따라가지는 않았다.

### Goose

- 선택지가 `AlwaysAllow | AllowOnce | Cancel | DenyOnce | AlwaysDeny`다(`goose-provider-types/src/permission.rs`). session 범위 허락은 없다.
- `AlwaysAllow`이면 `update_permission_manager`로 `PermissionLevel::AlwaysAllow`를 기록하고(`ops_tool_approval.rs:61-68`), 이는 `permission.yaml`에 파일 잠금과 임시 파일 rename으로 쓴다(`config/permission.rs:260-276`). 도구 이름 단위의 전역 허락이다.
- 승인 mode `goose_mode`(auto, approve, smart_approve, chat)는 session에 속한다(`acp/server/tools.rs:111` `session.goose_mode`). session 기록에 있는 것은 허락 목록이 아니라 mode다.
- 승인 응답은 대화 message로 오간다(`ApprovalState::from_messages`, `ops_tool_approval.rs:54`). 즉 허락 결정이 session의 대화 기록에 남지만, 다음 호출을 건너뛰는 근거로는 쓰지 않는다. AlwaysAllow의 근거는 `permission.yaml`이다.

### Cline

- 이 repo는 SDK로 다시 쓴 판이다. 도구 호출을 기억하는 기능을 못 찾았다. 터미널 승인은 `[y/N]` 한 번뿐이다(`apps/cli/src/utils/approval.ts:75-95`).
- ACP 승인(`apps/cli/src/acp/permissions.ts`)은 `allow_once`, `allow_always`, `reject_once`를 내놓지만, 응답 처리에서 `allow_once`와 `allow_always`를 같이 `{approved: true}`로 돌려준다(76~78줄). "always"는 기억되지 않는다.
- session 범위로 남는 것은 "Auto-approve tools" 토글(`auto_approve`) 하나다. ACP session 객체의 `autoApproveTools`(메모리)이고 `session/set_config_option`으로 바꾼다(`acpAgent.ts:547-554`). 승인 callback이 이 값을 본다(705~710줄). `loadSession`이 session 객체를 새로 만들 때 launch 기본값(`defaultAutoApproveTools`)으로 되돌린다(284줄).
- 전역 설정 `toolAutoApprove`(`global-settings.ts:68`)와 TUI의 `toggleAutoApprove`는 따로 있다. 이 토글이 설정 파일에 쓰는지는 확인 못함.
- docs/usage/acp.mdx: "Session resume — conversations are persisted, so clients that support session loading can restore a thread after a restart." 복원 대상은 대화다.

## 3. 눈에 띄는 것

1. 도구가 session 범위 허락을 저장하는 곳은 어디서나 process 메모리다(Claude Code, Codex, Gemini CLI, Hermes). session 기록에 저장하는 harness는 못 찾았다. 확인한 것 중 OpenCode와 Goose는 session 범위 선택지가 없고 "항상"만 있다. Cline은 아예 기억하지 않는다.
2. 이 harness들은 session이 process 수명과 거의 같다. resume은 새 process가 transcript를 다시 읽는 일이다. 그래서 "메모리면 resume에서 사라진다"가 설계로 받아들여져 있다. lophn은 session이 app 수명보다 길다는 점이 다르다.
3. session 범위와 "항상"을 가르는 장치는 대개 하나의 bit다. Gemini는 `persist`, Claude Code는 도구 종류별 고정, Codex는 `ReviewDecision` 변종, Hermes는 선택지(once, session, always). 둘 다 같은 rule 평가 경로를 지난다.
4. 넓은 허락은 resume에서 되살리지 않는 선례가 있다. Claude Code는 `bypassPermissions`로 끝난 session을 resume해도 그 mode를 복원하지 않는다(sessions 문서 permission mode on resume 표). 반대로 Hermes의 `/yolo`는 session에 저장되어 재시작해도 남는다. 둘이 갈린다.
5. 도구가 "무엇을 허락하는지 다 보여 줄 수 있을 때만" session 허락을 준다는 원칙이 Claude Code 문서에 있다(permissions). OpenCode는 도구가 `save` 패턴을 주지 않으면 "always"가 아무것도 저장하지 않는다(`permission.ts:299`).
6. 문서와 code가 어긋난 예가 있다(OpenCode). 문서만 보고 정리하면 틀린다.

## 4. lophn에 비춰 본 점

요구는 "session이 닫히거나 archive되거나 지워지면 사라지고, 다시 열어도 되살아나지 않는다"(req-0318, 0319)다. lophn은 app이 꺼졌다 켜져도 session이 열린 채 남는다.

| 선택지 | 내용 | 근거 |
|---|---|---|
| A. 메모리 | app이 꺼지면 허락이 사라진다. 다시 켜면 같은 대상을 한 번 더 묻는다 | 확인한 모든 harness가 메모리(위 1번). 닫기·archive·delete 때 지울 대상이 따로 없어 req-0318/0319가 거의 공짜로 만족된다. 한 번 더 묻는 것은 "안전 쪽으로 실패"한다. Claude Code는 resume에서 grant를 되살리지 않는다고 설명한다 |
| B. session 기록 | 허락을 session 기록에 쓴다. app이 꺼졌다 켜져도 남는다 | 선례가 있는 쪽은 Hermes의 `/yolo`(session에 저장)와 Goose의 `goose_mode`, Claude Code의 permission mode 복원처럼 mode뿐이고, 개별 허락 목록을 session 기록에 쓰는 harness는 못 찾았다. delete는 기록과 함께 사라지지만 close·archive는 지우는 동작을 따로 넣어야 한다(재개해도 안 살아나려면) |

추천(제안): A가 harness 선례와 요구 모두에 가깝다. lophn의 차이는 "app 재시작이 session 끝이 아니다"인데, 이는 허락 수명을 session 기록으로 늘릴 이유라기보다 "재시작 뒤 한 번 더 묻는 것을 사람이 받아들이는가"라는 제품 물음이다. B를 고르면 다음을 정해야 한다.

1. close·archive 때 허락을 반드시 지운다(req-0319: 다시 열어도 되살아나지 않음). 기록에 두면 이 삭제가 요구가 된다.
2. 개별 허락과 넓은 허락(전체 자동 승인류)을 같이 다룰지. Claude Code는 넓은 mode를 복원하지 않고, Hermes는 복원한다.
3. 기록에 쓴 허락의 key(어떤 도구 호출 대상에 대한 허락인지)를 session 기록 schema에 넣어야 한다. OpenCode는 (action, resource), Codex는 직렬화한 key, Gemini는 rule 하나로 표현한다.

lead와 사람이 정한다. 이 조사로 확정되지 않는 것: lophn 사용자가 "app 껐다 켰는데 또 묻는다"를 얼마나 불편해하는지.

## 5. 확인 못함 한 줄 모음

- Claude Code: resume 때 session 허락이 사라진다는 직접 문장. 저장 위치(process 메모리)도 문서가 말하는 바는 "same process"까지다.
- Codex: app-server의 thread unload 후 resume 경로 전체.
- OpenCode: 문서가 맞던 이전 판 code, "always"가 session 범위였던 시기.
- Gemini CLI: `--resume` 경로 전체(type 정의와 생성 지점으로 추론).
- Cline: `toggleAutoApprove`가 전역 설정 파일에 쓰는지.
- Hermes: resume 때 session 허락(기존 조사 범위 밖).
