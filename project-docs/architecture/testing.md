# testing

test는 적게 쓰고, 깨지면 정말 곤란한 것만 가장 싼 층에서 본다. 층은 다섯이고 층마다 무엇이 진짜이고 무엇이 가짜인지가 다르다. 그 위에 test가 아닌 eval 층이 있다(진짜 model의 판단을 잰다. `project-docs/architecture/eval.md`). 이 문서는 층, 가짜 셋, `tests/support`, 앱 길, E2E 실행 폴더, 언제 무엇을 돌리나, case 고르는 규칙을 다룬다. 쓸지 말지와 모양은 `.claude/skills/write-test/SKILL.md`가 정한다.

## 층

| 층 | 진짜 | 가짜 | 자리 | 돌리는 명령 |
|---|---|---|---|---|
| unit | 함수 하나 | 없음 | 코드 옆 `*_test.ts` | `deno task check` |
| harness loop | loop, tool 실행, Gate·hook | scripted model | `tests/harness/loop/` | `deno task check` |
| harness wire | provider adapter, 실패 분류, 호출당 idle | 녹화·손 fixture를 `fetch`로 재생 | `tests/harness/wire/` | `deno task check` |
| core E2E | core daemon, agent runtime·worker·app child 전부 | HTTP fake server | `tests/e2e/` | `deno task e2e` |
| provider live | 진짜 provider와 model | 없음 | `tests/live/` | `deno task test:live` |
| eval (test 아님) | core, 진짜 model(`real` 참가자만), judge(eval을 돌리는 agent의 subagent) | 나머지 참가자는 model 없음 | `tests/eval/` | `deno task eval`, `deno task eval:experiment <id>` |

- `tools/check.ts`는 `tests`를 package 하나로 본다. 어느 package가 바뀌어도 `tests`의 fmt, lint, `deno check`, harness와 support의 `*_test.ts`가 같이 돈다.
- 개편 동안 `tests/e2e`, `tests/eval`과 그것만 쓰는 `tests/support`를 check의 type check와 test에서 뺐다(`tools/check.ts`의 `NOT_CHECKED`). fmt와 lint는 그대로 본다. e2e를 되살리는 계획이 이 줄과 그 목록을 지운다.
- `tests/e2e`와 `tests/live`는 check의 `deno test`에 들지 않는다. `deno.json`의 `test.exclude`를 쓰지 않고 `--ignore`로 뺀다. `test.exclude`에 든 폴더는 인자로 직접 줘도 돌지 않아 `deno task e2e`가 못 돈다. CLI `--ignore`는 root `deno.json`의 `exclude`를 대체하므로 check는 그 목록(`DENO_EXCLUDED`)을 같이 준다.
- `deno task e2e`는 `--parallel` 없이 file 순서대로 돈다. flow마다 core를 띄운다. E2E file 수의 상한은 없고 시간 예산이 있다: 전체가 10분 안에 끝나야 한다. 넘으면 행을 harness로 내리거나 같은 준비를 쓰는 file로 묶는다.

## 가짜 셋

```
 harness loop:  startTurnLoop ─ TurnPorts.model ─▶ scriptedModel (정규화된 결과를 순서대로)
 harness wire:  createModelResolver({fetch}) ─ adapter ─ fetch ─▶ replayFetch (fixture 본문)
 core E2E·dev:  core ─ agent runtime child ─ HTTP ─▶ fake server (127.0.0.1, anthropic-messages)
```

