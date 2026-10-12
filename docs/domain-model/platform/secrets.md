---
type: domain-model
concerns: [platform/secrets]
---
# platform/secrets

OS keychain에 보관한 secret의 이름·불투명 참조와 사용 경계의 값을 정의한다.

## SecretReference (값)

독립 entity·ID는 없고 전역 앱 secret 이름 공간 하나를 쓴다. 어느 앱이 어느 이름을 쓸 수 있는지는 → apps/permissions다. provider credential의 등록·로그인·갱신 참조는 → lophn-agent/harness/provider, 외부 MCP 인증 참조·로그인·갱신은 → lophn-agent/extensions다. 아래 SecretReference와 SetSecret·RemoveSecret의 사람 관리 규칙은 앱 secret 이름에 적용하며 provider·외부 MCP의 정상 갱신 참조를 이 표에 복제하지 않는다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `name` | string | 아니오 | 비어 있지 않음; 전역 unique; rename은 새 이름 생성 뒤 이전 이름 제거 | secret 이름 |
| `sealed_ref` | 불투명 string | 아니오 | OS keychain 준비 결과; agent 읽기에 내보내지 않음 | 보호 값 참조 |
| `revision` | integer | 아니오 | 1 이상; 이름별 교체마다 증가 | 참조 판 |

값·값의 공개 hash·원문 일부·길이는 ledger에 없다. 없는 참조는 `not_found`, keychain 잠김·누락은 `unavailable`이다. 이름·설정 여부만 허용 범위에 내보낸다.

### 상태

별도 status 필드는 없다.

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | 참조 있음 | user | 보호 입력·OS 준비 성공; 이름 부재 CAS | `SecretSet` |
| 참조 있음 | 새 참조 | user | OS 준비 성공; 이전 참조·revision 일치 | `SecretSet` |
| 참조 있음 | 없음 | user | 이전 참조·revision 일치 | `SecretRemoved` |

### 불변 조건

- 사람만 전용 보호 입력에서 관리한다. 대화·질문 답으로 값을 받거나 원문 일부를 요구하지 않는다.
- OS keychain 준비는 ledger command 밖에서 끝낸다. 짧은 command는 이전 참조·판을 비교하고 참조만 교체한다.
- 참조 교체 실패이면 이전 참조를 유지한다. 고아 준비 값과 이전 값은 플랫폼 worker가 정리한다.
- 참조 제거는 이후 사용 차단이다. OS 값 삭제·사용 프로세스 종료 확인이 끝났다는 뜻으로 표시하지 않는다.

## SecretPreparation (값)

OS 준비 결과이며 값은 command에 포함하지 않는다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `preparation` | 불투명 string | 아니오 | 신뢰 플랫폼 worker의 준비 식별 | 준비 증거 |
| `sealed_ref` | 불투명 string | 아니오 | 준비된 OS 값 참조 | 새 참조 |
| `purpose` | `app_secret` / `provider_credential` / `external_mcp_credential` / `coding_connection_credential` | 아니오 | 다른 용도로 사용 불가 | 용도 |
| `owner` | string | 아니오 | 앱 secret 이름 또는 provider·외부 MCP·coding connection credential의 고정 소유 key | 소유 대상 |

## SecretUse (값)

플랫폼 소비 경계 안에서만 사용하고 일반 조회 결과로 반환하지 않는다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `sealed_ref` | 불투명 string | 아니오 | 현재 참조와 같음 | 사용할 값 |
| `revision` | integer | 아니오 | 현재 판과 같음 | 사용 판 |
| `purpose` | `app_secret` / `provider_credential` / `external_mcp_credential` / `coding_connection_credential` | 아니오 | 준비 용도와 같음 | 용도 |
| `destination` | 검증된 목적지 값 | 아니오 | 실제 전송 목적지·동작과 현재 허용 조건에 묶임 | 소비 경계 |

앱 사용은 고정 release 요구 ∩ 유효 grant의 secret 이름에만 허용한다. 호출마다 사람 approval을 요구하지 않고 command를 부른 쪽(사람 화면·agent·automation·다른 앱)으로 막지 않는다. command의 confirm·external 판정은 → apps/invocations, lophn-agent/harness/tool-judgment. provider 인증은 현재 provider 참조·판을 검사하고 HTTPS 전송 직전에 붙인다(→ lophn-agent/harness/provider).

## SecretCleanupResult (값)

일반 조회에는 안전한 완료 여부만 준다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `reference_blocked` | boolean | 아니오 | 현재 ledger 참조 제거·교체가 확정됐으면 true | 이후 사용 차단 |
| `os_deleted` | boolean | 아니오 | OS 삭제를 실제 확인한 경우만 true | 이전 값 삭제 |
| `processes_ended` | boolean | 아니오 | 이전 값을 쓴 프로세스 종료를 모두 확인한 경우만 true | 메모리 사용 종료 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `secrets` | 현재 SecretReference | `name` | PK | 없음 | `sealed_ref`는 OS 참조이므로 FK 없음; revision CAS |

