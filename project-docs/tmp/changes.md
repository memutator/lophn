# 변경 인덱스 — 리팩터링과 구현 계획용 (2026-10-14)

문서화 session이 정한 것 가운데 **코드가 따라가야 할 것**을 한곳에 모은다. 정본은 `../requirements/`의 `accepted` 요구이고, 왜 그렇게 정했는지는 `docs-review.md`의 해당 절에 있다. 코드 경로는 2026-10-14 main(`acfe4cc3`, src layout 뒤) 기준이다.

> **2026-10-15:** 코드 쪽 할 일의 전수 목록은 `implementation-inventory.md`(UI 밖, 칸별: 덜어낼 것, 고칠 것, 새로 만들 것)와 `ui-inventory.md`(UI, 화면별)가 대신한다. 열린 물음의 결정은 `inventory/00-decisions.md`다. 이 문서는 색인으로만 남긴다.

읽는 법:

- **rejected를 다 지우라는 뜻이 아니다.** 폐기 이유가 "지운 기능", "바뀐 모델"이면 코드도 지우거나 고친다(이 문서 3, 4장). "구현 품질", "세부 수치", "합쳤다"면 요구에서만 뺀 것이고 코드는 그대로 둬도 된다.
- **옛 요구의 주제마다 어떻게 되었는지(새로 생김, 아예 덜어냄, 보류, 바뀜, 일부 덜어냄, 그대로)는 `changes-by-topic.md`에 있다.**
- **accepted의 `impl`은 대부분 비어 있다.** 아직 코드와 대조하지 않았다는 뜻이다(1장 표).

## 1. 요구 현황

2026-10-14 기준 수다. 그 뒤로 요구가 더해지고 바뀌었다(docs-review 2026-10-15).

| 파일 | accepted | impl done | partial | todo | 대조 안 함 | rejected |
|---|---|---|---|---|---|---|
| base | 11 | | | | 11 | 3 |
| core-storage | 5 | 3 | 2 | | | 0 |
| core-server | 7 | | | | 7 | 15 |
| core-supervision | 2 | | | | 2 | 0 |
| core-secrets | 10 | | | | 10 | 3 |
| core-diagnostics | 5 | | | | 5 | 11 |
| core-config | 6 | | | | 6 | 26 |
| core-approvals | 14 | | | | 14 | 11 |
| core-projects | 10 | | | | 10 | 5 |
| core-contexts | 28 | | | | 28 | 1 |
| core-problems | 9 | | | | 9 | 91 |
| core-apps | 13 | | | | 13 | 13 |
| core-app-releases | 16 | | | | 16 | 19 |
| core-app-runtime | 37 | | | | 37 | 68 |
| core-app-data | 10 | | | | 10 | 4 |
| core-app-tickets | 17 | 2 | | | 15 | 15 |
| core-package-registry | 8 | | | | 8 | 2 |
| core-lophn-agent | 35 | 2 | 3 | 3 | 27 | 0 |
| coding-agent | 42 | | | | 42 | 97 |
| coding-agent-cli | 10 | | | | 10 | 9 |
| sdk | 10 | | | | 10 | 4 |
| shell | 39 | | | | 39 | 0 |

proposed는 없다. 모든 요구가 사람 확인을 거쳤다.

## 2. 구조 변경 (새로 짜거나 크게 바꾸는 것)

