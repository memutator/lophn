# turn 끝 신호 조사: Hermes TUI와 OpenClaw TUI (2026-10-15)

조사 항목 R8(`research-items.md`). 질문: 터미널에서 TUI로 띄운 Hermes와 OpenClaw가 turn이 끝났음(다음 입력을 기다림)을 hook, plugin 같은 장치로 바깥 program에 알릴 수 있나. 알린다면 이름, 넘기는 내용, 설정 위치(project 폴더 안에 둘 수 있나), session 시작과 process 끝도 알리나.

- Hermes: github.com/NousResearch/hermes-agent @ `decf1921`(2026-10-11). 사용자 설치본 `/home/pyosechang/.hermes/hermes-agent`를 읽었다(`git log -1`로 hash 확인). 아래 경로는 이 repo 안 경로다. 앞선 조사(`events-hermes-goose-amp-acp.md`)는 `63d0b941`을 봤다.
- OpenClaw: github.com/openclaw/openclaw @ `86380bba`(2026-10-15), `package.json` version `2026.10.3`. 받아 둔 사본에는 `src/`만 있어서 docs를 보려고 `repos/r8/openclaw/`에 `--depth 1`로 새로 받았다. 아래 경로는 이 repo 안 경로다. 앞선 조사(`sandbox-openclaw.md`)는 `e085c3fb`를 봤다.
- 받은 repo와 설치본은 읽기만 했다. 아무것도 실행하지 않았다. 그래서 "실제로 fire되는지"는 code와 문서를 읽고 판단한 것이고 눈으로 확인한 것은 아니다.
- 이미 아는 것(인용만): Hermes `agent:end`는 메신저 gateway 전용 hook이라 CLI·TUI에서 안 돈다(`events-hermes-goose-amp-acp.md` 1장, `hooks.md` "Gateway Event Hooks"). OpenClaw는 event를 조사한 적이 없었다.

## 한 줄 결론

- **Hermes TUI: 된다.** `config.yaml`의 `hooks:` 블록에 shell script를 걸면 turn마다 `on_session_end`(turn 끝)가 JSON으로 stdin에 온다. TUI(`hermes --tui`)에서도 등록된다. 설정은 사용자 전역(`$HERMES_HOME/config.yaml`)뿐이고 project 폴더에 둘 수 없다.
- **OpenClaw TUI: 바깥 program으로 알리는 설정 장치는 없다. TypeScript plugin을 직접 만들어 `agent_end`를 받아야 한다.** `command` 같은 설정으로 script를 거는 길은 없고, internal hook(`HOOK.md`)에는 turn 끝 event가 없다. plugin은 Gateway(또는 local 모드면 TUI) process 안에서 도는 code이고 설정은 `~/.openclaw/openclaw.json`이다.
- 둘 다 session 시작 신호는 "process를 띄운 때"가 아니라 첫 prompt 때다. process 끝은 어느 쪽도 믿을 만한 hook이 없어서 lophn이 PTY의 exit으로 알아야 한다.

## 1. Hermes

### 1-1. 통로 네 가지 중 TUI에서 도는 것

`website/docs/user-guide/features/hooks.md`(첫머리 표, 1785줄 "Shell Hooks" 이하)와 code로 확인했다.

| 통로 | TUI에서 도나 | 근거 |
|---|---|---|
| gateway hook (`~/.hermes/hooks/*/HOOK.yaml`) | 아니오. `agent:end`는 여기 있다. "The CLI, TUI, Desktop and cron never load gateway hooks" | hooks.md:28, 368 |
| plugin hook (`ctx.register_hook`, Python) | 예. CLI + gateway. 단 plugin을 켜야 한다 | hooks.md:371-, `hermes_cli/plugins.py:109-` `VALID_HOOKS` |
| **shell hook** (`config.yaml`의 `hooks:`) | **예.** TUI는 agent를 만들 때마다 `register_from_config(cfg)`를 부른다 | `tui_gateway/server.py:2675-2676`, 문서 hooks.md:1787 "CLI, gateway, Desktop, TUI, and dashboard chat" |
| outbound webhook (`hooks.outbound:`) | **TUI에서는 등록 호출을 못 찾았다.** `register_outbound_webhooks`는 `cli.py:466-471`(classic CLI)과 `gateway/run_startup.py:1113-1116`에만 있다. 문서도 "CLI + Gateway"라고 적는다 | hooks.md:16, 위 두 파일 |

