---
type: research
concerns: [coding-agent/sessions]
---
# coding agent TUI session launch

## 질문

사람이 ticket의 [Start]를 눌렀을 때 Electron + node-pty가 어떤 executable·argv·cwd·env로 TUI를 시작하고 첫 prompt를 한 번만 전달할 수 있나?
trust와 permission을 대신 결정하지 않으면서 native session identity와 상태 evidence를 어떻게 해당 terminal generation에 묶나?
실패·stale·앱 재시작과 resume를 어디서 구별해야 하나?

## 프로젝트별

조사일: 2026-10-04. 아래 경로와 줄 범위는 각 저장소의 해당 revision 기준이다. [확인]은 source 사실, [문서]는 공식 문서, [미확인]은 이번 조사에서 확인하지 못한 것이며 기능 부재를 뜻하지 않는다. [제안]은 아직 구현하지 않은 lophn 선택이다. 실제 harness를 PTY에서 실행한 호환성 테스트는 하지 않았다. source revision만으로 배포 CLI의 version·OS 호환성을 보증하지 않는다.

기존 `coding-agent-harness-integration.md`의 1.5·2.5·3.2에서 launch/resume/native ID의 기본 모양을 먼저 읽었다. 여기서는 같은 catalog 표를 반복하기보다 prompt submit의 실제 gate, trust writer, event 전달·인증, restore와 executor lifecycle을 추가한다. SDK/app-server/ACP/HTTP와 TUI PTY를 같은 adapter로 보지 않는다.

### Orca (fd030c404074f1100e5eedab59aec3dac7e6d1f5)

저장소: <https://github.com/stablyai/orca>.

#### launch plan과 PTY

- [확인] `AgentStartupPlan`은 `launchCommand: string`, `expectedProcess`, `followupPrompt: string | null`, `launchConfig`, optional `launchToken/draftPrompt/env/startupCommandDelivery`다. `buildAgentStartupPlan`은 prompt를 trim하고 빈 prompt·잘못된 command를 거절한다. `argv` mode는 **quoted shell command 문자열**에 positional prompt를 붙이고 `followupPrompt=null`; `flag-prompt`는 `--prompt`, `flag-prompt-interactive`는 `--prompt-interactive`; stdin 경로만 `followupPrompt=trimmedPrompt`다. Codex는 `startupCommandDelivery='shell-ready'`도 지정한다. shell-ready는 shell에 launch command를 넣을 때의 신호이지 Codex composer가 input을 받을 신호가 아니다. 근거: `src/shared/tui-agent-startup.ts:23–36,42–188,191–205`.
- [확인] command override/catalog command, extra CLI args tokenize·검증, model/effort conflict 검사를 거쳐 shell용 quoting을 한다. absolute executable을 확정하여 `string[]`로 반환하는 planner가 아니다. 근거: `src/shared/tui-agent-launch-command.ts:24–100`.
- [확인] local runtime은 node-pty를 lazy import한다. 실제 `pty.spawn`에는 shell path/args, caller `cols/rows`, effective cwd와 final env를 넣는다. Unix shell absolute path는 존재·X_OK를 검사하고 `/bin/zsh → /bin/bash → /bin/sh` 같은 fallback을 지원한다; bare/relative command는 execvp에 남긴다. concurrent spawn reservation의 winner만 spawn하고 나머지는 같은 ID로 reattach한다. cancellation이 spawn 뒤 확인되면 SIGKILL/destroy한다. Windows fallback이 이미 startup command를 shell args에 전달했다면 다시 write하지 않는다. 근거: `src/main/providers/local-pty-runtime-spawn.ts:1–15`, `local-pty-utils.ts:43–79,125–149`, `local-pty-spawn.ts:95–145`.
- [확인] env는 inherited env에서 build mode를 제거하고 explicit overlay를 합친다. `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=Orca`, `FORCE_HYPERLINK=1`; LANG이 없으면 `en_US.UTF-8`, Windows는 `PYTHONUTF8=1`, Git Bash는 `CHERE_INVOKING=1`. envToDelete는 builder 뒤에도 다시 적용한다. parent 앱이 agent 안에서 시작된 경우 다른 pane identity를 상속하지 않도록 `ORCA_PANE_KEY/ORCA_TAB_ID/ORCA_WORKTREE_ID/ORCA_AGENT_LAUNCH_TOKEN/JCODE_RUNTIME_DIR`를 explicit overlay가 아니면 지운다. 근거: `src/main/providers/local-pty-spawn-environment.ts:18–89`, `local-pty-launch-helpers.ts:8–28`.
- [미확인] 이 spawn 경로의 공통 PTY 크기 default는 확인하지 않았다; 읽은 경로는 caller cols/rows를 쓴다. lophn의 [Start]에 Orca shell/cwd fallback을 그대로 가져오면 exact plan과 달라진다.

#### prompt readiness와 실패

- [확인] catalog는 Claude/Codex/pi positional argv, OpenCode `--prompt`, Gemini `--prompt-interactive`를 고른다. draft는 다른 기능이다: Claude `--prefill`, pi `ORCA_PI_PREFILL`, Codex/OpenCode는 composer scanner를 쓴다. draft를 자동 작업 첫 prompt와 혼동하면 안 된다. 근거: `src/shared/tui-agent-config.ts:26–34,63–71,91–107,125–132,161–164`.
- [확인] draft scanner의 구체 신호는 bracketed paste enable `\x1b[?2004h`; disable `\x1b[?2004l`은 anchor를 취소한다. Codex는 bracketed-paste anchor와 composer `›`, OpenCode는 bracketed-paste가 켜진 뒤 cursor-show `\x1b[?25h`를 조합한다. incremental carry와 512자 tail을 유지한다. Codex/OpenCode는 출력 silence를 fallback readiness로 쓰지 않는다. catalog deadline은 두 제품 20,000ms이며 Codex draft submit retry delay는 1,200ms다. 이는 Orca의 특정 PTY/draft empirical scanner이지 제품이 보장한 universal protocol이 아니다. 근거: `src/shared/draft-paste-ready-scanner.ts:3–15,43–58,101–158,160–303`, `tui-agent-config.ts:63–71,91–107`.
- [확인] host-owned stdin launch delivery는 `waitForTerminal(handle,{condition:'tui-idle',timeoutMs:60_000})`가 만족한 뒤에만 보낸다. trust/update/dead process처럼 준비되지 않은 화면에 paste하지 않는다. writer에는 `inputKind:'launch'`, `acceptQueued:true`, 새 `requestId`, `observationTimeoutMs:0`을 넣는다. 주석상 bracketed paste, per-PTY serialization, lifecycle generation pinning, agent별 submit timing을 공통 writer가 맡는다. 근거: `src/main/runtime/rpc/methods/agent-launch-terminal-prompt.ts:1–90`.
- [확인] readiness 불충족은 prompt 미전달로 반환한다. 반면 `isAgentPromptStalledError`는 write가 이미 일어난 경우라 true를 반환하여 caller가 미전달로 오해하고 중복 paste하는 것을 막는다. 그 외 오류는 false/warn이다. [제안] lophn은 `write_attempted` 이후 verification 유실을 성공 또는 재전송 가능으로 뭉치지 말고 unknown으로 보관해야 한다. argv prompt에는 composer를 기다려 같은 prompt를 paste하는 경로가 아예 없어야 한다.

