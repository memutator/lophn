---
type: research
concerns: [coding-agent/cli]
---
# coding agent와 script용 CLI

## 질문

coding agent가 CLI의 입력·출력·exit code·help를 추측하지 않고 사용할 수 있는 contract는 무엇인가?
JSON 결과와 event stream, 접수와 성공, 응답 유실과 실패를 어떻게 구별하며 MCP 설정·인증·daemon 연결은 어디까지 맡는가?
lophn의 단일 JSON·scope·keychain-only·설정 조각 출력 contract에 가져올 패턴과 버릴 패턴을 source로 비교한다.

## 프로젝트별

조사일은 2026-10-04다. 기존 clone `/tmp/claude-1000/lophn-research/<name>`의 `git rev-parse HEAD`를 기록했고 checkout·pull·코드 변경은 하지 않았다. 아래 source 경로와 줄 범위는 각 프로젝트 root 기준이다. 외부 프로젝트를 build하거나 실제 계정으로 CLI를 호출하지 않았으므로 runtime·OS별 동작 전체를 검증한 것은 아니다.

- `[확인]`: 해당 revision의 source에서 확인한 사실. 저장소 안 skill 본문은 배포 안내의 내용이지 runtime 성공의 증명이 아니다.
- `[문서]`: 공식 문서에서 확인한 사실. Claude Code의 비공개 구현과 동일하다고 단정하지 않는다.
- `[미확인]`: 이번 조사에서 확인하지 못한 것. 기능 부재를 뜻하지 않는다.
- `[제안]`: lophn에 가져올 설계 또는 후속 결정. 현재 requirements를 바꾼 내용이 아니다.

### GitHub CLI (6fc1c29d5477bfe71da7af290eb481c0df7811f1)

#### 출력·pagination·TTY

- `[확인]` `--json <fields>`는 출력 field projection이다. `--jq <expression>`와 `--template <Go template>`는 JSON exporter에 붙는다. 허용 field 목록 밖 이름, field 없이 쓴 `--json`, `--json` 없는 `--jq`/`--template`, `--web`과 `--json` 조합을 거절한다. 모든 command에 동일 JSON schema가 있다는 뜻이 아니다. 근거: `pkg/cmdutil/json_flags.go:44–143`.
- `[확인]` exporter는 먼저 `json.Encoder.Encode`로 결과를 buffer에 만든다. 기본 경로는 JSON 하나지만 jq는 여러 값·scalar를 낼 수 있고 template은 임의 text다. jq indent는 stdout TTY에서 두 칸이고 color-enabled 기본 JSON은 pretty/color rendering을 거친다. 따라서 `--json`이라는 이름만으로 단일 순수 JSON을 보장하면 안 된다. 근거: `pkg/cmdutil/json_flags.go:225–256`.
- `[확인]` `gh issue list --limit/-L` 기본은 30이고 1 미만은 거절한다. `gh api --paginate`는 REST 요청에 `per_page=100`을 붙이며 page들을 읽는다. `--paginate --slurp`는 page별 array/object를 바깥 JSON array로 감싸지만 no-slurp 경로는 page별 출력이다. 모든 list의 default·상한이 같다는 contract는 확인되지 않았다. 근거: `pkg/cmd/issue/list/list.go:90–113`, `pkg/cmd/api/api.go:345–371`.
- `[확인]` 보통 API body는 content stdout, 진단은 stderr다. 다만 `gh api --verbose`는 HTTP log writer를 stdout으로 바꾸므로 machine-readable body와 섞일 수 있다. 근거: `pkg/cmd/api/api.go:345–355,398–401`.
- `[확인]` TTY는 prompting·pager·색·indent에 쓰인다. `CanPrompt()`는 stdin과 stdout 둘 다 TTY여야 한다. stdout 판정에는 `GH_FORCE_TTY`가 영향을 준다. 이 사실은 pipe에서 자동 JSON을 고른다는 뜻이 아니다. 근거: `pkg/iostreams/iostreams.go:167–191,276–281`, `pkg/cmdutil/json_flags.go:234–252`.

#### exit·입력·help

- `[확인]` 상수는 성공 `0`, 일반 오류 `1`, 사용자 취소 `2`, 인증 필요 `4`, pending `8`이다. `PendingError`는 8, user cancellation은 2, root `AuthError`는 4다. API HTTP 401은 일반 error 경로에서 재인증 안내를 stderr에 쓰고 **1**을 반환한다. 모든 인증 실패가 4는 아니다. no-results와 closed pager pipe는 0이고 extension·shell alias의 exit는 그대로 전달한다. 근거: `internal/ghcmd/cmd.go:41–48,187–236`.
- `[확인]` `gh api -f/--raw-field key=value`는 string, `-F/--field`는 typed 변환·파일 입력을 지원한다. `@path`/`@-`는 file/stdin이고 nested field·array를 구성하면서 모양 충돌과 기존 field override를 거절한다. `--input <file>`/`--input -`는 raw request body다. `--input`과 field가 함께 있으면 field는 query parameter가 된다. 파일 body를 읽는 이 경로는 client의 JSON 종류·domain schema validator가 아니다. 상대 file path는 `os.Open`의 cwd 기준이다. 근거: `pkg/cmd/api/api.go:106–137,248–300,373–383,637–652`, `pkg/cmd/api/fields.go:55–105,160–182`.
- `[확인]` `gh issue create --body-file/-F <file>`은 `-`를 stdin으로 안내한다. 공통 `cmdutil.ReadFile`은 `-`에서 stdin을 끝까지 읽고 그 외는 `os.ReadFile`이다. 근거: `pkg/cmd/issue/create/create.go:183`, `pkg/cmdutil/file_input.go:8–15`.
- `[확인]` help는 usage·command group·flags 중심 text다. `gh help reference`는 command tree에서 hidden command를 빼고 Markdown reference를 만든다. command 이름·short description·local flags·aliases·subcommands가 들어가며 inherited/persistent flags를 합치는 일은 TODO다. JSON help가 아니다. 근거: `pkg/cmd/root/help.go:20–44`, `pkg/cmd/root/help_reference.go:43–77`.
- `[미확인]` 전체 gh command에 대한 `--help --json` 공통 contract, JSON Schema command 목록, 효과 불명 전용 exit code는 확인하지 못했다.

#### 인증

- `[확인]` `ActiveToken(host)`은 `TokenFromEnvOrConfig`를 먼저 보고 없으면 active-user keyring, keyring read 오류이면 old unkeyed keyring token을 시도한다. login에서 secure storage를 선택했어도 keyring write가 실패하면 config의 `oauth_token` plaintext 저장으로 fallback한다. 근거: `internal/config/config.go:254–279,416–435`.
- `[확인]` 실행 help source는 `GH_TOKEN`, `GITHUB_TOKEN` 순서를 명시한다. 다만 dependency `TokenFromEnvOrConfig` 안의 host별 env 처리 전체는 이번에 읽지 않았다. lophn의 coding credential에서 사용자 token/env fallback을 허용할 근거로 삼으면 안 된다. 근거: `pkg/cmd/root/help_topic.go:45–54`.

