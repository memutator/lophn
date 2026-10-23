# domain: project와 app 안의 책임 경계

상태: 로드맵. 2026-10-19 사람과 planner가 정했다. 앞 계획 넷(`domain-kinds`, `domain-tools`, `domain-place`, `artifact`)과 `rewind-check`가 land했다. 그 뒤 사람이 모양을 다시 정했고(아래 "모양") 계획 `domain-entity`가 그 모양으로 land했다(`architecture/domain.md`).
지금 코드에 있는 것은 architecture 문서가 적는다: `kinds.md`(kind 파일, 내장 tool), `app-call.md`(tool 선언, `app.call_tool`, coding agent MCP), `artifact.md`, `place-session.md`, `agent-definition.md`, `activation.md`(rewind 증명). 이 문서는 모양과 남은 일만 적는다. 옛 초안(context를 지우기까지의 지금 코드, 바꾼 이유, 대응표)은 git 기록에 있다.

## 왜

- **context가 모호했다.** 이름 하나에 다섯 가지 일(문서 지도, entity DB와 query DSL, lint, 용어집, 앱 data 끌어오기)이 섞여 있어, 사람도 harness도 언제 무엇에 쓰는지 몰랐다.
- **앱의 업무 객체가 모델 밖에 있었다.** context는 project 문서에만 있었고, 앱의 Expense나 Note는 앱 코드 안에만 있었다.
- **경계를 넘는 길이 여럿이었다.** project 범위 app-api, 앱 단위 grant, context의 app-data source가 따로 있었다.

## 모양

### 그릇과 domain

| | project | app | domain |
|---|---|---|---|
| 무엇 | 폴더 작업 공간(저장소 하나 같은 것) | software 작업 공간 | 업무의 뜻과 책임의 경계 |
| 가진 것 | 폴더, project 창, terminal, `LOPHN.md` | source, data(sqlite), release, 화면, app space, coding terminal | kind 파일, `DOMAIN.md`, skill, artifact, tool(앱 domain) |
| 경계인가 | 아니다. 그릇이다 | 아니다. 그릇이다 | 그렇다 |

- **domain은 그릇 하나에 속한다(1:N).** project나 app 하나에 속하고, 그 그릇에는 domain이 여럿 있을 수 있다.
  - 예: lophn 저장소(project)에는 eval, product, plan domain이 있다. 가계부 app에는 지출, 예산 domain이 있다.
- **다른 그릇의 domain은 참조한다.** 공개 tool을 grant 받아 쓴다. 같은 domain을 다른 그릇에 또 만들지 않는다.
- **모든 app은 domain을 하나 이상 가진다.** 메모 앱에도 Note가 있다. 앱을 만들면 앱 이름의 domain이 하나 생긴다. project는 domain이 0개여도 된다(폴더와 coding만 쓰는 project).
- **최소 context는 domain이 지킨다.**
  - prompt에는 그 agent가 맡은 domain의 `DOMAIN.md`, kind, skill만 싣는다.
  - tool 목록에는 그 domain의 tool과, grant 받은 다른 domain의 공개 tool만 싣는다.
  - file 권한은 그릇 단위(폴더)다. 같은 그릇 안의 다른 파일을 읽을 수 있는 것은 막을 대상이 아니다. 사람은 공격자가 아니고, 막을 것은 agent의 실수다. 폴더 경계와 rewind가 그것을 막는다.

### role과 place (예전 그대로)

| role | 놓이는 곳 | 맡는 것 |
|---|---|---|
| lophn | 전체에 하나 | 기획, project·app 만들기, 경계를 넘는 판단(새 domain, 나누기와 합치기 제안, 재사용, package로 빼기). domain들의 공개 면 지도만 본다 |
| Project Manager | project마다 하나 | 그 project의 domain을 만들고 고친다(kind 파일, `DOMAIN.md`, skill, artifact). project Operator를 만든다 |
| App Engineer | app마다 하나 | 앱 코드(설계, 구현, 선언, release, package)와 그 app의 domain을 맡는다 |
| Operator | project나 app에 여럿 | 그 그릇에서 일한다. 정의에서 domain을 고른다(고르지 않으면 그릇의 domain 전부). skill은 고른 domain의 것 가운데서 고른다 |
| coding agent | 바깥 harness | App Engineer가 맡기는 흐름은 막혀 있다(`problem-ticket.md`). terminal은 app space에 열린다 |

- place는 project 또는 app이다.
- 경계를 넘는 판단은 lophn이 한다. 경계를 자르는 결정은 사람이 한다.

### domain이 가진 것

| 것 | 모양 | 자리 |
|---|---|---|
| kind 파일 | `kinds.yaml`. 위치 glob(그릇의 폴더 기준)과 칸 schema. 판 없이 바뀔 때 검사한다. 앱 domain은 객체가 앱 data에 있어 대개 kind 없이 tool로 다룬다 | `<data>/domains/<dom>/kinds.yaml` |
| 글 | `DOMAIN.md`. 뜻, 쓰는 법, program이 검사하지 못하는 규칙. 맡은 agent가 file tool로 쓴다(Gate 없이, rewind로 되돌린다) | `<data>/domains/<dom>/DOMAIN.md` |
| skill | domain 안의 일 하나의 절차. 정형화하지 않은 지침이라 program이 파싱하지 않는다 | `<data>/domains/<dom>/skills/` |
| artifact | agent가 파일로 쓴 결과 문서(HTML과 data). 앱이 아니다 | `<data>/domains/<dom>/artifacts/<name>/` |
| tool | 앱 domain만. 앱의 tool 선언에 `domain` 칸을 두어, tool이 다루는 객체의 domain 것으로 적는다. 공개 여부(`public`)는 tool마다 둔다 | 앱의 선언 |

