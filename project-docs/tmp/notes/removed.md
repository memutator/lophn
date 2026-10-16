# 지운 것·보류·바뀐 모델 (migration 작업용)

옛 요구를 새 requirements로 옮길 때 거르는 기준이다. 출처는 사람 결정 원문 세 파일뿐이다.

- `HR`: `.dev-data/human-review.md`
- `CR`: `.dev-data/context-review.md`
- `AR`: agent-review worktree의 `.dev-data/agent-review.md`

나중에 products/change-log 형식이 정해지면 "지운 것"은 그리로 옮긴다.

## 1. 지운 것

여기에 걸리는 옛 요구는 옮기지 않는다(`drop-removed`).

| 지운 것 | 포함하는 것 | 출처 |
|---|---|---|
| backup | 자동 backup, Back up now, restore, 복원 뒤 안내, Secrets export·import, Settings › Backup 탭 | HR "결정: backup, export 완전 제거" |
| export 전부 | 문서 export, 앱 data export, agent trace export, context export("Save as Markdown"), 그 밖의 사람이 누르는 export | HR 같은 결정과 정정("export도 그냥 다 삭제") |
| migration 복구본을 사람이 확인하고 지우는 절차 | 복구본 여러 개 보관, 사람 확인 뒤 삭제 | HR "결정: schema migration은 남기고 복구본만 가볍게" |
| 문서의 판(version)과 file-tracking | 파일 변경마다 판 남기기, 옛 판 보기·되돌리기, 판 주소 `doc@ver`, 읽은 판 고정, tracking 켜기·포함·제외 규칙, "Turn on tracking", "Stop tracking" | HR "결정: version·tracking 관심사 삭제" |
| 목차 색인 | 저장한 목차·section 색인, 재파생 queue | HR "결정: 목차는 색인하지 않는다" |
| agent에게 주는 md 목차와 부분 읽기 | agent용 md 목차(estimated token, 목차 예산), section이나 cursor로 이어 읽기, format module의 section 추출 규칙(anchor, `-2` 붙이기) | 문서화 session 결정(docs-review 10장) |
| series 화면과 series registry | 따로 등록하는 series(가족), draft, 보관 | HR "결정: series는 context 계약의 series kind로" |
| 문서 주소 체계(addressing) | lophn이 문서마다 붙이는 이름과 주소 `place/이름#section@판`, project·앱 이름 공간, 이름을 바꾸거나 옮긴 뒤 옛 주소 안내, 주소 이름 제안, section을 이름으로 부르기. section은 context 계약의 section kind로만 다룬다 | 문서화 session 결정(docs-review 10장) |
| place 없는 문서 | place가 없는 문서, data 폴더 안 작업 사본 | HR "결정: 문서는 project 폴더의 파일만" |
| 앱 문서 | 앱 place 문서, blueprint의 "남길 문서", 앱의 `document.save` 권한 | HR 같은 결정(앱 문서는 앱 data) |
| Workspace의 Documents·Context 화면 | Lophn Workspace 안의 문서 화면, context(Focus) 화면 | HR "결정: Workspace에서 Documents와 Context를 뺀다" |
| context watch·perspective·reason·평평한 항목 | 자료 변화 비교, 변화 알림, basis·reference·watch, 항목의 "Why it's here" | CR "결정: context watch를 없앤다", "결정: perspective를 없앤다", "context 최종 모델" |
| coding agent의 context 통로 | MCP `lophn_context`, CLI `context`, 제안 접수 | CR "결정: coding agent와 context는 상관없다" |
| coding agent의 앱 밖 tool | 탐색, 문서, format, series, 질문 읽기 tool과 같은 CLI 명령 | HR "결정: coding agent는 앱 개발과 고치기만 한다" |
| context export, 새 context form, 객체 탭, 일반 조건 saved view | — | CR "context 닫음 D", v9~v11, "결정: saved view" |
| run 단위 revert | 끝난 agent run 되돌리기, revert machine, "revert로 복원" | HR "결정: version·tracking 관심사 삭제, 되돌리기는 agent session 동안만" |
| preset, assignment 구성, scheduling | preset 판 고정, 주기 실행, Operator 출력 제한(남길 문서) | AR "결정: 미결사항 답"(2의 나머지)와 진행 기록 |
| Roles 화면, 대화 dock, 질문 칸(strip) | — | AR 진행 기록(R4·R5·I45) |
| 화면마다 둔 agent 부르기 단추 | Context 탭 [Ask Context Engineer], Contexts 탭 [New context], 새 탭 메뉴의 Agent 항목, Settings 등의 "Ask lophn" | AR §1의 1, "결정: 미결사항 답" |
| provider 계정 기능 | 한 provider에 여러 계정·credential, 계정 순서, 계정마다 끄고 켜기, run 중 다른 계정으로 넘기기, 계정 이름표 | AR "결정: provider 계정 기능 전부 삭제" |
| 내장 로컬 provider | Ollama, LM Studio, llama.cpp 정의와 그 전용 연결 | AR "결정: 내장 로컬 provider도 전부 삭제" |
| 화면 말 Focus | context를 Focus로 부르기 | CR "Focus vs Contexts" |
| built-in instructions 보이기 | role의 기본 지침 원문을 사람에게 보이기 | 문서화 session 결정(docs-review 3장) |
| coding agent의 app-api 호출 | coding agent가 앱의 app-api를 부르기, 앱 app-api를 MCP tool로 내보내기 | 문서화 session 결정(docs-review 9장) |
| 앱 화면 메모(주석) | agent가 앱 화면의 정해진 자리에 메모를 다는 것. 사람이 앱 화면에 다는 annotation(annotate mode, req-1486~1488)은 반대 방향이라 지운 것이 아니다 | 문서화 session 결정(docs-review 9장) |

