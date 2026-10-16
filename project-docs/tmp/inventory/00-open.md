# 구현 전수 목록: 열린 것 (2026-10-15)

영역 파일 열두 개(01-event ~ 12-sdk-ui-design)의 "문서끼리 어긋난 것", "다른 영역에 넘긴 것", "확인 못함", 11의 "아직 정하지 않은 것", 12의 "아직 정하지 않은 것"과 "그대로 둘 후보", 그리고 항목 줄 안의 단서("정해야 한다", "문서에 없다", "확인 못함" 등)를 모아 정리했다.

읽는 법:
- 1장은 어느 문서에도 답이 없는 것만 올렸다. 영역 worker의 추천이 있으면 그대로 옮겼고, 없으면 비웠다. 같은 물음이 여러 영역에서 나오면 하나로 합치고 영역 번호를 모두 적었다.
- 2장은 이미 결정이 있는데 문서가 낡거나 어긋난 것이다. 실제 문서를 열어 지금도 그 줄이 그대로인지 확인했다. 오늘 lead가 이미 고친 것은 2.6에 모았다.
- 3장은 영역 사이 넘김이 겹치거나 빠진 것, 4장은 코드의 규칙 위반과 죽은 코드다. 영역 파일에 적힌 것만 옮겼다.
- 5장은 위 넷에 들지 않는, 코드를 더 읽어야 아는 "확인 못함"이다(형식에 없는 장을 하나 더했다).
- 영역 파일의 줄 번호는 `NN-파일:줄`로 적었다. 요구와 spec은 ID와 장 번호로 적었다.
- 테스트는 사람 지시(docs-review 2026-10-15 "13은 제외")로 전부 다시 쓰는 대상이다. 그래서 테스트 항목을 따로 세지 않았다.

## 1. 사람이 정할 것

### 1.1 process 구성

| # | 물음 | 선택지 | 영역 worker의 추천 | 근거(영역 파일과 spec·요구) |
|---|---|---|---|---|
| 1 | Router가 core process에 사나, agent-runtime process에 사나 | core / agent-runtime | | 03 확인 못함, 11 아직 정하지 않은 것 1과 process 표. S3·S1 3장은 "core"라고만 씀. Router 입력(사람 메시지, call, reaction)은 core에서 생기고 run-loop 입력함은 agent-runtime에 있음 |
| 2 | agent-runtime의 run-loop가 내는 agent event를 core의 Bus로 넘기는 길 | 감독 pipe / loopback API (공유 메모리는 없음) | | 11 아직 정하지 않은 것 2. Bus는 core 메모리, run-loop는 다른 process. S1 3장 |
| 3 | Gate를 어느 process에서 부르고, 입력인 grant 읽기를 어디서 하나 | Reactor handler(core)·Router(core)·run-loop(agent-runtime)에서 각각 부름 / 한 곳으로 모음 | | 11 아직 정하지 않은 것 3. Gate는 IO 없는 함수라 계산은 어디서든 되나 grant 읽기 위치가 비어 있음. S2 |
| 4 | lophn session의 입력함(Router 입력)을 durable로 두나 메모리로 두나. 꺼졌다 켜진 뒤 대기 입력이 남나. `runs` 표(accepted, running, waiting_user, finished 등)를 turn 단위로 남기나 | durable(표) / 메모리 | | 03 확인 못함 1, 11 아직 정하지 않은 것 4. S3 10장("durable queue, stall 감시, orphan 회수를 한꺼번에 만들지 않는다")과 S1 13장("agent event의 저장과 replay 안 함")이 이 결정을 안 함. coding agent 입력만 "버려진다"가 명시됨(S1 10장) |
| 5 | file(read·write·edit·glob·grep)·shell·web tool을 어느 process에서 돌리나. agent-runtime의 Deno 권한 목록(읽기는 data root·skill 폴더, 실행은 등록 MCP stdio, network는 정확한 host:port)을 넓히나 | 같은 process에서 권한을 넓힘 / 권한이 넓은 별도 process / core가 대신 실행 | | 04 고칠 것·확인 못함, 11 아직 정하지 않은 것 5. S4 3장(sandbox도 Gate도 없음). shell을 child 안에서 돌리면 `allow_run`·`allow_read`·`allow_write`·`allow_net`·`allow_env`가 모두 달라짐. 환경 변수에 token과 secret을 넣지 않는 규칙은 띄우는 쪽이 지켜야 함 |
| 6 | harness adapter가 도는 process, 그리고 Router가 PTY에 입력을 넣는 길(core → shell main → terminal-host)의 모양 | (문서에 선택지 없음) | | 11 아직 정하지 않은 것 6과 process 표, 06 확인 못함. hook은 CLI → core loopback(S6 4장) |
| 7 | core가 앱 process로 호출을 보내는 transport | 기존 supervisor 제어 pipe의 op / 앱 socket을 core·supervisor 전용으로 남김 | | 05 확인 못함 2("구현 선택으로 보고 둘 다 열어 둠"), 11 process 표. S5 4장 |
| 8 | 앱 화면 byte(`/screens`)를 내주는 길. 직접 통로를 지우면 지금 서명 연결로 읽는 길이 갈 곳이 없음 | core가 bundle 사본을 내줌 / supervisor가 앱 process를 거쳐 내줌 | | 05 확인 못함 1·고칠 것(shell main의 view 연결 `AppBinding`). S5·S2·S6 어디에도 없음 |
| 9 | secret 파일을 읽고 쓰는 process | I/O worker에 남김 / core가 직접 | | 11 아직 정하지 않은 것 7. 값은 이미 core 보호 메모리에 올라 있음 |
| 10 | req-0250의 "사용자 코드가 도는 child"에 coding agent TUI·CLI를 넣나. coding agent는 session token을 환경 변수로 받음(req-1052) | 넣음 / 안 넣음(사람 터미널의 process) | | 11 덜어낼·고칠 것(감독 줄)과 확인 못함. S6 3장은 coding agent를 사람 터미널의 process로 봄 |

### 1.2 event 전달

| # | 물음 | 선택지 | 영역 worker의 추천 | 근거(영역 파일과 spec·요구) |
|---|---|---|---|---|
| 11 | event 구독 WebSocket을 renderer가 직접 여나, shell main이 중계하나 | renderer 직접 / main 중계 | | S1 3장 Gateway "renderer의 WebSocket"과 token이 main에만 있는 현실(`preload/core-api.ts` 머리 주석)이 어긋남. 01 어긋난 것 4·확인 못함, 09 확인 못함 6(고칠 것 첫 줄은 어느 쪽이든 같은 일이라 안 갈랐음), 11 process 표 |
| 12 | Gateway에 누가 붙나(사람 token만인지), 한 번에 몇 연결인지, 자격을 연결 때만 보나 보낼 때마다 보나 | (문서에 선택지 없음) | | 01 확인 못함, 11 고칠 것(server 줄, 연결 수 한도 `EVENT_CONNECTION_*`는 확인 못함). req-0211("모든 호출에 token")은 구독도 포함하나 S1 3장은 누구에게 열리는지 안 적음 |
| 13 | 느린 구독자 처리(지금은 1MB 넘으면 1013으로 끊음)를 Bus에서 어떻게 이을지 | (문서에 선택지 없음) | | 01 확인 못함. S1 3·4장 |
| 14 | agent event를 저장하지 않으니 trace(호출별 사용량·비용, 관측)를 어디에 남기나 | (문서에 선택지 없음) | | 01 고칠 것(트레이스 읽기·내보내기)과 확인 못함, 03 덜어낼·고칠 것(`handoff_links`), changes-by-topic 7장 열린 물음 "trace 저장". S1 6장·13장 |
| 15 | session 상태(running ↔ waiting ↔ idle) 전이 표. 어떤 event가 상태를 바꾸는지 | (문서에 선택지 없음) | | 01 어긋난 것 6. S1 8장 구독 표가 "모든 session의 상태를 바꾸는 event"를 조건으로 쓰는데 6장은 "core가 계산한다"만 적음 |
| 16 | file-tracking의 깨움 신호(`feed.ts`가 `Project*`·`Document*`·`ContextViolationsRecorded`를 신호로 씀)를 어떻게 받나 | 남지 않는 event / command 안에서 직접 호출 | 01: 직접 호출(같은 core 안이라 event가 필요 없다). 10이 file-tracking을 통째로 지우면 이 물음 자체가 사라짐 | 01 확인 못함·고칠 것(internal subscription 구독자 여섯의 대체 4번), 10 덜어낼 것(file-tracking). domain event 10개에 이 event들이 없음(S1 5장) |
| 17 | 앱 화면이 앱 data 바뀜과 activation(release 바뀜)을 알고 다시 그리는 신호. 지금 `refreshAppViews`가 읽던 `GrantCreated/GrantRevoked/ReleaseActivated` ledger event가 사라짐. rewind도 domain event가 필요한가 | 남지 않는 event / 다른 신호 | | 01 고칠 것·확인 못함·넘김, 05 확인 못함("rewind 요구가 domain event를 필요로 하는지"), 07 넘김. S1 7장은 "S5에서 정한다"고 했으나 S5에 없음 |

### 1.3 agent call

| # | 물음 | 선택지 | 영역 worker의 추천 | 근거(영역 파일과 spec·요구) |
|---|---|---|---|---|
| 18 | 코드의 `run` 이름(`runs` 표, `Run*` event, invocation 칸 `run`·`tool_call`)을 turn으로 어디까지 바꾸나. S1 12장 "ledger에 쓰는 `Run*` event를 지운다"와 함께 정해야 함 | (문서에 선택지 없음) | | 03 어긋난 것 6, 05 어긋난 것 9, 04 어긋난 것(S4 8장 부품 표). S4 1장은 "요구의 run은 S1의 turn"이라고만 함. 이름 바꾸기는 refactor 몫 |
| 19 | call과 사람 메시지가 한 session 입력함에 함께 쌓였을 때 순서(사람 먼저인지 접수 순서인지). 지금 코드는 사람 요청이 먼저(tier 1), 8개 연속 뒤 양보(`YIELD_AFTER`) | 사람 먼저(지금) / 접수 순서 | | 03 고칠 것(줄 서기와 선택)·확인 못함. S3·S1에 순서 규칙이 없음 |
| 20 | 앱 줄(req-1516)에 서 있는 coding call을 lophn이 꺼졌다 켜진 뒤 어떻게 하나, 그 줄을 메모리에 두나 표에 두나 | 메모리(사라지고 `agent_calls`에는 accepted로 남음) / 표 | | 03 확인 못함, 06 새로 만들기·확인 못함. S3 10장·S1 10장에 줄 복구 규칙 없음 |
| 21 | 사람이 steer를 고르는 UI 모양(select, 단축키 등). 도는 중에 Send 대신 Stop이 있고 Enter로만 보내는 지금 composer 모양이 이미 맞을 수 있음 | (문서에 선택지 없음) | | 03 확인 못함·UI 고칠 것, req-1509는 동작만 정함 |
| 22 | 사람이 call을 취소하는 단추의 위치 | (문서에 선택지 없음) | | 03 확인 못함. req-1503은 사람의 취소를 허용하나 S3 5장 "화면"에 취소 얘기가 없음 |
| 23 | `mode: correction` → steer로 이름을 바꾸고, 기본(다음 turn)을 `request`라는 값으로 둘 이유가 있나 | (문서에 선택지 없음) | | 03 고칠 것(mode 줄). 기본은 이미 다음 turn으로 동작 |

### 1.4 approval 밖의 사람 결정

