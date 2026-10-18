# ec-driver

eval에는 desktop shell이 없다. 이 task는 shell의 terminal 몫을 한다: core가 Gateway로 보낸 `coding_terminal` frame(`open`·`input`·`stop`)으로 진짜 Claude Code를 PTY에서 띄우고, App Engineer의 답을 넣고, 끝나면 `coding_agent_terminals/exited`를 core에 알린다. shell 코드를 새로 쓰지 않고 shell의 터미널 host와 요청 처리 코드를 Deno에서 그대로 불러 쓴다. 사람의 HOME, 설치된 Claude Code, 그 로그인을 그대로 쓴다.

- 단위: ec-driver (wave 2)
- 선행: ec-contract
- 소유(이 task만 고친다):
  - `tests/eval/coding/driver/**`
- 읽을 것:
  - 계획: `project-docs/plan/eval-coding/README.md`("정한 것", "돌리기 전에 확인할 것")
  - 설계: `project-docs/products/roadmap/eval.md`의 "진짜로 도는 것"(eval이 대신 맡는 것, headless를 안 쓰는 이유), "공통 수치"(시간)
  - architecture: `project-docs/architecture/coding-agent.md`(특히 "지키는 것"의 token, 메시지는 idle일 때만, 권한 mode는 lophn이 정하지 않는다, 전역 skill·hook을 놓기 전에 사람에게 묻는다, 세션의 끝은 process exit으로만 안다)
  - 제품 코드(읽고 그대로 부른다):
    - `packages/shell/terminal-host/main.ts`: `hostFromNodePty(deps)`가 PTY host다(`handle(request)`, `type: "open-coding" | "input" | "close" | "snapshot"`). `HostRequest`.
    - `packages/shell/terminal-host/launch-plan.ts`: `createCodingHost()`. plan을 `codingLaunchPlanSchema`로 검사하고 env를 `stripPlatformEnv(상속 env)` → `env_delete` 지우기 → `plan.env` 얹기로 만든다. `packages/shell/terminal-host/env.ts`: `stripPlatformEnv`.
    - `packages/shell/terminal-host/pty.ts`: `nodePtyAdapter(load)`.
    - `packages/shell/main/terminal/coding/requests.ts`: `createCodingTerminalRequests(deps)`. frame 하나를 `handle`하고, `codingTerminalResult`·`codingTerminalExited`로 보낼 body를 `reportResult`·`reportExited`로 넘긴다. input은 붙여 넣기 구간 + 마지막 CR로 넣는다.
    - `packages/protocol/coding-agent/terminal-requests.ts`(`codingTerminalResult`, `codingTerminalExited`, frame schema), `launch-plan.ts`(`launchPlanOf`: argv는 `[claude, (--model X), 첫 prompt]`뿐이다), `harnesses.ts`(`harnessDetectionSchema`), `harness-report.ts`(`harnessReport`)
    - core 쪽: `packages/core/apps/tickets/coding/launch.ts`(`resolveLaunch`: harness와 model은 call options → Settings 기본), `settings.ts`(`coding-agent.default_harness`, `coding-agent.default_model`), `relay.ts`(`open`에서 token을 만들어 `plan.env.LOPHN_CODING_TOKEN`에 넣는다)
  - 지금 test의 fake 쪽: `tests/support/gateway/mod.ts`(`connectGateway`), `tests/support/gateway/shell.ts`(`reportHarness`, `waitCodingTerminal`, `answerTerminal`, `exitTerminal`: 이 task가 진짜로 바꾸는 것), `tests/support/app/activate.ts`(`aeHandOff`, `deliverRelease`), `tests/support/coding/cli.ts`
  - 다른 task: `ec-contract.md`의 `CodingTrace`, `CodingEnd`
