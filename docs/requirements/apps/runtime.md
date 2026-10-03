---
type: requirements
concerns: [apps/runtime]
---
# apps/runtime

공유 supervisor가 앱별 운영 프로세스 하나를 시작·정지·재시작하고 실제 연결 상태를 보여 주며 앱 화면과 command를 core를 거치지 않고 직접 호출한다; 화면 틀은 shell/app-frame, permission은 apps/permissions, invocation 접수는 apps/invocations가 맡는다.

## 요구

### 프로세스와 시작

**[R1]** core 밖 공유 supervisor는 앱마다 운영 프로세스를 많아야 하나 시작하고 이전 프로세스의 종료를 확인하기 전 같은 DB를 쓰는 다음 프로세스를 시작하지 않는다.
- 이유: 한 앱의 데이터와 프로세스 소유권을 분명히 한다.
- 확인: 재시작과 activation을 겹쳐 요청해도 동일 DB writer가 둘 생기지 않는다.
- 의도: apps#I8

**[R2]** 프로세스는 현재 release와 apps/permissions의 현재 허용 범위로 시작하고 실제 handler 목록이 blueprint와 다르거나 30초 안에 실제 bundle·handler 목록·데이터 schema·직접 연결 준비를 확인하지 못하면 시작 실패로 표시한다.
- 이유: 무응답 앱을 시작됐다고 표시하지 않는다.
- 확인: 잘못된 handler 또는 응답 없는 앱은 30초 안에 unavailable와 시작 실패 이유가 보인다.
- 의도: apps#I3, apps#I4

**[R3]** 시작 준비 모드는 automation·업무 쓰기·외부 동작을 닫으며 준비 성공만으로 업무 정상이나 problem 수리 성공을 주장하지 않는다.
- 이유: 연결 가능과 업무 correctness는 다르다.
- 확인: 준비 중 쓰기가 거절되고 시작 성공 뒤 problem은 problems/closing 근거 없이는 닫히지 않는다.
- 의도: apps#I3

**[R4]** 앱 작성 코드를 core나 supervisor에 import하지 않고 앱 프로세스에 플랫폼 DB·credential 파일·플랫폼 제어 통로의 직접 접근을 주지 않는다.
- 이유: 업무 코드의 실패와 권한을 플랫폼에서 격리한다.
- 확인: 앱 import 오류가 core를 끝내지 않고 플랫폼 내부 파일 접근은 거절된다.
- 의도: apps#I8, apps#I4

### 로컬 호출

**[R5]** 앱별 플랫폼 중개 통로와 앱 화면·command 통로는 사용자 전용 로컬 socket의 HTTP/1.1 JSON을 사용하고 화면의 socket 위치를 앱 view에 노출하지 않는다.
- 이유: 업무 통신을 loopback의 넓은 네트워크 권한 없이 제한한다.
- 확인: 앱별 두 통로를 사용하고 화면은 shell/app-frame의 Electron main 연결로만 열린다.
- 의도: apps#I4

**[R6]** Linux 로컬 socket은 XDG runtime 디렉터리를 우선 사용하고 없으면 사용자별 임시 디렉터리를 0700으로 만들며 socket 경로 길이 한도를 넘기지 않는다.
- 이유: 다른 로컬 사용자 접근과 Unix socket 이름 길이 실패를 막는다.
- 확인: runtime 디렉터리가 없는 환경에서도 0700의 사용자별 디렉터리에 통로가 열리고 긴 앱 이름으로도 시작한다.
- 의도: apps#I4

**[R7]** 앱 시작의 초기 JSON은 표준 입력 한 줄로 전달하고 token과 secret을 환경 변수나 명령줄 인자로 전달하지 않는다.
- 이유: 비밀과 인증 값이 process 목록과 환경에 남지 않게 한다.
- 확인: 프로세스 argv·환경을 검사해 token과 secret이 없고 secret 전달은 apps/permissions를 따른다.
- 의도: apps#I7, platform#I2

**[R8]** Unix socket HTTP의 가상 host lophn.invalid는 필수 플랫폼 통로에만 허용하며 일반 외부 host 권한으로 확대하지 않는다.
- 이유: Deno의 socket HTTP host 검사를 만족시키면서 외부 접근은 0으로 유지한다.
- 확인: socket HTTP는 응답하고 선언·grant 없는 외부 host 연결은 거절된다.
- 의도: apps#I4