| # | 물음 | 선택지 | 영역 worker의 추천 | 근거(영역 파일과 spec·요구) |
|---|---|---|---|---|
| 24 | 일회 confirmation handle(route의 `confirmation: "required"`, core의 handle 표, main의 `confirmation_handle_register`)을 두나. approval 두 route 말고도 12개 route(`grant.revoke`, coding agent 연결 회수, 파일 삭제, 문제 닫기, secret 둘, rewind, provider 둘, 질문 선택지 action)가 씀 | 유지(창 없이 카드 클릭에서 발급) / 없앰 | 02: 사람 자격 증명 방법은 유지하고 창만 없앤다(handle은 카드 클릭에서 main이 발급) | 02 확인 못함. 새 문서에는 "사람 자격의 결정 command로만 결정한다(req-0303)"만 있음 |
| 25 | approval이 아닌 사람 결정(문제 결정, 연결 회수, rewind, provider 연결, 질문 선택지 action, 파일 삭제)을 별도 확인 창이 없어지면 어디서 받나. 앱 rewind 확인 화면(고른 invocation부터 최신까지 목록)은 새 kind의 확인 창인가 Activity 탭 안 panel인가 | (문서에 선택지 없음) | | 02 어긋난 것 3·확인 못함, 05 UI 새로 만들기(앱 rewind 확인 화면), 07 UI 덜어낼 것(problem-decision 확인 창), 09 새로 만들기. changes-by-topic 3장 shell/confirmation-window는 approval 쪽만 정함 |
| 26 | 보호 입력(secret 값을 renderer 밖에서 받는 입력, req-0019·0401)의 모양. 확인 창이 없어지면 보호 입력만 남는 창인가 다른 방식인가. 원문이 renderer나 agent 대화에 보이면 안 됨 | 창 없이 보호 입력만 남김(목록은 이렇게만 적음) / 다른 방식 | | 09 확인 못함 1, 02 확인 못함, 08 UI 새로 만들기, 11 UI 새로 만들기·확인 못함(`secret_export`·`secret_import` kind가 있는지) |
| 27 | 문제의 해결됨·무시 단추를 확인 없이 누르게 하나 | (문서에 선택지 없음) | | 07 UI 고칠 것(문제 상태 바꾸기). S2 6장 표에 문제 항목이 없고 보류 request도 확인 창도 정해지지 않음. req-0154 |
| 28 | 모든 session의 대기 요청(권한, 질문, 보류 허락)을 보이는 "한 목록"이 어느 화면인가 | Workspace 화면 / 접이식 panel / 창 위 pill | | 09 어긋난 것 4. terms.md는 Things to confirm을 "쓰지 않음(보류)"로 두고 req-1498은 한 목록을 요구. 지금 Things to confirm 화면 위치를 02가 그대로 쓴다고 봤음 |
| 29 | 대기 중인 activation 허락 request를 앱 상세(versions 탭 근처)에서도 볼 수 있어야 하나 | (문서에 선택지 없음) | | 02 UI 새로 만들기. req-1498 |

### 1.5 agent grant

| # | 물음 | 선택지 | 영역 worker의 추천 | 근거(영역 파일과 spec·요구) |
|---|---|---|---|---|
| 30 | agent grant를 어디에 저장하고 무엇을 key로 하나. agent는 role 고정 agent(lophn 하나, Project Manager는 project마다, App Engineer는 앱마다)와 사람이 만드는 Operator 여럿 | agent 정의 파일(frontmatter) / 표. key는 agent ID / role + place | | 02 확인 못함. S2 7장은 Grants가 주인이라 하나 지금 코드 `apps/permissions`는 앱 단위. S4와 S2 어디에도 없음 |
| 31 | app-api별 override("빼기", "묻는지 바꾸기")를 app-api key로 저장하는 구조. release가 바뀌어 app-api가 사라졌을 때 override를 어떻게 하나 | (문서에 선택지 없음) | | 02 확인 못함. S2 4장·11장 5 |
| 32 | 설정 고치기로 보는 "지침 파일"이 정확히 어떤 경로인가(LOPHN.md, agent 정의 파일, skill 파일 등). file tool 쓰기는 Gate를 거치지 않는데 이 경우만 거침 | (문서에 선택지 없음) | | 02 어긋난 것 4·5, 08 어긋난 것, 04 넘김. S2 5장 마지막, S4 3장·11장 1(설정 고치기 tool은 보류). req-1493·AGENT-ROLE은 설정 고치기를 grant 대상으로 씀. 지금 실제로 Gate에 걸리는 설정 고치기는 file tool의 지침 파일 쓰기 하나뿐 |
| 33 | 보류 request의 종류(`activation`, `reaction`) handler 계약(입력, 멱등 key, 적용 결과 칸), 그리고 `PermissionRequested`의 payload(대상, 정규화한 입력, 효과, harness가 준 물음의 원문) | (문서에 선택지 없음) | | 02 확인 못함. S1이 이름만 정함 |
| 34 | 앱 상세에서 agent에게 앱을 할당하는 길을 두나, agent 상세·목록(`workspace/agent`, `agents-tab`)에 권한 요약을 보이나 | (문서에 선택지 없음) | | 02 확인 못함·UI 고칠 것·새로 만들기(할당 화면 위치가 이에 달림). req-1493 |
| 35 | 앱이 바깥 자원과 다른 앱에 쓸 수 있는 범위를 보고 거두는 화면(지금 `app-detail/access`·`connections`)을 두나, 둔다면 어디 | (문서에 선택지 없음) | | 09 확인 못함 5, 02. S2 4장("거두면 새 호출부터 막힌다")·req-0873. shell.yaml에 화면 요구가 없음 |

### 1.6 agent 정의와 tool

| # | 물음 | 선택지 | 영역 worker의 추천 | 근거(영역 파일과 spec·요구) |
|---|---|---|---|---|
| 36 | 전역 층 model이 있나, 있다면 role별인가 하나인가. composer에서 session 단위로 model을 고르는 `session` 층(`ResolveInput.session_model`)을 유지하나 | role별 / 하나 / 없음 | | 04 어긋난 것·확인 못함·고칠 것, 04 UI 고칠 것(Models 구역). S4 2장 model 줄, req-0038·0039, req-0360(rejected) |
| 37 | built-in agent(App Engineer, Project Manager)도 agent 지침(Operator 층)을 갖나 | (문서에 선택지 없음) | | 04 어긋난 것. S4 2장 설정 층은 전역·project·agent(Operator), 5장 지침 층은 built-in에도 "agent 지침"을 둠. req-0038은 "Operator 층"만 씀 |
| 38 | skill 등록 폴더(`lophn-agent.extensions.skill_folders`)와 개인 보관소(`<data root>/skills`)를 유지하나 | (문서에 선택지 없음) | | 04 확인 못함. 요구에 없음 |
| 39 | 앱 place의 skill 폴더(`<data root>/apps/<앱>/skills`)와 앱 place의 MCP 서버(`ChangePlaceExtensionSettings`가 project와 app 둘 다 받음)를 새 층(전역/project/agent)에서 어떻게 하나 | (문서에 선택지 없음) | | 04 확인 못함 |
| 40 | 내장 skill 목록: 어떤 skill이 있고 어느 것이 끌 수 있는지 | (문서에 선택지 없음) | | 04 새로 만들기. S4 2장·11장 8은 flag만 정하고 목록은 안 정함. 지금 `assets/skills`가 없음. req-0098 |
| 41 | file·shell·web tool의 정확한 철자(`file.glob`·`file.grep`처럼 `<자원>.<동사>` 꼴을 따르는지) | (문서에 선택지 없음) | | 04 새로 만들기·확인 못함. S4 3장의 이름("glob, grep, shell, web search·fetch")과 4장 꼴이 같지 않음 |
| 42 | S4 4장 표에 없는 지금 tool(`project.list`, `project.read`, `app.health`, `app.invocations`, `app.commands`, `app.blueprint` 읽기, `context.overview`, `context.read_entity`, `glossary` 삭제, `series.next_name`)을 지울지 다른 tool에 합칠지 | 지움 / 합침 | | 04 덜어낼 것·고칠 것·확인 못함(근거 있는 것만 덜어낼 것에 넣음). S4 4장 |
| 43 | pdf를 읽는 라이브러리(`pdf.read`)와 이미지를 model에 싣는 provider 경로(`image` part). 이미지·pdf를 renderer에 넘기는 크기 한도와 통로 | (문서에 선택지 없음) | | 04 확인 못함, 10 확인 못함(pdf 본문 추출 의존이 어느 것인지, 한도와 통로), 08 확인 못함. 지금 adapters에 이미지 part가 없음. S4 3장 |
| 44 | 자동 compact를 언제 돌리나, `fork`·`recap`을 도는 turn 중에 부르면 어떻게 되나 | (문서에 선택지 없음) | | 04 확인 못함. S4 6장은 compact 방식만, 7장은 "다음 turn" |
| 45 | 질문 카드 Skip(`DeferQuestionGroup`)을 새 설계에서 어떻게 하나 | 새 outcome `cancelled`로 대신 / 없앰 | 04: 새 outcome `cancelled`로 대신 | 04 확인 못함·UI 덜어낼 것. S4 3장 사람에게 묻기(기한 없음, 고정 action 없음) |
| 46 | deferred로 두는 token 문턱을 어떻게 세나 | (문서에 선택지 없음) | | 04 확인 못함. S4는 "session을 시작할 때 고정"만 말함 |
| 47 | 동적 화면 context(탭 목록, 포커스, 앱 요약)가 S4 6장의 "넣지 않는 것: 앱 화면의 상태"에 드나. 탭 단위 현재 보기(열린 탭, 선택한 문서 절·줄)를 core로 relay하는 길(`main/workspace/current-view.ts` 등)을 지우나 | 지움 / 남김 | 04: 지운다 | 04 덜어낼 것(`turn-context.ts`)·확인 못함, 09 덜어낼 것·확인 못함 2. S4 6장, removed.md 2장 |
| 48 | 앱 place Operator의 file 범위(사람이 정한 project 폴더)를 가리키는 칸을 agent 정의에 어떻게 두나. 지금 `contexts`는 project Operator만, `app_reads`는 앱 Operator만 | (문서에 선택지 없음) | | 04 고칠 것. S4 3장 file 줄, S8 9장 3·4, AGENT-ROLE O2·O3 |
| 49 | 전역·앱 층 지침 편집(전역 LOPHN.md 같은 것)을 두나 | (문서에 선택지 없음) | | 10 확인 못함(UI). docs-review "확인할 것", changes-by-topic 7장. 새 요구는 project `LOPHN.md`와 agent 설정 화면(req-0095)만 말함 |

### 1.7 앱 호출과 rewind

| # | 물음 | 선택지 | 영역 worker의 추천 | 근거(영역 파일과 spec·요구) |
|---|---|---|---|---|
| 50 | 앱 사이 호출의 write queue 교착(A의 write가 B의 write를 부르는 동안 B의 write가 A의 write를 부름)을 어떻게 하나 | (문서에 선택지 없음) | | 05 확인 못함. req-0924의 호출 루프 거절은 같은 호출 사슬 안에서만 막음. S5 6장 |
| 51 | changeset 저장 위치(ledger BLOB / blob store)와 크기·개수 한도. 한 release 안에서는 지우지 않으므로 자람 | ledger BLOB / blob store | | 05 새로 만들기·확인 못함. changes-by-topic 7장 "blob-store 남는 쓰임" 질문의 답일 수 있음. S5 6장 |
| 52 | PRIMARY KEY가 없는 표의 변경은 SQLite session이 기록하지 않아 rewind에서 조용히 빠짐. 막을지 알릴지 | (문서에 선택지 없음) | | 05 확인 못함. S5에 언급 없음. 잡아 주는 것은 req-0821 app test뿐 |
| 53 | 앱 시작 invocation의 changeset 범위(시작 중 DB를 바꾸는 앱이 지금 있는지), 그리고 migration(DDL)이 rewind 대상이 아님을 명시하나 | (05는 DDL이라 대상이 아니라고 봄) | | 05 확인 못함. S5 6장, req-0893에는 시작 invocation이 없음 |
| 54 | core가 호출 중 죽어 changeset을 받지 못한 write를 어떻게 하나. 그 호출 뒤 rewind에서 그 변경이 안 되돌아가는 것을 어떻게 알리나 | (문서에 선택지 없음) | | 05 고칠 것(core 재시작 점검)·확인 못함. 지금 `restart.ts`는 unknown으로 닫음 |
| 55 | `system` 호출자와 `trigger` 종류(activation, restart)를 새 모양에서 남기나 | (문서에 선택지 없음) | | 05 덜어낼 것·확인 못함. S5 5장 표는 trigger 칸을 두지 않음 |
| 56 | 앱 process의 `request_key` 재조회·cancel·status(직접 client용)를 남기나. core가 "결과 모름"을 직접 다루면 필요 없음 | 남김 / 없앰 | | 05 덜어낼 것·고칠 것(agent의 app-api tool 실행) |
| 57 | `command` → `app-api` 이름 바꾸기를 코드에서 어디까지 하나(`commands`, `app_commands`, `CommandDeclaration`, `app_`로 시작하는 tool 이름, blueprint JSON 칸 이름까지) | (문서에 선택지 없음) | | 05 고칠 것·확인 못함. docs-review "app-api로 바꾸자", terms.md |
| 58 | 앱이 project 목록을 읽는 SDK client의 이름(`cap-project` 꼴인지)과 package 이름 규칙(`cap-schedule`, `cap-store`), 앱 화면이 어느 project로 열렸는지 읽는 길, 고르는 UI를 SDK UI에 둘지 shell(앱 place)에 둘지 | (아래 추천 참조) | 12: 목록 읽기는 `cap-project` 꼴의 client 하나, "현재 project"는 같은 client가 view bridge(`lophnApp`)에서 읽는다. 고르는 UI는 shell(앱 place)이 맡고 SDK UI에는 두지 않는다 | 12 아직 정하지 않은 것 4, 05 확인 못함·UI 새로 만들기(앱 place에서 project 고르기), 12 UI 새로 만들기. req-1511·1515. architecture.md 이름 규칙은 05가 안 읽음 |
| 59 | 앱 view 위(`view-chrome.tsx`, `app-bar.tsx`)에 현재 project를 보이나 | (문서에 선택지 없음) | | 05 UI 새로 만들기, 12 UI 새로 만들기. req-1515 |

