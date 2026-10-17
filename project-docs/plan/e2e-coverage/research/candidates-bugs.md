# core E2E 후보: bug와 회귀의 기록에서

기준: main `32d4e9ca1`. 코드는 고치지 않았고 test·check·provider 호출은 하지 않았다(file과 git 기록만 읽음). "코드 읽기"라고 쓴 것은 실행해 확인하지 않은 것이다.

읽은 곳: `project-docs/issues/archived/*.md`(닫은 이슈 104개: fixed 54, kept 50), `project-docs/issues/*.md`(열린 것), `products/change-log/0.2.0.md`, `git log`(10-04 ~ 10-17, 1,969 commit), 옛 e2e(`13a7365e9^`), 계획 `plan/testing/`(README, tasks 7개, `research/facts-main.md`).

## 먼저 볼 것: 코드를 읽다 걸린 의심 셋

후보를 만들다가 걸렸다. 재현하지 않았다. 하나라도 맞으면 E2E 한 개가 bug 하나를 먼저 찾는다.

- **N1. `turns/stop`이 진행 중인 model 요청을 끊지 못할 수 있다.** `run-loop/driver.ts`의 `TurnDriver.stop()`과 `endSession()`을 부르는 곳이 없다(`grep`으로 제품 코드에서 호출처 0). pump(`main/agent-runtime/product-driver.ts` `startTurnPump`)는 `providerWatch.poll()`과 `startNext()`만 돈다. loop는 `turn.ts`의 `stopped()`로 turn 행이 finished인지 step 경계에서만 본다. 그러면 `stall`/`silent` 응답 중에 `turns/stop`을 해도 요청은 `stall_ms`(300초)까지 열려 있다. 이미 있는 `e2e-stop`(stall → `fake.aborted(1)`)이 이것을 잡는다. 같은 이유로 session archive/delete도 진행 중인 요청을 안 끊는다(후보 `stop-triggers`).
- **N2. runtime child가 turn 도중 교체·crash되면 turn 행이 `running`으로 남는다.** `interruptRunningTurns`는 core 시작(`RecoverCalls`)과 session 끝낼 때만 부른다(`router/commands.ts`, `places/lifecycle.ts`). `runtime.ts`의 `onEnd`는 credential만 끝낸다. place 폴더·provider·MCP가 바뀌면 child를 1초 polling에서 다시 띄우므로(`updateSpec`) 평소에도 일어난다. `turns_running_session` unique index 때문에 그 session은 새 turn을 못 연다(`startTurn`이 `conflict`). 사람이 `turns/stop`을 눌러야 풀린다. 문서는 "돌던 turn은 끊긴다"만 쓰고 닫는 법은 정하지 않았다 → 후보 `runtime-lost-midturn`(정할 것 있음).
- **N3. `e2e-restart`/`e2e-boot`는 기록과 맞게 잡혀 있다.** 10-16 하루에 "core가 안 켜짐" 수정이 넷이다(아래 후보 근거). boot + SIGKILL 뒤 재기동 + provider 더한 뒤 재기동이 이미 들어 있어 따로 후보를 만들지 않았다.

## 후보 (process 경계를 건너는 것)

공통: fake 대답은 `e2e-support-server`의 `Reply`(text, tool, error, silent, cut, stall, raw), helper는 `e2e-support-core`의 `createRun/bootCore/connectFakeProvider/openProject/openSession/say/turnsOf/waitTurnEnd/waitPermission/decide/stopTurn/settle`, `core.call/tryCall/upload/kill/stop`이다. 이것만으로 되면 "지금 것만"이라고 쓴다. 단정 셋은 disk / ledger·event / fake가 받은 요청에서 하나씩 고른다. route 이름은 `packages/protocol`에서 확인했다. 오류 code나 outcome 이름은 코드가 정한 값을 test가 읽는다고 적었다.

### 지금 support만으로 되는 것

#### runtime-tool-permissions

- 설명: PM turn 하나에서 child 안의 tool들(shell, 내장 skill, 이미지, grep, web)이 Deno 권한 때문에 `NotCapable`로 깨지지 않고, `web_fetch`는 loopback으로 못 나간다.
- 근거: `issues/archived/place-session.md` "agent runtime process의 Deno 권한에 place 폴더가 없다"(fixed. 닫음에 "실제 turn으로는 확인하지 않았다(process를 건너는 확인은 E2E 몫)"); commit `59fb5ac20`(place 폴더 권한), `7208838ab`(migration commit 안에서 `net_any`를 runtime 전용 무제한 `--allow-net`으로 바꿈); `archived/agent-definition.md` "shell 출력이 stream마다 1 MiB", "`web.fetch` redirect를…"(kept, 경계). 권한 flag를 손댄 commit이 둘이고 둘 다 child 실행 없이 검증됐다. 고친 횟수 2.
- 경계: core → agent runtime child(Deno flag) → OS(`/bin/sh`). boundary `run-loop`, `agent-tools`, `child-supervision-protocol`.
- 단계: (1) 준비: boot, `connectFakeProvider`, `run.work/proj`에 작은 png와 file, `openProject`, `openSession(project_manager)` (2) `say` (3) `waitTurnEnd` (4) 단정.
- fake 대답(2): ① 한 reply에 tool call 다섯: `shell_run`(`echo hi > made.txt; head -c 2000000 /dev/zero | tr '\0' x`), `skill_read`(PM 내장 skill `context-init`), `file_grep`, `image_read`(png), `web_fetch`(`fake.url + "/probe"`). ② text.
- 단정(3): disk: `proj/made.txt`가 `hi`. ledger: `tool-calls/list`에서 shell, skill, grep, image는 `success`이고 `web_fetch`는 실패(code는 코드가 정한 값, `NotCapable` 계열 문구는 없음). fake가 받은 요청: journal에 `/probe` 요청이 없고, 둘째 `/messages` 요청의 `shell_run` tool_result가 30 KiB 안.
- support: 지금 것만. (tool 인자 이름은 tool 정의에서 읽는다.)
- 위험: sandbox / 권한, 두 번 고친 bug.
- 겹침: `e2e-file-write`는 `file_write`와 scope만 본다. 다른 tool의 권한은 안 본다. 같은 file의 table 행으로 둬도 된다.

#### stop-pending-permission