provider·외부 MCP credential 참조·판은 각각 → lophn-agent/harness/provider, lophn-agent/extensions의 소유 기록에 둔다. `secrets`를 이들의 로그인 상태 원본으로 쓰지 않는다.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `SetSecret` | user | name, SecretPreparation | 이전 sealed_ref·revision 또는 이름 부재 | `SecretSet` | `invalid_input`, `unauthorized`, `forbidden`, `conflict`, `unavailable` |
| `RemoveSecret` | user | name | 이전 sealed_ref·revision | `SecretRemoved` | `unauthorized`, `forbidden`, `not_found`, `conflict`, `unavailable` |

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `SecretSet` | `secret:<name>` | `{name: string}`; 값·참조·공개 hash 없음 | platform/secrets(OS 정리), apps/runtime(사용 앱 종료·재시작) |
| `SecretRemoved` | `secret:<name>` | `{name: string}`; 값·참조·공개 hash 없음 | platform/secrets(OS 정리), apps/runtime(사용 앱 종료·재시작) |

## 정책

- **원문.** 값은 OS keychain과 허용된 플랫폼 메모리에만 있다. 어떤 agent도 값을 받지 않는다. ledger·event·blob·derived store·backup·환경 변수·renderer·command 응답·보고에 넣지 않는다.
- **사용.** 실제 전송 직전에 플랫폼 경계가 인증을 붙이는 방식을 쓴다. 앱 사용자 코드에 원값을 주는 일반 API는 첫 지원 범위에서 열지 않는다. redirect에 인증을 자동 전달하지 않는다. 앱 사용 허락은 현재 grant이며 caller 종류나 secret 사용 자체로 호출별 approval을 추가하지 않는다. → platform/secrets#R10
- **인증 갱신.** 신뢰 provider·외부 MCP 전송 adapter의 process/task·소유 key·목적지·용도·현재 참조/revision을 확인한 뒤 보호 keychain 준비를 한다. 값 없는 SecretPreparation과 이전 CAS만 credential 소유 command에 제출한다. 실패는 이전 참조 유지·고아 정리이며 agent·tool·앱 코드가 이 원값 경로를 호출하지 못한다. → platform/secrets#R11, lophn-agent/harness/provider, lophn-agent/extensions
- **이전.** 사람이 보호 입력에서 명시 선택한 항목만 일반 backup과 분리해 암호 보호 export/import한다. 보호 adapter 안에서만 keychain 값을 암호화·복호화하고 새 keychain 준비·참조 CAS를 거친다. 잘못된 암호·변조·잠김·중단은 기존 참조를 바꾸지 않는다. 평문 중간 파일·agent·일반 API 결과는 없으며 구체 format과 암호 parameter는 → platform architecture의 secret contract다. → platform/secrets#R9
- **provider credential 정리.** Disconnect 같이 소유 concern이 참조를 지우면 ledger 확정 뒤에 core가 그 owner의 OS 값을 지운다. 삭제가 실패하거나 확정과 삭제 사이에 끊기면 따로 보관할 기록 없이 쓸어 낸다: keychain의 provider credential 항목 가운데 ledger가 가리키지 않는 것이 대상이다. 쓸기는 이미 열린 keychain에서만 한다(참조 때문에 맞춤이 열었거나 Connect·Disconnect가 연 경우). 참조가 없는 core는 keychain을 열지 않으므로(→ platform/secrets#R1) 열린 적이 없으면 아무것도 하지 않는다. 그래서 확정 뒤 삭제 전에 죽어 남은 고아는 재기동만으로는 지워지지 않고, 다른 이유로 keychain이 열릴 때(예: 새 Connect) 주기 쓸기가 지운다. 보호 입력을 마치고 참조가 확정되기 전의 값과 구별할 수 없으므로 주기 쓸기는 두 번 연속 본 항목만 지우고, core가 막 뜰 때는 보호 입력이 아직 없어 바로 지운다. keychain이 잠기거나 목록을 낼 수 없으면 지우지 않고 다음에 다시 한다.
- **변경.** 변경·삭제·grant 회수 뒤 새 사용은 차단하고 이전 값을 사용한 앱 프로세스는 종료 확인 뒤 새로 시작한다. 외부 요청은 로컬 삭제로 취소되지 않는다.
- **keychain 불가.** 잠기거나 없는 환경에서는 secret 필요 기능만 `unavailable`이다. 평문 파일·ledger·blob·설정·환경 변수 fallback은 없다. secret 없는 로컬 기능은 계속된다.
- **오류.** 안전한 이름·용도·완료 여부만 남긴다. 입력 값·인증 header·keychain 내부 경로는 오류에 없다.

## 정할 것

- secret name 문법·길이와 OS keychain adapter의 불투명 참조 모양. keychain이 없거나 잠기면 secret 기능만 사용 불가로 두고 파일 볼트는 쓰지 않는다.
- OS 삭제·프로세스 종료 미완료 결과의 지속 보관과 재시도 key. 현재 참조 교체 성공과 정리 완료를 합치지 않는다.
- automation은 사람이 켤 때 command·입력·주기를 한 번 승인한 external·read·write의 secret 사용을 grant로 판단한다. confirm=true command만 automation에서 뺀다(→ apps/automations). secret 사용 자체를 금지하지 않는다.

## coding connection 보호 준비

`coding_connection_credential`의 owner는 → coding-agent/connection의 안정된 principal이다. 이름 공간 secrets 표에 복제하지 않고 신뢰 인증 경계가 principal로 OS keychain 값을 resolve한다. keychain 준비는 core command 밖, token 검증 hash·active connection 확정은 소유 command transaction 안이다. 준비 값은 확정 전 인증에 쓰이지 않는다. commit 실패·중단 고아는 신뢰 경계가 정리하며 원값·keychain locator를 event에 남기지 않는다. trusted loader의 목적·실제 child·connection scope를 확인한 보호 process-local 전달만 → platform/identity#R15로 허용한다. 앱 secret 값·provider 원값 전달 허락과 섞지 않는다.
