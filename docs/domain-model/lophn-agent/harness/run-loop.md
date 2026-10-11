---
type: domain-model
concerns: [lophn-agent/harness/run-loop]
---
# lophn-agent/harness/run-loop

Run의 출처, 시작 기준, 누적 한도와 최종 결과를 정의한다.

## Run (`run`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `run` ID | 아니오 | PK | run |
| `assignment` | `asg` ID | 아니오 | 불변; → lophn-agent/assignments | 수행 assignment |
| `session` | `ses` ID | 예 | 있으면 assignment 일치; → lophn-agent/conversation | 입력 세션 |
| `source` | RunSource | 아니오 | 불변; 같은 계기는 한 run | 접수 출처 |
| `continued_from` | `run` ID | 예 | 같은 assignment; 자신 금지; user의 명시적 선택 | 남은 일을 다시 맡긴 run |
| `start_after` | `run` ID | 예 | 같은 assignment; 자신·순환 금지 | 다음 일의 선행 run |
| `start_confirmed_seq` | seq | 예 | 선행 failed/stopped 뒤 user 계속 선택 command의 seq; 확인 전 null | 후속 요청 시작의 사람 근거 |
| `state` | `accepted / running / waiting_user / finished` | 아니오 | 초기 `accepted` | 상태 |
| `basis` | sha256 | 예 | 첫 시작에 필수; 이후 불변 | preset·assignment·tool·model 및 설정 판 snapshot |
| `waiting_on` | `qst / apr` ID | 예 | `waiting_user`에 필수, 그 외 null; → lophn-agent/questions, platform/approvals | 현재 막는 요청 하나 |
| `started_at` | 시각 | 예 | 첫 시작에만 설정; 이후 불변 | 실제 시작 |
| `limits` | RunLimits | 아니오 | 시작에 고정; 이후 변경 금지 | 적용 상한 |
| `elapsed` | RunElapsed | 아니오 | 초기 0; active는 감소 금지 | 누적 시간 |
| `finished_at` | 시각 | 예 | `finished`에 필수, 그 외 null | 끝남 확정 |
| `outcome` | RunOutcome | 예 | `finished`에 필수, 그 외 null | 최종 결과·이유 |
| `result` | sha256 | 예 | `finished`에 필수 | 완료·남은 일·미실행·불명확 효과·미반영 입력의 확정 결과 |

### 상태

| 상태 | 뜻 |
|---|---|
| `accepted` | 접수됐으며 미시작 |
| `running` | loop 진행 가능 |
| `waiting_user` | 질문 또는 approval request 결정 필요 |
| `finished` | terminal; 다시 열지 않음 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | `accepted` | machine | 사람 입력·허용 회차·유효 handoff와 원자 접수 | `RunAccepted` |
| `accepted` | `running` | machine | 현재 assignment 유효; 같은 assignment의 진행·대기 run 없음; 선행 정책 통과; basis와 limits 고정 | `RunStarted` |
| `running` | `waiting_user` | machine | 요청 생성 및 waiting_on 연결과 같은 transaction; 결정 없이는 진행 불가 | → lophn-agent/harness/waiting-and-recovery |
| `waiting_user` | `running / finished` | machine | 기다림의 끝 표 및 결정 한 번 반영 | → lophn-agent/harness/waiting-and-recovery |
| `running` | `finished` | machine | 완전한 tool 없는 답·모든 call 결과 확정·미반영 correction 없음; 또는 실패·한도 | `RunFinished` |
| `accepted / running / waiting_user` | `finished` | machine | user 멈춤, assignment paused/withdrawn, 설정·대상 불가; 미시작 call 정리 | `RunFinished` |

### 불변 조건

- assignment 하나의 `running / waiting_user` run은 최대 하나다. 여러 세션의 사람 요청은 여러 `accepted` run으로 접수할 수 있다.
- 같은 assignment 안 시작 순서는 `RunAccepted` seq다. assignment마다 시작 가능한 맨 앞 후보를 모아 사람 응답 대기·사람 한 번짜리 일·주기 일 우선순위와 각 우선순위 FIFO를 적용하며 상위 8개 연속 시작 뒤 가장 오래 기다린 시작 가능한 하위 후보에 다음 자리를 준다. 막힌 assignment는 무관한 후보를 막지 않는다. 주기 회차는 `accepted / running / waiting_user` 하나라도 있으면 → lophn-agent/scheduling에서 건너뛴다.
- `basis`는 당시 값의 사본이다. 실제 model·계정은 이 Assignment가 고정한 Preset 판에서 resolve한다. 현재 멈춤·credential 회수·scope 축소는 다음 call 전에 검사한다.
- run 전체의 transaction, 대상 임대, 독립 Turn·입력 queue·실패 entity는 없다. turn은 완전한 ModelCall 응답과 그 응답의 ToolCall 관계로 읽는다.
- 정상 종료와 enabled assignment의 correction 접수는 같은 writer에서 순서를 확정한다. paused 입력 보존은 → lophn-agent/conversation이며 새 Run을 접수하지 않는다. 미반영 correction이 있으면 정상 종료를 거절한다.
- correction 뒤 이전 응답의 미시작 tool은 미실행으로 닫는다. 이미 시작한 call의 결과는 기록한다.
- `finished` run을 원인으로 한 새 대상 변경은 `forbidden`이다. 늦은 결과·usage는 감사 보완만 허용하며 run을 깨우지 않는다.
- 실패·멈춤은 이미 저장한 변경을 자동 revert하지 않는다. 변경은 event의 run으로 조회한다. → lophn-agent/revert.
- `RunFinished(completed)`는 problem 닫힘이나 ticket 확인을 뜻하지 않는다.

