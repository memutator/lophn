---
type: requirements
concerns: [apps/permissions]
---
# apps/permissions

앱이 선언한 접근을 사람 grant와 교집합으로 제한하고 파일·네트워크·secret·문서 접근을 실행 경계에서 강제하며 권한 회수의 실제 완료를 확인한다; secret 보관과 변경은 platform/secrets, 확인 화면은 shell/confirmation-window가 맡는다.

## 요구

### 선언과 grant

**[R1]** 앱의 외부 파일·네트워크·secret·문서 저장 접근은 0에서 시작하고 blueprint 선언만으로 허락하지 않으며 정확한 앱·종류·범위에 대한 사람 approval로 grant를 만든다.
- 이유: 코드를 만든 것과 접근을 허락한 것은 다르다.
- 확인: 선언만 한 외부 접근은 거절되고 같은 범위의 approval 적용 뒤만 허용된다.
- 의도: apps#I6

**[R2]** 현재 실행 접근은 현재 release 선언과 현재 active grant의 교집합이며 더는 선언하지 않은 옛 grant를 사용하지 못한다.
- 이유: 옛 허락과 넓은 선언 중 하나로 접근을 확대하지 않는다.
- 확인: grant는 남았지만 새 release 선언에 없는 접근과 선언은 있지만 grant 밖인 접근이 모두 거절된다.
- 의도: apps#I6

**[R3]** 같은 범위의 후속 release는 기존 grant를 사용할 수 있지만 새 host·port·경로·secret 이름은 새 사람 결정을 요구한다.
- 이유: 매 연결마다 반복 확인하지 않되 변경 범위를 숨기지 않는다.
- 확인: 같은 host·port는 grant를 재사용하고 새 host·port는 거절되며 호출별 확인은 apps/blueprint와 apps/invocations를 따른다.
- 의도: apps#I6

### 파일 범위

**[R4]** 앱 기본 접근은 자기 불변 bundle 읽기·자기 DB와 데이터 읽기 및 쓰기·자기 소켓·필수 플랫폼 통로뿐이며 source·다른 앱 저장소·log·플랫폼 credential에는 접근하지 못한다.
- 이유: 운영 앱과 개발·플랫폼 자료를 분리한다.
- 확인: 운영 앱에서 자기 data는 읽고 쓰지만 source와 다른 앱 DB 및 credential 접근은 거절된다; DB 소유는 apps/data를 따른다.
- 의도: apps#I6

**[R5]** 외부 파일 읽기와 쓰기는 별도로 허락한 실제 절대 경로와 하위 범위에만 적용하며 쓰기 grant가 읽기 grant를 암묵적으로 포함하지 않는다.
- 이유: 넓은 문자열 prefix와 암묵적 읽기를 막는다.
- 확인: 쓰기만 허락한 외부 파일을 읽거나 이름 prefix만 같은 다른 폴더에 접근하면 거절된다.
- 의도: apps#I6

**[R6]** 파일 grant의 home 축약·상대 경로·symlink는 부여 때 실제 절대 경로로 풀고 폴더 밖 symlink를 경고하며 release의 코드 복사 경계는 apps/releases를 따른다.
- 이유: 눈에 보인 경로와 실제 접근 경계가 달라지는 것을 발견한다.
- 확인: 외부로 향하는 link가 경고되고 실제 대상 경로가 grant 기준이 된다.
- 의도: apps#I6

**[R7]** home 전체·SSH·AWS·GnuPG credential·keychain·플랫폼 보호 경로와 다른 앱 DB 또는 source를 포함하는 넓은 부모 경로는 grant로 허락할 수 없다.
- 이유: 추가 확인으로도 넘길 수 없는 첫 판 보호 경계를 둔다.
- 확인: 다른 앱 폴더를 감싸는 부모 경로와 민감 credential 경로의 요청이 거절된다.
- 의도: apps#I6

### 네트워크 범위

**[R8]** 외부 fetch는 정확한 DNS host 또는 IP와 1부터 65535까지의 port만 허락하고 wildcard·모든 host·port 0·전체 port는 거절한다.
- 이유: 첫 판의 범위를 좁게 고정하고 Deno의 넓은 net flag로 우회하지 않는다.
- 확인: domain wildcard와 port 0을 요청하면 거절되고 허락한 host·port만 연결된다.
- 의도: apps#I6

**[R9]** 앱의 OAuth callback 듣기는 localhost·127.0.0.1·::1의 정확한 host·port에서만 허용하고 0.0.0.0과 외부 주소는 거절한다.
- 이유: OS 브라우저 callback을 지원하면서 전체 인터페이스 노출을 막는다.
- 확인: localhost port 1455의 Codex·ChatGPT와 127.0.0.1 port 56121의 Grok callback이 승인 범위에서 열리고 외부 주소 bind는 거절된다.
- 의도: apps#I6

