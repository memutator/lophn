---
type: domain-model
concerns: [lophn-agent/harness/waiting-and-recovery]
---
# lophn-agent/harness/waiting-and-recovery

Run의 기다림 결정 반영과 확인된 경계의 복구 기록을 정의한다.

## WaitResolution (값)

독립 entity가 아니라 결정 반영 command의 결과와 event payload다. Run은 → lophn-agent/harness/run-loop, 질문은 → lophn-agent/questions, approval request는 → platform/approvals.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `run` | `run` ID | 아니오 | waiting_on의 요청과 일치 | 재개 또는 종료 대상 |
| `request` | `qst / apr` ID | 아니오 | Run.waiting_on과 같음 | 결정 대상 |
| `decision_seq` | seq | 아니오 | Question.closed_seq 또는 ApprovalRequest.closed_seq와 일치; 요청 소유 영역의 확정 결정 event | 중복 반영 key |
| `tool_call` | `tcl` ID | 예 | approval에 필수; 요청의 고정 call; → lophn-agent/harness/tools | 재검사 대상 |
| `result` | `resumed / stopped_no_answer / call_started / call_not_executed / ignored_finished` | 아니오 | 아래 표와 일치 | 적용 결과 |
| `reason` | 안전한 짧은 코드 | 아니오 | 결정 값 자체를 입력으로 신뢰하지 않음 | 재검사 또는 미실행 이유 |

### 기다림의 끝

| 요청·결정 | call 처리 | Run 처리 | 이유 |
|---|---|---|---|
| 질문 답 | 선택지 action은 질문 영역의 실제 적용 결과 확인 | 같은 run `running` | `question_answered` |
| 질문 만료·미루기·취소 | 미시작 call 정리 | `finished`, outcome `stopped` | `no_answer` |
| 승인 허락·재검사 통과 | 고정 call만 한 번 시작 | 같은 run `running` | `approval_allowed` |
| 승인 허락·재검사 실패 | 고정 call 미실행 | 같은 run `running`, 새 판단 | 현재 상태·scope·입력·비교 기준의 안전한 오류 |
| 승인 거절·만료·취소 | 고정 call 미실행 | 같은 run `running`, 새 판단 | `human_decision` |
| terminal run의 늦은 결정 | 새 call·변경 없음 | `finished` 유지 | `ignored_finished` |

- 사람 거절·만료·취소로 미실행한 call은 tool·run 실패 수에 넣지 않는다.
- run 자체 멈춤·종료가 먼저 확정되면 새 판단을 시작하지 않는다.
- 일반 세션 메시지는 기다림을 풀지 않는다. 명시적 방향 수정은 옛 요청 취소와 미시작 call 정리를 묶는다. 질문 취소는 `no_answer` 종료이며 미반영 correction은 새 담당 run에 보존한다. 승인 취소는 같은 run의 새 판단으로 잇는다.
- Question.run은 필수이며 session은 선택이다. 있으면 run의 session과 같아야 한다. 세션 없는 run의 질문에 가짜 세션을 만들지 않는다.

### 전이

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| `running` | `waiting_user` | machine | 질문·approval 생성과 waiting_on 연결 원자 확정 | `RunWaited` |
| `waiting_user` | `running` | machine | 유효 미반영 결정; 위 표; 현재 assignment·scope·멈춤 재검사 | `RunResumed` |
| `waiting_user` | `finished` | machine | 질문 답 없음 또는 run 멈춤 | `RunFinished` → lophn-agent/harness/run-loop |
| `accepted / running / waiting_user` | 같은 상태 또는 확인 가능한 진행 상태 | machine | 아래 복구 표; 누적 한도·현재 자격 유효 | `RunRecovered` |

## RecoveryBasis (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `run` | `run` ID | 아니오 | terminal이면 감사 보완만 | 대상 run |
| `boundary` | `accepted / model_started / model_finished / ledger_write / outside_call / waiting / finished` | 아니오 | ledger 및 대응 contract로 확인 | 끊긴 경계 |
| `basis_seq` | seq | 아니오 | 확인한 run 상태 seq | CAS 기준 |
| `call` | `mcl / tcl` ID | 예 | call 경계에는 필수 | 확인 call |
| `confirmed_results` | contract 결과 참조 배열 | 아니오 | `[]` 허용; 실제 확인 결과만 | 재사용 근거 |
| `elapsed` | RunElapsed | 아니오 | → lophn-agent/harness/run-loop; 초기화 금지 | 복구 후 누적 시간 |
| `resolution` | `resume / finish / audit_only` | 아니오 | 아래 표와 일치 | 복구 결과 |
| `reason` | 안전한 코드 | 아니오 | 비밀·원문 error 제외 | 확인·종료 이유 |

