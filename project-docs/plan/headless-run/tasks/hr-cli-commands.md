# hr-cli-commands

problem-remove가 land한 뒤의 CLI 표 위에서, `lophn agent run`, `lophn tool call`, `lophn run wait|show|cancel`을 지금의 `lophn` 명령에 더하고, coding token이 없으면 user token file로 core를 부른다. lophn이 꺼져 있으면 core를 띄우지 않고 `unavailable`로 끝난다.

- 단위: cli (wave 2)
- 선행: hr-contract-runs, hr-token-file.
- 소유(이 task만 고친다):
  - `packages/protocol/coding-agent/cli-commands.ts`
  - `packages/coding-agent/cli/main.ts`
  - `packages/coding-agent/cli/main_test.ts`
  - `packages/coding-agent/cli/parser.ts`
  - `packages/coding-agent/cli/registry.ts`
  - `packages/coding-agent/cli/help.ts`
  - `packages/coding-agent/cli/output.ts`
  - `packages/coding-agent/cli/commands/types.ts`
  - `packages/coding-agent/cli/commands/run.ts`
  - `packages/coding-agent/connection/client/core.ts`
- 읽을 것:
  - 계획: `project-docs/plan/headless-run/README.md`의 "정한 것"과 "뼈대 검토에서 정한 것"(`--agent` 짧은 꼴, `--schema`는 JSON 글, `tool call --async`, coding token이 먼저)
  - 계약: `project-docs/plan/headless-run/tasks/hr-contract-runs.md`의 route 표, `StartRun` 입력과 오류, run 기록(`runRecordSchema`), "CLI 모양". `project-docs/plan/headless-run/tasks/hr-token-file.md`의 "내놓는 것"
  - 제품 결정: `project-docs/products/roadmap/headless-schedule.md`의 "권한"(같은 OS 사용자의 위험은 신경 쓰지 않는다)
  - architecture: `project-docs/architecture/coding-agent.md`의 "지키는 것" 첫 줄(coding agent의 token은 앱 하나 범위다)과 "왜 이 모양인가"의 "CLI 출력을 data fence로 감싸지 않는다"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `coding-agent-cli-interface`, `core-api`, `project-docs/module-catalog.yaml`의 `packages/coding-agent`
  - 코드:
    - CLI: `packages/coding-agent/cli/main.ts`(`cliMain`, `inputOf`, client 만들기), `parser.ts`(`parseArgs`, `VALUE_FLAGS`), `registry.ts`(`COMMANDS`, 표 대조, `matchCommand`), `commands/types.ts`(`entryOf`, `READ_WORDS`, `RunContext`), `output.ts`(`CLI_EXITS`, `exitOf`, `createOutput`의 `secrets`), `help.ts`
    - 연결(소유 아님, 쓰기만): `packages/coding-agent/connection/client/daemon.ts`(`discoverDaemonAddress`: `dataRoot`를 주어야 `run/location.json`의 port를 읽는다), `connection/client/core.ts`(`createCoreClient`, `sameAsAbsent`), `connection/call.ts`(`callRoute`: command가 아닌 route는 입력 그대로 보낸다)
    - `packages/core/server/identity/coding-token.ts`(`CODING_TOKEN_OPERATIONS`는 `auth === "coding_token"`인 명령의 route만 모은다. 그래서 `user` 명령의 run route는 coding token에 들지 않는다)
    - `packages/core/agent-roles/place/session-directory.ts`의 `resolveNamed`(`NamedAgent`를 정확한 이름으로 푸는 규칙과 오류 code)
    - `packages/base/install/linux-install.ts`의 `cliLauncher`(설치된 `lophn`은 `LOPHN_HOME`을 `${LOPHN_HOME:-$HOME/.lophn}`로 export하고 `$H/run` 읽기를 연다)
- 계약:
  - 쓰는 것: hr-contract-runs의 run route(`StartRun`, `ReadRun`, `WaitRun`, `CancelRun`)와 "CLI 모양", hr-token-file의 `USER_TOKEN_FILE_NAME`과 file 모양, `packages/coding-agent/connection/`의 `discoverDaemonAddress`·`createCoreClient`
  - 내놓는 것:
    - `CodingCliCommand.auth`에 `"user"`를 더하고 다섯 명령에 쓴다. 명령 이름, flag(`--agent`, `--session`, `--schema`, `--async`와 이 명령들의 `--input`·`--input-file` 뜻), stdout, exit, 자격 순서는 hr-contract-runs의 "CLI 모양" 그대로다. 다만 `--agent`는 README "뼈대 검토에서 정한 것"대로 짧은 꼴 `lophn`, `pm:<project>`, `ae:<app>`, `operator:<이름>`, `operator:<project 또는 app>/<이름>`과 Router의 `NamedAgent` JSON을 받고, 없으면 `lophn`이다. `--schema`는 JSON 글이고, `tool call`도 `--async`를 받는다. coding session 안에서는 coding token이 먼저라 run route는 `forbidden`이다.
    - sync 명령은 `WaitRun`을 끝날 때까지 되풀이해 부른다(한 번에 `timeout_ms` 60000까지).