### 1.8 coding agent

| # | 물음 | 선택지 | 영역 worker의 추천 | 근거(영역 파일과 spec·요구) |
|---|---|---|---|---|
| 60 | harness adapter의 코드 위치와 core의 import 방향. S6 3장은 adapter를 `packages/coding-agent/`에 두고 Router(core)가 부르며 4장은 "core가 hook을 agent event로 바꾼다"고 하나, code-map상 core는 `protocol`·`base`만 import하고 `coding-agent`를 쓸 수 있는 곳은 shell main의 terminal host뿐 | 변환 표와 launch 계획의 순수 값을 `protocol`로 옮김 / adapter를 core에 둘 수 있게 code-map을 고침 | | 06 어긋난 것 1. spec에 없음 |
| 61 | coding agent의 권한 mode. S6 2장 4는 lophn이 정하지 않는다고 하나, docs-review("CLI와 MCP" 절)는 읽기 명령 자동 허락을 harness 허락 목록에 명령 이름으로 잡고 App Engineer가 띄울 때 넣는다고 하고 req-1219는 읽기·변경 이름 구별을 요구 | lophn이 정하지 않음(S6) / App Engineer가 띄울 때 허락 목록을 넣음(docs-review) | | 06 어긋난 것. S6 2장 4·9장 |
| 62 | 첫 prompt를 paste하는 "TUI 준비"를 화면을 읽어 짐작하지 않고 결정적으로 아는 법. 지금 `stdin_after_ready`는 PTY 출력에서 readiness 문자열을 찾음(OpenClaw만, readiness 값이 없어 시작하지 않음) | argv로만 넘김 / 준비 신호를 정함 | | 06 어긋난 것. S6 4장("TUI가 준비된 뒤 PTY에 paste")과 2장 1("화면을 읽어 짐작하지 않는다")이 부딪힘 |
| 63 | receipt(`integration/receipt.ts`, `<H>/integrations`)를 줄여서 남기나. req-1083은 "lophn이 마지막에 쓴 내용과 같을 때만 고치거나 지운다"를 요구하나 changes-by-topic은 receipt를 덜어낸다고 함 | 마지막에 쓴 내용(hash)만 기록해 남김 / 없앰 | | 06 어긋난 것 |
| 64 | Hermes·OpenClaw(hook이 없는 제품)의 `SessionStarted`를 누가 언제 내나 | PTY spawn 때 낸다 / 내지 않는다 | | 06 어긋난 것. S6 6장은 "hook이 session 시작을 알리면 `SessionStarted`" |
| 65 | pi의 turn 끝 신호가 `agent_end`(S6 4장)인가 `agent_settled`(지금 코드는 retry·compaction·queued continuation이 남을 수 있다며 `agent_settled`만 씀)인가. Codex는 `Stop`과 `notify` 가운데 무엇을 쓰나(catalog는 `Stop` hook뿐이고 `unverified`) | (조사로 확인) | | 06 어긋난 것. docs-review 마지막 단락도 pi 신호 이름을 인정 |
| 66 | coding token의 환경 변수 이름, token 형식, session ID와 principal(`coding_agent:<id>`) 대응 | (문서에 선택지 없음) | | 06 확인 못함. 설계는 "환경 변수"까지만 말함 |
| 67 | hook CLI 명령의 이름과 harness가 부르는 모양 | (문서에 선택지 없음) | | 06 새로 만들기. req-1517은 명령 이름을 안 정함 |
| 68 | skill 설치가 앱 source 폴더 밖(Hermes·OpenClaw는 사용자 전역)이어도 되나. skill 발견·trust gate 관측(`loading.ts`의 `trust_gates`, `skill_trust_note`)을 Settings에서 계속 보이나 | (문서에 선택지 없음) | | 06 확인 못함(06은 덜어낼 것으로 분류). S6에 없음. req-1054는 설치 실패만 말함 |
| 69 | 새 CLI에 `app list`·`app path`·`app validate`를 남기나 | (문서에 선택지 없음) | | 06 고칠 것·확인 못함(token이 앱 하나라 `list`·`path`가 필요한지, `validate`는 release 준비와 같은 route) |
| 70 | 터미널 탭이 project 화면에 열리나 앱 공간에 열리나, 열릴 때 focus를 자동으로 옮기나 | (문서에 선택지 없음) | | 06 확인 못함. req-0069는 project 화면의 탭을 말하고 앱 source 폴더는 project 밖일 수 있음 |
| 71 | 사람이 TUI에 직접 입력하는 중에 lophn이 PTY로 메시지를 넣을 때 섞이는 것 | (문서에 선택지 없음) | | 06 확인 못함. S6은 "idle일 때만 PTY 입력" |
| 72 | `ticket.create`를 사람(user)이 부를 수 있나. 지금 actors는 `user`·`agent`이고 Tasks 탭이 없어지면 사람 경로가 없음 | (문서에 선택지 없음) | | 06 확인 못함 |
| 73 | 수리 ticket 문제 예약(`ticket_open_repair_problems`가 문제 하나에 열린 수리 ticket 하나를 강제)을 남기나 | 남김 / 없앰 | | 06 덜어낼 것·확인 못함. req-0731(같은 앱의 문제 하나 이상)에 근거가 없음 |
| 74 | 실행 옵션(제품·옵션)을 call에서 어디에 담나 | (문서에 선택지 없음) | | 06 새로 만들기. S3 11장 2가 봉투의 `open` 칸을 뺌. req-1080 |

### 1.9 release

| # | 물음 | 선택지 | 영역 worker의 추천 | 근거(영역 파일과 spec·요구) |
|---|---|---|---|---|
| 75 | migration의 data 손실 단계를 어디에 선언하나 | migration 파일 머리 주석 / 별도 manifest / blueprint | | 07 확인 못함·고칠 것. S7 6장·req-1520은 "선언한다"까지. 지금 `dataChangesOf`는 `--` 주석 줄을 설명으로만 읽음 |
| 76 | `TicketVerified` 하나에 이은 release가 여럿일 때 고르는 규칙(가장 새 prepared release인지) | (문서에 선택지 없음) | | 07 새로 만들기·확인 못함. S7 5장 3. req-1507 |
| 77 | 한 앱에 activation이 이미 돌 때 줄(앱마다)을 메모리에 두나 domain event cursor로 두나 | 메모리 / domain event cursor | | 07 새로 만들기. S7 7장 1·11장 4 |
| 78 | 필수 검사 넷(선언·구현 일치, 의존, migration, 되돌림)과 지금 이름(`blueprint_handler_match`, `fixed_sdk`, `migration_empty`+`migration_upgrade`, `revert_restore`)의 대응. `migration_empty`·`migration_upgrade`를 하나로 세나 둘로 세나 | 하나 / 둘 | | 07 어긋난 것 4·5. req-0818은 "넷", acceptance와 req-0820·0821이 풀어 씀 |
| 79 | `adapter_isolation`·`read_contract`·`secret_grant`·`automation_scope`를 지우면 req-0193(network 없이 test DB로)을 강제하는 쪽이 어디에 남나 | (문서에 선택지 없음) | | 07 덜어낼 것·확인 못함 |
| 80 | 화면 test(offscreen host)를 앱 test에 계속 허용하나. 허용하면 `screen-host.ts` 등은 남음 | 허용 / 불허 | | 07 덜어낼 것·확인 못함. 필수 검사 넷에 화면 검사가 없음 |
| 81 | 무시 중(`ignored`)인 문제가 재발하면 다시 열리나 | 다시 엶 / 안 엶 | | 07 고칠 것·확인 못함. req-0168은 "해결됨"만 말함 |
| 82 | 문제의 발생 근거(snapshot)를 별도 표로 두나 발생(report)에 합치나 | 별도 표 / 합침 | | 07 고칠 것. req-0109 |
| 83 | migration 출발점 확인(`schema_changed`: 시작 때 박아 둔 `expected_schema`와 종료한 앱 DB의 실제 schema 비교)을 종료 뒤 실제 DB의 schema·무결성을 읽는 쪽으로 바꿔도 되나 | 시작 때 박아 두는 방식 유지 / 종료 뒤 읽는 쪽 | | 07 고칠 것. req-0828(rejected)과 안 맞음. req-0952·0960("무결성과 schema 확인") |
| 84 | activation 카드에 command·screen 변경까지 계속 보이나, "이전 안전 preview" 문단을 두나 | (문서에 선택지 없음) | | 07 덜어낼 것(`ReleaseComparison`)·UI 고칠 것 |
| 85 | Version 카드의 `prepared` 상태 문구를 "적용 대기(ticket 확인 전)"로 보이나 | (문서에 선택지 없음) | | 07 UI 고칠 것. req-1507·0830·S7 8장 |
| 86 | Data 탭을 통째로 지우나(Export 단추를 빼면 data 형식 번호 한 줄만 남음) | 지움 / 남김 | 07: 지움 | 07 UI 덜어낼 것 |
| 87 | [I tried it again] 단추(`report-again`)와 "다시 test해 본 결과를 재발로 받는 흐름"이 새 설계에도 필요한가 | 필요 / 불필요 | | 07 UI 덜어낼 것. 새 모델에 없음 |
| 88 | feedback dialog를 글만 보내는 dialog로 줄일 때(screenshot·화면 상태 첨부 제거) annotation(shell 기존 요구)과의 관계 | (문서에 선택지 없음) | | 07 덜어낼 것·UI 덜어낼 것. changes-by-topic problems/feedback, req-0172 |

### 1.10 session 수명

| # | 물음 | 선택지 | 영역 worker의 추천 | 근거(영역 파일과 spec·요구) |
|---|---|---|---|---|
| 89 | session을 archive하거나 지울 때 돌고 있는 turn을 어떻게 하나. 지금 지움은 끝나지 않은 run이 있으면 conflict로 거절 | turn을 interrupted로 닫음 / 끝나기를 기다림 / 거절 유지 | | 08 고칠 것·확인 못함. S8 3장 표에 없음. req-0045 |
| 90 | project나 앱을 보관(archive)하면 그 place의 Project Manager, App Engineer, Operator와 열린 session을 어떻게 하나. 지금은 보관 event로 assignment를 멈추고(`assignments/reactions.ts`), assignment를 지우면 이 동작이 같이 사라짐 | (문서에 선택지 없음) | | 08 확인 못함. S8과 요구에 없음 |
| 91 | call로 열린 session에서 checkpoint가 되는 첫 입력이 무엇이고, steer를 checkpoint에서 어떻게 보이나. 지금 `session/rewind/checkpoints.ts`는 사람 `request` 메시지만 checkpoint | (문서에 선택지 없음) | | 03 넘김(08로)·고칠 것(rewind 안내). 08에는 이 항목이 없음(3장 참조). S8 4장, req-1519 |
| 92 | fork(`⋯` 메뉴)가 마지막 확정 메시지까지 복사한 새 session을 같은 role·place의 새 탭으로 여는 지금 동작이 새 설계(S8 5장)에 맞나 | 그대로 / 바꿈 | | 08 UI 고칠 것(fork). 지금 코드는 숨긴 구간을 빼고 메시지만 복사해 S8 5장과 맞는 것으로 보이나 assignment 참조를 role·place로 바꿔야 함 |

### 1.11 문서와 편집기

