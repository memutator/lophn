# 옛 요구 대비 주제 분류 (2026-10-15)

옛 요구의 주제마다 새 판에서 어떻게 되었는지 대략 나눈다. 요구 하나하나를 대응시키지 않고, 코드도 보지 않았다. 구현 계획에서 "무엇을 새로 짜고, 무엇을 통째로 지우고, 무엇에서 일부만 빼는지"를 먼저 잡는 데 쓴다. 자세한 코드 경로는 `changes.md`에 있다.

- 기준: 옛 요구 파일 86개(agent-review worktree의 `docs/requirements/`, main `fc84298d`와 같다). 파일 하나를 주제 하나로 본다.
- 만든 법: migration 기록이 있는 영역(apps, coding-agent, problems, platform 일부)은 program이 주제마다 옛 줄 → 새 요구 → status를 셌다. 판정은 영역별 worker(sonnet-high 다섯)가 옛 문서와 새 요구, `notes/removed.md`, `changes.md`를 견줘 냈고 lead가 확인했다.
- 판정은 기능 기준이다. rejected여도 이유가 "세부 수치", "구현 품질", "합쳤다"이면 기능이 빠진 것이 아니다.

| 판정 | 뜻 | 수 |
|---|---|---|
| 아예 덜어냄 | 주제 전체를 지운다 | 6 |
| 보류 | 주제 전체를 지금 만들지 않는다 | 5 |
| 바뀜 | 주제는 남지만 모델이 바뀌어 다시 짠다 | 27 |
| 일부 덜어냄 | 주제는 남고 특정 기능만 뺀다 | 28 |
| 그대로 | 주제와 핵심 동작이 남는다 | 20 |

| 영역 | 아예 덜어냄 | 보류 | 바뀜 | 일부 덜어냄 | 그대로 |
|---|---|---|---|---|---|
| apps (12) | | 2 | 5 | 4 | 1 |
| coding-agent (8) | | | 5 | 3 | |
| problems (8) | 2 | | 2 | 4 | |
| documents (9) | 4 | | 1 | 2 | 2 |
| platform (14) | | 2 | 4 | 6 | 2 |
| lophn-agent (27) | | 1 | 9 | 6 | 11 |
| shell (8) | | | 1 | 3 | 4 |

## 1. 새로 생긴 주제

옛 요구 어디에도 없던 것이다.

| 주제 | 한 줄 | 근거 |
|---|---|---|
| agent call protocol | agent 사이의 모든 부름이 call 하나다. 받는 곳·답 방식을 고르고, 보낸 쪽은 막히지 않고, 실패 이유·취소·dedup이 있고, 글과 근거 링크만 간다. 받은 session에 보낸 쪽, 보낸 session에 call 상태가 보인다 | req-1490, 1499~1506, `specs/agent-call.md` |
| grant 셋과 Gate | 앱 grant(activation 한 번), agent grant(할당 때, 대상마다 묻는지), reaction grant(Settings, domain event마다 session을 열지·물을지). Gate가 막음·실행·물음으로 판정한다 | req-1492~1494, `architecture/approval.md` |
| request 두 길과 대기 목록 | 물음은 turn 안 request와 보류 request로 나뉜다. 원래 일이 끝나면 cancelled로 닫는다. 모든 session의 대기 요청을 한 목록과 toast로 본다 | req-1495, 0315, 0318, 0319, 1498 |
| 앱 rewind | write·external·앱 시작 invocation마다 SDK가 앱 DB changeset을 떠서 core에 넘기고 고른 시점까지 거꾸로 되돌린다. 앱은 되돌림 app-api를 두지 않는다 | req-1496, 1497, 0821 |
| App Engineer coordinator | App Engineer가 blueprint와 의존을 정하고, ticket으로 coding agent에게 맡기고, 완료 보고를 검증해 사람에게 올린다. 완료 보고·claim 만료·보고 없는 끝·coding agent의 CLI 메시지가 입력이다. Operator는 앱 수리를 call로 맡긴다 | req-1450~1457, 1491 |
| 사람 annotation → App Engineer | 앱 화면에 요소 클릭·영역 끌기로 메모를 달아 모아 보내면 App Engineer session 메시지가 되고 ticket 근거로 붙는다 | req-1486~1488 |
| toast에서 agent 부르기 | 결정적으로 판정한 사건의 toast에서만 근거가 붙은 agent session을 연다(계약 위반 → Project Manager 등) | shell req-0083, 0086 |
| 사용자 package 내기 | App Engineer가 앱 코드 일부를 `@me/…` package로 내고, test를 통과한 것만 읽기 전용 사본으로 올린다 | req-1001~1009 |
| 앱 Operator의 앱 data 파일 쓰기 | 앱 data를 정한 project 폴더에 파일로 쓰면 문서가 된다 | req-0046, 0047 |
| 문서 = 디스크 파일 | 흔한 확장자를 거의 다 열고(text는 고치고 이미지·pdf는 보기만), project 밖 파일도 연다 | req-0001, 1474 |

