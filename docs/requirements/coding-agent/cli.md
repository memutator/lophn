---
type: requirements
concerns: [coding-agent/cli]
---
# coding-agent/cli

사람·script·MCP 없는 coding agent가 사용하는 CLI 기능과 입력·출력·오류, 설치 점검과 daemon 관리, 사람 결정의 confirmation window 연결을 맡는다; domain 판정과 coding credential의 권한 상한은 해당 concern을 그대로 따른다.

## 요구

### 통로와 출력

**[R1]** CLI는 호출마다 얇은 daemon API client 하나로 동작하고 MCP가 없거나 꺼져도 같은 credential·입력으로 coding-agent/mcp-server의 허용 조회·저장·보고를 제공하되 coding 작업의 claim은 MCP 연결을 안내한다.
- 이유: 제품이나 transport를 바꾸지 않고 같은 일을 할 수 있어야 한다.
- 확인: 일곱 제품의 MCP 비활성 세션에서 허용 조회·저장·보고가 동작하고 domain 쓰기가 API로만 남으며 양쪽에 제공하는 기능의 허용·거절이 같다. 신규 claim은 MCP 연결 안내로 끝난다.
- 의도: coding-agent#I1

**[R2]** 모든 command는 JSON 출력을 지원하고 대응 MCP의 구조화 data와 같은 사실을 반환하며 성공은 종료 값 0, 입력·권한·실행 실패와 효과 확인 불가는 0이 아닌 값으로 구별한다.
- 이유: 사람 출력과 script 판독을 함께 제공한다.
- 확인: 도움말·설치·daemon·본문·테스트·승인 대기까지 JSON으로 읽히고 실패와 결과 불명을 성공으로 표시하지 않는다.
- 의도: coding-agent#I1

**[R3]** 기계 출력과 진단은 분리하고 JSON을 고른 경우 stdout에 한 완전한 결과만 쓰며 stderr에는 안전한 오류·추가 안내만 보내고 raw secret을 어느 쪽에도 쓰지 않는다.
- 이유: 진단 문장이 script의 결과 판독을 깨뜨리면 안 된다.
- 확인: redirect·이어 읽기·daemon 단절과 실패 진단을 넣어도 stdout JSON을 파싱할 수 있고 오류에 다음 조회가 있다.
- 의도: coding-agent#I1

**[R4]** 입력은 필수 위치 인자·선택 옵션·숫자 범위·JSON 종류·지원 command를 검증하고 JSON 본문은 inline 또는 지정 파일 하나에서만 읽으며 상대 위치는 현재 작업 위치 기준으로 해석한다.
- 이유: 잘못된 입력을 다른 작업으로 추측하지 않는다.
- 확인: 양쪽 JSON 입력을 함께 주거나 깨진 JSON·빈 필수 값·폐지 별칭을 주면 실행 전 거절하고 공백 위치·인자를 그대로 전달한다.
- 의도: coding-agent#I1

**[R5]** 변경 뒤 응답 단절로 결과를 모르면 실제 오류와 효과 불명을 구별하고 자동 새 실행 대신 현재 문서·ticket·release·invocation을 다시 읽도록 안내한다.
- 이유: CLI timeout은 daemon 변경 실패를 증명하지 않는다.
- 확인: 기록 직후 연결을 끊어도 중복 새 결과가 생기지 않고 platform/ledger의 같은 요청 확인으로 실제 결과를 찾는다.
- 의도: coding-agent#I4

### 권한과 사람 결정

**[R6]** coding credential에는 daemon 시작·중지, 승인 결정·grant·secret 값, 프로젝트·tracking·context·term·assignment 관리, 원본 파일·앱 DB 직접 접근, 문제 닫힘·무시·사람 확인을 허용하지 않는다.
- 이유: 사람용 command도 있는 CLI를 쓰는 것만으로 사람 권한을 얻으면 안 된다. secret·project·context·series 관리는 화면에서 하고 CLI의 사람 관리 command는 MVP에서 뺀다.
- 확인: coding-agent/connection의 scope를 모든 목록·검색·본문·첨부·추가 읽기에 적용하고 금지 요청은 CLI와 daemon 모두에서 거절하며 user credential로 fallback하지 않는다.
- 의도: coding-agent#I1

