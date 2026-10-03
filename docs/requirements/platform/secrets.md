---
type: requirements
concerns: [platform/secrets]
---
# platform/secrets

secret 원값을 OS keychain에 보관하고 ledger에는 참조만 남기며 사람의 보호 입력·허용된 플랫폼 사용 경계·사용 차단과 정리 완료를 맡는다; 앱 사용 허락은 apps/permissions, provider 로그인·OAuth 갱신은 lophn-agent/harness/provider를 따른다.

## 요구

### 원값 보관과 입력

**[R1]** API key·OAuth access·refresh token·password·개인 키 값은 OS keychain에 직접 보관하고 ledger·설정·blob·derived store·일반 backup·환경 변수에는 원값·공개 hash·길이·원문 일부를 넣지 않는다.
- 이유: secret을 참조만으로 관리해야 다른 기록과 agent에 퍼지지 않는다.
- 확인: 네 종류 값을 넣고 저장소·설정·backup·프로세스 환경을 검사해 참조만 있고 값·일부·길이가 없으며 재시작 뒤 보호 저장소에서만 사용할 수 있는지 확인한다.
- 의도: platform#I2, platform#I8

**[R2]** secret의 사람이 직접 넣는 값은 전용 보호 입력에서만 받고 세션 메시지·질문 답·agent·외부 MCP가 보호 입력을 대신 제출하는 경로로 받지 않는다.
- 이유: 대화와 일반 입력은 영속 기록·model 문맥이 되기 쉽다.
- 확인: 각 secret 종류를 보호 입력에 넣을 수 있으나 대화·질문 답에 붙이면 platform/redaction으로 전체 입력이 차단되는지 확인한다.
- 의도: platform#I8, platform#I2

**[R3]** agent가 secret을 필요로 하면 허용된 이름·사용처·이유만 요청하고 원문이나 앞뒤 일부를 붙여 넣으라고 요구하지 않는다.
- 이유: agent 판단에 인증 원값이 필요하지 않다.
- 확인: secret 없는 작업을 시켜 세 정보만 안내되고 일부 문자를 요청하는 우회가 없는지 확인한다.
- 의도: platform#I8

### 사용과 조회

**[R4]** 어떤 agent도 secret 값을 받지 않으며 허용된 secret 이름·설정 여부만 조회할 수 있고 권한 없는 이름과 없는 이름에는 같은 안전한 거절을 반환한다.
- 이유: 이름의 존재도 금지된 사용처를 누출할 수 있다.
- 확인: 두 종류 agent가 원값·일부·보호 참조·금지 이름을 조회하면 나오지 않고 금지와 부재 응답을 구별할 수 없는지 확인한다.
- 의도: platform#I8, platform#I2

**[R5]** 일반 사용에서 secret 원값은 현재 허용된 목적지·용도의 전송 직전에 플랫폼 경계가 붙이고 agent 문맥·tool 인자에는 이름만 두며 앱 사용자 코드에 원값을 돌려주는 일반 API나 환경 변수 주입은 제공하지 않는다.
- 이유: 승인된 사용과 원값 전달은 다른 권한이다.
- 확인: 허용된 인증 요청은 성공하지만 agent·앱 코드·환경·일반 응답에 원값이 없고 redirect의 다른 목적지로 인증이 자동 전달되지 않는지 확인한다.
- 의도: platform#I8, platform#I2

### 변경과 불가 환경

**[R6]** OS keychain 준비는 ledger command 밖에서 끝내고 이전 참조·판의 CAS를 통과한 경우만 참조를 교체하며 실패하면 이전 참조를 유지한다.
- 이유: 보호 저장소와 SQLite를 공동 원자 작업으로 오해하면 값과 참조가 어긋난다.
- 확인: OS 준비·CAS·commit 실패를 넣어 이전 사용이 유지되고 고아 준비는 정리 대상으로 구별되는지 확인한다.
- 의도: platform#I1, platform#I2

**[R7]** secret 교체·제거 뒤 새 사용은 차단하되 참조 차단·OS 값 삭제·이전 값을 사용한 프로세스 종료 완료를 각각 확인된 사실로 표시한다.
- 이유: 제거 요청이 외부 요청 취소나 메모리에서의 삭제 완료는 아니다.
- 확인: OS 삭제·프로세스 종료를 늦춰 이후 사용은 막혀도 완료 표시는 기다리는지 확인하고 이미 전송한 효과를 취소됐다고 표시하지 않는지 확인한다.
- 의도: platform#I2, platform#I5

