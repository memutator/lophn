---
type: requirements
concerns: [coding-agent/mcp-server]
---
# coding-agent/mcp-server

로컬 MCP stdio가 내보이는 앱 개발·SDK·문제·ticket·runtime tool(앱 toolset)의 기능, 입력과 출력, 오류와 연결 범위 검사를 맡는다; 대상의 변경·검사·승인 판정은 해당 concern의 공통 계약을 그대로 전달한다.

## 요구

### transport와 노출

**[R1]** MCP는 coding agent 세션마다 로컬 stdio server 하나를 설치된 executable의 절대 위치와 분리 argv로 시작하고 stdout에는 MCP 메시지, stderr에는 진단만 보내며 공백 위치와 오프라인 시작을 지원한다.
- 이유: 제품 설정과 shell 인용 방식 차이 없이 연결하고 진단이 protocol을 깨뜨리지 않게 한다.
- 확인: 공백 설치·작업 위치와 네트워크 차단에서 초기화·tool 발견이 성공하고 stdout에 안내 문장이 없으며 credential은 coding-agent/connection, 설치 target·loading은 coding-agent/harnesses를 따르며 OpenClaw의 session 소유 stdio 미확인은 unknown과 CLI fallback으로 구별한다.
- 의도: coding-agent#I1

**[R2]** MCP는 daemon API의 얇은 adapter로서 lophn-agent/harness/tools의 공통 tool 계약에 등록된 coding agent 허용 동작만 내보내고 내부 호출과 같은 권한·actor·변경 경로를 사용한다.
- 이유: transport가 별도 domain 규칙이나 권한을 만들지 않아야 한다.
- 확인: 같은 credential과 입력으로 내부 API·MCP·CLI 결과와 거절을 비교하고 MCP가 직접 domain 정본을 쓰지 않는다.
- 의도: coding-agent#I1

**[R3]** coding agent tool은 앱 toolset 하나뿐이고 앱 개발·SDK·문제·ticket·runtime을 두며 유사 동작은 한 tool의 동작 선택으로 묶고 기본으로 켠다; 탐색·문서·project·format·series·context·질문 읽기를 담던 core toolset과 옛 toolset 이름·별칭은 두지 않는다.
- 이유: coding agent가 lophn에서 하는 일은 앱 개발과 앱 고치기뿐이다. 불필요한 schema 비용을 줄이고 필요한 기능은 명확히 발견하게 한다.
- 확인: 기본 discovery에 앱 toolset만 나오고 옵션·환경 설정 없이 기능이 보이며 core와 옛 별칭 이름은 거절되고 기능이 보인다는 것만으로 권한이 생기지 않는다.
- 의도: coding-agent#I3

**[R4]** 전체 tool schema는 2,000 token 이내를 목표로 재측정하고 읽기 전용 주석은 내보낸 모든 동작이 읽기인 tool에만 붙인다.
- 이유: 옛 core 약 670·전체 약 1,030 token은 과거 측정이지 앱 toolset만 남은 새 목록의 보장값이 아니다.
- 확인: 새 앱 toolset schema 측정 결과와 방법을 확인하고 claim·테스트를 포함한 혼합 tool에 읽기 전용 주석이 없다.
- 의도: coding-agent#I3

### 공통 입력·출력

**[R5]** 성공 결과는 짧은 summary·구조화 data·다음 상세 읽기나 대기 확인 방법을 제공하고 구조화 내용과 의미가 같은 JSON 텍스트를 함께 반환한다.
- 이유: MCP client가 구조화 결과 또는 텍스트만 읽어도 같은 사실을 얻어야 한다.
- 확인: 목록·테스트·release 준비·approval 대기를 두 표현으로 대조하고 본문 전체가 summary에 중복되지 않는다.
- 의도: coding-agent#I3

**[R6]** 잘못된 동작·필수 입력·범위·cursor·지원하지 않는 옛 주소와 인자는 실행 전에 거절하고 요청 실패는 공통 contract의 이유·현재 판정·다음 조회를 전달한다.
- 이유: 틀린 입력을 다른 동작으로 추측해 실행하지 않는다.
- 확인: 빈 필수 값·틀린 종류·다른 판 cursor·폐지 별칭에서 실제 이유와 다음 확인 방법이 나오고 domain 오류는 platform/ledger를 따른다.
- 의도: coding-agent#I1

