# 후보: architecture 불변 조건에서 뽑은 core E2E flow

기준: main checkout, `project-docs/architecture/*.md`의 "지키는 것". 코드는 고치지 않았고 test·check·provider 호출은 하지 않았다(file만 읽음). "코드로 읽음"은 돌려 보지 않았다는 뜻이다. 짐작은 "짐작"으로 적었다.

## 0. 읽는 법

- 지금 있는 7개: `boot`, `file-write`, `approval`, `rewind`, `stop`, `restart`, `secret`(`plan/testing/tasks/e2e-*.md`; boot는 `e2e-support-core.md` 안).
- support 약칭
  - **없음**: 위 7개가 쓰는 helper(`createRun`, `startFakeServer`, `bootCore`+`kill`/`stop`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `waitTurnEnd`, `waitPermission`, `decide`, `turnsOf`, `stopTurn`, core에 route 직접 호출)만으로 된다.
  - **작은 helper**: 같은 support에 함수 하나(예: `/proc`에서 child를 kind별로 찾기. `kill()`이 이미 `/proc/<pid>/environ`을 읽는다)를 더하는 정도. "지금 것만"에 넣어 센다.
  - **session 여럿**: 한 file에서 session 둘 이상. fake queue는 하나(FIFO)라, 대답을 대칭으로 만들거나 순서를 신호로 고정하는 것까지는 지금 것으로 되고, 순서가 갈리는 flow는 session별 queue가 든다.
  - **앱**: test용 앱(`fixtures/apps/`), 앱 만들기, release·activation. **coding 역할**: Gateway `coding_terminal` frame을 받아 token을 꺼내고 `lophn` CLI(또는 같은 route)를 coding_agent 자격으로 부르기. **그 밖**: 위에 없는 것.
- 건너는 process 약칭: **test**(= shell main 역할, HTTP·Gateway client), **core**(daemon: HTTP·WS, Bus, Reactor, Router, writer·reader·I/O worker), **runtime**(agent runtime child, kind `lophn-agent/runtime`), **sup**(`apps/supervisor`), **app**(앱마다 Deno child), **worker**(`platform/io`, `documents/contexts`, `apps/release`, `apps/data`, `problems/test-runner`, `problems/report-collector`).
- route 이름은 `resource/method` 경로다(`packages/protocol`에서 확인). tool 이름은 wire 이름(`.`이 `_`, 예 `file_write`).

## 1. 문서마다 무엇을 골랐나

| 문서 | 고른 것(process 경계가 필요) | 거른 것(이유) |
|---|---|---|
| approval.md | turn 안 request는 cancelled(거절과 구별), "이 session 동안" 허락은 재시작에 사라짐, 보류 request는 표에 남고 꺼진 사이 낀 허락을 재시작이 적용, agent call은 Gate가 두 곳 | Gate 순수 함수, 지문 재비교, 카드 내용 program 생성, pending 중복 방지(앞은 unit/harness가 이미 봄) |
| place-session.md | 폴더 목록이 바뀌면 runtime 재기동·돌던 turn 끊김, archive/지움이 한 tx로 묶여 child의 turn도 끊김, 입력함 call은 재시작에 `lophn_restarted`, `receiver_ended`, steer는 checkpoint 아님, file tool scope | role·place 고정, 하나씩 규칙, fork가 가져가는 것(route 수준, harness) |
| agent-call.md | call 왕복, 재시작에 조용히 사라지는 call 없음, receiver_ended 한 번만 알림, Gate 두 곳 | 이름 풀기, dedup, 입력함 순서(Router 단위) |
| app-call.md | 모든 호출이 core를 지남, 결과 모름(unknown), rewind 한 transaction과 control frame 한도, 앱 process 권한 | 직렬화 두 겹 세부, call_loop·깊이(순수 규칙) |
| activation.md | 이전 process 종료 확인 뒤 새 process, migration 실패 복원, 끊긴 시도 이어받기, 선언이 늘면 묻기 | 순서 규칙의 개별 단계(앱 flow 안에서 같이 봄) |
| coding-agent.md | token은 앱 하나 범위·회수·저장 안 함, session 끝 길마다 call이 한 번만 닫힘 | PTY 입력 규칙, harness 설치(shell main 몫, UI 범위 밖) |
| event.md | Reactor가 ledger에서 이어 감(재시작), Gateway ready→snapshot, 느린 구독자 | Bus가 commit 뒤에만, domain event 종류 제한(unit) |
| annotation.md | App Engineer가 `annotation:<id>`로 screenshot을 읽음(자기 앱만) | 신원은 shell main이 정함(Electron 몫), 화면 그리기 |
| agent-definition.md | provider key·secret은 child 밖으로 안 샘(tool 결과 redaction 포함), compact 실패해도 이력 보존, ask 왕복 | prompt 조립 bytes 동일성, 도구 목록 일치, tool 결과 24KiB, 이미지 둘(순수 함수 → harness) |
| layers.md | import graph 때문에 child가 시작부터 죽는 문제(= 모든 상시 child가 떴나) | import 방향 규칙(`tools/check-deps.ts`가 봄) |
| ui-kit.md | 없음(UI·design 범위) | - |

## 2. 후보

번호는 §4 표와 같다. 각 후보의 "단정"은 서로 다른 곳이고, 대답이 3을 넘는 곳은 이유를 적었다.

### 2.1 지금 support만으로 되는 것

#### 1. stop-while-asking
- 설명: Gate에 걸려 사람 허락을 기다리는 turn을 사람이 멈춘다. request는 거절이 아니라 cancelled로 닫히고, 쓰기는 일어나지 않고, 늦게 온 허락은 쓰이지 않는다.
- 지키는 것: `approval.md` "request"(침묵·원래 일이 끝나면 cancelled, 허락은 한 번), `place-session.md`(대기 request는 cancelled). boundary `approvals`, `run-loop`, `agent-sessions`.
- 경계: test → core(`turns/stop`, turn 안 request는 core 메모리) → 감독 pipe → runtime(Gate 응답을 기다리던 loop).
- 단계: ① `openSession(project_manager)` ② `say` ③ `waitPermission` ④ `turns/stop` ⑤ `waitTurnEnd` ⑥ `approvals/decide_turn`(늦은 allow).
- fake: ① tool `file_write` `{path:"LOPHN.md", content:"rules"}`(`LOPHN.md` 쓰기만 Gate가 묻는다. `place-session.md`/`approval.md`).
- 단정: disk에 `LOPHN.md` 없음 / ledger: `turns/read`가 finished·interrupted(`user_stopped`), `tool-calls/list`에 성공 없음, 늦은 `decide_turn`이 오류(코드로 읽음: `turn-requests.ts`의 `cancel`이 entry를 지워 `not_found`) / fake journal 1개.
- support: 없음.
- 위험: 권한.
- 겹침: `e2e-approval.md`(허락·거절), `e2e-stop.md`(model 요청 중 멈춤) 둘의 중간. 두 경로를 한 번에 안 보므로 겹침은 부분. `e2e-stop`의 행 하나로 두는 것도 된다.
- harness로: 일부. loop가 "Gate 대기 중 stop"에서 끝나는지는 harness loop 한 행. cancelled가 core 메모리에서 풀리는 쪽은 process가 필요.

