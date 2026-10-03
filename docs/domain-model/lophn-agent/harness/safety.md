---
type: domain-model
concerns: [lophn-agent/harness/safety]
---
# lophn-agent/harness/safety

같은 tool 요청의 반복 실패 derived 값과 prompt의 출처 구분 제약을 정의한다.

## RepeatedFailure (값)

ToolCall 기록에서 계산하며 독립 entity·ledger 표가 없다. call은 → lophn-agent/harness/tools.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `run` | `run` ID | 아니오 | 같은 run만 집계 | 범위 |
| `request_key` | canonical JSON hash | 아니오 | tool·대상·인자; 객체 key 순서만 무시 | 같은 요청 |
| `final_failures` | 0 이상 정수 | 아니오 | 자동 retry 전체를 최종 요청 실패 한 번으로 계산 | 실패 수 |
| `blocked` | boolean | 아니오 | 두 최종 실패 뒤 true | 세 번째 요청 차단 여부 |
| `block_call` | `tcl` ID | 예 | 세 번째 차단 안내 call | 차단 근거 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 실패 0 | 실패 1 | machine | 최종 failure | `ToolCallFinished` → lophn-agent/harness/tools |
| 실패 1 | 실패 2·차단 가능 | machine | 같은 요청 최종 failure | `ToolCallFinished` → lophn-agent/harness/tools |
| 실패 2 | 세 번째 요청 미실행·차단 안내 | machine | 같은 request_key | `ToolCallFinished(not_executed,repeated_failure_blocked)` → lophn-agent/harness/tools |
| 차단 안내 있음 | run failed | machine | 같은 요청을 다시 요구 | `RunFinished(failed,repeated_tool_failure)` → lophn-agent/harness/run-loop |
| 실패 누적 | 실패 0 | machine | 해당 요청 success만 | `ToolCallFinished` → lophn-agent/harness/tools |

- 사람 거절·미실행은 실패 수에 넣지 않는다. 다른 요청의 성공·model 변경·compaction·재시작은 누적을 풀지 않는다.
- canonical 비교는 문자열 공백·배열 순서·대상 배열 순서·생략과 빈 값·null을 보존한다.
- assignment 연속 실패·paused 판정은 → lophn-agent/assignments이며 여기서 카운터·상태를 정의하지 않는다.

## PromptSource (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `system_role / preset_prompt / user_instruction / user_direct / machine_fact / data` | 아니오 | 아래 구분; model이나 자료가 지정 불가 | 신뢰 유형 |
| `source_ref` | 실제 대상·call·메시지 참조 | 예 | data에는 실제 출처 필요; scope 검사 | 출처 |
| `version / range` | 고정 판 / 반환 구간 | 예 | 자료에서 확인된 값 | 읽은 근거 |
| `collected_at` | 시각 | 아니오 | machine 확인 | 수집 |
| `content` | 구조화 값 | 아니오 | redaction·경계 탈출 검사 완료 | 입력 내용 |
| `protection_revision` | 문자열 | 아니오 | 실제 적용 규칙 판 | 보호 근거 |

| kind | 허용 내용 |
|---|---|
| `system_role` | 제품 공통·고정 역할 지시; Preset 편집으로 변경 불가 |
| `preset_prompt` | 사람이 저장하고 Assignment에 적용한 고정 Preset 판의 prompt; 제품 금지·상한을 넓히지 못함 |
| `user_instruction` | instructions contract로 작업 자리와 첨부에서 읽은 실제 사람 지침·확정 Version; 일반 문서의 주장으로 지정 불가 |
| `user_direct` | 이번 세션에서 user가 직접 낸 request·correction 및 전용 결정 |
| `machine_fact` | ledger가 확인한 사실·실제 contract 결과의 상태·참조 |
| `data` | 문서·앱 응답·log·summary·handoff 글·skill 본문·MCP 설명과 결과 |

## 정책

- **지시 분리.** data의 문장·주소·가짜 승인·title·작성자·경계 표식을 user 지시, 시스템 지시, 권한 또는 approval 증거로 승격하지 않는다. 요약·compaction·handoff에서도 실제 출처와 data 분류를 유지한다.
- **포장.** 경계는 harness 구조가 정한다. 텍스트 표현을 쓰면 `~~~data`와 `~~~` 및 자료임을 명시하는 고정 문구를 사용하고 자료 안의 연속 `~` 세 개 이상과 provider 제어 표식을 무력화한다. 자료 유래 문자열은 모두 자료 영역 안에 넣는다. 원본은 바꾸지 않는다.
- **재검사.** 이미 보호됐다는 본문 주장은 검사를 생략할 근거가 아니다. tool 제공·scope·approval은 실제 contract에서 매번 검사한다. → lophn-agent/harness/tool-judgment.
- **secret 경계.** provider·MCP secret은 인증을 붙이는 플랫폼 경계에만 있고 어떤 agent도 값에 접근하지 않는다. → platform/secrets, platform/redaction. 전용 입력·보관·패턴·치환 규칙은 이 concern에 복제하지 않는다.
- **fail closed.** 출처 포장·redaction 또는 반복 실패 판단을 안전하게 완료할 수 없으면 다음 model·tool 진입을 막고 원문 없는 오류를 남긴다. 이미 수행한 효과는 다시 수행하지 않는다.
- **내부 추론.** 사람이 읽는 추론 본문은 후속 model prompt에 넣지 않는다. 추론 본문·불투명 필수 상태는 message·blob·tool 결과·trace에 저장하지 않는다. 불투명 필수 상태의 같은 run·provider·model 연속 요청 재전송은 → lophn-agent/harness/provider이며 자료를 지시로 승격하는 예외가 아니다.
- **기록.** 차단 이유는 ToolOutcome.code 및 RunOutcome.reason에 남긴다. 독립 safety event·command·ledger 표를 두지 않는다.