- **지침 층:** 전역 → 그릇의 `LOPHN.md`(project) → 맡은 domain의 `DOMAIN.md` → agent 정의 본문이다.
- **PM과 App Engineer의 prompt:** 자기 그릇의 domain을 모두 싣는다. 예산을 넘으면 이름과 한 줄만 싣는다.

### program이 맡는 것 (이미 있다)

- **kind 파일 검사와 index:** 내장 `kind.list`(조건, 정렬, 집계, `skipped`)와 `kind.check`, `file.outline`. 위반은 problem이다(`architecture/kinds.md`).
- **tool 호출:** Gate, write queue, invocation, changeset, rewind(`architecture/app-call.md`). coding agent는 MCP로 자기 앱 preview의 tool만 부른다.
- **domain 사이:** 공개 tool 거르기, 다른 domain이 쓰는 공개 tool을 지우는 release 막기, tool이 바뀌면 쓰는 쪽 깨우기, lophn 지도, package 주인. 단위는 "domain 사이"다(`architecture/domain.md`).
- **rewind 증명:** examples가 되돌리기를 증명하고, 못 하면 알린다(`architecture/activation.md`).

## 정한 것 (사람)

- context를 domain으로 바꾼다. 이름만이 아니라 모델을 바꾼다.
- domain은 책임과 최소 context를 위한 경계다. 전역 지식으로 동작하게 만들지 않는다.
- program의 책임을 0으로 만들지 않는다. 결정적으로 더 정확하고 싼 일은 program이 한다.
- domain operation을 추상화한 interface는 MCP tool이다. app-api 형식은 쓰지 않는다.
- core는 관측과 test를 자기가 아는 형식으로 받아 처리한다.
- skill은 정형화하지 않은 agent용 지침이다. 판단이 필요하면 맡은 agent에게 맡긴다.
- 경계를 넘는 판단은 lophn이 한다. 따로 Architect role을 두지 않는다.
- artifact는 lophn의 자리에 두고, role agent가 직접 쓴다. 앱과 artifact를 한 장치로 합치지 않는다. 앱은 앱이고, artifact는 agent가 쓴 결과 문서다. "live view"라는 말은 쓰지 않는다.
- 사람의 폴더가 없는 project(폴더 0개)도 등록할 수 있다.
- **(2026-10-19 다시 정함)** project와 app은 그릇이고 domain은 그 안에 1:N으로 있다. 다른 그릇의 domain은 참조한다.
- **(2026-10-19 다시 정함)** role 배분은 예전 그대로다: lophn, Project Manager(project마다), App Engineer(app마다), Operator, coding agent. place는 project 또는 app이다. 앞 계획 `domain-place`가 App Engineer를 PM에 합치고 app place를 없애고 앱을 project에 1:1로 묶은 것은 되돌린다.
- **(2026-10-19 다시 정함)** 모든 app은 domain을 하나 이상 가진다. 앱의 tool 선언에 그 tool의 domain을 적는다.
- 화면 말: "Project", "App", "Domain"이다. role 이름은 예전 그대로다.

## 정한 것 (agent)

- **domain을 만드는 쪽:** PM과 App Engineer가 자기 그릇 안에 만든다. 사람도 만들 수 있다. 그릇 안에 만드는 것이라 file 권한이 넓어지지 않는다.
- **domain id는 `dom_`이다.** domain은 `{owner: project | app}` 하나에 속한다. 그릇을 옮기는 길은 두지 않는다(미리 만들지 않는다).
- **Operator 정의:** `domains`(고른 domain 목록, 비면 그릇의 전부)와 `skills`(고른 skill, 비면 고른 domain의 전부)를 둔다.
- **artifact 신원:** `{domain, name}`이다.
- **annotation:** 앱 화면 annotation은 App Engineer가, artifact annotation은 그 폴더에 마지막으로 쓴 session(없으면 그 domain 그릇의 PM이나 App Engineer)이 받는다.
- **판은 코드 release 하나다.** kind 파일은 판 없이 바뀔 때 검사해 쓴다.
- **호환 장치를 두지 않는다.** 개발 data는 새로 만든다.

## 남은 일

- 계획 `domain-entity`는 land했다: domain entity를 두고, `domain-place`가 합친 것을 되돌리고, domain 단위로 맞췄다(changelog `0.5.0`).
- 계획 `test-restore`가 e2e와 eval을 새 설계로 되살렸다. land는 다시 e2e를 돈다.
- **그 뒤:** 바꾼 eval 시나리오를 진짜 model로 한 번씩 돌린다(changelog `0.5.0` 후속).
- **필요해지면:**
  - artifact를 화면에서 지우기(`roadmap/artifact.md`)
  - app-preview(보류, `roadmap/app-preview.md`)

## 하지 않는 것

- lophn 밖 MCP client 연결. 연결 인증과 grant 화면을 설계한 뒤 연다.
- MCP `resources`와 `prompts`
- domain을 저절로 나누거나 합치기. program은 신호만 내고 제안은 lophn이, 결정은 사람이 한다.
- domain마다 재료 path 목록. 그릇의 폴더가 file 범위다.