- 계약:
  - 쓰는 것:
    - `tests/eval/types.ts`: `CodingTrace`, `CodingEnd`(ec-contract).
    - `tests/support/core/mod.ts`의 `Core`(`call`, `baseUrl`), `tests/support/gateway/mod.ts`의 `connectGateway`, `Gateway`.
    - `packages/base/mod.ts`: `Clock`.
  - 내놓는 것(`tests/eval/coding/driver/mod.ts`가 다시 내보낸다):
    - `prepareCodingAgent(deps: PrepareDeps): Promise<{ wrapper: string; claude: string; version: string }>`: trial 전에 한 번. 아래 "할 일 3".
    - `startCodingDriver(deps: DriverDeps): CodingDriver`: trial마다 하나. Gateway 연결을 이 driver가 연다(`connectGateway(core)`). `coding_terminal` frame을 읽는 연결은 이것 하나여야 한다. runner는 같은 frame을 다른 데서 읽지 않는다.
    - `type CodingDriver = { active(): number; traces(): CodingTrace[]; stop(): Promise<CodingTrace[]> }`: `active()`는 process가 살아 있는 session 수(runner가 "coding session도 기다린다"에 쓴다), `traces()`는 지금까지 연 session의 기록(진행 중은 `end: null`), `stop()`은 남은 process를 `close`로 끝내고(끝난 이유 `killed`) Gateway를 닫고 전체 trace를 돌려준다.
    - `type PrepareDeps = { core: Core; root: string; hookRoot?: string; binDir: string; model: string; clock: Clock; install: "check" }`. `root`는 `lophn` wrapper가 가리키는 checkout이다(기본: 지금 checkout. eval-experiment가 variant checkout을 넘긴다). `hookRoot`는 사람이 전역 hook으로 설치한 wrapper가 속한 checkout이다(기본: 지금 checkout, 할 일 3의 4). `binDir`은 `root`의 wrapper 폴더(`<root>/.dev-data/eval/bin`)이고 runner가 정한다
    - `type DriverDeps = { core: Core; clock: Clock; binDir: string; outDir: string; root: string; socketDir?: string; log: (line: string) => void; timeoutMs?: number; noSessionStartMs?: number }`. `socketDir` 기본은 `/tmp/lophn-eval/sock`(unix socket 경로는 108자 안이어야 하므로 짧게). `log`는 runner의 `deps.log`다. 기본 `timeoutMs` 90분, `noSessionStartMs` 120초. `outDir`은 trial의 폴더이고 session마다 `commands-<session>.log`(wrapper 기록)를 여기에 둔다.
    - `claudeVersion(claude: string): Promise<string>`: `claude --version`의 첫 낱말(`2.1.302`). model 호출이 없다.
    - 순수: `driverEnv(inherited): Record<string, string>`, `evalPlan(plan, extras)`, `createFocusGate()`. 위험 test가 부른다.
    - 사람이 보는 길: `deno task eval:attach [session] [--write]`의 입구 `tests/eval/coding/driver/attach.ts`(lead가 deno task를 등록한다. 할 일 5의 e).

## 결정 (사람이 추천대로 정했다. 아래 "기본 경로"가 정해진 길이다)

세 결정은 사람이 추천대로 정했다. 이 brief는 그 길만 쓴다. 소리 없는 우회를 만들지 않는다.

1. **folder trust**: 추천 = trial의 root를 전용 폴더 하나(예 `/tmp/lophn-eval`. unix socket 경로 한도 때문에 짧게) 아래에 두고 사람이 그 폴더를 Claude Code에서 한 번 신뢰한다. runner가 `TMPDIR`를 거기로 둔다(ec-runner 몫. driver는 `TMPDIR`를 건드리지 않는다).
2. **permission 물음**: 추천 = 사람 자신의 permission mode를 그대로 쓴다(eval 전용 flag 없음). 그래도 물음이 뜨면 session은 core에서 `waiting`으로 남고 `CodingRecord.permission_requests`(wrapper 기록의 `hook claude PermissionRequest` 수)로 기록된다.
3. **hook·skill 설치**: 추천 = 사람이 한 번 개발 꼴로 설치한다(command = main checkout의 wrapper 절대 경로). eval은 `dry_run`만 하고 없으면 칠 명령을 적고 멈춘다.

### 결정 1: 사람이 없는 터미널에서 permission 물음과 folder trust

제품은 이것을 정하지 않는다. `launchPlanOf`의 argv는 `[claude, (--model X), prompt]`뿐이고(`packages/protocol/coding-agent/launch-plan.ts`), `architecture/coding-agent.md`는 "coding agent의 권한 mode는 lophn이 정하지 않는다. harness의 권한 물음은 대기 목록에 보이기만 하고 답은 터미널 탭에서 한다"고 적는다. eval에는 탭 앞에 사람이 없다.

확인한 사실(claude 2.1.302, 이 컴퓨터, model 호출 없이 PTY로 첫 화면만 봤다):
- **folder trust**: 새 폴더에서 interactive로 뜨면 "Quick safety check: Is this a project you created or one you trust?"가 뜨고 "No, exit"와 "Yes, I trust this folder"를 고르게 한다(커서는 "No, exit"에 있어 Enter만 누르면 나간다). trial의 app source는 `/tmp/lophn-e2e-*/work/<slug>`(`createRun`, `createAppSource`)라 매번 뜬다.
- **trust가 뜨는 동안 hook은 안 돈다**: `--settings`로 준 SessionStart hook이 trust 화면에서는 실행되지 않았고, 신뢰된 폴더에서는 실행됐다. 그래서 core 쪽 session 상태는 `unknown`이고 첫 prompt는 들어가지 않는다. trial은 90분 상한까지 멈춰 있게 된다.
- **조상 폴더가 신뢰돼 있으면 안 뜬다**: 이 사람의 `~/.claude.json`에서 `/home/pyosechang/projects/lophn`이 신뢰돼 있고, 그 아래 `.dev-data/<새 폴더>`에서는 안 떴다. 신뢰 기록은 Claude Code가 사람이 수락할 때 `~/.claude.json`에 쓴다.
- **flag나 env로 trust를 건너뛰는 길은 없다**: `--dangerously-skip-permissions`, `--permission-mode bypassPermissions`, `--permission-mode acceptEdits` 모두 trust 화면이 그대로 떴다. binary에서 trust를 건너뛰는 환경 변수 이름을 찾지 못했다. trust 화면이 없는 것은 `-p`(headless)와 stdout이 TTY가 아닐 때뿐인데 roadmap이 headless를 쓰지 않기로 했다.
- **이 사람의 `~/.claude/settings.json`**은 `permissions.defaultMode: "auto"`다. 그래서 tool permission 물음은 이 사람 환경에서는 거의 안 뜬다. 다른 사람 환경에서는 `lophn ...` 명령마다 뜰 수 있다. 물음이 뜨면 hook `PermissionRequest`가 core에 알리고 core는 `waiting`으로 두지만 답은 터미널에서만 할 수 있다.