**[R7]** 되돌릴 수 없거나 심각한 사람 결정(연결 회수, secret 값 등록·삭제, 운영 앱 시작·중지, release activation, 문제 닫힘·무시)만 exact 대상·입력·기한을 묶어 shell/confirmation-window를 열거나 사람이 열 링크를 반환하고 TTY의 yes·비대화 script·옵션으로 승인하지 않으며 그 밖의 일은 묻지 않고 진행한다.
- 이유: 승인은 confirmation window에서만 하고, 묻는 것은 되돌릴 수 없고 심각한 일뿐이다.
- 확인: TTY·비TTY·headless에서 같은 창을 안내하고 창 미사용·닫기·기한 만료에서는 무변경으로 끝나며 coding credential은 창 열기를 이유로 사람 결정자가 되지 않고 ticket 취소·생성·[Start]·설치는 이 창을 요구하지 않는다.
- 의도: coding-agent#I4

### daemon와 설치

**[R8]** 사람은 headless에서도 daemon 시작·중지·현재 연결 상태·redaction된 daemon log를 요청할 수 있고 보통 읽기·MCP는 별도 lophn 창 없이 동작한다.
- 이유: 로컬 자동화와 장애 점검에 GUI 전체를 먼저 띄울 필요가 없어야 한다.
- 확인: 이미 시작·중지된 상태도 현재 상태로 응답하고 daemon 장애의 안전한 이유를 읽으며 연결 회수·secret 값·운영 시작·중지·release activation·문제 닫힘·무시·"내가 확인함"만 confirmation window를 요구한다.
- 의도: coding-agent#I1

**[R9]** MCP 설정 출력은 Claude Code·Codex·OpenCode·Hermes·pi·Gemini CLI·OpenClaw 중 선택 제품의 executable·분리 argv·환경 설정 조각만 반환하고 제품 설정 파일은 고치지 않는다.
- 이유: 사람이 기존 설정과 비교해 설치하게 한다.
- 확인: 각 제품의 유효 조각이 나오고 기존 설정 bytes가 동일하며 secret 원문과 운영 data 위치는 출력되지 않는다.
- 의도: coding-agent#I1

**[R10]** skill은 설치 가능 목록의 이름·설명·version을 읽고 사람이 선택한 catalog target에 설치할 수 있으며 설치 점검은 daemon·인증·설정과 coding-agent/harnesses의 네 단계 loading 결과를 따로 반환한다.
- 이유: 파일 설치와 실제 발견·loading 성공을 구별한다.
- 확인: coding-agent/guides의 보존·충돌·서명·위치 규칙대로 설치되고 doctor 결과에 성공·실패·확인 못함과 다음 확인 방법이 있다.
- 의도: coding-agent#I1

### 목차·검색·본문

**[R11]** 탐색 command는 전체·context 관점·프로젝트와 앱 자리·문서와 하위 절 목차·keyword 검색·정본 주소별 라우팅을 깊이·cursor·자리·종류 선택으로 제공한다.
- 이유: 옛 Home 대신 실제 프로젝트·앱과 관점에서 필요한 만큼 읽게 한다.
- 확인: documents/outline-and-search와 documents/contexts의 목차·반영 지연·누락을 읽고 검색은 허용 결과만 반환하며 옛 소속 context 필터는 거절한다.
- 의도: coding-agent#I3

**[R12]** 본문 읽기는 고정 판·선택 절·줄 시작과 길이로 정확한 본문을 반환하고 남은 범위·새 판 존재·부재와 추출 한계를 알려 준다.
- 이유: 긴 본문과 과거 근거를 안정되게 이어 읽는다.
- 확인: 새 판 생성 사이에도 같은 판을 읽고 다음 범위는 coding-agent/mcp-server와 같은 구조화 결과이며 읽기 진단이 본문을 오염시키지 않는다.
- 의도: coding-agent#I3

