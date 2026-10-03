---
type: requirements
concerns: [coding-agent/guides]
---
# coding-agent/guides

coding agent가 발견하고 필요할 때 읽는 배포 skill, 요청 시 만드는 세션 시작 summary, 앱 템플릿의 공통 안내와 내용과 관리 구간을 맡는다. 실제 설치 target·ownership·갱신·제거는 coding-agent/harnesses를 따른다; 실제 권한 판정과 테스트·release 관문은 해당 concern을 가리킨다.

## 요구

### skill 발견과 형식

**[R1]** 탐색·문서 저장·앱 제작·수리의 네 절차를 Agent Skills로 제공하되 skill 수를 고정하지 않고 처음에는 이름과 설명만 발견하게 한다.
- 이유: 절차 본문을 매번 읽히지 않고 필요한 일을 쉽게 찾게 한다.
- 확인: 네 절차를 찾을 수 있고 시작 입력에 모든 본문이 복사되지 않으며 선택한 skill만 추가로 읽힌다.
- 의도: coding-agent#I3

**[R2]** 배포 skill은 YAML frontmatter와 UTF-8 Markdown을 사용하고 이름은 소문자 영문·숫자·단일 하이픈으로 1~64자, 설명은 비어 있지 않은 1~1,024자, 본문은 500줄 미만으로 배포 전에 검사한다.
- 이유: Agent Skills의 공통 형식으로 일곱 제품에서 발견되게 한다.
- 확인: 최대 길이와 한 글자 초과·연속 하이픈·이름과 디렉터리 불일치·빈 설명·500줄 본문을 비교해 부적합 배포가 거절된다.
- 의도: coding-agent#I6

**[R3]** tool 설명은 짧게 유지하고 상세 절차는 skill 본문에서만 제공하며 skill 부가 metadata는 문자열에서 문자열로의 map만 허용하고 tool 의존·권한을 제품 전용 metadata에만 숨기지 않으며 보조 자료는 본문에서 직접 가리키는 한 단계 상대 참조로 제공한다.
- 이유: 특정 제품만 해석하는 구조에 절차가 의존하면 이식되지 않는다.
- 확인: 배열·중첩 map·비문자열 값·package 밖 참조·참조의 재참조를 거절하고 metadata를 해석하지 않아도 본문에서 필요한 통로를 찾는다.
- 의도: coding-agent#I3, coding-agent#I6

**[R4]** skill은 선택한 제품의 skill root 바로 아래 skill별 디렉터리에 본문과 보조 자료를 함께 설치하고 외부 symlink나 다단계 디렉터리 발견에 의존하지 않는다.
- 이유: 가장 좁은 공통 발견 방식으로 원본 위치와 무관하게 읽게 한다.
- 확인: 외부 원본을 치워도 root 안의 본문과 보조 자료가 읽히고 root 밖 참조는 배포 검사에서 거절된다.
- 의도: coding-agent#I6

**[R5]** Claude Code·Codex·OpenCode·Hermes·pi·Gemini CLI·OpenClaw의 실제 skill 발견 위치와 trust 절차에 맞는 설치 안내를 제공하고 동명 skill은 자동 교체하지 않으며 pi에서는 MCP tool이 직접 호출되게 한다.
- 이유: 같은 폴더 한 곳에 복사하는 것만으로 모든 제품이 사용할 수는 없다.
- 확인: 제품별 실제 선택 skill과 충돌을 coding-agent/harnesses 검사로 확인하고 pi에서 별도 실행 script 없이 tool을 호출한다.
- 의도: coding-agent#I6

### 작업 절차

**[R6]** 탐색 안내는 전체 목차에서 컨텍스트·문서·절로 필요한 만큼 펼치고 기준은 전체, 참고와 watch는 요약부터 읽게 한다.
- 이유: documents/contexts의 관점과 읽기 깊이를 보존한다.
- 확인: 같은 자료를 기준·참고·watch에 넣어 시작 읽기 깊이가 달라지고 필요 본문은 documents/outline-and-search로 이어 읽힌다.
- 의도: coding-agent#I3