### beads (c1fc671fcf141457408b17ffbd8a25018fb3527b)

#### JSON·exit·list

- `[확인]` persistent `--json` 기본은 false다. `JSONSchemaVersion=1`, `BD_JSON_ENVELOPE=1`이면 `{schema_version:1,data:<value>}`다. 이전 출력은 object에 `schema_version`을 넣고 array는 그대로 반환한다. envelope pagination은 `{returned,total?,truncated}`이고 envelope가 꺼져 있으면 이 metadata는 JSON에 넣지 않는다. migration 안내는 stderr TTY에서 한 번만 출력한다. 근거: `cmd/bd/main.go:919`, `cmd/bd/output.go:12–55,68–111`.
- `[확인]` 오류 helper가 통일되어 있지 않다. `HandleError`는 stderr text+exit 1, `HandleErrorRespectJSON`은 JSON stdout+1, `HandleErrorWithHint`는 JSON stderr+1, `HandleErrorWithHintRespectJSON`은 JSON stdout+1이다. 기본 error는 `{error,hint?,schema_version}` 또는 envelope이고 capability refusal은 `code,error,mutates,reason?`도 낸다. 한 CLI에서 helper 선택에 따라 error 결과 위치가 달라지는 패턴이다. 근거: `cmd/bd/errors.go:71–176`.
- `[확인]` `bd update`에서 실패가 모두 `--if-assignee`/`--if-status` guard mismatch이면 `ExitGuardMismatch=13`, 다른 실패가 하나라도 섞이면 1이다. JSON multi-ID update는 성공한 issue들을 stdout에 남기고 stderr 마지막 compact JSON에 `{error,failed,schema_version}`를 쓴다. `failed[]`에는 `id,error,guard_mismatch?`가 있다. exit 13은 이 update contract이며 모든 conflict의 공통 exit가 아니다. 근거: `cmd/bd/update.go:842–865,883–930`.
- `[확인]` list limit 선택은 explicit `--limit` → `--all` unlimited → `list.limit` 설정 → 환경 default다. explicit 0은 unlimited, pipe stdout도 unlimited, agent mode의 terminal은 20, 그 외 default 50이다. `--offset` 음수는 거절한다. agent context를 줄이는 terminal 기본과 script의 완전한 목록을 서로 다르게 택했다. lophn의 bounded cursor와는 반대 선택이다. 근거: `cmd/bd/list.go:423`, `cmd/bd/list_input.go:348–368,413–435`, `internal/workapi/list.go:16–24`.

#### 입력·agent 안내·help

- `[확인]` `--body-file -`와 `--stdin`은 stdin, 일반 path는 cwd-relative `os.Open`이다. body file과 inline description/body/message를 함께 주거나 서로 다른 body-file/description-file을 주면 거절한다. 본문은 `io.ReadAll` text이며 이 helper 자체에 JSON 종류 검증은 없다. 근거: `cmd/bd/flags.go:15–28,46–85,190–212`.
- `[확인]` `bd onboard`는 AGENTS.md 등에 붙일 작은 snippet을 stdout에 출력한다. 이 command 자체가 파일에 설치하지는 않는다. snippet은 dynamic `bd prime`·hooks 안내와 `bd ready`, `bd create`, `bd close`, `bd dolt push` 같은 다음 command를 제공한다. full profile은 `bd init --agents-profile=full`로 안내한다. 근거: `cmd/bd/onboard.go:13–39,41–142`.
- `[확인]` `bd prime`은 beads directory가 없으면 plain mode 빈 출력/success, `--hook-json`이면 빈 context를 가진 hook envelope를 반환한다. memories/context 생성 오류도 nil로 끝내는 경로가 있다. hook JSON은 `{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:<text>}}`다. agent 세션 시작을 막지 않는 fail-open 성격이지만 일반 read 실패까지 빈 성공으로 취급할 근거는 아니다. 근거: `cmd/bd/prime.go:150–239,329–342`.
- `[확인]` help는 Cobra usage를 text로 출력한다. `bd schema`는 실제 serialize하는 Go type reflection으로 `{schema_version,types}` JSON Schema를 만들며 store를 요구하지 않고 raw JSON으로 출력한다. output type discovery이지 command별 read/write·권한·next를 가진 JSON help와 같지 않다. 근거: `cmd/bd/main_help.go:14–33`, `cmd/bd/schema.go:12–61`.
- `[확인]` Dolt config의 `ServerPassword`가 비어 있으면 `BEADS_DOLT_PASSWORD`, `RemotePassword`가 비어 있으면 `DOLT_REMOTE_PASSWORD`를 읽는다. 코드의 실제 조건은 nonempty config 값 우선이다. remote env 우선이라는 주석만 읽고 반대로 기록하면 안 된다. 근거: `internal/storage/dolt/store.go:414–445,1704–1714`.
- `[미확인]` beads 전체 credential source에 대한 keyring·file 우선순위, 인증/취소/효과 불명의 공통 exit table, 전체 command의 JSON help는 확인하지 못했다.

### Orca (fd030c404074f1100e5eedab59aec3dac7e6d1f5)

#### JSON·입력·machine discovery

- `[확인]` runtime 성공 JSON은 RPC success envelope를 formatter에 넘기기 전에 출력한다. `--json` 실패는 stdout에 RPC failure 또는 local `{id:"local",ok:false,error:{code,message,data},_meta:{runtimeId:null}}`를 쓴다. text 오류는 stderr다. entrypoint는 오류에 `process.exitCode=1`을 설정한다. syntax/flag 검증은 runtime lookup 전에 한다. 명시 `--json` 선택이며 TTY에서 JSON을 자동 선택하는 분기는 확인하지 않았다. 근거: `src/cli/format.ts:67–76`, `src/cli/cli-error.ts:37–131`, `src/cli/index.ts:108–119,180–193`.
- `[확인]` `--text-stdin`/`--value-stdin`은 각각 inline flag와 충돌하면 `invalid_argument`, stdin TTY이면 거절한다. empty text는 거절하지만 value의 empty string은 허용한다. `--source-context`는 JSON.parse 후 null 또는 object를 받고 `normalizeTaskSourceContext`로 종류를 검사한다. 숫자 helper도 positive/nonnegative integer 및 finite positive number를 구별한다. 근거: `src/cli/handlers/computer-action-flags.ts:176–207`, `src/cli/handlers/automation-handler-flags.ts:251–288`, `src/cli/flags.ts:95–143`.
- `[확인]` 일반 help는 `CommandSpec` registry에서 usage·summary·options·notes·examples를 만드는 text다. 별도로 **`orca agent-context --json`**이 같은 live spec table을 serialize한다. `{schemaVersion:1,commandCount,commands[]}`이며 각 command는 `command,path,aliases,argumentMode,summary,usage,flags,positionalArgs,examples,notes`를 갖는다. hidden command는 제외하고 command 이름순으로 정렬한다. app가 없어도 local read로 동작한다. 출력 JSON Schema·권한 필드는 이 타입에 없다. 근거: `src/cli/help.ts:11–79`, `src/cli/agent-context.ts:7–51`, `src/cli/handlers/introspection.ts:5–15`, `src/cli/specs/introspection.ts:4–13`.