**[R8]** OS keychain이 없거나 잠긴 환경은 secret이 필요한 기능만 사용 불가로 처리하고 평문 파일·암호화 파일 볼트·환경 변수 fallback 없이 secret 없는 로컬 기능을 계속 제공한다.
- 이유: 보호가 불가능하다고 전체 작업을 막거나 더 약한 저장소로 조용히 내려가면 안 된다.
- 확인: Linux Secret Service 없는 desktop·headless와 keychain 잠김에서 secret 기능은 실패하지만 문서·로컬 앱은 작동하고 임시 원값 파일이 없는지 확인한다.
- 의도: platform#I6, platform#I2

### 머신 이전용 보호 export

**[R9]** 사람이 명시적으로 선택한 secret의 머신 이전은 일반 backup과 분리한 암호 보호 export·import로 제공하고 OS keychain 값을 전용 플랫폼 경계에서만 암호화·복호화하여 새 머신의 OS keychain에 넣으며 평문 중간 파일·agent·앱 코드·일반 API·log로 전달하지 않는다.
- 이유: 머신 이전을 지원해도 상시 파일 볼트나 일반 backup에 인증 원값을 되살리지 않는다.
- 확인: 내보낸 파일에서 원값을 읽을 수 없고 올바른 암호와 준비된 새 keychain에서만 선택한 값이 복원되며 잘못된 암호·변조·잠긴 keychain에는 기존 값을 바꾸지 않는지 확인하고, 중단 뒤에도 평문 파일·log가 없으며 일반 이전 절차는 platform/backup-and-migration을 따른다.
- 의도: platform#I4, platform#I8

### 앱 grant와 인증 갱신 경계

**[R10]** 앱의 secret 사용 허락은 apps/permissions의 현재 grant로 판단하고 호출마다 approval을 요구하거나 command를 부른 쪽이 사람 화면·agent·automation·다른 앱이라는 이유만으로 막지 않는다.
- 이유: 사람이 앱에 준 사용 범위와 command 자체의 확인·외부 효과 판정을 구별한다.
- 확인: 같은 grant의 read·write command를 네 호출 경로에서 실행해 인증은 플랫폼이 붙이고 원값은 어느 호출자에게도 가지 않는지 확인하며 confirm·external과 automation 제한은 apps/invocations·apps/automations를 따른다.
- 의도: platform#I2, platform#I8

**[R11]** provider와 외부 MCP 인증의 로그인·갱신 결과는 해당 소유 concern이 허용한 신뢰 전송 adapter의 보호 경계에서만 준비하고 현재 소유 참조·판 비교를 통과한 안전한 새 참조만 확정하며 agent·tool·앱 코드에 원값을 반환하지 않는다.
- 이유: machine의 정상 인증 갱신을 사람의 secret 입력이나 agent의 값 관리와 혼동하지 않는다.
- 확인: 허용 adapter의 갱신은 참조만 바뀌고 오래된 판·다른 목적지·agent의 갱신 결과 제출은 거절되는지 확인하며 로그인·갱신 정책은 lophn-agent/harness/provider·lophn-agent/extensions를 따른다.
- 의도: platform#I2, platform#I8, platform#I1

**[R12]** coding connection credential은 앱 secret·provider 인증과 다른 용도로 OS keychain에 준비하고 active connection commit과 연결한 신뢰 loader만 사용할 수 있으며 실패한 준비 값을 정리하고 원문을 agent나 일반 설정에 반환하지 않는다.
- 이유: 자동 연결의 인증 token이 앱 secret 사용 경계를 넓히지 않게 한다.
- 확인: commit 전 token·실패 token이 거절되고 연결 회수는 keychain 정리 지연과 무관하게 즉시 새 사용을 막으며 coding-agent/connection과 platform/identity의 보호 전달만 허용되는지 본다.
- 의도: platform#I2, platform#I8

## 열린 질문

- platform/secrets#Q1 Linux Secret Service 없는 desktop·headless에서 어떤 대체 보호 저장소를 지원할까?
- platform/secrets#Q2 암호 보호 secret export의 형식·암호 파생 강도·지원 OS 사이 호환을 어떻게 고정할까?
- platform/secrets#Q3 agent에 secret의 수정·마지막 사용 시각도 내보낼까?

## 버린 것

- 상시 암호화 파일 볼트·AES-GCM 항목·safeStorage master key 전달·일반 사용의 password unlock은 원값 자체를 OS keychain에 보관하는 방식으로 대체하며 머신 이전용 보호 export를 상시 저장소로 사용하지 않는다.
- 잠긴 secret automation을 skipped로 만드는 headless unlock 요구는 파일 볼트 폐기에 따라 적용하지 않는다. keychain이 잠기면 secret을 쓰는 automation 회차는 R8에 따라 unavailable로 끝난다.
- 앱의 무승인 secret CRUD·앱 이름 공간·100개·128자 이름·65,536자 값 한도와 rename 때 이름 공간 이동은 새 전역 참조·사람 관리 경계로 대체한다.