**[R7]** tool 실행 실패와 효과 확인 불가에는 MCP tool 오류 표시를 붙이고 알 수 없는 tool·잘못된 MCP 요청의 protocol 오류는 별도로 구별한다.
- 이유: 실행 결과를 모른다는 것과 요청 자체가 성립하지 않았다는 것은 다르다.
- 확인: 기록 직후 응답 단절에서 성공·실패를 추측하거나 자동 새 실행을 하지 않고 현재 ticket·release·invocation 읽기로 안내한다.
- 의도: coding-agent#I4

### 승인 대기

**[R18]** 사람 승인이 필요한 앱 작업의 대기는 해당 tool 결과(release 준비·invocation·ticket 완료)에 대기 사실·정확한 대상과 영향·사람이 열 확인 링크로만 전달하고 질문과 approval request의 목록·상세 읽기 tool은 두지 않으며 사람 답·허락·거절은 노출하지 않는다.
- 이유: 앱을 만들고 고치는 일에는 자기 작업이 승인 대기인지와 사람이 어디서 결정하는지만 필요하다. 가역 질문과 되돌릴 수 없는 승인의 분리는 platform/approvals를 따른다.
- 확인: 대기와 적용 사실이 결과에서 구별되고 확인 링크만으로 적용되지 않으며 질문·approval request를 목록으로 읽거나 사람 결정을 대신하는 동작이 discovery와 직접 요청 모두에서 거절된다.
- 의도: coding-agent#I4

### 앱 개발과 SDK

**[R19]** 앱 개발 tool은 가벼운 등록·구현 시작 source 연결과 template 준비·blueprint 검사·실제 app test·preview 시작과 중지·release 준비·현재 상태·blueprint·invocation 및 automation 이력·log·도구 재배포를 제공한다.
- 이유: 옛 개발 능력을 새 앱·테스트 모델에 맞춰 유지한다.
- 확인: 각 동작의 대상 앱 또는 연결 source와 선택 입력을 받아 산출물·진단·진행 상태를 읽고 apps/registration·apps/blueprint·problems/tests·apps/preview·apps/releases·coding-agent/guides의 계약대로 처리한다.
- 의도: coding-agent#I3

**[R20]** blueprint 검사와 테스트는 오류·경고·permission 검토 및 실제 test result를 구별해 반환하고 실패 뒤 release 준비를 거절하며 preview는 fixture 격리와 실행 상태·중지 결과를 알려 준다.
- 이유: shell log만으로 테스트 성공을 만들거나 preview를 운영 activation으로 오인하지 않게 한다.
- 확인: 부적합 blueprint와 같은 묶음 hash의 실패 테스트에서 release 준비가 거절되고 preview 읽기·command가 운영 자료를 바꾸지 않는다.
- 의도: coding-agent#I3

**[R21]** release 준비는 source와 선택 수리 문제·ticket 및 현재 claim 근거를 받아 준비 release·실제 테스트 근거·다음 조회를 반환하고 새 release의 activation은 사람이 한 번 눌러 고르며 준비와 activation을 구별한다.
- 이유: problems/tests와 apps/releases을 transport에서 빠뜨리지 않는다.
- 확인: 같은 묶음 hash의 app test 없이 준비할 수 없고 모든 coding release 준비에 지정 ticket의 현재 claim을 검사하며 ticket 없는 작업과 문제 직접 claim은 거절한다.
- 의도: coding-agent#I4

**[R22]** SDK tool은 설명과 API 이름 검색으로 이름·최신 version·종류·한 줄 설명의 catalog를, package 선택으로 API·type·permission·peer 의존·예제의 상세를 제공한다.
- 이유: 이미 검증된 재료를 쓰기 전에 계약을 읽게 한다.
- 확인: apps/sdk의 설치 catalog를 검색하고 비설치·없는 package를 명확히 구별하며 개인 SDK 추가 지원은 현재 범위와 구별한다.
- 의도: coding-agent#I3

