# core E2E 후보: 제품의 사용자 흐름에서 뽑기

기준: main checkout `/home/pyosechang/projects/lophn` (HEAD `32d4e9ca1`). 코드는 고치지 않았고 test·check·provider 호출은 하지 않았다. `.claude/worktrees/`, `~/.lophn`, OS keychain은 보지 않았다. 사람이 "E2E case가 너무 부족하다"고 해서 `PRODUCT.md`, `AGENT-ROLE.md`(role별 일), role prompt와 tool 목록, protocol route에서 흐름을 뽑고 core E2E로 볼 만한지 가렸다.

이미 있는 7개: `boot`(support 확인), `file-write`, `approval`, `rewind`, `stop`, `restart`, `secret`. 전부 Project Manager(PM)나 lophn session 하나와 project 폴더로 돌고, model은 loopback fake server의 정적 대답이다.

## 0. 먼저 알아 둘 사실 (후보를 가르는 제약)

코드와 task brief에서 확인했다. 후보의 "필요한 support"는 이 제약에서 나온다.

1. **fake 대답은 정적이다.** `Step.reply`가 값이라 core가 만든 id(draft `cbn_*`, ticket `tkt_*`, call `cal_*`)를 다음 tool 인자에 쓸 수 없다. `context_submit`, `ticket`을 coding agent에게 맡기는 `call`의 ref, 받은 call에 `reply` 하는 것이 모두 여기에 걸린다. reply를 `(앞 요청 journal) => Reply` 함수로 받으면 풀린다(작다). 이름 기준으로 풀리는 것(`call`의 `to: {role, place: {project|app: 이름}}`, `sessions/open`의 client 지정 `ses_*`, `apps/create`로 test가 먼저 만든 app id)은 정적으로 된다.
2. **queue가 하나다.** session 둘이 동시에 model을 부르면(agent call의 보낸 쪽 turn과 받은 쪽 turn) 요청 순서가 갈린다. session별 queue(system prompt의 role 표지 같은 것으로 가름)가 필요하다. 사람이 session을 차례로 구동하는 flow는 지금 queue로 된다.
3. **user token으로 못 부르는 route가 앱 흐름의 길목에 있다.** `tickets/create`·`tickets/verify`·`calls/send`는 actor가 `agent`만이고, `tickets/claim`·`releases/prepare_bundle`·`tickets/report_completion`은 `coding_agent`(앱 하나 범위의 coding token)다. coding token은 Gateway `coding_terminal` open frame의 `plan.env.LOPHN_CODING_TOKEN`으로만 나온다. 그래서 **release 준비와 activation까지 가는 앱 flow는 agent session(fake model) + Gateway client + coding token client를 모두 거친다.** 앱 묶음은 coding agent 역할 묶음 위에만 선다.
4. **decision handle이 필요한 route는 user token만으로 못 부른다.** `providers/disconnect`, `providers/login-complete`, `problems/apply-decision`은 shell main(Electron) 몫이다. 이 셋을 보는 flow는 지금 범위 밖이다.
5. **`providers/connect`는 "새 Connect"다.** 같은 provider를 key만 바꿔 다시 잇는 길(key 교체)이 있는지 코드로 못 닫았다. key 교체 후보는 뺐다.
6. **Gate가 없는 tool이 있다.** `file.*`, `shell.run`, `web.*`, 읽기 tool, `ask`, `call/reply/cancel`은 Gate를 안 지난다. Gate가 걸리는 것은 app-api tool, MCP tool, `call`의 대상(agent grant), 설정 고치기(`LOPHN.md` 쓰기, `operator.create`/`update`)다. `shell.run`은 `/bin/sh`를 runtime child에서 띄워 Deno 권한이 닿지 않는다. 막는 것은 env 허용 목록(`shell/env.ts`)과 tool 결과 redaction이다.
7. **알림(toast)은 core의 몫이 아니다.** toast는 renderer 정책이다(`architecture/event.md`). core 쪽은 Gateway event와 `session_snapshots/list`뿐이라 알림 자체는 UI E2E 범위 밖이다.
8. **mixed tool 묶음은 요청 순서로 하나씩 돈다**(`run-loop/tool-batch.ts`: 모두 읽기인 묶음만 병렬). 그래서 한 reply 안에 `file_write` → `context_test` → `context_submit`을 줄 세울 수 있다.
9. **fake 대답 3 이하 규칙에서 turn 하나는 대답 둘이다**(tool 대답 + 마무리 text). 그래서 turn이 둘 이상인 flow는 쉽게 4를 넘는다. 넘는 후보에는 표시했다.
10. 맨 끝 "코드로 확인하지 못한 것"에 짐작을 모았다.

## 1. 흐름 목록과 판정

판정: **E2E**(process 경계를 건너고 깨지면 사람이 잃는 것이 큼), **행**(이미 있는 E2E file의 table 행으로), **harness/unit**(process를 안 건넌다), **범위 밖**(Electron·eval·handle). 후보 id는 3절에서 설명한다.

### lophn

| 흐름 | 건너는 process | 깨지면 | 판정 / 후보 |
|---|---|---|---|
| L1 의도가 없을 때 `ask`로 정리 | runtime child ↔ core(질문 대기) ↔ 사람 | turn이 영영 멈춘다 | E2E `ask-answer`. 질문의 내용·좋은 질문인지는 eval |
| L2·L3 기획(기존 앱·package·project 견주기, `app.list`, `package.list`) | 읽기 tool만 | 의미 판단 | harness/unit(tool registry는 core 없이 `agentTools()`로 됨). 판단은 eval |
| L4 새 앱 등록 `app.create` | runtime child → core API(agent 자격) → 앱 registry | 앱을 못 만든다 | E2E `lophn-registers-app`(지금 support) |
| L4 AE에게 call(답 없음) | 보낸 turn과 받은 turn이 동시에 돈다 | 일이 안 넘어간다 | E2E `call-handoff-new-session`(session 여럿) |
| L5 PM에게 결과 받는 call | 같음 + 답이 새 입력으로 돌아옴 | 답을 잃는다 | E2E `call-result-roundtrip`(session 여럿 + 동적 대답) |
| L6 사용법·설정 안내(`guide.read`, `settings.get`) | 없음(읽기 tool) | 오안내 | harness/unit |
| L7 앱 상태 읽기(`app.get`, `problem.list`, `ticket.list`) | 읽기 tool. 진짜 앱 상태는 앱 process | 오안내 | harness/unit. 앱 상태가 실제일 때만 앱 묶음에서 |
| L8 Operator는 직접 안 만들고 PM·AE에게 call | session 여럿 | 권한 우회 | E2E 후보 `operator-create-gated`가 Gate 쪽을 본다. call은 `call-handoff-new-session` 행 |

### Project Manager

| 흐름 | 건너는 process | 깨지면 | 판정 / 후보 |
|---|---|---|---|
| C1 context 계약·검색 만들기(`context.draft` → file 쓰기 → `context.test` → `context.submit`) | runtime child → core → context worker child(`documents/contexts`) | PM의 유일한 산출물이 안 적용된다 | E2E `context-draft-submit-search`(동적 대답) |
| C2 context 경계 긋기 | 없음(의미 판단) | - | eval |
| C3 새 판은 격리 test 통과 때만 적용 | 같음 | 틀린 계약이 적용되어 다른 agent가 틀린 정보를 받는다 | 행 `context-draft-submit-search`의 둘째 행(`context-bad-draft-kept-out`) |
| C4·C5 pdf·docs 목차 | - | - | 열린 이슈(md만 context 가능). 후보 아님 |
| C6 문서가 계약 위반 → program이 PM을 부름(reaction) | 사람 file 변경 → context worker → Reactor → Router → 새 PM session | 위반을 아무도 모른다 | E2E `context-violation-reaction`(동적 대답) |
| C7 용어집 `glossary.set` | core 안 | 용어가 바뀜 | harness/unit(`contexts_authority_test`류) |
| C8 새 project·앱이 필요하면 lophn에게 call | session 여럿 | - | `call-handoff-new-session` 행 |
| C9 Operator 만들기(`operator.create`, Gate) | runtime child → core(approval 대기) → agent 정의 file | agent가 승인 없이 Operator를 늘린다 | E2E `operator-create-gated` |
| project 폴더에 쓰기(권한) | runtime child Deno 권한 + tool scope | 폴더 밖·남의 project에 쓴다 | 이미 `file-write`. 행 `project-isolation` |