## 2. 보류

여기에 걸리는 옛 요구는 옮기지 않는다(`drop-removed`로 하되 이유에 "보류"라고 쓴다).

| 보류 | 포함하는 것 | 출처 |
|---|---|---|
| Things to confirm | Workspace inbox 화면, 지난 결정 목록, notification 기록 화면 | HR "Things to confirm"(사람: "일단 이건 패스") |
| Operator 주기(schedule) | 주기 실행, 마지막 실행, 주기 설정 | AR "지적: wireframe v14의 오해 7가지" 7 |
| notifications, install-and-update | 이번 migration 범위 밖 | 문서화 session 결정(docs-review 5장 뒤) |
| 앱 automation | 앱이 사람 없이 스스로 app-api를 부르는 것(주기 실행, 앱이 켜질 때 한 번 등 모든 계기) | 문서화 session 결정(docs-review 9장) |
| 앱 화면 상태 | 앱이 자기 화면의 상태를 lophn agent에게 넘기는 길. 뜻은 아래 사람 원문 | 문서화 session 결정(docs-review 9장) |

앱 화면 상태의 뜻(사람 원문 그대로): "사용자가 코딩 테스트 앱을 만들었다쳐 / 그럼 desktop app renderer가 가지고 있는 app context 따위의 것들이 있잖아 / 예를 들면, attempt 몇 번째 이고 그 attempt에 해당하는 code (text area) , 또 아니면 문제 같은 것들을 / operator context로 쉽게 보내는 길을 열어둔다는 거야 coding agnet가 개발하기 쉽게끔 capability로 둔다는거지"

## 3. 사람 말 없이 lead 추천대로 간 것

이런 옛 요구는 `ask`로 둔다.

- ~~승인에 "Always allow"(항상 허락)를 두지 않는다~~ → 바뀜: approval을 정하며 선택지에 "항상"(그 grant를 묻지 않음으로 바꿈)을 두었다(docs-review 12장, req-0317). 옛 출처: AR "결정: 미결사항 답"의 "2의 나머지 … 사람이 다른 말을 하지 않아 lead 추천대로 간다".
- agent를 부르는 toast의 사건 종류 목록. 출처는 같다.

## 4. 바뀐 모델

옛 요구가 이것과 부딪히면 `drop-conflict`다.

- **문서:** 문서는 project 폴더 안의 파일뿐이다. lophn은 사람이 고친 문서의 이력을 남기지 않는다(git 몫).
- **되돌리기:** agent session이 살아 있는 동안만 된다. session 안의 시점으로 대화와 그 session에서 agent가 바꾼 파일을 되돌린다.
- **context:**
  - project 하나에 속하고 여러 개일 수 있다. 결정적 계약과 검색 script로 이루어진다.
  - 위반은 program이 감지해 toast로 알린다. 위반 근거를 붙인 채 Context Engineer에게 바로 넘긴다.
  - coding agent와는 상관없다.
- **coding agent:** lophn에서 앱 개발과 앱 고치기만 한다.
- **agent:**
  - place(project 또는 앱)에 놓인다. 정의는 lophn data 안 place별 폴더에 있다.
  - Operator는 place의 일을 하는 agent이고 주기와 상관없다.
  - Context Engineer는 전체에 하나다.
  - project 지침은 project 폴더의 LOPHN.md이고, lophn agent는 AGENTS.md를 읽지 않는다.
  - 설정(skill, MCP, 지침, model)은 전역, project, Operator 층에서 정한다.
  - model은 agent 설정에서 정하고 provider 연결과 상관없다. provider마다 연결은 하나다.
- **agent 부르기:**
  - project에서는 sidebar와 toast에서 부르고, 앱 공간에서는 title bar의 agent select와 toast에서 부른다.
  - agent를 부르는 toast는 lophn이 결정적으로 판정할 수 있는 사건에서만 뜬다. 문서 내용을 해석하지 않는다.
- **화면:**
  - Lophn Workspace는 project 화면과 따로인 page이고, project 관심사가 없다.
  - project 화면의 화면들은 탭이다(문서, 터미널, 앱 패널, Agent, Context, 검색, Agents).
  - notice는 layout 자리를 차지하지 않고 toast처럼 뜬다.
- **skill:** 전역과 project에서 꺼짐 표시로 끈다. 바꾼 skill은 다음 run부터 쓰인다.
- **ticket·claim(장기 방향):**
  - ticket과 claim은 남는다.
  - MVP 이후에는 사람이 coding agent와 직접 이야기하지 않는다.
  - App Engineer가 coding agent에게 ticket으로 일을 맡기고, 끝나면 검증해서 사람에게 올린다. App Engineer가 앱 개발에 관한 사람의 유일한 interface다.
  - claim은 이 흐름의 event를 정하는 장치다.
