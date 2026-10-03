---
type: domain-model
concerns: [coding-agent/sessions]
---
# coding-agent/sessions

CodingAgentLaunchPlan과 HarnessSessionObservation을 정의한다. 외부 session의 관측은 derived이며 lophn-agent/conversation의 Session entity나 credential entity를 확장하지 않는다.

## ExecutionSpec (값 참조)

→ coding-agent/harnesses의 HarnessDefinition.execution에 담는다. `transport=pty`, executable/argv builder, first-prompt 전달 방식, expected process, readiness evidence·deadline, tested versions/platforms, native identity acquisition, status normalizer, resume capability·required handle을 가진다. SDK/RPC/HTTP/ACP는 향후 capability 참고일 뿐 현재 실행 adapter가 아니다. 단순 `--version` 발견은 TUI adapter 검증을 대신하지 않는다.

| harness | TUI·첫 prompt 계약 | native ID 획득 evidence | resume capability 참고(현재 자동 실행 없음) |
|---|---|---|---|
| Claude Code | `claude`, 분리 argv prompt | hook `session_id`, `transcript_path` | `claude --resume <id>` |
| Codex | `codex`, 분리 argv prompt | hook `session_id`, `transcript_path` | `codex resume <id>` |
| OpenCode | `opencode --prompt <prompt>` | plugin `sessionID` | `opencode --session <id>`; version별 검증 |
| Gemini CLI | `gemini --prompt-interactive <prompt>` | hook `session_id` | `gemini --resume <id>` |
| Hermes | `hermes --tui`, version 검증한 query planner | 검증한 plugin이 identity를 제공할 때만; 없으면 null | 미검증 |
| pi | `pi`, 분리 argv prompt | extension `session_id`, `session_file` | `pi --session <transcriptPath>`; ID만으로 resume 불가 |
| OpenClaw | 검증한 TUI command와 readiness 뒤 PTY stdin prompt | 이번 범위에서 native ID 수집 미검증; null | 미검증 |

readiness deadline은 10,000ms이며 adapter가 정한 검증 신호를 쓰되 준비 신호 없는 adapter는 stdin prompt 자동 주입을 허용하지 않는다. prompt가 argv로 전달되는 adapter에는 draft 신호를 기다려 두 번 보내지 않는다. Hermes query planner·OpenClaw의 실제 argv/준비 신호는 exact version manifest에 검증되어 있어야 [Start] 가능하며 미검증이면 자기 터미널 안내와 CLI/skill 통로를 유지한다.

## CodingAgentLaunchPlan (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `ticket`, `ticket_revision` | `tkt`·event seq | 아니오 | → coding-agent/tickets; open/check_failed, claim 없음 재검사 | 시작 대상이지 claim 아님 |
| `harness_id`, `catalog_revision`, `adapter_revision` | catalog 참조 | 아니오 | → coding-agent/harnesses | 검증한 실행 계약 |
| `environment`, `profile_id` | 관측 target 참조 | profile만 예 | native host만 허용 | |
| `connection` | `cac` | 아니오 | active·ticket app 허용; → coding-agent/connection | 시작 중 scope 확대 없음 |
| `project`, `folder_ref`, `cwd` | project·등록 폴더 참조·absolute path | 아니오 | → documents/projects; 앱 연결 source가 해당 project에 속하고 선택 폴더 검증 | 터미널 작업 자리 |
| `method` | `terminal_tui` | 아니오 | 사람 [Start]에만 실행 | 자기 터미널은 안내이며 이 plan의 spawn 없음 |
| `executable`, `argv` | absolute path·string[] | 아니오 | shell 문자열 조합 금지; 실행 직전 candidate 재확인 | |
| `env_names`, `credential_handle` | 안전한 이름[]·보호 참조 | 아니오 | token 원문 없음; 인증 경계의 process-local 전달 | |
| `first_prompt` | text | 아니오 | ticket 읽을 참조·MCP claim→작업→보고 지시만; data 인용과 지시 구별 | body·log·secret 복제 없음 |
| `human_start_handle`, `operation_id` | local one-use handle·local key | 아니오 | exact ticket/harness/method와 클릭에 묶음; shell main이 검증 | approval entity 아님 |

실행 직전 revision·scope·executable·cwd가 달라졌으면 conflict다. 이미 수락한 operation의 중복 전달은 같은 runtime_ref를 반환하고 재spawn하지 않는다. 결과 유실이나 lophn 재시작으로 local key를 확인할 수 없으면 unknown이며 자동 재시도하지 않는다. launch 접수의 durable ledger 표는 이번 범위에 없다.

