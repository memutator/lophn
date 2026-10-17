# coding-role

test가 coding agent 역할로 coding token을 들고 `lophn` CLI를 부르는 runner와, release 준비가 받는 npm·jsr 의존을 미리 채워 두는 `DENO_DIR`(`.dev-data/e2e/deno-dir`)과 그 준비 명령 `deno task e2e:deps`를 만든다. 앱 E2E의 core env 규칙(`DENO_DIR`, `XDG_RUNTIME_DIR`)도 여기서 한 곳에 둔다.

- 단위: coding-role (wave 1)
- 선행: boot-damaged. `bootCore`의 `env` 옵션을 쓴다.
- 소유(이 task만 고친다):
  - `tests/support/coding/`
  - `deno.json`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/README.md`의 "정한 것" 10(E2E 중 network는 loopback뿐, 의존은 `.dev-data/e2e/deno-dir` 하나에 미리 받는다)
  - `project-docs/plan/e2e-coverage/research/candidates-bugs.md` "앱이 필요한 것"의 `fresh-root-app-release`(주의 줄)
  - architecture: `project-docs/architecture/coding-agent.md`(CLI 하나와 token), boundary `coding-agent-cli-interface`
  - 코드: `packages/coding-agent/cli/main.ts`(`cliMain(argv, options)`: `env`·`fetch`·`stdout`·`stderr`·`cwd`를 끼울 수 있다. `import.meta.main`일 때만 실행되므로 import해도 안전하다), `packages/coding-agent/connection/client/daemon.ts`(`discoverDaemonAddress`: `LOPHN_DAEMON_URL` 또는 `$LOPHN_HOME/run/location.json`), `packages/protocol/coding-agent/{cli-commands,token}.ts`(`CODING_TOKEN_ENV` = `LOPHN_CODING_TOKEN`), `packages/core/apps/releases/prepare/from-source.ts`(`fetchExternal`의 `deno cache`가 network를 쓰는 유일한 단계), `packages/core/apps/releases/ui-build/binaries.ts`(`denoDirOf`, `esbuildBinaries`: `DENO_DIR/npm/registry.npmjs.org/@esbuild/*/bin/esbuild`), `packages/core/apps/packages/template/{files,install}.ts`, `packages/core/main/daemon/wiring/sdk-install.ts`
  - main의 `tests/support/core/{mod,process,human}.ts`(지금 계약: `createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human}.ts`(지금 계약: `createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`)의 `bootCore(run, {env})`(`boot-damaged`가 더한다), `cliMain`. 환경 `DENO_DIR`, `XDG_RUNTIME_DIR`.
  - 내놓는 것: 아래 "내놓는 것" 절

## 내놓는 것

```ts
// tests/support/coding/cli.ts
codingCli(core: Core, token: string): CodingCli
type CodingCli = {
  run(command: string, input?: Record<string, unknown>): Promise<{ code: number; value: unknown; stderr: string }>;
  // 예: run("ticket claim", { ticket, base_revision }). 내부에서 cliMain([...command.split(" "), "--json", "--input", JSON.stringify(input)], { env: { get }, stdout, stderr })를 in-process로 부른다.
  // env에는 LOPHN_CODING_TOKEN=token, LOPHN_DAEMON_URL=core.baseUrl만 있다. stdout의 JSON을 value로 파싱한다.
};

// tests/support/coding/deps.ts
e2eDenoDir(): string                          // <repo>/.dev-data/e2e/deno-dir
appCoreEnv(): Promise<Record<string, string>> // bootCore(run, { env })에 넘길 값: { DENO_DIR: e2eDenoDir(), XDG_RUNTIME_DIR: <지금 환경의 값> }
// deno-dir가 없거나 비었으면 "deno task e2e:deps를 먼저 돌려라"로 실패한다(skip하지 않는다). XDG_RUNTIME_DIR이 없으면 "app test가 systemd-run --user를 쓴다"로 실패한다.
// deno.json task: "e2e:deps": "deno run --allow-all tests/support/coding/prepare-deps.ts"
```

## 할 일

1. `cli.ts`: 위 모양. CLI를 새 process로 띄우지 않는다(in-process `cliMain`). 이유: CLI의 입력 검사와 출력 꼴까지 지나므로 route를 직접 부르는 것보다 충실하고, 앱 E2E 한 번에 CLI를 여덟 번쯤 부르는데 process마다 Deno 시작이 든다. 사람이 process로 부르기를 원하면 "사람에게 물을 것"에 올린다.
2. `deps.ts`와 `prepare-deps.ts`: 이 명령만 network를 쓴다. 무엇을 받아야 하는지는 추측하지 말고 코드로 정한다: 임시 data root(`.dev-data/e2e/deps-<임시 이름>/`)에 `installSdkCopies`·`installBuiltinTemplate`(core/apps/packages)로 sdk 사본과 template을 깔고, template을 `{{APP}}`·`{{TITLE}}`을 채워 복사해 `git init`·commit한 뒤 `prepareFromSource`(`core/apps/releases/prepare/from-source.ts`)를 `DENO_DIR=e2eDenoDir()`로 한 번 돌린다. 그러면 `deno cache`(npm·jsr)와 esbuild 실행 파일이 그 폴더에 받아진다. 끝나면 임시 data root를 지운다(sdk 사본이 읽기 전용이라 `chmod`부터).
3. 오프라인 확인: 준비 명령이 끝난 뒤 같은 `prepareFromSource`를 network 없이 다시 돌려 통과해야 한다. 이 머신에서는 `unshare -rn sh -c 'ip link set lo up && <명령>'`이 된다(loopback만, 확인함). 이 확인을 준비 명령의 마지막 단계로 넣을지 보고에서 추천한다. 되지 않는 환경이면 보고에 적는다.
4. `cli_test.ts`(process 없음): 가짜 `fetch`를 끼워 `codingCli`가 JSON `value`와 종료 코드를 맞게 돌려주는지 한 번 본다. 단정 둘. token이 없는 core 호출이 `unauthorized`로 끝나는 것은 CLI 쪽 규칙이라 다시 보지 않는다.
5. 앱 flow의 `app test` 자식이 쓰는 의존(`child_test.ts`가 import하는 것)이 이 폴더에 더 필요한지는 `test-app`이 처음 앱 E2E를 돌려 알아낸다. 그때 `prepare-deps.ts`를 `test-app`이 고칠 수 있다(그 brief의 추가 소유).

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `coding-agent-cli-interface`(coding agent가 core에 닿는 길은 CLI 하나이고 인증은 token이다), `app-releases`(release 준비는 network를 쓰는 단계가 `deno cache` 하나다).
- 현실적 회귀: CLI 입력 검사가 바뀌어 coding agent가 ticket을 claim하지 못하는 것, E2E가 사람의 `~/.cache/deno`나 인터넷에 기대 환경마다 결과가 다른 것.
- 왜 지금 test가 못 잡나: CLI는 `main_test.ts`가 가짜 fetch로만 본다. 앱 release 준비를 새 data root에서 지나는 test가 없다(이번 판에 template 앱의 release 준비 bug가 넷).

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `deno task e2e:deps`를 두 번 돌려 두 번째가 빠르게 끝난다. 그 뒤 위 3의 오프라인 확인이 통과한다. `.dev-data/e2e/`에 `deno-dir` 말고 남은 폴더가 없다.
- 위험 test: 없음(support. 앱 E2E가 쓴다)

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 찾은 제품 bug: 증상, 재현하는 행, 의심 file. 고쳤으면 "고치기 전 코드에서 그 행이 실패한 것"의 출력 한 줄
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