### App Engineer

| 흐름 | 건너는 process | 깨지면 | 판정 / 후보 |
|---|---|---|---|
| A1 ticket 만들기, A4 blueprint 쓰기·검사 | runtime child(앱 source 폴더 권한) → core | 앱 source에 못 쓰거나 남의 폴더에 쓴다 | E2E `ae-source-blueprint-check`(route helper 둘) |
| A5 package 고르기·pin | 읽기 tool + blueprint | - | harness/unit |
| A6 ticket을 coding agent에게 맡김 | core → Gateway `coding_terminal` frame → shell main(PTY) | coding token이 새거나 session 하나 규칙이 깨진다 | E2E `coding-token-lifecycle`(coding agent 역할) |
| A7 coding agent 메시지 | CLI → core → AE session | 메시지를 놓친다 | E2E `coding-message-to-ae` |
| A8 완료 보고 검증 → activation | coding token 쪽 + agent 쪽 + app supervisor + 앱 process | 앱이 안 올라가거나 data를 잃는다 | 앱 묶음 `app-release-activate-call` 외 |
| A9·A10 검증 실패·claim 만료·보고 없는 끝 | 같음 | ticket이 영영 열려 있다 | `coding-token-lifecycle`의 "보고 없는 끝" 부분. claim 1시간 만료는 clock이라 unit |
| A11 activation 실패 → 고칠 ticket | 앱 묶음 | data 손실 | `activation-failure-keeps-data` |
| A2·A3 problem·annotation → ticket | 앱 process → collector worker → Reactor / Electron view | 깨짐을 모른다 | `app-crash-problem-reaction`. annotation은 view 신원이 shell main이라 범위 밖 |
| A12·A13 call | session 여럿 | - | G2 |
| A14 Operator 만들기 | C9와 같음 | - | `operator-create-gated` |

### Operator

| 흐름 | 건너는 process | 깨지면 | 판정 / 후보 |
|---|---|---|---|
| O1 context·app-api로 읽고 판단 | context worker, 앱 process | 남의 data를 읽는다 | 앱 묶음 `operator-reads-app` |
| O2 project 폴더에 file 쓰기 | runtime child 권한 + scope | 다른 project에 쓴다 | 행 `project-isolation` |
| O3 project 밖 문서면 먼저 `ask` | `ask-answer` | - | 행 |
| O4·O5·O6 App Engineer·PM에게 call | session 여럿 | - | G2 |
| O7 자기 grant는 사람에게 | 의미 판단 | - | eval |

### role 밖

| 흐름 | 건너는 process | 깨지면 | 판정 / 후보 |
|---|---|---|---|
| project 만들기·보관 | core + runtime child 권한 재기동 | 보관한 project에 agent가 쓴다 | 만들기는 `openProject`가 이미 지난다. 보관은 `project-archive-revokes` |
| provider 연결(key) | core, secrets.json, runtime child, provider | key 노출 | `secret`(있음). 오류 본문의 key 되울림은 `secret-provider-error` |
| model 고르기(기본·project·session) | core → runtime child → provider wire | 엉뚱한 model로 비용·품질 | E2E `model-choice-layers` (싸다) |
| 설정(`settings/update`) | core config + runtime 재기동 | 설정이 안 먹는다 | unit(config). 실제로 child가 읽는 설정은 `skill-folder-read` |
| skill 붙이기(skill 폴더) | runtime child read 권한 | skill을 못 읽는다 | `skill-folder-read` |
| MCP 붙이기 | runtime child(allow_net·run) → MCP server(fake) | 외부 tool이 승인 없이 돈다, secret이 샌다 | G5 `mcp-external-tool-gated` |
| context 문서 | C1~C6 | | 위 PM 표 |
| ticket | A6~A10 | | G3 |
| problem 보고·수리 | 앱 process → collector worker → Reactor → AE | 깨짐을 모른다 | G4 `app-crash-problem-reaction` |
| 앱 만들기·release·activation·호출 | agent + coding token + release worker + app supervisor + 앱 process | 데이터·권한·sandbox | G4 |
| session rewind(파일) | 있음 | | `rewind`. 새 file·`file.edit`·summarize는 행 |
| session rewind + 앱 data | 앱 process | 앱 data 잃기 | G4 `app-data-rewind`, `session-rewind-with-app` |
| approval grant(허락·거절·항상) | approval 대기 | | `approval`. 항상·이 session 동안은 순수 판정(`approvals.judge`)이라 harness/unit |
| ask 질문 | 위 | | `ask-answer` |
| compact | runtime child의 compactor → provider → core | 이력이 사라진다 | harness(compactor port). E2E는 실패 행 하나(`compact-failure-keeps-history`, 낮음) |
| 알림 | renderer | | 범위 밖. core 쪽은 `gateway-pending-visible` |
| session fork·이름·archive | core ledger 안 | 이력 | fork·이름은 unit. 도는 turn 중 archive는 `stop`의 행 |
| provider disconnect·OAuth login·problem apply-decision | handle(shell main) | | 범위 밖 |
| `web.search`·`web.fetch` | 인터넷 | | 주소 판정은 unit(`target_test.ts`). 인터넷은 막는다 |
| coding agent hook 상태 계산·`harness install` | 순수 계산, 임시 HOME | | unit(`hook-signal_test`, `install_test`가 있음) |

## 2. support 묶음

후보는 필요한 support로 묶는다. 묶음은 아래 순서로 의존한다.

| 묶음 | 만들 것 | 의존 | 크기 |
|---|---|---|---|
| **G0 지금 support** | 지금 `tests/support`(fake server, core 띄우기, 사람 helper 열) + route helper 몇 줄(`projects/archive`, `ask/answer`, `model-default/change` 등. support 계약은 "helper는 열 개를 넘기지 않는다"라서 flow test가 route를 직접 불러도 된다) | - | 0 |
| **G1 동적 대답** | `Step.reply`를 `(JournalEntry) => Reply`도 받게 + 앞 tool 결과에서 id를 뽑는 읽기 helper | G0 | 작음 |
| **G2 session 여럿** | fake server의 session별 queue(system prompt의 role 표지로 가름) + 여러 session을 기다리는 helper | G0 (`reply` tool을 쓰면 G1) | 중간 |
| **G3 Gateway·coding agent 역할** | Gateway client(`GET /gateway`, subprotocol `lophn.gateway.1`)와 shell main 역할(`coding_terminal` open frame 받고 `coding_agent_terminals/result`·`exited` 보내기), coding token으로 `tickets/claim`·`message send` route를 부르는 client | G1 (ticket id) | 중간 |
| **G4 앱** | test용 앱 fixture(`tests/fixtures/apps/<이름>`: write api, read api, 느린 api, 죽는 api, sandbox 밖을 건드리는 api), source 폴더 `git init`·commit, 길고 반복되는 준비를 한 번에 해 주는 helper(앱 만들기 → ticket → coding 역할로 claim·`releases/prepare_bundle`·report → AE `ticket.verify` → activation 허락 → `apps/enable_execution`) | G1 + G3 | 큼 |
| **G5 MCP fake** | loopback HTTP MCP server(initialize, tools/list, tools/call, `readOnlyHint`) | G0. secret 쪽은 `PLAN-remove-keychain`이 land한 뒤 | 중간 |

## 3. 후보 상세

각 후보: 설명 / role / 경계(process, boundary ID) / 단계(route, 6 이하) / fake 대답(tool 이름은 wire 이름, `.`이 `_`) / 단정(서로 다른 곳 3 이하) / support / 위험 / 겹침. 단계는 준비(`createRun`, `bootCore`, `connectFakeProvider`, `openProject`, 필요하면 `openSession`)를 한 줄로 줄여 쓴다.

### G0. 지금 support만