#### 2. runtime-ends-mid-turn
- 설명: turn이 도는 중 agent runtime child가 끝난다. (a) 새 project 등록으로 core가 권한 목록을 바꿔 다시 띄움, (b) 누가 SIGKILL. 돌던 turn과 session이 어떻게 되는지, 새 child가 새 폴더 권한을 갖는지 본다.
- 지키는 것: `place-session.md` "file tool의 범위"("폴더 목록이 바뀌면 process를 다시 띄우고 돌던 turn은 끊긴다"), `event.md`("돌던 turn은 interrupted로 닫고"), 과거 bug(`issues/archived/place-session.md` "agent runtime process의 Deno 권한에 place 폴더가 없다"). boundary `run-loop`, `supervision`, `agent-sessions`.
- 경계: core(권한 목록 polling 1초, supervisor) ↔ runtime(Deno 권한이 spawn 때 고정). 다시 뜬 child와 옛 turn 사이.
- 단계: ① `openProject(p1)`, `openSession(PM, p1)` ② `say` ③ `fake.arrived(1)` ④ (a) `openProject(p2)` / (b) runtime pid에 SIGKILL ⑤ settle(runtime 재기동 확인) ⑥ 같은 session에 `say`(다시) → `waitTurnEnd`.
- fake: ① stall(tool call 인자 앞 절반) ② (a) tool `file_write` into p2 폴더 / (b) text ③ text.
- 단정: ledger: 첫 turn이 닫혔다(정한 값으로. 아래 의심 참고)이고 둘째 turn이 `conflict` 없이 시작해 completed / fake: `aborted(1)`(옛 요청이 끊김), journal 2 / (a) disk: p2에 file 생김(새 child 권한이 p2를 포함), (b) process 목록: runtime child 하나(새 pid), `platform/status`의 agent-runtime 항목이 available.
- support: 작은 helper(kind별 pid 찾기).
- 위험: 핵심 흐름·권한(두 번 고친 bug 근처).
- **의심(코드로 읽음, 안 돌림)**: child 하나가 끝났을 때 running turn을 닫는 곳을 못 찾았다. `interruptRunningTurns`는 core 시작(`RecoverCalls`)과 session 끝에서만 불리고, `runtime.ts`의 `onEnd`는 agent credential만 끝낸다. `turns/start`는 "the session already has a running turn"이면 `conflict`다. 맞다면 (a)·(b) 모두 turn row가 running으로 남아 그 session은 사람이 `turns/stop`을 누를 때까지 새 입력을 못 받는다. 기대 동작은 사람이 정해야 한다(추천: child가 끝나면 core가 그 child의 running turn을 interrupted로 닫는다). 이 E2E가 먼저 이 의심을 확인하게 된다.
- 겹침: `e2e-file-write`(권한 반영, 단 project를 미리 등록해 둠), `e2e-restart`(core 재시작). child 단독 종료는 둘 다 안 본다.
- harness로: 아니오(process 경계 자체).

#### 3. end-session-mid-turn
- 설명: 모델이 응답 중인 turn의 session을 사람이 archive 또는 delete 한다. core는 한 tx로 turn을 interrupted로 닫고 기록을 지우는데, child는 계속 token을 쓰지 않아야 한다.
- 지키는 것: `place-session.md`("archive와 지움은 모든 영향을 한 tx에 묶는다. 도는 turn은 interrupted로 닫고 진행한다"). boundary `agent-sessions`, `run-loop`.
- 경계: test → core(`sessions/archive`|`sessions/delete`) → runtime의 model 요청(HTTP) 끊김.
- 단계: ① `openSession(PM)` ② `say` ③ `fake.arrived(1)` ④ `sessions/read`(compare용) → `sessions/archive`(행 a) 또는 `sessions/delete`(행 b) ⑤ `fake.aborted(1)` ⑥ 새 session에서 `say`가 completed.
- fake: ① stall ② text.
- 단정: fake: `aborted(1)`가 제한 시간(예 30초) 안에 풀림, journal 1 / ledger: (a) turn finished·interrupted(`session_ended`), session archived / (b) `sessions/read`가 `not_found` / process: runtime 살아 있음(새 session turn completed, journal 2).
- support: 없음.
- 위험: 데이터 잃기(delete가 다른 session을 안 건드림)·비용.
- **의심(코드로 읽음)**: `core-ports.ts`의 `stop()`은 `turns/read`가 실패하면 `{stopped:false}`로 본다. delete는 turn row를 지우므로 (b)에서 child가 멈춤 신호를 못 받고 `stall_ms`(300초)까지 요청을 쥘 수 있다. (a)는 row가 finished로 남아 신호가 간다. 또 `protocol/lophn-agent/sessions.ts:255`의 delete 주석("진행 중인 run이 있으면 conflict")은 `session/commands.ts:205`("도는 turn은 interrupted로 닫고 진행")와 다르다(주석이 낡음).
- 겹침: `e2e-stop`(`turns/stop`), `e2e-restart`. session 끝은 안 봄.
- harness로: archive의 tx 묶음은 core 단위 test가 있을 수 있음. child의 요청 끊김은 process가 필요.

#### 4. shutdown-orphans
- 설명: model 요청이 진행 중일 때 core가 끝나는 두 길(정상 종료, SIGKILL)에서 child와 요청이 남지 않는다. 정상 종료는 run metadata를 지운다.
- 지키는 것: `layers.md`("process마다 Deno 권한을 좁혀 띄운다"), `place-session.md`/`coding-agent.md`("lophn이 꺼져도 ... 살려 두지 않는다"의 같은 정신). 문서에 child 정리를 직접 적은 문장은 없다. 근거는 코드(`daemon/parent.ts`의 `watchParent`: pipe EOF·`stop` frame이면 shutdown, `base/install/instance-lock.ts`: 죽으면 커널이 lock을 푼다)와 boundary `supervision`, `server`.
- 경계: test(pipe) → core → runtime·sup·worker(`platform/io` 등) → model HTTP.
- 단계: ① `openSession` ② `say` ③ `fake.arrived(1)` ④ (a) `core.stop()` / (b) `core.kill()` ⑤ `fake.aborted(1)` ⑥ `bootCore`(같은 run) → `platform/status` ready.
- fake: ① stall ② text(없어도 됨).
- 단정: process: `LOPHN_HOME=<run.home>`을 가진 process가 없다(`/proc`) / fake: `aborted(1)` 풀림(child가 요청을 놓음) / disk: (a) `run/location.json` 없음(정상 종료에서만 지움), (b) 재기동 뒤 둘째 core가 정상.
- support: 없음(`kill`/`stop`이 이미 child 소멸을 확인).
- 위험: 데이터 잃기(두 instance가 한 DB)·비용(남은 child의 요청).
- 겹침: `boot`(kill→재기동, 종료 뒤 leftover), `restart`(kill). 빠진 것은 "요청이 진행 중일 때"의 `aborted` 단정과 정상 종료의 metadata 정리. `boot` 행 추가로 충분.
- harness로: 아니오.

#### 5. second-core-same-root
- 설명: 같은 data root에 core를 하나 더 띄우면 둘째가 시작을 거절하고, 첫째의 data와 metadata는 그대로다.
- 지키는 것: boundary `supervision`·`server`(instance lock: `acquireInstanceLock`이 `conflict` "이미 실행 중인 instance"). 문서(architecture)에는 문장이 없다. data 잃기 규칙이라 골랐다.
- 경계: core 둘(process 둘)이 한 `lophn.db`·`run/`을 둘러싼다.
- 단계: ① `bootCore(run)` ② `openSession`+`say`+`waitTurnEnd` ③ `bootCore(run)` 둘째(실패 기대) ④ 첫째 `platform/status`, `messages/list` ⑤ 첫째 `stop()`.
- fake: ① text.
- 단정: process: 둘째가 non-zero로 끝나고(`start_failed` frame의 reason) 그 child가 하나도 안 남음 / ledger: 첫째의 `messages/list`·`turns/list` 개수 불변 / disk: `run/location.json`의 `api_port`가 첫째 것 그대로(둘째가 덮어쓰지 않음).
- support: 작은 helper(`bootCore`가 hello 대신 `start_failed`를 빨리 돌려주는 변형. 지금 계획은 hello가 안 오면 30초 뒤 실패).
- 위험: 데이터 잃기.
- 겹침: 없음(`boot`는 SIGKILL 뒤 재기동 = lock이 풀린 뒤).
- harness로: `acquireInstanceLock` 자체는 file lock 함수라 unit이 된다(`base`에 test 없음). 두 process가 한 root를 둘러쌌을 때 첫째가 안 상하는 것은 process가 필요.