**[R13]** 판 이력은 시작·끝 판과 선택 절에 대해 추가·소실·변경·변경 없음을, diff는 두 고정 판과 선택 절의 줄 단위 차이를 제공한다.
- 이유: 옛 의미 rename 추정 대신 실제 고정 본문 비교를 유지한다.
- 확인: 복원 불가 부분을 누락으로 표시하고 documents/outline-and-search와 같은 결과를 반환하며 이름이 비슷한 절을 임의 연결하지 않는다.
- 의도: coding-agent#I3

**[R14]** 문서 목록은 프로젝트·앱·자리 없음과 active·archived를 선택하고 1~500의 요청 한도·현재 반환 수·허용된 남은 수·이어 읽기를 제공한다.
- 이유: 미분류와 보관 문서도 사람과 coding agent가 찾을 수 있어야 한다.
- 확인: 허용된 수백 문서가 빠짐·중복 없이 읽히고 범위 밖 존재가 건수에 새지 않는다.
- 의도: coding-agent#I3

### 문서 저장과 format

**[R15]** 저장은 파일 묶음의 primary와 첨부·제목·format·자리·series와 key를 받아 고정 주소·판·동일 내용 무변경·검사 경고를 반환하고 format 목록·선언·파일 bytes 검사를 별도로 제공한다.
- 이유: MCP에만 있는 검사나 저장 기능으로 CLI 사용자가 손해 보지 않게 한다.
- 확인: documents/formats·documents/versions 계약대로 명시 format 부적합은 거절하고 추론 format 경고·series key 누락·첫 파일 primary를 두 통로에서 비교한다.
- 의도: coding-agent#I3

### 문서와 원본 관리

**[R16]** CLI는 문서의 자리 놓기·원본 제거·보관 복귀를 제공하지 않고 그 사람 관리는 화면에서 하며 coding agent의 문서 저장은 정본 저장만 제공한다.
- 이유: CLI의 사람 관리 command는 MVP에서 빼고 secret·project·context·series와 함께 화면에서 한다.
- 확인: place·unplace·unarchive에 해당하는 command가 없고 coding credential의 원본 파일 이동·제거가 거절되며 문서 정본 저장은 그대로 동작한다.
- 의도: coding-agent#I3

**[R17]** CLI는 원본 파일의 추적 규칙·편집 세션·판 복원을 제공하지 않고 그 사람 관리는 화면의 documents/file-tracking에서 하며 coding agent에게 임의 원본 파일 API를 주지 않는다.
- 이유: CLI의 사람 관리 command는 MVP에서 뺀다.
- 확인: file show·track·edit·restore에 해당하는 command가 없고 coding credential의 등록 밖 파일 접근이 거절된다.
- 의도: coding-agent#I3

### context와 series

**[R18]** context 읽기는 보관 포함 목록·상세·기준과 참고와 watch 항목·glossary·문서를 참조하는 context를 제공하고 생성·항목 추가·제거는 CLI에서 하지 않으며 화면에서 한다.
- 이유: 읽기와 사람의 관점 정의를 분리하고 CLI의 사람 관리 command는 MVP에서 뺀다.
- 확인: 폴더나 untracked 파일 항목은 거절하고 context의 자리와 관점이 문서 소속으로 오인되지 않으며 CLI에 context 생성·항목 변경 command가 없다.
- 의도: coding-agent#I3

**[R19]** context 변경 제안은 고정 변경안·이유 문서의 접수를 제공하고 사람이 변경안 주소를 Context Engineer에게 맡기면 그 agent가 lophn-agent/questions의 사람의 고정 action 질문으로 연결하게 하며 제안만으로 적용하지 않고 run이나 질문을 만들지 않는다.
- 이유: 옛 Proposal 기능 목적을 lophn-agent/questions과 현재 질문 생성 권한에 맞춘다.
- 확인: 생성·이름 변경·항목 추가와 제거·관점 변경·용어 추가와 채택 변경안이 보존되고 사람 답 전에는 무변경이며 coding agent가 run이나 질문을 직접 만들지 않는다.
- 의도: coding-agent#I3

