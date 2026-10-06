---
type: domain-model
concerns: [apps/invocations]
---
# apps/invocations

Invocation의 관측 기록과 confirm command의 한 번 접수를 정의한다.

## Invocation (`inv`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `inv` ID | 아니오 | PK; 실제 통로에서 발급 | invocation ID |
| `app` | `app` ID | 아니오 | → apps/registration | 앱 |
| `release` | `rel` ID | 아니오 | → apps/releases; 같은 앱 | 당시 release |
| `operation` | InvocationOperation | 아니오 | 아래 union 중 하나 | 대상 |
| `trigger` | InvocationTrigger | 아니오 | 아래 union 중 하나 | 계기 |
| `mode` | `live` / `preview` | 아니오 | 실행 credential과 일치 | 데이터 구분 |
| `actor` | actor | 아니오 | 인증된 원래 호출자 → platform/identity; automation/start는 machine | 실제 요청자 |
| `caller` | InvocationCaller | 아니오 | 인증된 AppConnection/실제 실행 문맥; 본문 주장 금지 | 원인 참조 |
| `approval` | `apr` ID | 예 | → platform/approvals; confirm 접수에 필수·unique | 승인 한 번 사용 |
| `input_hash` | sha256 | 예 | confirm 접수에 필수; default를 채운 정규 입력 hash; secret 원값 금지 | approval 입력 비교 |
| `status` | `accepted` / `running` / `succeeded` / `failed` / `denied` / `unknown` | 아니오 | 아래 전이만 | 접수/관측 결과 |
| `started_at` | UTC 시각 | 예 | 실제 시작 관측만; accepted/denied에는 없음 | 실제 시작 |
| `finished_at` | UTC 시각 | 예 | succeeded/failed/denied/unknown 확정 시 필수; unknown은 미확인 판정 시각 | 종료/거절/미확인 판정 |
| `summary` | 작은 JSON object | 아니오 | redaction 뒤 UTF-8 최대 16KiB; 일반 입출력 본문·credential 원문 금지 | code·거절 사유 |
| `detail_hash` | sha256 | 예 | redaction된 실패 상세 blob → platform/blob-store | 안전한 근거 |

### 상태

| 상태 | 뜻 |
|---|---|
| `accepted` | confirm 접수와 승인 사용이 저장됨; 시작 아님 |
| `running` | 실제 시작 관측 |
| `succeeded` | 실제 성공 관측 |
| `failed` | 실제 실패 관측; DB rollback/외부 무효를 뜻하지 않음 |
| `denied` | handler를 부르기 전 거절 |
| `unknown` | 시작/결과를 확인할 수 없음; 자동 재실행 금지 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | `accepted` | machine | confirm=true; 인증된 caller의 정확한 user approval 사용과 같은 transaction | `InvocationAccepted` |
| 없음 / `accepted` | `running` | machine | 인증된 실제 시작 통보 | `InvocationStarted` |
| 없음 / `accepted` / `running` | `succeeded` / `failed` | machine | 실제 종료 통보; 실제 시작 시각 포함 | `InvocationFinished` |
| 없음 / `accepted` / `running` | `unknown` | machine | 알려진 inv ID의 시작/결과를 확인할 수 없음 | `InvocationFinished` |
| 없음 / `accepted` | `denied` | machine | handler 호출 전 검사 거절 | `InvocationDenied` |

### 불변 조건

- terminal 상태의 결과는 바꾸지 않는다. 늦은 시작은 terminal을 running으로 되돌리지 않는다. 같은 사실 재전송은 같은 결과, 다른 종료 사실은 conflict다.
- 접수 시각을 started_at에 복제하지 않는다. ID를 잃었으면 가짜 Invocation을 만들지 않는다. unknown이 실제 성공과 경쟁하면 먼저 확정된 terminal을 유지한다.
- 제출 event actor는 machine이다. Invocation.actor는 app 본문 주장이 아닌 연결 credential/confirm 접수의 원래 actor다.
- 일반 invocation은 실행 허가·작업 queue가 아니다. confirm 접수만 응답 전 ledger 확정을 요구한다. 실제 결과는 모두 뒤따라 기록한다.

## InvocationOperation (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `command` / `start` / `data_change` | 아니오 | discriminator; 다른 가지 field 금지 | 대상 종류 |
| `command` | 문자열 | 아니오(command) | 당시 blueprint.commands.key | 명령 |
| `from`, `to` | 0 이상 정수 | 아니오(data_change) | to > from; → apps/data | schema 변경 |