**[R7]** 문서 저장 안내는 documents/formats 확인과 검사, 허용된 프로젝트·앱 또는 자리 없음 선택, 저장, 고정 주소 보고 순서로 수행하고 사람 원본 파일의 직접 편집 통로를 안내하지 않는다.
- 이유: agent 문서 저장과 사람 원본 파일 편집을 구별한다.
- 확인: 형식 검사·자리·저장·주소 보고가 순서대로 있고 coding agent에게 원본 파일 API를 쓰라고 하지 않는다.
- 의도: coding-agent#I3

**[R8]** 앱 제작 안내는 지정 ticket 읽기·MCP claim 뒤 채택 설계와 유지 제약 읽기, 설치 SDK와 재사용 재료 찾기, 필요하면 전체 연결의 가벼운 앱 등록, 구현 시작 source 연결·템플릿, blueprint를 먼저 수정한 뒤 구현, 실제 테스트, preview, release 준비, 결과 반환 순서를 따른다.
- 이유: apps/registration와 problems/tests를 유지하고 새 code 전에 재사용을 검토한다.
- 확인: SDK 탐색이 구현 전에 나오고 앱 하나 연결은 등록 대신 등록된 앱을 사용하며 app test 실패 뒤 release 준비를 시도하지 않는다.
- 의도: coding-agent#I3, coding-agent#I5

**[R9]** 수리 안내는 사람 지정 ticket 읽기와 claim, coding-agent/repair-context 읽기, 필요한 근거 추가 조회, 수정, 실제 테스트·preview, 현재 claim 재확인, release 준비와 결과 반환 순서를 따른다.
- 이유: 사람이 정한 일을 다시 선택하게 하지 않고 오래된 claim으로 결과를 제출하지 않게 한다.
- 확인: 지정 ticket을 다시 고르라는 질문 없이 진행하고 claim 상실 뒤 release 준비·보고를 중단하며 탐색만 요청한 경우 임의 수리에 착수하지 않는다.
- 의도: coding-agent#I4, coding-agent#I7

**[R10]** 사람의 직접 제작·수리 요청도 lophn·App Engineer가 검사 가능한 ticket으로 정리한 뒤 MCP claim·작업·보고하도록 안내하고 ticket 없이 code 작업을 시작하지 않는다.
- 이유: 직접 요청과 자동 발견을 구별하되 모든 coding 작업의 계약은 ticket 하나로 통일한다.
- 확인: 직접 요청 예제도 ticket 생성 근거·MCP claim·보고가 있고 필요한 채택 답·reproduction 기준이 없으면 무생성과 담당 agent의 다음 행동 안내가 나온다.
- 의도: coding-agent#I5

**[R11]** 제작·수리 안내는 problems/problem-codes의 문제 코드 선언·보고·예외 수집·피드백 연결과 원래 증상 테스트를 포함하고 기존 fixture·업무 제약을 보존하며 선언 삭제·기대값 완화로 문제를 숨기지 않게 한다.
- 이유: 수리 이후 정상 여부를 machine이 확인할 근거를 잃지 않아야 한다.
- 확인: 안내의 체크 목록에 해당 concern이 있고 선언 삭제·조건 완화 사례를 정상 수리로 안내하지 않으며 매 수리 뒤 새 탐지 규칙을 반드시 추가하라고 요구하지 않는다.
- 의도: coding-agent#I5

**[R12]** 결과 안내는 완료 주장·preview·실제 test result·release 준비·activation·문제 닫힘을 구별하고 실행한 확인과 미실행·한계를 보고하게 한다.
- 이유: 고쳤다는 말이나 shell log를 machine 통과로 오인하지 않게 한다.
- 확인: 실패·미실행 테스트와 승인 대기 예제에서 실제 결과와 한계가 나오고 problems/tests·apps/releases·problems/closing의 사실을 대신 만들지 않는다.
- 의도: coding-agent#I5

### 앱 공통 안내