**[R20]** series는 자리별 목록·규칙·정렬된 인스턴스·다음 key와 title 제안을 읽고 새 series 등록은 CLI에서 하지 않으며 화면에서 한다.
- 이유: 정의와 계산·저장을 나누고 CLI의 사람 관리 command는 MVP에서 뺀다.
- 확인: documents/series의 첫 key 직접 지정·규칙 불일치·이미 사용한 key를 표시하고 다음 읽기만으로 인스턴스를 저장하지 않으며 CLI에 series 생성 command가 없다.
- 의도: coding-agent#I3

### 질문과 approval request

**[R21]** 질문과 approval request는 별도 목록·상세·상태·대상·이유·영향 읽기와 허용된 제안·작업 요청에서 생긴 대기를 제공하고 사람 선택·허락·거절은 되돌릴 수 없거나 심각한 일만 shell/confirmation-window로 연결한다.
- 이유: 가역 질문은 lophn-agent/questions, 되돌릴 수 없는 승인은 platform/approvals이며 나머지는 묻지 않는다.
- 확인: 대기·허락·적용·실패가 각각 나오고 옛 통합 Proposal 또는 approve·reject 별칭 없이 사람 원래 질문과 작업을 찾으며 ticket 취소는 이 창을 열지 않는다.
- 의도: coding-agent#I4

### 프로젝트 관리

**[R22]** 프로젝트는 보관 포함 목록·상세·현재 작업 위치 일치를 읽고 등록·보관·context 연결은 CLI에서 하지 않으며 화면에서 한다.
- 이유: 위치와 역할 관점의 연결을 보존하되 CLI의 사람 관리 command는 MVP에서 빼고 coding agent 권한으로 만들지 않는다.
- 확인: documents/projects 응답의 이름·목적·문서 수·읽을 자료 참조를 읽고 절대 경로·폴더 목록·tracking 규칙은 나오지 않으며 scope 밖 프로젝트는 내용 없이 거절되고 CLI에 프로젝트 등록·보관·연결 command가 없다.
- 의도: coding-agent#I3

**[R23]** CLI는 프로젝트 폴더의 추가·수정·등록 제거를 제공하지 않고 그 사람 관리는 화면에서 하며 등록 제거를 실제 파일 삭제로 하지 않는다.
- 이유: CLI의 사람 관리 command는 MVP에서 뺀다.
- 확인: folder add·update·remove에 해당하는 command가 없고 coding credential의 폴더 등록 변경이 거절된다.
- 의도: coding-agent#I3

### 앱 개발과 SDK

**[R24]** 앱 목록·상세·source 위치·개발과 release 현재 상태·command 중심 blueprint·redaction된 log·command와 automation의 invocation 이력을 읽고 앱·command·상태·개수 선택으로 좁히고 invocation 이력 최대 20개·앱 log 한 번에 요청 1~200줄 및 실제 이어 읽기를 제공한다.
- 이유: 옛 앱·runtime의 읽기 능력을 하나의 앱 모델로 유지한다.
- 확인: apps/registration·apps/runtime·apps/invocations 계약대로 active release와 preview를 구별하고 source 미연결은 없는 이유를 반환하며 별도 host journal은 없다.
- 의도: coding-agent#I3

**[R25]** 새 앱 준비는 이름·제목의 가벼운 등록과 구현 시작 source 연결·template 준비를 분리하고 전체 범위 coding connection만 등록할 수 있으며 앱 하나 connection에는 기존 앱 개발만 허용한다.
- 이유: apps/registration의 code 없는 등록을 옛 source 앱 생성과 분리한다.
- 확인: apps/registration의 입력 검사와 source 위치 계약을 사용하고 blueprint·code 없는 등록은 성공하며 개발 실행 허가 단계가 생기지 않는다.
- 의도: coding-agent#I1