**[R10]** localhost와 127.0.0.1 및 ::1은 별개 선언으로 비교하며 callback 듣기 grant는 앱 view 네트워크 권한으로 전파하지 않는다.
- 이유: 주소 문자열과 화면의 보안 경계를 유지한다.
- 확인: localhost만 허락한 앱은 127.0.0.1로 바꿔 열지 못하고 view의 네트워크는 shell/app-frame을 따른다.
- 의도: apps#I6

**[R11]** 앱이 닿는 모든 loopback host에서 플랫폼의 실제 port와 설정 port를 차단하며 같은 host·port의 듣기와 연결 방향을 구별해 강제할 수 없으면 해당 요청을 거절한다.
- 이유: Deno net grant가 듣기와 연결을 같이 여는 한계를 권한 확대의 핑계로 쓰지 않는다.
- 확인: callback port는 열려도 플랫폼 port 연결은 실패하고 표현 불가 정책을 넓은 flag로 허용하지 않는다.
- 의도: apps#I6

**[R12]** 네트워크 선언의 주소와 port를 결정적으로 정렬하고 잘못된 값과 중복 요청은 오류로 거절한다.
- 이유: 조용한 중복 제거보다 하나의 정규 범위를 사용한다.
- 확인: 같은 요청을 다른 순서로 선언해도 비교 결과가 같고 중복 주소는 거절된다.
- 의도: apps#I6

### 문서와 secret

**[R13]** 앱의 문서 저장은 apps/blueprint에 선언한 자기 앱 문서와 정확한 사람 grant가 모두 있어야 허용한다.
- 이유: 문서 저장 통로가 다른 앱 문서를 덮는 우회가 되지 않는다.
- 확인: 미선언 문서와 grant 밖 문서 저장은 거절된다; 실제 version 저장은 documents/versions를 따른다.
- 의도: apps#I6

**[R14]** secret은 이름별 선언과 사람이 허락한 grant가 있으면 사용하고 호출마다 사람 확인을 받지 않으며 누가 command를 불렀는지(사람 화면·agent·automation·다른 앱)로 사용을 막지 않는다.
- 이유: 그 앱이 secret을 쓰도록 허락한 것이 사람의 결정이다. 외부 효과·confirm 판단은 command의 effect와 apps/invocations가 따로 한다.
- 확인: grant가 있는 앱의 command를 agent·automation이 불러도 secret이 붙고, grant를 회수하면 다음 사용부터 거절된다.
- 의도: apps#I6

**[R15]** secret 값은 시작 코드·automation·준비 모드·preview·agent 응답·argv·환경·invocation·event·공통 blob에 넣지 않는다.
- 이유: 운영 secret이 확인 문맥 밖에 남지 않게 한다.
- 확인: 각 모드의 코드·응답·argv·환경·기록에 secret 원값이 없고 grant가 있는 운영 command와 automation은 lophn의 전송 직전 경계에서만 secret을 사용하며 preview는 대역만 사용한다; 전송 직전 경계는 platform/secrets를 따른다.
- 의도: apps#I6

**[R16]** secret 전달은 platform/redaction 등록에 성공한 안전한 플랫폼 경계에서만 하고 외부 인증의 목적지 변경이나 redirect는 확인한 범위를 다시 검사한다.
- 이유: 허락한 인증 대상 밖으로 secret이 새지 않는다.
- 확인: redaction 등록 실패와 다른 host redirect 때 secret 전달이 멈춘다.
- 의도: apps#I6

**[R17]** secret 이름 문법과 값 변경·보관은 platform/secrets를 따르며 값 교체나 삭제 뒤 사용 앱을 새 권한 문맥으로 재시작한다.
- 이유: 이 concern은 이름별 사용만 맡고 관리 사실을 복제하지 않는다.
- 확인: 이름 검사는 platform/secrets로 확인하고 교체 뒤 옛 process 문맥은 끝난다.
- 의도: apps#I6

### sandbox와 회수

**[R18]** Deno 프로세스에서 prompt·전체 접근·subprocess·FFI·시스템 접근·환경 전체 접근을 금지하며 migration 코드에도 같은 경계를 적용한다.
- 이유: 앱 permission 밖 실행으로 우회하지 못하게 한다.
- 확인: 파일 grant를 줘도 subprocess·native code·FFI가 거절되고 migration에서도 같다.
- 의도: apps#I6

**[R19]** 운영 코드의 import는 준비한 상대 코드와 고정 SDK로 제한하고 runtime remote·npm·jsr import와 의존 다운로드를 금지한다.
- 이유: 운영 시작 뒤 다른 코드가 들어오지 않는다.
- 확인: remote import를 시도한 앱은 시작 실패하며 bundle 준비는 apps/releases를 따른다.
- 의도: apps#I3, apps#I6

**[R20]** grant 변경은 새 호출 차단·기존 프로세스 종료 확인·새 범위로 재시작 순서로 적용하고 실행 중 권한을 확대하지 않는다.
- 이유: 이전 권한을 가진 프로세스가 변경 뒤 계속 접근하지 않게 한다.
- 확인: 권한 변경 중 기존 프로세스 종료가 확인되기 전 새 프로세스가 없고 종료 순서는 apps/runtime을 따른다.
- 의도: apps#I6