#### trust preflight

- [확인] `agentWorkspaceTrustEnabled`는 명시 false가 아니면 켜진다. fresh launch에서만 catalog의 preflightTrust writer를 실행하고 restore/reattach는 skip한다. Claude와 Codex가 지정되어 있고 읽은 Gemini entry에는 preflightTrust가 없다. 근거: `src/main/agent-workspace-trust-spawn.ts:16–68`, `src/shared/tui-agent-config.ts:26–34,63–71,125–132`.
- [확인] Claude writer는 `CLAUDE_CONFIG_DIR` 또는 home의 legacy `.config.json`을 우선하고 아니면 `.claude.json`에서 `projects[folder].hasTrustDialogAccepted=true`를 쓴다. lock/unreadable/missing-config는 skip하고 harness가 질문하게 한다. Codex writer는 config의 `[projects."<realpath>"] trust_level="trusted"`를 쓴다. 이는 Orca의 pretrust 구현이지 closed Claude core의 source 증거가 아니다. 근거: `src/main/claude/claude-folder-trust-file.ts:23–39,54–104`, `src/main/agent-trust-presets.ts:156–184`.
- [확인] Codex write 대기는 20,000ms, 짧은 writer는 1,500ms다. deadline은 Promise.race로 **write를 취소하지 않으므로 launch 뒤 trust write가 늦게 완료될 수 있다**. best-effort 실패가 launch를 막지 않는다. 근거: `src/main/agent-workspace-trust.ts:48–84`, `agent-trust-write-deadline.ts:17–49`. [제안] lophn은 timeout 길이를 조정하는 게 아니라 이 자동 trust write 자체를 버린다.

#### hook transport·authority·restore

- [확인] POSIX command hook은 native stdin payload를 local HTTP `POST http://127.0.0.1:${ORCA_AGENT_HOOK_PORT}/hook/<source>`로 보낸다. `X-Orca-Agent-Hook-Token` header와 pane/tab/launchToken/worktree/env/version metadata를 전달한다. raw-json-v1은 metadata를 base64 header에, fallback은 form fields에 담는다. curl connect default 0.5s, total 1.5s, proxy bypass가 있다. 근거: `src/main/agent-hooks/hook-post-command.ts:11–36`.
- [확인] listener는 시작마다 randomUUID token을 만들고 `127.0.0.1:0`에 bind한다. POST만 허용하고 body를 읽기 전에 header token을 검사하여 잘못되면 403; request timeout은 5,000ms. 인증된 malformed payload는 harness hook이 작업을 막지 않도록 204 fail-open 처리한다. 근거: `src/main/agent-hooks/server/server-lifecycle.ts:19–196`, `src/shared/agent-hook-listener/listener-limits.ts:9`.
- [확인] launchToken SHA256 fence·closed tab·retirement fence가 있다. 그러나 tokened SessionStart로 re-fence하고 retired pane은 native new-turn으로 restart할 수 있다. unknown future provider를 fail-open하는 branch와 legacy branch도 있다. 따라서 “Orca가 모든 미등록 generation을 항상 거절한다”는 결론은 틀리다. 빈 pane key도 transport 자체에서 거절하지 않고 telemetry로 센다. 근거: `src/main/agent-hooks/server/server-status-disposition.ts:43–156`, `server-authority-fences.ts:10–74,109–157`, `server-transport-rules.ts:1–13`.
- [확인] 상태 enum은 `working|blocked|waiting|done`; 시각은 `updatedAt`, `evidenceObservedAt`, mirrored receipt time 등을 구별한다. Claude SessionStart startup/resume/clear는 `done`을 sessionBoundary로 만들고 working을 만들지 않는다. UserPromptSubmit/일반 tool event→working, PermissionRequest/AskUserQuestion→waiting, Stop/StopFailure→done이며 compact/subagent gate가 있다. done은 OS process 종료가 아니다. 근거: `src/shared/agent-status-types.ts:51–52,76–115`, `agent-hook-listener/providers/claude-events.ts:46–74,103–125`.
- [확인] status freshness는 30분. restoredUnconfirmed row는 fresh가 아니고 host-owned structured feed는 별도 분기다; reconnect delivery 시각을 native evidence 시각처럼 새로 만들지 않으려는 필드가 있다. hydration cache max age는 7일이며 non-done row는 `restoredUnconfirmed=true`로 시작한다. 근거: `src/shared/agent-status-freshness.ts:7–53`, `src/main/agent-hooks/server/server-hydration.ts:24–137`, `server-constants.ts:23`.
- [확인] resume argv builder는 Claude `['claude','--resume',id]`, Codex `['codex','resume',id]`, Gemini `['gemini','--resume',id]`, OpenCode `['opencode','--session',id]`, pi `['pi','--session',transcriptPath]`다. provider ID는 empty/leading dash/control character, 512 UTF-16 길이 초과를 거절한다. Claude/Codex transcript는 ID로 path를 재구성하지 않고 보고된 path를 보관한다. pi extraction은 session_id와 session_file 둘 다 필요하다. 근거: `src/shared/agent-resume-argv.ts:6–40`, `agent-session-resume.ts:35–46,88–114,195–252`.
- [확인] sleeping record는 origin `worktree-sleep|quit|live`, `restoreOnTabOpenOnly`를 가진다. 타입 주석은 quit/live와 worktree activation을 구별하고 pane cold restore에서 tab을 열면 resume할 수 있다고 설명한다. [미확인] 이번 조사에서 실제 cold-restore call chain 전체는 확인하지 않았다. 이 타입 계약만으로도 lophn의 “재시작은 관측 복구뿐, resume 실행 미지원”과 구별해야 한다. 근거: `src/shared/agent-session-resume.ts:56–85`.

#### 기존 b601b98 조사와 차이

- [확인] 이전 보고의 기본 prompt modes, resume 형태, `working|blocked|waiting|done`, native ID 분리는 이번 snapshot에서도 확인했다. 이번 추가 evidence는 shell-string planner, draft 20s/host delivery 60s, write 뒤 stalled의 중복 방지, default-on pretrust와 늦게 완료될 write, launch fence 예외, 30분 stale/7일 hydration이다.
- [확인] 기존 3.2의 “Gemini Before/AfterAgent/Tool만으로 waiting 추론 제한”은 Orca normalizer에 대해서는 여전히 맞다. 그러나 Gemini native source에는 아래 ToolPermission Notification이 있으므로 제품 자체 한계로 확대하면 안 된다.
- [미확인] shallow clone에는 b601b98 object가 없어 직접 역사 diff는 못 했다. 위 항목은 **이전 보고에 적힌 내용과 현재 읽은 snapshot의 비교**이며 어느 commit에서 기능이 새로 생겼다는 주장이 아니다.

### Paseo (0d05584d044f5a72212d509ead7af0532dd105e2)

저장소: <https://github.com/getpaseo/paseo>.