`hermes --tui`는 Ink(Node) 화면이 `python -m tui_gateway.entry`를 자식 process로 띄우는 구조다(`ui-tui/src/gatewayClient.ts:455`). hook은 그 python 쪽에서 돈다. classic CLI(`hermes --cli`)도 같은 shell hook을 쓴다(`cli.py:465-470`).

### 1-2. turn 끝: `on_session_end`

이름에 속으면 안 된다. 문서가 직접 적는다: "Despite its name this hook fires after **every turn**" (hooks.md:969). session 끝이 아니라 turn 끝이다.

| 항목 | 내용 | 근거 |
|---|---|---|
| fire 지점 | `run_conversation()`이 끝날 때마다 한 번. 성공, 오류, 중단 상관없이 fire | `agent/turn_finalizer.py:795-808`, 문서 hooks.md:946-, 표(`on_session_end`: "Canonically at each turn finalization") |
| 안 도는 경우 | `agent._persist_disabled`인 agent(parent session ID로 publish하면 안 되는 detached fork 같은 내부 작업) | `turn_finalizer.py:795` |
| payload (canonical) | `session_id`, `task_id`, `turn_id`, `completed`(최종 답을 냈나), `failed`, `interrupted`, `turn_exit_reason`, `model`, `platform`. message 본문 없음 | `turn_finalizer.py:797-807`, hooks.md 표 |
| 구별해야 할 것 | TUI/CLI를 끝낼 때도 같은 이름으로 한 번 더 fire된다. 이때는 `completed=False, interrupted=True`이고 `turn_id`, `turn_exit_reason`이 없다. turn 끝으로 세면 안 된다 | `tui_gateway/session_lifecycle.py:386-392`(agent가 있으면 mid-turn 여부와 상관없이 부른다), `cli_shutdown.py:186-190`, hooks.md 표 "exit paths may add `reason`/`api_request_id` and omit fields" |

보조 신호:

- `post_llm_call`: 성공했고 중단되지 않은 turn만 fire한다(`turn_finalizer.py:455-474`). payload에 `conversation_history` 전체와 `assistant_response`가 들어 있어서(hooks.md 표) 무겁고 민감하다. idle 신호로는 `on_session_end`가 낫다.
- turn 시작: `pre_llm_call`(turn마다 한 번, `is_first_turn` 포함). shell hook이 stdout으로 `{"context": ...}`를 돌려주면 user message에 붙는다(hooks.md:1971-1991).
- 사람 입력 대기: `on_human_input_request`(`kind`: `sudo`, `clarify`, `approval`)와 `on_human_input_resolved`(`outcome`)가 CLI, Ink TUI/Desktop, ACP에서 fire된다(hooks.md 표). agent가 사람을 기다리느라 turn이 안 끝난 상태를 구별할 수 있다. approval 조사(`approval-hermes.md`)의 `pre_approval_request`와 같은 계열이다.

### 1-3. 넘기는 내용 (shell hook의 wire)

`hooks.md:1832-1880`, `agent/shell_hooks.py:79-94`(`_payload_fields`), `:450-452`(`_serialize_payload`).

stdin으로 JSON 한 개. 이 칸들이다.

```json
{
  "hook_event_name": "on_session_end",
  "tool_name": null,
  "tool_input": null,
  "session_id": "sess_abc123",
  "cwd": "/home/user/project",
  "profile": "default",
  "extra": {"task_id": "...", "turn_id": "...", "completed": true, "failed": false,
            "interrupted": false, "turn_exit_reason": "...", "model": "...", "platform": "tui"}
}
```

- `cwd`는 hook을 부른 process의 `Path.cwd()`다. TUI를 띄운 폴더(`--in ./my-project` 같은 옵션이 있으면 그것)와 같을 것으로 읽었다. 확인하지는 못했다.
- stdout은 선택이다. `on_session_end` 같은 observer는 응답을 무시한다. 실패, 시간 초과(기본 60초, 최대 300초)는 fail-open이다(hooks.md:1821, 1879, 1899-1901).
- hook script는 process env를 그대로 이어받는다. 단일 profile이면 `build_subprocess_env(scrub_secrets=is_multiplex_active())`가 scrub 없이 env를 넘긴다(`shell_hooks.py:331-341`, `tools/environments/local.py:350-383`). 그래서 lophn이 PTY를 띄울 때 `LOPHN_*` 변수를 넣으면 script가 읽을 수 있다고 읽었다. 실행해 보지는 못했다.