#### secret-tool-result
- 설명: 사람 문서나 shell 출력에 provider key가 들어 있어도 model 요청, ledger, blob에 key가 가지 않는다. 입력 경로(tool 결과)의 redaction이다.
- role: Project Manager.
- 경계: core ↔ agent runtime child(`redact_request` pipe) ↔ `/bin/sh` 자식. boundary `secrets`, `run-loop`, `agent-tools`, `child-supervision-protocol`.
- 단계: 준비(`connectFakeProvider` key 있음) 후 project 폴더에 `notes.md`(key 문자열 포함)를 disk에 둔다 → `openSession(project_manager)` → `messages/send` → `waitTurnEnd` → ledger 읽기(`tool-calls/list`, `turns/body-view`).
- fake: ① tool `[file_read notes.md, shell_run "env"]` ② text.
- 단정: (1) fake가 받은 둘째 요청 본문에 key가 없고 `LOPHN_` 이름도 없다(shell env 허용 목록). (2) ledger의 tool 결과·blob에 key가 없다. (3) disk의 `secrets.json`을 뺀 `run.home` 전체와 `core.log`에 key가 없다.
- support: 지금 것만.
- 위험: secret.
- 겹침: `secret`은 key가 요청 header에만 있는 것(연결 경로)을 본다. 이 후보는 key가 **tool 결과로 들어오는 경로**라 다르다. 같은 file의 행으로 넣을 수 있다.

#### secret-provider-error
- 설명: provider 오류 본문이 key를 되울려도(예: `invalid x-api-key: <key>`) ledger, event, log에 남지 않고, 실패한 turn이 retry 없이 끝난다.
- role: lophn.
- 경계: `models`, `secrets`, `run-loop`. runtime child → provider(fake) → core ledger.
- 단계: 준비(key) → `openSession(lophn)` → `messages/send` → `waitTurnEnd` → `turns/read`, `model-calls/list`, `messages/list` 읽기.
- fake: ① `{kind:"error", status:401, body: <key를 되울리는 Anthropic 오류 본문>}`.
- 단정: (1) fake journal이 1개이고 turn의 끝난 이유가 credential 계열이다(retry 없음). (2) `model-calls/list`, `turns/read`, `messages/list` 출력에 key가 없다. (3) `core.log`와 `run.home` 파일에 key가 없다.
- support: 지금 것만.
- 위험: secret. 오류 문장은 "고정 문장, 예외 message 복사 금지"라는 규칙이 process를 건너도 지켜지는지 본다.
- 겹침: 없음(`secret`은 성공 경로만). 401은 harness wire가 분류를 보지만, 분류된 뒤 core ledger에 무엇이 남는지는 process를 건너야 보인다.

#### stop-kills-shell
- 설명: 사람이 멈추면 진행 중인 shell 명령이 process group째 죽는다. 고아 process와 반쯤 끝난 쓰기가 남지 않는다.
- role: Project Manager.
- 경계: `run-loop`, `agent-tools`(shell.run), `child-supervision-protocol`. core → runtime child → `/bin/sh` 자식(`setsid` group).
- 단계: 준비 → `openSession` → `messages/send` → `started` marker file이 생길 때까지 poll(신호) → `turns/stop`(`state_seq`는 `turns/read`) → `waitTurnEnd`.
- fake: ① tool `shell_run {"command":"touch started; sleep 300; touch finished"}`(marker는 고유 문자열). 멈춘 뒤 다음 요청은 없다.
- 단정: (1) disk에 `finished`가 없고 `/proc`에 marker가 든 cmdline process가 없다(support-core가 이미 `/proc`으로 child를 확인한다). (2) ledger: turn이 `finished`/`interrupted`이고 shell tool call이 success가 아니다. (3) fake journal이 1개다.
- support: 지금 것만.
- 위험: 핵심 흐름(멈춤의 둘째 층) / sandbox(고아 process).
- 겹침: `stop`은 model 요청 abort만 본다. tool 실행 중 멈춤은 다르다. `stop` file의 행으로 넣을 수 있다.

#### project-isolation
- 설명: PM(project A)은 **등록된** 다른 project B의 폴더에 쓰지 못한다. lophn은 모든 project 폴더를 읽지만 쓰기 tool 자체가 없다. project의 Operator는 자기 폴더만 쓴다.
- role: Project Manager, lophn(행 둘).
- 경계: `agent-tools`(file scope), `agent-roles`(`placeScope`), `run-loop`(Deno 권한). runtime child의 Deno 쓰기 권한은 모든 active project 폴더의 **합집합**이라 B 폴더도 Deno는 허락한다. 막는 것은 tool scope 하나뿐이다. `file-write`가 보는 "등록 안 된 폴더 밖"과 다른 층이다.
- 단계: project A, B 폴더 → `openSession(PM, A)` → `messages/send` → `waitTurnEnd` → disk·ledger 읽기. 행 2는 `openSession(lophn)` 후 같은 순서.
- fake: ① tool `[file_write A/x.md, file_write B/y.md]` ② text. (행 2) ① tool `[file_read B/y.md]` ② text.
- 단정: (1) disk: `A/x.md` 있음, `B/y.md` 없음. (2) ledger: B 쓰기가 `forbidden`. (3) (행 2) fake가 받은 요청의 `tools` 이름 목록에 `file_write`가 없고, 둘째 요청에 B 파일 내용이 실렸다.
- support: 지금 것만.
- 위험: 권한.
- 겹침: `file-write` file의 table 행으로 넣는다(새 file 없음).

#### project-archive-revokes
- 설명: project를 보관하면 그 PM session은 새 입력을 받지 않고 agent가 그 폴더에 쓰지 못한다. 보관을 풀면 같은 session에서 이어 쓴다.
- role: Project Manager.
- 경계: `projects`, `router`, `run-loop`(보관된 폴더가 Deno 권한 목록에서 빠지며 runtime child가 다시 뜬다). `agent-sessions`.
- 단계: 준비 → `openSession` → `projects/archive` → `messages/send`(오류 기대) → `projects/unarchive` → `messages/send` → `waitTurnEnd`.
- fake: ① tool `file_write {"path":"back.md","content":"x"}` ② text. (보관 중에는 model 요청이 없다.)
- 단정: (1) 보관 중 `messages/send`가 오류이고 fake journal이 0이다. (2) 보관을 푼 뒤 disk에 `back.md`가 있다. (3) `sessions/read`로 session은 내내 open이다(보관은 session을 끝내지 않는다).
- support: 지금 것만 + `settle`.
- 위험: 권한(회수). 회수는 아무 test도 안 본다.
- 겹침: 없음.

#### ask-answer
- 설명: `ask`가 turn을 세우고, 사람의 답이 다음 model 요청에 실린다. 사람이 답 대신 메시지를 보내면 `human_message`로, core가 꺼지면 `cancelled`로 닫힌다.
- role: lophn(또는 PM).
- 경계: `run-loop`, `agent-tools`, `agent-sessions`, `events`(snapshot). runtime child ↔ core 질문 대기(memory) ↔ 사람.
- 단계: 준비 → `openSession(lophn)` → `messages/send` → `session_snapshots/list` poll(questions 1개) → `ask/read` → `ask/answer` → `waitTurnEnd`.
- fake: ① tool `ask {questions:[{question, header, options:[2], multiSelect:false}]}` ② text.
- 단정: (1) snapshot의 `questions`가 답 전 1개, 답 뒤 0개. (2) fake 둘째 요청의 tool_result에 고른 label이 있다. (3) ledger tool call이 success다.
- support: 지금 것만.
- 위험: 핵심 흐름(turn이 영영 멈춤). agent가 사람 결정을 받는 유일한 길(`ask`)이다.
- 겹침: `approval`과 구조가 같고 계약이 다르다(QuestionWait는 approval이 아니다). `approval` file에 행으로 넣는다. restart 변형은 `restart` file에.