#### skill·effect unknown

- `[확인]` `skills/orca-cli/SKILL.md:1–47`은 discovery stub이다. executable 선택은 `ORCA_CLI_COMMAND` → dev `ORCA_DEV_REPO_ROOT`이면 `orca-dev` → Linux unmanaged terminal이면 `orca-ide` → 나머지 `orca`다. bare Linux `orca`가 screen reader일 수 있음을 경고하고, 선택 binary가 실패하면 다른 binary로 fallback하지 않는다. 첫 조회는 `ORCA skills get orca-cli`, agent 호출은 `--json` 우선, 모르는 option은 help로 확인한다. `runtime_access_denied`는 sandbox 문제이므로 app open/restart를 반복하지 않도록 한다.
- `[확인]` version-matched full guide는 receipt 해석을 구체적으로 가르친다. handoff의 완료는 prompt send `accepted:true`와 handle 전달이며 worker 완료를 뜻하지 않는다. `terminal wait`가 결과를 출력했어도 `wait.satisfied:false`이면 준비가 안 된 것이다. handle stale이면 재목록 후 replacement 하나만 쓰고 양쪽에 dual-send하지 않는다. guide에 적힌 이 규칙은 runtime 코드 전체 검증과 구별한다. 근거: `skill-guides/orca-cli.md:17–56,127–134`.
- `[확인]` durable orchestration mutation은 제공한 request ID 또는 UUID를 사용한다. 기본 request timeout은 60,000ms다. timeout/unavailable/invalid response에서 request ID가 있으면 `recovery`에 `orchestrationRequestId,dispatchId?,queryCommand,retryCommand?,recoveryBlocked,disposition:"outcome_unknown",workerDeathInferred:false`를 붙인다. read는 `worker-show --dispatch` 또는 `request-show --request`; retry는 원래 command에 `--retry-request <same-id>`를 붙인다. absent 결과도 retry 안전의 증거가 아니다. transport 오류를 실제 worker 실패로 추정하지 않는 구현이다. 근거: `src/cli/runtime/client.ts:63–169`, `src/cli/orchestration-mutation-recovery.ts:11–88`.

#### 로컬 연결·인증

- `[확인]` 로컬 app 연결은 고정 port 탐색이 아니라 **`orca-runtime.json` metadata IPC**다. metadata의 unix socket/named pipe transport와 `authToken`이 없거나 file read/parse가 실패하면 `runtime_unavailable` 및 app 시작 안내를 반환한다. userData 선택은 `ORCA_USER_DATA_PATH` → OS별 위치(macOS Application Support/orca, Windows APPDATA/orca, Linux XDG_CONFIG_HOME 또는 ~/.config/orca)다. 근거: `src/cli/runtime/metadata.ts:11–69`.
- `[확인]` socket 내부 요청은 `{id,authToken,method,params,orchestrationCapability,orchestrationContractVersion,orchestrationRequestId,...}` JSON 한 줄이다. 내부 IPC framing이 JSONL이라고 CLI stdout도 event stream인 것은 아니다. remote pairing은 `ORCA_PAIRING_CODE ?? ORCA_REMOTE_PAIRING`과 `ORCA_ENVIRONMENT`도 사용한다. 근거: `src/cli/runtime/transport.ts:195–207`, `src/cli/runtime/client.ts:63–91`.
- `[미확인]` 모든 Orca mutation이 위 durable recovery 대상인지, 로컬 metadata token의 OS keychain 보관 정책, command 전체의 limit/cursor 기본·상한은 확인하지 못했다. app 연결 안내를 headless daemon lifecycle과 동일시하지 않는다.

### Paseo (0d05584d044f5a72212d509ead7af0532dd105e2)

#### 출력·입력

- `[확인]` 기본 `--format`은 table이고 `--json`은 JSON format alias다. wrapper가 받는 format은 table/json/yaml(`cli`는 table alias), unknown은 `INVALID_FORMAT`이다. `outputSchema` 값이 있는 경로는 JSON과 non-quiet를 강제한다. 정상 결과는 stdout+newline, 실패는 stderr+exit 1이다. JSON error도 stderr `{error}`다. 기본 wrapper를 쓰지 않는 command까지 단일 envelope라고 일반화할 수 없다. 근거: `packages/cli/src/cli.ts:45–58`, `packages/cli/src/output/with-output.ts:23–58,80–99`, `packages/cli/src/output/render.ts:16–88`.
- `[확인]` JSON serializer는 기본 `result.data`를 출력하고 schema serializer가 override할 수 있다. list의 serialize 결과가 모두 같으면 한 object로 축약하는 경로도 있다. `--quiet`와 JSON 조합은 일반 render 경로에서 quiet가 우선한다. default table은 non-TTY에서 자동 JSON으로 바뀌지 않는다. 근거: `packages/cli/src/output/json.ts:10–40`, `packages/cli/src/output/render.ts:16–47`.
- `[확인]` `agent send`는 positional prompt·`--prompt`·`--prompt-file` 중 정확히 하나다. 여러 source는 `CONFLICTING_PROMPT_INPUT`, 없음은 `MISSING_PROMPT`, 파일은 `readFile(resolve(path),"utf8")`여서 cwd-relative다. 근거: `packages/cli/src/commands/agent/send.ts:97–139`.
- `[확인]` `agent logs`는 transcript text를 직접 출력한다. follow는 history(default tail 10) 이후 subscription event를 계속 text로 출력하고 timeline replacement/reconnect 문장도 stdout에 넣는다. `--tail 0` non-follow는 빈 출력이다. `renderJsonLine` helper의 존재만으로 이 command를 NDJSON이라고 볼 수 없다. 근거: `packages/cli/src/commands/agent/logs.ts:112–154,158–208`, `packages/cli/src/output/json.ts:33–40`.
- `[미확인]` 공통 `--help --json`·완전한 machine-readable command 목록, 모든 list의 bounded pagination, error stack/message의 전 경로 redaction은 확인하지 못했다.

#### endpoint 선택·lifecycle·credential