#### 6. boot-children
- 설명: 부팅하면 상시 child가 모두 떠 있고, 시작에 실패한 child가 말없이 빠지지 않는다. runtime이 실제로 일한다.
- 지키는 것: `layers.md` "실행 때 import가 뜻하는 것"(권한 밖 top-level 일·없는 API로 "process가 시작부터 죽는다. type check가 못 잡는다"). boundary `supervision`, `run-loop`, `app-runtime`. 근거(코드로 읽음): `wiring/problems-tests.ts`는 test runner child 시작이 실패해도 `return ok(undefined)`로 부팅을 계속하고, `wiring/problems.ts`도 collector 시작이 실패하면 연결만 건너뛴다.
- 경계: core ↔ `platform/io`, `lophn-agent/runtime`, `apps/supervisor`, `problems/report-collector`(+ 환경이 되면 `problems/test-runner`).
- 단계: ① `bootCore` ② settle ③ `/proc`에서 kind별 child 집합(`LOPHN_WORKER_KIND` env) ④ `platform/health` ⑤ `openSession`+`say`.
- fake: ① text.
- 단정: process 목록이 기대 집합을 포함 / `platform/health`의 observations가 모두 available(이름은 코드로 확인 필요. 짐작) / fake가 요청 1개를 받음(runtime이 실제 model 호출까지 감).
- support: 작은 helper.
- 위험: 핵심 흐름.
- 겹침: `boot`(ready·정리만 봄). 확장 행.
- harness로: 아니오. 단 `test-runner`는 `systemd-run` 같은 환경이 있을 때만 뜨므로(`runnerSpec` 없으면 건너뜀) 기대 집합에서 빼거나 조건부로 둔다.

#### 7. compact-roundtrip
- 설명: 사람이 compact를 요청한다. 성공하면 앞 구간이 요약으로 바뀌고, 실패해도 원문과 session 나머지는 그대로이며 다음 turn이 이어진다.
- 지키는 것: `agent-definition.md`("compact는 사람이 부를 때만", "입력이 예산을 넘으면 call을 보내지 않고 turn이 `context_limit`으로 실패"), `protocol/lophn-agent/sessions.ts` 머리 주석("어느 쪽이든 원문과 session의 나머지는 바뀌지 않는다"). boundary `agent-sessions`, `run-loop`, `models`.
- 경계: test → core(`sessions/request-compact`, 요청 event) → runtime이 읽음(`sessions/compact-requests`) → model 요약 call → core(`sessions/compact` | `sessions/fail-compact`).
- 단계: ① `openSession` ② `say`+`waitTurnEnd`(turn 하나) ③ `sessions/read`로 compare ④ `sessions/request-compact` ⑤ 요청이 닫힐 때까지 기다림(`sessions/read`의 compaction·요청 상태) ⑥ `say`+`waitTurnEnd`.
- fake: ① text ② (행 a) text 요약 / (행 b) error(HTTP 400) ③ text.
- 단정: ledger: 행 a는 `sessions/read`의 compaction이 생김, 행 b는 실패 이유(`model_failed`)가 남고 `messages/list` 개수 불변 / fake: 셋째 요청 본문 구조 — 행 a는 앞 구간 메시지가 요약 하나로 대신됨, 행 b는 첫 turn의 메시지 그대로 / blob: 요약 call의 `model-calls/list`에 요약 call이 있음(행 a).
- support: 없음.
- 위험: 데이터 잃기(대화 이력).
- 겹침: 없음.
- harness로: "요약 실패해도 이력 보존"의 loop·compactor 쪽(`session/compactor.ts`)은 harness 후보에도 올라 있다(roadmap "더할 후보"). core의 요청 event를 child가 집어 가는 왕복은 process가 필요. 둘 다 두되 harness가 경우의 수(`nothing_to_summarize`, `too_large`, `session_changed`)를 맡는다.