**[R26]** 앱 검사는 연결 source의 blueprint 오류·경고·permission 검토를 반환하고 실제 app test·test command·reproduction test는 runner에 요청하고 app test 기본 timeout 300초를 명시해 같은 묶음 hash의 test result와 실패·timeout·미실행 이유를 읽는다.
- 이유: problems/tests에서 shell 문장과 실제 검사 정본을 구별한다.
- 확인: 부적합 blueprint가 성공 exit로 처리되지 않고 problems/tests의 결과를 직접 입력해 위조할 수 없으며 MCP와 같은 실제 결과를 조회한다.
- 의도: coding-agent#I3

**[R27]** preview 시작과 중지는 대상 앱 또는 연결 source로 fixture 격리 세션을 제공하고 preview 상태·접속 안내·중지 결과를 반환하며 실제 운영 시작·중지는 사람만 shell/confirmation-window에서 요청한다.
- 이유: 테스트 자료와 실제 사용자 자료의 실행을 구별하고 운영 시작·중지는 되돌리기 어려운 일이다.
- 확인: apps/preview·apps/runtime에 따라 preview 중단이 운영 앱을 멈추지 않고 coding credential의 운영 제어가 거절되며 운영 시작·중지만 confirmation window를 연다.
- 의도: coding-agent#I3

**[R28]** release 준비는 연결 source·선택 수리 문제·ticket과 유효한 현재 claim을 받아 같은 묶음 hash의 app test 통과·준비 release를 반환하고 새 release의 activation은 사람이 한 번 눌러 고른다.
- 이유: 준비와 실제 사용을 나누고 새 release는 사람이 한 번 고른다.
- 확인: 앱 테스트 미통과·옛 claim·다른 ticket 출처는 거절되고 준비 성공을 activation 성공으로 출력하지 않으며 apps/releases의 현재 상태를 이어 읽고 고르지 않은 release는 켜지지 않는다.
- 의도: coding-agent#I4

**[R29]** 앱 도구 재배포는 기존 앱 code·다른 server·사람 안내를 보존하며 MCP·skill·CLI wrapper·공통 안내별 변경·무변경·건너뜀과 이유를 반환한다.
- 이유: 설치 이동 뒤도 사람 앱을 안전하게 계속 개발하게 한다.
- 확인: coding-agent/guides 계약대로 두 번 호출해 중복이 없고 충돌 파일과 변경하지 않은 이유를 읽는다.
- 의도: coding-agent#I1

**[R30]** SDK는 설명·API 이름으로 catalog의 이름·최신 version·종류·한 줄 설명과 상세 API·type·permission·peer·예제를 읽고 exact version 추가의 고정 import 안내 및 명시 source 반영을 제공한다.
- 이유: 옛 문서에만 있던 재사용 기능까지 CLI에 유지한다.
- 확인: apps/sdk 및 coding-agent/mcp-server와 같은 구조 결과가 나오고 범위 version·없는 설치·기존 다른 version을 거절하며 개인 SDK 범위는 지원 미확정으로 구별한다.
- 의도: coding-agent#I3

### command와 invocation

**[R31]** 앱 command 호출은 앱·command·JSON 입력·preview 또는 운영 선택을 받아 읽기·변경·확인 필요 효과별 결과와 invocation을 제공하고 automation 수동 수행은 automation·선택 앱으로 동일 command 경계를 사용한다.
- 이유: 옛 query·action·job의 목적을 apps/blueprint 모델로 통합한다.
- 확인: apps/blueprint·apps/invocations·apps/automations에 따라 읽기는 ledger 쓰기를 기다리지 않고 확인 필요는 대기로 나오며 fixture와 운영 결과를 섞지 않는다.
- 의도: coding-agent#I3

