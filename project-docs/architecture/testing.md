# testing

test는 적게 쓰고, 깨지면 정말 곤란한 것만 가장 싼 층에서 본다. 층은 다섯이고 층마다 무엇이 진짜이고 무엇이 가짜인지가 다르다. 이 문서는 층, 가짜 셋, `tests/support`, E2E 실행 폴더, 언제 무엇을 돌리나, case 고르는 규칙을 다룬다. 쓸지 말지와 모양은 `.claude/skills/write-test/SKILL.md`가 정한다.

## 층

| 층 | 진짜 | 가짜 | 자리 | 돌리는 명령 |
|---|---|---|---|---|
| unit | 함수 하나 | 없음 | 코드 옆 `*_test.ts` | `deno task check` |
| harness loop | loop, tool 실행, Gate·hook | scripted model | `tests/harness/loop/` | `deno task check` |
| harness wire | provider adapter, 실패 분류, 호출당 idle | 녹화·손 fixture를 `fetch`로 재생 | `tests/harness/wire/` | `deno task check` |
| core E2E | core daemon, agent runtime·worker·app child 전부 | HTTP fake server | `tests/e2e/` | `deno task e2e` |
| provider live | 진짜 provider와 model | 없음 | `tests/live/` | `deno task test:live` |

- `tools/check.ts`는 `tests`를 package 하나로 본다. 어느 package가 바뀌어도 `tests`의 fmt, lint, `deno check`, harness와 support의 `*_test.ts`가 같이 돈다.
- `tests/e2e`와 `tests/live`는 check의 `deno test`에 들지 않는다. `deno.json`의 `test.exclude`를 쓰지 않고 `--ignore`로 뺀다. `test.exclude`에 든 폴더는 인자로 직접 줘도 돌지 않아 `deno task e2e`가 못 돈다. CLI `--ignore`는 root `deno.json`의 `exclude`를 대체하므로 check는 그 목록(`DENO_EXCLUDED`)을 같이 준다.
- `deno task e2e`는 `--parallel` 없이 file 순서대로 돈다. flow마다 core를 띄운다.

## 가짜 셋

```
 harness loop:  startTurnLoop ─ TurnPorts.model ─▶ scriptedModel (정규화된 결과를 순서대로)
 harness wire:  createModelResolver({fetch}) ─ adapter ─ fetch ─▶ replayFetch (fixture 본문)
 core E2E·dev:  core ─ agent runtime child ─ HTTP ─▶ fake server (127.0.0.1, anthropic-messages)
```

- **scripted model**(`tests/support/loop/model.ts`): provider wire를 모르고 answer, tools, partial, failed, hang을 낸다. queue는 엄격하다. 남은 step이나 넘친 호출은 실패다. 받은 요청을 깊은 복사로 기록한다. 시간은 `manualClock`과 harness의 `wait`·`fireDeadline`으로 다루고 기다리지 않는다.
- **녹화 재생**(`tests/support/wire/`): `replayFetch`가 fixture를 호출 순서대로 돌려주고 받은 요청을 기록한다. fixture는 `tests/fixtures/provider/<provider>/<case>.sse|.json`과 선택 `<case>.meta.json`(`status`, `headers`, `disconnect`)이다. 요청은 저장하지 않는다. 손 fixture는 짧은 SSE이고, live가 녹화한 것은 `live-<행>` 이름으로 같은 폴더에 둔다.
- **fake server**(`tests/support/fake-server/`): `Deno.serve`로 loopback, port 0에 뜬다. 한 protocol(`anthropic-messages`, path `/messages`)만 말한다. 대답은 text, tool(인자 문자열 그대로), error, silent, cut, stall, raw 일곱이다. 받은 요청을 모두 journal에 남기고, 기대와 다른 요청이나 빈 queue에는 HTTP 400(`invalid_request_error`)과 차이 설명으로 답한다. 500 계열은 제품이 retry해 test가 헷갈리기 때문이다. `aborted(n)`은 server가 응답을 붙들고 있는 동안 client가 끊은 때만 풀린다. 응답 event의 꼴은 `shape_test.ts`가 fixture와 견준다.

fake로 가는 길은 제품의 길뿐이다: `providers/connect`(key 없는 loopback provider, `auth_kind: "none"`)와 기동 전 `<data root>/settings.json`(`lophn-agent.model.catalog_auto_update: false`). 제품에 test 전용 flag나 env를 두지 않는다.

## `tests/support`

support에는 띄우기와 연결만 둔다. flow의 단계는 test file에 그대로 쓴다. 하위 폴더 하나에 주인 하나다.

| 폴더 | 내놓는 것 |
|---|---|
| `loop/` | `scriptedModel`, `loopHarness`(나머지 `TurnPorts`와 `LoopDeps`, 진짜 file을 쓰는 `write_file` tool), `assertRequestInvariants`(tool_use·tool_result 짝, 대화 접두) |
| `wire/` | `loadFixture`, `replayFetch`, `wireBinding`(protocol 셋), `callWire` |
| `fake-server/` | `startFakeServer`, `createFakeHandler`(socket 없는 몸체), `Reply`·`Step`·`JournalEntry` |
| `core/` | `createRun`, `bootCore`, `Core`(`call`, `tryCall`, `upload`, `kill`, `stop`)와 사람 역할 helper(`connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`) |