선택지(아래는 사실과 대가다. 추천은 위 "결정"의 1·2):
- (a) **eval 전용 launch flag**: driver가 plan의 argv에 좁은 permission 범위를 더한다(예: 앱 source 안의 편집, `lophn`·`deno`·`git` 명령만 허용). folder trust는 flag로 못 넘기므로 (a)만으로는 안 풀린다. 제품 launch plan과 달라지는 점이므로 run 기록의 "제품과 다른 점"으로 남겨야 한다.
- (b) **사람 역할이 화면을 읽고 키를 친다**: driver가 터미널 출력(`snapshot`)을 사람 역할(ec-human)에게 주고 키를 `input`으로 넣는다. 제품 원칙("화면 출력을 읽어 상태를 짐작하지 않는다")과 다르다. 비용은 Haiku 호출이 늘고, 화면 모양이 Claude Code 판마다 달라 깨지기 쉽다.
- (c) **사람이 터미널을 지켜본다**: driver가 로그를 보이고 멈춰서 사람이 직접 trust·권한에 답한다. 자동 run과 병렬 trial이 안 된다.
- folder trust에만 해당하는 길(선택지와 별개): 사람이 신뢰된 폴더 아래에서 trial을 돌리게 한다. 예: runner가 `TMPDIR`를 `/tmp/lophn-eval`처럼 짧은 전용 폴더로 두고(`createRun`이 `Deno.makeTempDir`을 쓰므로 그 아래에 run 폴더가 생긴다. unix socket 경로가 108자를 넘지 않게 짧아야 한다), 사람이 그 폴더에서 Claude Code를 한 번 열어 수락한다. 전역 설정을 eval이 고치지 않는다. 이 길은 permission 물음은 풀지 못한다.

기본 경로(추천, 이 brief가 구현하는 것): 아무것도 우회하지 않는다. folder trust는 사람이 전용 폴더를 미리 신뢰해 두는 것으로, permission 물음은 사람의 mode로 푼다(위 "결정" 1·2). driver는 안 풀렸을 때를 드러내기만 한다.
- **`noSessionStartMs` watchdog**(할 일 5): open 뒤 120초 안에 wrapper 기록에 `hook claude SessionStart`가 안 보이면 process를 `close`하고 `end: "no_session_start"`, `tail`에 터미널 마지막 글을 남긴다. 이유: trust 화면, login 화면, 잘못된 model flag 모두 이 모양으로 멈추고, 90분을 기다리지 않고 이유(`tail`에 "trust this folder"가 있으면 그 말)를 바로 보인다. 화면 글은 진단에만 쓰고 상태 판단에는 쓰지 않는다.
- permission 물음이 뜬 횟수는 `ec-metrics`가 wrapper 기록에서 센다(`permission_requests`). driver는 물음에 답하지 않는다.

### 결정 2: hook과 skill 설치

사실:
- `lophn harness install`이 놓는 hook command의 꼴(`packages/coding-agent/harnesses/install.ts`의 `installJsonHook`): `<command> hook claude <Event>`. `command` 입력이 없으면 `<command>`는 글자 그대로 `lophn`(PATH에서 hook이 실행될 때 찾는다)이고, 있으면 그 절대 경로다.
- 설치된 제품(packaged): shell main이 `command`를 안 준다(`hookCommand: app.isPackaged ? undefined : lophnCli`) → `lophn hook claude <Event>`. 개발 실행: `LOPHN_CLI`(절대 경로)가 있을 때만 detect·install을 부르고 그 경로를 `command`로 준다 → `<절대 경로> hook claude <Event>`.
- `dry_run`: `command`가 없으면 우리 항목이 하나라도 있으면(어느 꼴이든) `unchanged`. `command`가 있으면 그 꼴과 정확히 같지 않으면 `missing`(`ownedEntry`는 `^(lophn|/\S+) hook claude `로 우리 항목을 알아본다).
- 놓는 곳: `~/.claude/settings.json`(hook, 사람의 다른 key·hook은 보존)과 `~/.claude/skills/lophn-build-app/SKILL.md`, `lophn-repair/SKILL.md`. 이 사람은 지금 둘 다 없다(`lophn harness install --input '{"harness":"claude","dry_run":true}'`가 `missing`).
- hook은 claude process의 환경에서 실행되므로 driver가 plan env의 `PATH` 앞에 wrapper 폴더를 두면 `lophn hook ...`은 wrapper로 간다. hook은 token이 없으면(`LOPHN_CODING_TOKEN` 없음) 아무것도 안 하고 성공한다.
- 개발 컴퓨터에는 PATH에 `lophn`이 없다. 그 상태에서 `lophn` 꼴 hook을 전역에 놓으면 사람의 다른 Claude Code session마다 hook이 "command not found"로 실패한다(차단은 아니다). 절대 경로 꼴은 그 소음이 없지만 checkout 하나에 묶인다(다른 checkout의 wrapper를 쓰려면 다시 설치).
- 이 컴퓨터에서 `lophn harness detect --json`은 `{data}`로 감싸지 않고 배열을 그대로 낸다(아래 "제품에서 본 것"의 shell 불일치 참고).