| # | 물음 | 선택지 | 영역 worker의 추천 | 근거(영역 파일과 spec·요구) |
|---|---|---|---|---|
| 93 | 편집기가 파일을 읽고 쓰는 길: 지금은 shell main이 core의 `files.*` worker route를 부름. 새 설계의 file tool은 agent 쪽 | core의 경로 기반 route를 새로 만듦 / shell main이 직접 파일을 엶 | 08: core의 경로 기반 route를 새로 만드는 쪽으로 씀(가정) | 08 새로 만들기·확인 못함, 10 고칠 것(`files.*`). req-0001 |
| 94 | 외부에서 파일이 바뀌었을 때(다른 편집기, git) 열린 문서가 무엇을 하나: 변경 감지(watch)와 편집 중 충돌 안내를 두나. 지금 `files/watch`가 주는 `compared_version`·`state`(`version_pending` 등)는 file-tracking 관측에서 옴 | 안내 없이 다시 열면 보임(req-0001) / watch와 충돌 안내를 둠 | | 08 확인 못함·UI 고칠 것(외부 변경 충돌 화면), 10 확인 못함(UI). 요구에 문장 없음. `DiffView`가 `editor/conflict`에서 쓰이는 거취(12)가 이에 달림 |
| 95 | project의 `guide.list/get/outline/read`(설치 사용 안내를 format 추출 규약으로 읽는 route)를 남기나 | 남김(format 추출 의존을 손봄) / 지움 | | 08 확인 못함. `core/projects/outline-and-search/guides.ts`, `protocol/projects/guides.ts`. 어느 쪽이든 손봐야 함 |
| 96 | project의 `name`(slug)과 `title`을 둘 다 남기나 | 둘 다 / 하나 | | 10 고칠 것·확인 못함. req-1473은 "이름, 목적, 폴더, 폴더 설명". `name TEXT NOT NULL UNIQUE`가 문서 주소 이름 공간 때문이었음 |
| 97 | project 파일 검색(core-projects 요구)의 화면을 Documents 화면을 지운 뒤 어디에 두나. 새 Search 탭에서 키워드 검색과 context 검색(req-0017)을 한 화면에서 어떻게 나누나 | (문서에 선택지 없음) | | 09 확인 못함 4, 10 확인 못함(UI), 08 UI 새로 만들기(검색 탭). shell.yaml에 화면이 없음 |
| 98 | 문서 링크 `[[` 선택기를 파일 경로 링크로 유지하나 | 유지 / 지움 | | 10 확인 못함(UI) |
| 99 | md 목차 parser 둘(contexts의 md parser와 `sdk/ui-reading`의 `parseMarkdown`)을 합치나 | 합침 / 따로 둠 | | 12 그대로 둘 후보(projects 영역이 봄), 10 어긋난 것 8("두 parser가 아직 갈라져 있다"는 확인됨). req-1484·1485 |

### 1.12 context

| # | 물음 | 선택지 | 영역 worker의 추천 | 근거(영역 파일과 spec·요구) |
|---|---|---|---|---|
| 100 | 위반 toast를 누르면 어디로 가나. S1 5장은 `ContextViolationFound`가 Reactor를 거쳐 reaction grant가 열려 있으면 Project Manager 새 session을 이미 연다고 하는데, 8장은 toast를 누르면 그 위반을 붙여 Project Manager를 부른다고 함. 둘 다 열면 session이 둘 | 이미 열린 session으로 감 / 위반 목록이 열림 / reaction이 꺼졌을 때만 누르면 부름 | | 10 어긋난 것 1. req-0020(위반 목록이 열림), shell req-0083(글을 쓰지 않고 Project Manager session을 열 수 있음), AGENT-ROLE E5 |
| 101 | context를 새로 만드는 길: S4 4장 Project Manager 쓰기 tool에 `context.create`와 archive가 없음. `context.draft`가 첫 판과 함께 context도 만드나, 별도 create를 두나. 보관·되살리기 command를 agent tool로 두나 | `context.draft`가 만듦 / `context.create`를 둠 | | 04 어긋난 것, 10 어긋난 것 3·덜어낼 것(`context-engineer-tools.ts`의 `context.create`), 08. req-0004("한 project에 context를 둘 이상"), AGENT-ROLE C1 |
| 102 | 초안 판 폴더와 Project Manager의 file tool 범위. S4 4장은 초안 판을 "새 판의 초안 폴더"에 file tool로 쓴다고 하는데 S8 2장은 file tool 범위를 "그 project의 폴더"로 정함. 초안 폴더가 lophn data의 context 아래이면 범위 밖. req-0012도 pdf 목차를 "lophn data의 그 context 아래"에 둔다고 함 | 초안 폴더를 project 폴더 안에 둠 / 범위에 예외를 둠 | | 10 어긋난 것 4·고칠 것(초안 판의 저장 방식) |
| 103 | "새 위반" 판정을 개수 증가로 하나 집합 비교로 하나(고쳐진 위반 하나와 새 위반 하나가 한 scan에 겹치면 개수가 같음) | 개수 증가 / 집합 비교 | | 10 고칠 것(위반 알림 event). S1 5장 `ContextViolationFound`("새로 생김") |
| 104 | 보관한 context가 검색·위반 알림에서 빠지는 규칙을 유지하나(옛 contexts R4가 새 요구에 없고 지운 기록도 없음. 코드는 보관된 context를 건너뜀) | 유지 / 없앰 | 08: 그대로 두는 쪽으로 씀 | 08 확인 못함, 10 어긋난 것 12. changes-by-topic 7장 "확인할 것" |
| 105 | 만드는 중(drafting) context 화면(`context-drafting.tsx`의 "step n of 4"와 진행 표시, `contexts.status`의 `drafting`)이 새 설계에 남나 | 남김 / [New context]와 함께 지움 | | 08 UI 덜어낼 것·확인 못함, 10 확인 못함(UI). core-contexts에 drafting 상태 요구가 없음 |
| 106 | context 판 이력·되돌리기(req-0022)를 사람이 쓰는 화면을 두나. `rollback` command는 source에 있으나 화면이 부르지 않고 [History] 단추는 [Ask]의 별칭 | 화면을 둠 / [History]를 없앰 | | 10 확인 못함(UI) |
| 107 | Contexts 탭의 "쓰는 Operator 수" 표시를 유지하나 | 유지 / 지움 | | 10 확인 못함(UI) |
| 108 | 접힌 rail의 "Agent" 단추(lophn을 연다, `workspace.tsx` 698)와 `+` 메뉴의 Agents 항목을 지우나. removed.md 1장 "새 탭 메뉴의 Agent 항목"이 무엇을 지운 것인지 불분명 | 지움 / 남김 | | 10 어긋난 것 11·확인 못함(UI), 09 UI 덜어낼 것. 코드의 `kinds/agent.tsx` 주석은 "`+`에는 열기 항목을 두지 않는다" |
| 109 | 계약의 `docs`·`folder`·`section` kind가 `.gitignore`로 빠진 파일을 보나(`contexts/worker/files.ts`는 `.git`만 건너뜀) | 봄 / 안 봄 | | 10 고칠 것·확인 못함. req-0005·0006 |

### 1.13 시각 블록·UI kit·shell 화면

| # | 물음 | 선택지 | 영역 worker의 추천 | 근거(영역 파일과 spec·요구) |
|---|---|---|---|---|
| 110 | 시각 블록(표·차트·도표·앱 카드)이 MVP에 남나. 빼면 `visual.show/read/prepare_document`, `tools/visuals/`(약 2,200줄), `shell/renderer/workspace/visuals/`(약 3,000줄), wording 24개 key 등이 지워짐 | 전부 남김 / 앱 카드만 남김 / 전부 뺌 | 12: 앱 카드(`app_card`)는 남기고 agent가 만드는 표·차트·도표 블록은 MVP 밖으로 본다. 단 사람 확인이 필요하다 | 12 아직 정하지 않은 것 2, 04 어긋난 것·UI 덜어낼 것, 09 어긋난 것 2. changes-by-topic 4장(MVP 밖)·5장(그대로)·7장(확인할 것)이 엇갈림. PRODUCT.md 6장("채팅 안에서 앱의 부품을 가져다 쓰는 데까지"). S4 4장 표에 `visual.*`가 없음 |
| 111 | SDK UI kit과 design system이 MVP 범위에 드나. accepted 요구에 `ui-*`·token·component를 직접 말한 줄이 없음(req-0511은 rejected) | 요구를 만들지 않고 코드를 그대로 둠 / 요구를 씀 | 12: 요구는 만들지 않고 코드를 "그대로 둘 후보"로 둔다 | 12 아직 정하지 않은 것 1·그대로 둘 후보 표(`ui-control`·`ui-layout`·`ui-overlay`·`ui-stat`·`ui-table`·`ui-filter`·`ui-state`·`ui-chart`·`ui-reading` 일부·`ui-action` 호출 로직·`tokens`·`design`의 component 나머지·`wording` 도구). template 앱은 `ui-control`·`ui-layout`·`ui-state`를 고정 의존으로 씀 |
| 112 | annotation(req-1487)이 "그 component를 쓴 앱 코드의 파일과 줄"을 얻는 방식 | (가) JSX 개발 transform(`jsxDEV`의 `__source`)을 release build에서 켬 / (나) 요소 → bundle 위치를 얻어 release의 external source map으로 풂 / (다) esbuild plugin이 사용 지점에 위치 prop을 넣음 | 12: (나). 이미 source map을 bundle에 담고 있고 problems의 오류 위치가 같은 재료를 쓴다 | 12 아직 정하지 않은 것 3. (가)는 bundle이 커지고 `NODE_ENV=production`·`minify`를 바꿔야 함, (나)는 요소에서 bundle 위치를 얻는 길이 React 내부(fiber)에 기댐 |
| 113 | `@me/` 사용자 package와 SDK UI의 관계: PRODUCT.md의 "앱의 부품"이 앱 카드를 말하나 사용자 package의 UI 부품을 말하나. "앱 안에서 token을 바꾸고 부품을 복사해 `@me/` package로 만들어 고치기"는 tmp-review.md 485줄의 lead 추천이 사람 확인 없이 남아 있음 | 앱 카드 / 사용자 package UI 부품 | | 12 아직 정하지 않은 것 5. req-1001~1009는 UI kit을 말하지 않음 |
| 114 | `AuthorMark`(agent가 쓴 내용에 붙이는 작성자 표식)를 지우나 | 지움 / 남김 | | 12 그대로 둘 후보. `shell`·`sdk` test가 아닌 코드에서 쓰는 곳이 없음(grep 0건) |
| 115 | Lophn Workspace에 Apps 화면(archive, restore, open)과 Projects 화면을 두나. removed.md 4장은 "project 관심사가 없다"고 하나 core-projects는 사람이 project를 등록·수정·보관한다고 하고 그 화면의 위치를 안 정함 | 둘 다 남기고 안을 줄임(09가 쓴 가정) / 지움 | | 09 어긋난 것 3. shell.yaml은 Workspace에 대해 Settings 하나(req-0060)만 말함 |
| 116 | rail의 Search 단추(코드에는 있으나 req-0073의 contains는 Terminal, Contexts, Saved views, Agent 넷)를 요구에 더하나 코드에서 빼나 | 요구에 더함 / 코드에서 뺌 | | 09 어긋난 것 6 |

### 1.14 설정, secret, storage

| # | 물음 | 선택지 | 영역 worker의 추천 | 근거(영역 파일과 spec·요구) |
|---|---|---|---|---|
| 117 | 설정 파일의 형식과 위치, 그리고 변경을 쓰는 요소에 알리는 방법(값을 바로 읽나 변경을 받나). ledger를 거치지 않으니 `SettingsChanged` 같은 깨움이 없음 | (문서에 선택지 없음) | | 11 새로 만들기·아직 정하지 않은 것 8. req-0381(지침을 고치면 도는 turn은 시작 때 읽은 것을 쓰고 다음 turn부터 쓰임)·req-0350 |
| 118 | 설정 항목의 화면 이름과 설명을 어디서 얻나(선언에 설명 key를 걷으면 General 탭이 쓰는 `definition.description` 영어 한 줄이 없어짐) | 선언에 `title` 한 칸을 선택으로 둠 / 다른 방법 | 11: 선언에 `title` 한 칸만 선택으로 둠(제안일 뿐) | 11 새로 만들기·아직 정하지 않은 것 9. docs-review core-config |
| 119 | blob store 본체를 남기나(쓰던 곳 문서 판, snapshot이 지워짐) | 남기고 지워지는 소유처의 등록만 걷음 / 지움 | 11: 지우지 않는다, 지워지는 소유처의 등록만 걷는다(남는 쓰임: ticket, release_backup, package_version, approval, context_content, report, 대화 기록, question) | 11 어긋난 것·고칠 것(blob 소유 종류 등록), 08 확인 못함(남는 것으로 판단). changes-by-topic 7장 "blob-store" 물음 |
| 120 | `ledger-id` 파일을 복원이 없어진 뒤에도 두나(derived 무효화, `core/events/subscription-store.ts`가 ledger id로 옛 구독 위치를 버림) | 둠 / 지움 | | 08 확인 못함, 11 아직 정하지 않은 것 11·확인 못함. contexts index(derived store)가 아직 이 값을 쓰는지는 읽지 않음 |
| 121 | 제품 core가 `openRuntime`에 `doctor`와 `diagnostics`를 넘기지 않아 `diagnostics/check`·`diagnostics/list` read가 등록되지 않음. 의도인가 미완성인가 | 의도(Settings 진단 탭이 부르는 route가 제품에 없음) / 미완성 | | 11 확인 못함 1·먼저 알아 둘 사실. req-0459, 08 UI 새로 만들기(진단 panel) |
| 122 | secret의 이름과 설정 여부만 보이고 값은 안 보이는 화면을 하나로 모아 두나. 지금은 provider·MCP server 화면마다 흩어짐 | 두지 않는다(입력은 보호 입력 창뿐) / 하나로 모은 화면을 새로 만듦 | 11: 두지 않는다 | 08 UI 새로 만들기(secret 화면, "하나로 모은 화면은 없다(확인 못함)")와 11 UI 새로 만들기(secret 화면, "두지 않는다")가 서로 다르게 적음. req-0401·0402·0412는 화면을 요구하지 않음(0402는 agent가 설정 여부만 조회) |