## 2. 아예 덜어냄과 보류

| 주제 | 판정 | 한 줄 | 근거 |
|---|---|---|---|
| documents/addressing | 아예 덜어냄 | 문서 주소 체계, 이름 예약, 옛 주소 안내 | removed.md 1 |
| documents/file-tracking | 아예 덜어냄 | watch·scan·version 준비, hash 비교 원자 저장. 문서는 디스크 파일 그대로다 | removed.md 1 |
| documents/formats | 아예 덜어냄 | format module, 저장 검사, section 추출. md 제목 파싱만 contexts의 parser 하나로 간다 | removed.md 1, req-1484, 1485 |
| documents/versions | 아예 덜어냄 | 문서 판, 이전 판 restore, export, 판 주소. context 계약의 판(r1, r2)은 남는다 | removed.md 1 |
| problems/problem-codes | 아예 덜어냄 | 예상 실패 code 선언, 이름 형식, 예약어. 보고는 이름과 message면 된다 | changes.md 2 problems |
| problems/snapshots | 아예 덜어냄 | 증거 snapshot의 수집·저장·한도. 발생 근거(stack, log, release)만 남는다 | changes.md 2 problems |
| apps/automations | 보류 | 앱 automation 전부(주기, 시작 때 한 번 포함) | removed.md 2 |
| apps/agent-context | 보류 | 앱 화면 상태를 agent에게 넘기기는 보류, agent가 화면에 다는 메모는 지움. 둘이 같은 코드(`screen-context.ts`)라 둘 다 지운다(보류는 코드도 지운다, 2026-10-15) | removed.md 1, 2 |
| platform/install-and-update | 보류 | 설치, 단일 instance, update | removed.md 2 |
| platform/notifications | 보류 | notification 기록과 읽음 화면. toast와 reaction grant가 일부를 맡는다 | removed.md 2 |
| lophn-agent/scheduling | 보류 | Operator 주기 실행(옛 파일도 비었다) | removed.md 2 |

## 3. 바뀜 (다시 짠다)