- `[확인]` target은 `{kind:"instance",home}` 또는 `{kind:"endpoint",host}`다. explicit `--home`과 `--host`는 둘 다 있으면 `TARGET_AMBIGUOUS`, empty면 `TARGET_INVALID`. explicit flag가 env보다 우선하며 flag가 없을 때 `PASEO_HOME`과 `PASEO_HOST` 둘 다 있으면 **거절**한다. `PASEO_HOST`는 endpoint, 나머지는 home instance다. local-only operation은 `--host`를 거절한다. 근거: `packages/cli/src/utils/daemon-target.ts:3–36`.
- `[확인]` home default는 `~/.paseo`, `PASEO_HOME`의 `~`를 expand하고 path.resolve한다. instance 연결은 alive PID lock의 **실제 `listen`**을 기다린다. 없는 instance는 `DAEMON_NOT_RUNNING`, 다른 instance로 바뀌면 `DAEMON_REPLACED`, PID가 살아도 listen이 없으면 `DAEMON_NOT_READY`다. persisted `config.json`의 default listen `127.0.0.1:6767`은 launch 설정이지 metadata read 실패 뒤 무조건 붙는 client fallback이 아니다. 근거: `packages/server/src/server/paseo-home.ts:4–17`, `packages/server/src/server/daemon-instance.ts:46–91`, `packages/server/src/server/persisted-config.ts:344–348`, `packages/cli/src/utils/client.ts:300–310`.
- `[확인]` `daemon start` readiness timeout default 600초, 결과는 `action:started|already_running,home,pid,listen,logPath`다. `daemon stop` graceful default 15초, `--force` 후 deadline default 3초이며 endpoint target에서 force는 거절한다. remote stop 결과는 `shutdown_requested`이고 remote process exit는 검증하지 않았다고 표시한다. 로컬 stop helper는 `stopped|not_running`, PID·instance identity를 보고 확인하며 SIGTERM 경로가 있다. 근거: `packages/cli/src/commands/daemon/start.ts:7–34`, `packages/cli/src/commands/daemon/stop.ts:9–65`, `packages/server/src/server/daemon-instance.ts:132–203`.
- `[확인]` `daemon status`는 `localDaemon:stopped|running|not_ready`와 `connectedDaemon:not_probed|unreachable|auth_required|auth_failed|reachable`를 분리한다. PID·listen·configuredListen·serverId·logPath와 live worker/provider/version 관측을 낸다. probe와 RPC default 1,500ms다. local auth 실패는 관측 data가 될 수 있지만 explicit endpoint 실패는 error다. 따라서 status exit 0만 보고 연결 성공이라고 판단하지 않는다. 근거: `packages/cli/src/commands/daemon/status.ts:21–133`.
- `[확인]` client connect timeout default 15초. password 우선순위는 tcp URI password → `PASEO_PASSWORD` → 해당 target의 local credential이다. local credential은 home의 `local-credential`에 random 32-byte base64url(43글자), mode 0600 temporary-write/rename으로 저장한다. `paseo.pid`의 listen과 선택 endpoint가 정규화 후 같아야 이 token을 읽는다. keychain-only 모델은 아니다. target 진단은 URI password·token/secret query·hash를 redaction한다. 근거: `packages/cli/src/utils/client.ts:38,172–189`, `packages/server/src/server/local-credential.ts:10–39,68–79`, `packages/cli/src/utils/daemon-target.ts:39–49`.

### Codex (3a69ec3ef8fb87b41e99b8942af061ad58ae6732)

#### exec JSONL·exit·stdin

- `[확인]` `codex exec --json`(alias `--experimental-json`)은 default false이며 **stdout JSONL event stream**이다. 단일 operation 결과 JSON이 아니다. color default auto, 최종 메시지는 `--output-last-message/-o FILE`로 별도 저장할 수 있다. 근거: `codex-rs/exec/src/cli.rs:59–85`, `codex-rs/exec/src/lib.rs:1–3`.
- `[확인]` `ThreadEvent`는 `type` tagged enum이다. `thread.started{thread_id}`, `turn.started`, `turn.completed{usage}`, `turn.failed{error:{message}}`, `item.started|updated|completed{item}`, `error{message}`가 있다. item은 `id`와 tagged details를 갖고 agent_message/reasoning/command_execution/file_change/mcp_tool_call 등으로 구별한다. usage는 input/cached input/cache write input/output/reasoning output tokens다. command execution item의 `exit_code`와 status(in_progress/completed/failed/declined)는 **child 작업의 결과**이며 Codex process exit와 다르다. event마다 serde_json compact 한 줄을 println한다. 근거: `codex-rs/exec/src/exec_events.rs:8–164`, `codex-rs/exec/src/event_processor_with_jsonl_output.rs:106–108`.
- `[확인]` exec loop는 fatal error 및 failed/interrupted turn을 `error_seen`으로 기록하고 shutdown/final output 뒤 1로 종료한다. 정상은 Ok다. 일반 오류·취소를 gh처럼 별도 숫자로 나누거나 효과 불명을 전용 process exit로 구별하는 contract는 이 경로에서 확인하지 못했다. 근거: `codex-rs/exec/src/lib.rs:1290–1398`.
- `[확인]` prompt가 없거나 `-`면 stdin을 사용하고 positional prompt+piped stdin은 추가 `<stdin>` context로 붙일 수 있다. required input인데 terminal이면 안내+exit 1, stdin read/decode 실패와 required empty input도 1이다. optional append empty는 None이다. positional/file/source 충돌을 항상 거절하는 lophn 방식과 다르다. 근거: `codex-rs/exec/src/cli.rs:76–85`, `codex-rs/exec/src/lib.rs:2304–2348`.
- `[미확인]` clap parse 실패의 entrypoint exit mapping·JSON error 보장, 일반 exec JSONL에 없는 early startup 실패의 전체 출력, provider/env별 인증 우선순위는 확인하지 못했다.

#### MCP 관리·auth store