### 1.15 보류의 뜻

| # | 물음 | 선택지 | 영역 worker의 추천 | 근거(영역 파일과 spec·요구) |
|---|---|---|---|---|
| 123 | "보류"가 코드도 지운다는 뜻인가, 예전 코드를 놔둔다는 뜻인가. notifications, install-and-update, Things to confirm, 앱 automation이 이에 걸림 | 코드를 지움 / 놔둠 | | 01 어긋난 것 5(`core/notifications`가 지울 event 이름 `TicketConfirmed`·`AssignmentPaused`·`QuestionCreated` 등에 묶여 있음. code-map은 `packages/core/notifications/`를 그대로 둠), 08 확인 못함(install-and-update는 지우라는 기록이 없어 목록에 안 넣음), 09 확인 못함 3, 11 덜어낼 것·UI 덜어낼 것(지움으로 적음). 01·11은 지움으로 셈, 08은 목록 밖. removed.md 2장, changes-by-topic platform/notifications·install-and-update |
| 124 | OS notification 표시(`shell/main/desktop/os-notification.ts`, 설정 `shell.os_notifications`)를 어떻게 하나 | 지움(01이 "보류=지운다"로 셈) / toast와 별개로 설계 | | 01 덜어낼 것·확인 못함. 요구에 없고 S1이 침묵 |
| 125 | tray, 로그인 자동 시작, 명시 종료 확인, 전역 팔레트 shortcut, 단일 instance가 install-and-update 보류에 어디까지 들어가나 | (문서에 선택지 없음) | | 09 확인 못함 3(`tray.ts`, `autostart.ts`, `quit.ts`, `global-shortcut.ts`는 목록에 안 넣음. 단일 instance는 changes-by-topic이 보류로 적어 덜어낼 것에 넣음). removed.md 2장 |
| 126 | 단일 instance lock과 data root 권한 검사(0700)를 install-and-update 보류에 넣나 | 남김 / 보류에 넣어 지움 | 11: 둘 다 core 시작에 필요하므로 남긴다 | 11 덜어낼 것(설치·update 안내 계산)·아직 정하지 않은 것 10 |

## 2. 문서를 고칠 것

> **반영함(사람 ㄱㄱ 2026-10-15).** 2.1~2.4는 모두 고쳤다. 2.5의 code-map 두 줄은 refactor session 몫으로 넘긴다. docs-review의 옛 경로는 기록 문서라 그대로 두고, 1059줄의 약속은 docs-review 끝에 닫는 줄을 적었다.

### 2.1 spec (S1~S8)

| 파일과 줄(또는 req ID) | 지금 적힌 것 | 어긋나는 근거 | 고칠 방향 |
|---|---|---|---|
| `tmp/specs/event.md` 12장(213줄) | "renderer: 기능마다 따로 구독하고 따로 띄우는 것(`context-watch.ts`, `violation-toast.tsx`, `ask-agent-toast.tsx`, `workspace/notice-card.tsx` 등) → 8장의 층" | 01 어긋난 것 3: 코드의 `NoticeCard`는 event를 쓰지 않음(읽기 실패, tracking 꺼짐 안내). `ask-agent-toast.tsx`는 부르는 곳이 없음 | 목록에서 `notice-card.tsx`를 뺀다. `ask-agent-toast.tsx`는 죽은 코드로 취급 |
| `tmp/specs/event.md` 8장 마지막 줄 | "Context 탭(도메인 모델, 위반 목록, 용어집)은 열 때 읽는다" | shell req-0075(도메인 모델은 Context 탭, 계약 세부는 별도 Contract 탭)와 req-0077(위반 목록, saved view, 용어집). 코드 하위 탭은 Overview, Search, Violations, Glossary, Contract 다섯(10 어긋난 것 10) | 요구에 맞춰 saved view를 더하고 계약은 Contract 탭이라고 적는다 |
| `tmp/specs/event.md` 5장 "call 닫음의 반응" | "handler가 맡긴 session으로 call을 보내고 같은 일 안에서 그 call의 상태를 닫는다" | 03 어긋난 것 7: 새로 보내는 call과 닫히는 원래 call 중 어느 것인지 갈림. S3 5장은 "program의 reaction은 행을 두지 않는다" | 새 입력(program이 보냄, 행 없음)과 닫히는 원래 call(`agent_calls` 한 행)을 구별해 적는다 |
| `tmp/specs/agent-call.md` 5장 "상태를 두는 곳" | `agent_calls` 칸은 call, from, 받는 session, reply, 상태, dedup, 시각 | 03 어긋난 것 2: 화면이 눌렀을 때 상태와 실패 이유를 읽고(req-1506·1501), "열린 session, 없으면 새 session"은 닫힘을 가린 뒤 role과 place가 필요한데 칸이 없음 | 실패 이유와 받는 곳(`to`의 role, place) 칸을 더한다 |
| `tmp/specs/agent-call.md` 5장 "닫힌 call에 온 답이나 메시지는 `closed` 이유와 함께 보낸 쪽에 돌아간다" | "보낸 쪽" | 03 어긋난 것 4: 늦게 답한 쪽(받은 agent)인지 call을 보낸 쪽인지 읽기 나름. req-1503은 "받은 쪽에 돌아간다", AGENT-ROLE T18은 "닫힘으로 돌아간다" | 03 제안: 늦게 보낸 쪽(받은 agent)에 reply tool의 결과로 돌려준다고 적는다 |
| `tmp/specs/agent-call.md` 8장, `tmp/specs/agent-definition.md` 3장 44줄 | S3 8장: "이름과 입력 schema는 S4에서 정한다" / S4 3장: call, reply, cancel의 이름과 한 줄 설명뿐 | 03 어긋난 것 1: `to` 세 가지의 모양, 새 session을 role과 place로 가리킬 때 place를 적는 법(project 이름? 앱 이름?), `refs`의 종류와 모양, reply 필드가 어느 문서에도 없음. S3 3장 `refs`는 "ticket, problem, 파일 경로, 보낸 session"만 말함 | S4에 call·reply·cancel 입력 schema를 더한다(내용은 S3 3장 봉투와 맞춤) |
| `tmp/specs/agent-definition.md` 7장 명령 표 `permissions` | 전역 built-in 목록에 그대로 둠 | 04 어긋난 것: 2장은 "사람이 tool 목록을 바꾸지 않는다"인데 이 명령이 무엇을 여는지 없음. 02 고칠 것(`/permissions`)은 "agent grant와 이 session의 session 허락을 보임"으로 씀 | 뜻을 "agent grant와 이 session의 session 허락 보기"로 적는다 |
| `tmp/specs/agent-definition.md` 11장 8·13, `tmp/specs/activation.md` 94줄, `tmp/specs/index.md` 99줄 | req-0098 "(proposed)", req-0035 "(proposed)", req-1520 "(proposed)", req-0825 "proposed" | `requirements/*.yaml`에서 모두 `accepted` | "(proposed)" 표시를 걷는다 |
| `tmp/specs/place-session.md` 9장 87·88·91·92줄 | req-1518, req-0719·1063, req-0037, req-1519를 "(proposed)"로 적음 | 08 어긋난 것: `requirements/core-lophn-agent.yaml`·`core-apps.yaml`·`coding-agent.yaml`에서 모두 `accepted` | "(proposed)" 표시를 걷는다 |
| `tmp/specs/app-call.md` 3장 표 "호출 경로(core)"의 지금 코드 칸 | `packages/core/apps/connections`, `invocations`(옛 confirm 경로가 섞여 있다) | 05 어긋난 것 1·맨 앞 설명: 지금은 서명 연결로 앱 process socket을 직접 부르는 직접 호출 + 후행 기록이라 호출 경로 서비스가 없음. `connections/`는 앱 쌍 직접 통로이고 새 경로로 이어지는 줄이 없음. docs-review 마지막 단락이 이미 알려 둠 | "새로 짓는다"로 고치고 `connections/`·`invocations/`는 지울 옛 것으로 옮긴다 |
| `tmp/specs/coding-agent.md` 4장(40줄) | 첫 prompt는 "TUI가 준비된 뒤 PTY에 paste" | 2장 1("화면을 읽어 짐작하지 않는다")과 부딪힘. 06 어긋난 것, docs-review 마지막 단락이 이미 알려 둠 | 1장(coding agent) "TUI 준비를 결정적으로 아는 법"이 정해진 뒤 맞춘다 |
| `tmp/specs/coding-agent.md` 4장(47줄) | "pi `agent_end`", "Codex `Stop`·`notify`" | 06 어긋난 것: 지금 코드 `sessions/observe/plugins.ts`는 pi의 `agent_end`를 ready 근거로 쓰지 않고 `agent_settled`만 씀. Codex catalog는 `Stop` hook뿐이고 `unverified`. docs-review 마지막 단락도 pi 신호 이름을 인정 | 조사 근거를 확인해 신호 이름을 맞춘다. Codex는 `notify`를 쓸지 정한다 |
| `tmp/specs/activation.md` 6장 | 이전 활성 release와 새 release의 선언을 비교한다 | 07 어긋난 것 7: 이전 활성 release가 없을 때 무엇과 비교하는지 없음. AGENT-ROLE H2는 "앱을 처음 activation하거나 새 release가 선언을 넓히면 사람이 앱 grant를 허락한다(정함: req-0825, 0859)" | 이전 release가 없으면 선언 전부를 늘어난 것으로 본다고 적는다(07이 쓴 가정) |
| `tmp/specs/index.md` 1장 마지막 예 | "config 선언 모델과 secret 파일 저장은 바뀌었지만 package 하나 안의 일이라 spec을 쓰지 않는다" | 11 어긋난 것: 설정 변경을 쓰는 요소에 알리는 방법과 secret 파일을 읽는 process는 여러 process가 걸림 | 예에서 빼거나, 이 둘만 spec으로 쓴다(1.14 설정 파일·알림 결정에 달림) |

### 2.2 요구

| 파일과 줄(또는 req ID) | 지금 적힌 것 | 어긋나는 근거 | 고칠 방향 |
|---|---|---|---|
| req-0825 (`core-app-releases.yaml` 257~261줄) | acceptance 2: "새 host, secret, 다른 앱 app-api, external app-api를 선언한 release는 사람이 허락하기 전에는 activate되지 않는다". acceptance 3: "migration을 DB 사본에 돌려 표나 열이 지워지거나 row 수가 줄면 그 내용을 보이고…" | 07 어긋난 것 1. S7 6장·11장 2, req-1520("DB 사본에서 재지 않는다")과 정면으로 어긋남. S7 6장은 "app-api가 더해지는 것은 activation에서 묻지 않는다. agent grant가 효과별 기본값으로 받는다"(`specs/approval.md` 55·57행). docs-review 마지막 단락이 이미 알려 둠 | acceptance 2에서 external app-api를 빼고(다른 앱의 app-api 쓰기만 남김), acceptance 3을 "migration이 손실 단계를 선언했으면…"으로 바꾼다 |
| req-0046 (`core-lophn-agent.yaml` 325~336줄) | "agent가 project 밖에서 문서를 쓰려면 먼저 어느 project에 둘지 사람에게 묻는다". acceptance: "project에 놓이지 않은 session에서 문서를 쓰게 하면 agent가 먼저 project를 묻는다" | 08 어긋난 것: S8 9장 3은 lophn이 쓰기 tool을 갖지 않는다고 하고 쓰기 tool이 있는 role은 모두 place가 있음 | S8 9장 3에 맞춰 고친다(place 밖에서 쓰는 agent가 없으므로 문장을 지우거나 앱 Operator의 file 범위 문장으로 바꿈) |
| req-0893 (`core-app-runtime.yaml` 390~397줄) | "write와 external app-api, 실패한 읽기, 앱 시작은 invocation으로 남기고 write invocation에는 그 호출이 바꾼 앱 DB 변경을 붙이며…" | 05 어긋난 것 3: S5 6장은 write, external, 앱 시작 invocation에 changeset을 붙임(docs-review 결정) | "write invocation"을 "write·external·앱 시작 invocation"으로 고친다 |
| req-1217의 폐기 주석 (`coding-agent-cli.yaml` 158줄) | "확인됨은 조건이 통과하면 core가 정한다(req-0746)" | 06 어긋난 것: req-0746 본문(`core-app-tickets.yaml` 241~249줄)과 S4 4장 `ticket.verify`는 확인됨과 확인 실패를 App Engineer가 정함 | 주석을 "확인됨은 App Engineer가 정한다(req-0746)"로 고친다 |
| req-1361 (`coding-agent.yaml` 1041~1048줄) | coding agent가 CLI로 읽는 종류에 "지난 고친 기록" | 07 어긋난 것 6: 고친 기록(`ProblemFixRecorded`)은 problems에서 사라졌음. req-0744는 ticket 완료 보고에 "수리한 문제별 고친 기록"을 잇는다고 함 | "지난 수리 ticket의 완료 보고(req-0744)에서 고친 기록"으로 이어 적는다 |
| req-0315·req-1495 (`core-approvals.yaml` 154~162줄, 253~261줄) | req-0315: "원래 일이 끝나면(turn 끊김, session 끝, 더 새 release의 activation 시작) 대기 request는 cancelled". req-1495: turn 안 request는 session snapshot, activation·reaction request는 꺼졌다 켜져도 남음 | 02 어긋난 것 6: 문장만 보면 turn 안 request와 보류 request의 수명이 섞여 읽힘. S2 6장 표는 둘을 나눠 정함(turn 안은 메모리·interrupted 때 cancelled, 보류는 표·더 새 release의 activation 시작 때 cancelled) | req-0315 문장과 acceptance를 turn 안 / 보류로 나눠 쓴다(구현은 S2를 따름) |

