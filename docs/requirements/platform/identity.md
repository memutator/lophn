---
type: requirements
concerns: [platform/identity]
---
# platform/identity

다섯 actor의 인증된 자격·credential 발급·보관·회수와 scope 상한, loopback Host·Origin 검사, machine 작업 제한과 user 결정 적용 근거를 맡는다; connection 선택은 coding-agent/connection, 앱 grant는 apps/permissions, 사람의 실제 확인은 shell/confirmation-window를 따른다.

## 요구

### actor와 자격

**[R1]** actor는 user·coding agent connection·agent assignment·machine·app의 다섯 종류로만 구별하고 token이 확정하며 요청 이름·label·제품 이름·환경 변수·renderer의 actor 주장으로 바꾸지 않는다.
- 이유: 같은 제품의 여러 connection과 사람 자격을 섞지 않는다.
- 확인: 같은 제품의 두 connection·두 assignment·두 앱이 서로를 주장해도 actor와 scope가 그대로이고 일반 machine이 user를 주장해도 실패하는지 확인한다.
- 의도: platform#I4

**[R2]** credential은 신뢰 시작 경로나 실제 사람의 connection 결정으로만 발급하고 actor별 동작·대상 상한과 현재 허용 조건의 교집합으로 제한하여 앱·agent가 자기 자격을 발급·확대하지 못한다.
- 이유: 선언과 주소 지식은 권한을 만드는 근거가 아니다.
- 확인: 발급 전 요청·잘못된 종류·scope 확대 요청·실행 중 새로운 선언을 거절하고 시작 상한보다 넓은 credential이 만들어지지 않는지 확인한다.
- 의도: platform#I4

**[R3]** coding agent는 자기 connection의 협업 범위, agent는 시작에 고정한 역할·assignment·run 범위, app은 자기 선언된 보고·산출물, machine은 배정 작업·대상·결과 command만 사용하며 test result 제출은 실제 test runner만 허용한다.
- 이유: 범용 수리·machine 자격이 모든 데이터 수정 권한이 되어서는 안 된다.
- 확인: 다른 connection·앱·assignment·worker 작업으로 읽기·쓰기·test result 제출을 시도해 거절되는지 확인하며 상세 값은 coding-agent/connection·lophn-agent/roles·apps/permissions·problems/tests로 확인한다.
- 의도: platform#I4

### 보관과 회수

**[R4]** user token은 shell main만 보관하고 assignment·app·worker 자격은 신뢰 프로세스 메모리만 가지며 renderer·앱 사용자 코드·format module·test 코드에 플랫폼 credential을 전달하지 않는다.
- 이유: 화면과 비신뢰 코드가 플랫폼 권한을 빌리면 경계가 사라진다.
- 확인: 각 renderer·앱·format·test의 메모리·IPC·환경에서 자격을 조회해 나오지 않는지 확인한다.
- 의도: platform#I4

**[R5]** 사람의 harness 연결 선택에 따라 lophn이 coding credential을 자동 발급하여 OS keychain에 보관하고 ledger에는 검증 hash만 확정하며 준비·commit 실패의 credential은 사용할 수 없게 정리한다.
- 이유: 사람에게 token 생성·파일 보관·붙여넣기를 맡기지 않는다.
- 확인: keychain 잠김·보관 실패·connection commit 실패에서 연결 성공을 표시하지 않고 준비 token이 인증에 쓰이지 않으며 재시작 뒤 같은 active connection을 사용하는지 본다.
- 의도: platform#I4

**[R6]** token 원문은 argv·URL·cookie·공통 환경 변수·skill·안내·오류·ledger·event·model 문맥에 넣지 않고 일반 조회로 다시 반환하거나 token hash를 인증 값으로 받지 않는다.
- 이유: 보호 저장소 밖 흔적과 hash 재사용은 원값을 보호한 효과를 없앤다.
- 확인: 발급·호출·실패 뒤 각 경로를 검색하고 hash 인증·query token·cookie token을 거절하는지 확인한다.
- 의도: platform#I4

**[R7]** 자격 회수·assignment 멈춤·app 권한 회수·작업 종료·감독 연결 상실·core 재시작은 해당 자격의 새 사용을 즉시 막으며 끝난 실행 자격을 복구하지 않고 이미 읽은 자료·전송한 효과는 취소됐다고 표시하지 않는다.
- 이유: 회수는 이후 사용의 제한이고 과거 외부 효과의 삭제는 아니다.
- 확인: 읽기·쓰기·app direct 연결·구독·blob 읽기 각각 직전에 회수해 차단되고 재시작 뒤 이전 메모리 자격이 실패하며 과거 효과는 그대로 표시되는지 확인한다.
- 의도: platform#I4

### 현재 scope와 존재 보호