- `[확인]` `codex mcp`는 list/get/add/remove/login/logout이다. list/get만 Args에서 `--json`을 지원한다. add는 `codex mcp add [OPTIONS] <NAME> (--url <URL> | -- <COMMAND>...)`, command Vec과 URL은 required exclusive group이다. stdio env는 KEY=VALUE parser, HTTP는 bearer-token-env-var·OAuth option이 있다. 근거: `codex-rs/cli/src/mcp_cmd.rs:57–173,240–277`.
- `[확인]` add는 global servers에 entry(enabled true, required false, timeout 없음)를 넣고 `ConfigEditsBuilder.replace_mcp_servers(...).apply()`로 CODEX_HOME 설정을 **쓴다**. 이후 HTTP OAuth support를 감지하면 즉시 OAuth flow를 시작할 수 있다. remove도 global map을 다시 써서 제거하며 없는 이름은 정상 success다. TOML `mcp_servers` 형태의 native 관리이며 config 조각 출력이 아니다. 근거: `codex-rs/cli/src/mcp_cmd.rs:424–504,509–539`.
- `[확인]` list JSON은 array다. `name,enabled,disabled_reason,transport,startup_timeout_sec,tool_timeout_sec,auth_status`를 낸다. stdio transport는 `type,command,args,env,env_vars,cwd`, HTTP는 `url,bearer_token_env_var,http_headers,env_http_headers,http_headers_helper`다. get JSON은 이에 enabled/disabled tools도 포함하고 missing name은 error다. helper는 `<redacted>`지만 env/http_headers 값을 그대로 serialize하는 경로가 있어 모든 credential이 redaction된다고 가정하면 안 된다. 근거: `codex-rs/cli/src/mcp_cmd.rs:724–784,962–1018`.
- `[확인]` CLI auth store default는 **File**(`CODEX_HOME/auth.json`), 선택지는 Keyring(fail if unavailable), Auto(keyring→file), Ephemeral이다. MCP OAuth store default는 Auto이며 file은 `CODEX_HOME/.credentials.json`이다. Auto load에서 keyring missing/error면 file, save에서 keyring 실패면 file이다. lophn이 참고할 것은 Keyring fail-closed option이지 default File/Auto가 아니다. 근거: `codex-rs/config/src/types.rs:113–143`, `codex-rs/login/src/auth/storage.rs:47–73,478–527`.

### Gemini CLI (fb972b2f87fe7d5b06d37eac711490162d98de2c)

#### MCP command·입력·연결 점검

- `[확인]` `gemini mcp` 등록은 add/remove/list/enable/disable이고 하나의 subcommand를 요구한다. 이 registry에는 get이 없다. add는 `add <name> <commandOrUrl> [args...]`, scope default **project**(user/project), transport default stdio(stdio/sse/http)다. stdio config는 `command,args,env`, remote는 `url,type,headers`; timeout/trust/description/include-tools/exclude-tools도 저장한다. 근거: `packages/cli/src/commands/mcp.ts:16–31`, `packages/cli/src/commands/mcp/add.ts:13–138,140–220`.
- `[확인]` native add는 선택 scope의 `mcpServers`를 settings.setValue로 **쓴다**. project가 home이면 거절·exit 1이며 같은 이름은 overwrite 안내 후 덮는다. remove도 선택 scope만 고치고 absent는 not-found 문구 뒤 정상 return이다. global/workspace settings path는 각각 `~/.gemini/settings.json`, `<target>/.gemini/settings.json` 조립이다. 근거: `packages/cli/src/commands/mcp/add.ts:36–55,117–138`, `packages/cli/src/commands/mcp/remove.ts:13–63`, `packages/core/src/config/storage.ts:54–59,78–79,203–204,344–345`.
- `[확인]` add stdio env는 `curr.split('=')`의 앞 두 조각만 꺼내며 key/value가 둘 다 truthy일 때 저장한다. 추가 `=`가 있는 값은 잘리고 empty value·잘못된 항목은 조용히 빠진다. `--` 뒤 server argv를 분리해 주는 기능과 env 값 보존은 별개다. lophn env parser는 첫 `=`에서만 자르고 invalid 항목을 명시 거절해야 한다. 근거: `packages/cli/src/commands/mcp/add.ts:93–107,140–220`.
- `[확인]` list는 기본 connect timeout **5,000ms**(server timeout override)로 실제 MCP 연결을 시도한다. 연결 뒤 ping 실패만으로 연결 성공을 뒤집지는 않는다. trust·disabled·extension merge·admin allowlist도 본다. 사람 text로 connected/disconnected/disabled/blocked 등을 표시하므로 config 존재만 보여 주는 목록과 다르다. stdio probe가 server를 시작할 수 있다는 비용·trust 경계도 고려해야 한다. 근거: `packages/cli/src/commands/mcp/list.ts:70–191,205–291`.
- `[미확인]` 해당 MCP list/help의 안정된 JSON mode 및 인증/취소/효과 불명의 process exit table은 확인하지 못했다. list의 connect 성공은 skill·hook loading이나 실제 agent의 도구 사용을 증명하지 않는다.

#### API key·fallback

- `[확인]` content generator의 env는 `config.env[key]`가 process.env보다 우선한다. Google login/ADC는 API key keychain probe보다 먼저 return한다(특히 Linux Secret Service hang 회피). Gemini API key는 explicit apiKey → `GEMINI_API_KEY` → `loadApiKey()`이며 Vertex는 `GOOGLE_API_KEY`를 사용한다. key read cache는 30초, load 오류는 log 후 null이다. 근거: `packages/core/src/core/contentGenerator.ts:150–204`, `packages/core/src/core/apiKeyCredentialStorage.ts:12–49`.
- `[확인]` HybridTokenStorage는 keychain 또는 encrypted-file backend를 쓴다. `GEMINI_FORCE_FILE_STORAGE=true` 또는 WSL에서 native keychain을 skip하며 native unavailable도 `FileKeychain`으로 fallback한다. file은 `~/.gemini/gemini-credentials.json`, AES-256-GCM이며 key는 hostname·username salt와 고정 문자열의 scrypt로 만든다. OS keychain 보안과 같다고 볼 수 없다. directory mode 0700이다. 근거: `packages/core/src/mcp/token-storage/hybrid-token-storage.ts:27–46`, `packages/core/src/services/keychainService.ts:22,110–136`, `packages/core/src/services/fileKeychain.ts:18–45,80–95`.

### OpenCode (907b3bc518fa48e90e8ec24dd327d13eee71c36c)

#### MCP 관리·argv·status

- `[확인]` MCP command registry는 add/list(alias ls)/auth/logout/debug다. 이 registry에는 get/remove가 없다. list는 실제 MCP status와 stored token 상태를 사람 prompt output으로 보여 주며 connected/disabled/needs_auth/needs_client_registration/failed/not_initialized를 구별한다. 근거: `packages/opencode/src/cli/cmd/mcp.ts:95–168`.
- `[확인]` noninteractive add는 `[name] --url <URL>` 또는 `--` 뒤 argv 중 정확히 하나를 요구한다. URL.canParse, remote에 env 또는 local에 header는 거절한다. env/header는 **첫 `=`**에서 잘라 나머지 값과 empty value를 보존한다. local config는 `mcp.<name>={type:"local",command:[executable,...args],environment?}`, remote는 `{type:"remote",url,headers?}`다. noninteractive 경로는 global config에 쓴다. 근거: `packages/opencode/src/cli/cmd/mcp.ts:429–500`.
- `[확인]` config 파일 후보는 실제 코드상 opencode.json → opencode.jsonc → project .opencode/opencode.json → .jsonc다. comment의 jsonc 우선 설명과 순서가 다르다. 없으면 opencode.json을 새로 쓰고 jsonc-parser로 `mcp.<name>`을 수정해 comment를 보존한다. interactive add는 git project에서 scope를 묻지만 local command를 `split(" ")`하므로 quoted path·shell escaping을 보존하는 argv parser가 아니다. 근거: `packages/opencode/src/cli/cmd/mcp.ts:394–424,508–575`.
- `[확인]` 일부 auth 거절(missing/not OAuth)은 error를 log한 뒤 정상 return하고 OAuth catch도 error 문구 후 Done 경로로 간다. 이 command에서 error 문구만 보고 nonzero exit를 추론하면 안 된다. 근거: `packages/opencode/src/cli/cmd/mcp.ts:227–237,293–302`.
- `[미확인]` MCP command 전체의 JSON 출력·JSON help·안정된 process exit table은 확인하지 못했다.