- `bootCore`는 daemon을 `deno run --allow-all packages/core/main/daemon/main.ts --port=0`으로 pipe에 띄우고 stdout 첫 frame(hello)에서 user token을 받는다. env는 비운 뒤 `LOPHN_HOME`, 빈 `HOME`, `PATH`, `DENO_DIR`만 준다. OS keychain에 닿는 env(`DBUS_SESSION_BUS_ADDRESS` 등)는 주지 않는다.
- `kill()`(SIGKILL)과 `stop()`(stdin을 닫음)은 `/proc/*/environ`에 그 `LOPHN_HOME`이 든 process가 없어질 때까지 기다린다. child가 남으면 그 pid만 끄고 실패한다. Linux 전용이다.
- `settle`은 agent runtime child가 지금 권한으로 다시 뜬 것을 본다. provider를 연결하거나 project 폴더를 더하면 core가 1초 polling으로 child를 다시 띄우고, 그 사이 시작한 turn은 끊긴다. 옛 runtime pid가 사라지고 새 pid가 떠 `platform/health`가 available이면 돌아온다.
- 기다림은 신호를 읽는 poll(제한 30초, 맞으면 바로 돌아옴)이나 fake server의 `arrived`·`aborted`다. 고정 sleep을 쓰지 않는다.

## E2E 실행 폴더

```
<repo>/.dev-data/e2e/<run>/      createRun이 Deno.makeTempDir로 이름을 정한다
  home/       LOPHN_HOME (0700). settings.json은 기동 전에 둔다
  work/       project 폴더, 앱 source. data root 밖. 폴더마다 git init·commit
  user-home/  core의 HOME (빈 폴더)
  core.log    core stderr
```

- `run.remove()`는 `chmod -R u+w` 뒤 `<run>`을 통째로 지운다. 새 data root면 core가 sdk 사본과 앱 template을 0444/0555로 깐다.
- 사람의 `~/.lophn`은 읽지도 쓰지도 않는다. 고정 port와 고정 path를 쓰지 않는다(dev의 fake server만 예외).

## 돌리는 때

- `deno task check`(작업 중, 끝내기 전)와 `check:full`(merge 전): unit, harness, support의 test.
- `deno task e2e`: lead가 merge 전에 새 flow를 10번 연속 돌리고, `land.sh`가 main에 올리기 전에 돈다. 끝난 뒤 `.dev-data/e2e/`가 비고 그 run의 core process가 없어야 한다.
- `deno task test:live`: 사람이 key(`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)를 줄 때만. key는 shell env나 루트의 `.env`(`.env.example`을 복사한다. git이 무시한다)에서 읽고, 같은 이름이면 shell이 이긴다. `deno task e2e`와 check는 `.env`를 읽지 않는다. key가 없으면 이유를 찍고 0으로 끝난다. key가 있는 provider의 file만 돈다. 한 file의 호출은 10번 이하, 호출당 90초다. `LOPHN_LIVE_RECORD=1`이면 응답만(key와 계정 id를 지우고) fixture로 쓰고, 사람이 diff를 보고 commit한다. `providers/`·`models/`를 고친 계획이 land하기 전, provider나 model을 더할 때, 판을 닫기 전에 돈다.
- `deno task dev`: `tools/dev.ts`가 앱 전에 core를 한 번 띄워 고정 port(기본 7499)의 fake server를 `providers/connect`로 심는다. `LOPHN_LIVE_PROVIDER=1`이면 심지 않는다.

## case 고르는 규칙

1. 쓰기 전에 세 질문에 답하고 test 머리 주석에 한 줄씩 남긴다: 어떤 contract를 지키나(boundary ID), 어떤 현실적인 회귀에서 깨지나, 왜 지금 test로는 못 잡나.
2. AGENTS.md의 위험 목록(데이터 잃기, 권한·secret·sandbox 경계, 두 번 고친 bug)에 닿을 때만 쓴다.
3. contract 하나에 test 하나를 가장 싼 층에 둔다. core E2E에는 process 경계를 건너야만 깨지는 것만 둔다. 경우의 수는 harness에서 늘린다.
4. case 하나는 단계 6, fake 대답 3, 단정 3 이하다. 단정은 서로 다른 곳(disk, ledger·event, fake가 받은 요청)에서 한다. 화면 문구는 단정하지 않는다.
5. 변형은 table 한 줄로 둔다. 공통 불변식은 support의 함수 하나로 같이 쓴다.
6. 회귀는 그 contract의 table에 한 행으로 더하고, 고치기 전 코드에서 실패하는 것을 확인한다.
7. 새 E2E는 10번 연속 통과한 뒤 넣는다.
8. flaky한 case는 꺼 두지 않는다. 고치거나, harness로 내리거나, 지운다. 제품 bug를 찾은 E2E는 test를 맞추지 않고 bug를 고친 뒤 넣는다.
9. lophn이 만든 것(core, child process, 앱 process)은 진짜를 쓰고, lophn 밖의 것만 가짜를 쓴다. model provider는 가짜, 사람·coding agent CLI·shell의 Gateway 역할은 test가 대신한다. 인터넷은 막는다.

## 왜 이 모양인가

- 가짜를 셋으로 나눈 것은 loop test가 provider wire에 묶이면 상관없는 test까지 깨지고, core E2E의 model 호출은 child process 안이라 `fetch`를 바꿀 수 없어서다. OpenAI Agents SDK, Vercel AI SDK, OpenCode가 같은 분리다.
- 옛 test(1,503 file)는 요구 하나에 test 하나로 쌓여 check가 40~60분 걸렸다. 그래서 층마다 시작 크기를 작게 잡았다(harness 20~40개, core E2E 6~10개).
- 처음 만든 core E2E 여섯 가운데 다섯이 제품 bug를 찾았다(성공한 tool call의 ledger 상태, snapshot read 없음, rewind preview의 port, 멈춤이 runtime의 요청을 못 끊음). 모두 process를 건너야만 드러나는 것이었다.