**[R9]** 제어 통로는 플랫폼의 인증된 연결만 받고 앱 화면 연결은 shell/app-frame의 화면 신원에 묶인다.
- 이유: 요청 본문이 주장한 사람이나 앱을 신뢰하지 않는다.
- 확인: 임의 caller가 제어 요청을 보내면 거절되고 화면 본문의 다른 앱 주장은 무시한다.
- 의도: apps#I4

**[R10]** 연결을 받은 뒤 앱 화면과 일반 command의 요청·응답은 core·supervisor·ledger queue를 지나지 않고 앱으로 직접 간다.
- 이유: 한 앱의 정상 호출이 플랫폼 기록 지연을 기다리지 않는다.
- 확인: ledger writer를 지연시켜도 앱 호출이 응답하며 사람 확인 command의 유일한 선행 접수 예외는 apps/invocations를 따른다.
- 의도: apps#I8

**[R11]** 모든 직접 호출은 서명·프로세스 신원·release·bundle·운영과 preview 구분·만료·화면 또는 command 범위를 로컬에서 검증하고 당시 blueprint로 입력을 검사한다.
- 이유: 재시작 이전 권한과 다른 release 입력으로 호출하지 못하게 한다.
- 확인: 이전 연결·위조 서명·범위 밖 command·틀린 입력을 각각 거절한다; credential 발급은 platform/identity를 따른다.
- 의도: apps#I4

**[R12]** 전송 단절은 결과 모름으로 표시하고 업무 쓰기를 자동 재호출하지 않는다.
- 이유: 응답을 못 받았다는 이유로 외부 효과와 업무 저장을 중복하지 않는다.
- 확인: 쓰기 직후 연결을 끊어도 호출이 두 번 실행되지 않고 apps/invocations의 모름 근거가 남는다.
- 의도: apps#I5

### 상태와 정지

**[R13]** 사람은 실제 release 유무·실행 허용·현재 연결에 근거한 준비 중·멈춤·사용 가능·사용 불가와 종료 중을 구별하되 화면에는 지금 필요한 상태와 다음 행동만 보이고 안쪽 상태 이름과 시작·실패의 상세 이유는 펼쳐 볼 수 있다.
- 이유: 과거 기록이나 열린 problem으로 현재 생존을 추정하지 않는다.
- 확인: 아직 release 없음·사람이 멈춤·응답함·허용됐지만 응답 없음 네 상황이 구별된다.
- 의도: shell#I8, apps#I5

**[R14]** 앱 실행 상태와 problems/grouping의 열린 problem은 별개 사실로 유지하되 화면에는 지금 판단에 필요한 상태와 문제만 보이고 상세 관측은 펼쳐 볼 수 있으며 존재하지 않는 수집·실패율·health 값을 만들어 보여 주지 않는다.
- 이유: 응답하는 앱의 일부 문제를 앱 전체 정지나 가짜 정상 값으로 읽지 않는다.
- 확인: running 앱의 열린 problem이 함께 보이고 관측이 없는 지표는 없음으로 표시한다.
- 의도: shell#I8, problems#I1

**[R15]** 사람이 실행을 멈추면 새 command와 automation부터 닫고 진행 호출 종료를 요청한 뒤 10초 유예 후 강제 종료하며 실제 종료 전에는 멈춤 완료로 표시하지 않는다.
- 이유: 접수 차단과 종료 완료를 구별한다.
- 확인: 끝나지 않는 command가 있어도 10초 뒤 강제 종료가 요청되고 OS 종료 확인 전에는 종료 중으로 표시된다.
- 의도: apps#I5

**[R16]** 사람이 다시 실행을 허용하기 전에는 재시작 정책도 멈춘 앱을 시작하지 않는다.
- 이유: 사람의 멈춤을 장애 복구가 우회하지 않는다.
- 확인: 멈춤 뒤 lophn 재기동과 backoff 경과로도 앱이 시작하지 않는다.
- 의도: apps#I5

**[R17]** core 제어 연결이 끊기면 새 호출·automation을 닫고 앱을 종료하며 supervisor 교체는 PID만이 아니라 현재 자식 신원과 이전 종료를 확인한다.
- 이유: 별도 lease 없이 오래된 권한 통로를 끝낸다.
- 확인: core를 끊거나 PID를 재사용시켜도 옛 자식과 새 자식을 혼동하지 않고 이전 호출 통로가 닫힌다.
- 의도: apps#I4