- **scripted model**(`tests/support/loop/model.ts`): provider wire를 모르고 answer, tools, partial, failed, hang을 낸다. queue는 엄격하다. 남은 step이나 넘친 호출은 실패다. 받은 요청을 깊은 복사로 기록한다. 시간은 `manualClock`과 harness의 `wait`·`fireDeadline`으로 다루고 기다리지 않는다.
- **녹화 재생**(`tests/support/wire/`): `replayFetch`가 fixture를 호출 순서대로 돌려주고 받은 요청을 기록한다. fixture는 `tests/fixtures/provider/<provider>/<case>.sse|.json`과 선택 `<case>.meta.json`(`status`, `headers`, `disconnect`)이다. 요청은 저장하지 않는다. 손 fixture는 짧은 SSE이고, live가 녹화한 것은 `live-<행>` 이름으로 같은 폴더에 둔다.
- **fake server**(`tests/support/fake-server/`): `Deno.serve`로 loopback, port 0에 뜬다. 한 protocol(`anthropic-messages`, path `/messages`)만 말한다. 대답은 text, tool(인자 문자열 그대로), error, silent, cut, stall, raw 일곱이다. step의 대답은 값 대신 함수(`ReplyFn`: 받은 요청과 journal → 대답)여도 된다. 앞 요청에서 받은 id(call, ticket)를 다음 tool 인자에 넣을 때 쓴다. 요청은 `match`로 줄(lane)에 나눌 수 있다. session 둘(Project Manager와 Operator 같은)이 같이 model을 부르면 줄마다 queue가 따로다. 요청을 읽는 helper(`systemText`, `toolNames`, `lastUserText`, `lastToolResult`, `idIn`)는 `probe.ts`에 있다. 받은 요청을 모두 journal에 남기고, 기대와 다른 요청이나 빈 queue에는 HTTP 400(`invalid_request_error`)과 차이 설명으로 답한다. 500 계열은 제품이 retry해 test가 헷갈리기 때문이다. `aborted(n)`은 server가 응답을 붙들고 있는 동안 client가 끊은 때만 풀린다. 응답 event의 꼴은 `shape_test.ts`가 fixture와 견준다.

fake로 가는 길은 제품의 길뿐이다: `providers/connect`(key 없는 loopback provider, `auth_kind: "none"`)와 기동 전 `<data root>/settings.json`(`lophn-agent.model.catalog_auto_update: false`). 제품에 test 전용 flag나 env를 두지 않는다.

## `tests/support`

support에는 띄우기와 연결만 둔다. flow의 단계는 test file에 그대로 쓴다. 하위 폴더 하나에 주인 하나다.