**[R32]** invocation 결과와 approval 대기는 앱·invocation·command 선택으로 실제 접수·진행·실패·효과 불명과 남은 사람 결정을 조회하고 확인 필요 승인 대상은 exact release·command·입력 hash를 그대로 표시한다.
- 이유: apps/invocations의 일회 승인과 실행 결과를 옛 receipt 대신 동일 정본으로 확인한다.
- 확인: 다른 입력·release로 승인을 재사용하지 못하고 결과 불명에서는 현재 invocation을 읽으며 app read의 허가를 별도 receipt로 복제하지 않는다.
- 의도: coding-agent#I4

### 문제와 수리

**[R33]** 문제 읽기는 앱·진행 상태·사람 또는 coding agent 처리 대상의 목록·상세·요청 시 summary·전체 묶음·snapshot·log·발생·source diff·화면·첨부 추가 근거를 제공한다.
- 이유: 관측된 문제와 필요한 증거를 CLI에서도 단계적으로 읽게 한다.
- 확인: coding-agent/repair-context의 내용·순서·상한·cursor를 지키고 이미지 미지원 시 허용 로컬 첨부 열기 참조·종류·크기를 반환하며 raw 운영 경로를 내지 않는다.
- 의도: coding-agent#I3

**[R34]** 제작·수리 쓰기는 모두 지정 ticket의 현재 claim에 결과·고친 기록·실제 테스트·release 근거를 연결하고 완료 보고를 사용하며 ticket 없는 code 작업·문제 직접 claim·별도 repair 시도·workflow 조작을 제공하지 않는다.
- 이유: problems/repairs을 유지하면서 옛 수리 기록·검증 목적을 보존한다.
- 확인: problems/repairs·problems/tests와 coding-agent/tickets의 정본 결과를 다시 읽고 직접 요청도 담당 agent가 만든 ticket의 MCP claim을 사용하며 과거 ticket 없는 고친 기록은 조회만 유지한다.
- 의도: coding-agent#I4

**[R35]** 사람은 앱과 한 줄 증상으로 피드백을 제출하고 수리 요청을 담당 agent의 ticket 준비로 연결하고 지정 ticket 지시 또는 [Start]를 선택하며 정상·미수정·무시·false alarm과 테스트로 확인할 수 없는 수리는 현재 문제와 근거를 shell/confirmation-window에서 확인하고 그 확인은 "내가 확인함"으로 테스트 통과와 구별한다.
- 이유: 수리 부탁은 실행 승인이 아니고, 테스트를 만들 수 없는 repair는 사람의 확인을 acceptance check로 둔다.
- 확인: problems/feedback·problems/closing의 허용 결과가 읽히고 coding credential의 사람 확인·무시는 거절되며 요청만으로 문제를 닫거나 coding agent를 띄우지 않고 [Start]를 누른 TUI 시작만 coding-agent/sessions를 따르며 사람 확인이 test result 통과로 기록되지 않는다.
- 의도: coding-agent#I4

### ticket

**[R36]** ticket command는 최대 20개 앱·상태 요약 목록과 cursor·전체 본문·현재 claim·조건별 검사 조회, MCP claim 안내·명시 갱신·반납·현재 claim 근거 release 연결·완료 보고를 제공한다.
- 이유: CLI로도 현재 ticket 권리와 보고 결과를 읽고 claim이 필요하면 MCP 통로를 찾게 한다.
- 확인: coding-agent/mcp-server의 목록·본문·claim 출력과 coding-agent/tickets 판정을 비교하고 완료 주장·approval 대기·activation·확인됨을 따로 읽는다.
- 의도: coding-agent#I4

**[R37]** ticket 생성과 취소는 사람에게 같은 필수 입력 검사 및 취소 사유를 묻고 확인 없이 적용하며 coding credential에는 목표 수정·공개·취소·machine 확인 판정이나 test result 직접 작성을 제공하지 않는다.
- 이유: ticket 취소는 되돌릴 수 있는 일이라 묻지 않고, App Engineer의 ticket 생성도 묻지 않는다.
- 확인: 사람 생성 뒤 바로 열린 상태로 읽고 App Engineer 생성은 확인 창 없이 해당 역할 통로로 남으며 취소는 confirmation window 없이 적용되고 취소 뒤 옛 claim의 연결·보고가 거절된다.
- 의도: coding-agent#I4