- 설명: 허락을 기다리는 turn을 사람이 멈추면 permission request가 사라지고, 그 뒤 온 낡은 `allow`는 쓰기를 일으키지 못한다.
- 근거: `architecture/approval.md` "지키는 것"(원래 일이 끝나면 cancelled, 허락은 그 intent에 한 번만, 낡은 허락이 쓰이면 안 됨); `archived/approval.md` kept 둘(turn 안 request를 메모리 route 둘로 둔 이유, 허락 뒤 `resolve` 한 번 더 부르는 이유). 고친 bug 기록은 없음(설계 불변식).
- 경계: core 메모리(`approvals/turn-requests.ts`) ↔ agent runtime child ↔ ledger. boundary `approvals`, `run-loop`.
- 단계: (1) 준비 (2) `say` (3) `waitPermission` (4) `stopTurn` + `waitTurnEnd` (5) `core.tryCall(approvals/decide_turn, allow)` (6) 단정.
- fake 대답(1): ① tool `file_write` `LOPHN.md`(`e2e-approval`과 같은 묻는 쓰기).
- 단정(3): disk: `proj/LOPHN.md` 없음. ledger/event: turn은 `interrupted/user_stopped`이고 `session_snapshots/list`의 `permission_requests`가 비어 있고, 낡은 `decide_turn`이 오류(code는 코드가 정한 값, `!ok`만 본다). fake가 받은 요청: 정확히 1개(멈춘 뒤 다음 요청 없음).
- support: 지금 것만.
- 위험: 권한, 핵심 흐름.
- 겹침: `e2e-approval`(허락/거절 왕복)과 `e2e-stop`(model 요청 stall)의 사이를 본다. 둘 다 이 경로를 안 지난다.

#### runtime-lost-midturn  (정할 것 있음, N2)

- 설명: model 요청 중에 agent runtime child가 사라지면(place 폴더 추가로 인한 교체, SIGKILL) 그 turn이 `running`으로 영원히 남지 않고, 같은 session이 새 message로 이어진다.
- 근거: `archived/place-session.md` 닫음 "목록이 바뀌면 … child를 다시 띄운다(돌던 turn은 끊긴다)"; `architecture/place-session.md` 같은 문장; change-log 0.2.0 "agent가 data root 밖 place 폴더에서 일하고"; 코드 읽기 N2. 고친 적 없음. commit `e73b40764`(Q31, supervision pipe 쓰기 기한·child 끝 hook·재기동)가 이 경계의 선례다.
- 경계: core(supervision slot, `onEnd`) ↔ child ↔ ledger turn 행. boundary `run-loop`, `supervision`, `child-supervision-protocol`.
- 단계: (1) 준비 + project A (2) `say` (3) `fake.arrived(1)` (4) 행마다: `projects/create`로 폴더 B를 더한다(runtime 교체) / `/proc`에서 child pid를 찾아 SIGKILL (5) 교체된 child가 다시 ready (`settle`) (6) 단정.
- fake 대답(2): ① `stall`(tool 인자 앞 절반) ② text(이어 가는 turn용).
- 단정(3): ledger: 첫 turn이 `finished`(기대 outcome은 사람이 정한다. 추천은 `interrupted/restarted`를 재사용). 같은 session에 `say`하면 `conflict` 없이 새 turn이 열려 `completed`. fake: 첫 요청의 연결이 끊김(`aborted(1)`) 또는 최소한 새 요청이 정확히 하나 더.
- support: 지금 것만 + child pid 찾기(support-core의 `kill()`이 이미 `/proc/<pid>/environ`을 훑는다. 그 코드를 재사용). 행 SIGKILL은 이 확장이 필요하다.
- 위험: 핵심 흐름(session이 영원히 바쁨).
- 겹침: `e2e-restart`는 core가 꺼지는 경로다. child만 사라지는 경로는 없다.
- 정할 것: 이 경우의 turn 끝 이유(새 값이 필요하면 "계약 바꾸기 요청"). 정해지기 전에는 expected 없이 먼저 돌려 현재 동작을 기록한다.

#### secret-rotate-delete

- 설명: 같은 이름에 `secrets/put`으로 key를 바꾸면 다음 turn은 새 key를 header에 싣고 옛 key는 어디에도 없다. `secrets/delete` 뒤에는 요청이 아예 나가지 않는다.
- 근거: `archived/platform.md` "API key로 provider를 연결해도 쓸 수 있는 provider가 생기지 않는다"(fixed, guard는 unit 둘); change-log 0.2.0 둘("provider를 API key로 연결하고…", "MCP credential을 … `secrets.json`으로 옮기고"); commit `0d0c6535d`, `34ccf06af`, `1bbb64d9a`. secret 길을 세 번 갈아엎었다(고친 횟수 3). 알려진 값 registry의 "put은 파일에 쓰기 전에 새 값을 먼저 등록한다"(facts 11)는 규칙이 이 test 말고는 안 잡힌다.
- 경계: core(secrets.json, 알려진 값 registry, `createFileSecretAttach`) ↔ child의 `secret_send_request`. boundary `secrets`, `models`.
- 단계: (1) 준비: `connectFakeProvider(…, {key: K1})`, `openSession(lophn)` (2) `say` + `waitTurnEnd` (3) `core.upload("provider.<id>", K2)` (4) `say` + `waitTurnEnd` (5) `core.call(secrets/delete)` (6) `say` + `waitTurnEnd`.
- fake 대답(2): text, text. (셋째 turn은 요청이 안 나가야 한다.)
- 단정(3): fake: `journal()[0]`의 `x-api-key`가 K1, `[1]`이 K2, 셋째 turn 뒤에도 journal 길이 2. ledger: 셋째 turn은 `failed`(이유는 코드가 정한 값). disk: `secrets.json`이 delete 뒤 비어 있고 K1/K2는 `run.home`의 어느 file에도 없다(`e2e-secret`의 scan 함수 재사용).
- support: 지금 것만.
- 위험: secret.
- 겹침: `e2e-secret`은 한 번 연결한 key가 header에만 있는 것을 본다. 바꾸기·지우기는 안 본다.

#### secret-redaction-in-content

- 설명: key 문자열이 agent가 읽은 file이나 사람이 쓴 글 속에 있어도 model 요청과 ledger/blob에 남지 않는다(child → core `redact_request` 길).
- 근거: `research/facts-main.md` 11절의 redaction 채널 (b)(child가 model로 갈 요청·tool 결과·저장할 blob을 core에 가림 구간을 청한다. 못 끝내면 보내지 않는다); `archived/platform.md` secret 이동 3건; `archived/code-health.md`/mistakes 없음. **기록에 bug가 없는 설계 불변식**이다(근거 약함).
- 경계: child ↔ core `redact_request`(감독 pipe) ↔ I/O worker blob. boundary `secrets`, `child-supervision-protocol`.
- 단계: (1) 준비 + `proj/.env`에 `API_KEY=<K>` (2) `openSession(lophn)`(project 폴더 읽기만 가능) (3) `say`("읽어 줘") (4) `waitTurnEnd` (5) 행 2: `say` 글에 `<K>` 포함 (6) 단정.
- fake 대답(2): ① tool `file_read`(`.env`) ② text.
- 단정(3): fake: 둘째 요청 본문 전체에 K 없음(첫 요청에도 없음. 행 2는 사람 글). disk: `secrets.json`을 뺀 `run.home`·`core.log`에 K 없음(blob, ledger 포함). ledger: `tool-calls/list`·`messages/list`·`model-calls/list` 출력에 K 없음.
- support: 지금 것만.
- 위험: secret.
- 겹침: `e2e-secret`은 K가 content로 흐르지 않는 turn만 본다. 이 후보가 redaction 길을 처음 지난다.

