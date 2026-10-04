---
type: domain-model
concerns: [platform/identity]
---
# platform/identity

인증된 actor, credential의 범위·사용 조건과 loopback 인증 정책을 정의한다.

## Actor (값)

| 값 | 타입·참조 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `user` | literal | 아니오 | 이 컴퓨터의 한 사람 | 사람 |
| `coding_agent:<connection>` | `cac` ID → coding-agent/connection | 아니오 | 유효한 해당 connection의 token에서 결정 | coding agent |
| `agent:<assignment>` | `asg` ID → lophn-agent/assignments | 아니오 | 유효한 assignment·run 자격에서 결정 | lophn agent |
| `machine` | literal | 아니오 | 신뢰 플랫폼 작업 credential에서 결정 | 규칙 처리 |
| `app:<app>` | `app` ID → apps/registration | 아니오 | 해당 앱 프로세스 credential에서 결정 | 앱 |

actor는 token으로 정하며 본문·label·제품 이름·환경 변수로 추정하지 않는다. 같은 제품의 별도 coding agent connection을 합치지 않는다.

## Credential (값)

별도 entity·ID 접두사를 만들지 않는다. 영구 coding agent connection은 → coding-agent/connection이다. 나머지 실행 credential은 메모리 값이다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `token` | 불투명 string | 아니오 | 충분한 무작위성; 신뢰 인증 경계에서 자동 발급·OS keychain 보관; 일반 조회·ledger·event에는 원문 없음 | 인증 값 |
| `principal` | string | 아니오 | 서버가 만든 안정된 주체 식별; token 회전과 독립 | idempotency 범위 |
| `actor` | Actor | 아니오 | 서버가 발급 때 결정 | 주체 |
| `scope` | CredentialScope | 아니오 | 해당 actor의 상한 이하 | 허용 범위 |
| `conditions` | CredentialConditions | 아니오 | 실제 시작 대상에 묶임; 현재 조건과 교집합 | 사용 조건 |
| `state` | `active` / `revoked` / `ended` | 아니오 | revoked·ended에서 active로 복구 불가 | 유효 상태 |

### 상태

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | active | machine 또는 확인된 user 결정 | 신뢰 시작 경로 또는 connection 생성 | 영구 connection event는 → coding-agent/connection; 실행 값은 없음 |
| active | revoked | user / machine | connection 회수, assignment 멈춤·거둠, 앱 권한 회수 | 소유 concern의 event |
| active | ended | machine | 작업·프로세스·run 종료, 감독 연결 상실, core 재시작 | 소유 concern의 종료 event |

## CredentialScope (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `operations` | 등록된 동작 이름 집합 | 아니오 | actor 종류 상한과 현재 허용 동작의 교집합 | 동작 범위 |
| `targets` | 등록된 대상 범위 | 아니오 | connection·assignment·앱·배정 작업의 범위 이내 | 대상 범위 |

| actor | 상한 |
|---|---|
| user | 사람용 읽기·command; 사람 결정은 별도 증거 필요 |
| coding_agent | 전체 또는 앱 하나의 협업 통로; 승인·문제 닫힘·grant 관리·secret 값·원본 파일 작업 없음 |
| agent | 시작 때 고정한 역할·tool·scope·산출물과 현재 허용 조건의 교집합; 임의 shell·파일·웹·코드·secret 값·자기 권한 변경 없음 |
| app | 자기 앱의 선언된 보고·산출물 통로; ledger·다른 앱 DB·keychain 직접 접근 없음 |
| machine | 배정한 작업·대상·결과 command만; 테스트 결과는 실제 test runner만 제출(→ problems/tests) |

구체 connection scope는 → coding-agent/connection, 역할 scope는 → lophn-agent/roles, 앱 접근 권한은 → apps/permissions다.

## CredentialConditions (값)

해당 종류에 필요한 필드만 있다. 요청자가 임의로 추가해 범위를 넓히지 못한다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `run` | `run` ID | 예 | agent이면 필수; 자격과 동일한 run | 실행 |
| `assignment` | `asg` ID | 예 | agent이면 필수; actor의 assignment와 같음 | assignment |
| `app` | `app` ID | 예 | app·앱 대상 연결이면 필수 | 대상 앱 |
| `release` | `rel` ID | 예 | app이면 필수; 시작에 고정 | 앱 판 |
| `process` | 불투명 process 식별 | 예 | app·worker 실행 자격이면 필수; PID만으로 식별 불가 | 신뢰 프로세스 |
| `mode` | 등록된 실행 모드 | 예 | app이면 필수; 운영·테스트·미리보기 구별 | 사용 환경 |
| `task` | 배정 작업 참조 | 예 | worker이면 필수; 결과 종류·대상에 묶임 | machine 임무 |

## AuthenticatedContext (값)

클라이언트가 만들 수 없는 내부 값이며 읽기는 해당 snapshot에서, 쓰기는 실행 transaction에서 현재 조건을 재검사한다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `principal` | string | 아니오 | 검증된 Credential에서만 | 안정된 주체 |
| `actor` | Actor | 아니오 | 검증된 값 | 기록 주체 |
| `scope` | CredentialScope | 아니오 | 현재 제한 포함 | 현재 범위 |
| `conditions` | CredentialConditions | 아니오 | 현재 유효 상태 포함 | 현재 조건 |

## QuestionActionEvidence (값)