### 2.3 changes.md · changes-by-topic.md · notes/removed.md

| 파일과 줄(또는 req ID) | 지금 적힌 것 | 어긋나는 근거 | 고칠 방향 |
|---|---|---|---|
| `tmp/changes.md` 48줄(2장 rewind) | "write invocation마다 core가 앱 DB 변경(SQLite changeset)을 남기고… SDK `withRevert`… 지우고 core의 changeset 저장과 역적용으로 바꾼다" | 05 어긋난 것 5·02 어긋난 것 2: 앱 DB는 앱 process만 열므로(req-0950) SDK가 write·external·앱 시작 invocation마다 SQLite session으로 changeset을 뜨고 core는 보관·지휘·뒤집기를 함(S5 3장·6장, S2 11장 2) | "SDK가 changeset을 뜨고 core가 보관하고 뒤집는다"로 고친다. `architecture/approval.md` 5장의 같은 말은 머리 안내가 S2를 따르라고 함 |
| `tmp/changes-by-topic.md` 36줄(앱 rewind) | "write invocation마다 core가 앱 DB changeset을 남기고" | 위와 같음 | 위와 같이 고친다 |
| `tmp/changes.md` 46줄(2장 event) | renderer가 흩어진 구독과 toast(`context-watch.ts`, `violation-toast.tsx`, `ask-agent-toast.tsx`, `notice-card.tsx` 등)를 event client로 모은다 | 01 어긋난 것 3(2.1 첫 줄과 같음): `NoticeCard`는 event를 쓰지 않음 | `notice-card.tsx`를 목록에서 뺀다 |
| `tmp/changes.md` 51줄(2장 agent call) | "call 봉투, `agent_calls` 표, call·reply·cancel tool, grant 판정, session 단위로 바꾼다" | 03 어긋난 것 5: "grant 판정"을 새로 짓는 일에 넣어 Gate 목록(02)과 겹침 | call 쪽 책임은 Router가 Gate를 부르는 지점까지라고 고친다 |
| `tmp/changes.md` 49줄(2장 coding agent 연결) | "harness마다 adapter를 두고 hook을 받아 agent event로 바꾼다. Router 입력은 PTY로 넣는다" | 06 어긋난 것: CLI hook 명령(req-1517)과 core 변환의 나눔이 없음. S6 4장이 정본 | hook → CLI 명령 → core의 변환으로 나눠 적는다(adapter 위치는 1.8 결정 뒤) |
| `tmp/changes.md` 54줄(2장 config) | "`packages/core/config/registry.ts`가 항목마다 요구하는 설명 key를 걷어낸다" | 11 어긋난 것: 설정 저장 전체(ledger 표 `setting_choices`·`setting_revisions`·`settings_state`, ApplySettings·ReloadSettings command, 이력, 충돌 검사, TOML 교환, question 근거 apply)가 req-0350의 "설정 파일 하나"와 어긋남. registry만 고쳐서는 안 됨 | 코드 쪽 할 일을 저장 전체로 넓힌다 |
| `tmp/changes.md` 55줄(2장 secrets) | "keychain 저장 코드를 파일 저장으로 바꾼다" | 11 어긋난 것: keychain adapter뿐 아니라 `sealed_ref` 모델(ledger `secrets` 표, 준비 증거, CAS 비교), I/O worker의 `secret.prepare` 세 단계, cleanup read, coding credential의 keychain 보관, export·import가 걸림 | 코드 쪽 할 일을 넓힌다 |
| `tmp/changes.md` 99줄(4장 storage), 66줄(3장 backup) | 4장 storage: "복구본 규칙(0057 partial), 기동 실패 분류(0054 partial)"뿐. 3장: "backup, 모든 export / 위치 미확인" | 11 어긋난 것: 지울 backup·restore 코드 위치가 11 덜어낼 것 첫 세 줄에 있음(`core/storage/migration/{backup,backup-reads,restore}.ts`, `core/main/worker/restore-entry.ts` 등). export의 위치는 앱 data export(07), secret export·import(11), settings TOML(11), agent trace export(08) | "위치 미확인"에 위치를 채우고 4장에 backup·restore 삭제를 더한다 |
| `tmp/changes.md` 72줄(3장 앱 화면 메모) | "앱 화면 메모(agent가 다는 주석) / 위치 미확인" | 12 어긋난 것: 위치는 SDK `cap-schedule/screen-context.ts`, `core/apps/agent-context/`, lophn agent의 화면 context tool 둘, blueprint `agent_context` | 위치를 채운다 |
| `tmp/changes.md` 83줄(3장 redaction) | "redaction 실패 시 원문을 내보내지 않는 장치 / base" | 11 어긋난 것: 위치를 안 적음. `base/redaction/engine.ts`의 `omitted` 분기. base req-0610 폐기 이유는 지금 코드가 이미 이 요구와 반대로 동작함을 뜻함(`unsupported` media 분기) | 위치를 채운다 |
| `tmp/changes.md` 75줄(3장 앱 직접 통로) | "직접 socket, 서명 연결권" | 05 어긋난 것 6: 같은 통로가 앱 화면 byte(`/screens`)도 내주는데 적혀 있지 않음 | 화면 byte를 내주는 길을 더한다(1.1 결정과 함께) |
| `tmp/changes.md` 78줄(3장 필수 검사) | "`definitions.ts`(22개). 남는 것은 선언과 구현 일치, 의존, migration, 되돌림" | 07 어긋난 것 4: 지금 정의는 runner 3 + harness 18 = 21개이고 실패 경로가 선언 code마다 하나씩 더해짐 | 숫자를 고치거나 뺀다 |
| `tmp/changes.md` 97줄(4장 lophn-agent), `tmp/changes-by-topic.md` 138줄 | "skill은 꺼짐 표시로 끄고, 바꾸면 다음 run부터 쓰인다" | 03 어긋난 것 6, 04: S4 1장이 "요구의 run은 S1의 turn"이라고 정함(요구 req-0099·0381은 이미 "다음 turn부터"). `tmp/notes/removed.md` 89줄도 같은 말이나 기록 문서라 그대로 둠(2.6) | "다음 turn부터"로 고친다 |
| `tmp/changes.md` 2장·4장, `tmp/changes-by-topic.md` 3장·5장 | Project Manager 전환 작업이 코드 항목으로 없음 | 04 어긋난 것: S4 11장 13이 "코드의 이름은 refactor session 몫"이라고만 적음. 코드에 `context_engineer` 값, `roles/context-engineer`, wording "Context Engineer" 열여덟 곳 등이 약 197개 파일에 걸림(docs-review) | 4장에 "Context Engineer → Project Manager(project마다 하나, 이름·수 바꾸기)" 줄을 더한다 |
| `tmp/changes-by-topic.md` 107줄(documents/contexts) | "index store. outline kind는 파일 하나에 개체 하나로 바뀐다" | 08 어긋난 것, 10 어긋난 것 6: docs-review의 "context 위반 감지 시점" 닫음은 `Deno.watchFs` + index 다시 계산 + 쓸 때 따라잡기를 현재 코드대로 req-0018·0020과 맞는 것으로 닫음. `core/projects/contexts/index`(derived sqlite)가 그 index. "index store"가 outline-and-search의 목차 색인을 context 쪽에 잘못 적은 것인지 알 수 없음 | "index store"가 무엇을 가리키는지 적거나 줄을 고쳐 contexts index는 남긴다고 한다 |
| `tmp/changes-by-topic.md` 132줄(documents/series "그대로") | "pattern과 다음 이름 계산이 contexts의 series kind로 간다" | 10 어긋난 것 7: `changes.md` 3장 64줄은 `packages/core/projects/series`를 지운다고 함. 실제로는 series registry(가족, draft, 보관)가 지워지고 다음 이름 계산은 `contexts/series/next.ts`가 이미 따로 갖고 있음 | "그대로"는 `contexts/series/next.ts`의 계산만 뜻한다고 적는다 |
| `tmp/changes-by-topic.md` 131줄(apps/preview "그대로") | "격리 process와 일회용 DB. automation 시계와 confirm 줄만 빠진다" | 05 어긋난 것 8: 코드의 preview에는 documents 대역과 apps 대역, 직접 연결을 받는 shell main 쪽도 있어 이들도 빠짐 | 빠지는 것에 documents 대역과 직접 연결 쪽을 더한다 |
| `tmp/changes-by-topic.md` 99줄(apps/sdk) | "cap-save, format, cap-schedule, 화면 상태 client" | 12 어긋난 것: 같은 파일 55줄(apps/agent-context)은 앱 화면 상태를 "보류", 화면 메모를 "지움"으로 나눔. 코드로는 같은 파일(`screen-context.ts`)이라 둘 다 지움 | 두 줄을 같이 고쳐 화면 상태 client(보류)와 화면 메모(지움)가 같은 코드라고 적는다 |

### 2.4 products (AGENT-ROLE, PRODUCT)

| 파일과 줄(또는 req ID) | 지금 적힌 것 | 어긋나는 근거 | 고칠 방향 |
|---|---|---|---|
| `products/AGENT-ROLE.md` R1(89줄), T1(97줄), T6(102줄), E 목록 안내(188줄), 리팩터링 안내(208줄) | `../tmp/architecture/agent-call.md`, `../tmp/architecture/event.md` 2장·agent-call.md 3장, `../tmp/architecture/approval.md`, `../tmp/architecture/event.md` 5장, `../tmp/architecture/agent-call.md`를 정본처럼 가리킴 | 03 어긋난 것 3: S1·S2·S3가 확인됨이 되면서 `tmp/architecture/*`는 "옮겨 감"(머리에 "이 문서와 S가 다르면 S를 따른다") | spec 장 번호로 고친다(S1 5장, S2, S3 3장 등) |
| `products/AGENT-ROLE.md` T19(115줄) | "(정함: agent-call.md 8장)" | 03 어긋난 것 3: 규칙은 S3 6장(82줄)과 S4 5장(165줄)에 있음 | S3 6장·S4 5장으로 고친다 |
| `products/AGENT-ROLE.md` 5.2 표(158~175줄), T8(104줄) | 받는 agent 고르기를 role별 기호(같음, 앱, prj, 이름)로 정함. "(제안)" | 03 어긋난 것 8: S3 3장은 `to`가 role과 place이고 "받는 이름은 정확히 맞아야 한다. 짐작하지 않는다". Router는 표를 코드로 갖지 않는다는 해석으로 구현 목록을 씀 | 5.2는 보내는 agent가 무엇을 적는지의 지침이며 Router는 표를 갖지 않는다고 한 줄 적는다 |

### 2.5 그 밖(코드 repo의 docs/dev, tmp 안의 기록)