| 주제 | 정한 것 | 근거 | 코드 쪽 할 일 |
|---|---|---|---|
| **event** | 일어난 일을 셋으로 나눈다. domain event(ledger에 남고 Reactor만 읽음, 10개), agent event(메모리, 저장과 replay 없음), 남지 않는 event(`ApprovalRequested`). core에는 일반 바뀜 알림도, toast(`notice`)도 없다. 화면 반응은 renderer가 정한다. 부품은 command 층, Ledger, Reactor, Bus, Router, Gateway다 | `specs/event.md`(S1), docs-review "S1 event 핑퐁" | Bus를 새로 두고 Gateway가 ledger 대신 Bus를 조건(session, 종류)으로 걸러 보내게 한다(`packages/core/events/subscribe.ts`). ledger(`packages/core/storage/ledger`)에는 domain event만 쓰고 event type 약 150개를 10개로 줄인다. command 층은 domain event를 같은 tx에 쓰고 commit 뒤 Bus에도 낸다. run 출처에 program(근거 seq)을 더한다. renderer는 기능마다 흩어진 구독과 toast(`workspace/contexts/context-watch.ts`, `violation-toast.tsx` 등)를 event client 하나, store 층, 반응 층으로 모은다. `ask-agent-toast.tsx`는 부르는 곳이 없어 지우고, `workspace/notice-card.tsx`는 event를 쓰지 않아 그대로 둔다 |
| **approval과 grant** | 결정은 grant 때 몰아서 하고 실행 때는 grant를 믿는다. Gate가 막음, 실행, 물음 중 하나로 판정하고, request는 turn과 보류 두 길로 나뉜다 | `architecture/approval.md`, docs-review 12장, req-1492~1495, 0300~0319, 0825, 0859, 0860, 0873, 0887, 0915 | `packages/core/approvals`(약 7.7k줄)의 범용 적용 엔진을 Gate, request 두 길, 결정 command로 줄인다. `packages/core/apps/permissions`의 `grants`는 activation 한 번으로 만드는 앱 grant로 바꾸고, 옛 kind(`document.save`, `agent.commands`, `automation.run`)를 지운다. 할당 때 정하는 agent grant와 Settings의 reaction grant를 새로 둔다. app-api 호출은 모두 core를 거친다 |
| **rewind** | write·external·앱 시작 invocation마다 앱 process의 SDK가 앱 DB 변경(SQLite changeset)을 떠서 core에 넘기고(core는 보관하고 뒤집는다, S5), rewind는 고른 지점부터 최신까지 거꾸로 되돌린다. 앱은 되돌림 app-api를 두지 않는다. 앱 data는 앱 DB 하나다 | req-1496, 1497, 0893, 0821, 0706. 0714 폐기 | `packages/core/apps/revert`(worker), SDK `packages/sdk/cap-schedule/revert.ts`의 `withRevert`, blueprint command의 `revert` 칸을 지우고 core의 changeset 저장과 역적용으로 바꾼다. Deno `node:sqlite`에는 invert가 없어 뒤집기는 직접 만든다. app test가 core 되돌림을 검사한다(0821) |
| **coding agent 연결** | 통로는 CLI 하나다. 터미널 탭에 TUI로 띄우고, 신호는 앱 source 폴더의 harness 설정에 둔 hook으로 받는다. token은 session마다 앱 하나 범위로 만들어 환경 변수로 넘기고, session이 끝나면 회수하면서 claim도 반납한다. coding agent는 CLI로 App Engineer에게 메시지를 보낸다 | req-1050~1067, 1091, 1098~1101, 1491, coding-agent-cli | `packages/coding-agent/mcp-server`, `--toolsets`, MCP 설정 출력을 지운다. harness마다 adapter를 둔다. hook은 CLI의 hook 명령이 session token으로 core에 넘기고 core가 agent event로 바꾼다(req-1517, S6). Router 입력은 PTY로 넣는다. CLI에 메시지 command를 더한다 |
| **App Engineer coordinator** | 사람의 앱 개발 interface는 App Engineer 하나다. App Engineer가 무엇을 만들지 정하고(blueprint, 의존 고르기), ticket으로 coding agent에게 맡기고, 완료 보고를 검증해 사람에게 올린다. coding agent는 어떻게 만들지(구현, 디버깅, test, release 준비)를 맡는다 | req-1450~1457, 1454, core-app-tickets, docs-review 9~10장 | App Engineer role에 coding agent 띄우기, 맡기기, 결과 받기가 없다(req-1450 partial). blueprint와 의존을 고르는 tool을 App Engineer 쪽에 둔다 |
| **agent call** | agent 사이의 모든 부름은 call 하나의 모양이다: 받는 곳(새, 열린, 열린·없으면 새 session), 답(none, result, conversation), 보낸 쪽은 막히지 않음. event와 approval은 기존 모양을 탄다. 정책은 `../products/AGENT-ROLE.md`, 구조는 `specs/agent-call.md`(S3) | req-1490, 1499~1506, 1491, 1454, 1494, 1495, 1498 | `packages/core/lophn-agent/tools/handoff`와 `packages/protocol/lophn-agent/handoffs.ts`는 옛 모델이다(고정 방향 표와 Operator 금지, 칸 넷, 문서 고정 판 근거, 사람 요청에서 이어진 run만, run 단위, 결과가 보낸 쪽을 깨우지 않음). call 봉투, `agent_calls` 표, call·reply·cancel tool, Router가 Gate를 부르는 지점(Gate 자체는 approval 줄), session 단위로 바꾼다. dedup은 살린다. coding agent 쪽은 ticket·claim·완료 보고·CLI 메시지를 call 상태에 잇는다 |
| **ticket** | acceptance check는 lophn이 돌리는 조건(app test, test command)과 App Engineer가 판단하는 글 조건으로 나뉜다. 확인됨과 확인 실패는 App Engineer가 정한다. 목표와 조건을 고정하지 않는다 | core-app-tickets 0728~0749, 1451, 1455 | 조건 모델과 확인 판정 주체를 바꾼다. claim 시작·갱신·반납 event(1400~1402)는 ledger에서 뺀다 |
| **activation** | 새 release는 그 release를 이은 ticket이 확인됨이 되면 activate된다. release 준비만으로는 시작하지 않는다. activation은 새 호출 접수를 닫고 돌던 호출이 끝나길 기다린 뒤 process를 바꾸고, 그 사이 온 호출은 붙잡았다가 넘긴다. migration이 없는 release는 선언 비교만 한다 | req-1507, 1508, 0825, 1520, S7 | release 준비 뒤 자동 activation이 있으면 지운다. ticket 확인됨이 domain event `TicketVerified`를 남기고 Reactor가 activation을 연다. drain과 앱마다 줄. data 손실은 migration 선언으로 판정한다. 자세한 순서는 S7 |
| **config** | 설정 항목은 쓰는 요소가 자기 이름 아래(`agents.`, `server.`, `shell.`)에 타입과 기본값으로 선언한다. 저장과 설정 화면은 하나다. 설정, 내용물(지침, skill), 상태를 구별한다 | core-config 0350~0381, docs-review 10장 core-config | `packages/core/config/registry.ts`가 항목마다 요구하는 설명 key(위험, 되돌리기, 효력 시점 등)를 걷어낸다 |
| **secrets** | OS keychain이 아니라 lophn data 폴더의 secret 파일 하나(0600)에 둔다 | core-secrets 0400, 0407, 0408, 0410, 0412 | keychain adapter만이 아니라 `sealed_ref` 모델(ledger `secrets` 표, CAS), I/O worker의 `secret.prepare`, cleanup, coding credential의 keychain 보관, 머신 이전 export·import를 함께 바꾸거나 지운다 |
| **problems** | 일반 관측성 수준(Sentry 정도)으로 줄인다: 직접 보고, 처리되지 않은 오류 수집, 묶기, 발생 근거, 제보, 열림·해결됨·무시, 재발 시 다시 열기 | core-problems 9개, docs-review 10장 core-problems | 증거 snapshot, 닫기 규칙, 고친 기록, reproduction test 장치, 예상 실패 선언을 지운다(91개 rejected의 대부분) |