### 1-4. session 시작과 process 끝

| 신호 | 언제 | 내용 | 근거 |
|---|---|---|---|
| `on_session_start` | **새 session의 첫 turn**, system prompt를 만든 뒤 tool loop 전. `--resume`한 session이나 두 번째 메시지에서는 안 fire. process를 띄운 때가 아니다 | `session_id`, `model`, `platform` | hooks.md:905-944, 표 |
| `on_session_reset` | TUI에서 `/new` 같은 session 경계 | TUI는 `session_id`, `platform` | hooks.md:1058-1086 |
| `on_session_finalize` | TUI/CLI/gateway가 session을 닫을 때. TUI를 끝낼 때 `_finalize_session`이 부른다. `hermes -z` 한 번 실행도 끝에 부른다 | `session_id`(None일 수 있음), `platform` | hooks.md:1014-1056, `session_lifecycle.py:399` |
| `agent_loop_stopped` | TUI에서 `session.interrupt`로 진행 중인 turn을 끊었을 때 | `session_key`, `platform`, `reason`, `invalidation_reason` | hooks.md:1088-1113 |

process 끝은 `on_session_finalize`가 가장 가깝다. 단 SIGKILL이나 crash에서는 못 부른다. TUI가 `tui_shutdown` 경로로 `_finalize_session`을 부르는 것은 읽었다(`tui_gateway/server.py:402`, `session_lifecycle.py:60`). 실제로 종료 시 몇 ms 안에 도는지는 확인 못함.

### 1-5. 설정 위치

| 항목 | 내용 | 근거 |
|---|---|---|
| shell hook 설정 | `$HERMES_HOME/config.yaml`의 `hooks:` 블록. 기본 `~/.hermes/config.yaml`. profile마다 따로. **project 폴더 안 설정은 없다.** 설정 우선순위 문서에도 CLI 인자, `~/.hermes/config.yaml`, `~/.hermes/.env`, 기본값뿐이다 | `hermes_cli/config.py:436-438`(`get_config_path`), `hermes_constants.py:111-118`, `website/docs/user-guide/configuration.md:57-63` |
| 설정 위치 바꾸기 | 환경 변수 `HERMES_HOME`. lophn이 hook용 config만 든 별도 home을 PTY env에 줄 수 있다. 그러면 사용자의 key, session DB, skill도 그 home 기준이 되므로 그대로 쓸 수는 없다(복사·symlink 필요). 시험하지 못했다 | `hermes_constants.py:111-118` |
| script 위치 | 관례 `~/.hermes/agent-hooks/`. 경로는 `shlex.split`, `shell=False`로 실행된다. project 안 script를 가리켜도 된다 | hooks.md:1800-1830 |
| 동의(consent) | `(event, command)` 쌍마다 처음 한 번 TTY 물음. 결과는 `~/.hermes/shell-hooks-allowlist.json`. TTY가 없으면 `--accept-hooks`, 환경 변수 `HERMES_ACCEPT_HOOKS=1`, `hooks_auto_accept: true` 중 하나가 필요하다. 없으면 hook이 **조용히 등록 안 된다**. TUI는 `register_from_config(cfg)`를 `accept_hooks` 없이 부르므로(`tui_gateway/server.py:2676`) env 변수나 config 값이나 allowlist 파일이 필요하다 | hooks.md:2009-2037, `shell_hooks.py:622-627`, `:163-167` |
| 막는 장치 | `HERMES_SAFE_MODE=1`이면 등록 안 함. managed scope(시스템 관리자 설정)가 같은 key를 고정할 수 있다 | `shell_hooks.py:147-149`, `managed-scope.md` |
| plugin hook | `~/.hermes/plugins/<name>/`(user), `./.hermes/plugins/<name>/`(project)에 둘 수 있다. project plugin은 `HERMES_ENABLE_PROJECT_PLUGINS=true`가 있어야 읽고(`plugins_discovery.py:212`), 제3자 plugin은 `plugins.enabled`에 올려야 켜진다(`plugins.md:265-267`). project 쪽 plugin이 `plugins.enabled`도 요구하는지는 확인 못함 | `plugins.md:93, 128-129`, `hermes_cli/plugins_discovery.py:212` |

