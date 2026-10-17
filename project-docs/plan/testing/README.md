# 계획: test 환경을 처음부터 다시 만들기

상태: 열었음. brief는 `tasks/`, 상태는 `status.md`(`python3 -I project-docs/plan/tools/status.py testing build`). lead는 `project-docs/plan/tools/lead/lead.sh testing`이 여는 worktree(branch `plan/testing`)에서 돌린다.

## 이 계획

- 목표: harness test(loop, wire), core E2E, provider live test를 `tests/` 아래에 새로 세운다. fake는 셋(scripted model, 녹화 재생, fake server)으로 새로 만들고 옛 `tools/fake-provider/`는 지운다. 그 과정에서 loop와 오류 분류의 의심 넷(A~D)을 정한 동작으로 고친다.
- 재료:
  - `project-docs/products/roadmap/testing.md`: 왜, 지금 모양, 목표 모양, case 고르는 규칙, 첫 case, 지켜야 할 것, 단계, 끝남 기준, 하지 않는 것
  - `research/`: 조사 자료. 무엇을 언제 읽나는 `research/README.md`
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
  - `project-docs/architecture/`의 approval, place-session, agent-call, app-call, agent-definition(각 "지키는 것")
  - boundary-catalog의 `run-loop`, `providers`, `models`, `secrets`, `approvals`, `agent-sessions`
- 범위 밖: UI E2E(Electron, Playwright), eval, core E2E 7~9(agent call, 앱 호출, 앱 data rewind)와 그 support(session별 queue, Gateway·coding agent 역할), cassette 녹화 engine, OS·transport matrix, nightly·cron live.
- 단위(brief가 확정한다):
  - `test-tasks`: `deno.json`에 task `e2e`, `test:live`와 test exclude(`tests/e2e`, `tests/live`), `tools/check.ts`가 `tests/harness`를 fast·full에서 돌게.
  - `harness-loop`: `tests/support`의 scripted model(`TurnPorts.model` 자리, 엄격 queue, main/aux, 요청 기록, gate·가짜 clock)과 loop를 띄우는 port 묶음, `tests/harness/loop/`의 안전 규칙 table(roadmap "harness loop" 12행), 의심 C·D의 제품 변경.
  - `harness-wire`: `tests/support`의 녹화 재생 `fetch`, `tests/fixtures/provider/`의 손 fixture(끊긴 stream, 깨진 tool 인자, 4xx/5xx, 오류 frame), `tests/harness/wire/`의 protocol 셋 판정 table과 HTTP 분류 table, 의심 A·B의 제품 변경(`providers/failures.ts`).
  - `e2e-support`: `tests/support`의 fake server(응답 7종, journal, 차이 오류), core 띄우기(daemon을 pipe로 spawn, hello token), data root(`.dev-data/e2e/<run>/{home,work}`, `settings.json`, chmod 뒤 지우기), upload helper(`secrets/put`), 사람 역할 route helper. fake server 응답이 fixture와 같은 event 종류를 내는지 보는 unit 하나.
  - `e2e-*`: roadmap "core E2E 후보" 1~6. flow 하나에 task 하나(`tests/e2e/<flow>_test.ts`).
  - `live-suite`: `tests/live/`의 공용 suite와 provider별 file(Anthropic, OpenAI), 요청 셋 + OpenAI reasoning 잘림 행, 단정 넷, gate(task + env key), 호출당 timeout과 호출 수 상한, 응답을 `tests/fixtures/provider/`에 저장하는 option.
  - `dev-fake`: `tools/dev.ts`가 새 fake server를 띄우고 `providers/connect`와 `settings.json`으로 붙게, `tools/fake-provider/`와 `LOPHN_FAKE_PROVIDER_URL` 지우기, AGENTS.md "사람에게 묻는 것"의 fake 줄, `write-test` skill, orchestrate skill의 "E2E를 새로 만들지 않는다" 줄, `project-docs/plan/tools/lead/land.sh`가 `deno task e2e`를 돌게.