| 파일과 줄(또는 req ID) | 지금 적힌 것 | 어긋나는 근거 | 고칠 방향 |
|---|---|---|---|
| `/home/pyosechang/projects/lophn/docs/dev/code-map.md` 42·49~54·84줄 | concern 표에 `platform/backup-and-migration`(`packages/core/storage/migration/`), `documents/file-tracking`·`versions`·`formats`·`outline-and-search`·`series`·`addressing`, `lophn-agent/assignments`가 그대로 있음 | 08 어긋난 것: 새 설계에서 없어지거나(backup 빠지면 "migration"만 남음) 바뀜. check-docs가 줄 누락을 잡는다고 적혀 있음 | 옛 `docs/dev/`는 없앤다(사람, 2026-10-16). 고칠 일은 없다. 새 module 표는 리팩터링 뒤 `../../dev/code-map.md`에 적는다 |
| `/home/pyosechang/projects/lophn/docs/dev/code-map.md` 165·168줄(import 방향) | `coding-agent`는 protocol, base만 import. shell main의 terminal host만 coding-agent를 더 쓸 수 있음 | 06 어긋난 것 1: S6의 Router(core)와 hook 변환(core)이 adapter를 부를 수 없음 | 계획 3장 #60 추천(adapter의 순수 값은 protocol). 확인되면 `../../dev/code-map.md`에 적는다 |
| `tmp/docs-review.md` projects 절(옛 경로 `packages/documents/addressing/`, `packages/contracts/documents/outline-markdown.ts`) | src layout 이전 경로 | 08 어긋난 것, 10 어긋난 것 8: 지금은 `packages/core/projects/addressing/`, `packages/protocol/projects/outline-markdown.ts`. 읽기 혼동만 있고 결정은 같음 | docs-review는 기록 문서라(2.6) 그대로 두고, 읽을 때 현재 경로로 본다 |
| `tmp/docs-review.md` 1059줄 | "req-0852가 아직 직접 연결 준비(지운 직접 통로)와 30초(세부 수치)를 말한다. S5를 쓸 때 고침 표를 낸다" | 05 어긋난 것 2: S5에 고침 표가 없음. req-0852는 rejected라 문제는 없음 | 약속을 닫는다(고침 표 없이 rejected로 충분하다고 한 줄 적음) |

### 2.6 이미 고침, 또는 확인 결과 고칠 것 없음

| 파일과 줄(또는 req ID) | 영역 파일이 짚은 것 | 확인 결과 |
|---|---|---|
| `tmp/changes.md` 46줄 event 개수 | 01 어긋난 것 1, 09 어긋난 것 5: "domain event 10개"와 "약 150개를 9개로"가 같은 줄에 있음 | 이미 고침("약 150개를 10개로"). 07·01·09의 같은 지적도 닫힘 |
| `tmp/changes.md` 53줄 activation | 07 어긋난 것 3: "migration이 없는 release는 선언 비교만 한다"만 있고 TicketVerified가 빠짐 | 이미 고침(`TicketVerified`와 migration 선언이 줄에 있음) |
| `tmp/changes.md` 92줄 app-releases의 "DB 사본" | 02·05·07 어긋난 것: "migration을 DB 사본에서 잰다" | 이미 고침("data 손실은 migration 선언으로 판정하고 DB 사본에서 재지 않는다, req-1520") |
| `tmp/changes.md` 103줄 req-0044 | 05·08 어긋난 것: "session rewind와 앱 rewind를 어떻게 이을지 정하지 않았다" | 이미 고침("정함(2026-10-15)… S5 8장, S8 4장, req-1519") |
| `tmp/changes.md` 1장 표(core-lophn-agent accepted 35) | 08 어긋난 것: req-1518, 1519를 세지 않은 것으로 보임 | 이미 고침. 표 위에 "2026-10-14 기준 수다. 그 뒤로 요구가 더해지고 바뀌었다"는 줄이 있음(`core-lophn-agent.yaml`은 지금 accepted 46) |
| `tmp/changes-by-topic.md` 141줄 roles/context-engineer | 04·08·09 어긋난 것: "전체에 하나" | 이미 고침("Project Manager로 이름이 바뀌고 project마다 하나가 되었다(req-0035)") |
| `tmp/changes-by-topic.md` 145줄 questions, 163줄 steering | 04 등: 사람에게 묻는 tool과 대기 목록 요구가 생겼음 | 이미 고침(req-1510, 1498, req-1509가 줄에 있음) |
| `tmp/specs/agent-definition.md` 3장 38줄, `tmp/specs/index.md` 72줄 file tool 경로 검사의 근거 req-1475 | 04 어긋난 것, 10 어긋난 것 5: rejected 요구를 근거로 인용함 | 이미 고침("경로 검사는 S4의 결정이다(req-1475는 사람의 문서 열기에 대한 것이고 rejected다)"). agent file tool 범위를 요구로 쓸지는 합칠 때 올린다고 docs-review에 적음 |
| `tmp/changes-by-topic.md` 86줄 waiting-and-recovery "event.md 7" | 01 어긋난 것 2: 재시작 때 일은 S1 10장이고 7장은 남지 않는 event | 고칠 것 없음. 이 줄의 `event.md`는 `tmp/architecture/event.md`이고 그 7장이 "꺼졌다 켜질 때"다. 원하면 S1 10장으로 바꿈 |
| `tmp/notes/removed.md` 4장 78줄 "Context Engineer는 전체에 하나다"(와 35·72줄의 옛 이름) | 04·08·09 어긋난 것 | 고치지 않기로 함. docs-review 2026-10-15 결정: "기록 문서(docs-review, research, notes/removed, archive)와 옮겨 간 `architecture/event.md`는 그때 이름 그대로 둔다" |
| `tmp/architecture/approval.md` 3·4·5·7장(`decided_by`, "사본에서 잰다", core가 changeset을 남긴다) | 02 어긋난 것 1·2 | 고치지 않기로 함. 머리의 "옮겨 감" 안내가 "이 문서와 S2가 다르면 S2를 따른다"고 함. `architecture/event.md`도 같음 |
| `tmp/docs-review.md` 120~147줄 skill hot-reload 절의 "run 기준" | 04 어긋난 것 | 고치지 않기로 함(기록 문서). S4 1장이 run = turn이라고 적음 |

## 3. 겹치거나 빠진 넘김

영역 파일의 "다른 영역에 넘긴 것" 가운데 받는 영역 파일에 그 항목이 없거나, 두 영역이 같은 항목을 함께 셌거나, 서로 다르게 적은 것이다.

### 3.1 받는 영역 파일에 그 항목이 없는 것

- 03 → 08: call로 열린 session에서 checkpoint가 되는 첫 입력과 steer의 checkpoint 표시(`session/rewind/checkpoints.ts`는 사람 `request` 메시지만 checkpoint). 08에는 `checkpoints`가 한 번도 안 나옴. (1.10에도 올림)
- 03 → 06(tickets): `core/apps/tickets/ports.ts`가 `tools/handoff`의 `adoptionOf`를 import하므로 handoff 폴더를 지우기 전에 이 의존을 끊어야 함. 06은 `ports.ts`를 claim 줄에서만 말하고 이 import는 없음.
- 01 → 07·05: `ReleaseActivated`(와 `GrantCreated/GrantRevoked`)를 읽는 app frame 새로고침(`refreshAppViews`)의 새 신호. 07은 `ReleaseActivated` 등 release event 내보내기를 지우는 것만 적고 05에는 없음. (1.2에 물음으로 올림)
- 11 → 07·problems: `detailCollectionSetting`(진단 상세 수집 설정)과 snapshot·fix가 소유한 blob. 07은 snapshot 줄만 있고 `detailCollectionSetting`은 없음.
- 11 ↔ 07: 11은 `release_backup` blob 수명과 앱 DB 복구본(`core/apps/data/worker/backup.ts`)을 07로, 07은 blob 보존 규칙(`core/storage/blobs`의 `permanent` → 자동 삭제 대상 지정)을 storage 소유 영역(11)으로 서로 넘김. 11에는 `permanent`가 없고 07에는 `release_backup`이 없음.
- 12 → 03·06: annotation 전달(App Engineer session 메시지, ticket 근거 모양, coding agent CLI가 읽기). 03과 06 어디에도 `annotation`이 없음(07은 feedback 쪽에서 이름만 말함).
- 12 → 10: 시각 블록이 쓰는 문서 판 reads(`shell/renderer/app-frame/document-view-slot.tsx`, `documentViewOpenSchema`의 `version`). 10에 없음.
- 10 → 12: 위반 toast 문구와 `packages/design/wording`의 문서·context 문구. 12는 wording을 shell/wording 영역으로 다시 넘기고, 09는 위반 toast 계산(76줄)과 Project Manager 부르기(97줄)만 셈.
- 02 → 08: session archive·지움 때 대기 권한 요청과 질문을 cancelled로 닫는 호출(08이 02로 넘김). 02에는 session 삭제 때 request를 지우는 길(19줄)과 rewind 때 취소(64줄)만 있고 archive 때 cancelled 호출은 없음.
- 08 ↔ 09: Settings의 Providers 화면. 08은 "Providers 화면"을 09로, 09는 "Settings 전체(일반, Providers, …)"를 08로 넘기고 11도 "Providers…: 08·09"로 넘김. 08에는 일반·진단·secret 화면만, 09에는 없음. Providers 화면 자체(provider 연결, provider 계정 UI)는 어느 파일에도 없음.
- changes.md 3장 80줄 "provider 계정 기능, 내장 로컬 provider"(`packages/core/lophn-agent/providers` 안): 열두 영역 파일 어디에도 코드 항목이 없음. 09는 wording과 아이콘 흔적(`settings.accounts.*`)만 셈.
- 영역 13(test·fixture): 10(245줄)과 11(166줄)이 넘겼으나 이 목록에 13이 없음. docs-review 2026-10-15 "13은 제외하셈 테스트는 그냥 전부 rewrite 대상이야"로 닫힘. 목록에서 테스트 항목을 따로 세지 않음.

### 3.2 같은 항목을 둘 이상 영역이 센 것

- backup·restore·자동 backup·복구본 사람 확인 삭제: 07:25, 08:30, 11:19(와 07:125 Backup 패널).
- secret 저장(keychain → 파일), export·import: 08:74, 11:72, 11:21.
- config 저장 모델과 TOML 교환: 08:76, 11:22·43·73.
- redaction의 화면 상태 문자열 규칙: 08:39, 11:33.
- Settings의 General·진단 panel: 08:122·140·141·159, 11:117·119·127·135.
- documents core 삭제와 파일 route(addressing, file-tracking, versions, formats, series, outline-and-search, upload, 파일 read·write route, md 목차 parser): 08:15~28·58~59, 10:13~23·85~91·108~109.
- 편집기 UI(버전 비교, 판 복원·버전 확정, 문서 읽기와 열기 단위, 외부 변경 충돌 화면): 08:111·112·132~134, 10:135·145·146·181·182.
- coding agent의 문서·project 통로(`cli/commands/{document,save,series,format,project}.ts`, `connection/document-save.ts`, MCP의 문서 tool): 06:26, 10:29(와 08·10의 넘김).
- trace·observability: 01:46, 03:50, 08:33.
- "Context Engineer" 이름 문구(wording, renderer 식별자): 04:132·133, 08:147, 10(UI 고칠 것에 센 값).
- `ledger-id` 파일: 08 확인 못함, 11 확인 못함·아직 정하지 않은 것.
- 테스트의 옛 요구 ID와 작업 번호: 09:43(shell·design), 12:32(design·sdk), 11 어긋난 것(`migrations_test.ts`). `packages/design`은 09의 1,611곳과 12의 300곳에 함께 들어갈 수 있음.

### 3.3 서로 다르게 적은 것

- secret 화면: 08 UI 새로 만들기(161줄)는 "설정된 secret 이름과 여부를 보이는 화면"을 새로 만들 것으로, 11 UI 새로 만들기(137줄)는 "두지 않는다"로 적음. (1.14에 물음으로 올림)
- trace export: 08:33은 "agent trace export"를 지울 것으로(removed.md의 export 전부), 01:46은 "트레이스 읽기·내보내기(observability)"를 고칠 것(조립 근거를 session 기록에서 가져옴)으로 적음.
- install-and-update 보류: 11은 update 안내 계산과 Settings Update 탭을 지움으로 적고, 09는 단일 instance만 덜어낼 것으로 넣고 나머지를 확인 못함으로 두고, 08은 보류라 목록에 안 넣음. (1.15에 물음으로 올림)
- `redactScreen` 쓰는 곳: 11:33은 notifications와 problems snapshots 둘이라 하고 08:39는 `core/notifications/model.ts` 하나라 함.

## 4. 코드에서 찾은 규칙 위반과 죽은 코드

영역 파일에 적힌 것만 옮겼다. 줄 수 세기는 영역 worker가 센 값이다.