**[R23]** SDK 추가는 package와 exact version을 받아 앱 import map에 사용할 고정 import 안내를 반환하고 허용된 source 반영을 선택하면 변경·무변경·충돌을 표시하며 범위 지정 version과 조용한 upgrade는 거절한다.
- 이유: 재현 가능한 SDK 추가와 사람 source 보존을 함께 지킨다.
- 확인: 같은 exact version 두 번 추가해 중복이 없고 기존 다른 version은 충돌로 보이며 최신 범위·미설치 version은 apps/sdk의 판정대로 거절된다.
- 의도: coding-agent#I3

### 문제와 수리 자료

**[R24]** 문제 tool은 앱·현재 진행 상태·사람 또는 coding agent 처리 대상을 선택한 목록·상세·snapshot·지난 고친 기록·summary·전체 수리 묶음·종류별 추가 근거를 제공한다.
- 이유: 열린 문제와 수리 중 문제를 같은 정본에서 적게 시작해 읽는다.
- 확인: 목록에는 요약과 상세 읽기가 있고 묶음 내용·선정·상한·cursor는 coding-agent/repair-context를 그대로 지키며 추가 조회가 claim을 만들거나 갱신하지 않는다.
- 의도: coding-agent#I3

**[R25]** 수리 조사의 근거 조회는 code 작업과 구별하고 수리 code 쓰기는 지정 ticket의 현재 MCP claim 아래 고친 release 기록·실제 reproduction test와 app test 요청을 제공하며 직접 문제 claim·별도 시도 단계·workflow 조작·agent의 증상 결론을 제공하지 않는다.
- 이유: problems/tests·problems/grouping·problems/repairs의 단순한 사실과 검사 모델로 옛 기능 목적을 유지한다.
- 확인: problems/repairs·problems/tests에서 실제 결과를 다시 읽고 옛 진단·시작·완료·취소 기능의 목적을 ticket 보고로 수행하되 test result 자체 입력과 문제 닫힘을 거절한다.
- 의도: coding-agent#I4

### ticket 읽기와 claim

**[R26]** ticket tool은 앱·여섯 진행 상태를 filter한 호출당 최대 20개 요약 목록과 cursor, 전체 본문, 현재 claim 및 작업 가능 여부, 조건별 machine 검사 결과를 제공한다.
- 이유: 작업을 누락 없이 찾고 불변 목표와 최신 착수 권리를 구별한다.
- 확인: 21개 이상에서 제목·종류·앱·문제 수만 20개 이하로 나오고 본문·수리 자료는 없으며 상세에는 모든 조건·고정 근거·볼 곳·지킬 것과 문제별 묶음 읽기가 있다.
- 의도: coding-agent#I4

**[R27]** ticket 쓰기는 사람 지시 claim·명시 갱신·반납·ticket 근거 release 준비와 연결·완료 보고를 제공하고 claim 응답에 현재 연결·기한·이번 claim 구별 근거를 반환한다.
- 이유: 외부 세션이 현재 권리와 결과 반환을 확인할 수 있어야 한다.
- 확인: coding-agent/tickets의 기한·재claim을 검사하고 만료·취소 뒤 후속 쓰기를 거절하며 통로가 자체 기한이나 자동 갱신을 덧붙이지 않는다.
- 의도: coding-agent#I4

**[R28]** 완료 결과는 원래 ticket·앱·release·실제 test result를 연결해 완료 주장·보고 접수·확인 실패·approval 대기·activation·문제 정상 확인을 따로 전달한다.
- 이유: 작업 산출물과 정상 여부가 대화 속에 묻히지 않게 한다.
- 확인: 각 단계가 원래 ticket에서 읽히고 보고만으로 확인됨이나 문제 닫힘을 만들지 않으며 상태 판정은 coding-agent/tickets를 따른다.
- 의도: coding-agent#I4

### runtime과 invocation