**[R13]** 앱 공통 안내는 앱 root의 Markdown 정본 하나로 유지하고 Codex·pi·OpenCode·Hermes는 이를 읽으며 Claude Code는 얇은 import 안내, Gemini CLI는 기존 안내 목록을 보존한 추가 참조로 같은 정본을 읽게 한다.
- 이유: 규칙 본문을 제품별로 복제하면 서로 어긋난다.
- 확인: 한 정본 변경이 새 세션에 반영되고 Claude Code의 기존 안내와 Gemini CLI의 기존 목록이 보존되며 제품별 실제 loading은 별도로 검사된다.
- 의도: coding-agent#I6, coding-agent#I3

**[R14]** 공통 안내에는 lophn 앱 설명·필요 skill·시작 summary·사람 지시 claim·설계와 blueprint와 구현 및 machine 생성물의 구별·수정 주의·용어·SDK 확인·문제 보고·테스트·preview·결과 반환만 담는다.
- 이유: 오래 유지되는 절차와 매 작업 바뀌는 자료를 분리한다.
- 확인: ticket 본문·수리 묶음 전체·역할 판단 값·token 원문이 없고 생성물 수정 주의와 해당 concern 참조가 있다.
- 의도: coding-agent#I3, coding-agent#I4

**[R15]** 공통 안내 갱신은 짝이 맞는 lophn 관리 구간 하나의 내부만 바꾸고 바깥 사람 내용은 바이트 그대로 보존하며 경계 없음·중복·불완전·짝 불일치면 무변경과 복구 안내로 끝낸다.
- 이유: 배포 갱신이 사람의 지시를 파괴하면 안 된다.
- 확인: 앞뒤 사람 문장이 두 번 갱신 뒤에도 동일하고 각 경계 오류에서 파일이 바뀌지 않는다.
- 의도: coding-agent#I6, coding-agent#I1

**[R16]** 안내 갱신은 읽은 파일과 현재 파일이 다르면 덮지 않고 임시 파일의 원자적 교체로 반영한다.
- 이유: 설치 도중 사람의 동시 편집을 잃지 않아야 한다.
- 확인: 읽기 뒤 사람 변경을 넣으면 충돌 안내와 무변경이 나오고 교체 중단 뒤 불완전 본문이 남지 않는다.
- 의도: coding-agent#I6, coding-agent#I1

### 안전한 배포

**[R17]** 앱 템플릿과 도구 재배포는 MCP 설정·skill·coding credential용 CLI wrapper·공통 안내·제품별 얇은 안내·ignore 안내를 제공하되 앱 code와 사람 안내·다른 MCP 설정은 건드리지 않는다.
- 이유: 앱 개발 준비가 앱 구현과 사용자 도구를 덮으면 안 된다.
- 확인: 같은 배포를 두 번 해도 중복이 없고 설치 경로가 바뀐 뒤 재배포해도 앱 code와 기존 설정이 보존된다.
- 의도: coding-agent#I6, coding-agent#I1

**[R18]** Codex에는 앱별 MCP 설정 파일을 자동 만들지 않고 사용자가 coding-agent/cli의 설정 조각을 받아 설치하는 방법을 공통 안내에서 제공한다.
- 이유: Codex 연결 설치 계약을 다른 제품의 프로젝트 설정과 혼동하지 않는다.
- 확인: Codex 앱 생성과 재배포 뒤 안내만 추가되고 기존 TOML 설정이 자동 수정되지 않는다.
- 의도: coding-agent#I6

**[R19]** 배포 안내·skill·hook·CLI wrapper·MCP 설정은 운영 release 묶음에서 제외하고 local hook 설정은 source의 ignore 안내에 포함한다.
- 이유: 개발 도구가 앱 실행 코드나 공유 credential로 퍼지지 않아야 한다.
- 확인: source에는 개발 통로가 있고 release에는 제품 local 설정과 배포 도구가 없다.
- 의도: coding-agent#I2

**[R20]** 배포 skill은 lophn binary와 함께 서명·설치하고 skill과 앱 템플릿은 version과 content hash로 고정해 같은 version의 내용 변경을 배포 테스트에서 거절한다.
- 이유: 플랫폼 안내 자체가 공급망과 갱신 추적의 대상이다.
- 확인: 동일 version 내용을 바꾸면 테스트가 실패하고 사용자가 만든 skill은 로컬 파일로만 취급된다.
- 의도: coding-agent#I6