## InvocationTrigger (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `direct` / `automation` / `activation` / `restart` | 아니오 | discriminator | 계기 종류 |
| `key` | 문자열 | 아니오(automation) | 당시 blueprint.automatic_tasks.key | automation |
| `activation_seq` | 양의 정수 | 아니오(activation) | → apps/releases의 Activation.started_seq | activation 시도 |

## InvocationCaller (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `direct` / `automation` / `app` / `agent` / `system` | 아니오 | actor/trigger와 일치 | 호출 출처 |
| `app` | `app` ID | 아니오(app) | → apps/registration; AppCallOrigin.app | 부른 앱 |
| `release` | `rel` ID | 아니오(app) | 부른 앱의 당시 release → apps/releases | 부른 코드 |
| `parent_invocation` | `inv` ID | 예(app) | 같은 부른 앱의 알려진 invocation만; 부모가 미기록이면 ledger FK 강제 없음 | 바로 위 호출 |
| `run` | `run` ID | 아니오(agent) | → lophn-agent/harness/run-loop; 인증된 현재 run | 부른 agent run |
| `tool_call` | `tcl` ID | 아니오(agent) | → lophn-agent/harness/tools; 같은 run | 호출한 tool |

AppCallOrigin은 kind=app으로 app/release/parent_invocation만 projection하며 AgentCallOrigin은 kind/run/tool_call을 사용한다. 다른 가지 필드는 금지한다. direct는 user/coding_agent 직접 요청, automation/system은 machine이며 agent를 machine으로 기록하지 않는다. AppCallOrigin.path/nonce/credential은 감사 caller 필드에 복제하지 않는다.

## AgentCallOrigin (값)

서명된 일시 AppConnection.caller 값은 `{kind:"agent",run,tool_call}`다. 현재 run의 인증된 agent runtime 연결에서 생성하며 해당 run/tool call의 범위와 target의 agent.commands Grant를 검사한다(→ apps/runtime, apps/permissions). 일반 command input에서 run/tool_call을 받지 않는다.

## ConfirmExecutionProof (값)

서명된 일시 값이며 credential 원문을 ledger에 저장하지 않는다. 서명·credential 경계 → platform/identity, 통로 검증 → apps/runtime.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `invocation` | `inv` ID | 아니오 | accepted 접수 | 한 번 실행 대상 |
| `process_nonce` | 무작위 문자열 | 아니오 | 현재 프로세스 구분값 | 옛 프로세스 배제 |
| `release` | `rel` ID | 아니오 | 접수의 release | 고정 코드 |
| `command` | 문자열 | 아니오 | 접수 operation의 command | 고정 handler |
| `input_hash` | sha256 | 아니오 | 접수·실제 입력과 일치 | 고정 입력 |
| `caller` | InvocationCaller | 아니오 | 접수와 AppConnection의 InvocationCaller projection 일치 | 승인된 원래 요청자 |
| `expires_at` | UTC 시각 | 아니오 | 시작 가능 기한 | 실행 시작 제한 |

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Invocation | 당시 코드 | → apps/releases | 1 | 삭제 거절 |
| Invocation | confirm 결정 | → platform/approvals | 0..1 | 감사 참조 유지; 다른 호출에 재사용 불가 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `invocations` | Invocation | PK `id` | `approval` WHERE NOT NULL | `(app,release,mode,id)`, `(app,started_at,id)`, `(status,id)` | `(app,release)` → releases(app,id); approval → platform/approvals; detail_hash → blob |

재전송 `(inv ID, start/finish/deny)`의 결과와 confirm 접수 key는 → platform/ledger의 공통 idempotency 표를 쓴다. 별도 앱 outbox/approval 표는 없다.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `invocation.accept_confirm` | machine | app,release,command,input_hash,approval,key,process_nonce,caller | 현재 release·grant·정확한 approval; confirm=true; 인증된 user/app/agent caller와 정확한 사람 approval | `InvocationAccepted` | `forbidden`, `conflict`, `invalid_input`, `unavailable` |
| `invocation.record_started` | machine | 검증된 inv·앱·release·mode·actor·caller·operation·trigger·started_at | 같은 ID 사실; 실행 credential | `InvocationStarted` | `conflict`, `unauthorized`, `invalid_input` |
| `invocation.record_finished` | machine | 검증된 사실,status,started_at?,finished_at,summary,detail_hash? | 같은 ID terminal; unknown은 알려진 ID만 | `InvocationFinished` | `conflict`, `unauthorized`, `invalid_input` |
| `invocation.record_denied` | machine | 검증된 사실,finished_at,summary | handler 미시작; 같은 ID 사실 | `InvocationDenied` | `conflict`, `unauthorized`, `invalid_input` |