### 1-6. 근처 대안: terminal bell과 OSC

hook이 아니라 TTY 출력이지만 화면 글자를 읽는 것은 아니다. `display.bell_on_complete: true`(기본 false, `hermes_cli/config_defaults.py:851`)를 켜면 turn이 끝날 때 신호를 낸다.

- Ink TUI: BEL(`\x07`) 하나만 쓴다(`ui-tui/src/app/createGatewayEventHandler.ts:1564-1565`). session ID나 결과는 없다.
- classic CLI: BEL에 더해 OSC 9 알림과, Warp 안이면 OSC 777 `warp://cli-agent`(`stop`/`permission_request`, JSON에 `session_id`, `cwd`, 응답 200자)를 쓴다(`hermes_cli/cli_modal_mixin.py:559-565`, `hermes_cli/terminal_notify.py:43-72`, `configuration.md:2198-2203`).

이쪽은 JSON을 받을 수 있는 shell hook이 있으니 쓸 이유가 약하다. BEL은 hook을 못 거는 상황의 마지막 수단일 뿐이다.

## 2. OpenClaw

### 2-1. TUI가 두 가지다

`docs/web/tui.md`, `docs/cli/tui.md`.

- Gateway 모드(`openclaw tui`): Gateway process(데몬)가 agent를 돌리고 TUI는 WebSocket client다. hook과 plugin은 **Gateway process 안에서** 돈다. TUI process가 아니다.
- local 모드(`openclaw chat`, `openclaw tui --local`): Gateway 없이 TUI process 안에서 embedded agent runtime이 돈다("Local mode uses the embedded agent runtime directly. Most local tools work, but Gateway-only features are unavailable", `docs/web/tui.md:47`). `src/tui/embedded-backend.ts:1298`이 `agentCommandFromIngress`로 agent를 돌리고, `embedded-history-runtime.ts`가 runtime plugin registry를 미리 올린다. plugin hook이 local 모드에서 실제로 fire되는지는 `initializeGlobalHookRunner` 호출이 registry 활성화 조건 안에 있어서(`src/plugins/loader-shared.ts:418-430`) code만으로 **확정하지 못했다**.

### 2-2. 통로 세 가지와 turn 끝

`docs/plugins/hooks.md` 첫머리 표, `docs/automation/hooks.md`, `docs/gateway/config-hooks.md`.

| 통로 | 무엇 | turn 끝 | 근거 |
|---|---|---|---|
| internal hook (`HOOK.md` + handler) | Gateway 안 JS/TS handler. event는 `command:new/reset/stop`, `session:auto-reset`, `session:compact:*`, `session:patch`, `agent:bootstrap`, `gateway:startup/shutdown/pre-restart`, `message:received/transcribed/preprocessed/sent` | **없다.** 문서가 "`command:stop`... is not a natural agent-finalization gate"라고 적는다 | `docs/automation/hooks/event-types.md` 표와 아래 문단 |
| **typed plugin hook** (`api.on("agent_end", ...)`) | native plugin(TypeScript)이 Gateway process 안에서 받는 observer | **`agent_end`** | `docs/plugins/hooks/reference.md:132`(`agent_end`: Observe), `docs/plugins/hooks.md` 전체 |
| HTTP webhook (`hooks.enabled`, `hooks.path`) | 바깥 service가 **Gateway에 요청을 보내는** 입력 쪽 ingress. 바깥으로 알리는 길이 아니다 | 해당 없음 | `docs/gateway/config-hooks.md:24-38`, `docs/plugins/hooks.md` 첫머리 표 |

그 밖에 `docs/plugins/hooks.md`는 "Export telemetry"를 diagnostic events(OpenTelemetry, `logging.md#diagnostics-and-opentelemetry`)로 가리킨다. 이 경로는 읽지 못했다(확인 못함).

### 2-3. `agent_end`