## 3. 지울 코드 (지운 기능)

| 지울 것 | 지금 코드 | 근거 |
|---|---|---|
| 문서 주소 체계(addressing) | `packages/core/projects/addressing` | removed.md 1장, docs-review 10장 projects |
| 문서 판(version)과 file-tracking | `packages/core/projects/versions`, `packages/core/projects/file-tracking` | removed.md 1장 |
| series 화면과 registry | `packages/core/projects/series` | removed.md 1장 |
| 목차 색인과 agent용 md 목차·부분 읽기, format module의 section 추출 규칙 | `packages/core/projects/formats`, `packages/core/projects/outline-and-search`(`derived_sections` 등) | removed.md 1장. md 목차는 쓸 때마다 하나의 parser(`packages/protocol/projects/outline-markdown.ts`)로 파싱한다(req-1484, 1485) |
| backup, 모든 export | backup·restore: `core/storage/migration/{backup,backup-reads,restore}.ts`, `core/main/worker/restore-entry.ts`. export: 앱 data export(07), secret export·import(11), settings TOML(11), agent trace export | removed.md 1장 |
| place 없는 문서, 앱 문서 | SDK `packages/sdk/cap-save`, grant kind `document.save` | removed.md 1장 |
| format module | `packages/sdk/format-document` | docs-review 10장 sdk |
| coding agent MCP server | `packages/coding-agent/mcp-server`, `--toolsets`, MCP 설정 출력 | docs-review 10장 coding-agent |
| coding agent의 context 통로, 앱 밖 tool, app-api 호출 | coding agent CLI·MCP의 해당 명령 | removed.md 1장 |
| 앱 automation(보류) | `packages/sdk/cap-schedule`, grant kind `automation.run` | removed.md 2장 |
| 앱 화면 메모(agent가 다는 주석)와 앱 화면 상태(보류) | SDK `cap-schedule/screen-context.ts`, `core/apps/agent-context/`, agent tool `app.screen_context`·`app.annotate`, blueprint `agent_context`·`annotation_targets` 칸. 같은 코드라 둘 다 지운다 | removed.md 1장, 2장. 사람이 다는 annotation(req-1486~1488)은 새로 짓는다 |
| 앱 revert 계약과 worker | `packages/core/apps/revert`, `withRevert`, blueprint `revert` 칸 | 2장 rewind |
| "사람 확인이 필요한 app-api"와 confirm marker | blueprint `confirm` 칸, confirm marker | req-0909~0914, 0708 폐기 |
| 앱 직접 통로(app-direct-protocol) | 직접 socket, 서명 연결권, 앱 화면 byte(`/screens`)를 내주는 길(새 길이 필요하다) | req-0883~0892, 0919, 0920 폐기 |
| 외부 접근의 범위별 승인, 앱 쌍 허락, 앱별 agent 승인 | `packages/core/apps/permissions` | 2장 approval |
| npm·jsr import 거절 | `packages/core/apps/releases/bundle/import-map.ts` | docs-review 10장 core-apps. 정확한 version이면 허용(req-0811) |
| 필수 검사 가운데 problem code, 예외, redaction, feedback | `packages/core/problems/tests/harness/definitions.ts`(runner 3, harness 18에 선언 code마다 실패 경로가 더해진다) | docs-review 10장 core-app-releases. 남는 것은 선언과 구현 일치, 의존, migration, 되돌림(req-0818) |
| ledger의 agent 일생 event와 지운 개념의 event type | `packages/core/storage/ledger`, `packages/protocol/events` | 2장 event |
| provider 계정 기능, 내장 로컬 provider | `packages/core/lophn-agent/providers` 안 | removed.md 1장 |
| run 단위 revert, Roles 화면, 대화 dock, 화면마다 둔 agent 부르기 단추 | shell과 lophn-agent 안 | removed.md 1장 |
| role의 built-in instructions 숨은 줄 | agent editor | docs-review 3장 |
| redaction 실패 시 원문을 내보내지 않는 장치 | `base/redaction/engine.ts`의 `omitted` 분기 | base req-0610 폐기 |

