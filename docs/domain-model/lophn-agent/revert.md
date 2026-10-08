---
type: domain-model
concerns: [lophn-agent/revert]
---
# lophn-agent/revert

종료한 agent run 전체의 event를 대상으로 하는 Revert 시도·변경 묶음·복원 결과를 정의한다.

## Revert (`rvt`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `rvt` ID | 아니오 | PK; 최초 시도 전 고정; 결과 불변 | revert 시도 |
| `run` | `run` ID | 아니오 | 종료한 lophn agent run; → lophn-agent/harness/run-loop | 원래 변경의 출처 |
| `allow_partial` | boolean | 아니오 | 기본 false; true이면 남는 복원 불가 변경에 묶인 confirmation 증거 필수 | 남는 업무 변경 동의 |
| `outcome` | `applying / applied / partial / uncertain / blocked` | 아니오 | applying에서 최종 결과로 한 번 변경; 최종 결과 불변 | 복원 진행·실제 결과 |
| `changes` | RevertChange 배열 | 아니오 | 전체 event 및 원래 run의 성공 앱 write Invocation 포함; 완료한 단계 결과는 불변 | 결과 목록 |
| `result_seq` | event seq | 예 | applying만 null; 최종 RevertApplied/RevertBlocked/RevertFinished FK; → platform/ledger | 결과 event |
| `preview_hash` | sha256 | 아니오 | 사람 결정에 고정한 전체 preview·receipt 참조·실행 순서 blob | 재시작 기준 |

시도 actor·시각은 event에서 읽는다. 앱 direct call이 있으면 applying 상태를 durable하게 기록하고 실제 호출 단계는 apps/invocations로 추적한다. run별 Commit entity나 원래 변경 목록 사본을 만들지 않는다.

### 상태

| 상태 | 뜻 |
|---|---|
| applying | 사전 검사·사람 결정 저장 후 앱 복원 진행; 최종 결과 아님 |
| applied | 모든 가능한 변경의 복원 확인; 남는 irreversible 영향은 명시 동의한 때만 |
| partial | 복원 도중 실패·새 충돌로 이미 복원한 변경과 남은 변경 공존 |
| uncertain | 전달한 앱 복원의 효과를 확인할 수 없음; 추가 충돌 동작 중단 |
| blocked | 어떤 대상도 복원하지 않음 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | applying | `user` | 전체 사전 검사·binding·CAS 통과; 앱 복원 단계 존재 | `RevertStarted` |
| applying | applied / partial / uncertain | `machine`(사람 결정에 묶임) | 앱 결과 확인·남은 ledger CAS 재검사·실제 단계 결과 저장 | `RevertApplied / RevertFinished` |
| 없음 | applied | `user` | 종료 run·전체 묶음·현재 CAS·복원 후 관계 검사 통과; 복원 불가 업무 변경은 없거나 allow_partial=true | `RevertApplied` |
| 없음 | blocked | `user` | stale preview·충돌·관계 위반·부분 동의 부족·복원 준비 불충족 | `RevertBlocked` |

### 불변 조건

- 같은 run의 applying/applied/partial/uncertain Revert는 최대 1개다. blocked 뒤 새 시도는 새 ID다. 진행·부분·불명확은 같은 ID의 저장된 단계·result query로 확인하며 원래 앱 write를 다시 수행하지 않는다. 같은 command 재전송은 저장된 현재 결과를 반환한다.
- 사람만 요청한다. machine은 그 결정에 묶인 검사·복원 함수만 처리하고 actor는 user다. agent는 목록을 읽을 수 있지만 revert command를 내지 못한다.
- 결과·원래 event·답·승인·호출·사용량·run 종료 결과는 수정하거나 지우지 않는다. 새 복원 event의 run은 null이다.
- 일부 항목을 골라 복원하지 않는다. 전체 복원 가능한 변경을 계획한다. 사전 conflict 하나면 전체 blocked, 앱 호출 시작 뒤 새 conflict·실패는 실제 부분 결과이며 이미 복원한 앱 효과를 롤백했다고 주장하지 않는다.
- applied의 모든 reversible 묶음은 restored다. blocked에는 복원 효과가 없다. partial/uncertain은 복원 확인된 묶음만 restored이고 나머지는 failure/uncertain/unchanged로 남긴다.