- 순서(초안): wave 1 `test-tasks`, `harness-loop`, `harness-wire`, `e2e-support`(fixture 꼴 대조 unit은 `harness-wire` 뒤). wave 2 `e2e-*` 여섯과 `live-suite`. wave 3 `dev-fake`.
- 사람이 정할 것: 아래 "정한 것" 5~7. 추천으로 brief를 쓴다. 사람이 바꾸면 그 brief만 바꾼다.

## 정한 것

roadmap "정할 것"의 답이다. `(agent)`는 사람이 정하지 않고 추천으로 간 것이다.

1. **fake는 셋이다.** scripted model(harness loop), 녹화 재생 `fetch`(harness wire), fake server(core E2E와 dev). loop test가 provider wire에 묶이면 상관없는 test까지 깨진다. core E2E의 model 호출은 child process 안이라 `fetch`를 바꿀 수 없다. OpenAI Agents SDK, Vercel AI SDK, OpenCode가 같은 분리다. (agent)
2. **case 고르는 규칙은 roadmap의 9개다.** 새 case는 세 질문(contract, 현실적 회귀, 왜 지금 test가 못 잡나)을 brief나 test 머리 주석에 한 줄씩 남긴다. (agent)
3. **core E2E는 1~6을 만든다.** 사람이 이 계획을 열라고 했다. AGENTS.md "E2E는 만들기 전에 사람에게 묻는다"의 답으로 본다. 7~9는 다음 계획이다.
4. **의심 A·B는 temporary로 retry한다.** Anthropic stream의 `rate_limit_error` frame(header 없음)과 OpenAI Responses의 `server_is_overloaded`. `failures.ts`의 RATE_CODES 주석("429가 아니면 temporary")과 같은 뜻이다. (agent)
5. **의심 C: model 호출 하나가 120초 동안 byte를 받지 못하면 그 호출을 끊고 temporary로 retry한다.** 첫 byte 전과 stream 중간 모두 같다. reasoning model이 첫 글을 내기 전 오래 생각해도 provider가 ping·진행 event를 보내는 동안은 끊지 않는다. 사람이 정할 것(제품 동작). 추천값으로 brief를 쓴다.
6. **의심 D: 연속 partial이 3번이면 turn을 실패로 끝낸다.** complete가 오면 다시 센다. 끝난 이유는 brief가 지금 있는 값에서 고르고, 새 값이 필요하면 "계약 바꾸기 요청"으로 올린다. 사람이 정할 것(제품 동작). 추천값으로 brief를 쓴다.
7. **live test는 provider마다 `models/snapshot.json`에서 tool과 이미지를 받는 가장 싼 model 하나를 쓴다. OpenAI는 잘림 행에만 reasoning model 하나를 더 쓴다. 한 번 실행의 호출은 10번 이하, 호출당 timeout은 90초다.** 사람이 정할 것(비용). 추천값으로 brief를 쓴다.
8. **`tools/fake-provider/`는 옮기지 않고 지운 뒤 새로 만든다**(clean room). 사람이 정했다.
9. **live 대상은 Anthropic과 OpenAI다.** 사람이 정했다.
10. **E2E는 실행마다 `.dev-data/e2e/<run>/`을 만들고 그 아래 `home/`(data root)과 `work/`(project 폴더, 앱 source)를 둔다.** 앱 source는 data root 밖에 두고 폴더마다 `git init`과 commit을 한다. release 준비는 source 폴더가 git 저장소의 맨 위여야 한다(`apps/releases/prepare/git-extract.ts`의 `requireRepository`). (agent)
11. **제품에 test 전용 flag나 지름길을 넣지 않는다.** fake로 가는 길은 `providers/connect`(key 없는 loopback, `auth_kind: "none"`)와 기동 전 `settings.json`(`lophn-agent.model.catalog_auto_update: false`)뿐이다. user token은 daemon을 pipe로 띄워 hello frame에서 받는다. (agent)

## 지켜야 할 것(worker brief에 그대로 넣는다)