## 4. 바뀐 동작 (영역별)

| 영역 | 바뀐 것 | 근거 |
|---|---|---|
| projects | 문서는 디스크의 파일 그 자체이고 project 밖 파일도 연다. VS Code처럼 흔한 확장자를 거의 다 연다. project는 폴더 하나 이상이다. 검색은 text 파일을 대상으로 하고 `.gitignore`와 `.git`을 건너뛴다 | req-0001, 1471~1480 |
| contexts | outline kind는 파일 하나의 목차 전체가 개체 하나다(지금은 제목마다 개체를 만든다). pdf·docs 목차는 Project Manager만 만들고 lophn data의 context 아래에 둔다. 다시 만드는 계기는 사람의 요청이다. section은 context 계약으로만 다룬다 | req-0012, 0011, 1484, 1485 |
| apps | "앱 정의"는 blueprint(`blueprint.ts`)다. 효과는 read(바꾸지 않음), write(앱 DB만, core가 되돌림), external(앱 DB 밖)이다. npm·jsr를 정확한 version으로 쓴다 | req-0700, 0706, 0811 |
| app-releases | release는 commit 하나에서 고정된 bundle이다. 필수 검사는 넷이다. app test는 network 없이 test DB로 돈다. 선언이 넓어지지 않고 data 손실이 없으면 묻지 않고 activate한다(data 손실은 migration 선언으로 판정하고 DB 사본에서 재지 않는다, req-1520) | req-0812, 0818, 0193, 0825 |
| app-runtime | 앱 log는 앱마다 최근 일정 양만 둔다. invocation은 write, external, 실패한 읽기, 앱 시작만 남긴다. 효과는 활성 release의 선언에서 읽는다 | req-0940, 0893, 0878 |
| app-data | 복구본은 앱마다 가장 최근 하나이고, activation이 정상으로 끝나면 자동으로 지운다. 이전 release를 골라도 DB는 그대로다 | req-0954, 0961 |
| package-registry | catalog 이름이 `package-registry`가 되었다. App Engineer가 앱 코드 일부를 사용자 package(`@me/…`)로 내고, test를 통과한 것만 읽기 전용 사본으로 올린다 | req-1001~1009 |
| sdk | 요구의 주어는 부품이다. secret client는 secret을 붙인 요청을 lophn에게 맡기고 원값을 받지 않는다 | req-0504~0514 |
| lophn-agent | composer slash command 세 종류(1489). agent 사이의 부름은 call이다: Router 입력이고 agent grant의 대상이며, 보낸 쪽은 막히지 않는다(1490, 1499~1506). 사람의 앱 annotation은 App Engineer session으로 가서 ticket 근거가 된다(1486~1488). skill은 꺼짐 표시로 끄고, 바꾸면 다음 turn부터 쓰인다(0098, 0099) | core-lophn-agent, shell |
| server | 뼈대만 둔다: loopback, 모든 호출에 token, token이 호출자와 범위를 정함, 회수된 token은 바로 거절 | req-0200~0219 |
| storage | 복구본 규칙(0057 partial: 복구본은 최신 하나, 정상 기동 뒤 지움), 기동 실패 분류(0054 partial: 세 경우를 구별해 shell이 `failed-schema`를 세움), backup·restore 삭제 | core-storage |
| lophn-agent role | Context Engineer → Project Manager(이름과 수. project마다 하나, project 등록 때 생김). App Engineer는 앱마다 하나(앱 등록 때 생김), lophn은 전체에 하나 | req-0035, 1518, 0030, S8 |

## 5. 아직 열린 것

- **req-0044:** 정함(2026-10-15). 두 되돌리기를 나누고 session rewind 화면에서 사람이 고른 앱만 되돌린다(S5 8장, S8 4장, req-1519).
- **보류(만들지 않음):** Things to confirm, Operator 주기 실행, notifications, install-and-update, 앱 automation, 앱 화면 상태(removed.md 2장). 보류는 코드도 지운다(2026-10-15 결정). 단일 instance lock과 data root 권한 검사는 core 시작에 필요해 남긴다.
- **MVP 밖:** agent의 결과를 추상화한 GUI(`../PRODUCT.md` 4절).
- **impl 대조:** accepted 가운데 329개가 아직 코드와 대조되지 않았다.