## RevertPreview (값)

event와 소유 concern의 복원 검사에서 만든 읽기 결과다. 정본 entity나 저장된 변경 목록이 아니다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `run` | `run` ID | 아니오 | 종료 상태와 대상 변경 차단 확인; → lophn-agent/harness/run-loop | 원래 run |
| `as_of_seq` | event seq | 아니오 | 동일한 읽기 snapshot의 head; → platform/ledger | 조회 기준 |
| `groups` | RevertGroup 배열 | 아니오 | event.run=원래 run 전체와 ToolCall/Invocation으로 연결된 성공 앱 write를 빠짐없이 포함 | 전체 변경 |
| `binding_hash` | sha256 | 아니오 | run·전체 source seq·소유 CAS·capability·의존·남는 영향의 고정 지문 | confirmation 내용 기준 |

## RevertGroup (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `ordinal` | integer | 아니오 | 0 이상; 목록 안 unique; 정렬은 가장 작은 source seq 기준 | 묶음 번호 |
| `owner` | concern id | 아니오 | source event의 실제 소유 concern | 판정 영역 |
| `target` | ID | 예 | 대상 변경이면 필수; target 없는 감사 event만 null | 고정 대상 |
| `source_seqs` | event seq 배열 | 아니오 | 비어 있지 않음; 중복 없음; 오름차순; 앱은 원래 ToolCall 완료 event를 출처로 사용 | 원래 event 묶음 |
| `capability` | `reversible / retained / irreversible / conflict` | 아니오 | owner가 판정; retained는 감사 사실만 | 복원 분류 |
| `reason` | 이유 코드 | 예 | retained·irreversible·conflict이면 필수; 고정 코드(contracts의 revertReasonSchema) | 분류·남는 영향 설명 |
| `comparison` | JSON object | 예 | reversible·conflict 대상이면 소유 concern CAS 필수 | run이 남긴 판·seq와 현재 기준 |
| `before_ref` | JSON object | 예 | reversible이면 필수; 앱은 AppRevertBinding, 그 밖 이전 값·불변 판/blob | 복원할 기준 |
| `dependencies` | `{owner: concern id, target: ID, comparison: JSON object}` 배열 | 아니오 | 빈 배열 허용; owner가 복원 후 참조 검사 | 복원 의존 관계 |

- before_ref·comparison의 schema와 실제 복원 command는 owner가 정의한다. 이 concern은 역변경 종류 목록·다른 entity 필드를 정의하지 않는다.
- 원래 run의 같은 대상에 연속한 변경은 한 묶음이다. 시작 전 값으로 돌아가며 중간 판 하나를 선택하지 않는다. 다른 run·user의 변경이 끼거나 이후 판·seq가 달라졌으면 conflict다. 값이 우연히 같아도 충돌이다.
- 감사 event는 retained로 모두 설명한다. 업무 변경을 retained로 숨기지 않는다. 큰 이전 내용은 불변 version·blob을 참조하고 원래 변경과 같은 transaction에 소유 concern이 근거를 남긴다.
- `reason`은 글이 아니라 고정 이유 코드다(유지하는 사실, 외부 효과, 뒤따른 변경, 원본 연결 문서, 제목 변경, 분류 안 된 event, 차단 이유 같은 코드). blob이나 hash로 저장하지 않으며 화면 문장은 shell이 코드로 wording을 고른다. 결과 event(`RevertApplied/RevertBlocked/RevertFinished`)는 변경 목록 대신 결과별 묶음 수(`results`)만 싣고 목록은 `reverts/list`가 읽는다.
- 복원 준비 결과(문서의 이전 판을 다시 준비한 결과처럼 transaction 안에서 만들 수 없는 값)는 owner가 정의한 값으로 `RevertRun` 입력의 그 묶음 `comparison.prepared`에 싣고 `prepared_ref`가 그 정규 JSON hash다. 준비 결과는 비교 기준과 `binding_hash`에 들지 않는다. 준비가 없으면 owner가 복원 준비 불충족으로 전체를 막는다.

