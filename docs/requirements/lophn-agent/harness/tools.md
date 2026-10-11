---
type: requirements
concerns: [lophn-agent/harness/tools]
---
# lophn-agent/harness/tools

tool 정의·목록·입력 검사·효과 분류·결과와 크기·읽기 후행 기록 및 효과 선행 기록을 맡는다. 실제 소유 계약과 역할 범위는 각 concern을, allow·ask·deny는 lophn-agent/harness/tool-judgment를 따른다.

## 요구

### 제공하는 tool

**[R1]** 자체 tool은 저장된 문서·앱·context와 agent 일을 다루는 계약만 제공하고 임의 shell·임의 파일 읽기와 쓰기·임의 URL 요청·웹 검색과 읽기·브라우저·코드 run·subagent·coding agent 시작 tool은 제공하지 않는다.
- 이유: lophn agent가 coding agent의 책임과 직접 네트워크 권한을 갖지 않는다.
- 확인: tool 목록에서 금지된 통로가 없고 외부 MCP로도 우회되지 않는지 확인한다.
- 의도: lophn-agent#I1

### 정의와 목록

**[R2]** tool 하나는 다른 소유 계약의 호출 하나를 표현하고 목적·사용 설명·필수 입력과 허용값의 JSON Schema·성공 결과·효과 분류·실패 종류·이어 읽기를 한 정의에서 목록과 실행에 함께 사용한다.
- 이유: 묶음 안 숨은 동작과 목록·실행 간 다른 입력 계약을 없앤다.
- 확인: 각 tool이 하나의 계약에 대응하고 목록의 schema와 실행 검사가 같은지 확인한다.
- 의도: lophn-agent#I1

**[R3]** tool은 진입 전에 JSON Schema와 대상 제약을 검사하여 필수 누락·모르는 입력·허용 밖 동작·종류·범위 오류를 거절하고 숫자 문자열을 숫자로 바꾸거나 잘못된 값을 추측 보정하지 않는다.
- 이유: model이 낸 잘못된 인자를 harness가 다른 동작으로 만들지 않는다.
- 확인: 숫자 문자열·추가 입력·잘못된 대상의 호출에서 진입 0개를 확인한다.
- 의도: lophn-agent/harness#I2

**[R4]** 효과는 앱 command이면 apps/blueprint를 따르고 그 밖의 tool은 lophn 밖의 상태를 바꾸면 external, 아니면 대상 변경은 write, 아니면 read로 선언하여 분류 없는 tool은 제공·호출하지 않고 호출 기록만 남기는 조회는 write로 바꾸지 않는다.
- 이유: 읽기 기록 때문에 모든 읽기가 승인·쓰기를 기다리지 않는다.
- 확인: 조회 기록·내부 변경·외부 조회·외부 조회 후 저장·외부 상태 변경의 분류와 분류 누락 거절을 확인한다.
- 의도: lophn-agent#I1

**[R5]** tool 목록은 run에 고정한 resolved agent의 권한·MCP·skill 선택과 제품 역할 상한의 교집합만 제공해 내장·앱·외부 순서를 유지하고 노출은 lophn-agent/harness/tool-judgment의 실행 허용과 구별한다.
- 이유: cache 때문에 권한 밖 tool을 보태지 않는다.
- 확인: 목록 안정성·역할별 제외를 확인하고 보이는 tool도 현재 scope 밖이면 거절되는지 확인한다.
- 의도: lophn-agent#I5, lophn-agent#I6

### 소유 계약 연결

**[R6]** 문서 tool은 허용된 project·app place의 목록·version 이력·차이·본문 읽기와 새 문서·읽은 version 기준의 새 version 저장을 제공하며 실제 범위·형식·저장 계약은 documents/versions·documents/formats와 lophn-agent/roles를 따른다.
- 이유: Home·직접 삭제·이동·시리즈 관리 권한을 옛 묶음에서 되살리지 않는다.
- 확인: 각 역할 목록에서 문서 읽기·저장과 금지된 직접 관리 동작을 구별하는지 확인한다.
- 의도: lophn-agent#I1

