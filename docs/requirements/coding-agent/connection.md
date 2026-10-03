---
type: requirements
concerns: [coding-agent/connection]
---
# coding-agent/connection

사람이 coding agent 연결을 만들고 회수하는 일, 전체 또는 앱 하나의 범위, 연결 이름과 credential, 일곱 제품에 대한 연결 설치와 설치 검사를 맡는다; 외부 세션의 run이나 코드 작성은 소유하지 않는다.

## 요구

### 지원과 권한

**[R1]** Claude Code, Codex, OpenCode, Hermes, pi, Gemini CLI, OpenClaw의 사람이 연 세션을 MCP·CLI·필요할 때 읽는 skill로 연결하고 lophn은 coding agent 프로세스나 코드 생성 loop를 직접 시작하지 않는다.
- 이유: 사람이 이미 쓰는 도구를 바꾸지 않고 앱을 만들고 고치게 한다.
- 확인: 일곱 제품의 사람이 연 세션에서 연결되고 core에 제품별 실행 adapter가 없으며 lophn 시작·문제 발생·티켓 생성만으로 외부 프로세스가 뜨지 않는다.
- 의도: coding-agent#I6, coding-agent#I1

**[R2]** 연결 생성과 회수는 사람이 정확한 연결 이름과 전체 또는 앱 하나의 범위를 confirmation window에서 확인해 결정한다.
- 이유: 연결 범위가 사람의 의도보다 넓어지지 않아야 한다.
- 확인: coding agent가 연결을 발급·회수·확대하려 하면 거절되고 사람이 선택한 앱 하나 또는 전체만 등록된다.
- 의도: coding-agent#I2

**[R3]** 연결 이름은 명시 이름 옵션·제품 환경의 이름·MCP 초기화 client 이름 순서로 표시하되 제품 이름·인자·작업 폴더로 호출자를 추정하지 않고 platform/identity의 credential과 연결 범위로 권한을 확인한다.
- 이유: 같은 제품을 쓰는 서로 다른 연결을 구별하고 이름으로 권한을 얻지 못하게 한다.
- 확인: 두 Claude Code 연결의 기록이 구별되고 이름·작업 폴더를 바꾸어도 읽기·쓰기 범위가 넓어지지 않는다.
- 의도: coding-agent#I2

**[R4]** 전체 범위 연결도 사람 권한이 아니며 앱 등록은 전체 범위 연결에만 허용하고 앱 하나 범위 연결의 등록 요청은 거절한다.
- 이유: apps/registration의 가벼운 등록 주체와 사람 전용 작업을 구별한다.
- 확인: 전체 연결의 apps/registration 요청은 해당 계약대로 처리되고 앱 하나 연결에서 새 앱 등록은 거절된다.
- 의도: coding-agent#I2

**[R5]** 앱 하나 범위 연결은 그 앱의 문서·앱 정보·문제·티켓과 공통 format·SDK·템플릿만 읽고 목록·검색·절·첨부·추가 근거에도 같은 범위 검사를 받는다.
- 이유: 티켓 근거나 검색 결과가 범위를 우회하면 앱 하나 연결의 의미가 사라진다.
- 확인: 다른 앱과 프로젝트의 근거를 가리켜도 제목·본문이 나오지 않고 현재 연결로 읽을 수 없다는 사실만 표시된다.
- 의도: coding-agent#I2

**[R6]** 연결은 coding-agent/mcp-server와 coding-agent/cli에서 같은 credential로 같은 요청의 허용 여부와 결과를 받는다.
- 이유: 통로를 바꿔 사람 권한을 얻거나 판정이 달라져서는 안 된다.
- 확인: 같은 읽기·저장·claim·release 준비를 두 통로로 요청해 결과와 거절을 대조한다.
- 의도: coding-agent#I1, coding-agent#I2

**[R7]** 승인이 필요한 요청에는 platform/approvals의 대기 사실과 shell/confirmation-window의 사람 결정 위치만 전달하고 coding agent의 대리 승인이나 승인 우회를 제공하지 않는다.
- 이유: 자료 채택과 ticket claim은 사람 승인 대신이 아니다.
- 확인: 승인 대기 응답 뒤 같은 연결로 승인·permission 변경·secret 값 접근을 시도하면 거절된다.
- 의도: coding-agent#I2, platform#I7

### 회수와 작업 경계

**[R8]** 연결을 회수하면 즉시 새 읽기와 쓰기를 거절하고 coding-agent/tickets의 현재 claim 정리 전에도 회수 credential을 허용하지 않는다.
- 이유: 정리 지연이 회수 효력을 늦추면 안 된다.
- 확인: 회수 직후 목록·본문·저장·release 준비가 거절되고 현재 claim도 해제된다.
- 의도: coding-agent#I2, coding-agent#I8

**[R9]** credential 상실이나 범위 변경은 사람이 기존 연결을 회수하고 새 연결을 만드는 방식으로만 처리하며 인증 실패 뒤 user credential로 fallback하거나 회수 연결을 자동 재발급하지 않는다.
- 이유: 기존 자동 재발급이 사람의 회수 결정을 되살릴 수 있다.
- 확인: 인증 실패를 일으켜도 새 token 발급·user 변경 요청이 없고 사람의 재연결 안내가 나온다.
- 의도: coding-agent#I2

