# e2e-support-core

core E2E가 쓰는 띄우기·연결을 `tests/support/core/`에 만든다: 실행 폴더(`.dev-data/e2e/<run>/{home,work}`)와 정리, core daemon을 pipe로 띄워 hello frame에서 user token을 받기, route 호출과 upload(`secrets/put`), provider 연결, 사람 역할의 얇은 route helper. 이것이 맞게 도는지 `tests/e2e/boot_test.ts` 하나로 본다.

- 단위: e2e-support (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/support/core/`
  - `tests/e2e/boot_test.ts`
- 읽을 것:
  - `project-docs/products/roadmap/testing.md`("지켜야 할 것", "core E2E 후보", "fake 셋"의 fake server)
  - `project-docs/plan/testing/research/facts-main.md` 4절(provider 연결), 6절(core 기동과 token), 8절(agent runtime Deno 권한과 runtime 재기동), 9절(사람 역할 route), 10절(재시작), 11절(secret)
  - architecture: `project-docs/architecture/place-session.md`, `project-docs/architecture/approval.md`("지키는 것")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `server`, `supervision`, `core-api`, `child-supervision-protocol`, `project-docs/module-catalog.yaml`의 `packages/core/main`
  - 코드: `packages/core/main/daemon/main.ts`(진입. stdin이 tty가 아니면 parent pipe), `main/daemon/parent.ts`(`greet`: hello frame), `protocol/supervision/supervision.ts`(`coreToMainMessageSchema`의 hello `{user_token, api_port, core_epoch}`), `protocol/base/frame.ts`(`FrameDecoder`), `protocol/client/client.ts`(`createRpcClient`), `protocol/base/route.ts`(`UPLOAD_INPUT_HEADER`), `protocol/secrets/secret-file.ts`(`secretPut`), `shell/main/desktop/core/supervise.ts`·`client.ts`(shell main이 같은 일을 하는 모양, 읽기만), `core/lophn-agent/run-loop/runtime.ts`(runtime 재기동 polling), `tools/dev.ts`의 `removeDataRoot`(지우는 법. 읽기만, tests가 tools를 import하지 않는다)
- 계약:
  - 쓰는 것: `createRpcClient`(command는 `{input, idempotency_key, compare, prepared: []}` 봉투), 각 route 객체(`providerConnect` 등 `protocol/lophn-agent/*`), `createIdSource`·`systemClock`·`cryptoRandom`(`packages/base`).
  - 내놓는 것(아래 모양. `e2e-*` flow와 `dev-fake`가 이 이름으로 부른다. 바꾸면 보고의 "계약 바꾸기 요청"에 적고 lead가 다른 brief를 고친다):

```ts
// tests/support/core/mod.ts
createRun(): Promise<Run>
type Run = {
  dir: string;   // <repo>/.dev-data/e2e/<Deno.makeTempDir가 정한 이름>
  home: string;  // dir/home  (0700, LOPHN_HOME)
  work: string;  // dir/work  (project 폴더 등. data root 밖)
  remove(): Promise<void>; // chmod -R u+w 한 뒤 dir 통째로 지운다
};

bootCore(run: Run, options?: { settings?: Record<string, unknown> }): Promise<Core>
type Core = {
  run: Run;
  baseUrl: string;  // http://127.0.0.1:<api_port>
  token: string;    // hello frame의 user_token
  call<R extends Route>(route: R, input: ..., compare?: ...): Promise<Output<R>>; // 오류면 code를 담아 throw
  tryCall<R extends Route>(route: R, input: ..., compare?: ...): Promise<Result<Output<R>>>; // 오류 code를 단정할 때
  upload(name: string, bytes: Uint8Array): Promise<Result<unknown>>; // secrets/put
  kill(): Promise<void>;  // SIGKILL (crash 흉내). 끝나고 core의 child까지 없는 것을 확인한 뒤 돌아온다
  stop(): Promise<void>;  // 정상 종료(stdin을 닫는다). 같은 확인
  logPath: string;        // dir/core.log (core의 stderr)
};

// tests/support/core/human.ts   (route 하나 + 기다림만. flow의 단계는 test file에 쓴다)
connectFakeProvider(core, fake: { url: string }, options?: { key?: string }): Promise<{ provider: string }>
openProject(core, folder: string, name?: string): Promise<{ project: string }>
openSession(core, agent: { role: "lophn" } | { role: "project_manager"; project: string }): Promise<string>
say(core, session: string, text: string): Promise<{ message: string }>
turnsOf(core, session: string): Promise<Turn[]>
waitTurnEnd(core, session: string, index?: number): Promise<Turn>
waitPermission(core, session: string): Promise<{ request: string }>
decide(core, session: string, request: string, choice: "allow" | "reject"): Promise<void>
stopTurn(core, turn: string): Promise<void>
settle(core): Promise<void>
```

## 지켜야 할 것(계획 공통)

- `~/.lophn`, OS keychain, 사람의 전역 harness 설정을 건드리지 않는다. E2E data root는 `.dev-data/e2e/<run>/home`뿐이다.
- 진짜 model provider는 `deno task test:live`에서만, 사람이 key를 줄 때만 부른다. worker와 lead는 live를 돌리지 않는다(key 없는 실행으로 gate만 확인한다).
- 전역 mutable 상태를 두지 않는다. 고정 port와 고정 path를 쓰지 않는다. 병렬로 돌아야 한다. sanitizer를 끄지 않는다. sleep으로 기다리지 않는다(gate, 가짜 clock, 신호).
- `tests/support`에는 띄우기와 연결만 둔다. flow의 단계는 test file에 그대로 쓴다. 공통 불변식은 함수 하나로 둔다.
- case 하나는 단계 6, fake 대답 3, 단정 3 이하다. 화면 문구는 단정하지 않는다.
- 의심 A~D를 고칠 때는 먼저 그 행이 고치기 전 코드에서 실패하는 것을 확인하고 보고에 적는다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.

## 정한 것

- 실행 폴더: `Deno.makeTempDir({dir: "<repo>/.dev-data/e2e", ...})`가 이름을 정한다(고정 이름 없음). `home`은 0700. `work`는 폴더 쓰기가 가능한 곳. 정리는 `run.remove()`: sdk 사본이 0444/0555라 폴더마다 `chmod 0o755`부터 한 뒤 지운다. test는 `try/finally`로 부른다(준비가 던져도 자원이 닫혀야 한다).
- `bootCore`는 core가 뜨기 전에 `home/settings.json`이 없으면 `{"lophn-agent.model.catalog_auto_update": false, ...options.settings}`를 0600으로 쓴다(models.dev 요청을 끈다. 선언 안 된 key가 하나라도 있으면 file 전체가 거절된다). 이미 있으면(재기동) 건드리지 않는다.
- core는 `deno run --allow-all packages/core/main/daemon/main.ts --port=0`로 띄운다. stdin·stdout은 pipe, stderr는 `dir/core.log` file. env는 비운 뒤 `LOPHN_HOME=<run.home>`, `HOME=<dir>/user-home`(빈 임시 폴더), `PATH`, `DENO_DIR`(호출한 쪽의 값, 없으면 기본 cache 위치를 계산해 명시. HOME을 바꾸므로 명시하지 않으면 npm cache를 못 찾는다)만 준다. `DBUS_SESSION_BUS_ADDRESS`와 `XDG_RUNTIME_DIR`은 주지 않는다(OS keychain에 닿지 않는다). 사람의 `HOME`과 `~/.lophn`은 아무것도 읽지 않는다.
- hello는 stdout 첫 frame이다(`FrameDecoder`로 읽고 `coreToMainMessageSchema`로 검사). 제한 시간(30초)이 지나도 안 오면 core.log의 끝을 담아 실패한다. 이후 stdout은 계속 읽어 비운다(안 읽으면 pipe가 차서 core가 막힌다).
- 시각·id·무작위는 `bootCore`/`createRun` 안에서 `createIdSource({clock: systemClock, random: cryptoRandom})`로 만든다(전역 모듈 변수를 두지 않는다. `Core`가 쥔다). `call`이 command 봉투의 `idempotency_key`를 거기서 받는다.
- `kill()`/`stop()`은 daemon만이 아니라 그 child(agent runtime, worker, app supervisor)까지 없어진 것을 확인한 뒤 돌아온다. Linux에서 `/proc/<pid>/environ`에 `LOPHN_HOME=<run.home>`이 든 process가 없으면 끝난 것이다. 남았으면 SIGKILL하고 보고에 "core가 child를 남긴다"를 적는다. (다른 OS는 범위 밖.)
- 기다림은 신호를 읽는 poll만 쓴다: 읽기 route(`turns/list`, `session_snapshots/list`, `platform/health` 등)를 조건이 맞을 때까지 되풀이하되 **제한 시간(기본 30초)이 있고 조건이 맞으면 즉시 돌아온다.** 고정 `sleep`으로 때우지 않는다. Gateway(`GET /gateway`, subprotocol `lophn.gateway.1`)의 event로 기다리는 쪽이 간단하면 그쪽을 써도 된다.
- **settle(runtime 재기동 기다림)**: provider를 연결하거나 project 폴더를 더하면 core가 1초 polling으로 agent runtime child를 새 권한으로 다시 띄운다(`run-loop/runtime.ts`). 그 사이 turn을 시작하면 turn이 끊긴다. `settle(core)`는 "runtime이 지금 상태의 권한으로 다시 떴다"를 확인하고 돌아와야 한다. 쓸 신호를 코드로 찾는다(`platform/health`의 observation, runtime의 상태·시각 같은 것). 결정적 신호가 없으면 대안은 provider·project를 다 만든 뒤 core를 한 번 `stop()`하고 같은 run으로 `bootCore`하는 것이다(시작할 때 runtime이 처음부터 맞는 권한으로 뜬다). 어느 쪽을 골랐는지와 이유를 "정한 것"에 적는다. 제품 코드에 신호를 더하지 않는다(README "정한 것" 11). 그 밖에 필요한 것이 보이면 고치지 말고 "계약 바꾸기 요청"에 적는다. `connectFakeProvider`와 `openProject`는 끝에 `settle`을 불러 돌아온다.
- `connectFakeProvider`: `secret`이 있으면 이름 `provider.<provider id의 pvd_ 뒤>`로 `secrets/put` upload를 먼저 한다(`createRpcClient`는 upload를 못 부른다. `fetch`로 `authorization: Bearer`, `content-type: application/octet-stream`, `x-lophn-input: base64url(JSON {name, bytes})`, body = bytes). 그 다음 `providers/connect`: 정의는 `{key: "anthropic", display_name, protocols: ["anthropic-messages"], auth_kinds: [key ? "api_key" : "none"], models_endpoint: null, oauth: null, revision: "e2e"}`, `endpoint: fake.url`(끝에 `/v1`을 붙이지 않는다), `protocol: "anthropic-messages"`, 키가 있으면 `credential: {secret: <그 이름>}`(loopback http에 api_key를 허용하는 것을 코드로 확인한다), 없으면 `auth_kind: "none"`·`credential: null`. 마지막으로 `model-default/change`로 `{provider, model_name: "claude-sonnet-4-5", option_values: {}}`를 고른다(동봉 snapshot에 `anthropic/claude-sonnet-4-5`가 있어야 한다. 없으면 snapshot에서 tool을 받는 anthropic model 하나를 고른다).
- `decide`의 choice는 `approvals/decide_turn`(`DecideTurnPermission`, memory route, `protocol/approvals/requests.ts`)의 `turnChoiceSchema` 값 중 그 request의 `choices`에 있는 것이다. 지침 파일(`LOPHN.md`) 쓰기 같은 settings edit는 `allow`·`reject`다.
- `stopTurn`은 `turns/stop`의 `compare`(`state_seq`)를 `turns/read`로 먼저 읽어 채운다.
- 사람 역할 helper는 위 열 개를 넘기지 않는다. 앱·call·rewind·secret 검사 helper는 만들지 않는다(그것은 flow test file이 route를 직접 부른다).

## 할 일

1. `tests/support/core/`를 위 모양으로 만든다. file은 `mod.ts`(Run, bootCore, Core), `process.ts`(spawn, hello, 종료 확인), `human.ts`(helper)로 나눈다. 근거: roadmap "폴더"(support는 띄우기와 연결), "지켜야 할 것".
2. `tests/e2e/boot_test.ts`: **한 번 띄워** 아래를 본다(E2E 하나. 사람이 6 flow와 함께 E2E를 새로 만들라고 한 범위의 기반 확인이다).
   - 단계: `createRun` → `bootCore` → `platform/status` → `kill()` → 같은 run으로 `bootCore`(SIGKILL 뒤 instance lock과 schema가 재기동을 막지 않는다) → `platform/status` → `stop()` → `run.remove()`.
   - 단정 3: (1) 두 `platform/status`가 `ready: true`이고 `data_root`가 `run.home`이다(사람의 `~/.lophn`이 아니다). (2) 마지막 `stop()` 뒤 `LOPHN_HOME=<run.home>`을 가진 process가 `/proc`에 없다. (3) `run.remove()` 뒤 `run.dir`이 없다(읽기 전용 sdk 사본이 지워졌다).
   - 재기동이 SIGKILL 뒤 안 되면(instance lock이 stale로 남는 등) 고치지 않는다. `kill()`을 정상 종료(`stop`)로 바꾸는 것은 `e2e-restart`의 뜻을 바꾸므로 "계약 바꾸기 요청"과 "알려진 미완 동작"에 적고 사람이 정하게 한다.
3. `connectFakeProvider`·`openProject`·`openSession`·`say`·`waitTurnEnd`는 이 task의 test가 직접 쓰지 않아도 된다. 대신 임시 스크립트(commit하지 않음)로 fake server 없이 가능한 범위(`providers/connect`로 연결하고 `openProject`, `openSession`까지)를 한 번 돌려 route 입력이 schema를 통과하는 것을 확인한다. fake server는 같은 wave의 `e2e-support-server`가 만들므로 turn까지는 가지 않는다. turn이 끝까지 도는 확인은 flow task들이 한다.
4. test 머리 주석에 세 질문의 답을 한 줄씩 남긴다.

## 세 질문

- contract: boundary ID `server`·`supervision`(user token은 parent pipe hello 한 번으로만 나온다. data root 격리), `secrets`(upload header).
- 현실적 회귀: core를 띄우는 방법이 바뀌어(hello frame 모양, 권한 flag) 모든 E2E가 못 도는 것, 실행 폴더가 사람의 `~/.lophn`을 가리키는 것, 읽기 전용 sdk 사본 때문에 지우기가 실패해 `.dev-data`가 쌓이는 것.
- 왜 지금 test로 못 잡나: core를 daemon으로 띄워 token을 받는 test가 없다(`sandbox-boundary_test.ts`가 subprocess 한 번이 전부).

## 끝남

- `deno task check`가 통과한다.
- `deno fmt --check tests`, `deno lint tests`, `deno check <내가 만든 tests/ file>`이 통과한다(이 worktree에 test-tasks가 아직 없으면 fast check는 `tests/`를 보지 않는다. 그래서 직접 돌린다).
- `deno test --allow-all --no-check tests/e2e/boot_test.ts`를 10번 연속 통과한다. 끝난 뒤 `.dev-data/e2e/`에 폴더가 남지 않고, `pgrep -af "\.dev-data/e2e"`가 0줄이다.
- 위험 test: "E2E core는 실행 폴더의 data root만 쓰고, 정리하면 흔적(child process, 읽기 전용 file)이 남지 않는다"
- 남지 않음: `grep -rn "\.lophn" tests`가 0줄이다(사람의 data root를 가리키는 경로가 없다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