- [확인] terminal manager는 absolute cwd를 요구한다. terminalId와 per-terminal activity token을 만들고 `PASEO_TERMINAL_ID`, `PASEO_ACTIVITY_TOKEN`, `PASEO_TERMINAL_ACTIVITY_URL`을 child env에 넣는다. token map은 terminalId 기준이고 spawn 실패 때 제거하며 validation은 valid/unknown/invalid를 구별한다. 근거: `packages/server/src/terminal/terminal-manager.ts:322–386`.
- [확인] node-pty default는 rows=24, cols=80, name=`xterm-256color`; command가 있으면 direct command/args, 없으면 default shell을 시작한다. cwd와 activityEnv/workspace env를 함께 넣는다. env builder는 TERM과 TERM_PROGRAM=kitty, Paseo CLI PATH/PASEO_HOOK_CLI, zsh integration을 준비한다. `createExternalProcessEnv`는 overlay 후 `PASEO_NODE_ENV/PASEO_DESKTOP_MANAGED/PASEO_SUPERVISED/ELECTRON_RUN_AS_NODE/ELECTRON_NO_ATTACH_CONSOLE/ESBUILD_BINARY_PATH`와 undefined를 제거한다. 근거: `packages/server/src/terminal/terminal.ts:492–557,885–957`, `packages/server/src/server/paseo-env.ts:4–45`.
- [확인] Unix resolve는 command,args를 그대로 반환한다. Windows는 executable을 찾아 `.cmd/.bat`이면 ComSpec `cmd.exe /d /s /c`용 **한 문자열**로 바꾼다. ConPTY CreateProcess가 PATHEXT를 적용하지 않아 npm shim의 bare name launch가 worker exception으로 이어질 수 있기 때문이다. cmd.exe가 literal CR/LF를 command separator로 다시 해석하므로 이 구현은 newline을 space로 바꾼다. injection을 줄이지만 prompt fidelity는 잃는다. 근거: `packages/server/src/terminal/terminal.ts:327–385,301–323`. [제안] lophn direct argv adapter는 Windows의 `.cmd`를 Unix처럼 “분리 argv라 안전”이라 광고하지 말고 native binary 또는 검증된 absolute runtime+entrypoint adapter만 지원해야 한다. 지원되지 않으면 안내로 끝내며 prompt를 변형하거나 shell로 fallback하지 않는다.
- [확인] `paseo hooks <agent> <event>`는 env 셋이 없으면 no-op. native stdin을 읽되 iterator next별 100ms timeout, report POST는 500ms AbortController, 실패는 조용히 끝난다. body는 `{terminalId,token,state}`뿐이다; session_id/transcript_path/cwd/native event는 공통 report에서 사라진다. 근거: `packages/cli/src/commands/hooks.ts:4–116`.
- [확인] activity URL은 TCP listener에서만 만든다; socket/pipe listener에는 null이다. `/api/terminal-activity`는 loopback source 검사, schema 검사(400), per-terminal token 검사(403), update 실패(403/500), 성공(204)을 한다. incoming `running|idle|needs-input`을 `working|idle|attention`으로 바꾼다. native session ID evidence를 보존하는 API가 아니다. 근거: `packages/server/src/server/bootstrap.ts:268–334`.
- [확인] Claude hook installer는 UserPromptSubmit→running, Stop/StopFailure/SessionEnd→idle, Notification resolver는 payload `matcher` 또는 `reason`이 `idle_prompt`인지 본다. PermissionRequest는 이 installer events에 없다. Codex installer는 UserPromptSubmit/PreToolUse/PostToolUse→running, PermissionRequest→needs-input, Stop→idle이고 `.codex/hooks.json`/CODEX_HOME을 쓴다. 근거: `packages/server/src/terminal/agent-hooks/claude/claude.ts:4–48`, `codex/codex.ts:4–31`. [미확인] Claude Notification의 실제 배포 payload와 matcher/reason 일치 여부는 이번 공식 문서 fetch에서 확인하지 못했다. 이 code만 보고 native schema로 복제하지 않는다.
- [확인] terminal tracker는 unknown을 null로 유지한다. working→idle은 attentionReason=finished, attention은 state=idle+needs_input, interrupt는 working을 null로 지운다. 동일 state/reason event는 changedAt을 갱신하지 않는다; 따라서 changedAt은 수신 heartbeat 시각이 아니다. 근거: `packages/server/src/terminal/activity/terminal-activity-tracker.ts:12–73`.
- [확인] agent lifecycle은 initializing/idle/running/error/closed이며 terminal activity와 별개다. archive helper는 running/initializing→idle, requiresAttention=false로 바꾼다. 이것은 live process 증거가 아니다. 근거: `packages/server/src/server/agent/mcp-shared.ts:15`, `agent-archive.ts:10–29`. [미확인] 이번에 terminal hook 활동의 공통 stale deadline과 앱 재시작 후 자동 TUI resume 여부는 확인하지 않았다.
- [확인: 기존 조사] 2.5의 SDK Claude, Codex app-server, OpenCode API, pi RPC resume는 bare TUI argv resume와 다르다. 이번 source-read의 terminal activity 경로는 그것을 대신하지 않는다. [미확인] Paseo terminal의 첫 prompt 자동 주입·composer readiness contract는 이 경로에서 확인하지 않았다; hooks activity 성공을 prompt delivery ack로 사용하면 안 된다.

### Codex (3a69ec3ef8fb87b41e99b8942af061ad58ae6732)

저장소: <https://github.com/openai/codex>.

- [확인] interactive CLI는 positional `prompt: Option<String>`과 resume session ID를 받는다. `codex resume <id> [prompt]`는 explicit ID 경로이며 `--last`와 positional 해석, picker는 별도다. TERM=dumb/non-TTY 제한과 CRLF/CR normalization도 있다. 근거: `codex-rs/tui/src/cli.rs:16–18,35–60`, `codex-rs/cli/src/main.rs:2419–2428,2584–2602`.
- [확인] TUI는 pending initial_user_message를 `take()`하여 한 번 submit한다. suppression·rate-limit recovery·Windows sandbox setup은 gate하며 `blocks_direct_input`이면 message를 composer로 돌려준다. 이는 `codex <prompt>` 뒤 lophn이 다시 paste하면 중복되는 직접 근거다. 근거: `codex-rs/tui/src/chatwidget/input_restore.rs:140–181`, `chatwidget/session_flow.rs:233–236`.
- [확인] trust 화면은 “Trust this folder?”, “Trust and continue”, “Quit/Back”를 제공하고 결정을 저장한다고 명시한다. restricted mode는 untrusted folder config/hooks/exec policies를 비활성화하지만 skills는 load한다. folder trust와 tool permission이 다르다. 근거: `codex-rs/tui/src/onboarding/trust_directory.rs:60–98`. [제안] [Start]가 이 trust 선택을 누르거나 config를 수정하지 않는다.
- [확인] native hooks의 wire enum에는 PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, SessionStart, UserPromptSubmit, SubagentStart, SubagentStop, Stop, Interrupt가 있다. 별도로 SessionEnd payload와 runner도 있다. enum 하나만 보고 SessionEnd 부재를 선언하면 틀린다. 근거: `codex-rs/hooks/src/schema.rs:102–125,495–523`, `registry.rs:287–301`.
- [확인] SessionStart는 `session_id`, nullable `transcript_path`, `cwd`, `hook_event_name`, `model`, `permission_mode`, `source`; SessionEnd는 native identity + `reason`이다. tool/PermissionRequest에는 `turn_id`, optional `agent_id/agent_type`, `tool_name/tool_input`도 있다; PostToolUse는 `tool_response/tool_use_id`. subagent event가 lead terminal 상태를 덮지 않도록 native agent attribution을 보존해야 한다. 근거: `codex-rs/hooks/src/schema.rs:278–342,499–523`.
- [확인] hook command는 JSON stdin과 output pipe를 쓴다. timeout은 stdin write와 output drain/wait를 함께 감싸고 BrokenPipe를 구별한다. command runner는 shell program을 통한 command이며 TUI launch의 separated argv와 다른 경계다. 일반 hook default 600s, SessionEnd/Interrupt default 1s·max 3s다. 근거: `codex-rs/hooks/src/engine/command_runner.rs:259–320,339–422`, `engine/discovery.rs:746–764`, `events/session_end.rs:20–23`.
- [미확인] native TUI가 외부 앱에 제공하는 안정된 “composer ready” IPC protocol은 이 source-read에서 확인하지 않았다. SessionStart는 native identity/session boundary evidence이지 언제나 PTY stdin을 안전하게 submit할 수 있다는 ack는 아니다. lophn은 positional argv route를 쓰고 신호가 없을 때 stdin fallback하지 않는다.