#### rewind-after-restart

- 설명: core가 꺼졌다 켜진 뒤에도 session rewind가 rewind 전에 기록해 둔 pre-image로 file을 되돌린다.
- 근거: `archived/place-session.md` "pre-image를 core가 읽어 두는 memory route 둘과 root별 기록"(kept, "되돌릴 때 틀린 내용으로 사람 파일을 덮지 않게 한다"); rewind 쪽 commit 14개(`packages/core/lophn-agent/session/rewind`); 재시작 때 `7202664e2`, `aeb55cb86`(같은 data root 재기동 실패 둘). 메모리에만 있는 기록이 있으면 재시작 뒤 복원이 빈다.
- 경계: child(쓰기) → core(pre-image 기록) → ledger/blob(디스크) → 새 core process. boundary `agent-sessions`, `agent-tools`.
- 단계: (1) 준비 + `a.md`=`v0` (2) `say` + `waitTurnEnd`(v1, v2 두 번 씀) (3) `core.kill()` (4) `bootCore(run)` (5) `rewind/preview` → `rewind/apply` (6) 단정.
- fake 대답(2): ① tool `file_write` ×2 ② text.
- 단정(3): disk: `a.md`=`v0`. ledger: `rewind/list`의 rewind가 `applied`, `a.md` 항목 `restored`. preview: `restore`에 `a.md`, `skip`/`remain` 비어 있음.
- support: 지금 것만.
- 위험: 데이터 잃기.
- 겹침: `e2e-rewind`(재시작 없음)와 `e2e-restart`(rewind 없음) 사이.

#### rewind-extra-rows  (`e2e-rewind` table에 행으로)

- 설명: rewind의 위험한 가장자리를 같은 flow의 행으로 더한다: (a) agent가 새로 만든 file은 되돌리면 지워지고, 그 사이 사람이 고쳤으면 남는다 (b) 도는 turn이 있으면 rewind 시작이 거절된다 (c) `accept_remaining: false`인데 건너뛸 file이 있으면 거절되고 아무것도 안 바뀐다 (d) project Operator의 쓰기도 기록돼 되돌아간다.
- 근거: `architecture/place-session.md`("session rewind는 도는 turn이 없을 때만 시작한다", pre-image 판정 규칙 `chain_broken` 등 skip 사유 아홉); `archived/place-session.md` 둘("PM이 초안 폴더를 연 같은 turn에 쓰면 forbidden", "앱 place의 Operator는 file 범위가 없다")이 rewind의 쓰기 폴더 목록이 따로 만들어져 PM 초안·project Operator를 빠뜨린 것을 고쳤다(폴더 규칙 사본이 어긋난 것 3번).
- 경계: 위와 같음.
- 단계/fake/단정: `e2e-rewind`와 같은 모양에서 행마다 3개 이하. (d)는 `operators/create` → `openSession({role:"operator", agent})`가 한 단계 더 든다.
- support: 지금 것만(Operator 행은 route를 직접 부른다).
- 위험: 데이터 잃기.
- 겹침: `e2e-rewind`의 변형 행(새 file을 만들지 않는다. 규칙 6).

#### command-tool-credential

- 설명: 이름이 route와 다른 command tool(예 PM `operator.create` → `CreateOperator`)이 agent credential 상한에 막히지 않고 core에서 성공한다.
- 근거: `archived/agent-definition.md` "agent credential의 operation이 tool 이름이라 이름이 다른 command tool이 거절된다"(fixed; "core를 띄워 실제 거절을 확인", guard는 App Engineer 한 role의 상한 unit 하나); commit `b94614906`; change-log "agent credential 상한을 tool 이름이 아니라…". 영향이 "agent의 주요 일이 막힌다"(ticket, context 제출, operator, `call`/`reply`/`cancel` 전부)였다. 고친 횟수 1이지만 guard가 한 role 한 tool이다.
- 경계: child(agent credential) → core `authorize`. boundary `agent-tool-spi`, `agent-tools`, `core-api`.
- 단계: (1) 준비 + project (2) `openSession(project_manager)` (3) `say` (4) `waitTurnEnd` (5) 단정.
- fake 대답(2): ① tool `operator_create`(인자는 tool 정의에서 읽음) ② text.
- 단정(3): ledger: `tool-calls/list`가 `success`(`forbidden` 아님). `agent-definitions/list`에 그 operator가 있음. disk: operator 정의 file이 data root 아래에 생김(자리는 코드에서 읽음).
- support: 지금 것만. (같은 reply에 `visual_show`, `context_submit`처럼 이름이 다른 tool을 행으로 더할 수 있다. 다만 `context.submit`은 context가 필요하다.)
- 위험: 권한(막힘 방향), 핵심 흐름.
- 겹침: 없음. 순수 불변식(모든 tool의 `operations`가 role 상한에 든다)은 harness에 둔다(아래 unit 목록 U1).

#### stop-triggers  (`e2e-stop` table에 행으로, N1)

- 설명: model 요청 중 turn이 끝나는 다른 길(session archive, session delete)도 진행 중인 요청을 끊고 tool을 안 돌린다.
- 근거: N1(`driver.stop`/`endSession` 호출처 없음); `architecture/place-session.md`("archive와 지움은 모든 영향을 한 tx. 도는 turn은 interrupted로 닫고 진행한다"); `interrupt.ts`의 `session_ended`.
- 경계: core(`sessions/archive|delete`, `interruptRunningTurns`) → child loop → HTTP 연결. boundary `agent-sessions`, `run-loop`.
- 단계: `e2e-stop`과 같고 4번만 `stopTurn` 대신 `core.call(sessions/archive)` 또는 `sessions/delete`.
- fake 대답(1): `stall`(tool 인자 앞 절반).
- 단정(3): fake: `aborted(1)`이 풀림, journal 1개. ledger: turn `interrupted/session_ended`. disk: file 없음.
- support: 지금 것만.
- 위험: 핵심 흐름(token이 새는 열린 요청).
- 겹침: `e2e-stop`의 행.

#### ask-roundtrip