### 세션 시작 summary

**[R21]** 시작 summary는 요청 시 연결 범위 안의 현재 열린 문제·ticket·현재 claim의 기한과 읽을 곳·완료 보고 뒤 남은 검사 조건을 요약하고 전체 본문·log·첨부·수리 묶음은 넣지 않는다.
- 이유: 세션 시작에 적은 자료로 현재 일을 파악하게 한다.
- 확인: 범위 밖 자료가 없고 각 요약에서 상세 조회가 가능하며 summary를 읽어도 claim 생성·갱신·수리 착수가 없다.
- 의도: coding-agent#I3, coding-agent#I8

**[R22]** 시작 summary와 제작·수리 skill은 자기 터미널의 사람 지시 또는 coding-agent/sessions의 [Start] 첫 prompt로 지정한 ticket만 MCP claim하며 목록 발견과 summary 읽기는 착수 지시가 아님을 명시한다.
- 이유: lophn-agent/harness/tool-judgment의 즉시 열린 ticket이 저절로 일을 시작하는 것으로 바뀌지 않게 한다.
- 확인: ticket이 생긴 뒤 summary만 읽으면 작업이 시작되지 않고 사람이 특정 ticket을 지시하면 다시 선택하게 묻지 않는다.
- 의도: coding-agent#I4

**[R23]** Claude Code의 시작·재개·초기화 hook은 현재 작업 앱의 warning 이상 coding agent 대상 열린 문제와 ticket을 10줄·1,200자 이하로 보여 주고 info와 사람 처리 대상 문제를 제외하고 문제는 최대 3개 뒤 나머지 수와 상세 읽기를 안내한다.
- 이유: 기존 시작 요약 예산을 지키면서 ticket까지 발견하게 한다.
- 확인: 4개 이상의 문제와 ticket을 넣어도 상한을 지키고 사람 처리 대상 문제는 제외되며 끝에 사람의 수리 지시 전에는 착수하지 말라는 안내가 있다.
- 의도: coding-agent#I3, coding-agent#I4

**[R24]** Claude Code 시작 hook은 전체 timeout 5초·daemon 대기 3초로 제한하고 daemon 장애·문제와 ticket 없음에서는 빈 출력과 종료 값 0으로 세션 시작을 막지 않는다.
- 이유: lophn 장애가 coding agent의 사용을 방해하면 안 된다.
- 확인: 실제 Claude Code 실행 없이 hook 명령으로 요약·마지막 지시·빈 출력 계약을 검사하고 timeout과 장애에서도 0으로 끝난다.
- 의도: coding-agent#I1

**[R25]** 시작 summary hook은 Claude Code에만 제공하고 다른 여섯 제품은 명시 summary 조회를 안내하며 설치·상태 수집 hook은 coding-agent/harnesses#R7,R8,R11을 따르되 summary 전달과 결합하지 않는다.
- 이유: 검증되지 않은 hook 동작과 사용자 설정 덮어쓰기를 피한다.
- 확인: 다른 hook·permission이 유지되고 깨진 JSON이 덮이지 않으며 다른 여섯 제품은 명시 summary 조회 안내를 찾고 검증된 상태 hook이 있어도 summary 지원으로 표시되지 않는다.
- 의도: coding-agent#I6, coding-agent#I1

### 작업 절차

**[R26]** 수리 조사 안내는 접수 내용·당시 계약·invocation·증거와 누락·원인 가설·변경안·재현과 검증·결론 제안 순서로 사실과 해석을 나누어 찾게 한다.
- 이유: 별도 repair 단계 entity 없이도 조사에 필요한 근거 순서는 유지한다.
- 확인: 조사 예제에서 당시 고정 근거와 현재 가설이 구별되고 별도 수리 시도 상태를 만들지 않는다.
- 의도: coding-agent#I7

## 열린 질문

- coding-agent/guides#Q1
- coding-agent/guides#Q2
- coding-agent/guides#Q3
- coding-agent/guides#Q4

## 버린 것

없음.