**[R18]** daemon 종료·앱 재시작·release 교체는 정지 요청 전에 의도된 종료로 분류해 동시 Ctrl-C나 process tree 종료를 crash로 오인하지 않는다.
- 이유: 실사용에서 보인 종료 경합의 오탐을 없앤다.
- 확인: daemon과 앱에 종료 신호를 동시에 보내도 의도된 앱 정지가 unexpected crash로 기록되지 않는다.
- 의도: apps#I5

### 실패와 재시작

**[R19]** 예상 밖 종료는 1초·2초·4초부터 두 배씩 최대 5분 backoff로 재시작하고 10분 안에 5회를 넘는 종료에는 자동 재시작을 멈춰 이유를 남긴다.
- 이유: 실패 앱의 재시작 폭주를 막고 숫자가 있는 복구 정책을 유지한다.
- 확인: 여섯 번 종료시키면 반복 실패 이유가 보이고 실행 허용값은 몰래 바뀌지 않는다; 보고는 problems/reporting을 따른다.
- 의도: apps#I8

**[R20]** idle만으로 앱 프로세스를 자동 종료하지 않는다.
- 이유: 개인 앱의 automation 지연을 피한다.
- 확인: 화면과 호출 없이 기다려도 허용된 앱이 계속 떠 있다.
- 의도: apps#I5

**[R21]** 한 앱의 멈춤·무응답·시작 실패는 다른 앱 통로와 lophn 문서·기록 조회를 멈추지 않는다.
- 이유: 실패를 앱 하나로 격리한다.
- 확인: 한 앱을 응답하지 않게 한 상태에서 다른 앱 command와 문서 조회가 계속 응답한다; 전체 응답 목표는 platform/responsiveness를 따른다.
- 의도: apps#I8

**[R22]** 처리되지 않은 exception과 Promise rejection은 안전한 보고를 시도하고 stderr에 원래 실패를 남긴 뒤 종료 code 1로 끝내며 보고 실패가 crash를 숨기지 않는다.
- 이유: 보고 과정의 실패로 원래 문제를 잃지 않는다.
- 확인: 보고 통로를 끊고 exception을 내도 stderr와 exit 1을 확인한다.
- 의도: problems#I1

### 실행 환경과 관측

**[R23]** 운영 앱은 Deno의 prompt·임의 설정·원격 import·npm과 jsr 다운로드를 사용하지 않고 미리 준비한 코드와 고정 의존만으로 시작한다.
- 이유: 설치 뒤 네트워크 fetch와 개발 설정의 개입을 피한다.
- 확인: 네트워크 없는 패키징 설치에서 시작하고 runtime 원격 import는 거절된다; 권한 제한은 apps/permissions를 따른다.
- 의도: apps#I2

**[R24]** 앱 자식 환경에는 home·Deno cache·XDG cache·실행 파일 탐색에 필요한 값만 전달하고 설정한 Deno 실행 파일 또는 현재 Deno를 사용한다.
- 이유: 사용자의 provider credential과 임의 환경이 앱에 흘러들지 않는다.
- 확인: parent에 넣은 API token이 자식에 없고 선택한 Deno binary로 시작한다.
- 의도: platform#I2

**[R25]** 메모리는 Linux의 VmRSS를 60초마다 측정하고 macOS·Windows는 확인 가능한 OOM 종료 근거를 남기며 Deno heap 설정을 전체 RSS 제한이라고 표시하지 않는다.
- 이유: 실제로 측정한 소비와 설정의 한계를 구별한다.
- 확인: Linux 표본 간격과 실제 RSS를 비교하고 다른 OS의 미측정 값을 꾸며 넣지 않는다; 지원 OS는 platform/install-and-update를 따른다.
- 의도: platform#I4

**[R26]** supervisor는 invocation마다 log를 최대 200줄씩 최근 500개 invocation까지 모으고 invocation에 묶이지 않은 log는 앱마다 최근 500줄을 유지하며 한 줄은 300자로 제한하고 platform/redaction을 적용한다.
- 이유: 무제한 메모리 축적 없이 실패 직전의 근거를 제공한다.
- 확인: 201줄을 쓴 invocation과 501개의 invocation 및 묶이지 않은 501줄을 만들어 한도가 지켜지고 secret이 log에 없음을 확인한다; snapshot에 싣는 방법은 problems/snapshots를 따른다.
- 의도: apps#I5, platform#I2

**[R27]** 추가 log 조회는 최대 200줄을 반환하고 실패 직후 마지막 log flush는 최대 20ms만 기다린다.
- 이유: 추가 근거 수집이 앱 응답을 무기한 늦추지 않는다.
- 확인: 많은 log를 남긴 실패 호출에서 200줄을 넘게 반환하지 않고 flush 대기는 20ms를 넘기지 않는다; 출력 응답 목표는 platform/responsiveness를 따른다.
- 의도: platform#I3, apps#I5