## AppRevertBinding (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `app / release / command` | ID / ID / 문자열 | 아니오 | 원래 ToolCall.app_command와 일치 | 원래 호출 계약 |
| `tool_call` | `tcl` ID | 아니오 | 원래 run의 성공 write; → lophn-agent/harness/tools | 출처 |
| `invocation` | `inv` ID | 아니오 | 성공 출력의 revert.invocation; → apps/invocations | 원래 업무 변경 |
| `receipt` | 불투명 문자열 | 아니오 | 앱이 돌려준 값 그대로; model에 원문 제공 없음 | 복원 입력 근거 |
| `expected_revision` | 앱 revision | 아니오 | 원래 성공 receipt 기준; 앱 소유 CAS | 후속 변경 검사 |
| `revert_command` | command key | 아니오 | 원래 blueprint.command.revert.command 검증; → apps/blueprint | 앱 복원 API |
| `step_key` | 문자열 | 아니오 | `(revert ID,원래 invocation ID)`의 고정 idempotency key | 복원 중복 방지 |
| `revert_invocation` | `inv` ID | 예 | apps/invocations에서 step_key로 조회 | 실제 복원 기록 |

preview는 receipt 원문을 UI·model에 보여 주지 않고 앱·command·변경 설명·복원 가능 여부·revision만 보여 준다. 앱이 복원 사전 검사·CAS·idempotency/result query를 지원하지 않으면 이를 알리고 안전한 복원으로 분류하지 않는다. 앱 source·DB 파일 직접 쓰기가 아니라 선언된 command만 호출한다.

## RevertChange (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `ordinal` | integer | 아니오 | Revert 안 unique; 0 이상 | 결과 묶음 번호 |
| `owner` | concern id | 아니오 | source event의 실제 소유 concern | 판정 영역 |
| `target` | ID | 예 | 대상 없는 감사 사실만 null | 고정 대상 |
| `source_seqs` | event seq 배열 | 아니오 | RevertGroup과 동일한 원래 event 묶음 | 변경 출처 |
| `capability` | `reversible / retained / irreversible / conflict` | 아니오 | 최종 transaction의 owner 판정 | 복원 가능 여부 |
| `result` | `restored / retained / irreversible / conflict / unchanged / failure / uncertain` | 아니오 | 아래 조합만 허용 | 실제 시도 결과 |
| `reason` | 이유 코드 | 예 | result≠restored이면 필수 | 남은 변경·감사 사실·차단 설명 |
| `restored_seqs` | event seq 배열 | 아니오 | ledger 복원은 필수; 앱 복원은 후행 Invocation event 또는 아래 invocation 참조; 그 외 빈 배열 | 실제 보상 event |
| `app_revert` | AppRevertBinding | 예 | 앱 묶음에 필수; 성공·실패·불명을 Invocation으로 확인 | 앱 복원 결과 |

| capability | outcome | result | 제약 |
|---|---|---|---|
| reversible | applied | restored | 소유 복원 새 event가 있음 |
| reversible | blocked | unchanged | 복원할 수 있어도 전체 차단으로 미적용; 업무 변경임을 유지 |
| reversible | partial / uncertain | restored / unchanged / failure / uncertain | 실제 앱 결과 및 미시작 ledger 결과를 구별 |
| retained | applying / applied / partial / uncertain / blocked | retained | 이미 발생한 감사 사실; 복원 없음 |
| irreversible | applied / partial / uncertain / blocked | irreversible | 실제 외부·업무 영향 남음; applied이면 allow_partial=true |
| conflict | partial / uncertain / blocked | conflict | 해당 대상 미적용; 시작 전 blocked는 전체 미적용; 충돌 덮어쓰기 없음 |