| 항목 | 내용 | 근거 |
|---|---|---|
| 종류 | Observe(반환값 무시). 이름으로 여러 handler가 동시에 돈다 | `reference.md:23-37` 표, `:132` |
| event 칸 | `runId?`, `messages`(unknown[]), `success`(boolean), `error?`, `durationMs?` | `src/plugins/hook-types.ts:301-307` |
| ctx 칸 | `runId`, `jobId`, `agentId`, `sessionKey`, `sessionId`, `workspaceDir`, `trigger`(`user`/`cron`/`heartbeat` 등), `channel`, `modelProviderId`, `modelId` 등. 모두 optional | `src/plugins/hook-agent-context.types.ts:26-60` |
| 성공·실패·중단 | 중단해도 fire. `success: !aborted && !promptError`, 중단은 `error` 없음 | `src/agents/embedded-agent-runner/run/attempt-finalize.ts:315-335` |
| fire 지점 | embedded runner가 한 attempt를 끝낼 때 `runAgentEndSideEffectsAsync` | 같은 파일 `:328`, `src/agents/harness/lifecycle-hook-helpers.ts:74-85` |
| 시간 | handler당 기본 30초 timeout. 시간이 넘어도 handler는 취소되지 않는다. 채널 쪽은 fire-and-forget, local one-shot은 기다린다 | `reference.md:95`, `prompt-and-session.md:274-281` |
| 권한 | 비번들 plugin은 `plugins.entries.<id>.hooks.allowConversationAccess: true`가 있어야 `agent_end`를 받는다(message 본문이 들어 있어서) | `docs/plugins/hooks.md:126-130` |
| 주의 | 사람 turn만 오는 게 아니다. cron, heartbeat, subagent 등 모든 agent run이 fire한다. `ctx.trigger`와 `ctx.sessionKey`로 걸러야 한다. 한 사람 turn이 retry 등으로 attempt 여러 개일 수 있는지는 확인 못함(event에 `willRetry` 같은 칸은 없다) | `hook-agent-context.types.ts`, `docs/plugins/hooks/prompt-and-session.md:195-215` |

### 2-4. 바깥 program으로 알리기

OpenClaw가 직접 `command`나 `notify` 같은 설정으로 script를 걸어 주는 장치는 못 찾았다(docs에서 `notify` 계열 grep: node 알림 CLI와 channel 문서뿐). 대신 plugin은 임의의 Node code라서 `agent_end` handler 안에서 파일을 쓰거나 local socket·HTTP로 보내면 된다. 즉 **lophn이 작은 plugin을 만들어 설치해야 한다.** plugin은 Gateway(local 모드면 TUI) process 권한으로 도는 신뢰 code다("Internal hooks are trusted code, not sandboxed scripts", "native plugins run in the Gateway process", `docs/automation/hooks.md`, `docs/plugins/hooks.md`).

plugin 최소 구성(`docs/plugins/hooks.md` Quick start): `package.json`(`openclaw.extensions`), `openclaw.plugin.json`(id, `activation.onStartup`, `configSchema`), `index.ts`(`definePluginEntry`, `register(api)`에서 `api.on(...)`). 설치는 `openclaw plugins install --link ./dir --force`와 `openclaw plugins enable <id>`, 그리고 `allowConversationAccess` 설정.

### 2-5. session 시작과 끝

| 신호 | 언제 | 칸 | 근거 |
|---|---|---|---|
| `session_start` | 새 session(conversation) 생성. `/new`, `/reset`, idle·daily reset 뒤 새 session 등. 기존 session key에 TUI가 다시 붙을 때는 fire한다는 근거를 못 찾았다 | `sessionId`, `sessionKey?`, `resumedFrom?` | `hook-types.ts:612-616`, `reference.md:188, 198-199`, `src/gateway/session-lifecycle-plugin-hooks.ts:120-150` |
| `session_end` | **session**이 끝날 때. `reason`: `new`, `reset`, `idle`, `daily`, `compaction`, `deleted`, `shutdown`, `restart`, `unknown`. TUI를 끄는 것으로는 안 fire한다 | `sessionId`, `sessionKey?`, `messageCount`, `durationMs?`, `reason?`, `sessionFile?`, `nextSessionId?` | `hook-types.ts:629-639`, `reference.md:198-200` |
| `gateway_start` / `gateway_stop` | Gateway process 시작·끝. Gateway 모드에서 TUI와 무관한 daemon의 생명주기다. 종료 때 `session_end` drain 예산이 전체 2초 | (칸 생략) | `reference.md:97, 231, 251`, `src/plugins/hooks.ts:98` |