선택지:
- (a) **추천. 사람이 미리 한 번 설치하고 eval은 설치하지 않는다**: eval은 `dry_run`으로 있는지만 보고 없으면 놓을 file과 사람이 칠 명령을 적고 멈춘다. `lophn` 꼴(PATH 의존)로 놓으면 wrapper가 PATH 앞에 있으므로 eval이 checkout을 고른다. 대가는 위의 "command not found" 소음이다. 절대 경로 꼴로 놓으면 소음은 없고 wrapper가 stable 경로(`binDir`)라 같은 checkout에서는 다시 설치할 일이 없다.
- (b) **eval이 trial마다 `harness install`을 돌린다**: 사람의 전역 설정을 매번 다시 쓴다. 제품은 사람에게 묻고 놓는데 eval은 묻지 않는다. 사람 몰래 `~/.claude/settings.json`을 고치지 않으려면 첫 실행에서 이 동작을 명시한 옵션(`--install-harness`)이 있어야 한다.

기본 경로(추천 (a), 개발 꼴): `install: "check"`. `prepareCodingAgent`는 `harness install --input '{"harness":"claude","dry_run":true,"command":"<hookRoot의 wrapper 절대 경로>"}'`만 부른다(`command`를 주면 dry_run이 그 꼴과 정확히 같은지 본다). `skill`이나 `hook`이 `missing`이면 던지고, 메시지에 놓일 `files`와 사람이 칠 명령 한 줄(`<hookRoot wrapper> harness install --input '{"harness":"claude","command":"<hookRoot wrapper>"}'`)을 적는다. 쓰지 않는다. 이유: 전역 hook의 command가 main checkout의 wrapper 절대 경로 하나로 고정되면 variant checkout을 돌려도 다시 설치할 일이 없고(hook은 이벤트를 core에 전할 뿐이다), wrapper가 hook 호출도 `LOPHN_EVAL_COMMAND_LOG`에 적으므로 시작 감시와 permission 물음 수가 된다. `install: "install"`(선택지 (b))은 만들지 않는다. 사람이 (b)를 고르면 planner가 이 brief에 줄을 더한다.

## 제품에서 본 것 (이 brief의 확인 항목, README "돌리기 전에 확인할 것"의 답)

