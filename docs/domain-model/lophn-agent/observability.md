---
type: domain-model
concerns: [lophn-agent/observability]
---
# lophn-agent/observability

원본 event·run·call을 묶는 derived trace와 export·보존 정책의 값을 정의한다.

## RunTrace (값)

독립 Trace entity·ID·ledger 표 없이 조회 때 조립한다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `run` | `run` ID | 아니오 | trace 하나의 기준; → lophn-agent/harness/run-loop | 대상 |
| `basis` | sha256 | 예 | Run.basis 참조; 별도 본문 복제 없음 | 시작 당시 preset·scope·model 선택·tool 판 |
| `events` | seq 배열 | 아니오 | 원본 event seq 순; 샘플링 없음; → platform/ledger | 상태·실제 변경 |
| `messages` | `msg` ID 배열 | 아니오 | 원본 참조; → lophn-agent/conversation | 입력·결과 |
| `model_calls` | `mcl` ID 배열 | 아니오 | 모든 시도; → lophn-agent/harness/usage | model 이력 |
| `tool_calls` | `tcl` ID 배열 | 아니오 | deny·미실행·불명확 포함; → lophn-agent/harness/tools | tool 이력 |
| `handoff_links` | `{sender_run,receiver_run,original_message}` 배열 | 아니오 | 실제 source 관계; 양방향 조회; → lophn-agent/handoff | 독립 trace 연결 |
| `times` | `{wall_ms,active_ms,waiting_ms,model_ms,first_output_ms?,tool_ms}` | 아니오 | 0 이상 정수 ms; 서로 다른 의미를 합쳐 중복 표시 안 함 | 시간 종류 |
| `reason` | RunOutcome.reason | 예 | 종료 확인 전 null; 정상 완료 추정 금지 | 종료 분류 |
| `missing` | `{kind,reference,reason}` 배열 | 아니오 | 기본 `[]`; 없는 본문·기록 구별 | 부재 |

독립 ModelCall은 `run` 없는 call 하나를 기준으로 같은 참조 방식의 trace를 조회하며 실제 연결된 session만 가리킨다. 이를 위해 가짜 run·session을 만들지 않는다.

## TraceExport (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `targets` | run·session·독립 call 참조 배열 | 아니오 | user가 명시 선택; 빈 배열 금지 | 범위 |
| `format` | `ndjson` | 아니오 | 로컬 파일만 | 형식 |
| `format_version` | 양의 정수 | 아니오 | 1 | 문서 판 |
| `destination` | 로컬 파일 경로 | 아니오 | user 명시; URL·network 없음 | 목적지 |
| `content_kinds` | `message / model_input / model_output / tool_input / tool_output` 배열 | 아니오 | 기본 `[]`; export마다 user 재선택 | 본문 포함 선택 |
| `sent / not_sent` | 0 이상 정수 각각 | 아니오 | 실제 기록 수; 실패에도 분리 | export 결과 |
| `errors` | 안전한 오류 배열 | 아니오 | 기본 `[]`; 자유 error 원문 제외 | 누락 근거 |

## RetentionPolicy (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `capacity` | 용량 | 아니오 | 숫자·단위는 platform/blob-store가 정함; 이 concern은 숫자를 두지 않음 | 큰 자료 상한 |
| `evict` | `oldest_first` | 아니오 | 상한을 넘으면 오래된 큰 자료부터 | 정리 순서 |
| `permanent` | `change / decision / confirmed_result` | 아니오 | 변경 기록·결정·확정 결과; 용량 정리 대상 아님 | 영구 보존 |

## 정책

- **원본.** trace는 원본 event·Run·Message·ModelCall·ToolCall의 참조 묶음이다. 관측용 원문 사본·별도 조립 이력·비용 ledger를 만들지 않는다.
- **기록 범위.** 실제 model 시도·tool 판정은 샘플링하지 않는다. 확정 전 스트리밍 조각·진행 말은 영구 trace·재생·export 대상이 아니다. 확정 본문은 소유 call·message의 보호된 blob에서 읽는다.
- **검토 사실.** 차단 수·call 수·오류·시간·근거·usage만 계산한다. 품질 점수·통과 여부는 → lophn-agent/evaluation.
- **귀속.** handoff 수신 run은 독립 trace이며 실제 actor·비용 귀속을 sender로 바꾸지 않는다. subagent trace는 없다.
- **기본 export.** network·제삼자 usage 분석 전송은 하지 않는다. 로컬 파일만 내보내며 메타데이터를 기본으로 하고 내용은 해당 export에서 user가 다시 선택한 종류만 포함한다. project·역할·skill·서버는 범위나 목적지를 변경하지 못한다.
- **export 내용 상한.** 선택 내용은 redaction 뒤 값 하나당 UTF-8 32768 byte까지 앞부분만 내보내며 truncation·exclusion·원본 참조를 별도 표시한다. 복구 원본 blob에는 이 상한을 적용하지 않는다.
- **export 실패.** 로컬 원본·run 결과는 변하지 않으며 model retry를 만들지 않는다. sent·not_sent 수와 안전한 오류를 반환한다. export는 ledger command가 아닌 user 명시 read/export contract다.
- **보존.** 큰 자료(model 호출 본문, snapshot 첨부, trace 본문, 운영 log)는 용량 상한을 넘으면 오래된 것부터 정리한다. 변경 기록·결정·확정 결과는 영구 보존한다. 용량 숫자는 → platform/blob-store가 정하고 이 값은 그 상한을 가리킨다. 세션 보관 상태는 없다.
- **정리 보호.** 용량 정리에도 진행 run·미반영 입력·답/approval 대기·revert 근거는 삭제 대상으로 넘기지 않는다. event는 불변으로 남기며 삭제 본문은 부재로 보이고 성공·실패 사실을 바꾸지 않는다. 실제 삭제는 platform/ledger·platform/blob-store만 수행한다.
- **범위 분리.** 보존 설정은 문서 변경 이력·제품 세션 원문·eval 산출물 수명을 임의로 줄이지 않는다. → lophn-agent/conversation, lophn-agent/evaluation.