## RunSource (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `message / schedule / handoff` | 아니오 | tagged union; 다른 가지 필드 금지 | 출처 종류 |
| `message` | `msg` ID | 조건부 | message에만 필수; user `request`; → lophn-agent/conversation | 원래 입력 |
| `assignment_revision` | 양의 정수 | 조건부 | schedule에만 필수; Assignment.revision과 일치 | 회차의 assignment 판 |
| `scheduled_at` | 시각 | 조건부 | schedule에만 필수; assignment와 함께 unique | 예정 회차 |
| `sender_run` | `run` ID | 조건부 | handoff에만 필수; 사람이 시작한 원래 요청에서 연결된 run | 보낸 run |
| `original_message` | `msg` ID | 조건부 | handoff에만 필수; user request; sender 출처 chain과 일치 | 원래 사람 요청 |
| `body` | sha256 | 조건부 | handoff에만 필수; 무엇·왜·제외·기대 산출물 | 맡긴 내용 |
| `references` | HandoffReference 배열 | 조건부 | handoff에만 필수; 채택 판에는 `question` ID 함께; → documents/versions, lophn-agent/questions | 이번 run 동안의 추가 읽기 근거 |
| `dedup_key` | 비어 있지 않은 문자열 | 조건부 | handoff에만 필수; sender별 unique | 중복 접수 기준 |

- handoff의 방향·출처 검증은 → lophn-agent/handoff. `Delegation`이나 `dlg` ID는 없다. 주기 run 및 Operator의 handoff는 없다.
- references의 고정 판만 이번 run에서 추가로 읽는다. 주소를 따라 scope를 넓히지 않는다.
- 같은 출처 key·같은 내용은 기존 run을 반환하고 같은 key·다른 내용은 `conflict`다.

## RunBasis (값)

`Run.basis` blob의 구조다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `preset` | `{id,revision,snapshot_hash,basis_seq}` | 아니오 | revision 양의 정수; → lophn-agent/presets | 고정 preset 판 |
| `assignment` | `{id,revision,snapshot_hash,basis_seq}` | 아니오 | revision 양의 정수; → lophn-agent/assignments | 고정 assignment 판 |
| `tools` | `{revision,definitions_hash,contexts}` | 아니오 | `contexts`는 선언 검색 정의를 만든 판 `{context,bundle,bundle_hash,title}`의 목록(없으면 빈 목록); → lophn-agent/harness/tools | 고정 정의 목록 |
| `extensions` | `{settings_revision,preset_selection,skill_hashes,mcp_config_revisions,mcp_tool_definition_hashes}` | 아니오 | 정확한 skill·서버/tool 쌍 선택 및 사용한 판·hash 고정; 빈 목록 허용; → lophn-agent/extensions | 고정 확장 판 |
| `models` | `{judgment,organizing}` | 아니오 | 두 값은 preset의 선택을 검증한 ResolvedModel; organizing 미선택은 judgment와 같은 model·계정·옵션이며 purpose만 organizing; → lophn-agent/harness/model | preset에서 resolve한 호출 snapshot |
| `initial_work_place` | WorkPlace | 아니오 | Session 현재 자리 또는 Operator.scope; call마다 현재 자리는 ContextBasis에 기록 | 시작 자리 |
| `limits / tool_result_limits` | RunLimits / byte·line·목록 상한 | 아니오 | 시작에 고정 | 제어 값 |

## HandoffReference (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `document` | `doc` ID | 아니오 | → documents/versions | 근거 문서 |
| `version` | `ver` ID | 아니오 | 그 문서의 고정 판 | 읽기 근거 |
| `section` | section key | 예 | 존재하는 구간; → documents/formats | 제한 구간 |
| `question` | `qst` ID | 예 | 채택 기획·설계 판에 필수; 답의 채택 판과 document/version 일치; → lophn-agent/questions | 채택 근거 |

## RunLimits (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `model_attempts` | 양의 정수 | 아니오 | 기본 30 | 판단·정리·실패·retry 합산 시도 수 상한 |
| `stall_ms` | 양의 정수 ms | 아니오 | 기본 300000 | 확정 결과 없는 시간 상한 |
| `active_ms` | 양의 정수 ms | 아니오 | 기본 1800000 | 사람 기다림 제외 총 시간 상한 |