- **folder trust·첫 실행 질문**: 위 "결정 1". 제품 launch plan은 넘기지 못한다. eval이 따로 넘기지 않고 제품 빈틈으로 보고한다.
- **coding agent의 model**: 제품 길은 둘이다. (1) Settings `coding-agent.default_model`(기본 null), (2) App Engineer `call`의 `options.model`. 우선순위는 options → Settings 기본(`resolveLaunch`). 둘 다 없으면 `--model`을 안 붙이고 Claude Code의 기본(이 컴퓨터에서는 Opus 5.5)이 쓰인다. 진짜 App Engineer는 `options`를 안 줄 수 있으므로 Settings 기본을 쓴다: `settingsUpdate`로 `coding-agent.default_harness = "claude"`, `coding-agent.default_model = "claude-sonnet-5-5"`. **harness 기본도 반드시 넣는다**(없으면 call에 options가 없을 때 `not_connected: no harness is chosen`). 기본값은 core가 `harnessReport`를 받는 순간 snapshot으로 쥐므로(`relay.ts` `report`) 설정을 먼저 바꾸고 보고를 한다. `claude --model claude-sonnet-5-5`는 받아들여져 배너가 "Sonnet 5.5"가 됐다(확인함). 이때 effort 기본은 medium이었다(plan에 effort flag는 없다).
- **coding token이 CLI에 닿는 길**: core `relay.ts`의 `open`이 token을 만들어 Gateway `coding_terminal` frame의 `plan.env.LOPHN_CODING_TOKEN`에 넣는다. 진짜 길에서도 같다: host가 `plan.env`를 PTY 환경에 얹고, claude와 그 자식(Bash tool의 `lophn ...`, hook)이 상속한다. CLI는 `LOPHN_CODING_TOKEN`과 daemon 주소를 환경에서 읽는다. **plan.env에는 daemon 주소가 없다.** CLI는 주소를 `--` 옵션 → `LOPHN_DAEMON_URL` → `<LOPHN_HOME>/run/location.json` → 기본 port 순으로 찾는데(`packages/coding-agent/connection/client/daemon.ts`) host가 `LOPHN_*`를 지우므로(`stripPlatformEnv`) 기본 port로 가버린다. driver가 plan.env에 `LOPHN_DAEMON_URL = core.baseUrl`을 넣는다.
- **제품에서 본 불일치(제품 빈틈 후보, 이 task가 고치지 않는다. 보고에 적는다)**: `packages/shell/main/desktop/coding-connection.ts`의 `childCliRunner`는 `lophn ... --json`의 stdout에서 `body.data`를 읽는데, CLI의 `--json`은 data를 감싸지 않고 그대로 낸다(`packages/coding-agent/cli/output.ts`의 `result`; `lophn harness detect --json`은 배열, `harness install --json`은 `{skill,hook,files}`를 낸다). 그러면 desktop의 harness 감지와 hook 등록이 `Detection gave an unknown result`로 끝날 수 있다. desktop을 띄워 확인하지는 못했다. driver는 감싸지 않은 형태로 읽는다.
- **env**: shell과 같게 만들려고 `createCodingHost().prepare`를 그대로 쓴다(`stripPlatformEnv`가 `TOKEN`·`SECRET`·`API_KEY`·`AUTH`가 든 이름, `LOPHN_*`, `ELECTRON_*`를 지운다. 그래서 `ANTHROPIC_API_KEY`나 `CLAUDE_CODE_OAUTH_TOKEN`도 안 간다. Claude Code는 사람의 로그인으로 돈다). 추가로 driver가 지울 것: Claude Code 안에서 runner를 돌리면 상속되는 중첩 표시 변수 `CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_SESSION_ATTENDED`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_EXECPATH`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_PID`, `CLAUDE_EFFORT`. 이유: `CLAUDE_CODE_CHILD_SESSION`이 있으면 Claude Code가 "Transcript saving is off"로 뜨고 session 기록을 안 써서 ec-metrics가 읽을 것이 없다(확인함). 나머지는 같은 종류라 함께 지운다(사람이 직접 건 `CLAUDE_CONFIG_DIR` 같은 설정은 지우지 않는다).
- **PTY**: `node-pty`는 `packages/shell/main/node_modules/node-pty`에 있고(linux는 `build/Release/pty.node`) Deno에서 `createRequire("<repo>/packages/shell/main/package.json")("node-pty")`로 열린다. `nodePtyAdapter()`의 기본 `load`는 `process.argv[1]` 기준이라 Deno에서는 못 찾으므로 `load`를 넘겨야 한다(`echo hi`를 PTY로 돌려 `"hi\r\n"`을 받음을 확인함). `terminal-host/main.ts`·`launch-plan.ts`·`pty.ts`와 `main/terminal/coding/requests.ts`는 Deno에서 import되고 `deno check`도 통과한다(확인함).

## 할 일

1. `tests/eval/coding/driver/wrapper.ts`: `wrapperScript(input: { deno: string; main: string }): string`, `ensureWrapper(binDir: string, root: string): Promise<string>`(`<binDir>/lophn`을 쓰고 `chmod 755`, 내용이 같으면 다시 쓰지 않는다. 경로를 돌려준다).
   - 스크립트(sh): `LOPHN_EVAL_COMMAND_LOG`가 있으면 `printf '%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" "$1" "$2" "$3" >> "$LOPHN_EVAL_COMMAND_LOG"`, 이어서 `exec <Deno.execPath()> run --allow-all --no-prompt <root>/packages/coding-agent/cli/main.ts "$@"`. 명령 시각은 이 줄이 찍는다(roadmap "단계 시간"). 기록 형식은 `ec-metrics.md`가 읽는 약속이다. 바꾸면 알린다.
   - `binDir`은 `<root>/.dev-data/eval/bin`이다(runner가 정한다). wrapper는 `root`의 CLI(`<root>/packages/coding-agent/cli/main.ts`)를 부른다. 터미널 host와 요청 처리 코드(`packages/shell/...`)는 지금 checkout의 것을 import하므로 `root`가 아니다. 이유: variant checkout은 agent가 보는 harness(CLI, skill 본문, template)를 바꾸는 것이지 eval의 터미널 몫을 바꾸는 것이 아니다.
2. `tests/eval/coding/driver/env.ts`: 순수 함수.
   - `driverEnv(inherited: Record<string, string | undefined>): Record<string, string>`: 위 중첩 표시 변수를 지운 사본(undefined 값은 뺀다). host의 `env`로 넘긴다. `stripPlatformEnv`는 host(`createCodingHost`)가 부르므로 여기서 또 부르지 않는다.
   - `evalPlan(plan: unknown, extras: { daemonUrl: string; commandLog: string; binDir: string; path: string }): unknown`: `plan.env`에 `LOPHN_DAEMON_URL`, `LOPHN_EVAL_COMMAND_LOG`, `PATH = <binDir>:<path>`를 더한 사본(plan의 다른 칸은 그대로). `plan.env`에 이미 같은 이름이 있으면 덮는다.