질문의 고정 선택지 action 적용만 `machine` credential에서 `user` 변경으로 기록할 수 있다. 질문과 action 자체는 → lophn-agent/questions다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `question` | `qst` ID | 아니오 | 사람의 실제 답이 확정된 질문 | 결정 근거 |
| `option` | string | 아니오 | 실제 고른 option의 고정 key | 선택 |

core는 정본 action의 concern·command·대상·정확한 입력·CAS와 제출 동작 전체가 같은지 검사한다. 되돌릴 수 있는 안쪽 동작만 허용하며 한 번 적용한다. 자유 답을 command로 해석하지 않는다. CAS가 달라지면 `conflict`이며 적용하지 않는다. 일반 machine이 질문 ID나 `actor=user`를 적는 것은 근거가 아니다.

## 정책

- **자격 보관.** user token은 shell main만, app·assignment·worker token은 신뢰 프로세스 메모리만 가진다. renderer·대상 앱 코드·format module·테스트 코드에 플랫폼 credential을 주지 않는다.
- **coding agent token.** 사람의 정확한 harness 연결 결정 뒤 인증 경계가 자동 발급·OS keychain 보관 준비를 수행하고 connection command에는 검증 hash만 제출한다. commit 전 준비 token은 인증에 쓰이지 않으며 commit 실패·중단은 고아 keychain 값을 정리한다. 설정·wrapper에는 connection 참조만 둔다. 신뢰 MCP/CLI loader만 같은 connection의 보호된 process-local 통로로 인증한다. coding TUI에는 connection 참조만 가고 token은 그 아래 MCP·CLI loader가 받는다. ledger의 hash·즉시 회수는 → coding-agent/connection이다.
- **원문 차단.** token은 argv·URL·cookie·공통 환경 변수·오류·skill·안내·model 문맥에 넣지 않는다. token hash를 인증 값으로 받지 않는다.
- **재검사.** 회수·멈춤·현재 금지는 새 읽기·쓰기·앱 연결·구독·blob 읽기 전에 적용한다. scope는 원래 credential보다 넓어지지 않는다. 해시·주소·handoff는 권한이 아니다.
- **읽기 범위.** 본문뿐 아니라 제목·주소·존재·목차·summary·개수·관계·근거를 scope로 제한한다. 여러 앱 자료 연결이 권한을 합쳐주지 않는다. 범위 밖과 없는 대상의 안전한 거절은 내용을 노출하지 않는다.
- **loopback.** API는 명시한 loopback 주소만 bind한다. `0.0.0.0`·LAN·임의 proxy 공개는 불가다. IPv4·IPv6를 모두 검사한다.
- **Host·Origin.** Host는 실제 bind 주소·port allowlist와 정확히 일치해야 한다. proxy header는 신원을 바꾸지 않는다. Origin이 있는 core 요청은 거절하며 넓은 CORS를 열지 않는다. Origin 없음도 인증을 대신하지 않는다.
- **인증.** 준비 상태·건강 상태와 event 연결을 포함한 API 모두 token 또는 검증된 내부 연결을 요구한다. 공개 API로 user·machine 종류를 선택해 발급받지 못한다.
- **사람 결정.** user token은 직접 클릭의 증거가 아니다. 필요한 일회 증거는 → shell/confirmation-window, approval 사용은 → platform/approvals다.
- **종료.** core 재시작·감독 연결 상실 때 이전 실행 credential은 무효다. 회수는 새 요청을 막을 뿐 이미 읽은 자료·전송한 효과를 취소하지 않는다.
- **오류.** 자격 없음·위조·회수·종료는 `unauthorized`, 유효 자격의 금지 동작은 `forbidden`이다. 앱 범위 credential의 다른 앱 대상 조회는 실제 부재와 동일한 `not_found`로 반환하여 존재를 숨긴다. 잘못된 종류·scope는 `invalid_input`, CAS 변경은 `conflict`, 안전한 발급·보관 경로 불가는 `unavailable`이다(→ platform/identity#R10, platform/ledger).

## 정할 것

- token은 OS CSPRNG 32byte와 검증된 hash·constant-time 비교를 쓴다. OS별 안전 전달 모양은 → platform architecture에서 고정한다.
- 앱 direct-call 연결·confirm 접수 실행 증명의 서명·전송 모양은 → apps/runtime와 맞춘다.
- Host 허용 주소는 실제 port를 포함한 loopback 두 가족(127.0.0.1, ::1, localhost)의 정확한 목록만 쓴다. request·connection·구독의 유한 한도는 → platform/responsiveness와 platform architecture에서 검증해 고정한다.

## coding credential 전달 결합

보호 전달 요청은 `{connection, process_generation, loader_identity, purpose, start_operation?}`의 내부 값이며 token 원문은 포함하지 않는다. purpose는 coding MCP/CLI loader 또는 사람이 시작한 coding TUI의 검증된 자식이다. 임의 shell·coding agent 요청·renderer가 이 보호 요청을 만들 수 없다. 인증 경계는 active connection·현재 scope·catalog adapter·자식 process generation을 확인하고 지정 child에만 non-inheritable 보호 통로를 연다. coding agent 모델이 아니라 lophn MCP/CLI 인증 adapter가 원문을 사용한다. 자동 재발급·user credential fallback은 없다. keychain 누락·잠김·검증 실패는 unavailable이다. 보호 통로의 OS별 구현은 → redesign/propagate#Q2다.