`invocation.accept_confirm`은 dispatch 전용이다. `apply_approved_action`이 같은 transaction에서만 부르고 approval 사용(`approval_uses`)과 함께 확정한다. HTTP로 직접 부르면 어느 자격이든 등록되지 않은 command와 같은 `invalid_input`으로 거절되고 접수·proof·approval 사용이 남지 않는다(platform Q31). 접수된 호출의 proof는 직접 재전송이 아니라 core 안에 저장된 접수(`InvocationAccepted`의 접수 시각·같은 접수 입력)에서 만든다.

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `InvocationAccepted` | Invocation | app,release,command,input_hash,approval,caller | platform/approvals |
| `InvocationStarted` | Invocation | app,release,mode,operation,trigger,caller,started_at | shell/app-frame |
| `InvocationFinished` | Invocation | status,started_at?,finished_at,summary,detail_hash? | problems/snapshots, problems/reporting |
| `InvocationDenied` | Invocation | finished_at,summary | problems/snapshots, problems/reporting |

## 정책

- **기록 대상.** confirm 접수·결과, write/external 명령, automation(read 포함), 실패/거절 read, start, data_change를 기록한다. 화면 byte 조회·성공한 일반 read는 매번 기록하지 않는다.
- **confirm 접수.** 승인 사용과 accepted를 원자적으로 저장한다. 재전송은 같은 접수만 돌려준다. 저장 실패면 handler를 부르지 않는다. 입력/release 변경은 새 확인이다.
- **실행 중복.** 앱은 증명을 검증하고 handler 전 메모리에 inv ID를 넣는다. marker를 지우기 전 증명이 만료되어야 한다. 프로세스당 4096개 목록이 가득 차면 새 접수 거절; 기존 marker를 버려 재실행하지 않는다. 새 프로세스는 옛 proof를 거절한다. 결과를 모르면 재실행하지 않는다.
- **전달.** supervisor의 전체 4096 메시지 또는 8MiB 중 먼저 닿는 메모리 한도 안에서 기록 메시지만 재전송한다. unavailable만 1000ms·2000ms·4000ms부터 최대 30000ms backoff로 다시 보낸다. unauthorized·conflict·invalid_input은 반복하지 않고 → platform/diagnostics. 한도 초과 시 redaction된 손실 진단을 남기며 앱 응답을 막지 않는다.
- **손실.** 기록 없음은 미실행이 아니다. snapshot은 기록 없음/연결 ID 모름을 그대로 표시한다(→ problems/snapshots).
- **문서 성공.** 명령 결과가 문서 저장을 포함하면 문서 version 확정까지 기다린다(→ documents/versions). invocation 전달만 기다리지 않는다.

- **출처.** app actor의 다른 앱 호출은 AppCallOrigin에서 caller app/release/parent를, agent 호출은 AgentCallOrigin에서 run/tool_call을 기록한다. 두 종류 모두 trigger=direct다. 기록 대상은 기존 정책과 같아 성공 일반 read는 매번 저장하지 않는다. 부모 inv가 미기록이면 같은 ID 참조만 유지하며 가짜 부모를 만들지 않는다.
- **confirm caller.** approval 결정자는 user지만 Invocation.actor/caller는 실제 요청자다. 앱 쌍/agent Grant는 approval을 대체하지 않는다. proof의 caller 결속 없이 다른 caller가 승인된 호출을 실행할 수 없다. agent ask와 confirm이 함께 있으면 같은 정확한 approval을 사용하고 두 번 소비하지 않는다(→ lophn-agent/harness/tool-judgment).

## 정할 것

- proof 서명·TTL은 platform/identity와 정한다. marker·summary·전달 한도·backoff는 apps/invocations#R19를 따른다.
- durable 전달 보관의 도입 여부. 현재는 bounded 메모리 재전송이다.