changes는 시도 결과와 event 연결이며 원래 내용 복사본이 아니다. 원래 내용은 source_seqs에서, 복원 내용은 restored_seqs에서 읽는다.

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Revert | 원래 run | → lophn-agent/harness/run-loop | N:1 | 감사 참조 유지; 삭제 금지 |
| RevertChange | 원래 사실 | → platform/ledger | 1:1..N | event 삭제 금지 |
| RevertChange | 실제 보상 | → platform/ledger | 1:0..N | event 삭제 금지 |
| RevertChange | 복원 대상 | → owner | N:0..1 | owner가 현재 존재·보관·참조를 검사; 필요 근거 없으면 blocked |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `reverts` | Revert 헤더 | `id` PK | partial run WHERE outcome IN ('applying','applied','partial','uncertain'); `result_seq` | `(run, result_seq)` | run FK → lophn-agent/harness/run-loop; result_seq FK → `events.seq`(platform/ledger) |
| `revert_changes` | RevertChange의 owner·target·capability·result·reason | `(revert, ordinal)` PK | PK | `(owner, target)` | revert FK → `reverts.id`; reason은 고정 코드; target는 owner 존재 검사 |
| `revert_change_sources` | source_seqs의 각 event 연결 | `(revert, source_seq)` PK | 같은 Revert 안 source event 하나당 한 묶음 | `(revert, ordinal, source_seq)`; `(source_seq)` | `(revert, ordinal)` FK → `revert_changes`; source_seq FK → `events.seq` |
| `revert_change_compensations` | restored_seqs의 각 event 연결 | `(revert, ordinal, restored_seq)` PK | 같은 묶음 안 중복 없음 | `(restored_seq)` | `(revert, ordinal)` FK → `revert_changes`; restored_seq FK → `events.seq` |

최종 결과 행은 불변이다. `reverts`에 preview_hash 지문·state_seq를, `revert_changes`에 AppRevertBinding·단계 결과를 담는다. 단계 계획은 RevertStarted 때 만들고 checkpoint는 아직 미확정 단계의 결과만 CAS로 한 번 설정한다. applying 헤더는 최종 outcome·result_seq로 한 번 바뀐다. 최종 결과·완료 단계는 덮어쓰지 않는다. source event가 정확히 원래 run 전체와 같은지, ledger compensation event는 이 transaction의 actor=user/run=null이고 앱 compensation은 고정 receipt·사람 결정에 연결된 Invocation인지 command가 검사한다. 하나의 복원 event가 여러 원래 event를 보상할 수 있으므로 여러 묶음의 참조는 허용한다. blob 영구 참조 등록·공통 요청 결과는 → platform/blob-store, platform/ledger.

## command

전체 preview는 인증된 읽기이며 command나 domain event를 만들지 않는다. idempotency·입력 한도·공통 오류는 → platform/ledger.

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `revert_run` | `user` | id, run, allow_partial, preview binding_hash, source seq 전체 묶음·소유 CAS·준비 참조, confirmation 증거 | 종료 run·새 대상 변경 차단·진행/부분/불명확/applied revert 없음·전체 event 일치·각 owner CAS·복원 후 관계·남는 영향 동의 | `RevertStarted` 또는 `RevertApplied` + 소유 복원 event 또는 `RevertBlocked` | `forbidden`, `not_found`, `invalid_input`, `conflict`, `unavailable` |

- 인증·형식·대상 없음·같은 id의 다른 입력·이미 applied인 run·공통 크기 한도 오류는 command 거절이다. 유효한 새 시도의 도메인 복원 conflict·의존 위반·부분 동의 부족은 정상 확정된 blocked 결과와 event다.
- 오래된 preview면 고정 내용을 적용하지 않고 현재 판정의 blocked 결과를 저장한다. 사람이 본 내용을 조용히 고쳐서 적용하지 않는다. confirmation 증거 자체의 불일치는 forbidden/conflict다.
- ledger만 있는 revert는 각 owner 복원과 최종 결과를 한 transaction으로 확정한다. 앱 단계가 있는 revert는 먼저 전체 사전 검사와 `RevertStarted`/applying을 확정한 뒤 runtime이 직접 호출한다. network를 writer transaction 안에서 기다리지 않는다. 앱 단계 전 사전 충돌이면 blocked, 시작 뒤 새 충돌은 partial/uncertain이다.
- 파일 쓰기·앱 재시작·model call·hash 계산은 transaction 밖의 준비다. 그 작업이 없이는 복원이 성립하지 않는 변경은 준비·소유 contract 충족 없이 restored라고 기록하지 않는다.

### 앱 복원 실행 경계