### 4.1 옛 요구 ID나 작업 번호가 남은 test 이름과 주석

- 09: test 이름과 주석의 `shell/desktop#R37`, `[agent-R4]`, `shell#T18` 꼴. `packages/shell`·`packages/design`의 test 317개 파일(1,611곳)과 제품 코드 주석 15곳.
- 12: test 이름·안내·주석에 붙은 `apps/sdk#R19`, `shell/design-system#R41` 꼴 375곳. `packages/design` 300곳(파일 65개), `packages/sdk/ui-*`·`tokens` 75곳(파일 34개). 많이 나오는 것은 `apps/sdk#R38` 27, `shell/design-system#R41` 23, `apps/sdk#R16` 22, `shell/design-system#R33` 21. 전수는 `grep -rn "#R[0-9]"`.
- 11: `core/storage/migration/migrations_test.ts`가 "platform/backup-and-migration#R…"로 옛 문서 ID를 test 이름에 넣음. 같은 파일 534줄 "변환 성공 뒤에도 복구본이 남는다"는 옛 규칙을 지키는 틀린 test.
- 02: 주석에 남은 `approval.submit_assignment`(`core/lophn-agent/tools/bundles/agent.ts` 근처).

### 4.2 쓰는 곳 없는 코드와 문구

- 01: `renderer/desktop/notification-chip/ask-agent-toast.tsx`와 `renderer/workspace/notice-ask.tsx`(+test, `ask-view.ts`): test 밖에서 부르는 곳이 없음.
- 01: `renderer/overlay/surfaces/surface.tsx`의 `ToastStack`과 overlay의 `notification` 표면: 토스트를 그리는 표면이 이미 있으나 부르는 곳이 없음.
- 03: 문구 `roles.label.origin-handoff` "Handed over by another role"(`packages/design/wording/en.ts` 2224행, `placeholders.ts` 2289행): shell renderer에 쓰는 곳이 없음(grep).
- 04: `core/lophn-agent/roles/{lophn,app-engineer,operator}/tool-selection.ts`(`lophnTools`, `lophnOffers`, `appEngineerTools`, `operatorTools` 등): roles 밖에서 import하는 곳이 없고 test만 부름.
- 04: `roles/lophn/{setting-proposal,question-submission,place-recommendation}.ts`: 사용처 없음.
- 04: `roles/lophn/{plan,app-plan,ops-report}.ts`: 사용처 없음.
- 04: `roles/app-engineer/{design,interview,interpretation,ticket,scope}.ts`: 사용처 없음.
- 04: `roles/operator/result.ts`, `roles/context-engineer/report.ts`: 사용처 없음.
- 04: `core/lophn-agent/prompt-assembly/compaction.ts`의 자동 compaction 계산 함수(`compactionNeeded`, `precheckCompaction`, `compactionTarget`, `mergeStepInputCap`, `recentHistoryBudget`, `splitChunks`, `historyCut`, `checkCompletion`, `shrinkResultText`): 사용처 없음(compactor는 `summaryOutputCap`만 씀). 04는 roles 밖 import만 grep했고 동적 import와 문자열 참조는 안 봄.
- 07: `core/apps/releases/bundle/import-map.ts`의 npm·jsr 거절 함수: 제품 코드에서 쓰는 곳이 없음(`mod.ts` export와 test뿐).
- 08: `session/rewind/record.ts`의 `recordBeforeWrite`: rewind 폴더 밖에서 부르는 곳이 하나도 없음(grep). file tool 배선이 빠진 코드.
- 08: 매일 backup을 만드는 `createBackup` 호출: daemon 조립에서 찾지 못함(정의와 tick만 있음).
- 09: wording key 2,503개 중 505개를 쓰는 곳이 없음(roles 298, settings 101, confirmation-window 49, conversation 20, things-to-confirm 13, common 11 외). 동적 key 조합은 못 셌다.
- 09: dock, Roles, 계정 흔적: wording `roles.*` 298키, `conversation.title.dock`, `project-workspace.label.avatar-icon-roles`·`avatar-icon-dock`, `settings.accounts.*`·`settings.label.accounts-for`·`account-name`·`next.add-account`, `confirmation-window.*account*`, 아이콘 이름 `conversationIcons.dock`·`lophnSpaceIcons.roles`, `renderer/conversation/dock-retired_test.ts`, `question-strip-retired_test.ts`, `agent-composer.tsx` 머리 주석의 "dock용 composer".
- 09: `settings.button.ask-lophn`(쓰는 곳 없음).
- 06: `renderer/desktop/coding-links/coding-links_test.tsx`: test만 있고 쓰는 화면이 없음.
- 06: `stdin_after_ready` 경로: OpenClaw만 쓰는데 readiness 값이 없어 시작하지 않음.
- 10: context 판 `rollback` command: source에 있으나 화면에서 부르는 곳이 없고 [History] 단추는 [Ask]의 별칭.
- 10: `core/projects/contexts/handoff.ts`의 요청 글이 옛 tool 이름 `context.read_contract`를 적음(S4 이름은 `context.get`). 같은 글에 "Do not edit the documents"가 있음.
- 11: `base/redaction/samples.ts`(`redactSample`, `samplePathsAllowed`, `REDACTION_SAMPLE_*`): 제품 사용처 없음.
- 11: Settings 연결 코드가 core 시작 실패를 모두 `failed-start`로만 세어 `failed-schema`·`failed-sandbox`가 type과 launcher 화면에만 있고 어디서도 세워지지 않음(`shell/main/desktop/core/connection.ts` 170행).
- 11: 복구본을 만들기만 하고 지우는 코드가 없음(`core/storage/migration/recovery.ts`).
- 11: 제품 core가 `openRuntime`에 `doctor`·`diagnostics`를 넘기지 않아 `diagnostics/check`·`diagnostics/list` read가 등록되지 않음(Settings 진단 탭이 부르는 route가 제품에 없음).
- 12: `packages/design/components/author-mark`(`AuthorMark`): `shell`·`sdk` test가 아닌 코드에서 쓰는 곳이 없음(grep 0건).
- 12: `packages/sdk/ui-reading/document-address.tsx`(`DocumentAddress`): 쓰는 곳이 예제(`examples/weekly-report.tsx`)뿐.

## 5. 코드를 더 읽어야 아는 것 (형식에 없는 장)

영역 worker가 "확인 못함"으로 둔 것 가운데 사람이 정할 일이 아니라 코드나 조사 문서를 읽으면 답이 나오는 것이다.

- 01: `events` 표를 읽는 약 42개 파일 각각이 상태 근거인지 test 보조인지. `ProblemOpened`·`ReleaseActivationFailed`·`TicketCompletionReported`의 payload가 Reactor handler에 충분한지.
- 02: `RestartObservation`의 소비처(`storage/migration`의 재시작 점검)가 새 설계에서 남는지. renderer의 `overlay`와 `ask-agent-toast`가 toast를 띄우는 방식(새 toast가 그 위에 올라가는지).
- 03: shell의 session 목록과 sidebar(`conversation/header/session-popover.tsx` 등)가 call로 열린 session을 어떻게 보이는지. `protocol/events`의 `Run*` payload에서 `source`가 어디까지 쓰이는지. e2e에 agent끼리 부르는 flow가 있는지. `driver.ts`·`product-driver.ts`는 앞부분만 읽음.
- 04: `roles/*` 순수 함수의 동적 import와 문자열 참조. 렌더러 테스트와 e2e.
- 05: `cap-secret`의 `use()`가 요구와 얼마나 다른지(전송 쪽 `platform secret.send`까지 안 읽음). `core/apps/data`·`tickets`·`packages`·`releases` 내부와 shell의 `feedback.ts`는 필요한 부분만 훑음.
- 06: Codex·Gemini CLI·OpenCode·pi가 앱 source 폴더 안 project 설정으로 hook을 받는지(catalog는 사용자 전역·`unverified`, 조사 문서 `coding-agent-harness-integration` 9절을 안 읽음). Hermes `.hermes/skills`는 `[미확인]`. `core/main/daemon/core.ts`(2.7k줄 이상)의 coding 조립과 `core/apps/runtime/connect.ts`, `connections/operations.ts`, `preview/service.ts`의 `coding_agent` 사용. `core/apps/tickets/reads.ts`·`checks.ts` 세부. 줄 수에 test와 fixture가 섞인 곳이 있음.
- 07: `core/main/worker/test-runner.ts`의 reproduction·closing·work 분기와 `core/main/daemon/core.ts`의 problems 조립 범위. 사용자 package와 npm·jsr 의존의 `lock.ts`·import map·`packagesUsage` 입력 처리(`SDK_VALUE`가 `@lophn/…`만 받는지). `package update가 기존 앱 의존을 바꾸지 않는다`(req-1008)가 구조상 맞는지. `ledger-id`·`verification`·`maintenance-entry`가 backup과 함께 지워지는 범위. 실패 payload에 읽을 실패 근거가 더 필요한지(`releases/reads.ts`). 코드를 실행하지 않아 test 통과 여부는 모름.
- 08: project 폴더 겹침 규칙과 폴더를 찾을 수 없을 때(req-1472)의 현재 구현(`registry/work.ts`, `scan.ts`). `blobs/purposes.ts`의 "document_files" 같은 용도 문자열과 `categoryOfPurpose` 예시 주석이 실제 등록으로 남았는지. `core/supervision`의 `responsiveness/measure*.ts`가 제품 코드인지 측정 도구인지. `shell/main/desktop/core/connection.ts`·`supervise.ts`의 시작 실패 안내 화면(req-0054 gap). 이미지·pdf를 보는 라이브러리를 번들이 이미 쓰는지. 서버 `Host`·`Origin` 검사(`core/server/request.ts`)는 두는 쪽으로 봄(req-0211은 남음).
- 09: 읽지 못한 곳: `renderer/conversation` 안쪽 대부분, `renderer/editor` 본문, `renderer/terminal` 본문, `renderer/workspace/contexts` 85 files 안쪽, `design/components` 상세. req-0091·0092·0062·0064·0067은 코드에 이미 있다고 보고 목록에서 뺐으나 동작을 돌려 보지는 않음. req-0065의 "lophn scrollbar component"는 코드가 `design/base.css`의 `::-webkit-scrollbar` 규칙이고 `renderer/workspace/tab-strip/tab-strip.module.css`가 `scrollbar-width: none`을 씀(같은 파일 주석과 어긋남). wording 미사용 key 505개는 조합해서 만드는 key를 못 걸렀음.
- 10: `documents/worker` 계열 process 종류 이름이 `protocol/supervision`의 어느 표에 있는지(`supervision_test.ts:229`에서 `"documents"`만 확인). S1이 "있음"이라 한 Reactor의 지금 모양(실제로 event에 반응하는 구독자는 `assignments/reactions.ts` 하나뿐). `first-project_test.ts`·`save_test.ts`·`read-edit_test.ts`에서 새 설계에도 맞는 갈래. `core/lophn-agent/tool-judgment`가 `document.get`을 읽는 부분의 위치. 테스트 파일과 testdata, wording 키 수(정규식 근사값). UI worker가 grep으로 확인한 "이미 없음"과 "그대로 남는 것" 목록은 10 확인 못함의 맨 끝.
- 11: req-0613(최소 길이보다 짧은 값은 secret으로 등록하지 않음)을 막는 코드의 위치. req-0605의 "같은 표시 하나"가 `REDACTION_REPLACEMENT = "*"`로 지켜지는지. req-0366(필수 선택이 비면 그 기능만 시작하지 않음)을 provider·model 선택 쪽이 지키는지. `core/config/model.ts`의 `offlineAllowed`·`requiresOwnerCheck`·`validateConstraints`의 `secret_source` 같은 쓰이지 않는 함수. `core/diagnostics/log.ts`의 redaction 통과가 crash 기록에도 적용되는지, crash 기록을 따로 쓰는 코드. shell의 update 적용 통로와 core의 정상 정지 메시지(`stop`)의 관계(parent.ts의 update 처리 줄). lophn이 꺼지면 coding agent PTY process도 끝난다(S1 10장)와 core 쪽 회수 순서.
- 12: `view_session`을 agent-context 밖(제보 첨부, screenshot 등)에서 쓰는지. wording key `common.notice.asks-first`·`waiting-confirmation`을 shell confirmation 화면이 쓰는지. `design/components/tree`·`sheet`·`chip`이 어느 화면에서 쓰이는지(test가 아닌 파일 1곳씩). 개발 build(`scripts/build-ui.ts.tmpl`)와 release build(`ui-build/build.ts`)가 같은 SDK component 결과를 내는지. `@lophn/blueprint` type 의존을 `confirm`이 사라진 뒤 유지할지 줄일지.
