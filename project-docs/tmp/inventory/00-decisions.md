# 구현 전수 목록: 열린 물음 분류 (2026-10-15)

`00-open.md` 1장의 물음 126개를 lead가 셋으로 나눴다. 번호(#)는 `00-open.md` 1장의 번호다.

> **확정(사람 ㄱㄱ 2026-10-15).** A는 lead 추천대로, B는 전부 추천대로 정했다. C는 refactor session에 넘긴다. 바뀐 요구 문장은 사람이 다시 본다(`docs-review.md` 같은 날 기록).

| 칸 | 뜻 | 수 |
|---|---|---|
| A. 사람이 정할 것 | 제품 범위, 사람이 보는 동작, 화면 위치. 문서에 답이 없고 철학으로도 하나로 정해지지 않는다 | 16묶음 |
| B. lead 추천으로 정할 것 | spec, 요구, 철학(결정은 grant 때 몰아서, 선언은 믿는다, program은 결정적 판정만, 부르는 쪽 없는 동작은 늘어놓지 않는다)에서 답이 나온다. 사람이 한 번에 확인한다 | 56(합치기에서 넘어온 넷 포함) |
| C. refactor session이 정할 것 | "어떻게 만들지"다. process 배치, transport, 저장 위치, 이름 철자, 형식, 수치. 개발 규칙(`../../dev/`)과 리팩터링 계획(`../../plan/`)의 몫이다 | 58 |

## A. 사람이 정할 것

| # | 물음 | lead 추천 |
|---|---|---|
| 123~126 | "보류"는 코드도 지우나. notifications, install-and-update, Things to confirm, 앱 automation, OS notification, tray·autostart·전역 shortcut·단일 instance | 보류는 코드도 지운다(MVP 이전이라 남겨 둘 이유가 없고, 다시 만들 때는 새로 짓는다. 12가 본 agent-context처럼 옛 코드는 보류의 뜻과도 다르다). 단 단일 instance lock과 data root 권한 검사는 core 시작에 필요해 남긴다. tray·autostart·전역 shortcut은 보류 목록에 없으니 그대로 둔다 |
| 110 | 시각 블록(표·차트·도표·앱 카드)이 MVP에 남나 | 앱 카드만 남긴다(PRODUCT.md "채팅 안에서 앱의 부품을 가져다 쓰는 데까지"). agent가 만드는 표·차트·도표 블록과 `visual.prepare_document`는 지운다 |
| 111, 113 | SDK UI kit과 design system의 범위, PRODUCT.md의 "앱의 부품"이 무엇인가 | UI kit은 요구를 만들지 않고 지금 코드를 그대로 둔다. "앱의 부품"은 앱 카드를 뜻한다. `@me/` package로 UI 부품을 고치는 흐름(tmp-review 485줄)은 사람 확인이 없었으니 지금은 두지 않는다 |
| 88 | 제보(req-0172 "글이나 annotation으로 제보하면 문제가 된다")와 annotation(req-1486~1488 "App Engineer session 메시지가 되어 ticket 근거")이 두 길인가 | 하나로 합친다: annotation은 App Engineer에게 가고, App Engineer가 문제로 볼지 ticket으로 볼지 정한다. req-0172의 "annotation으로 제보" 부분을 고친다 |
| 25, 26 | 확인 창이 없어지면 approval 밖의 사람 결정(문제 결정, rewind, 파일 삭제, provider 연결, 질문 선택지 action)과 secret 입력을 어디서 받나 | 각 기능의 화면 안에서 받는다(앱 rewind는 함께 되돌아갈 목록을 보이는 panel). secret은 renderer 밖(shell main)이 띄우는 보호 입력 하나만 남긴다 |
| 28 | 모든 session의 대기 요청을 보이는 "한 목록"(req-1498)은 어느 화면인가 | 창 위의 pill에서 펼치는 panel. Things to confirm 화면은 보류라 지운다 |
| 36 | model의 층: 전역 기본이 있나, role별인가, composer에서 session 단위로 바꾸나 | 전역 기본 하나와 agent 설정(req-0039). role별 기본은 rejected(req-0360)라 두지 않는다. session 단위 바꾸기는 지금 composer대로 둔다 |
| 40 | 내장 skill 목록과 끌 수 있는지 | (바뀜, 2026-10-15: Project Manager에 context-init, context-update, 끌 수 없음, req-1525) 지금은 내장 skill을 두지 않는다(`assets/skills`가 없다). 하나를 더할 때 flag를 함께 정한다 |
| 52 | PRIMARY KEY 없는 표는 SQLite session이 기록하지 않아 rewind에서 빠진다 | SDK의 표 만들기(migration API)에서 PRIMARY KEY를 필수로 한다. lophn이 약속하는 rewind의 전제라 선언 검사가 아니다 |
| 81 | 무시(`ignored`) 중인 문제가 재발하면 다시 여나 | 다시 열지 않는다. 무시는 사람이나 App Engineer가 일부러 고른 상태다 |
| 90 | project나 앱을 보관하면 그 place의 agent와 열린 session은 | session은 열린 채 두되 reaction과 call의 새 입력을 받지 않는다(받는 곳 `closed`). 다시 꺼내면 이어진다 |
| 94 | 외부(다른 편집기, git)에서 열린 파일이 바뀌면 | 파일을 watch해 바뀌면 다시 읽는다. 편집 중이면 충돌을 알리고 고르게 한다(VS Code 방식) |
| 97, 116 | project 파일 검색 화면의 위치, rail의 Search 단추 | rail의 Search 단추를 project 파일 검색으로 쓴다. req-0073의 contains에 Search를 더한다 |
| 115 | Lophn Workspace에 Apps 화면과 Projects 화면을 두나 | 둘 다 둔다. 사람이 project를 등록·보관하고(core-projects) 앱을 보관·꺼낸다. 안은 목록과 그 동작만으로 줄인다 |
| 70 | 터미널 탭(coding TUI)은 어디서 열리고 focus를 옮기나 | 그 앱의 앱 공간에서 연다(App Engineer는 앱 place, source는 project 밖일 수 있다). 자동으로 focus를 옮기지 않고 toast로 알린다 |
| 34, 108 | agent에게 앱을 할당하는 화면의 위치, rail의 Agent 단추와 `+` 메뉴의 Agents 항목 | 할당은 agent 설정 화면(무엇을 맡기나)에 둔다. rail Agent 단추는 lophn을 연다(P7)로 남기고 `+` 메뉴의 Agents 항목은 지운다(removed.md) |

## B. lead 추천으로 정할 것

| # | 물음 | lead 추천 | 근거 |
|---|---|---|---|
| 14 | trace·사용량을 어디에 남기나 | 호출별 사용량·비용 기록은 남긴다(changes-by-topic "그대로"). 저장 위치는 C. trace export는 지운다(export 전부 지움) | removed.md, changes-by-topic 5장 usage |
| 16 | file-tracking 깨움 신호 | 물음이 사라진다(file-tracking을 지움) | 10 |
| 17 | 앱 화면이 activation, grant, rewind 뒤 다시 그리는 신호 | 남지 않는 event로 앱 view에 알린다. domain event가 아니다(반응할 쪽이 없다) | S1 2장, 7장 |
| 19 | call과 사람 메시지가 한 입력함에 함께 쌓일 때 | 사람 먼저(지금 코드). 사람의 지시가 agent 사이 입력보다 급하다 | S3 11장 6과 같은 생각 |
| 20 | 앱 줄에 서 있던 coding call이 lophn 재시작 뒤 | 줄은 메모리. 재시작하면 그 call은 failed(이유: lophn 재시작)로 보낸 쪽에 돌아간다. 조용히 버리지 않는다 | S3 5장, req-1501 |
| 24 | 사람 자격 확인 handle | 남긴다. 창만 없애고 카드나 화면을 누를 때 main이 발급한다 | req-0303, 02 추천 |
| 27 | 문제의 해결됨·무시를 확인 없이 누르나 | 확인 없이 누른다. 사람 자신의 동작이고 다시 열 수 있다 | S2 5장 |
| 29 | activation 허락을 앱 상세에도 보이나 | 보이지 않는다. 대기 목록 하나면 된다 | req-1498 |
| 30 | agent grant의 key | agent ID. 고정 role agent도 ID가 있다. 저장 위치는 C | S2 4장 |
| 31 | release에서 빠진 app-api의 override | 지운다. 같은 이름이 다시 생기면 효과별 기본값으로 들어온다 | S2 4장 |
| 32 | 설정 고치기로 보는 지침 파일 | `LOPHN.md`뿐이다. agent 정의와 skill은 lophn data에 있어 file tool이 닿지 않는다 | S2 5장, S4 3장 |
| 35 | 앱 grant를 보고 거두는 화면 | 앱 상세에 둔다. req-0873이 거두기를 전제한다 | S2 4장 |
| 37 | 고정 role agent(App Engineer, Project Manager)도 agent 지침을 갖나 | 갖는다. agent 설정 화면이 project 지침과 그 agent의 지침을 같이 보인다 | S4 5장, req-0095 |
| 39 | 앱 place의 skill 폴더와 MCP 층 | 지운다. 층은 전역, project, agent다 | S4 2장, req-0038 |
| 42 | S4 4장 표에 없는 지금 tool(`project.*`, `app.health`, `app.invocations` 등) | 지운다. 필요한 정보는 place 정보와 4장 표의 tool로 준다. 필요가 드러나면 표에 더한다 | S4 4장 |
| 45 | 질문 카드의 Skip | 지운다. 답하지 않은 질문은 outcome으로 끝난다 | S4 3장 |
| 47 | 화면 현재 보기 relay | 지운다 | S4 6장 "넣지 않는 것" |
| 49 | 전역·앱 층 지침 | 전역 지침은 있다(S4 5장). 앱 층 지침은 없다 | S4 5장 |
| 53 | 앱 시작 invocation의 changeset, migration(DDL) | 시작 중 DB 변경은 changeset으로 남긴다. migration은 release 경계라 rewind 대상이 아니다 | S5 6장, S7 |
| 54 | core가 호출 중 죽어 changeset을 받지 못한 write | 결과 모름으로 닫고 rewind 화면에 "되돌릴 수 없음"으로 표시한다 | S5 7장 |
| 58 | 앱의 project client와 project 고르기 | `cap-project` 꼴 client 하나. 현재 project는 view bridge에서 읽는다. 고르는 UI는 shell(앱 place)이 맡는다 | 12 추천, req-1511, 1515 |
| 61 | coding agent의 권한 mode(S6과 옛 docs-review의 읽기 명령 허락 목록) | S6을 따른다(오늘 결정). 옛 docs-review 줄은 낡은 것이다 | S6 2장 4 |
| 62 | 첫 prompt를 넣는 때 | argv로 넘긴다. argv가 안 되는 제품은 session 시작 hook을 받은 뒤 paste한다. 둘 다 안 되면 맡길 수 없는 제품으로 Settings에 보인다 | S6 2장 1 |
| 63 | skill 설치 receipt | 마지막에 쓴 내용의 hash만 남긴다 | req-1083 |
| 64 | hook이 없는 제품의 `SessionStarted` | lophn이 PTY를 띄울 때 낸다. 외부 session ID는 없다 | req-1099 |
| 71 | 사람이 TUI에 입력 중일 때 lophn의 메시지 | 사람이 그 터미널 탭에 focus해 있으면 넣지 않고 기다린다 | S6 7장 |
| 72 | 사람이 ticket을 직접 만드나 | 만들지 않는다. 사람은 App Engineer에게 청한다 | req-1450, P8 |
| 73 | 문제 하나에 수리 ticket 하나 예약 | 지운다. 근거 요구가 없다 | 06 |
| 76 | `TicketVerified`에 이은 release가 여럿이면 | 가장 새로 준비된 release | S7 5장 |
| 77 | activation 줄 | 메모리. 재시작하면 Reactor가 cursor 뒤부터 다시 반응한다 | S1 10장 |
| 84 | activation 카드 내용 | 늘어난 선언과 손실 단계만 보인다 | S7 6장 |
| 86 | 앱 Data 탭 | 지운다(export가 없으면 남는 것이 형식 번호 한 줄뿐) | 07 추천 |
| 87 | [I tried it again] | 지운다. 새 모델에 부르는 쪽이 없다 | 07 |
| 89 | archive나 지움 때 도는 turn | interrupted로 닫고 진행한다 | S1 10장과 같은 꼴 |
| 91 | call로 열린 session의 checkpoint | 모든 Router 입력(사람 메시지, call, 답)이 turn을 시작하면 checkpoint다. steer로 들어온 메시지는 checkpoint가 아니다 | Claude Code checkpointing("Messages sent mid-turn not checkpointed") |
| 92 | fork의 지금 동작 | 그대로 둔다(S8 5장과 맞는다). assignment 참조만 role·place로 바꾼다 | S8 5장 |
| 95 | project의 `guide.*` route | 지운다. S4의 `guide.read`는 lophn 제품 안내로 따로다 | S4 4장 |
| 96 | project의 `name`(slug)과 `title` | 이름 하나만 남긴다. slug는 문서 주소 체계 때문이었다 | req-1473 |
| 98 | 문서 링크 `[[` 선택기 | 지운다. 문서 주소 체계와 함께 간다 | removed.md 1장 |
| 99 | md 목차 parser 둘 | 하나로 합친다 | req-1484, 1485 |
| 100 | 위반 toast를 누르면 | reaction이 이미 연 Project Manager session으로 간다. reaction이 꺼져 있으면 그때 새로 연다 | S1 5장, 8장 |
| 101 | context를 만드는 길 | `context.draft`가 새 context면 첫 판과 함께 만든다. 보관은 사람이 화면에서 한다 | S4 4장 |
| 102 | 초안 폴더와 Project Manager의 file 범위 | Project Manager의 file 범위에 자기 project context의 초안·목차 폴더(lophn data 안)를 더한다 | S8 2장, req-0012 |
| 103 | "새 위반" 판정 | 집합 비교. 개수 비교는 고쳐진 것과 새것이 겹치면 놓친다 | S1 5장 |
| 104 | 보관한 context를 검색·위반에서 빼는 규칙 | 지금 코드대로 유지한다 | 08 |
| 105 | 만드는 중(drafting) context 화면 | 지운다. context는 Project Manager session에서 만든다 | S4 4장 |
| 106 | context 판 이력과 되돌리기 화면 | Context 탭에 판 목록과 되돌리기를 둔다(사람) | req-0022 |
| 109 | context의 `docs`·`folder`·`section` kind가 `.gitignore`를 따르나 | 따른다. project 검색과 같은 규칙 | core-projects |
| 114 | `AuthorMark` | 지운다. 쓰는 곳이 없다 | 12 |
| 119 | blob store | 남기고, 지워지는 소유처의 등록만 걷는다 | 11 추천 |
| 121 | 진단 route가 제품에 등록되지 않음 | 미완성으로 보고 등록한다 | req-0459 |
| 122 | secret을 모아 보이는 화면 | 두지 않는다. 요구가 없다 | 11 추천 |
| 합1 | Settings의 Providers 화면 | 남긴다. provider마다 연결 하나(req-0051)를 사람이 맺는다. 지우는 것은 계정 기능뿐이다 | removed.md 1장, req-0051 |
| 합2 | Settings의 Tools and skills 탭 | 남긴다. skill 꺼짐 표시(req-0098)와 MCP 층(req-0038)을 사람이 다룬다 | S4 2장 |
| 합3 | `read_contract` 검사(05는 입력 계약만 남김, 07은 지움) | read가 data를 바꾸는지 보는 부분은 지운다(S5 11장 4). app-api 입력 schema 검사는 별개로 남는다(req-0704) | S5 11장 4, req-0704 |
| 합4 | 위반 목록의 [Send to …](10은 지움, 08·09는 남김) | 남긴다. 위반 근거를 붙여 Project Manager에게 넘긴다(shell req). 받는 곳은 #100대로 열린 session이 있으면 그 session이다 | shell 요구(위반 넘기기), S1 8장 |

## C. refactor session이 정할 것

어떻게 만들지의 문제라 개발 규칙(`../../dev/`)과 리팩터링 계획(`../../plan/`)의 몫이다. 계약 모양에 걸리는 것은 계획 3장에 lead 추천을 적었다. 문서를 고쳐야 하면 그쪽에서 spec 고침 표를 낸다.

| # | 주제 |
|---|---|
| 1~10 | process 배치: Router, agent event를 Bus로 넘기는 길, Gate와 grant 읽기, 입력함 durable 여부, file·shell·web tool을 도는 process와 agent-runtime의 Deno 권한, adapter와 PTY 입력 길, 앱 process transport, 앱 화면 byte(`/screens`), secret 파일 process, coding agent의 감독 child 여부 |
| 11~13, 15 | event 전달: WebSocket을 renderer가 여나 main이 중계하나, Gateway 자격, 느린 구독자, session 상태 전이 표 |
| 18, 23, 57 | 이름: 코드의 `run` → turn 범위, `mode: correction` → steer, `command` → app-api 범위 |
| 21, 22, 59, 85, 107 | 작은 화면 세부: steer 고르는 UI, call 취소 단추, 앱 view의 현재 project 표시, Version 카드 문구, Contexts 탭 Operator 수 |
| 33 | 보류 request handler 계약과 `PermissionRequested` payload |
| 38, 48 | skill 등록 폴더, 앱 Operator의 file 범위 칸 |
| 41, 43, 44, 46 | tool 이름 철자, pdf 라이브러리와 image part, 자동 compact 시점, deferred 문턱 |
| 50, 51, 55, 56 | 앱 사이 write 교착, changeset 저장 위치와 한도, `system` 호출자와 trigger, `request_key` |
| 60, 65~69, 74 | adapter 위치와 code-map, pi·Codex 신호 이름 확인, token 환경 변수, hook 명령 이름, skill 설치 위치와 trust gate 관측, CLI `app` 명령, call에 실행 옵션 담기 |
| 75, 78~80, 82, 83 | 손실 선언 위치, 필수 검사 이름과 수, network 없는 test 강제, 화면 test, 문제 snapshot 표, migration 출발점 확인 |
| 93 | 편집기의 파일 읽기·쓰기 길(core route인가 shell main인가) |
| 112 | annotation의 source 위치를 얻는 방식(12 추천: release의 source map) |
| 117, 118, 120 | 설정 파일 형식과 변경 알림, 설정 항목 이름, `ledger-id` |