- 설명: agent의 `ask`가 turn을 세우고, 사람의 답(`ask/answer`)이 tool 결과로 돌아간다. 기다리는 중 사람이 말하면 `human_message`, 꺼졌다 켜지면 `cancelled`다.
- 근거: `archived/approval.md` kept("Gate 물음과 ask 기다림을 core main thread 메모리 route 둘로", 재시작이 기다리던 turn을 끊는 것이 의도); commit `72b3b0f07`(ledger 질문 길 삭제로 메모리 `ask`만 남음); `protocol/lophn-agent/ask-tool.ts`의 outcome 셋. 기록에 bug는 없음(근거 약함).
- 경계: child(`ask/wait` 긴 호출) ↔ core 메모리 ↔ 사람 route. boundary `approvals`, `run-loop`.
- 단계: (1) 준비 (2) `openSession(lophn)` (3) `say` (4) `session_snapshots/list`의 `questions[]`가 보일 때까지 기다림 (5) `core.call(ask/answer)` (6) `waitTurnEnd`.
- fake 대답(2): ① tool `ask`(질문 1개, option 2개) ② text.
- 단정(3): fake: 둘째 요청의 `ask` tool_result에 `outcome: submitted`와 고른 label. ledger: turn `completed`, `ask/read`가 이제 `not_found`. 행 2(기다리는 중 `messages/send`)는 `human_message`, 행 3(kill 뒤 재시작)은 turn `interrupted/restarted`와 snapshot의 `questions` 비어 있음.
- support: 지금 것만 + 질문 기다림 helper 하나(`waitPermission`과 같은 snapshot 읽기).
- 위험: 핵심 흐름.
- 겹침: `e2e-approval`은 같은 모양이지만 route가 다르다(`approvals/decide_turn`).

#### two-providers-key-isolation

- 설명: provider A의 key는 A의 endpoint로만, B의 key는 B로만 간다.
- 근거: `archived/platform.md` provider key 항목의 guard 하나("attach는 허락한 provider endpoint origin이 아닌 목적지에 값을 붙이지 않는다")와 change-log 결정("secret 이름은 `provider.<id>`만 받는다. 다른 이름을 가리키면 앱·MCP secret이 provider endpoint로 갈 수 있다"); change-log "MCP 설정은 아무 secret 이름이나 받아 provider key … 를 MCP URL로 보낼 수 있었다". 고친 횟수 1(guard는 unit).
- 경계: core attach → child 전송. boundary `secrets`, `models`.
- 단계: (1) fake server 둘 (2) 서로 다른 `key`의 정의로 `providers/connect` 둘 + `secrets/put` 둘(`connectFakeProvider`에 provider key 인자) (3) `model-default/change`로 A (4) `say` + `waitTurnEnd` (5) B로 바꿔 한 번 더 (6) 단정.
- fake 대답(2): 각 server에 text 하나.
- 단정(3): fake A의 journal은 K_A만, fake B의 journal은 K_B만. disk: 두 key 모두 `secrets.json`에만. ledger: `providers/read` 출력에 key 없음.
- support: 지금 것 + `connectFakeProvider`가 정의 `key`를 인자로 받게(작은 확장).
- 위험: secret.
- 겹침: `e2e-secret`은 provider 하나.

#### gateway-turn-events

- 설명: shell main이 의존하는 Gateway(`GET /gateway`, subprotocol `lophn.gateway.1`)가 user token으로 event를 흘려 주고(권한 요청, turn 끝), token 없이는 안 열린다.
- 근거: commit `5e99b50f7`("ledger event 구독을 Bus와 Gateway로 바꿈"), `6fb8e7312`("core event를 Gateway로 relay하고 shell main을 새 계약으로 옮김")가 test 없이 들어왔다; `984f2d97d`(옛 events-subscribe real-core test의 WebSocket 기한·누수 수정); `architecture/event.md`("Bus는 놓칠 수 있고 정본은 Ledger"). 고친 bug 기록은 없음.
- 경계: shell main ↔ core Gateway(WebSocket). boundary `event-stream`, `core-api`.
- 단계: (1) 준비 (2) Gateway 연결(`watch`) (3) `say`(묻는 쓰기) (4) event `PermissionRequested`를 받고 `decide` (5) `waitTurnEnd` (6) 단정.
- fake 대답(2): `e2e-approval`과 같음.
- 단정(3): event 순서(권한 요청 → turn 끝)와 중복 없음. 늦게 붙은 client는 `session_snapshots/list`로 같은 상태를 읽음(ledger). 토큰 없는 upgrade는 거절(`unauthorized`).
- support: 지금 것 + Gateway client 한 줄(support-core brief가 이미 "Gateway event로 기다려도 됨"이라고 적음).
- 위험: 핵심 흐름, 권한.
- 겹침: 없음. UI E2E는 범위 밖이라 이 경계를 보는 유일한 자리다.

### 지금 것에 작은 support를 더하면 되는 것

#### pm-draft-folder-write-rewind

- 설명: PM이 `context.draft`로 초안 폴더를 열고 **같은 turn**에 거기 쓴다. 쓰기가 성공하고 rewind로 되돌아간다.
- 근거: `archived/place-session.md` 둘("PM이 초안 폴더를 연 같은 turn에 쓰면 forbidden이다", "agent runtime process의 Deno 권한에 place 폴더가 없다")이 같은 폴더 규칙의 어긋남 3곳(turn scope, rewind 목록, runtime Deno 권한) 중 둘이다; change-log "agent가 data root 밖 place 폴더에서 일하고, 초안 폴더를 연 turn에 바로 쓴다". 초안 폴더는 `<data root>/projects` 아래라 runtime 권한은 상위째 쓰기다. 고친 횟수 2 (+`placeFoldersOf` 목록). 
- 경계: child(`scope.open`, Deno 권한) ↔ core(초안 폴더 열기, rewind 기록). boundary `agent-tools`, `agent-sessions`, `contexts`.
- 단계: (1) 준비 (2) `say` (3) `waitTurnEnd` (4) `rewind/preview`+`apply` (5) 단정.
- fake 대답(3): ① tool `context_draft`(새 context 이름·목적) ② tool `file_write`(경로 = ①의 tool_result에 있는 폴더) ③ text.
- 단정(3): disk: 초안 폴더 안에 file. ledger: `tool-calls/list` 둘 `success`. rewind 뒤 file 없음(`rewind/list` `applied`).
- support: **fake reply를 앞 요청에서 계산하는 함수로 줄 수 있어야 한다**(②의 폴더는 id가 생성돼 미리 모른다). 이것만 있으면 된다(`Step.reply`를 `(journal) => Reply`로 허용).
- 위험: 데이터 잃기(되돌리기), 권한.
- 겹침: `e2e-file-write`(project 폴더)와 `e2e-rewind` 모두 초안 폴더 경로를 지나지 않는다.

#### provider-disconnect-aborts-turn