`revert_run`은 앱 단계가 있으면 durable applying 접수 결과를 반환한다. runtime은 저장한 preview_hash와 AppRevertBinding을 읽고 `step_key`로 이미 수행한 복원 Invocation을 먼저 조회한다. 원래 write 역순으로 앱 revert command를 호출하며 사람 복원 결정·현재 앱 존재·release 계약·CAS를 검사한다. agent.commands Grant를 복원 권한으로 복사하지 않고 사용자 결정에 묶인 user actor의 앱 통로를 사용한다. 각 결과는 원래 receipt 및 revert ID에 묶어 `CheckpointRevert`로 남긴다. 이미 전달된 효과가 불명확하면 result query 외 재송신하지 않는다. 앱 단계 모두 성공 후 `FinishRevert`가 ledger owner CAS를 다시 검사하고 ledger 복원 전체 및 최종 결과를 transaction으로 확정한다. 새 conflict면 ledger는 미적용이고 이미 성공한 앱 복원은 partial이다.

이어 실행은 core의 `RunAppRevert`(`reverts/run_apps`, 사람 자격의 core 메모리 route)다. revert 창이 `RevertRun`의 applying 접수 뒤 이 route를 부르면 core가 위 순서를 이어 받는다: 앱 호출은 호출한 사람의 `apps/connect` 연결과 앱 direct socket(`request_key`=step_key), 단계 기록·끝내기는 core 내부 machine 자격이다(사람 token은 `CheckpointRevert`·`FinishRevert`를 직접 부르지 못한다). `CheckpointRevert.invocation`은 앱의 revert command 호출이 남긴 실제 Invocation(닿지 못했거나 응답을 잃었으면 null)이고 단계 근거의 `revert_invocation`에 남으며 원래 write의 invocation은 `invocation`에 그대로 있다. 끝내기가 owner CAS 거절로 취소되면 `groups` 없이 다시 끝내 앱 결과만 확정한다.

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `CheckpointRevert` | machine | revert, step_key, 실제 Invocation·결과 | applying·고정 preview·단계 중복 없음; 저장한 사람 결정 근거 | 없음; 앱 사실은 → apps/invocations | `conflict`, `forbidden` |
| `FinishRevert` | machine | revert, 전체 단계 근거 | applying·현재 ledger owner CAS·실제 앱 결과 | `RevertApplied / RevertFinished` | `conflict`, `forbidden` |

이 machine 작업은 등록한 사람 결정의 복원 동작만 수행하며 새 agent run·model 판단을 만들지 않는다. 최종 event actor=user/run=null이다. 복원 command 자체 confirm이면 원래 write approval을 재사용하지 않고 해당 owner의 새 정확한 사람 확인을 요구한다.

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `RevertStarted` | revert | `run`, preview_hash, 전체 앱 단계 참조 | lophn-agent/revert, shell/desktop |
| `RevertFinished` | revert | `run`, outcome=partial/uncertain, 결과별 묶음 수(`results`) | lophn-agent/observability, shell/desktop |
| `RevertApplied` | revert | `run`, `allow_partial`, `partial: boolean`, 결과별 묶음 수(`results`) | lophn-agent/observability, shell/desktop; 대상 owner |
| `RevertBlocked` | revert | `run`, 결과별 묶음 수(`results`) | lophn-agent/observability, shell/desktop |

복원 event의 actor는 user, envelope run은 null이다. payload.run은 원래 run의 연결이다. `partial=true`는 irreversible 업무 변경이 남았다는 뜻이며 retained 감사 사실만 남으면 false다. 대상 복원 event는 각 owner가 소유한다.

## 정책

- **전체 복원 경계.** owner의 검사·복원 한도를 넘는 전체 revert를 분할 적용하지 않는다. 원본 연결 문서의 version 복원과 파일 반영은 documents/file-tracking·documents/versions의 별도 사실이며 디스크 원본 복구를 보장하지 않는다.

### 영역별 복원 판정