## 할 일

brief는 main `e192a9d8c` 기준이다. problem-remove의 `pr-cli-problem`이 같은 file에서 `problem *` 명령 여섯, `commands/problem.ts`, `PROBLEM_COMMANDS`, 읽기 단어 `more`·`occurrence`·`body`·`diff`, `codingSourceDiff`를 지운다. "앞 계획 land 뒤 path 확인"이 붙은 곳은 그 뒤의 모양을 열어 보고 맞춘다. 줄 번호는 쓰지 않고 이름으로 찾는다.

1. `packages/protocol/coding-agent/cli-commands.ts`(앞 계획 land 뒤 path 확인: `problem *` 줄과 import가 없다)
   - 머리 주석의 "인증은 … `coding_token`뿐이다"를 셋으로 고친다: `coding_token`, `user`(coding token이 없으면 data root의 user token file), `local`.
   - `CodingCliCommand.auth`를 `"coding_token" | "user" | "local"`로 넓힌다.
   - `token()` 옆에 `user(name, route, input, output)`를 둔다. `auth: "user"`이고 입력은 `withCommon(input)`이다.
   - 다섯 줄을 더한다. route는 `packages/protocol/runs/`의 `runStart`, `runRead`, `runWait`, `runCancel`(hr-contract-runs)이다. 입력은 route 입력이 아니라 CLI 칸이다(명령이 route 입력을 만든다).

     | 이름 | route | CLI 입력(strict, `withCommon` 위) | 위치 인자 |
     |---|---|---|---|
     | `agent run` | `runStart` | `prompt: string.min(1)`, `agent?: string.min(1)`, `session?: idSchema("ses")`, `schema?: string.min(1)`, `async?: boolean`, `input?: jsonValueSchema` | `prompt` |
     | `tool call` | `runStart` | `app: string.min(1)`, `tool: toolNameSchema`, `async?: boolean`, `input?: jsonValueSchema` | `app`, `tool` |
     | `run wait` | `runWait` | `run: idSchema("run")` | `run` |
     | `run show` | `runRead` | `run: idSchema("run")` | `run` |
     | `run cancel` | `runCancel` | `run: idSchema("run")` | `run` |

     - `input` 칸은 `cliCommonSchema`의 `input: string`과 이름이 같다. `withCommon`은 route 쪽 칸이 이기므로 이 명령들에서는 run 입력 JSON 값이 된다.
     - `withCommon`은 shape만 다시 짜므로 칸 사이 refine(`agent`와 `session`은 같이 쓰지 않는다)은 schema에 두지 않고 `commands/run.ts`가 본다.
     - `agent` 칸에 `.describe(...)`로 받는 꼴을 적는다. help가 이 글을 보인다.
     - `output`은 `runRecordSchema`(`run show`, `run cancel`, `--json`)로 둔다. 이 칸을 읽는 곳은 없다.
   - `packages/core/server/identity/coding-token.ts`는 고치지 않는다. `auth === "coding_token"`만 모으므로 run route는 coding token에 들지 않는다.
2. `packages/coding-agent/cli/parser.ts`
   - `ParsedArgs`에 `agent`, `session`, `schema`(string | undefined)와 `async`(boolean)를 더한다.
   - `VALUE_FLAGS`에 `--agent`, `--session`, `--schema`를 더하고 `assign`이 넷 이상을 받게 고친다. 중복이면 지금처럼 "option이 중복된다"다.
   - `--async`는 `--json`처럼 값 없는 flag다.
   - 머리 주석의 "위치 인자는 command 이름과 `hook <harness> <event>`의 두 값뿐"을 맞춘다(`agent run <prompt>`, `tool call <app> <tool>`, `run * <run>`).