- 설명: 사람이 provider를 끊으면(`providers/disconnect`, shell main 역할) 진행 중인 요청이 끊기고 `secrets.json`의 key가 지워지고 다음 turn은 요청을 안 보낸다.
- 근거: change-log 0.2.0("끊기는 `secrets.json`의 값도 지운다"); 옛 commit `13ae22cbb`("Disconnect removes the keychain secret and stops in-flight runs"); 코드 `providers/watch.ts` + `driver.revokeProvider`(이것은 N1과 달리 호출처가 있다). guard 없음.
- 경계: shell main(결정 handle) → core → child. boundary `secrets`, `run-loop`, `child-supervision-protocol`.
- 단계: (1) 준비 + `stall` (2) `say` + `fake.arrived(1)` (3) parent pipe로 `confirmation_handle_register` (4) `providers/disconnect` (5) `fake.aborted(1)` + `waitTurnEnd` (6) `say` 한 번 더.
- fake 대답(1): `stall`.
- 단정(3): fake: `aborted(1)`, 마지막 `say` 뒤에도 journal 1개. disk: `secrets.json`에 key 없음. ledger: 첫 turn 끝 이유와 둘째 turn `failed`(이유는 코드가 정한 값).
- support: shell main 역할 일부: `bootCore`가 쥔 parent pipe로 `confirmation_handle_register` frame을 보내고 `confirmation_handle_registered`를 받는 helper(facts 9절이 "parent pipe를 쥔 test가 직접 등록할 수 있다"고 적음).
- 위험: secret, 권한.
- 겹침: 없음.

#### mcp-secret-destination

- 설명: MCP http server의 credential이 그 server의 origin으로만 가고, 다른 origin의 MCP server나 provider endpoint에는 안 간다.
- 근거: change-log 0.2.0 "MCP credential과 OAuth token을 `secrets.json`으로 옮기고"(전: "MCP 설정은 아무 secret 이름이나 받아 provider key나 다른 서버의 token을 MCP URL로 보낼 수 있었다"); `archived/platform.md` "설정 화면의 보호 입력 창이 열리지 않아 MCP credential을 넣을 수 없다"(fixed, guard는 unit 셋); `archived/agent-definition.md` "외부 MCP tool 이름을 읽는 route가 없어 …"(fixed, 닫음에 "실제 서버 연결은 확인하지 않았다(process를 건너는 확인은 E2E 몫)"). 방금 land했고 E2E가 없다.
- 경계: core attach → child의 MCP client → 외부 MCP server. boundary `secrets`, `agent-tools`, `child-supervision-protocol`.
- 단계: (1) fake MCP server 둘(loopback http, JSON-RPC `initialize`/`tools/list`/`tools/call`) (2) 기동 전 `settings.json`의 `lophn-agent.extensions.mcp_servers`에 둘을 넣고 한쪽만 `{secret: "mcp.global.<서버>"}` (3) `secrets/put` (4) `say` (5) `waitTurnEnd` (6) 단정.
- fake 대답(2): 모델은 기존 fake(`mcp__<서버>__<tool>` tool call, text).
- 단정(3): MCP server A가 받은 `authorization`에 secret이 있다. MCP server B와 model fake에는 secret이 없다. disk: `secrets.json` 밖에 없다.
- support: fake MCP server(약 100줄)와 `settings.json` 쓰기(이미 `bootCore` option). 서버 설정이 바뀌면 runtime이 교체되므로 `settle`을 쓴다. MCP tool 이름 규칙(`mcp__`)은 코드에서 확인.
- 위험: secret.
- 겹침: 없음. 설정 key와 secret 이름 규칙은 `PLAN-remove-keychain`이 land한 뒤 다시 확인한다.

#### boot-failure-frame

- 설명: ledger가 손상됐으면 core는 아무것도 안 쓰고 `start_failed{reason: damaged_original}` frame을 보낸 뒤 끝나고, 원본 byte는 그대로다.
- 근거: commit `7208838ab`("migration 시작 실패 이유를 `start_failed` frame에 싣는다", 복구본 하나만 남기기); `c4979bf69`("core가 왜 못 켜졌는지 shell main에 알림"); `core/storage/migration/migrations.ts`("지원보다 높은 schema·다른 hash·손상은 아무것도 쓰지 않고 거절한다"). 사용자 data를 지우지 않는 규칙인데 test 없음. 규칙 자체는 temp file unit으로 충분하다(U12). 이 후보는 frame과 종료까지의 process 부분만이다.
- 경계: core → shell main parent pipe. boundary `child-supervision-protocol`, `storage`.
- 단계: (1) boot + `stop()` (2) `home/lophn.db`를 쓰레기 byte로 덮고 hash를 적어 둔다 (3) 다시 띄우기 (4) frame을 읽는다 (5) process 종료 (6) 단정.
- fake 대답(0).
- 단정(3): frame `start_failed`의 reason이 `damaged_original`. disk: `lophn.db` hash가 그대로, 새 db가 안 생김. process: 종료 코드 0이 아니고 child가 없다.
- support: `bootCore`의 실패 변형(hello 대신 `start_failed`를 받는 쪽, 기한 30초). 작음.
- 위험: 데이터 잃기.
- 겹침: `boot_test`는 성공 경로.

### 정한 동작이 없어 먼저 정해야 하는 것

#### restart-queued-message

- 설명: turn이 도는 중 사람이 보낸 두 번째 message(`next_turn`)가 core 재시작 뒤 어떻게 되나.
- 근거: `architecture/place-session.md`("입력함(inbox)은 메모리", "입력함에 있던 call은 lophn_restarted로 닫힘"). call은 닫고 알리는데 **사람 message**는 ledger에 접수 기록만 남고 turn이 안 열린다(코드 읽기: `RecoverCalls`는 call만 다룸). 사람은 "보냈는데 아무 일도 안 일어남"을 본다.
- 경계: core 메모리 inbox ↔ ledger. boundary `agent-sessions`, `router`.
- 단계: (1) 준비 (2) `say` + `fake.arrived(1)`(stall) (3) `say` 한 번 더 (4) `kill()` + `bootCore` (5) 두 번째 message의 상태를 `messages/list`·`turnsOf`로 읽음.
- fake 대답(1): stall.
- 단정: 정해진 뒤에 쓴다(후보: message가 사라지지 않고 새 turn으로 열린다 / 사람에게 보이는 유실 표시가 남는다).
- support: 지금 것만.
- 위험: 데이터 잃기(사람의 입력).
- 겹침: `e2e-restart`와 같은 flow의 한 행이 될 수 있다.

### 앱이 필요한 것 (롤맵 8·9. 다음 계획)

공통 support: test용 앱(`tests/fixtures/apps/<이름>`, git 저장소 맨 위), `apps/create` + `apps/connect_source`, release 준비(`releases/prepare_bundle`은 `coding_agent`/`machine`만), activation(`tickets/verify`는 `agent`만이라 App Engineer의 call이 필요하거나 test가 `TicketVerified`를 만들 길이 필요), Gateway `coding_terminal` frame에서 `LOPHN_CODING_TOKEN`을 받는 shell main 역할, `lophn` CLI 호출. 한 번 만들면 아래 넷이 같이 쓴다.