- `~/.lophn`, OS keychain, 사람의 전역 harness 설정을 건드리지 않는다. E2E data root는 `.dev-data/e2e/<run>/home`뿐이다.
- 진짜 model provider는 `deno task test:live`에서만, 사람이 key를 줄 때만 부른다. worker와 lead는 live를 돌리지 않는다(key 없는 실행으로 gate만 확인한다).
- 전역 mutable 상태를 두지 않는다. 고정 port와 고정 path를 쓰지 않는다. 병렬로 돌아야 한다. sanitizer를 끄지 않는다. sleep으로 기다리지 않는다(gate, 가짜 clock, 신호).
- `tests/support`에는 띄우기와 연결만 둔다. flow의 단계는 test file에 그대로 쓴다. 공통 불변식은 함수 하나로 둔다.
- case 하나는 단계 6, fake 대답 3, 단정 3 이하다. 화면 문구는 단정하지 않는다.
- 의심 A~D를 고칠 때는 먼저 그 행이 고치기 전 코드에서 실패하는 것을 확인하고 보고에 적는다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.

## 돌리기 전에

- 다른 session이 main checkout에서 혼자 `PLAN-remove-keychain.md`(MCP secret을 `secrets.json`으로 옮기고 keychain 길을 지움)를 돌린다. `packages/core/secrets`, `lophn-agent/extensions/`, `run-loop/runtime-secret.ts`를 고친다. 이 계획은 그 file들을 소유하지 않는다. `e2e-secret` flow는 provider key만 보므로 겹치지 않지만, 그 계획이 land한 뒤 rebase에서 secret route 이름을 다시 확인한다.
- 새 E2E와 subprocess test는 이 계획의 `e2e-support`, `e2e-*`에만 있다. 다른 task가 process를 띄우는 test를 만들면 lead가 멈춘다.
- E2E나 harness가 제품 bug를 찾으면 test를 고쳐 맞추지 않는다. 고치는 일이 작으면(한 module, 동작이 문서로 정해져 있음) lead가 이 계획에 fix task를 더해 같은 wave에서 고친다. 크거나 제품 동작을 새로 정해야 하면 `issue` skill대로 올리고 사람에게 묻는다. 그동안 그 flow는 merge하지 않는다. 꺼 두지(skip) 않는다. 코드를 읽어 나온 의심은 `project-docs/plan/e2e-coverage/README.md`의 S1~S4다. S2(멈춤이 model 요청과 shell을 못 끊음)는 이 계획의 `e2e-stop`이 처음 드러낼 것이다.
- 다음 계획 `e2e-coverage`가 이 계획의 support(`tests/support/fake-server`, `tests/support/core`) 위에 선다. 계약(brief의 "내놓는 것")을 바꾸면 그 계획 README의 "쓰는 계약"을 같이 고친다.

## lead가 할 일

- wave 1을 열기 전에: module-catalog에 `tests`(boundary null, notes)를 올린다.
- 새 E2E는 `deno task e2e`를 10번 연속 돌려 통과한 뒤 merge한다.
- merge 때마다 관련 이슈 절을 `issue` skill대로 닫는다.
- 모두 merged면 `project-docs/architecture/testing.md`(test 층, fake 셋, support, E2E data root, 돌리는 때, case 고르는 규칙)를 쓰고 registry에 올린다. `tool-fake-provider`를 지우고 새 조각(`tests/support`, `deno task e2e`, `deno task test:live`)을 올린다. changelog 열린 판에 항목을 덧붙이고, roadmap 파일과 이 폴더를 지운 commit까지 land한다.
- 사람에게 부탁할 것: key를 주고 `deno task test:live`를 한 번 돌려 fixture를 녹화하는 것. 녹화 diff는 사람이 보고 commit한다.

## brief를 쓰며 바뀐 것

brief는 `tasks/`에 있다. 아래는 brief를 쓰며 코드를 열어 확인한 것과 초안에서 달라진 것이다.

### task 목록