## RunElapsed (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `active_ms` | 0 이상 정수 ms | 아니오 | waiting_user에서 증가 안 함 | 누적 active 시간 |
| `stall_ms` | 0 이상 정수 ms | 아니오 | 완전한 응답·확정 tool 결과에서만 0으로 reset | 무진행 시간 |
| `checkpoint_at` | 시각 | 예 | 시간 저장 경계; 재시작 때 보수적 산정 | 마지막 측정 경계 |

## RunOutcome (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `completed / failed / stopped` | 아니오 | terminal에 필수 | 결과 |
| `reason` | RunReason | 아니오 | 결과와 유효 조합만 | 짧은 이유 |

| kind | reason |
|---|---|
| `completed` | `answer_completed`, `no_change` |
| `failed` | `model_error`, `tool_error`, `context_limit`, `model_attempt_limit`, `stall_limit`, `active_limit`, `repeated_tool_failure`, `effect_unknown`, `clock_uncertain`, `configuration_unavailable`, `target_unavailable` |
| `stopped` | `user_stopped`, `assignment_paused`, `assignment_withdrawn`, `no_answer` |

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Run | 수행 | → lophn-agent/assignments | N:1 | 미종료 run 종료; 과거 참조 유지 |
| Run | 세션 | → lophn-agent/conversation | N:0..1 | 닫힘과 별개로 참조 유지 |
| Run | 선행·이어가기·handoff sender | Run | N:0..1 각각 | 과거 참조 유지 |
| Run | 기다림 | → lophn-agent/questions, platform/approvals | 1:0..1 | terminal 결정으로 처리; 임의 대체 금지 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `runs` | Run, accepted_seq, state_seq, 출처의 검색용 열 | PK `id` | partial `(assignment)` WHERE state IN (`running`,`waiting_user`); partial `source_message`; partial `(assignment,source_assignment_revision,source_scheduled_at)`; partial `(source_sender_run,source_dedup_key)` | `(assignment,state,accepted_seq)`, `(session,accepted_seq)`, `source_original_message`, `source_sender_run`, `start_after` | assignment·session·message·sender·선행 self FK; waiting 요청 참조 검사; blob 영구 참조 등록; 삭제 RESTRICT |

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `AcceptRun` | machine | ID, assignment, session?, source, continued_from?, start_after? | 출처 key·내용; 현재 assignment enabled·판; 새 message 접수 또는 ExecuteStoredRequest의 사람 선택·MessageAssigned는 같은 transaction | `RunAccepted` | `invalid_input`, `forbidden`, `not_found`, `conflict` |
| `StartRun` | machine | run, basis, limits | 예상 accepted·state_seq; 현재 assignment; active unique; 선행 결과 | `RunStarted` | `conflict`, `forbidden`, `unavailable` |
| `CheckpointRun` | machine | run, elapsed | 예상 running·state_seq; active 감소 금지 | 없음; 시간 값만 갱신 | `conflict`, `invalid_input` |
| `FinishRun` | machine | run, outcome, result | 예상 상태·state_seq; 정상 종료면 미반영 correction 없음 | `RunFinished` | `conflict`, `invalid_input` |
| `StopRun` | user / machine | run, 요청 key, 이유 | state_seq; terminal이면 기존 결과 반환 | `RunFinished` | `conflict`, `forbidden` |
| `ConfirmNextRun` | user | accepted run, 선행 run | 선행 failed/stopped 및 현재 accepted seq | 없음; `start_confirmed_seq` 및 command 결과에 근거 보존 | `conflict`, `invalid_input` |

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `RunAccepted` | run | assignment, session?, source, accepted_seq | lophn-agent/harness/run-loop, shell/desktop |
| `RunStarted` | run | basis, limits, started_at | shell/desktop |
| `RunFinished` | run | assignment, `started` boolean, started_at?, outcome, result, finished_at | lophn-agent/assignments, lophn-agent/handoff, shell/desktop |

## 정책

- **한도.** user만 기본 설정을 바꾸며 다음 run부터 적용한다. 독립 이어가기 summary에도 같은 유한 상한을 적용한다. 한도 도달에는 추가 마무리 model call 없이 machine이 확정 사실로 종료한다.
- **model retry.** 일시적 통신 실패만 최초 뒤 최대 2회, 같은 input. 서버 retry_at을 따르고 없으면 2000ms·4000ms. 모든 실제 시도는 → lophn-agent/harness/usage에 각각 기록한다.
- **tool retry.** 읽기 또는 최초 tcl ID로 중복 효과 없음이 보장된 쓰기만 최초 뒤 최대 1회. 매번 판정을 다시 검사한다. 재시도 관계는 → lophn-agent/harness/tools.
- **retry 취소.** steering·멈춤·한도 도달이면 예정 retry를 취소한다. 인증·model 불가·거절·잘못된 요청·원인 불명에는 동일 input 자동 retry가 없으며 run 전체 자동 retry도 없다.
- **후속 요청.** 선행 completed면 접수 seq대로 시작한다. failed/stopped면 요청을 보존하고 user의 계속할 요청 선택 전에는 시작하지 않는다.
- **실패 소유.** assignment 연속 실패 판정은 → lophn-agent/assignments. 같은 tool 반복 실패는 → lophn-agent/harness/safety.