3. `tests/eval/coding/driver/prepare.ts`: `prepareCodingAgent`. trial 전에 한 번.
   1. `ensureWrapper(binDir, root)`와 `ensureWrapper(<hookRoot>/.dev-data/eval/bin, hookRoot)`(후자는 사람이 전역 hook에 놓는 command의 대상이다. `hookRoot`가 `root`와 같으면 하나다).
   2. 감지: wrapper로 `harness detect --json`을 `Deno.Command`로 돌려(환경은 `driverEnv`) stdout을 `JSON.parse`한다. 배열이다. 항목마다 `harnessDetectionSchema.safeParse`하고 `harness_id: "claude"`가 `discovery: "detected"`가 아니면 던진다(메시지: PATH에 claude가 없다).
   3. 설정: `core.call(settingsUpdate, { changes: [{ key: "coding-agent.default_harness", action: "set", value: "claude" }, { key: "coding-agent.default_model", action: "set", value: deps.model }] })`. `rejected`가 비어 있지 않으면 던진다. 이어서 `core.call(harnessReport, { detections: [claude 감지] })`(순서가 이래야 core의 기본값 snapshot에 model이 든다).
   4. 설치 확인(결정 2의 기본 경로): 위 "기본 경로"대로 `dry_run`에 `command`를 주어 부른다. `missing`이면 던진다. 쓰지 않는다.
   5. `claudeVersion(claude)`를 불러 `{ wrapper, claude: selected_executable, version }`을 돌려준다.
4. `tests/eval/coding/driver/host.ts`: shell의 터미널 몫을 한 프로세스 안에서 조립한다. 새 규칙을 두지 않는다.
   - `const host = hostFromNodePty({ env: driverEnv(Deno.env.toObject()), platform: process.platform, exists: existsSync, checkFolder, schedule: setImmediate, coding: createCodingHost(), pty: nodePtyAdapter(() => createRequire("<지금 checkout>/packages/shell/main/package.json")("node-pty")), onRuntime })` (`checkFolder`는 `terminal-host/cli.ts`의 것과 같게 `statSync`로 디렉터리인지 본다).
   - supervisor 어댑터(`requests.ts`가 요구하는 `Pick<Supervisor, "request" | "on" | "runtimes">`): `request(message)`는 `host.handle({ ...message, id })`의 답을 돌려주고, 답에 runtime이 있으면 `on`으로 등록된 listener의 `runtime(runtime)`에도 알린다. `onRuntime`이 부르는 runtime도 같은 listener에 알린다. `runtimes()`는 마지막 runtime 표를 돌려준다. `packages/shell/main/terminal/supervisor.ts`의 `onLine`·`refreshRuntime`과 같은 뜻으로만 쓴다(generation이 더 큰 쪽이 이긴다).
   - `createCodingTerminalRequests({ supervisor: 어댑터, focus: { whenFree: () => Promise.resolve() }, reportResult: (body) => core.call(codingTerminalResult, body), reportExited: (body) => core.call(codingTerminalExited, body), runCli: null })`. `runCli: null`이라 shell이 하던 전역 skill·hook 등록 물음은 건너뛴다(결정 2의 `prepareCodingAgent`가 맡는다). `register`·`hookCommand`는 주지 않는다.
5. `tests/eval/coding/driver/driver.ts`: `startCodingDriver`.
   - `connectGateway(core)`(`tests/support/gateway/mod.ts`)를 열고, 200ms마다 `gateway.frames()`의 새 `type: "coding_terminal"` frame을 순서대로 처리한다(`gateway.next`는 30초 상한이라 오래 기다리는 loop에 쓰지 않는다). 처리 중 오류로 loop가 죽으면 `stop()`이 그 오류를 던진다.
   - `kind: "open"` frame: 먼저 `plan = evalPlan(frame.plan, { daemonUrl: core.baseUrl, commandLog: <outDir>/commands-<session>.log, binDir, path: Deno.env.get("PATH") })`로 바꾼 frame을 `requests.handle`에 넘긴다. 이 frame의 `plan.env`에는 coding token이 있으므로 로그·오류·trace에 plan을 넣지 않는다. trace를 `{ session, app, ticket, harness: plan.harness_id, cwd: plan.cwd, command_log, opened_at: null, ... , end: null }`로 만든다. open 결과가 ok가 된 때(`reportResult` 쪽 body가 `ok: true`) `opened_at = clock.now()`. `ok: false`면 `end: "open_failed"`.
   - `kind: "input"`·`"stop"` frame: 그대로 `requests.handle`에 넘긴다(input의 붙여 넣기 구간과 CR은 `requests.ts`가 한다).
   - session마다 감시를 하나 띄운다(250ms~2s 주기, 구현은 가장 단순하게):
     a. **끝**: supervisor 어댑터가 받은 runtime이 `exited`이면 `ended_at`, `exit_code`를 쓰고 `end`가 비었으면 `exit_code === null ? "killed" : "exited"`. `unknown`이면 `host_lost`. 끝나면 `host.handle({ type: "snapshot", terminal_ref, after_seq: 0 })`의 `output[].chunk`를 이어 제어 문자(`\x1b[...` 포함)를 지운 마지막 4000자를 `tail`로 둔다(ring buffer가 가진 만큼).
     b. **완료 보고**: 2초마다 `core.call(ticketShow, { ticket })`의 `ticket.state`가 `reported` 또는 `verified`이면 `reported_at`을 한 번 찍고, 10초(Stop hook이 core에 닿을 시간) 뒤에 `host.handle({ type: "input", terminal_ref, generation, text: "/exit\r" })`로 Claude Code를 끝낸다(사람이 `/exit`을 치는 것과 같다. `exit_code` 0 → `exited`). 15초 안에 안 끝나면 `{ type: "close", ... }`(SIGHUP, 제품의 탭 닫기와 같다). 이유: roadmap은 "완료 보고 뒤에 process를 끝낸다"이고, 끝나야 core가 session을 정산하고 앱의 coding session 줄이 풀린다. 완료 보고 뒤 App Engineer가 고치라고 메시지를 보내면 session은 이미 끝났으므로 `input`은 `no_terminal`로 실패하고 App Engineer는 새 call로 새 session을 연다(제품에서 사람이 탭을 닫은 뒤와 같다).
     c. **시작 감시(결정 1의 기본)**: `opened_at` 뒤 `noSessionStartMs`가 지나도록 command log에 `\thook\tclaude\tSessionStart` 줄이 없으면 `close`하고 `end: "no_session_start"`.
     d. **상한**: `opened_at` 뒤 `timeoutMs`가 지나면 `close`하고 `end: "timeout"`.
     e. **사람이 보는 화면**(사람: coding agent의 TUI를 직접 열어 본다. log를 tail하는 것이 아니다). 아래 "사람이 붙는 길"을 session마다 하나 세운다. 화면은 사람이 보는 것뿐이다. 상태 판단에는 쓰지 않는다(`tail` 진단 외).
   - `end`는 처음 정해진 값을 덮지 않는다. `stop()`은 남은 session을 `close`(`end` 비었으면 `killed`)로 끝내고 각 process의 exit를 15초까지 기다린 뒤 `gateway.close()`한다. `active()`는 `ended_at === null`이고 `end === null`인 session 수.
   - 시각은 `clock.now()`. 시간 상한 감시는 `setTimeout`을 쓰되 `stop()`이 모두 지운다(떠 있는 timer가 test나 process를 붙잡지 않게).