| id | 단위 | wave | 선행 | 소유 요약 |
|---|---|---|---|---|
| `test-tasks` | test-tasks | 1 | 없음 | `deno.json`, `tools/check.ts` |
| `harness-loop` | harness-loop | 1 | 없음 | `tests/support/loop/`, `tests/harness/loop/`, `run-loop/{turn,retry}.ts`(의심 D) |
| `harness-wire` | harness-wire | 1 | 없음 | `tests/support/wire/`, `tests/harness/wire/`(idle 제외), `tests/fixtures/provider/`, `providers/failures.ts`(의심 A·B) |
| `e2e-support-server` | e2e-support | 1 | 없음 | `tests/support/fake-server/` |
| `e2e-support-core` | e2e-support | 1 | 없음 | `tests/support/core/`, `tests/e2e/boot_test.ts` |
| `harness-wire-idle` | harness-wire | 2 | harness-wire | `providers/{invoke,work}.ts`, `models/{resolve,binding}.ts`, `run-loop/core-ports.ts`, `session/compactor.ts`, `tests/harness/wire/idle_test.ts`(의심 C, 죽은 `timeoutMs` 지우기) |
| `e2e-support-shape` | e2e-support | 2 | e2e-support-server, harness-wire | `tests/support/fake-server/shape_test.ts` |
| `e2e-file-write` | e2e | 2 | e2e-support-server, e2e-support-core | `tests/e2e/file-write_test.ts` |
| `e2e-approval` | e2e | 2 | 같음 | `tests/e2e/approval_test.ts` |
| `e2e-rewind` | e2e | 2 | 같음 | `tests/e2e/rewind_test.ts` |
| `e2e-stop` | e2e | 2 | 같음 | `tests/e2e/stop_test.ts` |
| `e2e-restart` | e2e | 2 | 같음 | `tests/e2e/restart_test.ts` |
| `e2e-secret` | e2e | 2 | 같음 | `tests/e2e/secret_test.ts` |
| `live-suite` | live-suite | 2 | harness-wire | `tests/live/` |
| `dev-fake` | dev-fake | 3 | e2e-support-server, e2e-support-core | `tools/dev.ts`, `tools/fake-provider/`(삭제), AGENTS.md, write-test·orchestrate skill, `land.sh`, registry·module-catalog 한 줄씩 |

### 초안에서 바뀐 것