| 주제 | 옛 → 새 | 근거 |
|---|---|---|
| apps/permissions | 범위별 승인 → activation 때 만든 앱 grant와 Gate. 문서 저장 권한은 지움 | req-0859, 0860, 1492 |
| apps/connections | 앱 쌍 허락과 직접 통로 → 선언, 앱 grant, core 경유 | req-0802, 0887, 0915 |
| apps/invocations | 직접 호출과 후행 기록, confirm → core 경유 기록. write·external·실패한 읽기·앱 시작만 남긴다 | req-0887, 0893, 0894 |
| apps/runtime | 직접 호출 통로 → core 경유. rewind를 더한다. process 격리와 정지는 그대로 | req-0850~0857, 1496 |
| apps/releases | commit 하나에서 고정한 bundle, 필수 검사 넷, 선언이 넓어지지 않으면 묻지 않고 activate | req-0806, 0817, 0825 |
| coding-agent/connection | 사람이 연결해 keychain에 둔 자격 → session마다 앱 하나 범위 token을 환경 변수로, 끝나면 회수 | req-1052, 1061, 1062 |
| coding-agent/sessions | 사람이 시작·허락 → App Engineer가 맡기면 터미널 탭에 TUI로 띄움. 맡기지 않은 외부 session 연결은 뺌 | req-1091, 1095, 1098 |
| coding-agent/mcp-server | MCP server를 지우고 test, preview, release 준비, 상태·log·문제 읽기를 CLI로. app-api 호출, SDK 검색, 앱 밖 tool은 뺌 | req-1132~1149 |
| coding-agent/repair-context | 수리 자료 묶음을 밀어 넣기 → App Engineer가 ticket에 핵심을 적고 coding agent가 CLI로 골라 읽음 | req-1359, 1361, 1377 |
| coding-agent/tickets | App Engineer가 만들고 맡긴다. 조건은 lophn이 돌리는 것과 글 조건, 확인됨은 App Engineer가 정한다. 준비 상태·고정 규칙·ticket 화면은 뺌 | req-0728~0749 |
| problems/closing | 자동 닫기 규칙과 닫힘 근거 넷을 지우고, 해결됨·무시는 App Engineer나 사람이 정한다. 재발하면 다시 연다 | req-0154, 0168 |
| problems/repairs | 문제에 붙던 고친 기록 → ticket 완료 보고에 고친 문제를 잇는다 | req-0744 |
| documents/projects | 등록·보관·폴더는 남고 tracking 규칙이 빠진다. 문서는 디스크 파일이다 | req-0001, 1471~1473 |
| platform/approvals | 결정은 grant 때, Gate가 막음·실행·물음. 기한, 사람 취소, 재요청 금지, 필수 설명을 뺀다 | req-1492~1495, approval.md |
| platform/ledger | ledger는 반응할 domain event만. 화면은 Bus를 조건으로 받고, toast는 renderer가 정한다. 요구 파일 없이 spec으로 정했다 | specs/event.md, changes.md 2 |
| platform/secrets | OS keychain → lophn data 폴더의 secret 파일(0600). 머신 이전 export·import는 지움 | req-0400, 0407, 0408 |
| platform/settings | 쓰는 요소가 자기 이름 아래 항목을 선언하고 두 층만 합친다. 설명 메타, apply 판, 충돌, import·export, 변경 기록을 뺀다 | req-0350, 0354, 0381 |
| lophn-agent/agents | 권한 상한·교집합 → agent grant. 설정 층은 전역·project·Operator | req-0038, 1493 |
| lophn-agent/assignments | assignment 상태 machine → place에 놓인 agent | req-0030~0032 |
| lophn-agent/handoff | 고정 방향 handoff → grant로 정하는 call | req-1490, 1499~1505 |
| lophn-agent/harness/run-loop | 입력이 Router 한 입구로 들어오고, call 답은 새 입력으로 온다 | req-1499, event.md |
| lophn-agent/harness/tool-judgment | allow·ask·deny → grant 기준의 Gate(막음·실행·물음) | req-1492, 1493, 0317 |
| lophn-agent/harness/waiting-and-recovery | 재시작 때 자동 복구 → 돌던 turn을 interrupted로 닫는다 | event.md 7 |
| lophn-agent/observability | agent event를 저장하지 않으니 trace를 어디 남길지 다시 정한다(7장) | event.md |
| lophn-agent/revert | run 단위 revert → session 동안만. 앱 data는 core changeset으로 시점 단위 | req-0044, 1496, 1497 |
| lophn-agent/roles/app-engineer | 설계 문서 작성자 → ticket으로 coding agent를 부리는 coordinator | req-1450~1457 |
| shell/confirmation-window | 별도 modal 창 → request 카드, toast, 대기 목록. 사람만 결정하는 것은 그대로 | req-1498, approval.md 4 |

## 4. 일부 덜어냄 (이것만 뺀다)