#### 8. steer-mid-turn
- 설명: 도는 turn(Gate 대기 중)에 사람이 steer로 메시지를 보낸다. 다음 model 요청에 들어가되 checkpoint는 아니다.
- 지키는 것: `agent-call.md`("steer는 사람 메시지만 고른다. call, 답, reaction, 알림은 항상 다음 turn"), `place-session.md`("checkpoint는 turn을 시작하는 입력마다 생긴다. steer로 도는 turn에 들어간 메시지는 아니다"). boundary `router`, `agent-sessions`, `run-loop`.
- 경계: test → core(`messages/send` `delivery:"steer"`, 입력함은 메모리) → runtime이 다음 model 요청 전에 가져감.
- 단계: ① `openSession(PM)` ② `say`(#1) ③ `waitPermission` ④ `messages/send` #2 `delivery:"steer"` ⑤ `decide(allow)`+`waitTurnEnd` ⑥ `rewind/preview` checkpoint=#2.
- fake: ① tool `file_write` LOPHN.md ② text.
- 단정: fake: 둘째 요청의 마지막 user message에 `tool_result`(t1)와 #2 메시지가 같이 있음(구조만) / ledger: `turns/list`가 1개이고 #2가 그 turn에 속함 / ledger: `rewind/preview`(checkpoint #2)가 거절.
- support: 없음.
- 위험: 핵심 흐름.
- 겹침: `approval`의 Gate 대기를 재사용(다른 것을 봄).
- harness로: "steer를 다음 요청 앞에 넣는다"는 loop 규칙이라 harness(scripted model, inputs port)로 내릴 수 있다. checkpoint 아님 단정만 core를 쓴다. 우선순위가 낮다.

#### 9. ask-roundtrip
- 설명: agent가 `ask`로 사람에게 묻고 기다린다. 답하면 이어 가고, 사람이 대신 메시지를 보내면 그것이 결과가 되고, core가 꺼지면 cancelled다.
- 지키는 것: `agent-definition.md`("사람에게 묻는 중 사람이 그 session에 메시지를 보내면 기다림을 끝내고 그 메시지를 tool 결과로 넘긴다"), `place-session.md`(대기 질문은 cancelled). boundary `agent-tools`, `agent-sessions`.
- 경계: runtime(`ask/wait` agent route에서 대기) ↔ core 메모리 ↔ test(`ask/read`, `ask/answer`).
- 단계: ① `openSession` ② `say` ③ `session_snapshots/list`에서 questions 확인 ④ `ask/answer` 또는 `messages/send` ⑤ `waitTurnEnd`.
- fake: ① tool `ask` `{questions:[{question, header, options:[2개], multiSelect:false}]}` ② text.
- 단정: fake: 둘째 요청의 `tool_result` 안 JSON `outcome`이 `submitted`(행 a) / `human_message`(행 b) / ledger: snapshot의 questions가 비고 turn completed / `tool-calls/list`의 ask 호출이 success.
- support: 없음(`ask/read`에 넘길 `tool_call` id는 `tool-calls/list`로 읽는다).
- 위험: 핵심 흐름(낮음).
- 겹침: `restart`(대기 request는 사라짐)의 질문 쪽 짝.
- harness로: `QuestionResolved` 처리는 harness 가능. 왕복은 process.

#### 10. call-gate
- 설명: agent grant가 "묻기"로 걸린 상대를 부르면 call tool이 turn 안에서 먼저 사람에게 묻는다. 거절하면 call이 가지 않고 상대 session이 열리지 않는다. 허락하면 열린다.
- 지키는 것: `approval.md`("agent call은 call tool이 turn 안에서 먼저 묻고, Router는 tx 안에서 한 번 더 판정", "agent는 자기 grant를 넓히지 못한다"), `agent-call.md`("Gate는 두 곳이다", "실패는 ... call tool 결과로만"). boundary `approvals`, `router`, `agent-tools`.
- 경계: runtime(call tool, `tool_gate/check`) → core(turn 안 request) → test(`approvals/decide_turn`) → Router → (허락 행) 새 session.
- 단계: ① `openProject`, `agent_grants/set`(user; lophn에 `{kind:"agent", agent:{role:"project_manager", project}, setting:"ask"}`) ② `openSession(lophn)` ③ `say` ④ `waitPermission`(choices는 allow·reject) ⑤ `decide(reject)` → `waitTurnEnd` ⑥ 행 b: 같은 흐름을 `allow`로.
- fake: ① tool `call` `{to:{role:"project_manager", place:{project:<이름>}}, body:"hi", reply:"none"}` ② text ③ (행 b) text(PM의 새 turn. 둘 다 같은 text라 순서가 무관).
- 단정: ledger: 행 a는 `sessions/list`에 PM session이 없고 `call` tool 결과가 failure, 행 b는 PM session이 생김 / ledger: `calls/read`가 행 a에서 없음(행이 안 생김), 행 b에서 accepted / fake: 행 a journal 2, 행 b 3.
- support: 없음(행 a). 행 b는 session 둘이지만 대칭 대답이라 지금 것.
- 위험: 권한.
- 겹침: `approval`(Gate는 같고 intent 종류가 다름: `agent_call`).
- harness로: Gate 판정 table은 `gate_test.ts`가 이미 본다. 왕복·session이 안 열리는 것은 process.

#### 11. secret-in-tool-result
- 설명: agent가 shell로 `secrets.json`을 읽어도(shell은 place 범위가 아니다) key가 model 요청·ledger·blob에 평문으로 남지 않는다. shell에는 `LOPHN_*`·token env가 없다.
- 지키는 것: `agent-definition.md`("provider API key는 ... 값은 ledger, event, log, 오류, model 입력에 없다", "shell은 환경 변수 허용 목록만 넘긴다"), facts-main 11절(child는 model로 갈 요청·tool 결과·저장할 blob을 전송·저장 전에 core의 redaction 길로 지운다). boundary `secrets`, `agent-tools`, `run-loop`.
- 경계: runtime(`shell_run`의 자식 process) → child redaction 요청(`redact_request` 감독 pipe) → core 알려진 값 registry → model HTTP.
- 단계: ① `connectFakeProvider(key)` ② `openProject`, `openSession(PM)` ③ `say` ④ `waitTurnEnd` ⑤ `tool-calls/read`·blob 읽기 ⑥ `run.home` 전체 scan.
- fake: ① tool `shell_run` `{command:"cat <run.home>/secrets.json; env"}` ② text.
- 단정: fake: 둘째 요청 본문(JSON 문자열)에 key가 없고 첫 요청 header에는 있음(양성 대조) / ledger: `tool-calls/read`(결과 blob)에 key가 없고 `env` 출력에 `LOPHN_`·`TOKEN`·`KEY`로 시작하는 이름이 없음 / disk: `secrets.json` 밖 모든 file과 `core.log`에 key 없음(`e2e-secret`의 scan 함수).
- support: 없음.
- 위험: secret.
- 겹침: `e2e-secret`(같은 key, 다른 길. 그쪽은 header→ledger, 이쪽은 tool 결과→model). 같은 file의 행으로 가능.
- harness로: redaction 함수는 unit(`product-redactor_test.ts`). child→core 왕복은 process.
- 사람이 볼 것: shell이 `secrets.json`을 읽을 수 있는 것이 의도인지(approval.md는 shell을 범위로 판정하지 않기로 했다). 이 test는 "읽혀도 새지 않는다"만 본다.

#### 12. secret-deleted-no-send
- 설명: key를 지운 뒤에는 인증 없는 요청이 나가지 않고 turn이 사유 있는 실패로 끝난다.
- 지키는 것: `agent-definition.md`("값은 core가 전송 직전에 ... 읽어 agent runtime의 전송 callback 하나에 준다"), facts-main 11절(`known` registry 준비 전에는 값을 child로 주지 않는다). boundary `secrets`, `models`.
- 경계: runtime(`secret_send_request`) → core 파일 store.
- 단계: ① `connectFakeProvider(key)` ② `openSession(lophn)` ③ `say`+`waitTurnEnd`(성공) ④ `secrets/delete` ⑤ `say` ⑥ `waitTurnEnd`.
- fake: ① text ② text(오면 안 됨).
- 단정: fake: journal이 1개로 그대로(둘째 turn에서 요청이 안 나감) / ledger: 둘째 turn이 failed이고 이유가 credential 계열(코드로 확인 못 함: 이름 없는 secret의 attach 결과) / disk: `secrets.json`에 key 없음.
- support: 없음.
- 위험: secret.
- 겹침: `e2e-secret`의 행으로.
- harness로: attach 대조(`secret-refs_test.ts`)는 있다. 삭제 뒤 child가 요청을 안 보내는 것까지는 process.

#### 13. data-root-file-tool-escape
- 설명: PM이 file tool로 data root 안(`secrets.json`, `settings.json`, `derived/lophn-agent/`)을 읽고 쓰려 한다. 셋 다 `forbidden`이고 file은 그대로다.
- 지키는 것: `agent-definition.md`("agent 정의와 skill은 lophn data에 있어 file tool이 닿지 않는다", "file tool은 place 폴더 안에 가둔다"), `place-session.md`("`extensions.json` 설정 file은 scope가 막는다"). boundary `agent-tools`.
- 경계: runtime Deno 권한은 data root 읽기를 열고(`allow_read` = dataRoot), `derived/lophn-agent/` 쓰기를 열어 둔다. 그래서 막는 것은 scope 하나뿐이다(코드로 읽음: `runtime-permissions.ts`).
- 단계: ① `openSession(PM)` ② `say` ③ `waitTurnEnd` ④ disk·ledger 확인.
- fake: ① tool 3개 한 번에: `file_read <home>/secrets.json`, `file_write <home>/settings.json`, `file_write <home>/derived/lophn-agent/x` ② text.
- 단정: ledger: 세 call 모두 failure `forbidden` / disk: `settings.json` 바이트 불변, `derived/lophn-agent/x` 없음 / fake: 둘째 요청에 key가 없음(connectFakeProvider key 사용 시).
- support: 없음.
- 위험: 권한·secret.
- 겹침: `e2e-file-write`(같은 scope 거절, 대상 경로만 다름). file-write의 `outside` 행에 이 세 경로를 더하는 것이 맞다("회귀는 table 한 행").
- harness로: scope 함수는 `scope_test.ts`가 본다. runtime 권한이 이 경로를 열어 둔 상태에서 scope가 유일한 방어라는 점이 process 쪽에만 보인다.

#### 14. token-not-on-disk
- 설명: user token(hello frame)이 `run.home`·`core.log`·`run/location.json` 어디에도 남지 않는다.
- 지키는 것: facts-main 6절/`coding-agent.md`("token 원문은 저장하지 않는다"의 user token 쪽), boundary `server`, `supervision`.
- 경계: core의 hello frame과 disk.
- 단계: ① `bootCore`(hello의 `user_token`을 쥠) ② `openSession`+`say`+`waitTurnEnd` ③ `run.home` 전체 scan.
- fake: ① text.
- 단정: disk: 모든 file과 `core.log`에 user token 없음 / disk: `run/location.json`의 key가 `format, api_port, core_epoch, started_at`뿐 / route: 어떤 read 결과(`identity/current`)도 token 값을 담지 않음.
- support: 없음.
- 위험: secret·권한.
- 겹침: `e2e-secret`의 scan에 needle 하나를 더하는 행.
- harness로: 아니오(hello 한 번만 나오는 규칙이라 process).

#### 15. idempotent-retry-after-restart
- 설명: shell main이 죽었다 살아나며 같은 `messages/send`(같은 idempotency key)를 다시 보내도 메시지·turn이 하나다.
- 지키는 것: `event.md`("반응은 최소 한 번, 효과는 한 번. idempotency key"), `commands/result` 조회 route. boundary `server`, `storage`.
- 경계: test ↔ core를 건너 재시작.
- 단계: ① `say`(key K) → `waitTurnEnd` ② `kill`+`bootCore` ③ 같은 key K·같은 입력으로 `messages/send` ④ `messages/list`, `turns/list`.
- fake: ① text.
- 단정: ledger: `messages/list`·`turns/list`가 1개씩 / fake: journal 1 / route: 둘째 응답이 첫째와 같은 결과.
- support: 작은 helper(`say`에 idempotency key 인자).
- 위험: 데이터(중복)·비용.
- 겹침: `restart`.
- harness로: 가능. command replay는 `storage`의 in-process test로 본다(process가 필요한 이유가 없다). 우선순위 낮음.

#### 16. gateway-late-join
- 설명: Gate에서 멈춘 turn이 있을 때 Gateway에 늦게 붙거나 끊겼다 다시 붙은 화면이 snapshot으로 대기 request를 본다. replay는 없다.
- 지키는 것: `event.md`("화면은 조건을 걸고 ready를 받은 뒤에 snapshot을 읽는다", "agent event는 저장하지 않고 replay하지 않는다", "snapshot에 대기 중인 요청까지 담는다"). boundary `event-stream`, `events`.
- 경계: test(Gateway WS client, subprotocol `lophn.gateway.1`) ↔ core.
- 단계: ① `waitPermission`까지 ② Gateway 연결·`watch`(session 조건) → `ready` ③ `session_snapshots/list` ④ 연결 끊기 → 다시 연결·`watch` ⑤ `PermissionResolved` event를 받음(`decide` 뒤).
- fake: ① tool `file_write` LOPHN.md ② text.
- 단정: event: 두 연결 모두 `ready` 뒤 snapshot에 request 1개, 둘째 연결은 옛 `PermissionRequested`를 다시 받지 않음 / event: `decide` 뒤 `PermissionResolved`와 `TurnEnded`가 옴 / ledger: turn completed.
- support: 그 밖(Gateway client helper 하나. `e2e-support-core`가 Gateway를 선택으로 열어 둠).
- 위험: 핵심 흐름.
- 겹침: `approval`(같은 대기를 다른 쪽에서 봄).
- harness로: 조건 매칭("session을 건 조건은 session 없는 event와 맞지 않는다")은 `events`의 unit. 연결·ready·snapshot 순서는 socket이 필요.

### 2.2 session 여럿이 드는 것

#### 17. restart-lost-call
- 설명: 받은 session이 바빠서 입력함에 쌓인 call은 core 재시작 때 조용히 사라지지 않고 `lophn_restarted`로 닫히며, 보낸 session이 알림을 받는다.
- 지키는 것: `agent-call.md`("입력함은 메모리라 꺼지면 사라진다. ... lophn을 켤 때 accepted인데 가져가지 않은 call을 failed(lophn_restarted)로 닫는다"), `place-session.md`. boundary `router`, `run-loop`, `agent-sessions`.
- 경계: core(`RecoverCalls`: `failLostOnStart`+`interruptRunningTurns`, 한 tx) ↔ runtime(`turns/start`가 call을 `consumed`로 표시).
- 단계: ① B = PM session `say`(Gate 대기로 바쁨) ② A = lophn session `say`: call tool로 B 세션에 보냄 ③ A `waitTurnEnd` ④ `kill` → `bootCore` ⑤ `calls/read`, B·A의 `turns/list` ⑥ A의 알림 turn `waitTurnEnd`.
- fake: ① B: tool `file_write` LOPHN.md(Gate 대기) ② A: tool `call` `{to:{session:B}, body, reply:"result"}` ③ A: text ④ A 알림 turn: text. **대답 4**(규칙 3 초과: B를 바쁘게 하는 것과 재시작 뒤 A의 알림 turn). 줄이려면 ④의 도착을 단정하지 않고 fake의 fallback을 쓰는데, test가 fallback을 쓰지 않는 규칙과 맞지 않아 4로 둔다.
- 단정: ledger: `calls/read`가 failed·`lophn_restarted` / ledger: A의 `messages/list`에 알림 입력이 정확히 1개(tool 결과와 입력 둘로 받지 않음) / fake: journal 4.
- support: session 여럿(대답 순서는 B 요청 → A 요청 → A 요청이라 FIFO로 된다. B를 먼저 `arrived`로 고정).
- 위험: 핵심 흐름(조용히 사라지는 call 없음).
- 겹침: `restart`(turn·permission만 보고 call은 안 봄).
- harness로: `failLostOnStart` 규칙은 Router+DB 단위로 가능. "child의 `turns/start`가 consumed를 표시했나"는 process.

#### 18. call-receiver-ended
- 설명: 받은 session이 답 없이 archive 되면 보낸 session이 이유를 새 입력으로 한 번 받는다(tool 결과와 입력으로 두 번 받지 않는다).
- 지키는 것: `agent-call.md`("배달 뒤에 늦게 아는 실패(receiver_ended ...)는 ... 보낸 session에 새 입력으로 돌아간다", "같은 실패를 tool 결과와 입력 둘로 받으면 agent가 두 번 반응한다"), `place-session.md`("끝나는 session이 받은 call은 receiver_ended로 닫혀 보낸 쪽이 안다").
- 경계: test(`sessions/archive`) → core(한 tx) → Router → 보낸 session의 runtime turn.
- 단계: ① A=lophn, B=PM session 열기 ② A `say` ③ A: call(B, `reply:"result"`) → B가 new turn으로 text(reply 안 함) ④ `sessions/archive`(B) ⑤ A 알림 turn `waitTurnEnd`.
- fake: ① tool `call` ② text ×3(A의 둘째 요청, B 첫 요청, A 알림 요청이 모두 같은 `text ok`라 순서와 무관). 종류는 둘, 대답 수는 4.
- 단정: ledger: `calls/read`가 failed·`receiver_ended` / ledger: A의 알림 입력 1개 / fake: journal 4.
- support: session 여럿(대칭 대답 trick).
- 위험: 핵심 흐름.
- 겹침: 없음.
- harness로: Router 단위로 가능한 부분이 크다. E2E는 "알림 turn이 실제로 model 요청까지 간다"만.

#### 19. agent-call-roundtrip (roadmap E2E 7)
- 설명: A가 B를 부르고 B의 reply가 A의 새 입력으로 돌아온다.
- 지키는 것: `agent-call.md` 전체(`reply:"result"`는 받은 agent의 reply tool이 있어야 done, 원문 대화가 아니라 body와 refs만, 보낸 쪽을 막지 않음). boundary `router`, `agent-tools`, `agent-sessions`.
- 경계: runtime ↔ core Router ↔ 새 session의 같은 runtime(session 둘이 한 child).
- 단계: ① A=lophn `say` ② A: call(`{role:"project_manager", place:{project}}`, `reply:"result"`) ③ B: reply tool ④ A 새 입력 turn ⑤ `calls/read` done ⑥ `sessions/list`.
- fake: A①tool `call` A②text, B①tool `reply`, B②text, A③text. 순서가 갈린다(A②와 B①이 경쟁).
- 단정: ledger: `calls/read` done / fake: A③ 요청에 B의 body가 들어 있고 A의 system prompt 같은 원문 대화는 B의 첫 요청에 없음 / ledger: `sessions/list`에 B session 하나.
- support: session별 queue(roadmap이 다음 계획으로 미룬 것). 요청 본문 일치(`expect`)로 갈래를 고르는 방식이 있다면 그것도 된다. 정해야 함.
- 위험: 핵심 흐름.
- 겹침: 없음.
- harness로: 아니오.

### 2.3 앱이 드는 것

앱 후보는 공통으로 test용 앱(api 둘: write 하나, read 하나. 필요에 따라 느린 write, 선언을 어기는 api)과 "앱 활성 상태로 만드는" support 한 함수를 가정한다. 앱 만들기는 `apps/create`+`apps/connect_source`(user 가능)다. release 준비(`releases/prepare_bundle`)는 coding_agent·machine만, activation은 `tickets/verify`(agent만) → `TicketVerified` → Reactor다. 그래서 활성 앱은 coding 역할(Gateway `coding_terminal` frame의 `plan.env.LOPHN_CODING_TOKEN` → `ticket claim`/`release prepare`/`ticket report`)과 App Engineer의 tool call(`ticket_create`, `call` to coding_agent, `ticket_verify`)이 필요하다. 이 함수는 "띄우기와 연결"이지 flow의 단계가 아니므로 support에 둔다(roadmap의 "support에는 띄우기와 연결만").

#### 20. app-call-roundtrip (roadmap E2E 8)
- 설명: 활성 앱의 app-api를 agent tool로 부르면 core를 지나 app process가 실행하고 invocation이 기록된다.
- 지키는 것: `app-call.md`("모든 app-api 호출은 core를 지난다", "부른 쪽은 core가 확인", "write 동안의 changeset을 invocation에 붙임"), `activation.md`. boundary `app-runtime`, `app-releases`, `agent-tools`, `approvals`.
- 경계: runtime → core → sup → app → 되돌아옴.
- 단계(활성 앱 준비는 support): ① `openSession(app-api가 grant된 role)` ② `say` ③ tool call(app-api, write) ④ `invocations/list` ⑤ 앱 read api를 `apps/call_api`(user)로 ⑥ `waitTurnEnd`.
- fake: ① tool(app-api write 하나) ② text.
- 단정: ledger: `invocations/list`에 write 호출 1개(caller agent, 해당 tool call id)와 changeset / app 상태: read api 결과가 write 반영 / fake: 둘째 요청에 tool_result.
- support: 앱 + coding 역할.
- 위험: 핵심 흐름·sandbox.
- 겹침: 없음. 관련 이슈: `issues/activation.md` "write app-api의 rewind 검사가 fail".
- harness로: 호출 경로 판정(`calls_test.ts`)은 있다. process 왕복은 아니오.

#### 21. app-rewind-atomic (roadmap E2E 9 확장)
- 설명: 합이 control frame(256KiB)을 넘는 여러 write를 한 번에 되돌린다. 충돌하면 통째로 취소되고 DB는 안 바뀐다.
- 지키는 것: `app-call.md`("changeset은 최신부터 뒤집어 한 transaction, 충돌하면 통째로 취소", "뒤집은 changeset 전부가 요청 하나로 간다 ... bytes frame과 end"). 두 번 고친 bug: `issues/archived/app-call.md`의 큰 changeset·apply 요청·result가 frame을 못 지난 세 건(guard는 `fit_test.ts`, `supervisor-link_test.ts` unit뿐). boundary `app-data`, `child-supervision-protocol`, `app-runtime`.
- 경계: core ↔ sup ↔ app의 실제 pipe와 frame 한도.
- 단계: ① 활성 앱 ② `apps/call_api` write를 큰 값으로 여러 번(각 응답은 한도 안, 합은 초과) ③ `apps/rewind_plan` ④ `apps/rewind` ⑤ read api로 확인 ⑥ (행 b) 앱 밖에서 DB를 바꾼 뒤 같은 순서 → 충돌.
- fake: 없음(user가 직접 호출).
- 단정: app 상태: 행 a는 write 이전 상태, 행 b는 불변 / ledger: `apps/rewinds` status가 applied / cancelled(이유) / ledger: `invocations/list`의 reverted 표시.
- support: 앱.
- 위험: 데이터 잃기·두 번 고친 bug.
- 겹침: 없음(`e2e-rewind`는 session file rewind).
- harness로: 한도 계산은 unit이 있다. 실제 pipe는 process.

#### 22. app-restart-unknown
- 설명: 앱 write가 도는 중 core가 죽었다 켜지면 invocation은 unknown(`core_restarted`)이 되고, changeset 없는 unknown write가 있으면 rewind가 막힌다. 앱 rewind의 applying은 cancelled다.
- 지키는 것: `app-call.md`("보냈는데 응답을 못 받은 호출은 ... 결과 모름. core가 다시 켜질 때 running으로 남은 invocation도 unknown", "결과 모름으로 닫혀 changeset이 없는 write가 범위에 있으면 rewind를 막는다"). boundary `app-runtime`, `app-data`.
- 경계: core 재시작 ↔ sup·app이 다시 뜸.
- 단계: ① 활성 앱(느린 write api: test가 파일로 푸는 gate) ② `apps/call_api` write 시작(응답 안 기다림) ③ `kill` ④ `bootCore` ⑤ `invocations/get` ⑥ `apps/rewind_plan`.
- fake: 없음.
- 단정: ledger: invocation이 unknown·`core_restarted` / ledger: `rewind_plan`이 막힘 이유를 냄 / process: app process가 하나(두 process가 한 DB를 열지 않음).
- support: 앱.
- 위험: 데이터 잃기.
- 겹침: `restart`(앱 쪽).
- harness로: `closeUnfinishedInvocations`는 unit 가능. process 둘이 한 DB를 열지 않는 것은 process.

#### 23. app-process-denied
- 설명: 앱 handler가 선언·grant 밖 권한(폴더 밖 쓰기, 네트워크)을 쓰려 하면 Deno 권한이 막고 호출은 failed다.
- 지키는 것: `activation.md`("앱 process의 실제 권한은 선언과 active 앱 grant의 교집합으로 만든 flag다. 앱 code가 선언을 어겨도 flag 밖은 열리지 않는다"). AGENTS.md: 막는 것은 AI가 만든 코드의 실수. boundary `app-runtime`, `app-spi`.
- 경계: app process의 Deno flag(core → sup → app 실행).
- 단계: ① 활성 앱(선언을 어기는 api: `<run.work>/outside`에 쓰기, fake server에 fetch) ② `apps/call_api` ③ `invocations/get` ④ disk·fake 확인.
- fake: 없음(앱이 fake server에 fetch를 시도).
- 단정: ledger: invocation failed(권한 오류) / disk: `outside/`에 file 없음 / fake: journal 0(앱의 fetch가 안 닿음).
- support: 앱.
- 위험: sandbox.
- 겹침: 없음. `core/apps/permissions/sandbox-boundary_test.ts`(subprocess 하나)와 부분 겹침: 그쪽은 flag를 만드는 쪽, 이쪽은 실제 activation 경로의 flag.
- harness로: flag 계산은 unit이 있다. 실제로 막히는지는 process.

#### 24. activation-failure-restores-data
- 설명: 둘째 release의 migration이 실패하면 복구본으로 데이터가 돌아가고 이전 release가 다시 뜬다. 실패 기록과 `ReleaseActivationFailed`가 같이 남고 App Engineer가 reaction을 받는다.
- 지키는 것: `activation.md`("복구본이 ledger에 확정된 뒤에만 migration", "복구본 복원이나 확인이 실패하면 이전 code도 띄우지 않고 사용 불가", "실패 기록과 `ReleaseActivationFailed`는 같은 tx"). 두 번 이상 고친 흔적: `issues/archived/activation.md`(끊긴 시도, 복구본 보존). boundary `app-releases`, `app-data`.
- 경계: core ↔ worker(`apps/data`, `apps/release`) ↔ sup ↔ app(이전 process 종료 확인 → 새 process).
- 단계: ① 활성 앱 v1에 데이터 쓰기 ② v2(실패하는 migration) 준비·verify ③ activation 결과 기다림 ④ read api로 데이터 ⑤ `releases/list_records`·`activations` 기록 ⑥ App Engineer의 reaction 입력.
- fake: App Engineer ① tool(`ticket_verify`) ② text(reaction 입력 뒤).
- 단정: app 상태: v1 데이터 그대로·v1 code가 서빙 / ledger: 실패 기록과 `ReleaseActivationFailed` / fake: reaction 입력이 App Engineer의 요청에 옴.
- support: 앱 + coding 역할 + release 둘. 가장 무겁다.
- 위험: 데이터 잃기.
- 겹침: 없음.
- harness로: 순서·복원은 unit이 일부 있을 수 있음. process 종료 확인과 실제 DB는 process.

#### 25. activation-ask-survives-restart
- 설명: 선언이 늘어난 release의 activation은 사람에게 묻는 보류 request를 만들고, core가 꺼졌다 켜져도 request가 표에 남으며, 그 뒤 허락하면 적용된다.
- 지키는 것: `approval.md`("보류 request는 표에 남는다", "결과가 기록되지 않은 허락은 시작할 때 다시 적용", "허락의 접수와 적용 성공은 따로"), `activation.md`("사람이 허락한 비교와 시작할 때의 비교가 다르면 다시 판정"). boundary `approvals`, `app-releases`.
- 경계: Reactor·ledger ↔ 재시작.
- 단계: ① 활성 앱 v1 ② v2(외부 자원 선언 추가) verify ③ `approvals/pending`에 request ④ `kill`+`bootCore` ⑤ `approvals/pending` 다시 ⑥ `approvals/decide`(allow) → 적용 기다림.
- fake: App Engineer ① tool `ticket_verify` ② text.
- 단정: ledger: 재시작 뒤 같은 request id가 pending / ledger: 허락 뒤 `applied`와 활성 release가 v2 / app: v2 api가 호출됨.
- support: 앱 + coding 역할.
- 위험: 권한·데이터.
- 겹침: `restart`(turn 쪽만 봄).
- harness로: `applier` 두 번 불려도 한 번(unit 가능). 재시작 사이 낀 허락은 process.

#### 26. session-allowance-lost-on-restart
- 설명: external app-api에서 "이 session 동안"을 고르면 같은 session의 다음 호출은 묻지 않고, core 재시작 뒤에는 다시 묻는다.
- 지키는 것: `approval.md`("이 session 동안 허락은 메모리에만 두고 session이 닫히거나 lophn이 꺼지면 사라진다"). 이 선택지는 `app_api`·`mcp_tool` intent에만 있다(`protocol/approvals/requests.ts` `choicesFor`). `LOPHN.md` 쓰기는 allow·reject뿐이라 지금 support로는 못 한다. boundary `approvals`.
- 경계: runtime ↔ core 메모리(allowances) ↔ 재시작.
- 단계: ① 활성 앱(external api) ② `say` → `waitPermission` → `decide(session)` ③ 같은 session `say`(다시 호출, 묻지 않음) ④ `kill`+`bootCore` ⑤ `say`(다시) → `waitPermission`.
- fake: ① tool(app-api) ② text ③ tool(app-api) ④ text ⑤ tool(app-api). **대답 5**(규칙 3 초과). 줄이려면 ③ 행을 빼고 "허락 → 재시작 → 다시 묻는다"만 둔다(대답 3).
- 단정: ledger: 재시작 전 둘째 호출은 `PermissionRequested`가 없음 / 재시작 뒤 둘째 request가 생김 / fake: tool 호출 수.
- support: 앱. (MCP http fake가 있으면 그것으로도 된다: 그 밖.)
- 위험: 권한.
- 겹침: `restart`(Gate 대기 쪽).
- harness로: allowance 저장은 unit.

#### 27. annotation-to-app-engineer
- 설명: 사람이 보낸 annotation 묶음이 그 앱 App Engineer에게 사람 메시지로 가고, App Engineer가 `image_read` `annotation:<id>`로 screenshot을 모델에 싣는다. 다른 앱의 annotation은 읽지 못한다.
- 지키는 것: `annotation.md`("annotation을 받는 것은 그 앱의 App Engineer뿐", "`annotations.get`은 App Engineer role에만 주고 core가 agent 자격의 앱으로 거른다(다른 앱 것은 not_found)", "보내기는 사람의 동작이라 Gate를 거치지 않고 사람이 아니면 저장을 거절"). boundary `core-api`, `router`, `agent-tools`.
- 경계: test(shell main 역할: `annotations/upload_screenshot`, `annotations/send`) → core → Router → runtime(`image_read`) → core `annotations/get` → blob → model 요청의 image block.
- 단계: ① `apps/create` 둘(A, B) + `connect_source` ② `annotations/upload_screenshot`, `annotations/send`(app A, session null) ③ A의 App Engineer turn `waitTurnEnd` ④ 같은 방식 B의 turn에서 A의 annotation id를 읽으려 함.
- fake: ① A: tool `image_read` `{path:"annotation:<id>"}` ② A: text ③ B: tool `image_read`(A의 id) ④ B: text. **대답 4**(앱이 둘이라). 다른 앱 부분을 떼어 낸 만큼 대답 2.
- 단정: fake: A 둘째 요청에 image block 있음 / ledger: B의 `image_read`가 failure `not_found` / ledger: `annotations/get`(user)이 A 묶음을 돌려줌.
- support: 앱(만들기만, release·activation 없음) + 작은 helper(upload route).
- 위험: 권한.
- 겹침: 없음.
- harness로: 아니오.
- 참고: schema 주석으로 읽음: annotation 표는 apps·releases에 FK를 두지 않으므로 release id는 형식만 맞으면 된다(짐작).

#### 28. coding-session-ends-without-report
- 설명: coding agent가 보고 없이 끝나면(터미널 process exit) token이 회수되고, 맡긴 call이 failed로 닫히며, App Engineer가 한 번만 reaction을 받는다. 다른 앱 것은 token으로 못 본다.
- 지키는 것: `coding-agent.md`("token은 session이 끝나면 회수하고 회수한 token의 새 호출은 거절한다", "끝나는 길마다 call은 한 번만 닫힌다", "session의 끝은 터미널 process의 exit으로만 안다", "token 원문은 저장하지 않는다"). boundary `app-tickets`, `coding-agent-cli`, `external-coding-agent`, `event-stream`.
- 경계: test(shell main: Gateway client, `coding_agent_terminals/result`·`exited`) ↔ core ↔ test(coding agent: token으로 CLI 부르기) ↔ Reactor.
- 단계: ① `apps/create`×2 ② Gateway 연결 ③ App Engineer `say` → `ticket_create`+`call`(coding_agent) → `coding_terminal` open frame에서 token ④ token으로 `ticket claim`, 다른 앱의 `ticket show` 시도 ⑤ `coding_agent_terminals/exited` ⑥ 같은 token으로 다시 호출, `calls/read`.
- fake: ① tool `ticket_create` + `call` ② text ③ text(reaction 입력 뒤). 
- 단정: ledger: `calls/read` failed / route: token 재호출이 `unauthorized` 또는 `forbidden`, 다른 앱 ticket이 `not_found`·`forbidden` / disk: `run.home` 전체에 token 원문 없음.
- support: 앱(만들기만) + coding 역할. Gateway 연결이 없을 때 `open`이 어떻게 되는지는 코드로 확인 못 함.
- 위험: 권한·secret.
- 겹침: 없음.
- harness로: 아니오.

### 2.4 조사가 더 필요한 것(문서가 없거나 코드 확인이 모자람)

- **context-violation-reaction**: project의 context 규칙 위반 → worker(`documents/contexts`) 검사 → `ContextViolationFound` → Reactor → reaction grant(`open`/`ask`/`off`)에 따라 PM 새 session. `architecture/`에 contexts 문서가 없어 불변 조건을 못 뽑았다. 코드로는 `events/reactor/session-opening.ts`가 5개 새 일 event를 같은 handler로 다룬다. support는 아마 "없음"(PM의 `context_draft`/`context_submit` tool로 규칙을 만든 뒤 file을 바꿈). worker 6종 중 `documents/contexts`를 건드리는 유일한 후보다.
- **runtime-restart-limit**: `supervision/responsiveness/slot.ts`의 `RESTART_DELAYS_MS=[1000,2000,4000]`, `failures`는 늘기만 하고 되돌리는 곳을 못 찾았다(코드로 읽음). 오래 건강하게 돈 뒤에도 4번째 crash는 영구 unavailable일 수 있다. 기대(reset 여부)는 사람이 정할 일이라 test 전에 정한다.
- **slow-gateway-subscriber**: `event.md`("느린 구독자를 버퍼 한도에서 끊고 ... 구독자 하나 때문에 publish가 막히면 command 경로가 막힌다"). 읽지 않는 raw WS client가 필요하고 한도를 넘길 event 양이 크다(큰 text 응답). support가 크고 우선순위 낮음.

## 3. harness로 내릴 것(process 없이 보임)

| 후보 | 이유 |
|---|---|
| tool-list-per-role | role별 tool 이름 목록 = `builtinToolNames(role)` = child가 model에 싣는 `tools[]`. `agentTools()`+`selectTools()`를 core 없이 만들 수 있다(roadmap). `main/agent-tools_test.ts`가 이미 목록·정의 일치를 본다. 환각 tool 이름은 loop의 "알 수 없는 tool" 행 |
| instructions-unreadable-no-turn | `LOPHN.md`를 못 읽거나 상한을 넘으면 turn을 시작하지 않는다(`agent-definition.md` "사람이 쓴 지침은 조용히 빼지 않는다"). `createTurnPreparer`의 `context` port 오류 → harness loop 한 행(fake가 받은 요청 0개) |
| http-gate-edge | Host·Origin·Bearer 검사(`core/server/request.ts` `gateRequest`)는 순수 함수+registry다. token 없음 `unauthorized`, Origin 있음 `forbidden`, Host 불일치 `invalid_input`. in-process unit이다 |
| web-fetch-local-block | `web/target.ts`(local·private 주소 거절)와 redirect hop 검사(`fetch.ts`)는 `fetch` 주입이 되는 tool 단위. 주의: 검사가 이름 문자열 기준이라 attacker 도메인이 127.0.0.1로 풀리는 경우는 막지 못한다(짐작. 코드로 읽음) |
| prompt-prefix-stable | 같은 재료 → 같은 bytes, 도는 turn 중 바뀐 지침은 다음 turn notice로(`agent-definition.md`). `assemble`은 순수 함수 → harness loop의 "보낸 요청의 공통 불변식" |
| idempotent-retry-after-restart | 위 15. command replay는 storage in-process test |
| reaction handler(`new-work:*`) | judge→run/ask/deny와 중복 key는 `session-opening.ts`가 port를 받는 함수라 unit |

## 4. 표

| # | id | 위험 종류 | support | 겹침 |
|---|---|---|---|---|
| 1 | stop-while-asking | 권한 | 없음 | approval·stop 부분 |
| 2 | runtime-ends-mid-turn | 핵심 흐름·권한 | 작은 helper | file-write·restart 부분(child 단독 종료는 안 봄) |
| 3 | end-session-mid-turn | 데이터 잃기·비용 | 없음 | stop·restart 부분 |
| 4 | shutdown-orphans | 데이터 잃기·비용 | 없음 | boot·restart(boot 행으로 가능) |
| 5 | second-core-same-root | 데이터 잃기 | 작은 helper | 없음 |
| 6 | boot-children | 핵심 흐름 | 작은 helper | boot(확장 행) |
| 7 | compact-roundtrip | 데이터 잃기 | 없음 | 없음 |
| 8 | steer-mid-turn | 핵심 흐름 | 없음 | approval(대기 재사용) |
| 9 | ask-roundtrip | 핵심 흐름 | 없음 | restart(질문 쪽 짝) |
| 10 | call-gate | 권한 | 없음(행 b는 session 여럿, 대칭 대답) | approval(intent 종류만 다름) |
| 11 | secret-in-tool-result | secret | 없음 | secret(다른 길, 같은 file 행) |
| 12 | secret-deleted-no-send | secret | 없음 | secret(행) |
| 13 | data-root-file-tool-escape | 권한·secret | 없음 | file-write(행) |
| 14 | token-not-on-disk | secret·권한 | 없음 | secret(scan needle 행) |
| 15 | idempotent-retry-after-restart | 데이터(중복)·비용 | 작은 helper | restart. harness로 |
| 16 | gateway-late-join | 핵심 흐름 | 그 밖(Gateway client) | approval(관찰 쪽만 다름) |
| 17 | restart-lost-call | 핵심 흐름 | session 여럿 | restart(call은 안 봄) |
| 18 | call-receiver-ended | 핵심 흐름 | session 여럿(대칭 대답) | 없음 |
| 19 | agent-call-roundtrip | 핵심 흐름 | session별 queue | 없음(roadmap 7) |
| 20 | app-call-roundtrip | 핵심 흐름·sandbox | 앱+coding 역할 | 없음(roadmap 8) |
| 21 | app-rewind-atomic | 데이터 잃기·두 번 고친 bug | 앱 | 없음(roadmap 9 확장) |
| 22 | app-restart-unknown | 데이터 잃기 | 앱 | restart(앱 쪽) |
| 23 | app-process-denied | sandbox | 앱 | 없음 |
| 24 | activation-failure-restores-data | 데이터 잃기 | 앱+coding 역할(release 둘) | 없음 |
| 25 | activation-ask-survives-restart | 권한·데이터 | 앱+coding 역할 | restart |
| 26 | session-allowance-lost-on-restart | 권한 | 앱 | restart |
| 27 | annotation-to-app-engineer | 권한 | 앱(만들기만) | 없음 |
| 28 | coding-session-ends-without-report | 권한·secret | 앱(만들기만)+coding 역할 | 없음 |

## 5. 지금 support만으로 되는 것 상위 10

기준: AGENTS.md 위험 목록에 닿는 정도, process 경계를 건너야만 깨지는가, 코드로 읽어 이미 의심이 있는가, 지금 7개가 안 보는 곳인가, 비용(support 추가·대답 수).

1. **runtime-ends-mid-turn**(2): child 단독 종료를 7개 모두 안 본다. 닫는 곳을 못 찾은 의심이 있고, 맞다면 session이 사람이 멈출 때까지 막히는 핵심 결함이다. 과거에 한 번 고친 Deno 권한 목록이 갱신된다는 것도 같이 본다.
2. **end-session-mid-turn**(3): delete 뒤 child의 요청이 안 끊길 수 있다는 코드 의심(`stop()`이 read 실패를 not-stopped로 봄). 비용과 데이터에 닿고 대답 둘로 끝난다.
3. **secret-in-tool-result**(11): shell이 `secrets.json`을 읽을 수 있는 구조에서 redaction 한 겹이 유일한 방어다. `e2e-secret`과 다른 길(tool 결과 → model)이라 따로 가치가 있다.
4. **stop-while-asking**(1): 권한 경계(허락 뒤 입력, 늦은 허락)와 멈춤의 교차. `approval`·`stop` 두 개가 각각 못 보는 사이다. 대답 하나.
5. **call-gate**(10): 사람 결정이 필요한 또 하나의 intent(agent call)이고 "agent는 자기 grant를 넓히지 못한다"의 왕복을 본다. 행 a는 지금 것만.
6. **shutdown-orphans**(4): kill·정상 종료에서 요청이 진행 중일 때의 child 정리. `boot` 행 추가로 싸게 된다(데이터·비용).
7. **second-core-same-root**(5): 데이터 잃기에 직접 닿는 유일한 후보. 한 번 띄우고 한 번 실패를 기대하는 작은 test.
8. **compact-roundtrip**(7): 대화 이력 보존은 사용자 데이터다. 실패 행이 핵심. 경우의 수는 harness에 둔다.
9. **boot-children**(6): "process가 시작부터 죽는다"를 type check가 못 잡는다는 `layers.md`의 이유 그대로이고, 시작 실패를 삼키는 코드가 있다(`return ok(undefined)`). `boot`에 작은 helper와 행 하나.
10. **data-root-file-tool-escape**(13): runtime 권한이 data root 읽기를 열어 두고 scope가 유일한 방어인 구조. `e2e-file-write`에 행 하나로 싸게 든다. 후순위로 **token-not-on-disk**(14), **secret-deleted-no-send**(12), **steer-mid-turn**(8)이 있다.

## 6. 상한 12와 포장 제안

roadmap은 core E2E 상한을 12로 둔다(지금 7). 위 상위 10을 file 하나씩 만들면 17이 된다. 추천 포장은 새 file 3개 + 기존 file 행이다.

- 새 file `turn-fate_test.ts`: 2(runtime-ends-mid-turn: 행 a·b), 3(end-session-mid-turn: 행 a·b), 1(stop-while-asking). 한 공통 계약("child가 쥔 turn의 끝은 core가 닫고 요청을 끊는다").
- 새 file `compact_test.ts`: 7.
- 새 file `call-gate_test.ts`: 10.
- `boot_test.ts` 행: 6(boot-children), 4(shutdown-orphans), 5(second-core-same-root).
- `secret_test.ts` 행: 11, 12, 14. `file-write_test.ts` 행: 13.

그러면 7 + 3 = 10, 상한 안이다. 8, 9, 16, 17, 18은 두 번째 묶음(대칭 대답·session 여럿)에서 `calls` 계열 file 하나로 묶을 수 있다. 앱 후보(20~28)는 "앱 활성 support"가 서야 시작할 수 있고, 그 계획이 7~9를 연다.

## 7. 사람이 정할 것(추천안)

1. **child 하나가 끝났을 때 돌던 turn의 운명**(후보 2). 추천: core가 감독이 child 끝을 알 때 그 child의 running turn을 interrupted로 닫는다(이유는 새 값이 필요하면 "계약 바꾸기 요청"). 정하기 전에는 test가 현재 동작(running 잔류)을 고정하게 되므로, 먼저 정한 뒤 쓴다.
2. **session delete 뒤 child의 요청**(후보 3). 추천: delete 전에 core가 turn을 끝내는 신호가 child에 닿아야 한다(`stop()`이 read 실패를 not-stopped로 보지 말고 `not_found`는 stopped로). `protocol/lophn-agent/sessions.ts:255` 주석도 같이 고친다.
3. **runtime 재기동 한도**(2.4). 추천: 한도 안에서 오래 건강하게 돈 뒤 `failures`를 되돌린다. 안 정하면 test를 쓰지 않는다.
4. **shell의 `secrets.json` 읽기**(후보 11). 추천: 지금 구조를 두고 redaction이 막는 것을 test로 고정한다(sandbox를 따로 두지 않기로 한 `approval.md`의 결정과 맞다).