**[R28]** 앱의 예상 밖 종료·기동 실패·crash loop와 V8 OOM 종료 근거를 구별해 관측하고 problems/reporting에 전달한다.
- 이유: 프로세스 실패 원인을 실제 신호로 남긴다.
- 확인: ready timeout·반복 종료·V8 OOM을 각각 발생시키고 서로 다른 관측 근거가 남으며 의도된 정지는 crash로 세지 않는다.
- 의도: problems#I1

**[R29]** 측정한 앱 RSS가 설정한 메모리 한도의 85%를 넘는 상태가 10분 지속되면 그 수치와 기간을 관측으로 남긴다.
- 이유: 순간 표본과 지속적인 메모리 사용을 구별하되 업무 health 판정으로 바꾸지 않는다.
- 확인: 85% 초과를 10분 유지하면 관측이 남고 한도가 없거나 RSS를 측정하지 못한 경우 임계치를 넘었다고 주장하지 않는다.
- 의도: platform#I4

### 앱 쌍과 크기별 화면

**[R30]** 다른 앱 연결은 apps/connections의 방향 있는 선언·grant와 인증된 부른 앱의 현재 프로세스에서 준비하고 연결 뒤 일반 요청·응답은 대상 앱으로 직접 보낸다.
- 이유: 앱 쌍 허락을 강제하면서 core와 supervisor를 업무 중계자로 만들지 않는다.
- 확인: 위조 caller·미허락 command·옛 프로세스 연결은 거절되고 ledger 지연 중에도 허락된 A→B 호출이 응답한다.
- 의도: apps#I11, apps#I4

**[R31]** 화면 요청은 전체·패널·카드 중 선언된 크기와 화면 신원에 묶이며 같은 앱의 여러 화면은 하나의 운영 프로세스를 쓰되 view session은 분리한다.
- 이유: 카드 하나를 열 때마다 DB writer를 늘리거나 서로 다른 탭 상태를 섞지 않는다.
- 확인: 패널 두 개와 카드 하나를 열어도 앱 프로세스는 하나이고 각 화면의 context와 주석 대상은 따로 식별된다.
- 의도: apps#I10

**[R32]** agent가 앱 command를 쓰는 연결은 apps/permissions의 agent 허락과 역할·assignment 범위를 교차 검사하고 tool 정의·판정은 lophn-agent/harness/tools와 lophn-agent/harness/tool-judgment를 따른다.
- 이유: 화면 연결과 agent 연결이 같은 범위를 자동으로 공유하지 않는다.
- 확인: 열린 앱이라도 agent 허락이 없으면 tool 연결이 거절되고 허락 뒤에도 역할 범위 밖 command는 실행되지 않는다.
- 의도: apps#I11

## 열린 질문

- apps/runtime#Q1 H6: 앱 runtime의 Deno 기술 선택을 유지할까?
- apps/runtime#Q2 지원 OS별 CPU·RSS·disk 한도와 추가 격리 수준을 어떻게 정할까?
- apps/runtime#Q3 앱 GUI는 앱 프로세스가 serve할까 플랫폼이 정적 bundle을 serve할까?
- apps/runtime#Q4 subprocess가 반드시 필요한 사용자 앱을 이번 범위에서 지원할까?
- apps/runtime#Q5 R2·R15·R19의 시작 30초·종료 유예 10초·재시작 기본값을 OS별 실측 뒤 조정할 필요가 있을까? 실제 종료 미확인을 완료로 표시하지 않는 원칙은 유지한다.
- apps/runtime#Q6 정리됨: 앱 사이 command 연결은 apps/connections와 R30으로 지원한다. 과거 read model·provider export 계약은 복원하지 않는다.
- apps/runtime#Q7 Windows에서도 두 로컬 통로를 Unix socket으로 제공할까 OS별 transport를 둘까?

## 버린 것

- 제3자 앱 생태계를 위한 미래 container·VM backend 자리는 실제 현재 요구가 아니므로 만들지 않는다.
- 앱별 신뢰 host·host journal·lease 60초와 20초 갱신·policy generation·별도 token 장치는 단일 ledger와 앱 direct call 및 프로세스 종료로 대체한다.
- warning·critical problem의 존재로 degraded를 붙이거나 health 3회 실패로 자동 suspended하는 상태 축은 실행 상태와 problem 분리 원칙에 따라 두지 않는다.