- **의심 C(호출당 idle timeout)는 harness-loop가 아니라 `providers/invoke.ts`다.** 이유: "그 호출이 byte를 받는가"는 byte를 받는 `invoke.ts`의 일이다. loop(`turn.ts`)는 끝나서 돌아온 결과만 보고 `stall_ms`(complete로만 리셋, 기본 300초)로 호출을 abort하는 장치는 이미 있다. 그래서 `harness-wire` 단위에 `harness-wire-idle`(wave 2, `harness-wire`의 replay 도우미를 쓴다)를 따로 두었다. loop의 `temporary` ×3 → `model_error` 행이 loop 쪽 몫을 이미 본다. 의심 A·B(`failures.ts`)는 초안대로 `harness-wire`, D(연속 partial 3번)는 초안대로 `harness-loop`(`turn.ts`·`retry.ts`)다.
- C의 결과는 "받은 글이 있어도 temporary"다(README "정한 것" 5의 "첫 byte 전과 stream 중간 모두"). 지금 `abortOutcome`은 기한이 지나 끊긴 호출에 글이 있으면 partial을 돌려주므로 idle은 그 길을 타지 않게 따로 가른다.
- **`e2e-support`를 셋으로 나눴다**: server, core, shape. server와 core는 파일이 안 겹쳐 wave 1에서 병렬이다. shape(fake 응답 모양 ↔ fixture 대조 unit)는 harness-wire의 fixture가 있어야 해서 wave 2다. (초안의 "fixture 꼴 대조 unit은 harness-wire 뒤"를 task로 만든 것.)
- **`tests/e2e/boot_test.ts`를 더했다**(`e2e-support-core` 소유). core를 띄워 `platform/status`, SIGKILL 뒤 같은 run으로 재기동, 정리(child process와 읽기 전용 sdk 사본)를 한 번 본다. 이유: support를 flow 6개가 쓰기 전에 혼자 검증할 곳이 필요하다. 이것이 7번째 E2E file이다(roadmap "core E2E 6~10개" 안). 빼도 된다면 사람이 말해 주면 그 단정을 `e2e-restart`로 옮긴다.
- **`deno.json`에 `test.exclude`를 두지 않는다.** Deno 2.9.7에서 `test.exclude`에 든 폴더는 인자로 직접 줘도 "No test modules found"가 나서 `deno task e2e`가 못 돈다(임시 폴더로 확인). 대신 `tools/check.ts`의 모든 `deno test` 호출에 `--ignore=tests/e2e,tests/live`를 붙인다. `tests`를 `tools/check.ts`의 package로 올려 fmt·lint·`deno check`도 `tests/`를 본다.
- **aux 줄(요약·제목용 model 줄)을 scripted model에서 뺐다.** loop(`startTurnLoop`)는 judgment 호출만 하고 요약·압축은 loop 밖(`session/compactor.ts`)이라 loop port에 닿는 곳이 없다. roadmap "더할 후보"의 compact 행이 생기면 그때 더한다.
- 손 fixture 중 **HTTP 4xx/5xx는 file이 아니라 table의 인라인 case**다(SSE 모양이 필요한 행만 file). fixture 저장 꼴과 이름 목록은 `harness-wire` brief가 정했고 `live-suite`가 같은 꼴로 저장한다.
- E2E table 행을 둘로 정한 곳: `e2e-approval`(허락/거절), `e2e-rewind`(복원/사람이 고친 file은 덮어쓰지 않음 `edited_outside`). 후자는 roadmap 3번의 "틀린 되돌리기 막기"를 table 한 줄로 본 것이다.
- `harness-loop`의 한 행(연속 partial 뒤 complete가 수를 되돌림)만 fake 대답이 6개로 "3 이하" 규칙의 예외다. 이유는 brief에 있다(되돌림은 그 길이가 아니면 안 보인다). 마음에 안 들면 그 행을 지우면 된다.
- registry의 `tool-fake-provider` 항목을 지우는 일을 lead가 아니라 `dev-fake`에 넣었다. 이유: `tools/fake-provider/`를 지우면 `tools/check-docs.ts`가 registry의 path 검사로 `deno task check`를 실패시킨다. 새 조각(`tests/support`, `deno task e2e`, `deno task test:live`)을 올리는 것은 계속 lead의 몫이다. `dev-fake`는 module-catalog `tools` notes의 "fake provider" 말도 지운다.
- live의 model은 snapshot의 가격으로 정했다: Anthropic `claude-haiku-5-5`, OpenAI 공용 `gpt-4.1-nano`, OpenAI 잘림 행 `gpt-5-nano`(reasoning 중 가장 쌈). 호출은 3 + 4 = 7번이다.

### 코드에서 확인한 README·roadmap과 다른 사실