#### operator-create-gated
- 설명: PM의 `operator.create`는 Gate(설정 고치기)에 걸려 사람의 허락 뒤에만 Operator가 생기고, 만든 Operator는 grant 없이 자기 project에서만 일한다. 거절하면 생기지 않고 이유가 다음 요청에 실린다.
- role: Project Manager, Operator.
- 경계: `approvals`, `agents`(agent 정의 file), `agent-roles`(`operator.create`), `agent-tools`. boundary `agent-tool-spi`.
- 단계: 준비 → `openSession(PM)` → `messages/send` → `waitPermission` → `approvals/decide_turn` allow → `waitTurnEnd` → `agent-definitions/list`(그리고 `sessions/open` role operator).
- fake: ① tool `operator_create {name, place:{project:<이름>}, ...정의 필드}` ② text. (Operator session을 열어 보면 ③ text.)
- 단정: (1) 결정 전 `agent-definitions/list`에 Operator가 없고 허락 뒤 있다(정의 file이 `run.home` 아래에 생김). (2) 거절 행: 없고 둘째 요청 tool_result에 거절이 실린다(`approval`과 같은 모양). (3) Operator session의 첫 요청 `tools` 목록에 `operator_create`가 없다.
- support: 지금 것만. `operator.create`의 정의 필수 필드는 코드로 닫지 못했다(0절).
- 위험: 권한(agent는 설정·grant를 사람 없이 넓히지 못한다는 `approval` 규칙의 process 건너는 경우).
- 겹침: `approval`은 `LOPHN.md` 쓰기 하나. 다른 intent(`settings_edit`의 Operator 만들기)다. 같은 file의 행 가능.

#### call-gate-ask-reject
- 설명: 사람이 agent grant에서 "묻는다"로 바꾼 call은 turn 안에서 물음을 거치고, 거절하면 받는 session이 열리지 않는다.
- role: lophn(보내는 쪽), PM(받는 쪽).
- 경계: `approvals`, `router`, `agent-tools`(call), `agent-sessions`. `agent-call.md`의 "Gate는 두 곳".
- 단계: 준비 → `openProject` → `agent_grants/set`(lophn의 `{kind:"agent", agent:{role:"project_manager", project}, setting:"ask"}`) → `openSession(lophn)` → `messages/send` → `waitPermission` → `approvals/decide_turn` reject → `waitTurnEnd`.
- fake: ① tool `call {to:{role:"project_manager", place:{project:<이름>}}, reply:"none", body, refs:[]}` ② text.
- 단정: (1) 거절 뒤 `sessions/list`에 PM session이 없다(call로 안 열림). (2) `calls/read`·tool call 결과가 failure다. (3) fake journal이 2개이고 둘째 요청 tool_result에 거절이 실렸다.
- support: 지금 것만. 허락 행은 받는 session의 turn이 동시에 돌아 G2가 필요하다. 이 후보는 거절 행만이다.
- 위험: 권한.
- 겹침: 없음.

#### restart-keeps-completed
- 설명: 정상으로 끝난 turn의 대화, tool call, model call 기록이 SIGKILL 뒤에도 그대로이고 provider 연결·key는 다시 하지 않아도 같은 session에서 이어 대화한다.
- role: lophn.
- 경계: `storage`, `server`, `secrets`, `agent-sessions`. 
- 단계: 준비 → turn 완료 → ledger 읽기(`messages/list`, `tool-calls/list`, `model-calls/list`) → `core.kill()` → `bootCore(run)` → 같은 읽기 → `messages/send` → `waitTurnEnd(1)`.
- fake: ① text ② text.
- 단정: (1) 재시작 전후 ledger 목록이 같다. (2) fake 둘째 요청 header의 key가 같다(`secrets.json`이 남음, 0600). (3) 새 turn이 이전 대화를 요청에 싣는다(history가 남음).
- support: 지금 것만.
- 위험: 데이터 잃기.
- 겹침: `restart`는 interrupted turn과 permission 사라짐을 본다. 완료된 기록이 남는지는 거기서 암묵적으로만 본다. `restart` file의 행으로(단정 한도를 쓰므로 행 분리).

#### lophn-registers-app
- 설명: 사람이 lophn에게 새 앱을 원한다고 하면 lophn이 `app.create`로 등록하고, 앱마다 App Engineer가 생겨 session을 열 수 있다.
- role: lophn, App Engineer.
- 경계: `app-releases`(앱 registry), `agent-roles`(role 표), `agent-tools`, `core-api`(agent 자격). runtime child → core.
- 단계: 준비 → `openSession(lophn)` → `messages/send` → `waitTurnEnd` → `apps/list` → `sessions/open`(role app_engineer, app).
- fake: ① tool `[app_list, app_create {name, purpose}]` ② text.
- 단정: (1) `apps/list`에 그 앱이 있다(slug, 이름). (2) tool call이 success다. (3) AE session이 열린다(role과 place 검사 통과).
- support: 지금 것만.
- 위험: 핵심 흐름(앱이 시작되는 유일한 입구).
- 겹침: 없음.

#### model-choice-layers
- 설명: session model > project model > 기본 model 순으로 고른 model이 실제 provider 요청의 `model`에 실린다.
- role: lophn.
- 경계: `models`, `agent-sessions`, `run-loop`. core 해석 → runtime child → wire.
- 단계: 준비 → `model-default/change` → `messages/send` → (`project-model/change`는 project place PM으로) → `sessions/change-model` → `messages/send` (turn 셋).
- fake: ① text ② text ③ text.
- 단정: (1) fake journal 셋의 `body.model`이 각각 기본, project, session 값이다. (2) `model-calls/list`의 resolved model이 같다. (3) 바꾸기 전 turn의 기록이 안 바뀌었다.
- support: 지금 것 + route helper. snapshot에 서로 다른 anthropic model 이름이 있는지 확인이 필요하다.
- 위험: 핵심 흐름(엉뚱한 model로 비용).
- 겹침: 없음. 층 해석은 harness로도 볼 수 있으나 `prepare`가 core read 11개를 써서 E2E가 더 싸다.

#### ae-source-blueprint-check
- 설명: App Engineer가 앱 source 폴더(data root 밖, git)에 blueprint를 쓰고 `blueprint.check`로 읽고 ticket을 만든다. 앱 source 폴더가 AE의 권한 범위다.
- role: App Engineer.
- 경계: `agent-tools`, `app-tickets`, `app-releases`(blueprint check), `run-loop`(앱 source 폴더 Deno 권한). 
- 단계: source 폴더 만들고 `git init` → `apps/create` → `apps/connect_source` → `settle` → `openSession(app_engineer)` → `messages/send` → `waitTurnEnd`.
- fake: ① tool `[file_write <source>/blueprint.ts, ticket_create {app, goal, check}]` ② tool `blueprint_check {app}` ③ text.
- 단정: (1) disk에 blueprint file이 있다. (2) `tickets/list`에 열린 ticket이 앱 하나에 있다. (3) fake 셋째 요청의 `blueprint_check` 결과가 errors/warnings 모양이다(내용 문구는 안 본다).
- support: 지금 것 + route helper 둘(`apps/create`, `apps/connect_source`). ticket `check` 모양은 코드로 닫지 못했다.
- 위험: 권한(앱 source 쓰기), 핵심 흐름.
- 겹침: 없음. 앱 process는 안 쓴다.

#### skill-folder-read
- 설명: 사람이 등록한 skill 폴더(data root 밖)의 skill을 agent가 `skill.read`로 읽는다.
- role: lophn(또는 PM).
- 경계: `config`, `lophn-agent`(extensions), `run-loop`(등록 skill 폴더 read 권한, 설정이 바뀌면 child 재기동).
- 단계: `work/skills/hello/SKILL.md` → `settings/update`(`lophn-agent.extensions.skill_folders`) → `settle` → `openSession` → `messages/send` → `waitTurnEnd`.
- fake: ① tool `skill_read {name:"hello"}` ② text.
- 단정: (1) fake 둘째 요청 tool_result에 skill 본문의 고유 문자열이 있다. (2) `skills/read`가 그 skill을 전역 출처로 낸다. (3) ledger tool call이 success다.
- support: 지금 것 + 설정 helper. `skill.read`의 입력 이름은 코드로 닫지 못했다.
- 위험: 권한(NotCapable 회귀 종류).
- 겹침: 없음. `file-write`와 같은 회귀 종류(Deno 권한에서 폴더가 빠짐)이나 다른 목록이다.

