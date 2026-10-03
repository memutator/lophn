---
type: domain-model
concerns: [coding-agent/guides]
---
# coding-agent/guides

배포 skill, 요청 시 시작 summary와 앱 공통 안내의 값·제약을 정의한다.

## CodingAgentSkill (값)

lophn 설치 자원의 배포 값이다. ledger entity·ID·실행 상태는 없다. 본문은 YAML frontmatter와 UTF-8 Markdown으로 배포한다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `name` | string | 아니오 | 1~64자; `^[a-z0-9]+(-[a-z0-9]+)*$`; 배포 디렉터리 이름과 같음 | |
| `description` | string | 아니오 | 1~1,024자; 공백뿐인 문자열 금지 | 발견 시 읽는 설명 |
| `metadata` | map<string, string> | 예 | 배열·중첩 map·비문자열 값 금지 | 부가 정보 |
| `body` | UTF-8 Markdown | 아니오 | 500줄 미만; 빈 본문 금지 | |
| `references` | 상대 경로[] | 아니오 | 빈 목록 허용; 본문에서 직접 가리키는 한 단계 참조; package 밖 경로·외부 symlink·참조의 재참조 금지 | 같이 배포하는 보조 자료 |

### 불변 조건

- skill은 선택한 skill root의 바로 아래 디렉터리에 본문·보조 파일을 함께 설치한다. 외부 원본이나 다단계 분류 발견에 의존하지 않는다.
- 시작 발견에서는 name·description만 읽고 선택한 skill의 본문·직접 보조 자료만 추가로 읽는다.
- 필요한 tool과 권한을 하네스 전용 metadata에만 적지 않는다. tool 이름·command 대응·제품별 설치 위치는 → coding-agent/mcp-server, coding-agent/cli의 spec이다.
- 배포 안내는 탐색·저장·앱 제작·수리의 네 묶음을 제공한다. 이름은 `lophn-navigate`, `lophn-save`, `lophn-build-app`, `lophn-repair`이며 추후 skill 수를 entity 제약으로 고정하지 않는다.

## CodingAgentSessionSummary (값)

요청 때 범위 안의 현재 ledger를 읽어 만든 derived 값이다. 저장·ID 발급·claim 갱신·ticket 착수는 없다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `connection` | `cac` ID | 아니오 | 요청 credential의 connection; → coding-agent/connection | |
| `scope` | ConnectionScope 참조 | 아니오 | → coding-agent/connection; 요청 시 실제 scope | |
| `observed_seq` | event seq | 아니오 | summary 조회의 읽은 ledger 기준; 순서는 seq로 판단 | |
| `observed_at` | UTC 시각 | 아니오 | 공통 시각 형식 | |
| `problems` | 문제 요약 참조[] | 아니오 | open·fixing만; → problems/grouping | 제목·앱·상태·읽을 참조만 |
| `tickets` | ticket 요약 참조[] | 아니오 | open·check_failed만; → coding-agent/tickets | 제목·종류·앱·상태·읽을 참조만 |
| `claims` | 현재 claim 참조[] | 아니오 | 요청 connection의 현재 claim과 기한; → coding-agent/tickets | |
| `remaining_checks` | `{ticket, completion_seq, conditions: integer[], reason}[]` | 아니오 | 범위 안 reported ticket만; 빈 목록 허용 | 아직 확인 못한 조건 |
| `next_cursor` | opaque string | 예 | 빠진 요약이 있으면 필수 | 추가 목록 읽기; 표현은 transport spec |
| `claim_rule` | string | 아니오 | 사람이 연 세션에서 사람 지시로만 claim한다는 안내 필수 | summary 읽기는 착수 지시가 아님 |

읽기 실패를 빈 목록으로 반환하지 않는다. `observed_seq`는 전체 응답이 디스크 snapshot이라는 뜻이 아니며 대상별 쓰기는 각 concern의 revision을 다시 비교한다. 본문·전체 log·첨부·repair-context를 summary에 넣지 않는다.

## AppManagedGuide (값)

앱 루트 `AGENTS.md`의 lophn 관리 구간에 담는 로컬 안내 값이다. 추적 문서 Version의 저장 계약과 별개이며 ledger 정본은 없다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `app` | 앱 ID | 아니오 | → apps/registration | |
| `design_references` | 고정 version 주소[] | 아니오 | → documents/addressing, documents/versions; 빈 목록 허용 | 설계 읽을 곳 |
| `skills` | string[] | 아니오 | 배포 skill name; 중복 금지 | 필요한 안내 |
| `body` | UTF-8 Markdown | 아니오 | 시작 summary 읽기·사람 지시 claim·설계/blueprint/구현/machine test 구별·SDK 확인·문제 보고·테스트/preview/결과 반환·금지 작업 안내 포함 | 규칙의 정본은 해당 concern 참조 |