3. `packages/coding-agent/cli/commands/types.ts`(앞 계획 land 뒤 path 확인: `READ_WORDS`)
   - `RunContext`에 `json: boolean`을 더한다. run 명령이 `--json`일 때 run 기록 전체를 낸다.
   - 명령이 "값을 내고 0이 아닌 exit으로 끝난다"를 돌려줄 수 있게 작은 class 하나를 더한다. 예: `class ExitWith { exit; stdout?; stderr? }`. route 출력과 헷갈리지 않게 객체 모양이 아니라 `instanceof`로 가른다. `CommandRun`의 성공 값이 이것이면 `main.ts`가 그대로 옮긴다. 끝난 run이 failed·cancelled일 때만 쓴다.
   - `READ_WORDS`에 `wait`를 더한다. `run wait`는 아무것도 바꾸지 않는다(help가 읽기로 보인다).
4. `packages/coding-agent/cli/output.ts`
   - `OutputWriter`에 `note(text)`를 더한다. stderr에 `scrub`한 한 줄을 쓴다. 끝난 run의 실패 이유를 쓴다.
   - 머리 주석의 "받은 coding token은 어떤 출력에도 남지 않는다"를 "받은 token(coding token, user token)"으로 고친다.
5. `packages/coding-agent/cli/commands/run.ts`(새 file): `RUN_COMMANDS` 다섯 줄을 `entryOf(name, summary, { positional, run })`로 만든다. 모든 run은 `ctx.client`가 없으면 `unavailable`이다(`main.ts`가 먼저 막으니 type 때문이다).
   - `--agent` 풀기(`agent`가 없으면 `"lophn"`). 결과는 `NamedAgent`(`packages/protocol/lophn-agent/calls.ts`의 type) 하나 또는 둘이다.
     - `{`로 시작하면 JSON으로 읽는다. 못 읽으면 `invalid_input`. 모양은 `runStart`의 입력 검사가 본다.
     - `lophn` → `{ role: "lophn" }`
     - `pm:<p>` → `{ role: "project_manager", place: { project: p } }`
     - `ae:<a>` → `{ role: "app_engineer", place: { app: a } }`
     - `operator:<n>`(`/` 없음) → `{ role: "operator", name: n }`
     - `operator:<x>/<n>`(처음 `/`에서 자른다) → `place: { project: x }`인 것, 그다음 `place: { app: x }`인 것 둘
     - 그 밖, 빈 이름 → `invalid_input`. message에 받는 꼴 다섯과 JSON을 적는다.
   - `agent run`
     1. `agent`와 `session`이 둘 다 있으면 `invalid_input`.
     2. `schema`가 있으면 `JSON.parse`한다. 객체(배열·null 아님)가 아니면 `invalid_input`("--schema는 JSON Schema 객체다").
     3. `StartRun` 입력 `{ kind: "agent", agent | session, prompt, input?, schema? }`를 `callRoute(ctx.client, { route: runStart, input })`로 보낸다. 빈 optional 칸은 싣지 않는다.
     4. `operator:<x>/<n>`이고 첫 호출이 `not_found`면 두 번째 `NamedAgent`로 한 번 더 부른다.
     5. `async`면 끝낸다: `ctx.json`이면 run 기록, 아니면 run id. exit 0.
     6. 아니면 아래 "기다리기"와 "끝 내기".
   - `tool call`: `StartRun` 입력 `{ kind: "tool", app, tool, input? }`. 그 뒤는 `agent run`의 5, 6과 같다.
   - `run wait`: 받은 run id로 "기다리기"와 "끝 내기".
   - `run show`: `ReadRun { run }`의 `run`만 낸다(read 공통 칸은 버린다). `ctx.json`이 아니면 `output.result`가 줄로 푼다. run 상태와 상관없이 exit 0.
   - `run cancel`: `CancelRun { run }`의 `run`을 `run show`처럼 낸다. 이미 끝난 run의 `conflict`는 그대로 오류다(`exitOf`가 4로 바꾼다).
   - 기다리기: run이 `running`인 동안 `WaitRun { run, timeout_ms: 60000 }`을 되풀이한다. 끝은 core가 정한다. CLI는 따로 시간 제한을 두지 않는다.
   - 끝 내기(끝난 run 하나):
     - `done`: `ctx.json`이면 run 기록. 아니면 `result`가 string이면 그대로, 아니면 `JSON.stringify(result)` 한 줄. exit 0.
     - `failed`·`cancelled`: exit 4(`CLI_EXITS.failed`). `ctx.json`이면 stdout에 run 기록. 아니면 stdout은 비우고 stderr에 `failed: <reason>: <message>` 또는 `cancelled` 한 줄.