#### gateway-pending-visible (G3의 Gateway client만 필요)
- 설명: 사람이 화면을 늦게 열어도(Gateway에 늦게 붙어도) `session_snapshots/list`로 대기 중 허락·질문을 본다. 새 요청은 Gateway event로 온다.
- role: PM.
- 경계: `event-stream`, `events`, `server`, `child-supervision-protocol`(runtime child가 agent event를 pipe로 core에 보내고 core가 publish).
- 단계: 준비 → Gateway 연결(조건: 그 session) → `messages/send` → `PermissionRequested` event 수신 → 두 번째 Gateway 연결 후 snapshot에 request 있음 → `approvals/decide_turn`.
- fake: ① tool `file_write LOPHN.md` ② text.
- 단정: (1) event가 한 번 온다. (2) 늦게 붙은 연결의 snapshot에 request가 있다. (3) 결정 뒤 snapshot에서 사라지고 `TurnEnded`가 온다.
- support: Gateway client(G3에서 만들 것 중 이것만). 
- 위험: 핵심 흐름(허락 요청을 사람이 못 보면 turn이 멈춘다).
- 겹침: `approval`은 route poll로 본다. Gateway 길은 아무도 안 본다.

### G1. 동적 대답

#### context-draft-submit-search
- 설명: PM이 draft를 열고, 계약 `bundle.json`을 쓰고, 격리 test를 돌리고, 제출하면 context가 적용되어 검색이 된다.
- role: Project Manager.
- 경계: `contexts`, `projects`, `agent-roles`, `supervision`(context worker child `documents/contexts`), `agent-tool-spi`. 쓰기 권한: draft 폴더는 `<data root>/projects/...`라 runtime child의 `<dataRoot>/projects` 쓰기 허락과 file scope의 `openDraft` 확장이 같이 맞아야 한다.
- 단계: project 폴더에 문서 둔다(frontmatter 있는 md) → `openSession(PM)` → `messages/send` → `waitTurnEnd` → `contexts/get` → `contexts/search`.
- fake: ① tool `context_draft {name, purpose}` ② tool `[file_write <draft 폴더>/bundle.json (경로는 ①의 결과에서), context_test {context, draft}, context_submit {context, draft}]` ③ text. (동적 대답이 ②의 경로와 id를 만든다.)
- 단정: (1) disk: draft 폴더의 `bundle.json`에 쓴 계약. (2) `contexts/get`에서 applied 판이 제출한 draft다. (3) `contexts/search` 결과에 test가 둔 문서의 key가 있다(context worker를 지남).
- support: G1.
- 위험: 핵심 흐름(PM의 산출물). 사람 문서가 index되는 길(worker)도 같이 본다.
- 겹침: 없음. 지금 PM으로 하는 일이 file 쓰기뿐이다. PM의 진짜 일이 비어 있다.

#### context-bad-draft-kept-out
- 설명: 격리 test를 못 통과하는 draft는 적용되지 않고 이전 판(없으면 적용 없음)이 그대로다. 사람 승인 없이 적용되는 대신 test가 문이다.
- role: Project Manager.
- 경계: `contexts`, 같음.
- 단계: 위와 같으나 `bundle.json`이 문서를 어기는 계약(예: 필수 필드가 문서에 없음).
- fake: ① tool `context_draft` ② tool `[file_write bad bundle, context_test, context_submit]` ③ text.
- 단정: (1) `context_test`/`submit` 결과가 통과가 아니다(fake 셋째 요청). (2) `contexts/get`의 applied가 비어 있다. (3) `contexts/search`가 not_found 계열로 거절된다.
- support: G1.
- 위험: 핵심 흐름. 틀린 계약이 적용되면 다른 agent가 틀린 정보를 받는다.
- 겹침: 위 후보의 둘째 행. 한 file.

#### context-violation-reaction
- 설명: 사람이 문서를 고쳐 계약을 어기면 program이 위반을 보고 그 project의 PM을 새 session으로 부른다(reaction).
- role: Project Manager(program이 부름).
- 경계: `contexts`, `events`(domain event → Reactor), `router`, `agent-sessions`. context worker가 사람 file 변경을 본다.
- 단계: 위 흐름으로 context를 적용 → disk에서 문서 하나를 계약 위반으로 고침 → `contexts/violations` poll(신호) → `sessions/list`에서 PM reaction session 찾기 → `waitTurnEnd`.
- fake: 선행 3개 + ④ text(reaction turn). 4개라 한도 예외. 선행은 support helper로 접어 둘 수 있다.
- 단정: (1) `contexts/violations`에 위반이 있다. (2) 새 PM session이 열리고 입력이 program 출처다(`sessions/read`). (3) fake가 받은 요청에 위반 근거 id가 실렸다.
- support: G1. file watch의 지연이 있어 신호가 poll(`contexts/violations`)인지 확인 필요.
- 위험: 핵심 흐름(program → agent 경로. 앱의 problem·activation 실패 reaction과 같은 장치).
- 겹침: 없음.

### G2. session 여럿

#### call-handoff-new-session
- 설명: 보낸 agent가 답을 안 받는 call로 일을 맡기면 받는 쪽 새 session이 열려 맡긴 글과 근거만 받고(대화 원문은 안 받고), 보낸 session은 막히지 않는다.
- role: lophn → App Engineer(또는 Operator → AE, PM → lophn 행).
- 경계: `router`, `agent-sessions`, `approvals`(call Gate 기본 허락), `agent-tools`(call). 
- 단계: `apps/create` → `openSession(lophn)` → `messages/send` → 보낸·받은 turn 기다림(`sessions/list` poll) → `calls/read`.
- fake(lophn queue): ① tool `call {to:{role:"app_engineer", place:{app:<이름>}}, reply:"none", body, refs:[]}` ② text. (AE queue) ① text.
- 단정: (1) `calls/read`가 delivered 상태이고 받는 session이 AE다. (2) AE session의 첫 요청에 맡긴 글이 있고 lophn 대화 원문이 없다. (3) 보낸 turn이 받은 turn을 기다리지 않고 끝났다(turn 시각 순서가 아니라 `turns/list`의 두 session 모두 finished).
- support: G2. id는 이름으로 풀려 G1 없이 된다.
- 위험: 핵심 흐름.
- 겹침: 없음(roadmap 7 중 `reply`를 뺀 부분).

#### call-result-roundtrip
- 설명: roadmap 7. lophn이 PM에게 결과를 받는 call을 보내고 PM이 `reply`하면 답이 lophn session의 새 입력이 되어 새 turn이 열린다.
- role: lophn ↔ Project Manager.
- 경계: 위와 같음.
- 단계: `openProject` → `openSession(lophn)` → `messages/send` → PM turn 기다림 → lophn 두 번째 turn 기다림 → `calls/read`.
- fake(lophn): ① tool `call {to PM, reply:"result"}` ② text ③ text(답 입력으로 연 turn). (PM): ① tool `reply {call:<동적 id>, body}` ② text.
- 단정: (1) `calls/read`가 done이고 답 본문이 있다. (2) lophn의 셋째 요청에 답이 새 입력으로 실렸다. (3) PM의 `reply`가 보낸 session이 아니라 자기 grant로 일했다는 것(PM tool 결과가 success).
- support: G2 + G1(`reply`의 call id).
- 위험: 핵심 흐름.
- 겹침: roadmap 7 그대로.

#### call-restart-lophn-restarted
- 설명: 받는 session이 아직 가져가지 않은 call은 core 재시작에서 `lophn_restarted`로 닫혀 보낸 쪽이 알고, 조용히 사라지지 않는다.
- role: lophn → PM.
- 경계: `router`, `agent-sessions`, `storage`. 
- 단계: PM session을 열어 stall(model 요청이 안 끝남) → lophn이 `call {to:{session:<PM id>}}`(id는 client가 정함) → `core.kill()` → `bootCore` → `calls/read`.
- fake(PM): ① stall. (lophn): ① tool call ② text.
- 단정: (1) `calls/read`가 failed `lophn_restarted`. (2) PM의 첫 turn은 interrupted. (3) 보낸 session에 실패 알림 입력이 생겼다.
- support: G2.
- 위험: 데이터 잃기(맡긴 일이 조용히 사라짐).
- 겹침: `restart`의 call 쪽. 낮음-중간.