**[R7]** format·SDK 안내 tool은 documents/formats와 apps/sdk의 목록·규칙·예시·본문 검사를 읽기로만 제공하며 검사한 본문을 저장하거나 SDK를 설치하지 않는다.
- 이유: 안내와 검사가 상태 변경으로 변하지 않는다.
- 확인: 본문 검사·SDK 안내 호출 후 문서 version·설치 상태가 바뀌지 않는지 확인한다.
- 의도: lophn-agent#I1

**[R8]** 앱 tool은 apps/blueprint·apps/releases·apps/invocations·problems의 허용 조회와 역할·앱 허락·assignment 범위 안 command를 제공하며 앱 소스·원본 파일·secret 값 직접 접근은 제공하지 않는다.
- 이유: 앱 API를 쓰되 앱 밖 직접 접근과 역할 범위 확대를 막는다.
- 확인: 역할별 허용 command와 effect 판정이 적용되고 소스·secret 직접 접근이 막히는지 확인한다.
- 의도: lophn-agent#I1

**[R9]** agent 티켓 tool은 coding-agent/tickets의 허용 읽기·생성과 확인 필요 ticket의 실행 준비 전환(`ticket.make_ready`)만 제공하고 claim·연장·완료 보고·release 연결·취소·시작은 coding-agent/mcp-server와 사람 경로를 가리킨다.
- 이유: agent가 coding agent의 작업 증거를 대신 작성하지 않는다. 근거·acceptance check가 모자란 직접 요청도 먼저 확인 필요 ticket으로 남기므로 채워진 뒤 실행 준비로 바꿀 길이 필요하다.
- 확인: agent 목록에는 읽기·생성·make_ready만 있고 claim·완료·release 연결·취소·시작이 없는지 확인한다.
- 의도: lophn-agent#I2