| 대상 종류 | 판정 concern | 기본 분류·조건 |
|---|---|---|
| 문서 내용·metadata·자리 | → documents/versions, documents/addressing | reversible: 소유 CAS·참조 검사 통과; 내용은 이전 내용의 새 version; 파일 반영 완료와 ledger 복원은 별도 |
| context·item·term 후보 | → documents/contexts, documents/terms | reversible: 이전 값·현재 판 근거와 복원 후 관계 검사 필요 |
| agent run이 생성한 미claim ticket | → coding-agent/tickets | reversible: ticket 취소; claim 이후는 owner 판정 없이는 복원 불가 |
| pending approval request | → platform/approvals | 유효한 미결정 동작 차단은 owner의 cancellation 규칙; 이미 저장된 결정은 retained |
| assignment·preset·설정 변경 | → lophn-agent/assignments, lophn-agent/presets, platform/settings | owner가 현재 승인 범위·참조·판을 검사; 이전 값 근거 없이는 reversible 아님 |
| report·관측·snapshot·test result | → problems/reporting, problems/snapshots, problems/tests | retained; 관측 사실을 지우거나 problem을 닫지 않음 |
| run·tool/model call·질문 답·승인 결정·invocation 결과 | → lophn-agent/harness/run-loop, lophn-agent/harness/tools, lophn-agent/harness/usage, lophn-agent/questions, platform/approvals, apps/invocations | retained; 과거 사실·사용량·결정은 불변 |
| activation·secret 사용·외부 전송 등 실제 외부 효과 | → apps/releases, platform/secrets, 실제 호출 소유 concern | irreversible; 기존 효과를 취소됐다고 간주하지 않음 |
| 성공한 undo 지원 앱 write | → apps/blueprint, apps/runtime, apps/invocations | reversible: supported=true·대응 revert command·저장 receipt·현재 revision 검사; direct call로 실제 복원 |
| undo 미지원 앱 업무 변경·source git·외부 서비스·디스크 원본 | → apps/data, 해당 소유 concern | 직접 복원 범위 밖; 남은 영향은 irreversible로 설명 |
| 그 밖의 원래 run event | → 그 event의 소유 concern | owner가 판정·근거를 제공; 미분류 event를 누락하거나 안전하다고 가정하지 않음 |

- **run 범위.** event.run 전체에 ToolCall.run으로 고정 연결된 성공 앱 write Invocation·receipt를 더한다. Invocation 후행 기록이 아직 없으면 확인 불가로 표시하고 안전한 복원으로 가정하지 않는다. actor·시각 범위로 추정하지 않는다. completed·failed·stopped run의 확정 변경을 모두 포함한다. 기다리는 run은 먼저 stopped가 되어야 한다. → lophn-agent/harness/run-loop
- **부분 revert.** 기본 allow_partial=false다. irreversible 업무 변경이 섞이면 blocked다. true이면 독립적으로 유효한 reversible 변경 전체만 복원하고 irreversible 영향은 남긴다. retained 감사 사실만 있는 것은 부분 복원이 아니다.
- **분류 근거.** run의 변경은 ledger의 event(`event.run`)에서 읽고 소유 concern의 복원 판정(adapter)이 묶음·분류·복원 command 호출을 정한다. 대상의 처음 변경 뒤에 이 run이 아닌 event가 하나라도 있으면(끼었거나 뒤따랐거나) 값이 같아도 충돌이다. 어느 adapter도 맡지 않은 event는 분류하지 않은 복원 불가로 남고 목록에서 빠지지 않는다. 문서의 제목 변경은 사람 자격으로 부를 수 없는 보상 값이라 남는 변경(복원 불가)이다.
- **충돌.** 다른 변경이 끼거나 소유 CAS가 달라진 대상 하나라도 있으면 전체 blocked다. 부분 동의는 강제 복원·자동 병합의 허락이 아니다. 이 전체 blocked는 사전 검사에 적용하며 앱 복원 시작 뒤 새 충돌은 partial로 기록한다.
- **의존.** irreversible 변경에 의존하는 대상도 복원 후 관계가 유효해야 한다. 안전한 전체 묶음이 없으면 blocked다.
- **새 변경.** 문서 version pointer만 과거로 옮기거나 event를 삭제하지 않는다. 복원은 소유 concern의 새 변경이다. 새 복원 event의 actor=user/run=null이며 원래 run을 다시 수행한 것으로 기록하지 않는다.
- **후속 작업.** revert는 새 agent run을 만들지 않는다. ledger 복원·파일 반영·앱 상태 결과가 서로 다르면 각 소유 기록을 분리해 유지한다.