### G3. Gateway·coding agent 역할

#### coding-token-lifecycle
- 설명: AE가 ticket을 coding agent에게 맡길 때만 coding token이 나오고(Gateway frame의 env), token은 그 앱 하나 범위이며, session이 끝나면 회수되고, 보고 없는 끝은 AE에게 알려진다.
- role: App Engineer, coding agent(test가 대신).
- 경계: `app-tickets`, `coding-agent`, `coding-agent-cli-interface`, `router`, `events`. core ↔ shell main 역할(Gateway) ↔ CLI route.
- 단계: `apps/create` + 앱 둘 → `openSession(AE)` → `messages/send` → Gateway에서 `coding_terminal` open frame 수신 → `tickets/claim`(token) → 다른 앱 ticket을 같은 token으로 → `coding_agent_terminals/exited` → 같은 token으로 다시.
- fake(AE): ① tool `ticket_create` ② tool `call {to:{role:"coding_agent", place:{app}}, reply:"conversation", refs:[{kind:"ticket", ...<동적 id>}]}` ③ text. (+ 끝 알림에 열린 turn ④ text)
- 단정: (1) frame의 plan에 token과 first_prompt(ticket id만, 본문 없음)가 있고 ledger·`tickets/show`·`core.log`에 token이 없다. (2) 같은 token이 다른 앱 ticket에는 `forbidden`, 자기 ticket은 claim된다. (3) `exited` 뒤 같은 token은 `unauthorized`이고 AE에 새 입력(보고 없는 끝)이 생긴다.
- support: G3 + G1.
- 위험: secret(token 새면 앱 하나가 열림) / 권한.
- 겹침: 없음. roadmap 8·9의 support(Gateway·token)를 앱 없이 먼저 검증하는 길이다.

#### coding-message-to-ae
- 설명: coding agent가 CLI `message send`로 blueprint 변경이나 막힘을 알리면 맡긴 AE session이(닫혀 있으면 새 session이) 입력으로 받는다.
- role: coding agent → App Engineer.
- 경계: `coding-agent-cli-interface`, `router`, `events`.
- 단계: 위 앞부분 → `coding_agent_sessions/send_message`(token) → AE turn 기다림.
- fake(AE): 앞 대답 + ④ text.
- 단정: (1) AE의 새 turn 요청에 메시지가 실렸다. (2) 맡긴 session이 닫혀 있는 행에서는 새 AE session이 열렸다(`sessions/list`). (3) `calls/read`가 conversation 상태로 열려 있다.
- support: G3 + G1.
- 위험: 핵심 흐름.
- 겹침: 위 후보에 이어 붙이거나 행.

### G4. 앱 (G1 + G3 위)

공통 준비: test용 앱 fixture(api 둘 이상) → source 폴더 `git init` → `activateTestApp` helper(앱 만들기 → AE ticket → coding 역할 `tickets/claim`, `releases/prepare_bundle`, `tickets/report_completion` → AE `ticket.verify` → activation 허락 `approvals/decide` → `apps/enable_execution`). 이 준비는 flow의 단계가 아니라 helper다(support에 "띄우기와 연결만" 규칙의 예외 판단이 필요하다. 단계가 8을 넘는다).

#### app-release-activate-call
- 설명: roadmap 8. 앱 만들기 → release 준비 → 확인됨 → activation → agent의 app-api tool 호출 → 앱 process → 결과.
- role: App Engineer, coding agent, Operator/lophn(호출).
- 경계: `app-releases`, `app-runtime`, `app-data`, `app-tickets`, `app-spi`, `app-capability`, `sdk-api`, `core-api`, `child-supervision-protocol`. core ↔ release worker ↔ app supervisor ↔ 앱 process.
- 단계: `activateTestApp` → `agent_grants`로 앱 할당 → `openSession` → `messages/send` → `apps/invocations`.
- fake: ① tool(app-api tool 이름은 `lophn-agent/tools/app-api/name.ts` 규칙) ② text.
- 단정: (1) 앱 DB 쪽: invocation이 success이고 `apps/invocations`에 write로 기록된다. (2) fake 둘째 요청 tool_result에 앱 응답. (3) release의 active 참조가 방금 만든 release다.
- support: G4.
- 위험: 핵심 흐름 + sandbox.
- 겹침: 없음.

#### app-activation-approval
- 설명: 처음 activation(또는 선언이 넓어진 release)은 사람이 허락하기 전까지 올라가지 않고, 거절하면 prepared로 남아 앱이 안 뜬다.
- role: 사람.
- 경계: `approvals`, `app-releases`, `app-runtime`.
- 단계: `activateTestApp`을 verify 직전까지 → `approvals/pending` → `approvals/decide` reject → `apps/get` → (행 2) allow.
- fake: AE 쪽 준비 대답.
- 단정: (1) pending에 activation request가 있고 거절 뒤 `active_release`가 null이다. (2) 앱 process가 `/proc`에 없다. (3) allow 행: active_release 있고 process 있다.
- support: G4.
- 위험: 권한.
- 겹침: 없음. `approval`은 turn 안 request뿐이다.

#### app-sandbox-denies
- 설명: 활성 앱 process는 blueprint가 선언한 권한 밖(data root의 `secrets.json` 읽기, 외부 network)을 못 한다. 정상 api는 된다.
- role: 앱(agent가 호출).
- 경계: `app-runtime`, `app-capability`, `sdk-api`. 앱 process의 Deno 권한.
- 단계: `activateTestApp`(fixture에 `escape` api) → `apps/call_api`(user)로 `escape`와 정상 api를 부른다 → `apps/invocations`.
- fake: 없음(user가 route로 호출).
- 단정: (1) `escape` invocation이 failed이고 이유가 권한 거절이다. (2) 정상 api는 success. (3) 앱이 읽으려던 파일의 byte가 어디에도(응답, ledger) 없다.
- support: G4. fake model이 필요 없다.
- 위험: sandbox. 지금 `sandbox-boundary_test.ts`는 subprocess 한 번이고 실제 activation된 앱을 안 본다.
- 겹침: 없음.

#### app-data-rewind
- 설명: roadmap 9. 256KiB를 넘는 changeset을 만드는 write 여럿 뒤 앱 rewind가 한 번에 되돌린다. 충돌하면 통째로 취소되고 반쯤 되돌아간 DB가 없다.
- role: 사람.
- 경계: `app-data`, `app-runtime`, `child-supervision-protocol`(bytes frame stream).
- 단계: `activateTestApp` → `apps/call_api`로 큰 write 여럿 → `apps/rewind_plan` → `apps/rewind` → `apps/call_api` read → `apps/rewinds`.
- fake: 없음.
- 단정: (1) read api가 첫 상태를 낸다. (2) `apps/rewinds`의 status가 applied. (3) (충돌 행) 앱 DB가 바뀌지 않고 cancelled 이유가 있다.
- support: G4. 열린 이슈 `activation.md`(write app-api의 rewind 검사가 fail)에 걸리지 않는 fixture api여야 한다.
- 위험: 데이터 잃기.
- 겹침: 없음.

#### activation-failure-keeps-data
- 설명: 두 번째 release의 migration이 깨지면 앱 data가 복구본으로 돌아가고 앱이 이전 상태로(또는 사용 불가로 표시되어) 데이터를 잃지 않으며 AE가 부른다.
- role: App Engineer(program이 부름).
- 경계: `app-releases`, `app-data`, `app-runtime`, `events`.
- 단계: `activateTestApp`(v1, data 있음) → v2(깨진 migration) 준비·verify → activation 실패 → `activations/queue`, `apps/call_api` read → `sessions/list`.
- fake: AE reaction turn text.
- 단정: (1) v1 data가 읽힌다. (2) 실패 기록과 `ReleaseActivationFailed`가 있다. (3) AE reaction session이 열렸다.
- support: G4 (release 둘).
- 위험: 데이터 잃기.
- 겹침: 없음.