#### credential

- `[확인]` MCP OAuth tokens는 `Global.Path.data/mcp-auth.json`에 accessToken/refreshToken/expiresAt/scope 및 client info로 저장한다. serverUrl에 묶고 flock으로 잠근 뒤 mode 0600 JSON file을 쓴다. read/parse 실패는 empty object다. 근거: `packages/opencode/src/mcp/auth.ts:9–38,65–94`.
- `[확인]` provider auth도 `Global.Path.data/auth.json`이다. `OPENCODE_AUTH_CONTENT` JSON env가 parse되면 file보다 우선하고 invalid env는 file로 내려간다. file read 실패는 empty이며 write mode는 0600이다. 이 API의 file/env 우선순위와 각 provider의 API-key env 우선순위는 같은 질문이 아니다. 근거: `packages/opencode/src/auth/index.ts:10,58–88`.
- `[미확인]` provider별 API-key env와 저장 auth의 최종 선택 전체는 확인하지 못했다. mode 0600이 있어도 keychain-only는 아니다.

### Claude Code (공식 문서, 2026-10-04 확인)

- `[문서]` 공식 MCP 문서: <https://code.claude.com/docs/en/mcp>. stdio는 `claude mcp add --transport stdio <name> -- <command> [args...]`. CLI option과 server argv를 `--`로 나누고 `--env KEY=value`를 제공한다. `claude mcp list`, `get <name>`, `remove <name> [--scope <scope>]`, `add-json <name> '<server-object>'`를 제공한다. add-json은 `mcpServers` wrapper가 아니라 안쪽 server object를 받는다.
- `[문서]` scope default local은 `~/.claude.json`의 `projects[absolute-project-path].mcpServers`, project는 project root `.mcp.json`, user는 `~/.claude.json` top-level이다. 이름이 겹치면 local → project → user이고 winning entry 전체를 쓰며 scope끼리 field merge하지 않는다. managed MCP 설정은 그 위에 있다. project server는 interactive trust/approval이 따를 수 있다.
- `[문서]` native add는 설정을 실제로 만든다/고친다. list는 Connected/Needs authentication/Failed to connect health를 표시한다. remote server remove는 stored OAuth token도 제거한다. list에 WebSocket server가 보이지 않을 수 있어 get 또는 interactive `/mcp`를 안내한다.
- `[미확인]` 이 공식 문서에서 `claude mcp list|get --json`, MCP 관리 command의 JSON error·process exit table·credential fallback 구현은 확인하지 못했다. 문서상의 health가 lophn의 네 단계 loading 전체와 같다는 보장도 없다.

## 비교

### machine interface

| 프로젝트 | JSON 정상 결과 | 오류·exit | 입력 source | help·agent discovery | limit/TTY/stream |
|---|---|---|---|---|---|
| gh | field projection, jq/template | 보통 stderr; 0/1/2/4/8, HTTP401은1 | typed field @file/@-, raw --input, --body-file - | text help, Markdown reference | issue 기본30; api page100; paginate no-slurp 여러 결과; TTY는 presentation/prompt |
| beads | array 또는 object, 선택 schema_version/data envelope | helper별 stdout/stderr 차이; 일반1, update guard-only13 | body-file/-/stdin, inline과 충돌 검사 | onboard snippet, prime context, type schema | explicit limit 우선; pipe unlimited, agent terminal20, 보통50; hook fail-open |
| Orca | RPC envelope, local schema read 예외 | JSON stdout error; 일반1, outcome_unknown recovery data | explicit stdin flag, JSON type/수치 검사 | live registry agent-context JSON, version-matched skill | 내부 IPC JSON line과 stdout 별개; 전체 pagination 미확인 |
| Paseo | result.data와 serializer, table/json/yaml | JSON error stderr, 일반1 | prompt 3 source 중 하나, cwd file | command별 help; JSON command 목록 미확인 | agent logs는 text follow; default table, quiet 우선 |
| Codex exec | type-tagged JSONL events | failed/interrupted turn1; child exit 별도 | prompt/stdin, optional append | exec Args text help; MCP list/get JSON | stream이고 단일 결과 아님 |
| Gemini mcp | 조사한 list는 사람 status | add failure1, absent remove success | command+argv; env parser가 추가 =/empty 손실 | add/list/remove/enable/disable registry | list probe 기본5초; JSON help 미확인 |
| OpenCode mcp | 조사한 list는 사람 status | 일부 auth error도 정상 return | -- argv 안전, interactive split 공백 | add/list/auth/logout/debug registry | JSON help·pagination 미확인 |
| Claude mcp | [문서] 사람 health·config 안내 | exit/JSON 미확인 | -- argv, add-json server object | [문서] add/list/get/remove | health가 loading 전체는 아님 |
| lophn 현재 contract | summary/data/next, stdout JSON 하나 | 0/2/3/4/5/6/1; effect_unknown 구별 | inline 또는 file 하나, cwd-relative | 모든 command help/JSON, 권한/next | scope 뒤 bounded cursor; 일반 read와 hook 예외 분리 |

### MCP 설정·인증·로컬 runtime

| 프로젝트 | native config mutation | credential 경로·우선순위의 확인 범위 | daemon/runtime 관측 |
|---|---|---|---|
| gh | MCP 대상 아님 | env/config → keyring; keyring write 실패 plaintext fallback | 해당 조사 대상 아님 |
| beads | onboard는 출력만 | Dolt nonempty config → env; 전체 auth 미확인 | 이 조사에서는 Dolt lifecycle 상세 제외 |
| Orca | 이 조사에서 harness 설치 변경은 다루지 않음 | local metadata authToken; remote pairing env | userData metadata IPC; app restart 권고를 sandbox failure와 분리 |
| Paseo | persisted daemon config와 PID state | URI password → env → matching-instance credential file0600 | home/endpoint 분리; actual listen; local/live/auth 상태; remote stop receipt만 |
| Codex | global TOML mcp_servers 쓰기, add 뒤 OAuth 가능 | CLI default File, MCP OAuth default Auto; Keyring fail-closed 선택 가능 | MCP auth/config 상태와 실행 loading을 구별해야 함 |
| Gemini | user/project mcpServers settings 쓰기 | explicit API key → env → hybrid storage; encrypted-file fallback | trust-aware actual MCP connect probe |
| OpenCode | mcp.<name> JSON/JSONC 쓰기 | env auth content → auth file; MCP auth file0600 | actual MCP statuses, auth 오류 문구와 exit 분리 필요 |
| Claude | [문서] local/project/user 설정 쓰기 | 구현 미확인 | [문서] list health, project approval, get fallback |
| lophn 현재 contract | mcp config는 안전 조각만; 관리 install은 별도 사람 권한·receipt | secret OS keychain-only; coding credential에 user fallback 금지 | doctor 각 단계와 unknown; daemon 관리 coding 거절 |