| 폴더 | 내놓는 것 |
|---|---|
| `loop/` | `scriptedModel`, `loopHarness`(나머지 `TurnPorts`와 `LoopDeps`, 진짜 file을 쓰는 `write_file` tool), `assertRequestInvariants`(tool_use·tool_result 짝, 대화 접두) |
| `wire/` | `loadFixture`, `replayFetch`, `wireBinding`(protocol 셋), `callWire` |
| `fake-server/` | `startFakeServer`, `createFakeHandler`(socket 없는 몸체), `Reply`·`Step`·`JournalEntry` |
| `core/` | `createRun`, `bootCore`(`env`, `repo` 옵션. `repo`는 다른 checkout의 core를 띄울 때만 준다), `tryBootCore`(기동 실패를 값으로), `Core`(`call`, `tryCall`, `upload`, `kill`, `stop`)와 사람 역할 helper(`connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `waitQuestion`, `decide`, `stopTurn`, `settle`, `until`) |
| `gateway/` | `connectGateway`(shell main의 Gateway 역할), `waitCodingTerminal`·`answerTerminal`·`exitTerminal`(coding 터미널 요청에 답하고 process 끝을 알림) |
| `coding/` | `codingCli`(coding agent CLI를 in-process `cliMain`으로), `mcpRequest`(coding token으로 core `/mcp`에 JSON-RPC 한 건), `handOffQueued`·`createTicket`, `appCoreEnv`, `e2e:deps`의 `prepare-deps.ts` |
| `app/` | `startTestApp`·`activateTestApp`(template 앱을 제품 길로 띄움), `handOff`·`deliverRelease`·`verifyTicket`·`approveActivation`·`waitRunning`, `aeLane`, `createAppSource`·`amendAppSource`, flow별 앱 patch(`patch-*.ts`, `patches.ts`) |
| `fake-oauth/` | `startFakeIssuer`(device code·PKCE loopback 발급자), `connectOAuthProvider` |
| `annotation/` | `uploadScreenshot` |

- `bootCore`는 daemon을 `deno run --allow-all packages/core/main/daemon/main.ts --port=0`으로 pipe에 띄우고 stdout 첫 frame(hello)에서 user token을 받는다. env는 비운 뒤 `LOPHN_HOME`, 빈 `HOME`, `PATH`, `DENO_DIR`과 `env` 옵션에 준 것만 준다. `DBUS_SESSION_BUS_ADDRESS`는 주지 않는다.
- `kill()`(SIGKILL)과 `stop()`(stdin을 닫음)은 `/proc/*/environ`에 그 `LOPHN_HOME`이 든 process가 없어질 때까지 기다린다. child가 남으면 그 pid만 끄고 실패한다. Linux 전용이다.
- `settle`은 agent runtime child가 지금 권한으로 다시 뜬 것을 본다. provider를 연결하거나 project 폴더를 더하면 core가 1초 polling으로 child를 다시 띄우고, 그 사이 시작한 turn은 끊긴다. 옛 runtime pid가 사라지고 새 pid가 떠 `platform/health`가 available이면 돌아온다.
- 기다림은 신호를 읽는 poll(제한 30초, 맞으면 바로 돌아옴)이나 fake server의 `arrived`·`aborted`다. 고정 sleep을 쓰지 않는다.

## 앱 길

앱 E2E는 사람이 앱을 시작하는 길로만 앱을 띄운다: core가 깐 template을 앱 source로 복사해 `apps/create` → `apps/connect_source` → App Engineer의 ticket 맡기기(fake 대답) → coding agent 역할의 claim·`release prepare`·`app test`·`ticket report`(CLI) → `ticket.verify` → activation 허락. data root에 release를 직접 깔지 않는다. 제품 template에는 견본 업무가 없다(빈 `tools`, 자리 표시 `home` 화면 하나). `createAppSource`가 복사한 template 위에 test 몫의 견본(`tests/support/app/sample/`: `add_item`·`list_items`, `items` 화면과 표)을 먼저 얹고 `home` 화면을 지운다. 흐름별 차이(큰 write, sandbox 밖 읽기, crash, migration)는 그 위에 얹는 patch다.

- ticket의 check를 정하는 행은 `deliverRelease`에 `check`를 주고 `verify: false`로 보고에서 멈춘 뒤, program이 예시를 돌려 `tickets/show`에 결과를 남기기를 기다리고 `verifyTicket`으로 통과(verified)나 막힘(reported에 머묾, `conflict`)을 본다. 맞는 예시와 틀린 예시를 table의 두 행으로 둔다(`app-release_test.ts`). 바깥 net·secret 행(`app-call_test.ts`의 `net-fetch-loopback`)은 loopback `Deno.serve` 서버를 test가 띄우고, `Calls` 앱에 `cap-net`·`cap-secret`을 쓰는 patch(`patch-net.ts`)를 얹어 앱이 broker를 지나 그 서버를 부르게 한다. 서버가 받은 요청의 `Authorization`, 호출 결과, ledger의 invocation으로 단정한다. 앱 process의 보고 본문 읽기는 `reaction_test.ts`의 행이 다룬다(`patch-report.ts`).
- agent가 앱 tool을 부르는 행은 앱 place의 Operator로 부른다(`app-call_test.ts`, `app-data-rewind_test.ts`, `operator_test.ts`). template tool은 `public: false`라 그 domain을 맡지 않은 lophn이나 project의 agent에게는 보이지 않는다. 정의에 `domains`가 없는 앱 place Operator는 앱의 domain을 모두 맡는다.
- coding agent의 MCP 행(`app-release_test.ts`의 `coding-mcp-preview-only`)은 앱이 live로 뜬 뒤 `handOff`로 같은 앱에 coding session을 하나 더 열고, 그 token으로 `mcpRequest`를 부른다. preview 없이 한 번, CLI로 preview를 띄운 뒤 한 번 부르고 live ledger와 data가 그대로인지 본다.
- coding token은 Gateway `coding_terminal` frame의 `plan.env`로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다. Gateway 연결은 principal마다 4개 한도라 행마다 그 행의 앱 Gateway를 닫는다.
- release 준비가 받는 npm·jsr·esbuild 의존은 `deno task e2e:deps`가 `.dev-data/e2e/deno-dir` 하나에 미리 받는다. 앱 E2E의 core는 `appCoreEnv()`로 그 `DENO_DIR`을 받고, E2E 중 network는 loopback뿐이다.
- app test는 `systemd-run --user --scope`로 메모리 한도를 건다. 그래서 앱 E2E의 core에는 `XDG_RUNTIME_DIR`을 준다. user systemd가 없는 환경에서는 앱 E2E가 실패한다(skip하지 않는다).
- 앱 socket 폴더는 `XDG_RUNTIME_DIR` 아래 data root마다 나뉜다. 같은 사용자의 core가 여럿 떠도 서로의 socket을 지우지 않는다.

## E2E 실행 폴더

```
/tmp/lophn-e2e-<random>/          createRun이 Deno.makeTempDir로 system 임시 폴더에 만든다
  home/       LOPHN_HOME (0700). settings.json은 기동 전에 둔다
  work/       project 폴더, 앱 source. data root 밖. 폴더마다 git init·commit
  user-home/  core의 HOME (빈 폴더)
  core.log    core stderr
```

- run을 저장소 안에 두지 않는 것은 worktree 안(`.claude/worktrees/<이름>/.dev-data/...`)에서 app test의 Unix socket 경로가 길이 한도(108 byte)를 넘기 때문이다.
- `run.remove()`는 폴더마다 쓰기 권한을 돌려준 뒤 `<run>`을 통째로 지운다. 새 data root면 core가 sdk 사본과 앱 template을 0444/0555로 깐다.
- 사람의 `~/.lophn`은 읽지도 쓰지도 않는다. 고정 port와 고정 path를 쓰지 않는다(dev의 fake server만 예외).

## 돌리는 때

- `deno task check`(작업 중, 끝내기 전)와 `check:full`(merge 전): unit, harness, support의 test.
- `deno task e2e`: lead가 merge 전에 새 flow를 10번 연속 돌리고, `land.sh`가 main에 올리기 전에 돈다. 앱 E2E 전에 `deno task e2e:deps`를 한 번 돌린다. 끝난 뒤 그 run의 `/tmp/lophn-e2e-*`와 core process가 없어야 한다.
- `deno task test:live`: 사람이 key(`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)를 줄 때만. key는 shell env나 루트의 `.env`(git이 무시한다)에서 읽고, 같은 이름이면 shell이 이긴다. `deno task e2e`와 check는 `.env`를 읽지 않는다. 돌 것이 없으면(key도 live root도 없음) 이유를 찍고 0으로 끝난다. key가 있는 provider의 file과, live root가 있으면 `chatgpt_test.ts`가 돈다. 한 file의 호출은 10번 이하, 호출당 90초다. `LOPHN_LIVE_RECORD=1`이면 응답만(key와 계정 id를 지우고) fixture로 쓰고, 사람이 diff를 보고 commit한다. `providers/`·`models/`를 고친 계획이 land하기 전, provider나 model을 더할 때, 판을 닫기 전에 돈다.
  - ChatGPT 구독은 key가 아니라 사람의 진짜 로그인이다. `deno task test:live:login`이 core를 live 전용 root `.dev-data/live/home`(log와 user-home은 `.dev-data/live/run`)에 띄워 로그인을 한 번 저장하고(같은 컴퓨터의 browser가 필요하다), 계정 model 목록 응답 모양과 기본 model을 찍는다. `test:live`는 그 root에 core를 띄워 구독 token으로 turn 하나를 돌리고 계정 model 목록과 `billing_route == subscription`을 단정한다. 갱신은 token 만료 5분 전 안에만 일어나 단정은 그때만 돈다(로그인하고 약 55분 뒤 한 번 더 돌린다. 아니면 "확인하지 못했다"를 찍는다). 쓸 수 없는 credential이면 test가 실패한다.
  - 이 root는 복사하지 않는다(refresh token이 갱신 때마다 회전한다). core 하나만 띄우고 두 task를 동시에 돌리지 않는다. 코드는 root를 지우지 않으며 지우려면 사람이 `chmod -R u+w .dev-data/live && rm -rf .dev-data/live`를 한다. 이 root는 schema가 바뀌면 못 뜨고 그때 지우고 다시 로그인한다.
- `deno task eval`: 사람이 진짜 provider 호출을 허락했을 때만. `.env`의 `ANTHROPIC_API_KEY`를 읽고, 없으면 재료 hash와 fixture만 확인하고 0으로 끝난다. role 지침, tool 설명, skill, assembly를 바꾼 계획이 land하기 전에 그 component를 본 case를 다시 돌리고, `deno task eval:scorecard`로 scorecard를 다시 쓴다. harness를 고친 것은 commit한 spec으로 `deno task eval:experiment <id>`가 판정한다(`.claude/skills/eval-run/SKILL.md`). 둘 다 judge item과 `ask`가 대기로 남아 eval을 돌리는 agent가 `eval:judge`, `eval:answer`로 채워야 끝난다. run 요약(`tests/eval/runs/`), scorecard(`tests/eval/scorecards/`), experiment 기록(`tests/eval/experiments/`)은 commit한다. `tests/eval`의 `*_test.ts`는 순수 unit이라 `deno task check`가 돌린다.
- `deno task dev`: `tools/dev.ts`가 앱 전에 core를 한 번 띄워 고정 port(기본 7499)의 fake server를 `providers/connect`로 심는다. `LOPHN_LIVE_PROVIDER=1`이면 심지 않는다.

## case 고르는 규칙

1. 쓰기 전에 세 질문에 답하고 test 머리 주석에 한 줄씩 남긴다: 어떤 contract를 지키나(boundary ID), 어떤 현실적인 회귀에서 깨지나, 왜 지금 test로는 못 잡나.
2. AGENTS.md의 위험 목록(데이터 잃기, 권한·secret·sandbox 경계, 두 번 고친 bug)에 닿을 때만 쓴다.
3. contract 하나에 test 하나를 가장 싼 층에 둔다. core E2E에는 process 경계를 건너야만 깨지는 것만 둔다. 경우의 수는 harness에서 늘린다.
4. case 하나는 단계 6, fake 대답 3, 단정 3 이하다. fake 대답은 행의 몫만 센다. support helper(`handOff`, `deliverRelease`)가 거는 대답은 세지 않는다. 행 몫이 3을 넘어도 되는 것은 session 둘이 서로를 기다리는 행(`agent-call`, session archive의 call)뿐이고, 이유를 test 머리 주석에 적는다. 단정은 서로 다른 곳(disk, ledger·event, fake가 받은 요청)에서 한다. 화면 문구는 단정하지 않는다.
5. 변형은 table 한 줄로 둔다. 공통 불변식은 support의 함수 하나로 같이 쓴다.
6. 회귀는 그 contract의 table에 한 행으로 더하고, 고치기 전 코드에서 실패하는 것을 확인한다.
7. 새 E2E는 10번 연속 통과한 뒤 넣는다.
8. flaky한 case는 꺼 두지 않는다. 고치거나, harness로 내리거나, 지운다. 제품 bug를 찾은 E2E는 test를 맞추지 않고 bug를 고친 뒤 넣는다.
9. lophn이 만든 것(core, child process, 앱 process)은 진짜를 쓰고, lophn 밖의 것만 가짜를 쓴다. model provider는 가짜, 사람·coding agent CLI·shell의 Gateway 역할은 test가 대신한다. 인터넷은 막는다.

## 왜 이 모양인가

- 가짜를 셋으로 나눈 것은 loop test가 provider wire에 묶이면 상관없는 test까지 깨지고, core E2E의 model 호출은 child process 안이라 `fetch`를 바꿀 수 없어서다. OpenAI Agents SDK, Vercel AI SDK, OpenCode가 같은 분리다.
- 옛 test(1,503 file)는 요구 하나에 test 하나로 쌓여 check가 40~60분 걸렸다. 그래서 층마다 시작 크기를 작게 잡았다(harness 20~40개, core E2E 6~10개).
- E2E file 수 상한(12) 대신 시간 예산을 둔 것은 사람이 case가 부족하다고 했고, 새 case가 규칙 9개를 통과하면 file 수보다 실행 시간이 비용이기 때문이다.
- 처음 만든 core E2E 여섯 가운데 다섯이 제품 bug를 찾았다(성공한 tool call의 ledger 상태, snapshot read 없음, rewind preview의 port, 멈춤이 runtime의 요청을 못 끊음). 모두 process를 건너야만 드러나는 것이었다.