#### app-crash-problem-reaction
- 설명: 앱이 죽으면 problem이 열리고(이후 거듭 죽으면 자동 재시작이 멈추고), program이 그 앱의 AE를 reaction으로 부른다.
- role: App Engineer.
- 경계: `problems`, `app-runtime`, `events`, `supervision`(report collector worker).
- 단계: `activateTestApp`(fixture에 `crash` api) → `apps/call_api` crash → `problems/list` poll → `sessions/list`에서 AE reaction → `waitTurnEnd`.
- fake: AE reaction text.
- 단정: (1) problem이 열려 있다. (2) 앱 process가 다시 떴다(또는 한도 후 멈춤). (3) AE session 입력이 program 출처다.
- support: G4.
- 위험: 핵심 흐름("앱이 조용히 깨지지 않게"가 제품 약속).
- 겹침: 없음.

#### agent-app-api-gate
- 설명: 사람이 앱 api를 "묻는다"로 바꾸면 agent의 app-api tool이 허락 전에 앱을 부르지 않고, 거절하면 invocation이 denied로 남는다.
- role: lophn/Operator.
- 경계: `approvals`, `app-runtime`, `agent-tools`.
- 단계: `activateTestApp` → `agent_grants/set`(api를 ask) → `openSession` → `messages/send` → `waitPermission` → `decide_turn` reject → `waitTurnEnd`.
- fake: ① tool app-api ② text.
- 단정: (1) 거절 전 앱 DB가 안 바뀌었다. (2) `apps/invocations`에 denied(성공한 read는 안 남고 denied는 남음). (3) 거절이 둘째 요청에 실렸다.
- support: G4.
- 위험: 권한.
- 겹침: `approval`의 앱 쪽.

#### session-rewind-with-app
- 설명: session rewind의 `restore_all`이 사람이 고른 앱 data도 함께 되돌린다. 안 고르면 앱은 그대로다.
- role: 사람.
- 경계: `agent-sessions`, `app-data`.
- 단계: 앱의 write를 agent가 호출 → `rewind/preview`(apps 목록) → `rewind/apply`(앱 선택 / 선택 안 함 두 행) → 앱 read.
- fake: tool + text.
- 단정: (1) 선택 행: 앱 read가 이전 상태. (2) 비선택 행: 그대로. (3) 앱 rewind가 취소돼도 대화·파일은 되돌아가지 않고 결과만 기록.
- support: G4.
- 위험: 데이터 잃기.
- 겹침: `rewind`의 확장.

#### restart-with-app
- 설명: 앱 호출 도중 core가 꺼지면 invocation이 unknown(`core_restarted`)이 되고 앱 process는 core가 새로 띄운다. 모르는 write를 다시 보내지 않는다.
- 경계: `app-runtime`, `storage`.
- 단계: `activateTestApp`(fixture에 `slow` api) → `apps/call_api`(안 끝남) → `core.kill()` → `bootCore` → `apps/invocations` → `apps/get`.
- fake: 없음.
- 단정: (1) unknown/`core_restarted`. (2) 앱 process가 새로 떠 있다. (3) 같은 호출이 자동으로 다시 가지 않았다.
- support: G4.
- 위험: 데이터 잃기.
- 겹침: `restart` 확장.

#### operator-reads-app
- 설명: 앱 place의 Operator가 할당받은 read app-api로 읽고 사람이 정한 project 폴더에 file로 쓴다. 할당받지 않은 api는 못 부른다.
- role: Operator.
- 경계: `app-runtime`, `agents`, `projects`.
- 단계: `activateTestApp` → `operators/create` → `agent_grants/set` → `sessions/open` → `messages/send` → `waitTurnEnd`.
- fake: tool `[app-api read, file_write <project>/out.md]` + text.
- 단정: project 폴더 file / invocation 기록 / 할당 안 한 api의 거절.
- support: G4.
- 위험: 권한.
- 겹침: 없음.

### G5. MCP fake

#### mcp-external-tool-gated
- 설명: 외부 MCP tool(`readOnlyHint` 없음 → external)은 사람이 허락해야 돌고, 거절하면 MCP server가 호출을 받지 않는다.
- role: lophn(또는 PM).
- 경계: `lophn-agent`(extensions), `approvals`, `run-loop`(`allow_net` host:port, 설정이 바뀌면 child 재기동).
- 단계: fake MCP server(loopback) → `settings/update`(전역 `mcp_servers`) 또는 부팅 전 `settings.json` → `settle` → `openSession` → `messages/send` → `waitPermission` → `decide_turn`.
- fake: ① tool (MCP tool wire 이름) ② text.
- 단정: (1) 허락 행: MCP server가 받은 호출 1개. (2) 거절 행: 0개. (3) fake model 둘째 요청 tool_result.
- support: G5.
- 위험: 권한.
- 겹침: 없음.

#### mcp-secret-destination
- 설명: MCP 서버용 secret(`mcp.` 이름)은 선언된 목적지로만 가고 ledger에는 없다.
- 단계/단정: `PLAN-remove-keychain` land 뒤에 정한다. 지금은 쓰지 않는다.
- support: G5.
- 위험: secret.

### 행으로만 넣을 것 (새 file 없음)

| 넣을 file | 행 | 이유 |
|---|---|---|
| `stop` | tool 실행 중 멈춤(`stop-kills-shell`), 도는 turn 중 `sessions/archive` | 멈춤의 다른 층. archive는 도는 turn을 interrupted로 닫는다(`place-session.md`) |
| `rewind` | `file.edit`, 새로 만든 file(복원=삭제), `summarize` choice | 한 contract 변형 |
| `restart` | 완료 기록 보존(`restart-keeps-completed`), 질문 중 재시작(`ask` cancelled) | |
| `approval` | `ask` 왕복(`ask-answer`), `operator.create` Gate | 같은 "사람을 기다리는 turn" |
| `file-write` | 등록된 다른 project / lophn 읽기 전용(`project-isolation`) | 같은 contract |

## 4. 지금 E2E가 덮는 것과 빈 곳

| role·흐름 | 지금 7개가 덮는 것 | 비어 있는 것 | 후보 |
|---|---|---|---|
| core 기동 | `boot`(status, SIGKILL 뒤 재기동, 정리) | 완료 기록 보존 | `restart-keeps-completed` |
| lophn | `secret`의 role(turn 하나) | 앱 등록, call, `ask` | `lophn-registers-app`, `ask-answer`, `call-*` |
| Project Manager | `file-write`, `approval`, `rewind`, `stop`, `restart`가 모두 PM으로 돈다(file 쓰기, `LOPHN.md`) | **context 만들기·적용·검색·위반 reaction**(PM의 진짜 일), project 격리, Operator 만들기 | `context-*`, `project-isolation`, `operator-create-gated` |
| App Engineer | 없음 | ticket, blueprint, coding agent 맡기기, 검증, activation, reaction | `ae-source-blueprint-check`, G3, G4 |
| Operator | 없음 | 만들기·권한·app-api·project 폴더 쓰기 | `operator-create-gated`, `operator-reads-app` |
| coding agent | 없음 | token, claim, 메시지, session 끝 | `coding-*` |
| provider·model | `secret`(연결 + key 위치) | 오류 본문의 key, model 고르기 | `secret-provider-error`, `model-choice-layers` |
| 권한·sandbox | `file-write`(등록 밖 폴더) | 남의 project, 보관 회수, shell 멈춤, 앱 sandbox | `project-isolation`, `project-archive-revokes`, `stop-kills-shell`, `app-sandbox-denies` |
| secret | `secret`(header에만 있음) | tool 결과 경로, 오류 본문, coding token | `secret-tool-result`, `secret-provider-error`, `coding-token-lifecycle` |
| approval | `approval`(`LOPHN.md` 허락·거절) | call Gate, Operator Gate, 앱 api Gate, activation 허락 | `call-gate-ask-reject`, `operator-create-gated`, `agent-app-api-gate`, `app-activation-approval` |
| ask | 없음 | 왕복 | `ask-answer` |
| rewind | `rewind`(파일 복원, `edited_outside`) | 앱 data, session+앱 | `app-data-rewind`, `session-rewind-with-app` |
| stop | `stop`(model 요청 abort) | tool 실행 중, archive | 행 |
| restart | `restart`(interrupted, 허락 request 사라짐) | call, 앱 invocation, 질문 | `call-restart-*`, `restart-with-app` |
| agent call | 없음 | 전부 | G2 |
| 앱(만들기·release·activation·호출·data) | 없음 | 전부 | G4 |
| problem·reaction | 없음 | 전부 | `app-crash-problem-reaction`, `context-violation-reaction` |
| MCP·skill | 없음 | | G5, `skill-folder-read` |
| 알림(Gateway) | 없음 | | `gateway-pending-visible` |