### lophn exit의 의미와 다른 CLI 숫자

현재 lophn 기준은 `docs/architecture/coding-agent.md:128–148,205–239`다. 숫자만 타 CLI와 맞추면 의미가 달라진다.

| lophn exit | 의미 | 비교·유의 |
|---|---|---|
| 0 | 정상 read·접수·approval 대기 | gh8 pending과 다르다. Codex turn.completed·Orca accepted·Paseo shutdown_requested를 실제 성공/종료로 올려 쓰지 않는다. |
| 2 | 입력 검증 실패 | gh2는 사용자 취소다. 같은 숫자를 같은 의미로 재사용하면 안 된다. |
| 3 | 인증/범위 실패 | gh root AuthError4와 HTTP401의1 모두 이 범주로 정규화할 수 있다. user credential fallback은 금지한다. |
| 4 | 실제 작업/test 실패 | gh4 인증 필요와 다르다. child exit나 test receipt만으로 확정하지 않고 실제 결과를 읽는다. |
| 5 | 전송 실패 | response를 잃은 mutation은 이 값으로 뭉치지 않는다. dispatch 전 실패인지 모르면6이다. |
| 6 | 쓰기 응답 유실·effect_unknown | Orca outcome_unknown+read-first recovery가 직접적인 참고다. 일반 unavailable/timeout과 별도 의미다. |
| 1 | 내부 실패 | beads·Codex 일반1보다 구체적인 나머지 category를 우선한다. |

`[미확인]` 현재 lophn 표에는 사용자 취소·SIGINT·broken stdout pipe의 독립 처리 규칙이 없다. 새 exit 숫자를 조사 결과만으로 결정하지 않는다. 쓰기 중 취소도 effect를 모르면6이라는 원칙을 먼저 지켜야 한다.

## lophn에 가져올 것과 버릴 것

### 가져올 것

1. `[제안]` **한 operation, 한 JSON 결과**를 유지한다. success/error writer를 하나로 만들고 parse/unknown command/flag 충돌/connection 실패에도 JSON 선택을 가능한 한 먼저 알아낸다. 성공은 `{summary,data,next}`, 실패는 안전한 `{code,message,details}`를 platform contract대로 출력한다. stderr만 보고 domain 결과를 조립할 필요가 없어야 한다. newline·no ANSI·no progress/banner를 golden test로 확인한다.
2. `[제안]` operation registry에서 사람 help와 machine help를 함께 만든다. Orca `agent-context`처럼 local·headless에서도 가능하게 하고 version, canonical command, 입력 source·종류·default·범위, 출력 schema, read/write, 사람 전용, confirmation, next read를 넣는다. lophn의 기존 `help --json`으로 표현할 수 있으므로 새 별칭 command는 필요 없다.
3. `[제안]` 입력 source는 먼저 exclusive 검증하고 schema/숫자/enum/path 오류는 dispatch 전에 거절한다. stdin을 채택한다면 별도 충돌 규칙·byte 상한·TTY 거절을 정한 뒤 `--input-file -`로 명시해야 한다. implicit stdin append나 unknown option passthrough는 넣지 않는다. env 조각은 문자열 map과 분리 argv로 제공하고 값에 추가 `=`·공백·empty가 있어도 보존한다.
4. `[제안]` bounded cursor 결과는 scope를 적용한 뒤 `returned`, 허용된 remaining, `next_cursor`, truncated/missing 이유를 낸다. 문서1–500·ticket1–20·invocation최대20·log1–2,000의 현재 상한을 유지한다. TTY에 따라 의미나 limit가 바뀌지 않게 하고 잘못된 cursor는 빈 성공이 아니라 입력 실패다.
5. `[제안]` effect_unknown의 `details`/`next`에는 원래 idempotency key, target·invocation 참조, 실행 가능한 **분리 argv 형태의 read**를 준다. read-first이며 absent도 안전한 새 실행의 증거가 아니다. 동일-key retry는 소유 core contract가 replay/join을 보장할 때만 별도로 안내하고 자동 새 key 실행은 금지한다.
6. `[제안]` skill은 작은 stable pointer와 executable에서 얻는 version-matched help를 결합한다. receipt field 해석(접수/실제 성공/test pass/approval 대기), 재조회, 금지 작업, MCP-only claim을 안내한다. hook의 빈 stdout/exit0은 세션 시작용 예외에만 두고 doctor·명시 summary에서는 failure를 보존한다.
7. `[제안]` `mcp config`는 선택 harness의 config **조각만** 반환한다. Claude/Gemini의 command+args+env, Codex의 command/args/env TOML, OpenCode의 local command array/environment를 native schema대로 만들되 shell string을 중간 format으로 쓰지 않는다. token 값 대신 connection ID·안전 env를 넣는다. native add command를 자동 실행하거나 OAuth flow를 열지 않는다.
8. `[제안]` doctor는 config 존재, MCP connect, 도구 discovery, skill/hook loading을 별도 관측으로 낸다. native list가 연결 probe를 수행해도 실제 세션의 모든 loading을 확인한 것으로 올리지 않는다. trusted·명시한 target만 bounded probe하고 unavailable/disabled/auth_required/unknown과 관측 시각·instance identity·next를 구별한다.
9. `[제안]` daemon target을 flag→env→metadata→default port 하나로 단순화하지 않는다. 선택된 instance의 endpoint·PID/start identity를 사용하고 ambiguous selection·replacement는 거절한다. endpoint remote stop의 receipt와 local verified exit를 구별한다. credential을 읽을 때 선택 target과 묶고 진단의 URL·query·env redaction을 공통 적용한다.
10. `[제안]` OS keychain locked/unavailable이면 명시 failure/unknown을 낸다. 다른 프로젝트의 편의 fallback은 lophn 정책과 반대다. coding auth에 user token을 대신 붙이지 않으며 secret을 argv·JSON·diagnostic·config snippet에 내지 않는다.

### 버릴 것