### 사람이 붙는 길 (할 일 5의 e, 9~11)

- **서버(driver 안, session마다 하나)**: open이 ok가 되면 `<socketDir>/<session의 끝 12자>.sock`에 `Deno.listen({ transport: "unix", path })`를 연다(폴더는 `0700`으로 만들고, 같은 이름의 옛 file은 지운다. 경로가 100자를 넘으면 던진다). 경로를 `trace.attach_socket`에 쓰고 `deps.log(\`coding agent 화면: deno task eval:attach ${session} (키 입력은 --write)\`)`를 한 번 찍는다(runner가 사람에게 보이는 줄이다). session이 끝나면(`ended_at`) 접속을 닫고 file을 지운다. `stop()`도 같다.
- **연결 규칙**: 줄 단위 JSON. client → 서버: `{"t":"hello","write":boolean,"cols":n,"rows":n}`(첫 줄), `{"t":"resize","cols":n,"rows":n}`, `{"t":"key","data":"<입력 글>"}`. 서버 → client: `{"t":"out","data":"<chunk>"}`, `{"t":"end","reason":"<CodingEnd 또는 closed>"}`.
- **화면**: `hello`를 받으면 먼저 `host.handle({ type: "snapshot", terminal_ref, after_seq: 0 })`의 `output[].chunk`를 순서대로 `out`으로 보내 현재 화면을 그린다(ring buffer가 가진 만큼. `dropped_output`이 true면 앞에 `\r\n[eval: 앞부분이 잘렸다]\r\n`을 먼저 보낸다). 그 뒤 150ms마다 마지막으로 보낸 seq 뒤의 새 chunk만 `out`으로 보낸다. 같은 session에 여러 client가 붙어도 각자 seq를 따로 쥔다. session이 끝나면 `end`를 보내고 닫는다.
- **크기**: `hello`와 `resize`의 `cols`·`rows`로 `host.handle({ type: "resize", terminal_ref, generation, columns, rows })`를 부른다(desktop 탭이 크기를 보내는 것과 같다. 처음 open은 `requests.ts`의 80×24다). 보기만 하는 client도 크기를 보낸다.
- **읽기 전용이 기본이다**: `write: false`인 client의 `key`는 버린다. `write: true`일 때만 `key.data`를 `host.handle({ type: "input", terminal_ref, generation, text })`로 PTY에 넣는다. 처음으로 키가 들어가면 `trace.human_input = true`로 두고(되돌리지 않는다) `deps.log("사람이 coding agent에 키를 넣었다: <session>")`를 찍는다.
- **App Engineer의 input은 사람 입력을 기다린다**: `createFocusGate()`(순수, 아래)를 `createCodingTerminalRequests`의 `focus`로 준다(`focus.whenFree(terminalRef)`는 `requests.ts`가 `input` frame마다 부른다. 제품에서는 사람이 그 탭에 focus해 있는 동안 쥐는 규칙이다). `write: true` client가 붙어 있는 동안 그 `terminalRef`는 쥔 것이고, 모두 떨어지면(접속이 닫히거나 session이 끝나면) 푼다. driver 자신의 `/exit`·`close`는 이 gate를 거치지 않는다.
- **`createFocusGate()`**: `{ hold(ref): () => void; whenFree(ref): Promise<void> }`. `hold`는 쥐고 푸는 함수를 돌려준다(같은 ref에 여러 번 쥐면 센다). `whenFree`는 쥔 게 없으면 바로, 있으면 모두 풀릴 때 풀린다.
- **client(`attach.ts`, `import.meta.main`일 때만 돈다)**: `deno task eval:attach [session] [--write]`. `session`은 id의 일부여도 된다(socket 이름과 끝이 맞는 것). 없으면 `<socketDir>`에서 가장 최근에 만든 socket을 쓴다. socket이 없거나 연결이 안 되면 이유 한 줄과 함께 종료 코드 1이다. stdin이 터미널(`Deno.stdin.isTerminal()`)이 아니면 던진다. 순서: 연결 → `Deno.stdin.setRaw(true)` → `hello`(크기는 `Deno.consoleSize()`) → `out`을 stdout에 그대로 쓴다. `SIGWINCH`마다 `resize`를 보낸다. stdin 입력: `0x1d`(Ctrl-])가 오면 detach(raw 모드를 풀고 종료 코드 0). 그 밖은 `--write`일 때만 `key`로 보내고 읽기 전용이면 버린다(Ctrl-C도 PTY에 닿지 않는다). 시작 전에 stderr에 한 줄(`읽기 전용. Ctrl-]로 나간다` / `키를 coding agent에 넣는다(--write). Ctrl-]로 나간다`)을 찍는다. 서버가 `end`를 보내면 raw 모드를 풀고 그 이유를 찍고 끝낸다. 어떤 경우든 `finally`에서 raw 모드를 푼다.
- 이유: 사람이 token이 든 plan이나 로그가 아니라 Claude Code의 화면을 그대로 보고(trust 화면이 뜨면 `--write`로 한 번 답할 수도 있다), 제품의 "사람이 탭에 있으면 App Engineer의 입력이 기다린다" 규칙을 같게 지킨다. 화면 글은 사람에게만 가고 상태 판단에 쓰지 않는다.