**[R21]** 권한 회수는 요청 접수와 실제 완료를 구별하고 기존 프로세스의 종료를 확인하지 못하면 완료로 표시하지 않는다.
- 이유: 통로 단절만으로 권한을 거뒀다고 주장하지 않는다.
- 확인: 종료 확인을 막으면 회수 진행 중이고 종료 확인 뒤에만 회수 완료가 된다.
- 의도: apps#I6

**[R22]** 회수는 이미 일어난 업무 쓰기나 외부 요청을 취소했다고 뜻하지 않는다.
- 이유: 실제 효과와 미래 접근 차단을 구별한다.
- 확인: 전송 뒤 권한을 거둬도 그 전송은 완료 사실로 남는다.
- 의도: apps#I6

**[R23]** 진단과 수리 테스트 때문에 앱 permission이나 플랫폼 보안 경계를 넓히지 않는다.
- 이유: 고침 확인이 운영 데이터와 secret의 접근 우회가 되지 않는다.
- 확인: 진단 runner가 다른 앱과 플랫폼 파일을 요청하면 거절되고 테스트 권한은 problems/tests를 따른다.
- 의도: apps#I6

### 한계와 조합

**[R24]** 파일 읽기와 네트워크 fetch를 함께 요청하면 자료 외부 전송 조합 위험을 사람 grant 화면에서 강조하고 자동 부여하지 않는다.
- 이유: 각 권한의 조합이 단일 권한보다 넓은 유출 가능성을 만든다.
- 확인: 동시 요청의 경고를 읽고 승인 전 접근은 모두 거절된다.
- 의도: apps#I6

**[R25]** Deno permission은 VM·container와 같지 않으며 runtime 취약점·허락 경로 안의 secret·실행 중 symlink 교체·CPU와 RSS 및 disk 제한의 한계를 공개한다.
- 이유: 실제 제공하지 않은 보안을 주장하지 않는다.
- 확인: 사람이 한계를 읽고 Deno heap과 전체 메모리 제한을 구별한다; 실측과 OS 제한은 apps/runtime을 따른다.
- 의도: apps#I6

### 앱 쌍과 agent command 허락

**[R26]** 다른 앱 호출 허락은 부르는 앱·대상 앱·정확한 command 목록의 방향 있는 범위로 기록하고 apps/connections의 선언과 교집합으로만 사용한다.
- 이유: 앱 쌍을 한 번 허락하되 모든 command와 반대 방향을 자동으로 열지 않는다.
- 확인: A→B의 두 command 허락에서 새 command·B→A·A→C는 거절된다.
- 의도: apps#I7

**[R27]** agent command 허락은 기본 닫힘으로 앱마다 사람이 정확한 command 목록을 열고 앱 쌍 허락·화면 열기·coding agent connection과 별도로 기록한다.
- 이유: 사람이 앱을 보는 것과 agent가 앱을 사용하는 결정을 구별한다.
- 확인: 앱을 열거나 다른 앱 연결을 허락해도 agent 호출은 닫혀 있고 사람의 별도 허락 뒤 지정 command만 열린다.
- 의도: apps#I7

**[R28]** 실제 agent 호출 범위는 앱별 active 허락·현재 blueprint command·역할과 assignment 읽기 및 변경 범위의 교집합이며 effect·되돌리기·confirm 판정은 lophn-agent/harness/tool-judgment를 따른다.
- 이유: 앱을 연 허락이 역할 책임이나 호출별 사람 결정을 확대하지 않는다.
- 확인: 같은 앱 허락에서도 lophn·App Engineer·Operator에게 각각 역할에서 허용한 command만 노출되고 confirm은 별도 approval을 기다린다.
- 의도: apps#I7

**[R29]** 앱 쌍 또는 agent command 허락의 변경·회수는 관련 직접 연결의 새 호출 차단과 이전 권한 프로세스 종료 확인 뒤 적용하며 이미 일어난 업무 효과를 취소했다고 표시하지 않는다.
- 이유: 서명된 옛 연결이 회수 후 계속 사용되지 않는다.
- 확인: A→B 허락 회수 중 A의 종료를 확인할 수 없으면 진행 중으로 보이고 완료 뒤 옛 연결은 거절된다.
- 의도: apps#I7

## 열린 질문

## 버린 것

- 미래 제3자 앱 container·VM 교체 backend 자리는 현재 사용자 소유 앱 범위 밖이라 미리 만들지 않는다.
- 앱당 secret 100개·값 65536자의 무승인 앱 소유 secret CRUD와 선언 면제는 사람 관리 계약과 충돌하여 두지 않는다.
- 다른 앱 read model permission·앱 간 caller 위임 chain·provider export 계약은 그대로 복원하지 않는다. 앱 사이 command 연결은 apps/connections와 R26·R29의 app.call grant를 따른다.
- home 전체 및 민감 폴더의 두 번째 확인 허용과 TTY에서 grant를 한 번 더 입력하는 넓은 grant 흐름·아무 host와 domain wildcard·trusted host 자동 grant는 좁은 현재 grant 범위와 충돌하여 두지 않는다.