TUI process 자체의 종료를 알리는 hook은 없다. Gateway 모드에서는 TUI를 꺼도 session과 Gateway가 남는다.

### 2-6. 설정 위치

| 항목 | 내용 | 근거 |
|---|---|---|
| 주 설정 파일 | `~/.openclaw/openclaw.json`(JSON5). `OPENCLAW_CONFIG_PATH`로 파일 경로를, `OPENCLAW_STATE_DIR`로 state 디렉터리를 바꾼다 | `docs/gateway/configuration.md:10`, `docs/help/environment.md:40-41` |
| plugin 켜기 | `plugins.entries.<id>`, `plugins.allow`/`deny`, `plugins.load.paths`(local 경로 추가) | `docs/tools/plugin.md:195-210` |
| project 폴더 | OpenClaw에는 "project 설정" 개념이 없다. 있는 것은 agent workspace(`agents.defaults.workspace`, 기본 `~/.openclaw/workspace`)다. workspace의 `hooks/`(internal hook)와 workspace-origin plugin은 둘 수 있지만 **기본 꺼짐이고 명시적으로 켜야** 한다. 그리고 internal hook에는 turn 끝 event가 없다 | `docs/automation/hooks/configuration.md:93`, `docs/tools/plugin.md:209`, `docs/gateway/configuration.md:38` |
| 격리 | lophn이 PTY env에 `OPENCLAW_CONFIG_PATH`와 `OPENCLAW_STATE_DIR`을 주면 plugin이 든 별도 config와 state로 띄울 수 있다. 시험하지 못했다 | `environment.md:40-41, 70` |
| 동기화 | `hooks list/info/check`는 선택된 Gateway의 inventory를 본다. `plugins enable`은 local config를 고친다. Gateway가 다른 host면 거기서 해야 한다 | `docs/automation/hooks.md` "Local, remote, and agent scope"(`docs/automation/hooks.md:97`) |

### 2-7. 근처 대안: Gateway protocol client (Gateway 모드에서만)

TUI가 Gateway 모드이면 Gateway는 연결된 모든 client에 `chat` event(`state`: `delta`, `final`, `aborted`, `error`)와 `agent` event(lifecycle, tool, usage 등)를 보낸다. lophn이 두 번째 operator client로 붙어 같은 session key를 구독하면 turn 끝(`chat` final·aborted·error)을 plugin 없이 받을 수 있다. 근거: `docs/gateway/protocol/rpc-bootstrap-and-events.md:165-`("Common event families"), `docs/gateway/clients.md`(npm `@openclaw/gateway-client`), `docs/gateway/external-apps.md`. 단 token 인증과 device pairing, 구독 권한이 필요하고(`docs/cli/tui.md` Notes), `--session <key>`로 lophn이 session key를 정해 줘야 구별된다. local 모드(`openclaw chat`)에는 Gateway가 없어서 안 된다. 이 경로는 문서만 읽었고 `chat` final event의 정확한 칸은 읽지 못했다(확인 못함).

## 3. 표