6. `tests/eval/coding/driver/mod.ts`: 위 export를 다시 내보낸다.
7. `tests/eval/coding/driver/env_test.ts`: 위험 test(아래).
8. `tests/eval/coding/driver/focus.ts`: `createFocusGate`. `tests/eval/coding/driver/screen.ts`: 서버("사람이 붙는 길"). driver.ts가 session마다 부른다.
10. `tests/eval/coding/driver/attach.ts`: client. `focus_test.ts`: 위험 test(아래).
11. `host.ts`의 `createCodingTerminalRequests` 조립에서 `focus: { whenFree: () => Promise.resolve() }`를 `focus: gate`로 바꾼다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test 둘:
  1. (`focus_test.ts`) "`createFocusGate`는 쥔 동안 `whenFree`가 풀리지 않고, 모두 풀면 풀린다." (순수 test. 풀리지 않으면 App Engineer의 입력이 사람 키 입력과 섞여 TUI가 망가진다. 제품 규칙을 같게 지키는 곳이다.)
  2. (`env_test.ts`) "`driverEnv`가 중첩 표시 변수(`CLAUDE_CODE_CHILD_SESSION` 등)를 지우고 다른 변수는 그대로 두며, `evalPlan`이 `plan.env`의 `LOPHN_CODING_TOKEN`을 지우거나 바꾸지 않고 `LOPHN_DAEMON_URL`·`LOPHN_EVAL_COMMAND_LOG`·`PATH`(앞에 `binDir`)만 더한다." (순수 함수 test. PTY·process·socket·network를 쓰지 않는다. 전자가 틀리면 Claude Code가 기록을 안 써서 수치가 비고, 후자가 틀리면 CLI가 core에 못 닿는다.)
- PTY·socket·Claude Code를 띄우는 test는 만들지 않는다. 대신 임시 script(scratchpad, commit 안 함)로 `prepareCodingAgent` 앞부분(감지·설정·install 확인)을 `bootCore`+fake로 한 번 돌려 본다. 진짜 Claude Code를 띄우는 확인은 lead가 하는 첫 run에서 한다(실제 model 호출이라 사람에게 묻는다).
- 남지 않음: `terminal-<session>.log`·`live-terminal.log`·`tail -F`·`screen_log`는 만들지 않는다. 새 file만 만들었다. `packages/`·`tests/support/`는 고치지 않았다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `deno.json`의 task `eval:attach`(`deno run --allow-all tests/eval/coding/driver/attach.ts`)를 lead가 더한다. `deno task check`의 import 경계(`tools/check-deps.ts`)가 `tests/eval`에서 `packages/shell`을 import하는 것을 거절하면 그 규칙과 파일을 적는다(고치지 않는다)
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청
- 결정 대기: 추천과 다른 선택이 brief에 적혀 있어 구현했는지, 아니면 건너뛴 것
- 제품과 다른 점: driver가 제품 길과 다르게 한 것(없으면 "없음")
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음". 진짜 Claude Code로는 확인하지 못했다는 것을 적는다.