| 경계 | 복구 정책 |
|---|---|
| 접수 뒤 시작 전 | 접수 seq대로 선택; 현재 assignment·설정 확인 |
| ModelCall 시작만 기록 | 전송·usage 모름; 기존 시도 `uncertain` 종료; 남은 retry·run 한도 안에서만 새 시도 |
| 완전 응답 저장 뒤 | 저장 응답·후행 읽기 기록·선행 쓰기 기록 확인; 확정 결과 재사용; 기록 없는 읽기는 현재 scope 재검사 뒤 다시 읽을 수 있음 |
| ledger 쓰기 응답 유실 | 최초 tcl idempotency 결과 조회; 변경·성공 기록 확정이면 반복 안 함 |
| ledger 밖 call 시작 뒤 결과 없음 | 대응 contract 결과 조회·idempotency로 확인; 확인 불가면 불명확 기록 후 run 종료 |
| 질문·approval 대기 | 같은 요청 현재 결정 조회; 유효 미반영 결정만 한 번 반영 |
| 종료 뒤 늦은 결과 | 감사 보완만; 새 대상 변경·새 run·재개 없음 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `run_wait_resolutions` | WaitResolution 및 반영 event seq | PK `(run,request,decision_seq)` | `(request,decision_seq)` | `(run,decision_seq)` | run FK; 요청 존재·유형 검사; tool_call FK; 결정 event FK; 삭제 RESTRICT |

RecoveryBasis는 `RunRecovered` payload로 남기며 독립 복구 표·entity를 만들지 않는다. Run 상태·waiting_on·elapsed의 원본은 → lophn-agent/harness/run-loop.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `WaitRun` | machine | run, 새 질문 또는 approval 제출, call? | 예상 running·state_seq; 요청 생성 및 연결 원자 처리 | `RunWaited` | `conflict`, `invalid_input`, `forbidden` |
| `ResolveRunWait` | machine | run, request, decision_seq | 예상 waiting_user·waiting_on·state_seq; ledger 결정 조회; 반영 key | `RunResumed` 또는 `RunFinished` | `conflict`, `invalid_input`, `forbidden` |
| `CorrectWaitingRun` | user / machine | run, correction 메시지, 옛 request | 예상 waiting_on·state_seq; 옛 요청 취소와 입력 담당 정리 | 요청 소유 영역 취소 event 및 `RunResumed` 또는 `RunFinished` | `conflict`, `forbidden` |
| `RecoverRun` | machine | RecoveryBasis | 현재 state_seq·assignment·credential·scope·누적 한도 | `RunRecovered` 또는 `RunFinished` | `conflict`, `forbidden`, `unavailable` |

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `RunWaited` | run | request, call?, waiting 시작 시각 | shell/desktop |
| `RunResumed` | run | request, decision_seq, WaitResolution | lophn-agent/harness/run-loop, shell/desktop |
| `RunRecovered` | run | RecoveryBasis | shell/desktop, lophn-agent/observability |

## 정책

- **한 번 반영.** 결정 전달은 ledger의 현재 요청을 읽는다. event 또는 입력 payload에 실린 결정 값만으로 적용하지 않는다. 재시작 때 대기 요청을 직접 조회하여 event 유실도 확인한다.
- **기다림 자원.** waiting_user는 모델·앱 connection, DB transaction, write queue, 문서 lock을 보유하지 않는다. assignment의 진행 순서 자리만 유지한다.
- **시간.** active·stall 시간은 단조 시계로 재며 확인 경계에 저장한다. 꺼진 구간은 보수적으로 누적하고 시계 변화로 확정 불가면 `clock_uncertain`으로 종료한다. waiting 시간은 누적에서 제외한다.
- **불투명 추론 상태 유실.** 필수 provider 상태는 run 메모리에만 있다. 메모리 유실 뒤 해당 상태 없이 완전 응답의 tool 연속 요청을 만들지 않는다. adapter가 검증한 상태 없는 새 입력 구성으로만 남은 run 한도 안에서 진행할 수 있으며 불가능하면 `configuration_unavailable`로 끝낸다. → lophn-agent/harness/provider.
- **확인 불가 쓰기.** 불명확 효과와 충돌하는 후속 call은 확인 전 금지다. 사람의 새 run도 앞 효과 확인을 생략하지 않는다.
- **저장 불가.** 새 model·쓰기·approval 필요·external call은 시작하지 않는다. 읽기는 현재 assignment·scope를 검증할 수 있을 때만 후행 기록으로 허용한다. 결과 저장 전 다음 model 판단은 금지다.