- `ModelPort`는 export되지 않았다(`run-loop/ports.ts`의 `type ModelPort`). `TurnPorts["model"]`로 쓴다. 그 밖에 README가 가리킨 `TurnPorts`, `providers/invoke.ts`의 `createInvokeModelCall`, `providers/failures.ts`, `run-loop/turn.ts`, `models/resolve.ts`의 `createModelResolver`, `core/main/daemon/main.ts`, parent pipe hello frame, `providers/connect`, `secrets/put`(upload, `x-lophn-input` header), `approvals/decide_turn`, `turns/stop`, `rewind/preview`·`rewind/apply`, `session_snapshots/list`, `interruptRunningTurns`는 지금 main에 그 이름으로 있다.
- boundary-catalog에 `providers`는 없다. provider 연결·실패 분류는 `models`(model catalog와 provider 연결) boundary다. brief는 `models`로 적었다.
- file tool(`file.write` 포함)은 Gate가 없다. turn 안에서 사람에게 묻는 쓰기는 이름이 `LOPHN.md`인 file 쓰기뿐이다(`agent-roles/hooks.ts`의 `writeGate`, "설정 고치기"). 그래서 roadmap 2번(Gate가 걸린 쓰기)과 5번(허락을 기다리는 도중 재시작)의 쓰기는 `LOPHN.md`다.
- `rewind/apply`의 `files`(복원 준비 관측)는 client가 채우지 않는 것으로 보인다. core가 `Rewind`를 writer 앞에서 가로채 관측·준비를 한다(`session/rewind/files.ts`). `e2e-rewind` worker가 코드로 확인하고 아니면 계약 바꾸기 요청에 올린다.
- 제품의 `timeoutMs`(호출 전체 기한)는 늘 null이라 쓰는 곳이 없는 죽은 인자다(`resolve.ts` → `ModelBinding` → `core-ports.ts` → `invoke.ts`). 의심 C는 이것을 쓰지 않고 새 idle을 만든다. planner 검토에서 `harness-wire-idle`이 같이 지우기로 했다(아래).
- adapter의 endpoint base: Anthropic `https://api.anthropic.com/v1`, OpenAI `https://api.openai.com/v1`처럼 `/v1`이 base에 들어간다(`compat.ts`의 `joinEndpoint`). fake server는 loopback의 path `/messages`에 직접 받는다.
- agent runtime child는 provider를 연결하거나 project 폴더를 더하면 1초 polling으로 다시 뜬다(`run-loop/runtime.ts`). 그 사이 turn을 시작하면 끊긴다. 기다릴 결정적 신호가 코드에 있는지는 확인하지 못했다(`platform/health`의 runtime observation이 후보). `e2e-support-core`가 `settle`로 푼다: 신호를 찾거나, 다 만든 뒤 core를 한 번 껐다 켜는 대안을 쓴다.
- (planner가 고침) 새 test는 `status.py`가 소유로 읽지 못했다. `briefs.py`의 소유 정규식은 `packages/`·`tools/`로 시작하는 path만 읽어서 `tests/**`, `deno.json`, `AGENTS.md`, skill, `project-docs/**`는 겹침 검사에서 빠진다. 같은 wave에서 이들이 겹치지 않게 brief에서 나눴다(`deno.json`·`tools/check.ts`는 test-tasks만, `tests/support/`는 loop·wire·fake-server·core로 하위 폴더를 나눔).
- main checkout에 `PLAN-remove-keychain.md`가 있다(다른 session이 혼자 돌림). `e2e-secret`은 그 계획이 land한 뒤 rebase에서 secret route 이름·file 모양을 다시 확인하라고 brief에 적었다. `e2e-support-core`는 `daemon/main.ts`를 `--port=0`만 주고 띄우므로 영향이 적을 것이다.

### planner 검토

brief를 쓴 worker가 물은 여섯을 이렇게 정했다.

1. **dev의 user token**: 추천안대로 간다. `dev.ts`가 Electron을 띄우기 전에 core를 pipe로 한 번 띄워 `providers/connect`와 기본 model을 심고 닫는다. dev fake server만 고정 port(기본 7499, env로 변경)를 쓴다. dev 도구의 일이고 제품에 flag가 생기지 않는다. (agent)
2. **idle이 차면 받은 글을 버리고 temporary로 다시 부른다.** "정한 것" 5 그대로다. 잘린 글에 이어 쓰면 partial 길과 같아져 의심 D의 되풀이로 돌아간다. (agent)
3. **live OpenAI 공용 행은 `gpt-4.1-nano`**다. 공용 행은 잘림을 보는 행이 아니다. (agent)
4. **`e2e-restart`는 SIGKILL로 시작한다.** 같은 data root로 다시 뜨지 못하면 그것이 찾은 bug다. lead가 이슈로 올리고 정상 종료로 바꿀지는 그때 사람에게 묻는다. (agent)
5. **`status.py`의 소유 읽기는 planner가 고쳤다.** `briefs.py`가 `tests/`, `.claude/`, `project-docs/`, `deno.json`, `deno.lock`, `AGENTS.md`도 읽는다. 다시 만든 `status.md`에서 같은 wave의 겹침은 없다.
6. **죽은 `timeoutMs`는 `harness-wire-idle`이 지운다.** 호출 하나의 기한은 idle 하나가 맡는다. 두 길을 남기지 않는다(AGENTS.md "죽은 코드는 지운다"). 그 task의 소유에 `models/binding.ts`, `providers/work.ts`, `run-loop/core-ports.ts`, `session/compactor.ts`를 더했다. (agent)

사람이 정할 것은 "정한 것" 5~7(추천값으로 brief를 씀)과 Electron E2E를 이 계획에 넣을지(지금은 범위 밖)다.