**[R29]** runtime tool은 범위 안 앱 process와 preview 상태·active release·command 중심 blueprint·허용 command를 읽고 앱·command·JSON 입력·preview 또는 운영 선택과 선택 기한으로 읽기 효과 command 및 invocation 결과를 조회하며 대상 실행 환경을 바꾸어 재조회하지 않는다.
- 이유: apps/blueprint의 read command와 lophn-agent/harness/tools의 지연 없는 읽기를 보존한다.
- 확인: apps/runtime·apps/invocations의 현재 scope를 검사하고 읽기가 ledger 쓰기를 기다리지 않으며 환경 생략은 preview이고 양의 기한만 허용하며 invocation으로 결과 불명과 실제 실패를 구별하고 별도 query·receipt 체계를 만들지 않는다.
- 의도: coding-agent#I3

### scope와 금지 작업

**[R30]** 모든 tool의 목록·검색·요약·본문·첨부·추가 읽기·다음 안내에는 coding-agent/connection의 현재 범위와 platform/redaction을 적용하고 approval 결정·grant 변경·secret 값·backup·문제 닫힘·무시·사람 확인을 제공하지 않는다.
- 이유: 하위 읽기와 통로 변경이 권한 경계를 우회하면 안 된다.
- 확인: 다른 앱 제목·본문·건수·첨부와 token이 나오지 않고 금지 요청을 daemon에서도 거절한다.
- 의도: coding-agent#I1

**[R31]** 프로젝트 등록·lophn agent assignment 변경·사람 원본 임의 읽기·앱 DB 직접 접근·ticket 목표 변경과 확인 판정·test result 작성을 coding agent tool로 내보내지 않는다.
- 이유: 도구 편의가 사람과 machine 전용 권한을 되살리지 않게 한다.
- 확인: MCP discovery와 임의 직접 요청 양쪽에서 각 동작을 거절하고 실제 테스트 요청만 해당 계약대로 처리한다.
- 의도: coding-agent#I1

### 앱 개발과 SDK

**[R32]** 앱 invocation 이력은 앱·command 또는 automation 선택으로 페이지당 최대 20개를, 앱 log는 한 번에 요청 줄 수 1~200 범위로 제공하고 남은 자료는 실제 이어 읽기와 redaction된 반환 수를 표시한다.
- 이유: 옛 앱 adapter의 개수와 log 입력 상한을 보존하되 큰 결과를 조용히 자르지 않는다.
- 확인: 21개 이력과 2,001줄 요청을 비교하고 문제의 추가 log 페이지에는 coding-agent/repair-context의 더 작은 별도 상한을 적용한다.
- 의도: coding-agent#I3

**[R33]** 실제 app test 요청 adapter는 기본 timeout 300초를 runner에 명시해 전달하고 실패·timeout·준비 실패를 구별하며 변경된 source는 이전 테스트 성공으로 release 준비하지 않는다.
- 이유: 옛 300,000ms 실행 약속을 problems/tests runner 정본으로 옮긴다.
- 확인: problems/tests의 실제 timeout 근거가 300초이고 제한 조정은 소유 계약을 따르며 stderr excerpt를 test result 정본 대신 사용하지 않는다.
- 의도: coding-agent#I3

### blueprint에서 가져오는 앱 command

**[R34]** 첫 판에는 coding agent에게 현재 connection 범위 안 앱의 read command만 blueprint의 이름·설명·입력 형식에서 만든 tool로 제공하고 write·external·confirm command는 내보내지 않는다.
- 이유: 앱 command를 다시 구현하거나 별도 앱 MCP를 만들지 않고 기존 coding agent의 읽기 범위를 유지한다.
- 확인: read command의 schema가 blueprint와 같고 범위 밖 앱·write·external·confirm은 발견과 직접 요청 모두에서 거절되는지 본다.
- 의도: coding-agent#I3

**[R35]** blueprint에서 만든 앱 tool은 coding-agent/mcp-server#R29의 preview 기본값·현재 scope·redaction을 유지하며 apps/runtime의 direct call을 쓰고 release나 connection이 바뀌면 목록을 다시 읽게 한다.
- 이유: 자동 tool 정의가 운영 데이터 권한이나 별도 중계 경로를 새로 만들지 않는다.
- 확인: tool 정의 뒤 release 변경을 만들어 옛 schema 호출이 거절되고 읽기는 ledger 쓰기를 기다리지 않으며 별도 앱 MCP 설정 없이 호출되는지 본다.
- 의도: coding-agent#I1