## HarnessSessionObservation (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `harness_id`, `environment`, `profile_id`, `catalog_revision`, `adapter_revision` | target·배포 참조 | profile만 예 | 실제 실행/관측 target | |
| `origin` | `lophn_terminal/external_terminal` | 아니오 | evidence로만 구분 | process ownership을 credential에서 추정하지 않음 |
| `runtime_ref` | terminal/tab/process generation 참조 | 예 | → shell/terminal; lophn 시작에만 확인된 ref | provider ID와 다름 |
| `connection`, `ticket` | `cac`·`tkt` 참조 | 예 | 확인된 MCP binding/launch 계획; 서로의 권한을 바꾸지 않음 | claim 별도 조회 |
| `cwd` | environment absolute path | 예 | 확인된 경우만; 자동 폴더 순회 없음 | |
| `provider_session` | ProviderSessionMetadata | 예 | 실제 ID evidence 획득 전 null | |
| `state` | `starting/ready/working/waiting_input/ended/unknown` | 아니오 | 최신 검증 evidence 기준 | ticket 상태 아님 |
| `observed_at`, `evidence_source`, `evidence_ref` | UTC 시각·channel·안전한 참조 | 아니오 | hook/plugin/extension/protocol/output/process/launch | 원문 transcript 제외 |
| `freshness` | `fresh/stale` | 아니오 | 수집 연결 상실·재시작이면 stale, state unknown | 시간 무호출만으로 ended 금지 |
| `reason` | safe string | 예 | unknown/실패에 필수 | |

`ProviderSessionMetadata = {kind, id, transcript_path?, source, acquired_at}`. adapter별 길이 상한 1,024 code point, 빈 값·leading dash·control character 금지다. transcript_path는 검증한 native session 경로 evidence이지 임의 파일 읽기 권한이 아니다. pi는 ID와 session file를 따로 보관한다. 외부 event는 process generation/등록 channel과 맞는 경우만 결합하며 같은 connection/cwd 이름으로 session을 합치지 않는다.

## 상태와 전이

| 전 | 후 | 관측 주체·조건 | 구별 |
|---|---|---|---|
| 없음/unknown | starting | shell 실행 adapter가 실제 launch 접수 확인 | claim 아님 |
| starting/unknown | ready | 검증된 TUI readiness/idle event | process alive만으로 ready 아님 |
| starting/ready/waiting_input/unknown | working | 해당 session turn/tool 작업 evidence | claim 갱신 아님 |
| starting/ready/working/unknown | waiting_input | 정확한 input/permission 대기 evidence | permission 자동 답변 없음 |
| working/waiting_input/unknown | ready | 해당 session의 turn 종료·idle evidence | ticket 완료 아님 |
| starting/ready/working/waiting_input/unknown | ended | 연결된 process exit 또는 native session 종료 evidence | 문제 닫힘·claim 반납 아님 |
| any | unknown | evidence 부재·수집 끊김·실행 결과 불명·재시작 | 성공/종료 추정 금지 |

ended observation은 같은 process generation의 늦은 작업 event로 되살리지 않는다. 사람이 다시 시작하면 새 runtime_ref이며 기존 observation과 구별한다. Gemini의 Before/AfterAgent/Tool만으로 permission waiting을 추정하지 않는다. Hermes/OpenClaw 미검증 상태·ID는 unknown이다.

## 관계와 ledger 표

새 ledger 표·entity ID는 없다. session observation·launch plan은 derived memory/disposable cache이고 terminal durable 복원은 → shell/terminal이다. TicketClaim.connection/seq는 → coding-agent/tickets 정본이며 외부 session ID나 state를 claim에 추가하지 않는다. lophn agent의 `ses`·connection의 `cac`를 provider session ID 대용으로 사용하지 않는다.

## command

| local operation | 주체 | 입력·검사 | 결과 |
|---|---|---|---|
| `coding_session.start` | 사람 클릭을 검증한 shell main | ticket/harness/method·one-use handle·검증된 LaunchPlan | runtime_ref·starting 또는 safe conflict/unavailable/launch_failed/unknown |
| `coding_session.observe` | 등록 adapter | exact runtime/provider identity·generation·evidence | derived 관측; ledger event 없음 |
| `coding_session.status` | 사람 | runtime ref·허용된 target | 현재 evidence·시각·unknown 이유 |

coding credential의 MCP에 start/resume/permission.respond/coordinator op를 열지 않는다. 자기 터미널에서는 설치된 connection으로 ticket claim을 요청하며 process 시작은 사람이 직접 한다.

## event

local runtime notification은 target/runtime_ref/native ID의 안전한 참조·state·evidence 시각만 포함한다. 실제 작업 완료는 TicketCompletionReported와 소유 concern의 test/release event로만 확인한다.

## 정책

- **권한 전달.** 인증 경계가 시작할 때 keychain의 connection credential을 보호된 process-local 통로로 붙인다. token을 argv·prompt·일반 env·PTY·log·model context에 넣지 않는다. MCP/CLI 자식은 같은 connection의 보호 참조로 인증한다.
- **종료와 claim.** process 종료·수집 장애만으로 claim 반납/갱신을 하지 않는다. 명시 반납·60분 만료·connection 회수는 기존 ticket 계약이다.
- **재시작.** shell/terminal 복원과 새 coding process 시작은 다르다. 자동 spawn·resume·첫 prompt 재전송은 없다. 재관측이 없으면 unknown이다.
- **나중 범위.** headless·자동 시작·preset 사전 허락·coordinator·durable execution intent는 이번 enum·command·ledger에 예약하지 않는다. 사람이 실제 범위를 열 때 authority와 lifecycle을 별도로 설계한다.