- **fresh-root-app-release**: 새 data root에서 template 앱이 sdk 사본으로 release 준비까지 간다. 근거: `archived/platform.md` bug 넷이 같은 길에서 연달아 나왔다("data root에 sdk 설치 사본과 앱 template을 까는 코드가 없다", "template 앱의 release 준비가 file 수 상한(10,000)에 걸린다", "화면이 둘 이상인 앱의 합친 `app.js.map`에 `mappings`가 없다", "sdk package가 catalog에 없어…"), 닫음마다 "실제 template 앱으로 … 손으로 확인하지 않았다(E2E 몫)"; commits `8a9d39e21`, `237b0751c`, `3ad9a6eff`. 고친 횟수 4. 단계: `apps/create` → 폴더에 template을 scaffold해 git init/commit → `apps/connect_source` → release 준비(`prepare_bundle`) → `releases/get_record`. 단정: bundle file 수 < 10,000, `<home>/sdk/ui/1.0.0`이 읽기 전용, 화면별 `screens/<key>/main.js.map`. 위험: 핵심 흐름. 주의: `deno cache`가 npm(`lucide-react`)을 받으므로 인터넷이나 미리 채운 `DENO_DIR`이 필요하다(인터넷은 막는 것이라 cache 전제). 
- **app-big-result-frame**: 256KiB가 넘는 호출 결과·changeset·입력이 호출을 "결과 모름"으로 만들지 않는다. 근거: `archived/app-call.md` bug 셋(큰 changeset, rewind 적용 요청, `result`)+commits `f02d5e07c`, `8b5bef93b`, `a1adbf09a`; guard는 unit(`fit_test`, `supervisor-link_test`). 고친 횟수 3(+입력 상한). 단계: write api 호출(작음/큼) → `apps/invocations` → `apps/rewind_plan`. 단정: 큰 write는 `changeset_dropped: too_large`로 succeeded, 작은 write는 되돌아감. 위험: 데이터 잃기. 이미 roadmap 9번.
- **app-rewind-multi-write**: 여러 write를 한 번에 되돌린다(bytes frame stream). roadmap 9. `archived/app-call.md` "앱 rewind가 안 된다"(wiring이 비어 늘 rejected, "연결 자체를 보는 test는 없다"). 위험: 데이터 잃기.
- **app-invocation-restart**: 앱 호출 도중 core가 꺼지면 invocation은 `unknown/core_restarted`, 앱 rewind의 applying은 `cancelled`. 근거: `facts-main.md` 10절, `architecture/app-call.md`. 위험: 데이터 잃기.
- (낮음) **activation-crash-recovery**: `archived/activation.md` kept "끊긴 activation 시도를 이어받는다"(응답 유실 때 이미 채택된 release를 복구본으로 덮는 사고를 막는 분기). 중간에 죽이는 시점 제어가 어렵다.
- (낮음) **app-crash-problem**: 앱 process의 unhandled rejection이 problems ledger에 오른다. 근거: 옛 flow `report-app-problem`, commit `ec61ce4ff`(problems#T25), `563853b2b`. `archived/platform.md` crash log bug 둘.

### coding agent 역할 / session 여럿이 필요한 것

- **agent-call-roundtrip** (roadmap 7): A가 B를 부르면 B의 결과가 A로 돌아온다. 변형 행: 재시작 → `lophn_restarted`, 받는 session archive → `receiver_ended`. 근거: `archived/agent-call.md` bug 둘(옵션이 메모리에만, Router describe의 waiting)+defect 하나(배달 실패 응답 꼴, 이중 통지 → guard `router_test.ts`); `archived/approval.md`("agent call은 call tool이 turn 안에서 먼저 묻는다"). 필요: **session별 queue**(A와 B의 요청 순서가 정해지지 않는다).
- **coding-terminal-gateway**: App Engineer가 ticket을 맡기면 Gateway `coding_terminal` open frame에 `LOPHN_CODING_TOKEN`이 실리고, 그 token으로만 `tickets/claim`이 된다. 근거: commit `1ae03dbb5`(coding terminal 요청을 shell main에서 돌리게 바꿈), `facts-main.md` 7절. 필요: Gateway client + coding agent 역할(`lophn` CLI).
- **hook-turn-end-once**: harness hook(`lophn hook <harness> <event>`)이 turn 끝을 한 번만 알린다. 근거: `archived/coding-agent.md` bug 셋(OpenCode `state_unknown`, 전역 hook이 PATH의 `lophn`을 부름, OpenCode `TurnEnded` 두 번)과 열린 bug(codex hook trust); guard는 unit(`hook-signal_test`, `install_test`). 필요: coding token으로 `coding_agent_sessions/hook`을 부르는 역할. 이 규칙은 unit이 이미 지킨다. process 쪽은 가치가 낮다.

## unit/harness로 보낼 것 (한 process 안의 규칙)

| id | 규칙 | 근거 | 이미 있나 |
|---|---|---|---|
| U1 | 모든 tool·role에서 `tool.operations ⊆ roleOperations(role)` | `archived/agent-definition.md` credential 이름 bug | `main/agent-tools_test.ts`는 한 role 한 tool |
| U2 | 이미지 둘만 history에 남고 나머지는 `[image omitted]`, 예산은 이미지당 4096 token | `archived/agent-definition.md` 이미지 base64 bug | `history_test.ts`, `budget_test.ts` |
| U3 | shell 출력은 stream마다 앞뒤 12 KiB | 같은 file shell 출력 bug | `tools/shell/run_test.ts` |
| U4 | `web.fetch` 대상 판정(loopback, 사설, `::ffff:`, redirect 5 hop) | `archived/agent-definition.md` kept | `web/target_test.ts`(redirect 쪽은 확인 못 함) |
| U5 | `RESULT_MAX_BYTES + overhead < CONTROL_MAX_BYTES` 같은 한도 관계 | `archived/app-call.md` 셋 | `fit_test.ts`, `supervisor-link_test.ts` |
| U6 | `placeScope` 표와 runtime 권한·rewind 목록이 같은 값에서 나옴 | `archived/place-session.md` 3건 | `place-folders_test.ts`(표만) |
| U7 | `applyMigrations`: 손상·newer schema·history 불일치는 파일을 안 바꿈 | `7208838ab` | 없음 |
| U8 | `installCrashHandler`: log 쓰기 2초 기한·stderr fallback | `archived/platform.md` crash 셋 | 없음 |
| U9 | activation: 바쁜 app의 시작은 `conflict`, 허락 뒤 비교가 달라지면 다시 묻기 | `archived/activation.md` queue 항목 | 없음 |
| U10 | OpenCode hook 표(`session.status` idle만 turn 끝) | `archived/coding-agent.md` | `hook-signal_test.ts` |
| U11 | 주석 component chain(`List > Card > Button`) | `archived/annotation.md` | 없음 |
| U12 | 의심 A~D(provider 오류 분류, idle timeout, 연속 partial) | 계획 `harness-wire`, `harness-loop` | 계획 안 |

## 한 눈에 보는 표

| id | 위험 | support | 근거 요약 | 7개와 겹침 | 우선 |
|---|---|---|---|---|---|
| runtime-tool-permissions | sandbox/권한, 두 번 고친 bug | 지금 것만 | 권한 flag 2번 손댐, 실제 turn 미확인 | file-write 확장 | 1 |
| runtime-lost-midturn | 핵심 흐름 | 지금 것 + child pid | N2, 문서에 문장만 | restart의 child 판 | 2 |
| stop-pending-permission | 권한 | 지금 것만 | approval 불변식 | approval+stop 사이 | 3 |
| secret-redaction-in-content | secret | 지금 것만 | redaction 채널(근거 약함) | secret의 빈 곳 | 4 |
| secret-rotate-delete | secret | 지금 것만 | secret 길 3번 갈아엎음 | secret의 다음 단계 | 5 |
| rewind-after-restart | 데이터 잃기 | 지금 것만 | pre-image, 재기동 실패 2번 | rewind+restart 사이 | 6 |
| command-tool-credential | 권한(막힘), 핵심 흐름 | 지금 것만 | 1번 고침, guard 약함 | 없음 | 7 |
| rewind-extra-rows | 데이터 잃기 | 지금 것만 | 폴더 규칙 어긋남 3번 | rewind 행 | 8 |
| stop-triggers | 핵심 흐름 | 지금 것만 | N1 | stop 행 | 9 |
| ask-roundtrip | 핵심 흐름 | 지금 것 + helper | 메모리 route kept(근거 약함) | approval과 닮음 | 10 |
| gateway-turn-events | 핵심 흐름, 권한 | 지금 것 + Gateway client | commit 둘, test 없이 land | 없음 | 11 |
| two-providers-key-isolation | secret | 지금 것 + 인자 | guard unit 하나 | secret | 12 |
| pm-draft-folder-write-rewind | 데이터 잃기, 권한 | fake reply 함수 | 폴더 규칙 3번 | 없음 | 13 |
| provider-disconnect-aborts-turn | secret, 권한 | parent pipe handle | 옛 commit, guard 없음 | 없음 | 14 |
| mcp-secret-destination | secret | fake MCP server | 방금 land, E2E 없음 | 없음 | 15 |
| boot-failure-frame | 데이터 잃기 | bootCore 실패 변형 | `7208838ab` | boot의 실패 경로 | 16 |
| restart-queued-message | 데이터 잃기 | 지금 것만 | 정한 동작 없음 | restart 행 | 정한 뒤 |
| fresh-root-app-release | 핵심 흐름 | 앱 + coding 역할 | bug 4 | 없음(8번) | 다음 계획 |
| app-big-result-frame | 데이터 잃기 | 앱 | bug 3(+입력) | 없음(9번) | 다음 계획 |
| app-rewind-multi-write | 데이터 잃기 | 앱 | wiring 빠짐 | 없음(9번) | 다음 계획 |
| app-invocation-restart | 데이터 잃기 | 앱 | 문서 불변식 | restart의 앱 판 | 다음 계획 |
| agent-call-roundtrip | 핵심 흐름 | session별 queue | bug 2+defect 1 | 없음(7번) | 다음 계획 |
| coding-terminal-gateway, hook-turn-end-once | 권한, 핵심 흐름 | Gateway + coding 역할 | commit 1, bug 3 | 없음 | 다음 계획(낮음) |

## 지금 support만으로 되는 것, 상위 10

우선순위 기준: (1) 기록에서 같은 경계가 두 번 이상 깨졌다 (2) 지금 test로 못 잡는다 (3) 사용자 data·권한·secret이다 (4) 비용이 작다(fake 대답 ≤3, 새 support 없음). 7개와 겹치는 것은 행으로 더한다.

1. **runtime-tool-permissions**: 권한 flag를 손댄 commit이 둘(`59fb5ac20`, `7208838ab`)이고 어느 쪽도 child를 띄워 확인하지 않았다. 닫음 문장이 "E2E 몫"이라고 직접 말한다. tool 다섯을 reply 하나로 부르므로 싸다.
2. **runtime-lost-midturn**: N2. 코드 읽기만으로도 session이 `conflict`로 막힐 수 있다. 사람이 정할 것(끝 이유)이 있어 먼저 현재 동작을 기록하고 정한다. support는 child pid 찾기 정도.
3. **stop-pending-permission**: 낡은 허락이 쓰기를 일으키지 않는 것은 권한 경계다. `e2e-approval`·`e2e-stop`이 둘 다 이 경로를 안 지난다. 대답 하나.
4. **secret-redaction-in-content**: key가 content로 흐르는 길(child → core redaction)은 `e2e-secret`도 안 지난다. secret 경계 중 가장 마지막 안전망이다. 기록 근거는 약하다.
5. **secret-rotate-delete**: secret 길이 이번 판에 세 번 갈아엎어졌고 guard가 unit이다. 알려진 값 registry의 "먼저 등록" 규칙은 바꾸기에서만 보인다.
6. **rewind-after-restart**: pre-image가 메모리에만 있으면 재시작 뒤 복원이 빈다. `e2e-rewind`와 `e2e-restart`가 서로의 빈 곳이다. 데이터 잃기.
7. **command-tool-credential**: 영향이 "agent의 주요 일이 막힌다"였고 guard가 한 role 한 tool뿐이다. 대답 둘.
8. **rewind-extra-rows**: 폴더 규칙 사본이 세 번 어긋나 rewind가 PM 초안·Operator 쓰기를 빠뜨렸다. 새 file 없이 `e2e-rewind`의 행.
9. **stop-triggers**: N1이 맞으면 `e2e-stop`과 같은 bug를 archive/delete 길에서 한 번 더 확인한다. 행 둘.
10. **ask-roundtrip**: 메모리 기다림 route는 approval과 같은 모양이라 재사용이 크다. 기록 근거는 약하지만 사람이 개입하는 흐름이 하나 더 있다. (`gateway-turn-events`는 UI E2E가 범위 밖이라 shell↔core 경계를 보는 유일한 자리지만 Gateway client가 필요해 11위.)

참고: 1~5와 7은 대부분 `try/finally` 한 틀에 table 행으로 들어가고, 1·2·7은 같은 준비(boot, provider, PM, project)를 쓰므로 core를 한 번 띄워 행만 돌리면 된다. 새 E2E는 규칙 7(10번 연속 통과)을 지킨다.

## 옛 e2e suite (`13a7365e9^`의 `e2e/`)

Electron 기반 UI E2E(`e2e/shell/*`, Playwright/CDP, `LOPHN_SHELL_HEADLESS=1`)와 core를 띄우는 flow가 섞여 있었다. 되살리지 않고 무엇을 봤는지만 적는다. "살릴 만한가"는 지금 제품에 그 기능이 남아 있는지(backup/restore, 앱 export, 앱 쌍 연결, update channel, 문서 tracking/series는 10-16에 지워졌다), 위 후보로 이어지는지다.

| flow | 무엇을 봤나 | 지금 후보로 살릴 만한가 |
|---|---|---|
| `harness.ts`, `run.ts`, `main.ts`, `harness_test.ts` | Electron shell + core를 임시 `LOPHN_HOME`으로 띄우고 CDP로 DOM을 읽는 harness. 정확한 pid만 정리 | 아니오. UI E2E는 범위 밖. 정리 방식(남은 process 확인)은 support-core가 이미 가짐 |
| `flows/skeleton` | shell 창이 뜨고 core ready가 보이고, 창을 닫으면 core가 정상 종료 | 일부. core 쪽은 `boot_test`가 보고, 창은 범위 밖 |
| `flows/install-lophn` | `.deb`를 `/opt/lophn`에 설치한 뒤 chrome-sandbox 4755 확인. 설치 전이면 건너뜀 | 아니오(sudo, 배포 test) |
| `flows/update-lophn` | Settings에서 수동 update 확인, 자동 설치 없음 | 아니오(update channel 삭제 `b2d710866`) |
| `flows/backup-and-restore` | 검증된 backup 묶음 복원, 복원 뒤 core가 같은 pipe의 새 hello로 재시작, 창이 기록을 다시 읽음 | 아니오(backup/restore 삭제 `6803dd635`). "새 hello 뒤 다시 읽기"는 `restart` 후보에 이미 있음 |
| `flows/app-export` | core에 `POST /v1/apps/export` → DB 사본(WAL에만 있던 확정 행 포함)과 고정 blueprint 묶음 | 아니오(route 삭제) |
| `flows/build-context`, `first-project`, `write-series` | documents/context slice: 사람이 project 등록, tracking, series, context worker가 만드는 판 | 아니오(tracking/series 삭제 `a17a47bb6`, Context Engineer role 삭제). context 초안은 `pm-draft-folder-write-rewind`가 일부 |
| `flows/connect-apps` | 앱 둘(todo, calendar)이 brokered 연결로 서로 호출, grant 화면 | 아니오(앱 쌍 경로 삭제 `d359d846a`) |
| `flows/flow-new-app` | coding agent가 `lophn_app`으로 앱 등록 → git source 연결 → bundle 준비(`validate`), 준비가 release를 확정하지 않음 | 예, 다음 계획. `fresh-root-app-release`와 roadmap 8 |
| `flows/manage-app-permissions` | Access 탭 grant/회수, 실행 중 자식에 반영 | 일부. grant 회수가 실행 중 앱에 반영되는지(앱 필요) |
| `flows/manage-provider-connection` | Settings Providers: 연결 한 개, Disconnect만 있고 계정 목록·테스트 단추 없음 | 아니오(UI). Disconnect의 process 효과는 `provider-disconnect-aborts-turn` |
| `flows/report-app-problem` | 깨진 앱(`fixtures/apps/broken`)이 supervisor 아래에서 view 오류를 내고 [Report a problem]이 문제로 쌓임 | 일부. 앱 crash → problems ledger 쪽만(`app-crash-problem`) |
| `flows/restore-app-release` | release 둘을 준비하고 이전 판으로 돌아가기(Version 탭) | 일부, 다음 계획(앱 필요, `activations/activate_previous`) |
| `flows/run-app-automation` | 앱 자식 안의 시계가 automation을 일으킴 | 아니오(automation 삭제) |
| `flows/app-screen-check` | offscreen Electron host로 앱 화면 검사(test runner) | 아니오(Electron) |
| `flows/verify-app-repair`, `shell/issues-*` | fake coding agent가 수리 기록을 남기고 Issues 화면이 닫기·다시 열기를 보호 창으로 처리 | 아니오(UI, 보호 창) |
| `coding-agent/adapter-install` | 일곱 제품 adapter의 설치가 고른 target만 바꾸고 다른 제품 설정은 읽지도 만들지 않음(temp HOME) | 아니오. 지금은 전역 hook 설치 unit(`install_test`)이 본다 |
| `coding-agent/connect-coding-agent`, `start-coding-agent`, `manage-tickets`, `session-plan` | PATH의 fake Codex 감지, 연결 form, ticket 만들기·시작 계획 | 아니오(UI). 감지·계획은 CLI unit. `coding-terminal-gateway` 후보로 일부 이어짐 |
| `coding-agent/repair-steps/stages` | 수리 script가 stdio JSON-RPC로 test bridge를 부르고 실제 core tool을 부름 | 아니오(repair 삭제 `c66cda5fb`) |
| `sdk/capabilities`, `cap-store`, `cap-schedule/*` | cap-fs·net·store·save·secret이 실제 broker에 닿는 자리, 화면 context·주석이 실제 core grant와 앱 자식으로 | 일부, 앱 필요. broker는 남아 있고 cap-schedule/screen-context는 삭제됨 |
| `sdk/permission-table` | release 준비의 요구 permission 표 == 각 capability `checkDeclaration` (core가 표를 옮겨 씀) | 아니오(E2E 아님). 대조 unit 하나로 충분 |
| `sdk/format-document`, `sdk/blueprint/reexport` | format-document catalog 등록, blueprint 재노출 | 아니오 |
| `shell/app-bridge`, `app-card`, `app-isolation`, `app-decisions`, `app-screen-test`, `broken-app`, `native-view`, `overlay`, `report-problem`, `sandbox`, `packaged`, `project-workspace-terminal`, `read-edit`, `save`, `terminal` | 실제 Electron(offscreen)으로 앱 view 격리·preload bridge·native view 배치·overlay·sandbox·packaged smoke·PTY | 아니오. 전부 UI/Electron(범위 밖) |

## 근거로 쓴 commit (핵심)

- 기동 실패 넷(10-16, test 없이 rebuild): `0b26df161`(reader 등록 중복), `19e7397d5`(Worker가 URL로 불러오는 export를 dead-export sweep이 지움), `7202664e2`(같은 root 두 번째 기동), `aeb55cb86`(provider 더한 뒤 두 번째 기동). `boot`와 `restart`가 잡는다.
- 권한/경계: `59fb5ac20`(place 폴더 권한), `7208838ab`(net_any), `b94614906`(credential 상한).
- 앱 frame: `f02d5e07c`, `8b5bef93b`, `a1adbf09a`. 새 root 앱 release: `8a9d39e21`, `237b0751c`, `3ad9a6eff`. crash log: `5ad6df39b`, `563853b2b`.
- secret: `0d0c6535d`, `34ccf06af`, `1bbb64d9a`.
- 옛 real-core test 안정화(Q31): `e73b40764`, `984f2d97d`, `ab62c6722`(child 끝 hook, reader 재기동, documents coordinator 교체 중 요청 유실).
