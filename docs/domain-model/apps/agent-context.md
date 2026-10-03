---
type: domain-model
concerns: [apps/agent-context]
---
# apps/agent-context

blueprint에 담기는 화면 context 선언과 command 입출력 값을 정의한다. 독립 entity·ledger 표·event는 없고 선언은 release의 blueprint blob에 고정한다.

## AgentContextDeclaration (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `screen` | 문자열 | 아니오 | 같은 blueprint.screens.key; 목록 안 unique | 공유할 화면 |
| `read_command` | 문자열 | 아니오 | 같은 blueprint.commands.key; effect=read; confirm=false | 현재 상태 조회 handler |
| `sensitive_paths` | JSON Pointer[] | 아니오 | AppScreenContext.summary/data 내부 값; 중복 금지; 상위 path는 하위 전체 제거 | 내보내지 않을 칸 |
| `annotation_targets` | AnnotationTargetDeclaration[] | 아니오 | 빈 목록 허용; target key unique | 허용된 되쓰기 자리 |

## AnnotationTargetDeclaration (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `key` | 문자열 | 아니오 | 빈 문자열 금지; 화면 안 unique | 주석 자리 |
| `label` | 문자열 | 아니오 | 빈 문자열 금지 | 자리 설명 |
| `write_command` | 문자열 | 아니오 | 같은 blueprint.commands.key; effect=write | 주석 handler |

- 예약 command 이름은 없다. `read_command`와 `write_command`는 앱이 고른 안정된 key이며 별도 API나 MCP server를 만들지 않는다.
- 주석의 revert 지원은 참조 command의 `revert` 선언을 따른다(→ apps/blueprint). target 자체에 다른 되돌림 정책을 복제하지 않는다.

## AppScreenContext (값)

redaction 뒤 반환되는 일시 값이다. 현재 화면의 정본은 앱이며 lophn ledger에 화면 상태를 따로 저장하지 않는다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `app` | `app` ID | 아니오 | 인증된 대상 → apps/registration | 앱 |
| `release` | `rel` ID | 아니오 | 현재 live 프로세스 → apps/releases | 선언 기준 |
| `screen` | 문자열 | 아니오 | 선언된 screen key | 화면 |
| `view_session` | 불투명 문자열 | 아니오 | shell/app-frame의 인증된 현재 view session | 같은 앱의 탭 구분 |
| `revision` | 불투명 문자열 | 아니오 | 화면 상태 변경마다 새 값; 같은 view 내 CAS 기준 | 현재 코드·attempt 기준 |
| `summary` | 문자열 | 아니오 | redaction 뒤 UTF-8 최대 2048byte | turn용 작은 설명 |
| `data` | JSON object | 예 | `detail=true`일 때만; 민감 칸 제거; 크기/페이지 상한 → lophn-agent/harness/tools | 추가 화면 자료 |
| `redacted` | JSON Pointer[] | 아니오 | 제거한 path 또는 안전성 미확인으로 제거한 상위 path; 값은 없음 | 생략 사실 |

## ScreenContextReadInput (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `screen` | 문자열 | 아니오 | 해당 AgentContextDeclaration.screen | 대상 화면 |
| `view_session` | 불투명 문자열 | 아니오 | caller가 접근할 수 있는 열린 session | 대상 탭 |
| `detail` | boolean | 아니오 | 기본 false | 상세 요청 |

## AnnotationWriteInput (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `screen` | 문자열 | 아니오 | 선언된 target의 화면 | 대상 화면 |
| `view_session` | 불투명 문자열 | 아니오 | 현재 열린 session | 대상 탭 |
| `expected_revision` | 불투명 문자열 | 아니오 | 현재 revision과 일치 | 조회 뒤 변경 검사 |
| `target` | 문자열 | 아니오 | 해당 화면의 annotation_targets.key | 허용 자리 |
| `text` | 문자열 | 아니오 | 최대 길이는 참조 command.input schema가 선언 | 힌트·주석 |

## 정책

- **schema 검사.** read 입력은 ScreenContextReadInput, 출력은 AppScreenContext를 만족한다. write 입력은 AnnotationWriteInput을 포함하며 업무별 추가 필드는 기존 InputSchema로 선언한다. 앱 test와 시작에서 선언/handler 일치를 확인한다(→ apps/blueprint, apps/runtime).
- **revision.** read는 한 revision의 summary/data를 반환한다. 상세 조회의 revision이 이전 요약과 다르면 새 기준임을 그대로 반환한다. write는 handler transaction에서 expected_revision을 검사하여 conflict 또는 적용 후 새 revision을 반환한다.
- **redaction.** 앱이 sensitive_paths를 먼저 제거하고 플랫폼의 model 전달 경계가 → platform/redaction을 다시 적용한다. 민감 path가 없음을 확인할 수 없으면 해당 자료를 생략한다. DOM·credential 원문·secret 값은 대상이 아니다.
- **범위.** 열린 탭은 permission이 아니다. read/write 모두 agent.commands Grant와 역할/assignment의 범위 교집합 안에서만 호출한다(→ apps/permissions, lophn-agent/harness/tools).
- **부재.** 미선언 target/입력=invalid_input, 접근 범위 밖=forbidden, 닫힌 view/멈춘 앱=unavailable, revision 불일치=conflict다. 이전 화면 값을 최신으로 대체하지 않는다.
- **기록.** write invocation과 revert 근거는 → apps/invocations, lophn-agent/revert를 따른다. read 결과 본문을 별도 ledger에 복제하지 않는다.