### Gemini CLI (fb972b2f87fe7d5b06d37eac711490162d98de2c)

저장소: <https://github.com/google-gemini/gemini-cli>.

- [확인] `--prompt/-p`는 headless이고 `--prompt-interactive/-i`는 initial prompt 뒤 interactive를 유지한다. `--skip-trust` default false이며 current workspace를 해당 session에 trust한다. `--prompt-interactive`+piped stdin은 `Error: The --prompt-interactive flag cannot be used when input is piped from stdin.`으로 fatal exit한다. PTY와 headless pipe executor를 교환할 수 없다. 근거: `packages/cli/src/config/config.ts:294–312,783–788`, `packages/cli/src/gemini.tsx:574–580`.
- [확인] initialPrompt는 config initialized, auth/theme/editor/privacy dialog 없음, Gemini client initialized일 때 `handleFinalSubmit`하고 `initialPromptSubmitted.current=true`로 잠근다. argv flag를 받은 harness가 자체 readiness gate를 맡는다. 근거: `packages/cli/src/ui/AppContainer.tsx:1585–1615`.
- [확인] folder dialog는 trust_folder/trust_parent/do_not_trust, escape cancellation을 제공한다. trust가 local config/hooks/MCP/skills/settings 적용에 영향을 준다. [제안] lophn은 `--skip-trust`를 추가하거나 dialog에 Enter를 보내지 않는다. 근거: `packages/cli/src/ui/components/FolderTrustDialog.tsx:33–37,56–104,142–149`.
- [확인] event 종류는 BeforeTool/AfterTool/BeforeAgent/AfterAgent/Notification/SessionStart/SessionEnd/PreCompress/BeforeModel/AfterModel/BeforeToolSelection. common input은 `session_id/transcript_path/cwd/hook_event_name/timestamp`; BeforeAgent는 prompt, tool events는 tool_name/tool_input와 optional mcp_context, AfterAgent는 prompt/prompt_response/stop_hook_active다. 근거: `packages/core/src/hooks/types.ts:43–55,141–147,498–523,547–592`.
- [확인] permission notification은 `notification_type:'ToolPermission'`, `message`, `details`를 갖는다. `fireToolNotificationEvent`가 confirmation message/details를 만들어 실제 Notification을 호출한다. 이는 정확한 waiting_input evidence 후보이며 Before/AfterTool만으로 대기를 추측하는 것과 다르다. Orca의 Gemini normalizer는 이 revision에서 Notification/SessionStart/SessionEnd를 상태로 매핑하지 않는다. 근거: `packages/core/src/hooks/types.ts:564–575`, `hookSystem.ts:428–445`, `hookEventHandler.ts:126–150`; Orca `src/shared/agent-hook-listener/providers/gemini-events.ts:9–50`.
- [확인] command hook default 60,000ms. sanitizeEnvironment(process.env)에 project/cwd/session env와 hookConfig.env를 overlay한다. shell executable+argsPrefix+command를 `shell:false`로 spawn하지만 command는 shell이 해석한다. cwd=input.cwd, stdio pipes, JSON stdin; timeout은 TERM/taskkill 후 5s force-kill 시도가 있다. 근거: `packages/core/src/hooks/hookRunner.ts:36,313–414`. [미확인] 이 조사에서는 sanitizer의 전체 allow/deny key를 읽지 않았다. observation helper env가 살아남는지는 해당 배포 version에서 테스트해야 한다.
- [확인] resume option은 `--resume <id|index|latest>`/value 없는 latest 경로를 가진다. resume/session-id/session-file은 mutually exclusive다. ID와 index/latest는 exact target 선택이라는 보장이 다르다. 근거: `packages/cli/src/config/config.ts:243–256,401–413`. [제안] 나중 resume를 지원하더라도 explicit native ID만 adapter plan에 넣고 latest/index로 자동 대체하지 않는다.

### OpenCode (907b3bc518fa48e90e8ec24dd327d13eee71c36c)

저장소: <https://github.com/anomalyco/opencode>.

- [확인] default TUI command는 `$0 [project]`, `--prompt`, `--session/-s`, `--continue/-c`, `--fork`를 받는다. --auto는 default false다. non-TTY input만 stdin에서 읽고 flag prompt와 합친다. project/cwd resolve와 chdir 실패는 UI error이며 worker에 defined process.env를 넘긴다. internal worker RPC가 default이며 external server 설정은 별도다. sessionID 검증 실패는 exitCode=1; shutdown RPC는 5,000ms bound 뒤 worker terminate다. 근거: `packages/opencode/src/cli/cmd/tui.ts:59–103,198–258,269–299`.
- [확인] home composer binding은 --prompt를 한 번 set한다. sync.ready와 local.model.ready를 기다리고 composer input이 args.prompt와 같은지 확인하여 `sent=true`로 잠근 뒤 submit한다. flag prompt 뒤 외부 앱이 자동 paste하면 중복된다. 근거: `packages/tui/src/routes/home.tsx:44–68`.
- [확인] native plugin contract는 `event?: (input:{event:Event})=>Promise<void>`. runtime은 directory가 맞는 event만 plugin에 보내고 `{id,type,properties:event.data}`로 전달한다. native plugin이 모든 OpenCode session 중 해당 terminal의 root session만 보고한다는 보장은 directory filter만으로는 없다. 근거: `packages/plugin/src/index.ts:222–224`, `packages/opencode/src/plugin/index.ts:255–263`.
- [확인] `session.status` payload는 `{sessionID,status}`이며 status type은 idle/retry/busy; retry는 attempt/message/action?/next. `session.idle`는 deprecated다. `permission.asked`에는 id/sessionID/permission/patterns/metadata/always/tool?{messageID,callID}; `permission.replied`는 sessionID/requestID/reply(once/always/reject). 근거: `packages/schema/src/session-status-event.ts:9–49`, `packages/schema/src/v1/permission.ts:27–66`. [제안] permission requestID를 함께 유지하고 reply 또는 해당 session의 검증된 진행 evidence로 waiting을 해제한다; busy와 retry를 permission 대기와 합치지 않는다.
- [확인] Orca plugin은 session.created/status/idle/error/message와 permission/question events를 모으고 child session을 검사한다. attention event에 sessionID가 없으면 버리고 root session을 resolve한다. bare cwd match만으로 다른 session을 섞지 않으려는 추가 로직이다. 근거: Orca `src/main/opencode/status-plugin-legacy-tui-source.ts:24–52`, `status-plugin-factory-source.ts:49–108,133–166`, `status-plugin-lifecycle-source.ts:4–45`.
- [확인] explicit TUI resume는 `opencode --session <sessionID>`다. [미확인] 이 조사에서는 Codex/Gemini 같은 folder trust preflight를 OpenCode에 확인하지 않았다; trust 부재를 뜻하지 않는다. --auto나 permission bypass를 lophn이 추가하면 안 된다.