6. `packages/coding-agent/cli/registry.ts`(앞 계획 land 뒤 path 확인: `PROBLEM_COMMANDS` import가 없다): `RUN_COMMANDS`를 import해 `COMMANDS`에 더한다. 표 대조 블록은 그대로 둔다.
7. `packages/coding-agent/cli/main.ts`
   - 머리 주석의 "인증은 환경 변수 `LOPHN_CODING_TOKEN` 하나"를 고친다: coding token, 없으면 `user` 명령만 data root의 user token file.
   - `CliOptions`에 `readText?: (path: string) => string | undefined`를 더한다. 없으면 지금의 `readTextOrUndefined`다. token file과 `discoverDaemonAddress`의 `readText`가 이것을 쓴다(AGENTS.md: 파일 시스템은 인자로 받는다. test가 file 없이 끼운다).
   - `matchCommand`를 `createOutput`보다 먼저 부른다(순수 함수다). 맞은 명령이 `auth: "user"`이고 coding token이 없을 때만 user token file을 읽는다.
     - data root: `LOPHN_HOME`(빈 값이면 없는 것), 없으면 `${home}/.lophn`(home은 `options.home ?? env.get("HOME")`). 둘 다 없으면 file이 없는 것과 같다.
     - 경로: `${dataRoot}/run/${USER_TOKEN_FILE_NAME}`(`packages/protocol/client/mod.ts`). 내용 그대로가 token이다.
     - 읽은 token을 `createOutput`의 `secrets`에 coding token과 함께 넣는다.
   - `auth: "user"`인 명령의 입력 만들기:
     - `--input`·`--input-file`을 route body로 펴지 않는다. JSON 값 하나(객체가 아니어도 된다)로 읽어 candidate의 `input` 칸에 둔다. 못 읽으면 지금처럼 `invalid_input`.
     - 위치 인자는 지금처럼 `entry.positional` 칸에 넣는다.
   - 모든 명령: `parsed.agent`·`parsed.session`·`parsed.schema`가 있으면 같은 이름 칸으로, `parsed.async`면 `async: true`로 candidate에 넣는다. 다른 명령은 strict 입력이 "모르는 칸"으로 거절한다. `async`는 flag key가 아니다(`run.ts`가 입력에서 읽는다).
   - client 만들기: `auth: "user"`면 자격은 coding token, 없으면 user token이다. 둘 다 없으면 core에 아무것도 보내지 않고 `unavailable`(예: "lophn이 꺼져 있다: <data root>/run/<USER_TOKEN_FILE_NAME>이 없다")로 끝난다(exit 5). 주소는 `discoverDaemonAddress({ env: LOPHN_DAEMON_URL, dataRoot: <위 data root>, readText })`다. `coding_token` 명령은 지금 그대로다.
   - `entry.run`에 `json: parsed.json`을 넘긴다. 성공 값이 3의 `ExitWith`면 `stdout`을 `output.result`로, `stderr`를 `output.note`로 쓰고 그 exit을 돌려준다.
8. `packages/coding-agent/cli/help.ts`
   - 인증 줄: `user`면 "인증: lophn이 켜져 있으면 data root의 user token file(coding agent session 안에서는 `LOPHN_CODING_TOKEN`)".
   - `auth: "user"` 명령은 `input` 칸을 감추지 않는다(run 입력이다). 그 밖은 지금 그대로다.
9. `packages/coding-agent/cli/main_test.ts`(앞 계획 land 뒤 path 확인: `protocol/problems/mod.ts` import): 위험 test 하나(아래 "끝남"). 있는 test는 고치지 않는다.