| 제품 | turn 끝 | session 시작 | 끝 | 설정 위치 | 근거 |
|---|---|---|---|---|---|
| Hermes TUI (`hermes --tui`) | **있다.** shell hook `on_session_end`(turn마다. stdin JSON: `session_id`, `cwd`, `extra.turn_id/completed/failed/interrupted/turn_exit_reason`). exit 때 `interrupted=True`로 한 번 더 오는 것과 구별해야 한다 | `on_session_start`: 새 session의 **첫 turn**에서만. process 시작 때는 아님 | `on_session_finalize`(session 닫을 때, TUI 종료 포함). SIGKILL은 못 잡음 | 사용자 전역 `$HERMES_HOME/config.yaml`(`~/.hermes/`)의 `hooks:`. project 폴더 안은 불가. TTY 없으면 `HERMES_ACCEPT_HOOKS=1`로 consent 우회 | `hooks.md:1785-2060`, `turn_finalizer.py:797`, `tui_gateway/server.py:2675`, `session_lifecycle.py:386-399`, `config.py:436` |
| OpenClaw TUI Gateway 모드 (`openclaw tui`) | 설정으로 거는 장치 없음. **TypeScript plugin의 `agent_end`**(event: `success`, `error`, `durationMs`, `messages`. ctx: `sessionKey`, `trigger`). 대안: Gateway protocol client로 `chat` final 구독 | `session_start`(새 conversation. 붙을 때마다는 아님) | TUI 종료 hook 없음. `session_end`는 session 끝(`reset` 등), `gateway_stop`은 daemon 끝 | `~/.openclaw/openclaw.json`(`OPENCLAW_CONFIG_PATH`로 변경). project 개념 없음. workspace plugin은 기본 꺼짐 | `hook-types.ts:301`, `reference.md:132, 188`, `attempt-finalize.ts:328`, `docs/plugins/hooks.md:126`, `docs/gateway/configuration.md:10` |
| OpenClaw TUI local 모드 (`openclaw chat`) | 같은 plugin `agent_end`가 돌 것으로 보이나 **fire 여부 확인 못함**(`loader-shared.ts:430`의 활성화 조건). Gateway protocol 대안은 불가 | 위와 같음 | process 끝은 PTY exit으로 | 위와 같음 | `docs/web/tui.md:47`, `embedded-backend.ts:1298`, `embedded-history-runtime.ts` |

## 4. lophn에 주는 뜻

- **Hermes: 지원 대상으로 둘 수 있다.** turn 끝 신호가 hook으로 있고 payload가 JSON이다. 걸림돌은 두 가지다. (1) 설정이 사용자 전역이라 project 폴더에 둘 수 없다. lophn이 `~/.hermes/config.yaml`을 고치거나 `HERMES_HOME`을 따로 줘야 한다. 사용자의 전역 설정을 고치는 것이므로 사람에게 보이고 동의받는 단계가 필요하다. (2) TTY 없는 TUI는 consent 때문에 hook이 조용히 등록 안 될 수 있다. PTY env에 `HERMES_ACCEPT_HOOKS=1`을 넣으면 된다고 읽었다(시험 필요). 이름이 `on_session_end`여도 turn 끝이다. 종료 때 같은 이름이 `interrupted=True`로 한 번 더 오니 `turn_id` 유무로 구별한다.
- **OpenClaw: 설정만으로는 안 되고 lophn이 plugin을 만들어 설치해야 한다.** `agent_end`가 turn 끝이지만 cron·heartbeat·subagent run도 fire해서 `trigger`와 `sessionKey`를 걸러야 한다. 이를 위해 lophn이 `openclaw tui --session <key>`로 session key를 정하면 PTY와 짝을 지을 수 있다. 사용자 전역 `openclaw.json`을 고치거나(`OPENCLAW_CONFIG_PATH` 격리 가능) 별도 state로 띄워야 한다. 요구(req-1050)가 OpenClaw를 지원 대상으로 꼽는다면 이 비용을 감수할지 정해야 한다. 비용이 크면 신호 없는 harness로 두고 첫 prompt만 넣는다(S6 2장 1).
- **session 시작과 process 끝은 둘 다 믿지 않는다.** 둘 다 "process를 띄운 때"의 신호가 없고(Hermes는 첫 turn, OpenClaw는 새 conversation), 종료 hook도 TUI process 기준이 아니다. process 끝은 lophn이 PTY exit으로 안다.

## 5. 확인 못한 것

- 두 제품 모두 실제 실행으로 hook이 fire되는지 보지 못했다(실행 금지).
- Hermes shell hook의 `cwd`가 TUI의 `--in` 폴더를 따르는지, `LOPHN_*` env가 hook script까지 오는지(single-profile이면 scrub 없음으로 읽음).
- Hermes project plugin이 `plugins.enabled` 없이 켜지는지.
- OpenClaw local 모드에서 plugin hook이 fire되는지. Gateway 모드에서 `agent_end`가 사람 turn당 정확히 한 번인지(retry, queue 합치기).
- OpenClaw `session_start`가 기존 session key에 TUI를 다시 붙일 때 fire되는지. diagnostic events(OpenTelemetry) 경로. Gateway protocol `chat` final event의 정확한 payload 칸.