### pi (83692682f095528f8b71652ddacff7075e36e893)

저장소: <https://github.com/earendil-works/pi>.

- [확인] positional initial prompt는 interactive mode의 initialMessage/initialMessages가 되며 UI setup 뒤 `session.prompt`로 보낸다. 각 실패는 showError하고 main interactive loop는 따로 이어진다. `--session <path|id>`는 특정 file/partial UUID, `--session-id <id>`는 exact project ID가 없으면 생성하며 `--resume/-r`는 selector 경로다. lophn이 만든 ID를 native 획득 evidence라고 기록하면 안 된다. 근거: `packages/coding-agent/src/cli/args.ts:112–139,300–304`, `src/main.ts:900–958`, `src/modes/interactive/interactive-mode.ts:1218–1246`.
- [확인] extension native API는 `session_start` reason startup/reload/new/resume/fork와 previousSessionFile, `session_shutdown` reason quit/reload/new/resume/fork와 targetSessionFile을 제공한다. shutdown은 extension reload/session replacement도 포함하므로 OS process ended와 같지 않다. 근거: `packages/coding-agent/src/core/extensions/types.ts:731–805`.
- [확인] before_agent_start는 prompt/images/systemPrompt, agent_start, agent_end(messages), turn_start/turn_end, tool_call/tool_execution_start/tool_execution_end를 제공한다. 더 강한 `agent_settled`는 automatic retry/compaction/queued continuation이 없어진 뒤의 event다. native identity는 `ctx.sessionManager.getSessionId()`와 `getSessionFile()`에서 얻는다; 모든 event가 session_id를 직접 담는 것은 아니다. 근거: `packages/coding-agent/src/core/extensions/types.ts:909–931,995–998,1019–1027,1055–1080,1152–1163`, `src/core/session-manager.ts:1152–1156`.
- [확인] Orca generated extension은 위 getter로 `session_id/session_file`을 만들고 같은 HTTP hook receiver에 post한다. pi가 예정 transcript path를 file 생성 전에 제공할 수 있어 persistence evidence는 existsSync로 재확인한다. agent_end를 즉시 완전 idle로 처리하지 않고 agent_settled 또는 ctx.isIdle recheck(25ms부터 최대 250ms 간격)를 쓰며 run generation별 중복 completion을 막는다. 이 250ms는 전체 deadline이 아니라 recheck 간격 상한이다. 근거: Orca `src/main/pi/agent-status-extension-source.ts:1–13,26–67`, `agent-status-handler-source.ts:159–195,213–305`.
- [확인] pi에는 project_trust event도 있다(yes/no/undecided, remember?). 근거: `packages/coding-agent/src/core/extensions/types.ts:677–699`. [미확인] 모든 pi extension/UI dialog의 permission waiting을 common native event 하나로 매핑하는 contract는 이번에 확정하지 않았다. tool_call만으로 사람 대기를 추정하지 않는다.
- [확인] Orca pi resume adapter는 session_file 없이는 resume argv를 못 만든다. [제안] pi의 provider ID와 transcript path를 별도 evidence로 유지하며 file path가 있다고 transcript를 자동 수집하지 않는다.

### Claude Code (공개 예제 1c229fcd1e1e4e452e29a8f116b45fe4cfe2c528; 공식 문서 2026-10-04 조회)

공개 저장소: <https://github.com/anthropics/claude-code>. 본체 TUI source는 이 저장소의 조사 대상이 아니다.

