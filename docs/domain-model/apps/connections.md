---
type: domain-model
concerns: [apps/connections]
---
# apps/connections

blueprint의 앱 연결 선언과 다른 앱 호출의 인증된 출처 값을 정의한다. 별도 entity·ledger 표·event는 없으며 허락 정본은 → apps/permissions의 Grant다.

## AppCommandUseDeclaration (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `app` | `app` ID | 아니오 | → apps/registration; 자기 앱 금지; 목록 안 unique | 대상 앱 |
| `commands` | 문자열[] | 아니오 | 비어 있지 않음; 중복·wildcard 금지; 대상 command key | 쓸 command 범위 |
| `reason` | 문자열 | 아니오 | 빈 문자열 금지 | 앱 쌍 허락 때 보일 목적 |

대상은 slug·표시 이름이 아니라 불변 app ID다. 현재 대상 release에서 없어진 command는 unavailable이며 새 command는 자동 포함하지 않는다. 입력은 호출 때 대상 release의 schema로 검사한다.

## AppCallOrigin (값)

서명된 AppConnection 안의 일시 값이며 caller 본문의 주장은 받지 않는다(→ apps/runtime, platform/identity).

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `app` | 아니오 | discriminator; agent caller와 구별 | 다른 앱 호출 |
| `app` | `app` ID | 아니오 | 연결을 요청한 자식 신원 | 부른 앱 |
| `release` | `rel` ID | 아니오 | 부른 앱의 현재 release | 부른 코드 |
| `process_nonce` | 무작위 문자열 | 아니오 | 현재 자식과 일치 | 호출자 재시작 경계 |
| `grant` | `grt` ID | 아니오 | kind=app.call; app=부른 앱; scope.app=대상 | 앱 쌍 허락 |
| `parent_invocation` | `inv` ID | 예 | 현재 부른 앱 command/automation의 알려진 invocation → apps/invocations | 바로 위 업무 호출 |
| `path` | `app` ID[] | 아니오 | 최초 caller부터 현재 caller까지; 중복 금지; 최대 7개 | 다음 대상까지 최대 8개 앱 |

## 정책

- **교집합.** source release.app_connections의 대상 command 목록 ∩ active app.call Grant.scope.commands ∩ target release.commands.key다. grant와 선언은 방향 있는 `(caller app,target app)`에만 적용한다. 제3 앱으로 위임하지 않는다.
- **연결.** caller의 broker 인증 연결이 current app/release/nonce를 정한다. 연결 준비 서비스가 target의 현재 nonce·release와 위 교집합을 묶어 AppConnection을 발급한다(→ apps/runtime). SDK client는 그 이후 target socket을 직접 호출한다.
- **프로세스.** 회수·source/target 교체는 관련 source 통로를 닫고 이전 source 자식 종료 확인 뒤 새 범위로 시작한다. stale source/target nonce를 거절한다(→ apps/permissions, apps/runtime).
- **효과.** 앱 쌍 허락은 대상 앱의 file/network/secret Grant나 호출별 approval을 대신하지 않는다. confirm은 → apps/invocations의 accepted/proof를 쓴다. preview의 다른 앱 실제 호출은 없고 → apps/preview의 대역만 쓴다.
- **경로.** 다음 target이 path에 이미 있거나 추가 뒤 길이가 8을 넘으면 invalid_input이다. path와 알려진 부모 inv는 인증된 SDK invocation 문맥에서 연결 준비 서비스가 서명하며 command input의 path 주장은 무시한다.
- **기록.** target Invocation.actor는 app actor, caller는 이 AppCallOrigin의 안전한 app/release/parent 참조다(→ apps/invocations). token·nonce·grant credential 원문은 invocation 본문에 저장하지 않는다.