정한 것:
- **`operator:<x>/<이름>`은 project로 먼저 부르고, `not_found`면 app으로 한 번 더 부른다.** 이유: 짧은 꼴은 place 종류를 말하지 않는데 `NamedAgent`는 `{ project }`와 `{ app }` 가운데 하나를 받는다. `StartRun`은 이름을 풀다 `not_found`면 session을 열지 않는다(hr-contract-runs 오류 목록). 그래서 다시 불러도 효과가 두 번 나지 않는다.
- **짧은 꼴은 `:` 뒤를 처음 `/`에서 자른다.** 이름에 `/`가 든 agent는 JSON 꼴로 부른다. 이유: 가장 단순하고, JSON 꼴이 늘 남는다.
- **failed·cancelled인데 `--json`이 없으면 stdout은 비우고 stderr에 한 줄을 쓴다.** 이유: 계약은 stdout에 `result`만 싣는다. script는 exit으로, 사람은 stderr로 실패를 안다.
- **`--async`, `run show`, `run cancel`은 명령이 성공하면 exit 0이다.** 이유: run이 끝나기를 기다려 그 결과를 내는 명령이 아니다. exit 4는 기다린 run이 failed·cancelled일 때만이다.
- **`run show`·`run cancel`의 `--json` 없는 출력은 run 기록을 줄로 푼 것이다.** 이유: 계약의 "run show는 run 기록을 줄로 푼다"와 같은 길이다.
- **data root는 core의 `resolveDataRoot`와 같은 규칙(`LOPHN_HOME`, 없으면 `$HOME/.lophn`)이지만 CLI는 symlink·mode를 검사하지 않는다.** 이유: core가 켤 때 이미 검사했고, CLI는 file 하나만 읽는다.

알아 둘 것:
- `createCoreClient`의 `sameAsAbsent`는 모든 `not_found` message를 "현재 token으로 읽을 수 없다. 없는 대상이거나 이 앱 범위 밖이다"로 바꾼다. user token 명령에서는 문구가 맞지 않는다. `packages/coding-agent/connection/`은 소유가 아니니 고치지 않고 보고의 "알려진 미완 동작"에 적는다. code(`not_found`)는 그대로라 operator 다시 부르기는 된다.
- **손으로 CLI를 돌릴 때는 늘 `env -u LOPHN_CODING_TOKEN LOPHN_HOME=<worktree>/.dev-data/hr-cli-commands`를 준다.** `LOPHN_HOME`이 없으면 CLI가 사람의 `~/.lophn/run/user-token`을 읽어 사람의 lophn을 부른다(AGENTS.md "사람에게 묻는 것": 사람의 `~/.lophn`, 실제 model provider 호출). core에 붙여 보는 확인은 하지 않는다. run route의 core 쪽(hr-runs-wiring)이 아직 없을 수 있고, core는 `boot.sh`로만 띄운다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "user token file에서 읽은 token은 stdout과 stderr(오류 포함)에 나오지 않는다"(`packages/coding-agent/cli/main_test.ts`)
  - 준비: env는 `LOPHN_HOME`만 준다(coding token 없음). `readText`는 `<LOPHN_HOME>/run/user-token`에만 token 글을 돌려준다. `fetch`는 받은 `authorization` header를 기록한다.
  - 표로 돈다: `run show run_…`을 `--json` 있음·없음으로, core가 message에 token을 담은 오류(예: 409 `conflict`)를 돌려줄 때. 성공 출력(`ReadRun` 응답 run 기록의 `result`에 token. 기록은 `runRecordSchema`에 맞게 만든다)도 한 줄 넣는다.
  - 판정: 보낸 header가 `Bearer <file의 token>`이다(file의 token을 썼다). stdout과 stderr를 합친 글에 token이 없다.
- 손 확인(위 "알아 둘 것"의 env로):
  - `deno run -A packages/coding-agent/cli/main.ts help`에 다섯 명령이 보이고 `run wait`·`run show`는 읽기 쪽이다.
  - `.dev-data/hr-cli-commands`에 `run/user-token`이 없을 때 `deno run -A packages/coding-agent/cli/main.ts run show run_00000000000000000000000000`가 `unavailable`을 쓰고 exit 5다.
- 남지 않음·겹치지 않음:
  - `grep -rn '"user-token"' packages/coding-agent packages/protocol/coding-agent`가 0줄이다(경로와 오류 message는 `USER_TOKEN_FILE_NAME`으로 만든다).
  - `git diff --name-only`에 `packages/core/server/identity/coding-token.ts`가 없다(coding token은 run route를 받지 않는다).
  - `grep -rn "TODO\|FIXME" packages/coding-agent/cli packages/protocol/coding-agent/cli-commands.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check(`deno task check:full`, 위험 test 이름, 손 확인 둘의 출력과 exit)
- 확인 못 함: 실제 core에 붙여 `agent run`·`tool call`을 끝까지 돌린 것(lead가 hr-runs-wiring merge 뒤 본다)
- 등록할 것: lead가 고칠 목록 file. `packages/protocol/runs/mod.ts`의 export가 모자라면 적는다
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약(hr-contract-runs의 route·"CLI 모양", hr-token-file의 file)을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것(예: `not_found` 문구). 없으면 "없음"