**[R10]** coding agent 작업은 연결된 앱 source에서만 lophn 개발 통로로 요청하며 실제 symlink 경로까지 검사해 운영 data·backup·사람 원본 파일의 임의 경로와 앱 DB 직접 접근을 거절한다.
- 이유: 개발 접근을 운영 자료 접근으로 바꾸지 않아야 한다.
- 확인: source처럼 보이는 data symlink와 다른 앱 source를 거절하고 API·MCP·CLI·배포 안내에 운영 data 경로가 나오지 않는다.
- 의도: coding-agent#I2

**[R11]** 대상 앱은 명시 선택, 앱 환경 설정, 현재 작업 폴더의 blueprint 순으로 찾되 선택 결과가 연결 범위를 넓히지 않는다.
- 이유: 작업 폴더에서 편하게 읽되 권한은 고정해야 한다.
- 확인: 각 우선순위로 같은 앱을 찾고 범위 밖 앱을 명시해도 접근이 거절된다.
- 의도: coding-agent#I2

### 설치와 검사

**[R12]** 연결 설치는 사람이 고른 제품과 사용자 또는 앱 설치 범위에만 적용하고 Codex의 TOML, OpenCode·pi·Gemini CLI의 JSON 계열, Hermes·OpenClaw의 설정 방식에 맞춰 lophn 연결만 추가한다.
- 이유: 서로 다른 제품의 실제 설정 계약을 보존해야 한다.
- 확인: 일곱 제품에 기존 server·환경·permission·trust·동명 연결을 둔 채 설치하면 기존 값이 보존되고 충돌은 덮어쓰기 없이 차이로 표시된다.
- 의도: coding-agent#I6, coding-agent#I1

**[R13]** 설치 검사는 MCP 초기화·lophn tool 발견·skill 이름과 설명 발견·앱 공통 안내 loading의 네 단계를 각각 성공·실패·확인 못함으로 표시한다.
- 이유: 설정 파일이 존재하는 것과 세션이 실제로 읽는 것은 다르다.
- 확인: 비활성 연결·신뢰하지 않은 앱·동명 skill·가려진 안내를 넣으면 해당 단계의 안전한 이유와 다음 확인 방법이 나오며 trust나 permission이 자동 확대되지 않는다.
- 의도: coding-agent#I6, coding-agent#I1

**[R14]** 더 가까운 안내·override·제품 전용 안내와 OpenClaw의 별도 agent workspace를 검사해 실제 loading 누락을 경고하되 기존 파일을 삭제하거나 workspace를 앱 작업 위치로 몰래 바꾸지 않는다.
- 이유: 사용자 지시와 제품 고유 workspace를 존중해야 한다.
- 확인: 각 override와 별도 workspace 사례에 loading 결과가 표시되고 파일·workspace 설정은 바뀌지 않는다.
- 의도: coding-agent#I6, coding-agent#I1

**[R15]** MCP와 CLI는 명시 daemon 주소 옵션·daemon 주소 환경 설정·현재 daemon의 연결 정보·설치 설정·기본 loopback port 7431 순으로 daemon을 찾는다.
- 이유: 설치 이동과 여러 환경에서 같은 로컬 daemon을 찾게 한다.
- 확인: 각 설정을 다르게 두어 우선순위를 검사하고 주소가 없으면 port 7431을 쓰며 인증은 platform/identity를 따른다.
- 의도: coding-agent#I1

**[R16]** 패키지 MCP는 설치된 Deno 코드·설정·캐시만 사용해 시작하며 시작 download나 원격 코드 접속에 의존하지 않는다.
- 이유: 설치 뒤 오프라인에서도 연결돼야 한다.
- 확인: 네트워크를 끄고 cache-only 실행으로 초기화와 tool 발견이 성공한다.
- 의도: coding-agent#I1, platform#I6

**[R17]** 앱에 배포하는 CLI wrapper는 연결 credential만 사용하고 credential 원문은 source·안내·ledger·진단 출력에 넣지 않으며 로컬 보관은 platform/identity와 platform/secrets를 따른다.
- 이유: source 배포와 release가 token을 퍼뜨리면 안 된다.
- 확인: wrapper의 요청 actor가 연결이며 source·release·진단에 원문 token이 없고 평문 파일을 쓰는 보관안은 접근 mode 0600을 검사한다.
- 의도: coding-agent#I2, platform#I8

### 회수와 작업 경계

**[R18]** 외부 세션의 취소·claim 상실은 현재 티켓 재조회 결과 또는 연결 회수에 따른 인증 거절로 확인하고 lophn이 외부 OS 파일 편집이나 프로세스 종료를 강제로 통제한다고 표시하지 않는다.
- 이유: lophn이 시작하지 않은 프로세스의 통제는 보장할 수 없다.
- 확인: 취소·claim 상실 뒤 허용된 연결로 현재 상태가 읽히고 회수된 연결은 새 읽기와 쓰기가 거절되며 옛 claim 쓰기나 외부 프로세스가 종료됐다는 거짓 성공은 없다.
- 의도: coding-agent#I2, coding-agent#I8

## 열린 질문

- coding-agent/connection#Q1 외부 세션에 claim 상실을 비강제 notification으로도 전달할까.
- coding-agent/connection#Q2 Claude Code의 지원·검증 최소 버전을 고정할까.
- coding-agent/connection#Q3 앱 범위 연결에서 프로젝트 근거를 어떻게 읽을까.

## 버린 것

- lophn이 비대화형 coding agent 프로세스를 직접 띄워 ticket을 처리하는 미래 예약은 유지 결정 8과 충돌하므로 버린다.