### secret 관리

**[R38]** CLI는 secret 이름 조회·값 등록·삭제·잠금·password unlock을 제공하지 않고 secret은 OS keychain만 쓰며 값 등록·삭제는 화면의 shell/confirmation-window에서 하고 값은 command 인자·stdout·JSON·진단에 내지 않는다.
- 이유: CLI의 secret lock·password unlock과 사람 secret 관리 command는 MVP에서 빼고 secret은 OS keychain만 둔다.
- 확인: secrets status·list·set·delete·lock·unlock command가 없고 keychain 잠김은 화면에서 OS 안내로 보이며 파일 볼트·password unlock이 없고 coding credential의 secret 값 접근이 거절된다.
- 의도: coding-agent#I1

### 도움말

**[R39]** 도움말은 지원 command별 목적·필수와 선택 입력·JSON 출력·읽기와 변경 구분·사람 전용과 confirmation window 필요 여부·다음 조회를 제공한다.
- 이유: 이전 구현 유무와 상관없이 실제 제공 capability를 발견하게 한다.
- 확인: 목록에서 저장·test·blueprint·SDK·diff·file·ticket·daemon log를 찾고 폐지 별칭과 미확정 앱 간 연결 기능이 지원된 것처럼 나오지 않는다.
- 의도: coding-agent#I1

### harness와 시작 경계

**[R40]** CLI는 catalog 조회·최초 감지·사람 요청 재감지·선택 target 설치 계획·설치·갱신·제거·관측을 coding-agent/harnesses의 같은 adapter와 receipt 규칙으로 제공하고 coding credential에는 관리 쓰기를 허용하지 않는다.
- 이유: CLI도 화면과 같은 안전한 설치 계약을 써야 한다.
- 확인: 선택하지 않은 harness는 무변경이고 사람 수정 hash 충돌·partial·네 loading 관측이 같으며 MCP 설정 조각 출력은 파일을 바꾸지 않는다.
- 의도: coding-agent#I1

**[R41]** 외부 세션의 ticket claim은 MCP로 수행하고 CLI는 목록·본문·기한·보고 등 대응 계약과 명시 MCP claim 요청 안내를 제공하되 자체 claim 실행을 제공하지 않는다.
- 이유: 모든 coding 작업의 claim→작업→보고 흐름을 한 통로로 통일한다.
- 확인: CLI claim 시도는 MCP 연결·지정 ticket 안내로 끝나며 MCP 미지원 session은 자료 조회는 가능해도 claim 없이 code 작업하지 않는다.
- 의도: coding-agent#I4

## 열린 질문

없음.

## 버린 것

- Home의 목록·상세·생성·보관·이동·수정·이름 변경 별칭과 별도 개발 실행 허가는 현재 자리와 apps/registration에 맞지 않아 버리고 프로젝트·앱·문서의 관련 기능은 별도 제공한다.
- 통합 Proposal 승인 별칭·직접 문제 claim·sample 별칭·v2 독립 host journal와 receipt·repair attempt/workflow는 그대로 유지하지 않고 질문·approval request·ticket·invocation·고친 기록·실제 테스트로 기능 목적만 옮긴다.
- secret·project·context·series의 사람 관리 command, document place·unplace·unarchive, file tracking·편집 세션·version 복원은 MVP에서 CLI에 두지 않고 화면에서 한다.
- CLI secret lock·password unlock과 평문 token 파일은 두지 않는다. secret은 OS keychain만 쓴다.
- ticket 생성·취소, [Start], harness 설치를 confirmation window에 넣지 않는다. 개인 SDK는 첫 판에 없다.