- [문서] [CLI reference](https://code.claude.com/docs/en/cli-reference)는 `claude "query"`를 interactive initial prompt, `-p/--print`를 noninteractive, `--resume/-r`를 ID/name/picker, `--continue`를 current cwd latest session으로 설명한다. 현 문서는 absolute `.jsonl` path resume도 설명하지만 Orca builder는 ID를 쓴다. `--dangerously-skip-permissions`는 permission bypass이며 lophn이 추가할 launch flag가 아니다.
- [문서] [Security](https://code.claude.com/docs/en/security)는 untrusted folder의 interactive 시작에 workspace trust dialog가 있고 project `.mcp.json` server approval은 별도라고 명시한다. -p는 두 prompt를 표시하지 않는다. home directory trust는 session에만 유지되고 project directory의 trust는 저장된다. [제안] [Start]는 interactive argv를 유지하고 trust config write·-p 우회·dialog key 자동 입력을 하지 않는다.
- [문서] [Hooks reference](https://code.claude.com/docs/en/hooks)의 common input은 session_id/transcript_path/cwd/hook_event_name, event-dependent permission_mode, version-dependent prompt_id/scratchpad_dir/effort, subagent의 agent_id/agent_type이다. transcript는 비동기 기록일 수 있다. command hook은 stdin JSON을 받으며 HTTP hook은 같은 JSON을 POST body로 받는다. SessionStart source startup/resume/clear/compact/fork와 Stop(turn), SessionEnd(session 종료)를 구별한다.
- [문서] PermissionRequest는 tool permission 결정 지점이고 Notification matcher에는 permission_prompt/idle_prompt/agent_needs_input/agent_completed 등이 있다. observer는 permission 결정을 출력하지 않는다. PermissionRequest의 decision JSON allow/deny는 실제 행동 권한을 바꾼다. 현재 문서상 PermissionRequest exit 2 자체는 deny가 아니며 decision object를 써야 한다. observation helper는 exit 0, 빈 stdout으로 끝내고 additionalContext/systemMessage/terminalSequence도 내보내지 않는 편이 안전하다.
- [문서] 현재 hooks timeout 표는 일반 command/http/mcp_tool 600s, UserPromptSubmit/model-switch 30s, MessageDisplay 10s, SessionEnd shared budget 1.5s(최대 60s)를 설명한다. interactive launch SessionStart는 background이고 첫 response가 hook 완료를 기다린다. 이 timeout은 lophn readiness 10s와 다른 timer다. [미확인] fetch가 dedicated Notification/PermissionRequest section 전에 잘려 exact Notification input discriminator와 complete PermissionRequest schema는 확인하지 못했다. config의 matcher를 payload field로 쓰지 않는다. 배포 version schema 테스트 전 Notification adapter를 검증 완료로 표시하지 않는다.
- [확인] 공개 security-guidance plugin의 hooks.json은 SessionStart command+timeout 180s, UserPromptSubmit/PostToolUse/Stop command를 등록한다. helper가 sys.stdin.read/json.loads하고 input_data.session_id를 읽는다. 근거: `plugins/security-guidance/hooks/hooks.json:4–69`, `hooks/security_reminder_hook.py:2035–2044`. 이는 plugin 실행 예제의 증거이지 closed core의 readiness·trust 구현 증거가 아니다. 특히 예제의 asyncRewake/LLM review는 observation bridge로 가져오지 않는다.

### vibe-kanban executors (d5cbb5380fa0b32e98ef9b8d987f63decce4be3a)

저장소: <https://github.com/BloopAI/vibe-kanban>.

#### PTY가 아니라 protocol/pipe

- [확인] Claude executor는 resolved program/args에 `Command::new`, current_dir, kill_on_drop(true), stdin/stdout/stderr pipe와 process group spawn을 쓴다. `NPM_CONFIG_LOGLEVEL=error`, profile ExecutionEnv를 적용하며 disable_api_key면 ANTHROPIC_API_KEY를 제거한다. control peer가 hooks/permission mode를 초기화하고 user message를 protocol로 보낸다. 터미널 composer에 paste하는 구현이 아니다. 근거: `crates/executors/src/executors/claude.rs:620–709`.
- [확인] Codex는 app-server JSON RPC, pipes, kill_on_drop와 cancellation/ExitSignal을 쓴다. env는 NPM_CONFIG_LOGLEVEL=error/NODE_NO_WARNINGS=1/NO_COLOR=1/RUST_LOG=error. initial은 thread_start→register_session→turn_start; follow-up은 **thread_fork**이며 native thread_resume와 같지 않다. 근거: `crates/executors/src/executors/codex.rs:594–634,640–756`.
- [확인] Gemini는 reusable ACP harness를 사용하며 그 harness 역시 resolved program/args·cwd·pipes·kill_on_drop다. follow-up의 existing_session은 local history를 새 UI UUID로 fork하고 ACP `new_session`을 만들며 history 기반 resume prompt를 생성한다. 반환 native `acp_session_id`와 로그의 `display_session_id`가 달라질 수 있다. prompt는 native ACP ID에 보내되 SessionStart log/persistence에는 display ID를 쓴다. 근거: `crates/executors/src/executors/gemini.rs:84–130`, `acp/harness.rs:84–185,338–386,414–457`. [제안] 그 로그의 session ID를 그대로 native CLI `--resume` handle로 쓰지 않는다.
- [확인] OpenCode는 server를 spawn하고 stdin=null, stdout/stderr pipes, username/password env를 넣는다. server stdout의 exact prefix `opencode server listening on `을 기다려 URL을 얻는다. 로컬 function deadline은 180s, EOF는 실패, 64줄 capture 한도가 있다. 이는 TUI composer ready 신호가 아니라 HTTP server ready다. 근거: `crates/executors/src/executors/opencode.rs:108–155,320–367`.

#### ID extraction·follow-up·수명

- [확인] Claude follow-up은 `--resume <session_id>`를 붙인다. ID extractor는 Assistant/User/ToolUse/ToolResult/Result/RateLimitEvent의 session_id를 채택하고 System/StreamEvent는 초기화가 덜 됐을 수 있어 채택하지 않는다. 얻은 ID는 msg_store에 별도로 push한다. 근거: `crates/executors/src/executors/claude.rs:348–380,773–817,891–908`. output이 structured JSON이라는 전제가 있으며 임의 terminal title에서 찾지 않는다.
- [확인] Codex normalizer는 thread notification/response의 thread.id를 저장한다. legacy `SessionConfigured`도 처리하고 JSON이 긴 history 때문에 잘린 경우 exact prefix `{"method":"sessionConfigured","params":{"sessionId":"` 뒤 UUID regex로 best-effort fallback한다. regex는 `^([0-9a-fA-F]{8}-...-{12})` 형태다. 이는 해당 app-server log format 전용이고 임의 PTY UUID 검색의 근거가 아니다. 근거: `crates/executors/src/executors/codex/normalize_logs.rs:1298,1556–1602,2444–2456,2526–2528`.
- [확인] OpenCode normalizer는 SessionStart executor event에서 ID를 한 번 저장하고 follow-up은 resume_session_id로 runtime을 만든다. 근거: `crates/executors/src/executors/opencode/normalize_logs.rs:53–77`, `opencode.rs:190–215,429–435`.
- [확인] supervisor는 executor spawn에 30s timeout, log tracking 실패 때 group kill, child/cancellation token/exit monitor를 보관한다. stop은 cancellation 후 monitor를 5s 기다리고 group kill한다. OS exit와 executor ExitSignal을 같이 monitor한다. `SpawnedChild`는 child+exit_signal+cancel을 분리한다. 근거: `crates/local-deployment/src/container.rs:1369–1400,1425–1454`, `crates/executors/src/executors/mod.rs:314–323`. OpenCode 내부 180s startup deadline이 있어도 이 container의 30s outer spawn timeout이 먼저 끝날 수 있다.
- [제안] lophn은 resolved argv·native ID provenance·OS exit/turn exit 분리·bounded cleanup을 참고하되 durable executor supervisor, pipe protocol, raw log persistence, history 재주입을 [Start] TUI contract로 가져오지 않는다. 서버 비밀번호를 env에 넣는 사례도 lophn platform credential 전달의 허용 근거가 아니다.

## 비교

| 대상 | launch/첫 prompt | readiness와 deadline | trust·waiting evidence | native identity·resume | 전달·restore 한계 |
|---|---|---|---|---|---|
| Orca | [확인] shell command 문자열; argv/--prompt/--prompt-interactive 또는 host stdin | draft Codex `2004h+›`, OpenCode `2004h+25h`, 20s; host tui-idle 60s | default-on Claude/Codex pretrust; native hooks별 normalizer | native payload; Claude --resume, Codex resume, Gemini --resume, OpenCode --session, pi file | loopback HTTP shared header token+launch fence; stale 30분, hydrated unconfirmed; cold resume 타입 계약 |
| Paseo terminal | [확인] node-pty command/args; Windows batch는 cmd string | 첫 prompt/composer ack 미확인; hook POST 500ms | Codex PermissionRequest; Claude Notification resolver는 matcher/reason | activity report에는 native ID 없음; SDK/protocol persistence 별도 | per-terminal token+loopback; terminal null!=idle; stale/auto TUI restore 미확인 |
| Codex TUI | [확인] positional prompt; pending take() once | native submit gate; 외부 composer protocol 미확인 | trust dialog; PermissionRequest + turn/agent attribution | hook session_id/nullable transcript; resume explicit ID | hooks JSON stdin; 일반 600s, end/interrupt 1–3s; pipe app-server와 구별 |
| Gemini TUI | [확인] --prompt-interactive; -p는 headless | client/config/dialog gate + ref once | trust default skip=false; Notification ToolPermission | hook session_id/transcript/cwd; --resume ID/index/latest | hooks shell subprocess JSON stdin, default 60s; Orca는 Notification mapping 누락 |
| OpenCode TUI | [확인] --prompt; --session | sync/model/composer match + sent once | permission.asked/replied, session busy/retry/idle | plugin sessionID; --session ID | in-process plugin directory filter; root session attribution 추가 필요 |
| pi TUI | [확인] positional initialMessage→session.prompt | UI setup 뒤 submit; agent_settled가 end보다 강함 | project_trust; tool_call만으로 waiting 아님 | ctx getter ID+file; --session file 참고 | extension runtime shutdown!=process exit; 예정 file 존재 확인 필요 |
| Claude Code | [문서] positional interactive prompt; -p는 다름 | core composer gate 미확인; SessionStart hook 완료와 구별 | interactive folder trust; PermissionRequest/Notification 문서 | hook session_id/transcript; --resume ID/name/path | JSON stdin/HTTP hook; 본체 source 없음, Notification exact schema 미확인 |
| vibe-kanban | [확인] PTY 아닌 pipes/protocol/HTTP server | container spawn 30s, OpenCode URL prefix 내부 180s | executor approval protocol; native TUI trust와 다름 | Claude JSON ID, Codex thread ID; Gemini display ID!=native ACP ID 가능 | cancellation+5s/group kill; durable supervisor/history persistence는 현재 lophn 범위 밖 |

## lophn에 가져올 것과 버릴 것

### [Start] contract 제안 (5줄)

1. [제안] coding-agent/sessions가 exact version·OS 검증 adapter로 LaunchPlan을 만들고 shell main이 human_start_handle/operation_id와 최신 ticket·scope·executable·profile·등록 cwd를 다시 검증한다.
2. [제안] terminal host만 absolute executable+string[] argv+cwd+검증 env+PTY cols/rows를 직접 spawn하며 credential 보호 loader는 인증 경계가 해당 child generation에 붙인다.
3. [제안] argv/flag 첫 prompt는 exec 때 한 번만 넣고 paste하지 않는다; stdin-only는 검증한 composer signal을 deadline 안에 본 뒤 generation-pinned serialized paste/submit을 한 번만 한다.
4. [제안] hook/plugin/extension은 등록 generation의 observation 전용 local channel로 최소 native identity·state evidence만 보내고 status는 claim·permission·completion을 바꾸지 않는다.
5. [제안] write/ack 유실·deadline·stale·host/app 재시작은 unknown, live host의 같은 generation 재관측만 허용하며 자동 spawn·resume·prompt replay는 없다.

### executable·argv·env·PTY

- [제안] renderer가 shell command string을 보내게 하지 않는다. plan의 `executable`은 현재 profile에서 해석한 absolute 실행 target, `argv`는 adapter builder의 string[]다. quote/escape 문자열을 붙여 shell -c로 우회하지 않는다. prompt의 공백·CR/LF·`$()`·quote·leading dash는 argv parser가 의도대로 data로 받는지 version/OS 테스트한다; parser가 지원하는 `--` 또는 flag form도 adapter 검증 대상이다. 길이/OS argv 한도를 넘으면 safe unavailable로 끝내며 잘라내거나 stdin으로 자동 변환하지 않는다.
- [제안] Windows npm shim은 별도 adapter 제약이다. native binary 또는 신뢰한 absolute runtime+검증 entrypoint 형태가 아니면 [Start] 불가로 표시한다. `.cmd` newline을 space로 바꾸는 Paseo 처리를 복사하지 않는다.
- [제안] PTY geometry는 사람이 볼 탭의 실제 cols/rows를 사용하고 미측정 때 80×24를 명시 default로 둘 수 있다. 이는 Paseo precedent이며 현재 lophn 문서의 확정 geometry 값은 아니다. resize는 같은 runtime_ref/generation에만 전달한다.
- [제안] explicit env overlay와 env deletion을 plan/host 내부 contract에 나누고 overlay 뒤 deletion을 다시 강제한다. inherited terminal identity·app runtime control·다른 connection helper env를 strip한다. TERM/locale 같은 safe env와 provider auth를 구별한다. env_names가 safe manifest라 해도 값에 secret을 넣어 renderer로 반환하지 않는다. executable/cwd 실패에는 다른 harness·shell·home cwd fallback이 없다.

### prompt delivery journal과 timers

- [제안] host memory의 operation_id→runtime_ref, process generation, `prompt_route`, `delivery_phase:not_attempted|write_attempted|observed|unknown`을 분리한다. durable execution intent/ledger를 만들자는 제안이 아니다. argv spawn 성공은 prompt 인자가 child에 전달되었다는 evidence일 뿐 native turn 실행/claim 성공 ack가 아니다. UserPromptSubmit/BeforeAgent 같은 뒤 event가 없어도 prompt를 다시 보내지 않는다.
- [제안] 현재 lophn domain-model의 10,000ms deadline을 지킨다. Orca 20s draft/60s host idle은 10s가 모든 배포에서 충분하다는 증거가 아니라 호환성 위험 evidence다. 10s 안에 composer 준비를 못 확인한 stdin adapter는 unknown, 자동 paste/재시작 없음; timeout 뒤 late marker로 자동 delivery를 재개하지 않는다. argv adapter는 trust/auth를 기다리는 동안 10s 안에 ready가 안 와도 이미 전달한 argv prompt를 취소/재전송하지 않는다.
- [제안] stdin의 bracketed paste `\x1b[200~<prompt>\x1b[201~`와 submit key/timing은 harness별 tested adapter가 정한다. `2004h` 하나, cursor show 하나, process alive, silence, 일반 shell prompt/OSC 133는 harness composer readiness의 충분조건이 아니다. stream chunk 경계를 보존하여 scanner를 쓰되 marker로 clipboard/앱 command를 실행하지 않는다.
- [제안] write 호출 뒤 crash·ack timeout은 unknown이다. 성공 retry와 “전송 안 됨” retry를 허용하지 않는다. 같은 operation 중복 IPC는 같은 runtime만 반환하고 local key 유실 후 재시작은 key를 추측해 재spawn하지 않는다. 사람에게 terminal 확인과 새 선택을 안내한다.

### 최소 observation channel과 보안 한계

- [제안] terminal host는 spawn 전에 generation-scoped observation channel을 등록하고 예상 harness/adapter/native event allowlist를 저장한다. helper envelope는 예를 들어 `{schema_version, runtime_ref, generation, source, event_name, native_session_id?, transcript_path?, native_agent_id?, native_turn_id?, state_hint?}`로 제한한다. `received_at/evidence_source`는 receiver가 찍는다. PTY title·cwd·connection 일치만으로 등록 channel을 찾거나 session을 합치지 않는다.
- [제안] transport는 앱이 생성한 Unix-domain socket/Windows named pipe 또는 127.0.0.1 ephemeral HTTP 중 **검증한 helper가 지원하는 하나**로 좁힌다. TCP면 loopback bind+peer 검사+per-generation observation capability, content type/schema/body size 상한, event allowlist, request deadline이 필요하다. 출발 제안값은 request 1,500ms/helper total 500ms·body 64KiB이며 provider hook의 기본 60/600s를 그대로 기다리지 않는다. 이 숫자는 lophn 제안이지 모든 프로젝트 default가 아니다.
- [제안] nonsecret runtime identity·channel locator만 terminal-specific env로 전달할 수 있다. Orca/Paseo env의 hook token을 platform credential 보호 방식으로 복사하지 않는다. observation capability의 process-local 전달은 인증 경계와 별도 검증하며 가능하면 상속된 보호 IPC/loader로 helper에 준다. helper가 env secret만 지원하면 현 token 비노출 요구를 충족하는 검증 adapter가 나오기 전 미검증으로 남긴다; 현재 지원을 조용히 넓히지 않는다.
- [제안] observation capability는 observation route만 허용하고 ticket claim·permission respond·Start/resume·credential fetch 권한을 갖지 않는다. native payload는 tool_input/prompt/assistant text가 아니라 필요한 identity·event·permission request 참조만 allowlist한다. helper stdout은 빈 값, 오류는 safe 진단뿐; native hook decision/context injection을 하지 않는다. receiver 장애는 harness 작업을 막지 않되 evidence freshness는 stale/unknown으로 떨어뜨린다.
- [확인에 따른 한계] loopback·random token·generation fence는 다른 terminal의 실수/무권한 HTTP 혼입을 줄이지, 같은 OS 사용자 권한의 malicious child가 자기 token으로 payload를 위조하는 것을 막지 못한다. socket도 OS sandbox가 아니다. native ID shape 검증은 provenance 진실성 증명이 아니며 process exit는 host evidence로 별도 확인한다. 외부 terminal origin은 explicit 등록 evidence가 없으면 runtime ownership을 표시하지 않는다.

### 상태·stale·restore

- [제안] launch 접수→starting, 검증 idle/readiness→ready, turn/tool 작업→working, 정확한 permission/input 대기→waiting_input, turn 종료/idle→ready로 매핑한다. Stop/AfterAgent/agent_end를 ended로 복사하지 않는다. pi는 가능하면 agent_settled로 ready를 확정한다. subagent, retry, compaction continuation, session switch를 별도 native evidence로 다룬다.
- [제안] ended는 연결된 process exit 또는 정확한 native session 종료 evidence로만 표시하고 같은 generation의 늦은 working event로 되살리지 않는다. pi session_shutdown의 reload/new/resume/fork는 runtime/session 교체이며 process ended 근거가 아니다. native session 종료와 TUI OS process 생존을 각각 보여 줄 수 있어야 한다.
- [제안] receiver 수신 시각과 native evidence 시각, renderer delivery 시각을 구별한다. reconnect replay로 evidence age를 새로 만들지 않는다. 무호출이 오래됐다고 process 종료/idle로 추정하지 않는다. numeric stale threshold는 adapter manifest에서 테스트하여 확정할 값이며 Orca의 30분을 universal heartbeat 규약으로 가져오지 않는다. 수집 channel 끊김·재시작은 즉시 stale/unknown; 순수 TTL 만료도 unknown이다.
- [제안] renderer만 재생성되면 살아 있는 host의 같은 generation과 최근 output window로 reattach한다. Electron/host 재시작 후 persisted status는 지난 evidence 표시일 뿐 live ready/working이 아니며 새 spawn/resume/argv prompt 복원은 없다. transcript path도 resume handle 참고일 뿐 원문 읽기/보관 허락이 아니다.

## requirements와 다른 점

아래는 requirements/architecture를 고친 내용이 아니라, 참고 구현과의 불일치와 구현 전에 명시할 항목이다.

- **coding-agent/sessions#R2** — [확인] Orca default-on pretrust와 config write는 [Start]가 trust를 대신하지 않는 lophn 요구와 불일치한다. [제안] trust preflight는 상태 안내/검증만, write·skip-trust·자동 Enter는 금지한다. Claude trust와 `.mcp.json` approval, folder trust와 tool permission을 합치지 않는다.
- **coding-agent/sessions#R3, coding-agent/sessions#R4, shell/terminal#R2, shell/terminal#R4, shell/terminal#R12** — [확인] Orca shell-string/fallback과 Paseo Windows `.cmd` string/newline normalization은 direct exact executable/argv/cwd 요구를 그대로 만족하지 않는다. [제안] absolute candidate·profile/version·registered folder를 재검사하고 Windows supported execution target을 manifest에 명시한다; 실패 시 fallback/변형 없음.
- **coding-agent/sessions#R5** — [확인] lophn 10,000ms는 Orca draft 20,000ms/host stdin 60,000ms와 다르다. [제안] deadline의 시작점·adapter signal·late event 처리·write_attempted/unknown을 명시하고 argv first prompt와 stdin composer scanner를 나눈다. timeout을 근거로 trust 수락·prompt replay를 하지 않는다.
- **coding-agent/sessions#R6** — [확인] Orca done와 Paseo idle/finished는 native turn/activity 사실이지 process ended가 아니다. Gemini native ToolPermission과 pi agent_settled를 쓰면 기존 단순 Before/AfterAgent/Tool 또는 agent_end보다 더 정확한 evidence가 된다. [제안] input requestID/native agent attribution·stale timestamp·session switch 의미를 normalizer에 명시한다. 현재 Gemini “Before/After만으로 추정하지 않음” 문구와 모순되지는 않으며 별도 native Notification evidence 추가가 필요하다.
- **coding-agent/sessions#R7, coding-agent/sessions#R8** — [확인] Paseo activity-only body는 native ID evidence를 잃고 vibe-kanban Gemini display ID는 native ACP ID와 다를 수 있다. [제안] terminal/runtime/native provider ID를 분리하고 exact generation/등록 channel만 결합한다. cwd/connection/UUID regex만으로 identity를 만들지 않는다.
- **coding-agent/sessions#R9** — [확인] native hook working/turn done, executor successful exit는 ticket MCP claim·작업 보고와 별개다. [제안] status normalizer는 claim 생성/갱신/반납/완료를 호출하지 않는다. process exit·unknown도 claim 자동 반납의 근거가 아니다.
- **coding-agent/sessions#R10, shell/terminal#R13** — [확인] Orca sleeping/cold-resume 타입 계약, vibe-kanban follow-up/fork/history supervisor는 현재 resume 미지원·자동 재실행 금지와 다르다. [제안] resume argv는 catalog capability 참고만 보관하고 실행 op/UI/restore 경로를 열지 않는다.
- **shell/terminal#R5** — [확인] Orca/Paseo hook token env와 vibe-kanban server password env는 참고 구현의 인증 수단일 뿐 lophn platform credential loader 요구 충족이 아니다. [제안] observation-only capability와 connection credential을 분리하고 전달·상속·출력 비노출을 adapter acceptance check로 명시한다. OS-local child 위조 한계도 안내한다.
- **shell/terminal#R8, shell/terminal#R11** — [확인] executor log/history persistence와 terminal marker parsing을 그대로 가져오면 raw output 비저장/출력의 앱 행동 금지와 충돌할 수 있다. [제안] scanner는 live bounded memory의 readiness evidence만 내보내고 transcript/PTY raw output을 일반 log·ledger·model context에 저장하지 않는다.