**[R10]** assignment tool은 담당 현황 읽기만 제공하고 agent 정의와 assignment의 생성·변경·거둠은 사람의 owner command로만 하며 agent가 직접 적용하거나 제안 제출로 대신하지 못한다.
- 이유: 판단과 제안은 agent가, 결정과 허락은 사람이 하며 정의는 agent가 하는 일의 범위를 정하는 값이다(lophn-agent/agents#R8).
- 확인: agent의 tool 목록에 정의 저장·assignment 변경·Operator 제안 제출이 없고 담당 현황은 읽히는지 확인한다.
- 의도: lophn-agent#I5, lophn-agent#I6

### 결과

**[R11]** 결과는 확인된 성공·실패·효과 불명확을 구별하여 한 줄 요약·구조화 내용·호출 대응·완전 여부·아직 적용되지 않은 단계를 반환한다.
- 이유: 접수나 불명확을 완료로 보이지 않는다.
- 확인: 성공·실패·응답 유실·접수만 된 쓰기의 결과가 각각 구별되는지 확인한다.
- 의도: lophn-agent#I7, lophn-agent/harness#I2

**[R12]** 실패는 잘못된 입력·권한 거절·없는 대상·version 충돌·일시 사용 불가·동작 실패를 기계가 구별하는 종류와 안전한 한 문장으로 반환하고 retry는 lophn-agent/harness/run-loop에 맡긴다.
- 이유: 권한 밖 정보 노출 없이 실패 이유를 되짚는다.
- 확인: 각 오류를 구별하며 범위 밖 대상의 이름·존재와 오류 원문이 노출되지 않는지 확인한다.
- 의도: lophn-agent#I7, lophn-agent/harness#I2

### 결과 크기

**[R13]** 목록·검색은 한 번에 최대 20개 요약과 조건을 유지한 이어 보기·더 남음 여부를 반환하여 45개는 20·20·5개로 읽는다.
- 이유: 큰 목록으로 prompt 예산을 한꺼번에 소모하지 않는다.
- 확인: 45개 목록을 세 page로 읽어 중복·누락 없이 같은 조건이 유지되는지 확인한다.
- 의도: lophn-agent/harness#I2

**[R14]** 성공·실패 텍스트 결과는 요약·안내·구조화 내용을 합쳐 UTF-8 24 KiB와 300줄 중 먼저 닿는 상한으로 반환하고 문서·목록은 앞부분, log는 최신 부분을 남겨 생략·원래 크기·포함 범위·이어 읽기를 표시하며 JSON·Unicode를 깨뜨리지 않는다.
- 이유: 부분 결과를 전체로 오해하지 않고 원문을 다시 읽을 수 있게 한다.
- 확인: byte·줄 경계를 넘는 한글·JSON·log 결과의 구조·생략 표시·반환 범위·이어 읽기를 확인하며 더 작은 model 예산은 lophn-agent/harness/prompt-assemble을 따른다.
- 의도: lophn-agent/harness#I2

### 기록 경계

**[R15]** 사람 확인이 필요 없는 읽기와 앱 read command는 현재 assignment·범위를 검사한 뒤 ledger를 기다리지 않고 호출하여 기록을 뒤따라 남기고 쓰기·approval 필요 동작·external은 시작 전에 의도를 기록하며 주체·출처·판정·시각·결과와 platform/redaction을 거친 입력·출력 근거를 보존한다.
- 이유: 빠른 읽기와 효과의 선행 증거를 함께 지킨다.
- 확인: 쓰기 기록 지연 중 읽기는 응답하고 쓰기·external은 시작하지 않으며 후행 읽기 결과 저장 전 새 model 판단이 없는지 확인한다.
- 의도: lophn-agent/harness#I2

### 새 기능

**[R16]** 허락된 앱의 active release blueprint에서 command 이름·설명·입력 JSON Schema·effect·confirm·되돌리기 지원을 읽어 개별 tool 정의를 자동 생성하고 별도 MCP 등록을 요구하지 않는다.
- 이유: blueprint의 command를 API와 tool에 함께 쓴다.
- 확인: 같은 release의 command 목록에서 동일 정의가 만들어지고 MCP 서버 없이 역할 범위 안 command를 호출하는지 본다.
- 의도: lophn-agent/harness#I2

**[R17]** 자동 앱 tool은 역할·현재 앱 허락·assignment와 교집합인 command만 노출하고 release·입력·effect·confirm·되돌리기 계약 변경이나 허락 회수 뒤 옛 정의로 호출하지 않는다.
- 이유: 노출 자동화가 권한 자동 확대로 바뀌지 않는다.
- 확인: approval 대기 중 release 교체·허락 회수 시 옛 call 진입이 0개이고 새 정의는 다음 run에서 제공되는지 본다.
- 의도: lophn-agent/harness#I2

**[R18]** 앱 context 상세 읽기와 힌트·주석 되쓰기는 apps/agent-context가 선언한 read·write command를 그대로 사용하며 앱이 허락한 화면·자리·현재 화면 기준 밖의 되쓰기는 거절한다.
- 이유: 별도 DOM 조작이나 임의 입력 통로를 만들지 않는다.
- 확인: 선언된 자리의 힌트는 반영되고 화면 변경·선언 밖 자리은 거절되는지 본다.
- 의도: lophn-agent#I10

**[R19]** 시각 블록 tool은 lophn-agent/visuals의 선언형 명세 검사·세션 메시지 기록·확정 명세 읽기·문서 본문 준비만 제공하며 문서 저장은 기존 문서 tool로 별도 수행한다.
- 이유: 그림 준비와 실제 문서 저장을 같은 성공으로 보이지 않는다.
- 확인: 준비만 한 결과에는 Document·Version 생성 링크가 없고 저장 후에만 실제 링크가 생기는지 본다.
- 의도: lophn-agent#I9

**[R20]** lophn의 기능·설정 안내 tool은 동봉 안내와 platform/settings의 공개 정의·현재 적용값·출처·제약을 읽기만 하고 설정 변경 command를 agent에게 직접 제공하지 않는다.
- 이유: 설정 설명과 사람의 선택 적용을 분리한다.
- 확인: 설정 조회에 secret 값이 없고 변경은 lophn-agent/questions의 option action으로만 적용되는지 본다.
- 의도: lophn-agent#I3

### context와 series tool

**[R21]** context가 선언한 검색마다 읽기 tool 하나를 그 context의 적용된 판에서 자동으로 만들고 이름·설명·입력의 JSON Schema·결과 모양을 선언에서 가져오며, 역할 상한·assignment 범위·resolved agent의 context의 교집합인 검색만 제공한다.
- 이유: agent가 context의 도메인 지식을 쓰려고 검색 방법을 추측하거나 파일을 훑지 않게 하고, 계약이 바뀌면 tool도 같이 바뀌게 한다.
- 확인: 검색 두 개를 선언한 context에서 tool이 둘 만들어지고 입력 검사가 선언과 같으며, agent가 고르지 않은 context의 검색은 목록에 없고, 판이 바뀌어도 진행 중인 run은 옛 정의로 계속되며 새 정의는 다음 run부터 제공되는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I5

**[R22]** 개체 하나 읽기 tool은 context·type·개체 id를 받아 그 개체의 field와 관계를 돌려주고 원문이 필요하면 파일 경로와 section 범위로 이어 읽게 하며, 검색 결과와 개체 읽기 결과는 R13의 20개 요약과 이어 보기를 따른다.
- 이유: 검색 결과로 찾은 개체를 같은 계약의 눈으로 읽게 하되 큰 결과로 prompt 예산을 소모하지 않는다.
- 확인: 검색 결과의 개체 id로 읽으면 field와 관계가 선언대로 나오고, 없는 개체나 다른 project의 개체는 존재를 노출하지 않고 거절되는지 본다.
- 의도: lophn-agent#I1

**[R23]** Context Engineer에게만 계약·초안 읽기, 초안 쓰기, 미리보기, 판 제출, 위반 읽기, 용어집 읽기와 쓰기 tool을 제공하며, 미리보기는 지금 project 파일로 개체를 뽑고 위반을 보이기만 하고 판·파일·ledger의 context 상태를 바꾸지 않는다.
- 이유: 설계를 적용하기 전에 결과를 보게 하되 미리보기가 적용으로 바뀌지 않게 한다.
- 확인: 미리보기 전후에 적용된 판과 파일이 같고, 다른 세 역할의 목록에는 이 tool이 없으며, 초안 쓰기·제출·용어집 쓰기는 write로 분류되는지 본다. 초안·제출·검사의 계약은 documents/contexts, 용어집은 documents/terms를 따른다.
- 의도: lophn-agent#I1, lophn-agent#I6

**[R24]** series의 다음 이름을 읽는 tool은 context와 series kind의 type을 받아 pattern에서 다음 문서 이름을 계산해 돌려주기만 하며, 문서를 만들거나 series를 등록·변경하지 않는다.
- 이유: 반복 문서를 이어 쓸 때 이름과 자리가 저절로 정해지게 하되 agent에게 새 관리 권한을 주지 않는다.
- 확인: 호출 뒤 문서와 context 상태가 그대로이고, 같은 입력에 같은 이름이 나오며, 문서를 실제로 저장하는 일은 각 역할의 문서 저장 범위를 따르는지 본다. 다음 이름 규칙은 documents/series를 따른다.
- 의도: lophn-agent#I1

## 버린 것

- 웹 검색·읽기는 자체 tool 비목표지만 필요하면 외부 MCP로 열지 논의한다. — 유지 결정의 웹 검색·읽기 제외: 외부 MCP를 통한 lophn agent 웹 검색·읽기도 없음.
- 옛 context·용어 tool 17개(context 목록·읽기·항목·소속·용어 읽기, 생성·이름·목적·보관, 항목 추가·바꾸기·빼기, 용어 후보 제안·바꾸기·빼기, 정의 답 전달)는 선언한 검색마다 tool과 개체 하나 읽기 tool, Context Engineer의 초안·미리보기·제출·위반·용어집 tool로 바꿨다. 항목과 관점이 없어지고 용어 후보와 정의 답 전달도 없어졌다.
- 옛 series 가족 목록·상세·다음 제안 읽기 통로(documents/series#R9)는 series kind pattern의 다음 이름 읽기 tool 하나로 바꿨다.
- preset 읽기 tool과 Operator·preset 초안의 approval request 제출 tool(옛 R10)은 preset·Operator 제안 길을 없애면서 지웠다(lophn-agent/agents, lophn-agent/assignments#Q5).