- `[제안]` gh의 `--jq`/`--template`, raw API passthrough, paginate no-slurp, verbose stdout를 lophn JSON contract에 그대로 넣지 않는다. 필요한 변환은 완전한 lophn JSON을 받은 다음 외부 jq로 한다.
- `[제안]` beads의 helper별 JSON error stream 차이·환경별 envelope 전환·pipe unlimited, Paseo quiet로 JSON 의미가 바뀌는 선택을 버린다. error code와 process exit는 각자 역할을 가진 고정 contract여야 한다.
- `[제안]` Codex JSONL을 lophn 모든 command의 기본 출력으로 복사하지 않는다. log도 현재 bounded JSON+cursor가 정본이다. 향후 `--stream`을 추가하려면 event type·종료 event·중단·resume·redaction을 별도 contract로 정해야 한다.
- `[제안]` Gemini env의 조용한 drop/truncate, OpenCode interactive 공백 split, native MCP add의 자동 overwrite/OAuth initiation을 버린다.
- `[제안]` JSON file0600·encrypted-file을 keychain과 동등한 보안으로 취급하지 않는다. env/URI credential 우선순위도 secret 값 전달 정책의 근거로 그대로 복사하지 않는다.
- `[제안]` stdout에 결과가 있었다는 이유만으로 작업 성공, 설정이 있었다는 이유만으로 loaded, pending이었다는 이유만으로 실패, timeout이었다는 이유만으로 효과 없음이라고 판단하지 않는다.

## requirements와 다른 점

아래는 현재 `coding-agent/cli` requirements와 `docs/architecture/coding-agent.md`의 차이·구체화가 필요한 점이다. 이 문서 외 requirements·architecture·open-issues는 수정하지 않았다. 외부 프로젝트의 차이는 대부분 의도적으로 채택하지 않는 것이 맞다.

| requirement | source와의 차이 또는 빈 곳 | 바꿀 필요 |
|---|---|---|
| `coding-agent/cli#R2`, `coding-agent/cli#R3` | gh filter/template·Codex JSONL·Paseo text follow는 한 완전한 JSON과 다르다. beads error writer가 stream별로 다르고 OpenCode 일부 auth error는 정상 return이다. lophn exit 표에는 취소/SIGINT/broken pipe 처리와 parse-error JSON 보장이 구체적이지 않다. | 단일 JSON·기존 exit category는 유지. dispatch 전 취소/pipe와 mutation 중 취소의 구별 및 error writer 범위를 spec/테스트에서 구체화 제안. 별도 취소 숫자는 미결정. |
| `coding-agent/cli#R4` | gh·beads의 `-` stdin, Orca explicit stdin, Codex implicit append와 달리 현재 lophn은 inline 또는 file 하나다. architecture에도 `--input-file -` 의미가 없다. | implicit stdin은 버림. pipeline을 위해 `--input-file -`를 넣을지는 별도 결정 필요. 채택 시 하나의 source·byte 상한·TTY 거절·invalid JSON nonzero를 명시해야 함. 현재 contract에 조용히 추가하지 않음. |
| `coding-agent/cli#R5`, `coding-agent/cli#R32` | Orca는 read argv·same request ID·recoveryBlocked·outcome_unknown을 구조화한다. lophn architecture는 원래 key·대상 조회를 이미 요구하지만 recovery field/receipt와 same-key retry 가능 범위는 덜 구체적이다. | 요구의 read-first·자동 새 실행 금지는 유지. core가 보장하는 replay와 새 작업을 구별하고 `next`의 argv/read 참조를 구체화 제안. |
| `coding-agent/cli#R8` | Paseo는 home/endpoint ambiguity 거절·PID identity·actual listen·local/live/auth state·remote shutdown receipt를 구별하고 Orca는 metadata IPC다. 단순 flag→env→상태 file→default port 규칙은 둘 다 정확히 설명하지 못한다. | headless 관리 요구 유지. platform 소유 discovery를 따르되 CLI에서 선택 근거·instance replacement·접수와 verified stop 관측을 구체화 제안. coding credential start/stop 금지는 유지. |
| `coding-agent/cli#R9` | Claude/Codex/Gemini/OpenCode native add/remove는 config file을 쓰며 Codex add는 OAuth까지 시작할 수 있다. OpenCode는 command 배열, 다른 stdio schema는 command/args 분리다. | file 무변경 원칙은 변경 불필요. adapter별 native schema·정확 argv·안전 env를 고정하고 native add를 실행하지 않는 테스트 필요. |
| `coding-agent/cli#R10`, `coding-agent/cli#R40` | native list의 config/auth/connect observation은 네 loading 단계 전체가 아니다. Gemini list는 실제 stdio server를 시작할 수 있고 Claude list도 transport별 관측 범위가 다르다. | 요구 변경 불필요. trust-aware bounded probe, unknown 이유·시간·다음 확인, config/connected/loaded 차이를 adapter spec에서 구체화 제안. |
| `coding-agent/cli#R14`, `coding-agent/cli#R24`, `coding-agent/cli#R36` | gh command별 default·beads pipe unlimited/offset·Paseo text follow는 lophn bounded cursor와 다르다. external default를 한 공통 limit로 복사할 수 없다. | 현재 상한 유지. TTY와 관계없이 동일 입력이면 동일 범위, scope 적용 뒤 count/cursor, truncation 표시를 테스트해야 함. streaming은 현재 요구에 추가하지 않음. |
| `coding-agent/cli#R6`, `coding-agent/cli#R38` | gh plaintext fallback·Codex default File/Auto·Gemini encrypted-file·OpenCode file/env·Paseo credential file은 keychain-only 및 user fallback 금지와 다르다. | 보안 정책 변경 불필요. headless keychain locked/unavailable의 안전 오류·doctor 상태를 명시하고 fallback이 없음을 테스트해야 함. |
| `coding-agent/cli#R39` | gh Markdown reference·beads type schema는 command policy discovery가 아니다. Orca live registry JSON은 command 목록 drift를 막지만 권한·출력 schema는 없다. 현재 lophn 모든 command JSON 지원을 machine help schema로 어떻게 고정할지는 상세하지 않다. | help 목적/입력/권한/confirmation/next 요구 유지. `help --json`의 schema version·output schema·canonical argv·read/write·권한을 같은 registry에서 만드는 구체화 제안. |
| `coding-agent/cli#R3`, `coding-agent/cli#R10` | beads prime의 fail-open은 일반 CLI 성공 의미와 다르다. lophn architecture는 이미 Claude hook의 빈 출력/exit0·5초/3초·10줄/1,200 code point 예외를 갖는다. | 변경 불필요. 예외를 `session summary --hook`에만 제한하고 명시 summary/doctor의 인증·장애를 빈 성공으로 바꾸지 않는 테스트 필요. |
| `coding-agent/cli#R41` | beads onboard나 Orca guide의 task/handoff command를 lophn ticket lifecycle로 그대로 옮기면 CLI claim 또는 접수=완료 혼동이 생긴다. | MCP-only claim 유지. help/skill·CLI claim 안내가 실행 허가나 자체 claim을 만들지 않는지 검증해야 함. |