## 정책

- **claim 안내.** 시작 summary·제작·수리 skill은 사람이 연 세션에서 사람 지시로만 ticket을 claim하도록 안내한다. 지정 ticket을 다시 고르게 묻지 않으며 목록 발견·탐색 요청을 임의 착수로 취급하지 않는다(→ coding-agent/tickets).
- **결과 구별.** 완료 주장·preview·실제 Verification·release 준비·activation·문제 닫힘을 구별한다. 미실행 테스트와 한계를 보고하고 shell log를 machine 통과로 표시하지 않는다(→ problems/tests, apps/releases, problems/closing).
- **직접 수리.** ticket 없는 수리에는 claim 안내를 적용해 가짜 ticket을 만들지 않는다. 고친 기록·실제 테스트 요청·release 연결을 안내한다(→ problems/repairs, coding-agent/repair-context).
- **보고 규칙.** 문제 code 선언·reportProblem·예외 수집·피드백 연결·원래 증상 테스트를 빼거나 기대값을 낮춰 통과시키지 않는 안내를 포함한다. 필수 검사·release 관문 정본은 → problems/problem-codes, problems/tests, apps/releases이다.
- **공통 안내 정본.** 앱 안내는 `AGENTS.md` 하나다. 제품별 파일·설정은 정본을 읽게 하는 얇은 안내만 두며 token·변하는 ticket 본문·repair-context·역할 판단 값을 복제하지 않는다.
- **관리 구간.** 시작 marker는 `<!-- begin lophn-managed -->`, 끝 marker는 `<!-- end lophn-managed -->`다. 짝이 맞는 구간 하나의 내부만 변경하며 앞뒤 사람 내용을 바이트 그대로 보존한다. marker 없음·중복·불완전·짝 불일치는 무변경과 복구 안내다.
- **동시 변경.** 갱신은 읽은 전체 파일 hash를 비교하고 다르면 덮지 않는다. 임시 파일·원자적 교체로 반영한다. coding agent에게 임의 원본 파일 쓰기 API를 제공하지 않는다.
- **설치 확인.** 파일 존재와 실제 loading을 구별한다. MCP 초기화·tool 발견·skill 발견·앱 안내 loading의 검사 값은 → coding-agent/connection이다. 동명 설정·skill·hook·trust를 자동 덮어쓰거나 넓히지 않는다.
- **세션 시작 hook.** Claude Code의 시작·재개·초기화 hook만 현재 앱의 warning 이상 coding_agent 대상 open/fixing 문제 최대 3개와 open/check_failed ticket·나머지 수·상세 읽기·마지막 사람 지시 전 착수 금지 안내를 합쳐 10줄·1,200자 이내로 낸다. info·사람 처리 문제는 제외한다. 전체 timeout 5초·daemon 대기 3초이며 장애·빈 결과는 stdout 빈 값·exit 0이다. 일반 명시 summary는 실패를 숨기지 않는다. 다른 여섯 제품에는 hook 없이 명시 summary를 안내한다(→ coding-agent/guides#R23,R24,R25).
- **배포 고정.** skill·템플릿은 lophn binary와 함께 서명·설치하고 version·content hash로 고정한다. 같은 version의 내용 변경은 배포 테스트 실패다. 안내·skill·hook·wrapper·제품 local MCP 설정은 운영 release에서 제외하고 local 설정은 source의 관리 ignore 구간으로 안내한다(→ coding-agent/guides#R19,R20).
- **실행 금지.** ticket·problem 변화만으로 외부 coding agent를 시작하지 않는다. 훅이 없으면 같은 시작 summary를 명시적으로 읽게 안내하며 실패는 `읽지 못함`으로 표시한다.

## 정할 것

- 최초 설치에서 관리 marker 없는 기존 안내에 사람 동의 후 구간을 추가할지. 일반 갱신은 무변경이다.
- skill 문자 수 계산 단위는 spec에서 확정한다. 하네스별 발견·import·override·trust·시작 hook 동작은 실제 지원 버전별로 검증한다.