**[R8]** 본문뿐 아니라 제목·주소·존재·목차·summary·개수·관계·근거를 펼치거나 요약하기 전에 현재 scope로 제한하고 허용 자료만으로 summary를 만들 수 없으면 전체를 제외한다.
- 이유: 금지 본문을 숨겨도 제목과 요약으로 누출하면 안 된다.
- 확인: 금지 제목을 포함한 관계·검색·목차·summary를 요청해 존재·개수·내용이 누출되지 않고 금지 자료를 요약하지 않는지 확인한다.
- 의도: platform#I4

**[R9]** 주소·slug·이름·blob hash·handoff 근거는 권한이 아니며 수집·보존·agent 조회·앱 조회·외부 전송을 별개로 검사하고 여러 앱 자료 연결이 다른 앱의 권한을 합쳐 주지 않는다.
- 이유: 참조를 얻었다는 사실로 scope를 넓힐 수 없어야 한다.
- 확인: 범위 밖 주소·hash·연결 자료를 제공해도 읽기·쓰기·추가 근거가 거절되고 허용 앱의 자료만 나오는지 확인한다.
- 의도: platform#I4

**[R10]** 앱 범위 credential의 다른 앱 대상 조회는 없는 대상과 같은 안전한 부재 응답을 반환하고 자격 없음은 401·유효 자격의 금지 동작은 403으로 구별한다.
- 이유: 권한 밖 대상의 존재를 error로 알려 주지 않으면서 자격 문제는 고칠 수 있어야 한다.
- 확인: 존재하는 범위 밖 ID와 실제 없는 ID의 반환을 비교해 내용 차이가 없고 일반 금지 동작·자격 없음은 별도로 구별되는지 확인한다.
- 의도: platform#I4

### loopback 인증

**[R11]** HTTP·WebSocket·준비 상태·health를 포함한 모든 API는 Bearer token 또는 검증된 내부 연결을 요구하고 Origin 없음과 localhost라는 사실만으로 인증하지 않는다.
- 이유: 자격 없는 웹 페이지·로컬 프로세스가 예외 경로로 접근해서는 안 된다.
- 확인: 모든 transport·상태 경로에 무자격 요청을 보내 401이 나오며 Origin 없는 요청도 자격을 요구하는지 확인한다.
- 의도: platform#I4

**[R12]** Host는 실제 bind 주소와 port의 정확한 allowlist로 검사하고 IPv4·IPv6·localhost를 모두 처리하며 proxy header를 신원 근거로 사용하지 않는다.
- 이유: DNS rebinding과 proxy 변조가 loopback 방어를 우회하면 안 된다.
- 확인: 정상 127.0.0.1·localhost·대괄호 IPv6 host와 다른 port·외부 Host·proxy header 변조를 보내 정상 allowlist만 통과하는지 확인한다.
- 의도: platform#I4

**[R13]** 검사 순서는 Host·Origin·Bearer·현재 동작 자격으로 고정하고 Origin header가 있으면 403으로 거절하며 CORS·cookie 인증·브라우저용 예외를 열지 않고 token 검증은 hash 후 constant-time 비교로 한다.
- 이유: 인증 전 body 처리와 Origin 예외가 로컬 웹 공격을 가능하게 한다.
- 확인: 올바른 token과 악성 Origin을 함께 보내도 거절되고 CORS preflight·cookie·외부 Host가 실패하며 비교 구현의 constant-time 계약을 확인한다.
- 의도: platform#I4

### 사람 결정 근거

**[R14]** user token은 직접 사람 클릭의 증거가 아니며 machine이 user로 기록할 수 있는 예외는 실제 사람이 선택한 질문의 고정 action과 정확한 대상·입력·CAS·일회 적용을 검증한 경우뿐이다.
- 이유: machine이나 agent가 user라고 적어 사람 결정을 만들어서는 안 된다.
- 확인: machine의 임의 user 주장·다른 option·변경된 입력·이미 적용한 답을 거절하고 실제 고정 option만 한 번 user로 기록되는지 확인하며 approval request의 결정 주체는 platform/approvals, grant의 주체는 apps/permissions, 직접 확인은 shell/confirmation-window를 따른다.
- 의도: platform#I3, platform#I4

**[R15]** coding MCP·CLI 시작은 신뢰 loader가 현재 connection·scope·process 결합을 확인한 뒤 keychain credential을 보호된 process-local 통로로 전달하며 일반 shell·renderer·모델·설정·argv·PTY·공통 환경에 원문을 넘기지 않는다. lophn의 coding TUI 시작에는 connection 참조만 가고 token은 그 아래 MCP·CLI loader가 받는다.
- 이유: 설치 파일과 session을 자동 준비하더라도 사람 권한이나 app secret은 상속하지 않는다.
- 확인: 허용 loader·등록된 자식만 동일 connection을 쓰고 임의 connection 참조·회수·다른 scope·잘못된 자식에서는 실패하며 보호 loader 불가에는 평문 fallback이 없는지 본다.
- 의도: platform#I4

## 열린 질문

없음.

## 버린 것

없음.