## 5. 우선순위

### 5.1 "지금 support만으로 되는 것" 상위 10

기준은 AGENTS.md의 위험 목록(데이터 잃기, 권한·secret·sandbox, 두 번 고친 bug)에 얼마나 닿는지, 지금 이 일을 아무 test도 못 잡는지, 값이 싼지다. 둘째 줄부터 "지금 test로 왜 못 잡나"를 같이 적는다.

| 순위 | id | 위험 | 근거 |
|---|---|---|---|
| 1 | `secret-provider-error` | secret | 값싸다(대답 1개). 오류 문장에 key가 섞이는 것은 provider마다 다른 현실의 회귀이고 harness wire는 분류만 본다 |
| 2 | `secret-tool-result` | secret | redaction 길(runtime child의 `redact_request` pipe)이 process를 건너는 유일한 장치다. 사람 문서에 key가 있는 일은 현실에 흔하다 |
| 3 | `project-isolation` | 권한 | Deno 권한이 project 합집합이라 scope 검사 하나만 막는다. 이 층 하나가 풀리면 남의 project에 쓴다. 행 하나로 값싸다 |
| 4 | `stop-kills-shell` | 핵심 흐름 / sandbox | `shell.run`은 Gate가 없고 Deno 권한도 닿지 않는다. 멈춤이 이 층까지 닿는지는 아무도 안 본다 |
| 5 | `operator-create-gated` | 권한 | agent가 새 agent를 승인 없이 만드는 길을 막는 유일한 규칙이다 |
| 6 | `call-gate-ask-reject` | 권한 | agent call Gate가 "두 곳"(call tool과 Router)이라 한쪽이 빠지기 쉽다. 거절 행은 session 여럿 없이 된다 |
| 7 | `project-archive-revokes` | 권한 | 회수(revocation)는 늘 늦게 깨지는 부분이다 |
| 8 | `restart-keeps-completed` | 데이터 잃기 | 한 행. SIGKILL 뒤 기록과 key |
| 9 | `ask-answer` | 핵심 흐름 | 사람이 agent에게 결정을 주는 유일한 길. 구조는 `approval`과 같아 file 하나에 행으로 |
| 10 | `lophn-registers-app` | 핵심 흐름 | 앱 흐름의 입구이고 제품이 시작되는 곳이다. agent 자격으로 route를 부르는 길(actor 검사)도 같이 본다 |

다음 순위(지금 support): `model-choice-layers`, `ae-source-blueprint-check`(PM 이외 role을 처음 도는 후보), `skill-folder-read`, `gateway-pending-visible`(Gateway client 하나만 필요).

### 5.2 support 하나 더 만들면 열리는 묶음

| 순위 | 묶음 | 열리는 후보 | 근거 |
|---|---|---|---|
| 1 | **G1 동적 대답** | `context-draft-submit-search`, `context-bad-draft-kept-out`, `context-violation-reaction` (그리고 G2·G3·G4의 전제) | 가장 작은 변경(fake server의 `reply`에 함수 허용)으로 PM의 본업이 처음 E2E에 든다. context worker child와 사람 문서 index를 처음 건넌다. 이 묶음이 없으면 PM은 지금 "file 쓰기"로만 검증되고 PM의 진짜 일은 test가 없다. G3·G4 모두 ticket id가 필요해 어차피 먼저 필요하다 |
| 2 | **G2 session 여럿** | `call-handoff-new-session`, `call-result-roundtrip`, `call-restart-lophn-restarted` (그리고 앱·coding 쪽 AE reaction 확인) | agent call은 네 role을 잇는 유일한 길(R1)이고 roadmap 7이다. 중간 크기. 답 없는 call은 G1 없이 되고, `reply`는 G1이 있어야 한다 |
| 3 | **G3 Gateway·coding agent 역할** | `coding-token-lifecycle`, `coding-message-to-ae`, `gateway-pending-visible` | token 새는 일(secret)과 session 규칙을 앱 없이 본다. G4의 전제이므로 값싸게 먼저 검증된다. 앱 process 없이 코드 경계(core ↔ shell main 역할)를 시험한다 |
| 4 | **G4 앱** | `app-release-activate-call`, `app-activation-approval`, `app-sandbox-denies`, `app-data-rewind`, `activation-failure-keeps-data`, `app-crash-problem-reaction`, `agent-app-api-gate`, `session-rewind-with-app`, `restart-with-app`, `operator-reads-app` | 후보의 절반이 여기 있고 데이터 잃기·sandbox가 모두 이쪽이다. 가장 값어치가 크지만 가장 비싸다(fixture 앱, release 준비, helper). G1·G3 위에만 선다. 한 번 `activateTestApp`이 서면 후보 하나의 한계 비용이 작다. release 준비가 인터넷 없이 되는지(deno cache)는 코드로 닫지 못했다 |
| 5 | **G5 MCP** | `mcp-external-tool-gated`, (`mcp-secret-destination`) | 쓰는 사람이 적고, secret 쪽은 `PLAN-remove-keychain` land 뒤에 정한다 |

권장 순서: G0 상위 10 → G1 → G2 → G3 → G4(roadmap 8·9가 첫 후보) → G5.

### 5.3 개수와 규칙

- 지금 7 + G0 행으로 넣을 것(file 안 늘림) + G0 새 file 5~6(`secret-provider-error`, `stop-kills-shell` 행, `operator-create-gated` 행, `call-gate-ask-reject`, `lophn-registers-app`, `project-archive-revokes`)이면 약 12이다. roadmap의 "core E2E 6~10개(상한 12)"를 넘는 후보는 G1 이후다. 상한을 올릴지, G4 후보를 table 행으로 접을지는 사람이 정할 일이다.
- 대답이 4~6개로 3을 넘는 후보: `context-violation-reaction`(4), `coding-token-lifecycle`(4), `call-result-roundtrip`(session별 3+2). 앞 준비를 helper로 접거나 규칙의 예외로 둔다.
- 새 E2E가 process를 띄우는 test라서 AGENTS.md "사람에게 묻는다"에 해당한다. 이 문서의 후보는 제안일 뿐이다.

## 6. 코드로 확인하지 못한 것

1. `stop`이 `shell.run`의 process group을 실제로 죽이는지. `signalFor`가 abort를 주고 `run.ts`가 `setsid`와 group kill을 갖는 것까지는 읽었다.
2. 보관된 project 세션에 `messages/send`가 어떤 오류 code를 주는지(`agent-call.md`는 "사람이 보낸 쪽이면 오류 코드로 바로 돌려준다"고만 쓴다).
3. `operator.create`의 정의 필수 필드(`operatorDefinition`)와 ticket의 `acceptanceCheck` 모양.
4. skill의 `skill.read` 입력 이름, model snapshot에 anthropic model이 몇 개인지(`model-choice-layers`).
5. `providers/connect`가 같은 provider를 key만 바꿔 다시 잇는 길이 있는지(없으면 key 교체 후보는 없다).
6. release 준비(`releases/prepare_bundle`)가 인터넷 없이 되는지. 앱 의존성이 `<root>/sdk/*` 사본과 template lock에서만 풀리면 된다.
7. `context-violation-reaction`에서 사람 file 변경을 context worker가 보는 신호와 지연. poll 가능한 신호(`contexts/violations`)면 된다.
8. runtime child 재기동의 결정적 신호(`settle`). `e2e-support-core`가 푸는 중이라 이 후보 모두가 같은 해법에 기댄다.
9. `PLAN-remove-keychain`이 secret route와 MCP secret을 바꾼다. `secret-*`와 G5는 그 계획이 land한 뒤 이름을 다시 확인한다.