| 주제 | 뺄 것 | 근거 |
|---|---|---|
| apps/blueprint | automation, confirm 칸, revert 칸, 남길 문서, 설명 질 검사. 효과는 read·write·external 셋 | req-0700, 0706, 0708·0714 폐기 |
| apps/data | 복구본 여럿 → 앱마다 하나(activation 뒤 자동 삭제). data export | req-0954, 0961 |
| apps/registration | 앱 문서 주소, 기획 문서 판 참조 | removed.md 1 |
| apps/sdk | cap-save, format, cap-schedule, 화면 상태 client(agent-context와 같은 코드). secret client는 원값을 받지 않게 바뀐다 | req-0500~0514, changes.md 3 |
| coding-agent/cli | MCP 설정 출력, daemon 시작·중지, skill 설치·점검, 문제 닫기 링크. ticket 명령과 App Engineer 메시지는 남는다 | req-1207~1213 폐기 |
| coding-agent/guides | 시작 summary, 앱마다 안내 파일 배포, MCP 안내. 첫 prompt는 ticket 하나만 가리킨다 | req-1103~1114 |
| coding-agent/harnesses | MCP·지침 설치, receipt, 환경·profile 분리, 시작 summary hook. adapter, 감지, skill 설치는 남는다 | req-1075~1083 |
| problems/feedback | screenshot·화면 상태 한도, 첨부 규칙. 글이나 annotation으로 제보하는 것은 남는다 | req-0172 |
| problems/grouping | 세부 묶기 규칙. 이름(없으면 오류 이름과 source 위치)으로 묶고 수와 시각을 센다 | req-0146, 0152 |
| problems/reporting | redaction·idempotence 같은 세부 장치. 직접 보고, 처리되지 않은 오류, 발생 근거는 남는다 | req-0106, 0109 |
| problems/tests | reproduction test, problem code test, 약화 검사. app test와 필수 검사 넷은 core-app-releases로 | req-0817, 0818 |
| documents/contexts | outline kind는 파일 하나에 개체 하나로 바뀐다. 계약·검색·위반·saved view는 남는다. context index(`core/projects/contexts/index`)는 위반 감지에 쓰여 남는다(옛 줄의 "index store"는 outline-and-search의 목차 색인을 뜻했다) | req-0011, 0012, 1484 |
| documents/outline-and-search | agent용 목차, 부분 읽기, cursor, 건너뛴 파일 알림. md 목차는 저장하지 않고 쓸 때마다 parser 하나로 | req-1476~1480, 1484, 1485 |
| platform/api | API major, 호환 규칙, 구독 재생 위치 | req-0200, 0202 |
| platform/backup-and-migration | backup, restore, 자동 backup, 복구본 사람 확인 삭제. schema step은 남는다 | removed.md 1, req-0052~0057 |
| platform/diagnostics | 보안 상태 점검, 보안 사건 구분 | req-0457, 0460~0465 폐기 |
| platform/identity | Host·Origin 검사, 발급 규칙, 존재 숨김. token이 호출자와 범위를 정하고 회수하면 거절하는 것은 남는다 | req-0205, 0206, 0212~0215 폐기 |
| platform/redaction | 실패 때 원문 차단, 화면 상태 문자열 규칙. 가림 규칙은 base로 | req-0600~0613, 0610 폐기 |
| platform/security | threat model 서술, body 상한, 의존성 고정 규칙. loopback과 token은 남는다 | req-0219 |
| lophn-agent/harness/model | role별 기본 model, 요약용 model 칸 | core-config 0360·0361 폐기 |
| lophn-agent/harness/prompt-assemble | 요약용 model, 앱 화면 상태 넘기기 | removed.md 2 |
| lophn-agent/harness/tools | 문서 판·목차·format·series·앱 메모 tool | removed.md 1, changes.md 3 |
| lophn-agent/roles/common | 문서 version 저장·형식 검사, [Start]로 coding 시작 | removed.md 1, req-1453 |
| lophn-agent/roles/lophn | 문서 위치 추천, 직접 ticket 만들기 | removed.md 1 |
| lophn-agent/roles/operator | 출력 제한, 문서 판 쓰기 | req-0031, 0047 |
| shell/desktop | 확인할 것(지난 일) 화면, notification 기록, Roles 화면, 대화 dock, provider 계정 | removed.md 1, 2 |
| shell/editor | 버전 비교, 버전 확정, 정보 패널의 버전 탭, file-tracking 연결 | removed.md 1 |
| shell/workspace | 시각 블록 가운데 표·차트·도표(MVP 밖. 앱 카드는 남는다, 2026-10-15), 앱 화면 상태(보류). Context·Agent·Agents 탭은 남는다 | removed.md 2 |

## 5. 그대로

"새 요구 없음"은 요구로 쓰지 않았을 뿐 지운 기록도 없다는 뜻이다. 지금 코드를 그대로 둔다.