### credential과 외부 session

**[R36]** MCP server는 시작할 때 connection 참조로 OS keychain의 credential을 인증 경계에서 받고 설정 파일이나 prompt의 token을 요구하지 않으며 keychain 실패에서는 user credential·평문 파일로 fallback하지 않는다.
- 이유: 연결 선택 뒤 자동 설치가 credential을 노출하지 않아야 한다.
- 확인: 자동 발급 connection으로 초기화하고 keychain 잠김에서는 unavailable이며 token이 MCP text·진단·설정·PTY 출력에 없다.
- 의도: coding-agent#I1

**[R37]** ticket 시작·harness 설치·resume·permission 대답을 coding credential의 MCP tool로 제공하지 않고 지정 ticket의 claim·작업·보고만 허용한다.
- 이유: 사람 [Start] 허락과 제품 permission을 coding credential이 대신할 수 없다.
- 확인: 직접 start·설치·permission 응답 op는 discovery와 직접 호출에서 거절되고 session 관측이 없어도 유효 claim 검사는 coding-agent/tickets를 따른다.
- 의도: coding-agent#I4

### coding agent tool의 경계

**[R38]** lophn은 coding agent에게 앱 toolset 말고 다른 tool을 주지 않는다: 문서·project·context·용어·series 읽기와 저장, 목차·검색, 질문·approval request 읽기는 coding agent tool이 아니다. 사람이 project 터미널에서 Claude Code 같은 coding agent를 띄워 자기 코드를 고치는 일은 그냥 터미널 프로그램이며 lophn은 그 안에 앱 toolset 말고 어떤 tool도 주지 않는다.
- 이유: coding agent가 lophn에서 하는 일은 앱 개발과 앱 고치기뿐이다. 사람이 자기 코드를 고칠 때 쓰는 터미널은 lophn의 coding agent 통로가 아니다.
- 확인: discovery와 직접 요청 양쪽에서 위 동작이 알 수 없는 tool로 거절되고, 앱 연결 없이 project 터미널에서 띄운 coding agent에는 lophn 문서·context tool이 나타나지 않는다.
- 의도: coding-agent#I3

**[R39]** 작업 요약 tool은 앱 toolset에서 연결 범위 안의 열린 문제·ticket·현재 claim과 기한·보고 뒤 남은 검사 조건을 요청 시 읽어 coding-agent/guides의 시작 summary 계약대로 전달하고 claim 생성·갱신이나 수리 착수를 하지 않는다.
- 이유: 세션 요약이 문서나 context를 읽는 tool이 아니라 앱 일의 현재 상태 조회로 남아야 한다.
- 확인: 범위 밖 자료와 문서·context 항목이 없고 요약을 읽어도 claim이 생기지 않으며 각 항목에서 상세 조회 방법이 나온다.
- 의도: coding-agent#I3

## 열린 질문

없음.

## 버린 것

- 옛 toolset 이름과 전체 선택 별칭, context에서 Home으로 redirect하는 동작, 문제 상세·sample 별칭은 폐지 결정에 따라 버리고 현재 정본 이름과 기능만 내보낸다.
- HTTP MCP와 개인 SDK는 첫 판에 두지 않는다. MCP는 stdio만 제공한다.
- coding agent의 탐색·목차·검색·문서 읽기와 저장·format·series·context(R8, R10~R14, R16, R17), 자리 없는 저장(R15), project 읽기(R9), 질문과 approval request 목록 읽기(R18 일부)는 coding agent가 하는 일이 앱 개발과 고치기뿐이라는 사람의 결정으로 버린다. 문서는 project 폴더의 파일이므로 coding agent는 자기 파일 도구로 읽는다.
- core toolset은 버린다. 기본 toolset이 앱 toolset이며 core를 켜는 옵션과 별칭은 없다.