| 주제 | 한 줄 |
|---|---|
| apps/preview | 격리 process와 일회용 DB. automation 시계, confirm 줄, documents 대역, 직접 연결을 받는 shell main 쪽이 빠진다 |
| documents/series | 다음 이름 계산(`contexts/series/next.ts`)만 남는다. series registry(가족, draft, 보관)는 지운다 |
| documents/terms | context 용어집 |
| platform/responsiveness | child 하나가 다른 child와 core를 막지 않는다(req-0251). 나머지는 구현 품질 |
| platform/blob-store | 새 요구 없음. 쓰던 곳(문서 판, snapshot)이 지워져 쓰임이 줄었다(7장) |
| lophn-agent/commands | `/` 세 종류(harness, prompt, skill) |
| lophn-agent/conversation | session 이름, archive, delete, toast로 시작 |
| lophn-agent/extensions | skill·MCP 층이 전역·project·Operator. skill 꺼짐 표시와 다음 turn부터 반영 |
| lophn-agent/harness/provider | provider마다 연결 하나(계정, 내장 로컬 provider는 이미 빠짐) |
| lophn-agent/instructions | project의 LOPHN.md를 읽고 AGENTS.md는 읽지 않는다 |
| lophn-agent/roles/context-engineer | 계약, 검색 script, 경계, 용어집. 2026-10-15에 Project Manager로 이름이 바뀌고 project마다 하나가 되었다(req-0035) |
| lophn-agent/evaluation | 새 요구 없음(eval 몫) |
| lophn-agent/harness/safety | 새 요구 없음. 반복 실패 차단, 자료 경계 |
| lophn-agent/harness/usage | 새 요구 없음. 호출별 사용량·비용 기록 |
| lophn-agent/questions | 질문 카드. 사람에게 올림은 call도 approval도 아니다. 2026-10-15에 사람에게 묻는 tool과 대기 목록 요구가 생겼다(req-1510, 1498) |
| lophn-agent/visuals | 앱 카드만 남긴다. 표·차트·도표 블록과 `visual.prepare_document`는 지운다(2026-10-15) |
| shell/app-frame | 새 요구 없음. view 격리, overlay, 문제 알리기 |
| shell/design-system | 새 요구 없음. token, 색, 간격, component 규칙 |
| shell/terminal | 새 요구 없음. 일반 터미널. coding TUI는 App Engineer가 맡길 때 연다 |
| shell/wording | 새 요구 없음. en 문구, message key 규칙 |

## 6. 같이 고친 것

- `notes/removed.md` 3장의 "승인에 Always allow를 두지 않는다"는 낡은 줄이었다. approval을 정하면서 "항상"(그 grant를 묻지 않음으로 바꿈)을 두었다(docs-review 12장, req-0317). 그 줄을 고쳤다.

## 7. 확인할 것

판정하면서 문서만으로 가리지 못한 것이다.

- **context 보관:** 정함(2026-10-15). 보관한 context는 검색·위반 알림에서 빠진다. 지금 코드대로 둔다.
- **blob-store:** 정함(2026-10-15). 남긴다. 남는 쓰임(ticket, release_backup, package_version, approval, context content, report, 대화 기록, question)이 많다. 지워지는 소유처의 등록만 걷는다.
- **trace 저장(observability, usage):** 정함(2026-10-15). 호출별 사용량·비용 기록은 남기고 저장 위치는 refactor session이 정한다. trace export는 지운다.
- **conversation의 steering, 다음 요청 queue:** 정함(2026-10-15). 사람 메시지는 기본으로 다음 turn, 사람이 steer를 고르면 도는 turn에 들어간다(req-1509, S3 4장). **Fork:** 정함(2026-10-15). built-in command로 남기고 recap을 더한다(S4 7장). fork의 세부는 S8.
- **전역·앱 층 LOPHN.md:** 정함(2026-10-15). 전역 지침은 있다(S4 5장). 앱 층 지침은 없다.
- **visuals:** 정함(2026-10-15). 앱 카드만 남긴다(PRODUCT.md의 "앱의 부품"은 앱 카드다).
- **sdk UI kit:** 정함(2026-10-15). 요구를 만들지 않고 지금 코드(`sdk/ui-*`, `tokens`, `design`)를 그대로 둔다.
