# sandbox·approval 조사: OpenClaw (2026-10-15)

사람(요약): OpenClaw가 agent의 shell·code 실행, 파일 tool, web tool을 어떻게 가두고 승인하는지 조사한다. lophn은 file, shell(또는 code run), web tool을 줄지 정하는 중이고, 가둘 경계로 (A) OS sandbox 안의 shell, (B) Deno 권한 flag로 가둔 code run, (C) container를 견주고 있다. lophn이 지켜야 하는 것은 (1) 앱 DB를 그 앱의 process만 여는 것, (2) secret 파일, (3) agent가 자기 grant나 지침을 고치지 못하는 것, (4) agent가 바꾼 파일을 session 안에서 되돌리는 것, (5) 사람이 지켜보지 않을 때 도는 session이 있다는 것이다.

- repo: github.com/openclaw/openclaw @ `e085c3fb` (2026-10-14, "fix: second plain-text tool call no longer leaks into chat output when it follows prose (#172440)"), `package.json` version `2026.10.3`. `--depth 1`로 받아 읽기만 했고 아무것도 실행하지 않았다(npm install, build, script 없음. JSON은 `python3 -I`로 구조만 확인). 그래서 history(어느 기능이 언제 생겼나)는 모른다.
- 근거(repo 안 경로, 줄 번호는 이 commit 기준): 문서 `docs/gateway/sandboxing.md`, `docs/gateway/sandboxing/{modes-scope-and-backend,docker-backend,workspace-access,supported-capability-matrix,what-gets-sandboxed}.md`, `docs/gateway/sandbox-vs-tool-policy-vs-elevated.md`, `docs/gateway/permission-modes.md`, `docs/tools/{exec,exec-approvals,exec-approvals-advanced,permission-modes,elevated,web-fetch,web,apply-patch,skill-workshop}.md`, `docs/tools/code-mode/executors.md`, `docs/tools/subagents/tool-policy.md`, `docs/automation/cron-jobs/{payloads,schedules}.md`, `docs/gateway/security/{trust-model,tool-permissions,secrets-and-storage,prompt-injection,hardened-baseline}.md`, `docs/gateway/secrets/secret-store-and-egress.md`, `docs/web/control-ui/chat.md`, `docs/concepts/managed-worktrees.md`, `docs/plugins/codex-harness-reference/approval-and-sandbox.md`. 코드 `src/agents/sandbox/{config,constants,docker,validate-sandbox-security,sanitize-env-vars,tool-policy}.ts`, `src/agents/{session-permission-exec-mode,tool-fs-policy,bash-tools.shared,bash-tools.exec-request-preparation,exec-auto-reviewer.prompt}.ts`, `src/agents/tools/web-fetch.ts`, `src/infra/{exec-approvals-config,exec-approvals-core,exec-approvals-allow-always,exec-command-resolution,host-env-security}.ts`, `src/infra/host-env-security-policy.json`.
- 이 repo는 매우 크고 문서가 길다(문서가 코드보다 최신인 경우가 많다). 아래 사실은 문서에서 읽은 것과 코드로 확인한 것을 근거 열에 구분해 적었다. 코드에서 확인하지 못한 문서 주장은 "문서"라고만 적었다.

## 한 줄 결론

OpenClaw는 **shell을 OS sandbox(Seatbelt, bubblewrap, Landlock)로 가두지 않는다.** 가두는 장치는 Docker/Podman container(와 SSH, OpenShell, Crabbox 원격 backend) 하나이고, **기본은 꺼져 있다**(`mode: off`). 꺼진 기본 상태에서는 shell과 파일 tool이 gateway process와 같은 사용자 권한으로 host에서 돌고, shell 승인도 기본이 `security=full, ask=off`라서 **아무것도 묻지 않는다**. 승인 체계(allowlist, allow-once/allow-always/deny, LLM reviewer)는 잘 만들어져 있지만 켜야 동작하고, 문서가 스스로 "containment가 아니다"라고 적는다. container를 켜면 network 없음, root 읽기 전용, capability 전부 제거, host env 미상속으로 꽤 단단하다. 대신 문서가 적은 sandbox 대상은 shell, 파일 tool, 선택적 browser이고(web tool은 목록에 없다), MCP·plugin tool은 Gateway 쪽에서 돈다.

## 1. shell·code 실행의 sandbox

| 항목 | 내용 | 근거 |
|---|---|---|
| OS sandbox (Seatbelt, bubblewrap, Landlock, Windows) | OpenClaw 자체에는 없다. grep으로 `seatbelt`, `landlock`, `bwrap` 코드를 찾으면 (a) Codex harness 쪽 문서·진단(Codex가 자기 sandbox로 bwrap을 쓴다), (b) `sandbox-exec`를 "dispatch wrapper 이름"으로 인식하는 목록뿐이다. OpenClaw가 shell을 직접 Seatbelt/bwrap으로 감싸는 코드는 못 찾았다 | `docs/gateway/sandboxing/docker-backend.md`(Ubuntu/AppArmor 주의), `src/infra/dispatch-wrapper-resolution.ts:394`, `docs/plugins/codex-harness-reference/approval-and-sandbox.md` |
| 있는 것 | tool 실행을 backend로 옮기는 "sandbox". backend는 `docker`(기본), `podman`, `ssh`, `openshell`, `crabbox`. "Gateway process는 늘 host에 남고 tool 실행만 옮긴다" | `docs/gateway/sandboxing.md:9`, `docs/gateway/sandboxing/modes-scope-and-backend.md` |
| 기본 | **꺼짐.** `mode` 기본 `off`, `scope` 기본 `agent`, `backend` 기본 `docker`, `workspaceAccess` 기본 `none` | `src/agents/sandbox/config.ts:221,224`, `docs/gateway/sandboxing/modes-scope-and-backend.md`, `docs/tools/exec.md:98` |
| mode 종류 | `off`(sandbox 없음), `non-main`(agent의 main session만 host, 나머지 session은 sandbox. group/channel session은 늘 non-main), `all`(전부). 운영자 role의 `sandbox: "required"`는 agent mode를 덮어쓰고, backend가 없으면 host로 떨어지지 않고 실행을 막는다. 관리자는 한 chat만 `sandboxMode: "off"`로 뺄 수 있다(필수 role은 못 뺀다) | `docs/gateway/sandboxing/modes-scope-and-backend.md` |
| workspace 노출 | `none`: 격리된 sandbox workspace(`~/.openclaw/sandboxes`)만 쓰고 agent workspace는 안 보인다. `ro`: agent workspace를 `/agent`에 읽기 전용으로 mount하고 `write`/`edit`/`apply_patch`를 끈다. `rw`: `/workspace`에 쓰기 가능. 필수 role sandbox는 `rw`를 `ro`로 낮춘다 | `docs/gateway/sandboxing/workspace-access.md:12-16` |
| container 만들 때 막는 것 | `--read-only`(root fs, 기본 true), `--tmpfs /tmp /var/tmp /run`, `--network none`(기본), `--cap-drop ALL`(기본), `--security-opt no-new-privileges`, `--init`, 선택으로 seccomp/apparmor profile, pids/memory/cpus/ulimit | `src/agents/sandbox/docker.ts:213-282`, `src/agents/sandbox/config.ts:98-112` |
| 쓰기 경로 | container 안은 mount한 workspace와 tmpfs뿐. 추가 mount는 `docker.binds`(`:ro`/`:rw`, 모드를 안 쓰면 **rw**). bind 원본은 symlink를 풀어 두 번 검사하고, `/etc /proc /sys /dev /root /boot /run /var/run` + docker.sock + HOME의 `.aws .cargo .config .docker .gnupg .netrc .npm .ssh`를 막는다. `seccomp=unconfined`, `apparmor=unconfined`, network `host`/`container:*`도 막는다. 전부 `dangerously...` 옵션으로 풀 수 있다 | `src/agents/sandbox/validate-sandbox-security.ts:23-51,313-340`, `docs/gateway/sandbox-vs-tool-policy-vs-elevated.md:50-58` |
| 읽기 경로 | container 안에서는 mount된 것만 보인다. host의 `~/.ssh` 등은 mount하지 않으면 없다 | 위와 같다 |
| network | container 기본 `none`(egress 없음). 도메인·host 단위 allowlist는 container 안에는 없다(`docker.network` 이름 선택, `dns`, `extraHosts`만). 그러면 sandbox 안 shell로는 `npm install`도 못 한다. 필요하면 `network: bridge`를 사람이 고른다. SSH/OpenShell backend는 원격 host/OpenShell 정책에 맡긴다 | `docs/gateway/sandboxing/docker-backend.md:13`, `docs/gateway/sandboxing/supported-capability-matrix.md` |
| 환경 변수 | 8절 | |
| Windows | Windows 전용 sandbox는 못 찾았다. Windows exec은 PowerShell 7(없으면 5.1)을 쓴다(문서). Windows에서 container backend를 어떻게 쓰는지는 확인 못함. 이 항목은 문서만 훑고 코드는 안 읽었다 | `docs/tools/exec.md`(PowerShell 7 탐색) |
| sandbox 밖에 남는 것 | Gateway process, native plugin(같은 process·같은 신뢰 경계), MCP·plugin tool(Gateway 쪽에서 실행하고 sandbox tool 정책이 한 번 더 거른다), `tools.elevated`로 허용한 exec | `docs/gateway/sandboxing/supported-capability-matrix.md`, `docs/gateway/sandboxing/what-gets-sandboxed.md` |
| 문서의 자기 평가 | "perfect security boundary가 아니다. model이 멍청한 짓을 할 때 filesystem과 process 접근을 상당히 줄여 준다" | `docs/gateway/sandboxing.md:12` |
| code run (B에 해당) | 두 가지가 있다. (1) `code_execution` tool은 xAI 서버에서 도는 원격 Python이라 local 파일·shell과 무관하다. (2) "Code Mode"(기본 꺼짐/auto)는 model이 JS를 써서 숨은 tool catalog를 부르는 구조다. executor가 `node:vm` worker면 **security boundary가 아니고**("Treat as trusted host execution"), `quickjs`(WASM)면 "ambient host access 없음". 어느 쪽이든 부수 효과는 tool bridge로만 나가고 tool 정책·승인은 Gateway가 그대로 건다. sandboxed session의 Code Mode cell도 Gateway process 안에서 돈다 | `docs/tools/code-execution.md`, `docs/tools/code-mode/executors.md:26,41,50-53` |
| 전체를 container에 | Gateway 자체를 Docker에 넣는 길도 있다(`Dockerfile`은 `USER node`). tool sandbox와 별개로 문서가 "complementary"라고 부른다 | `Dockerfile:445`, `docs/gateway/security/tool-permissions.md`("Sandboxing") |

## 2. sandbox가 없거나 꺼졌을 때 shell 명령을 판정하는 법

**기본은 묻지 않는다.** `DEFAULT_SECURITY = "full"`, `DEFAULT_ASK = "off"`다. 문서도 "Trusted single-operator default: host exec on gateway/node is allowed without approval prompts. That is intentional UX, not a vulnerability"라고 적는다.

| 항목 | 내용 | 근거 |
|---|---|---|
| 기본 mode | `tools.exec.mode` 미설정이면 host 정책에서 유도하는데 기본이 `full`/`off`다. mode가 없는 session도 "sandbox도 설정도 없으면 default는 full access" | `src/infra/exec-approvals-config.ts:95-96`, `docs/tools/exec.md:126`, `docs/gateway/permission-modes.md:43`, `docs/gateway/security/trust-model.md:67` |
| exec mode 5종 | `deny`(전부 막음), `allowlist`(allowlist나 safe bin만 돌고 나머지는 **묻지 않고 막음**), `ask`(allowlist에 맞으면 돌고 miss는 사람에게 묻기), `auto`(miss를 LLM reviewer가 allow/deny/ask로 판정), `full`(prompt 없음). 내부는 `security`(deny/allowlist/full) × `ask`(off/on-miss/always) 쌍이다 | `src/infra/exec-approvals-core.ts:96-113`, `docs/tools/exec.md:140-150` |
| session permission mode 4종 | `read-only`(exec 거부, 쓰기 tool 제거), `guarded`(session root 안 읽기·쓰기, miss는 사람), `workspace`(root 안, miss는 LLM reviewer), `full`(root 제한 없음). `full`은 `operator.admin`, 나머지는 `operator.write`가 필요하다. `/exec`로 turn마다 정책을 **더 조이는 것만** 된다 | `src/agents/session-permission-exec-mode.ts:13-18,55-63`, `docs/gateway/permission-modes.md:11-16,29` |
| allowlist 판정 | resolved binary path glob 또는 PATH로 부른 bare 이름 glob. 파이프의 모든 segment가 allowlist나 safe bin이어야 하고, `;` `&&` `||`는 segment마다 맞아야 하고, redirection과 command substitution(`$()`)은 거절, heredoc은 quoting과 관계없이 reviewer나 명시 승인이 필요하다 | `docs/tools/exec.md:~190`, `docs/tools/exec-approvals-advanced.md`, `docs/gateway/security/prompt-injection.md` |
| safe bin | stdin만 읽는 `cut uniq head tail tr wc`. 파일 인자·경로형 token을 거절하고, token을 literal로 다루어 glob·`$VAR` 확장이 없다. `awk sed jq`는 safe bin으로 못 둔다. `python3 node bash` 같은 interpreter는 넣지 말라고 경고한다 | `docs/tools/exec-approvals-advanced.md`("Safe bins") |
| 위험 명령 pattern | **정적 pattern 목록이 없다**(`rm -rf`, `curl \| sh` 목록 같은 것). 대신 allowlist 구조 분석 + `strictInlineEval`(옵션, 기본 false)이 `python -c`, `node -e`, `perl -e`, `awk`, `sed`, `find -exec`, `xargs`, `make` 같은 인라인 코드 형태를 "승인 필요"로 돌린다. YOLO는 휴리스틱 obfuscation gate를 **더하지 않는다**고 문서가 밝힌다 | `docs/tools/exec.md:~180`, `docs/tools/exec-approvals.md:~325` |
| 실행 직전 binding | 승인한 command의 모든 wrapper와 마지막 실행 파일을 real path(쓰기 가능한 파일이면 content hash까지)로 묶고 launch 직전에 다시 확인한다. PATH 앞에 새 실행 파일이 생기면 승인된 run도 거절된다. script/interpreter 파일 하나를 best-effort로 묶고, 하나로 특정 못 하면 승인 기반 실행 자체를 거절한다(의미를 다 아는 척하지 않는다) | `docs/tools/exec.md:~157`, `docs/tools/exec-approvals-advanced.md`("Interpreter/runtime commands") |
| LLM 분류기 (`auto`) | 별도 model(기본은 agent의 primary model, `tools.exec.reviewer.model`로 바꿈)에게 **명령 하나**를 untrusted data로 주고 `{"decision":"allow\|deny\|ask","risk":...}`를 받는다. allow는 low/medium risk **한 번 실행**만 허용. deny는 사유를 agent에게 돌려 더 안전한 방법을 고르게 하고(우회 금지 문구 포함), ask는 사람에게 간다. 실패·timeout·잘못된 응답도 사람에게 간다. 한 session에서 reviewer deny가 연달아 3번이면 세 번째는 사람에게 간다. 명령 안에 reviewer를 향한 지시문이 있으면 deny/high. 현재 대화 일부(untrusted transcript, origin이 operator인 요청만 권한 근거)를 같이 본다. 쉘 `-c` wrapper, `env A=b`, BusyBox applet, login/interactive shell wrapper처럼 실행 파일 chain을 묶을 수 없는 형태는 reviewer를 건너뛰고 **사람에게** 보낸다 | `src/agents/exec-auto-reviewer.prompt.ts:3-30`, `docs/tools/exec.md:~157-170` |
| 막는 도구와 막지 않는 것 | 문서가 직접 적는다: "승인은 per-user auth boundary도 filesystem read-only 정책도 아니다. 승인된 command는 host나 sandbox filesystem이 허락하는 대로 파일을 바꾼다." "tool policy는 `exec` 안의 부수 효과를 안 본다. `exec`을 허용하면 `write`를 막아도 shell은 read-only가 아니다" | `docs/tools/exec-approvals.md:54-55`, `docs/gateway/sandbox-vs-tool-policy-vs-elevated.md:76` |
| tool 이름 규칙 | allow/deny + profile + provider + group(`group:runtime`=exec/process/code_execution 등). 5층(profile, provider profile, 전역/agent policy, provider policy, sandbox policy)을 겹치고 `deny`가 늘 이긴다 | `docs/gateway/sandbox-vs-tool-policy-vs-elevated.md:60-100` |
| sandbox 안 tool 기본 | sandboxed session의 기본 allow는 `exec process read ls write edit apply_patch view_image github_* sessions_* subagents session_status`뿐이고, 기본 deny는 `browser canvas computer mobile_ui nodes automations gateway`와 모든 channel 이름이다. **web tool은 기본 allow에 없다**(코드로 읽은 결과. 실행해 확인하지는 못함). 쓰려면 `tools.sandbox.tools.alsoAllow`에 더한다 | `src/agents/sandbox/constants.ts:20-51`, `src/agents/sandbox/tool-policy.ts:170-205` |

## 3. 경계를 넘을 때

**agent는 경계 확장을 청하지 않는다.** agent는 `exec`를 그냥 부르고, 실행 host(gateway 또는 node)의 정책이 "묻는다/막는다/돈다"를 정한다. "이 명령에 sandbox 밖 권한을 달라"는 요청 channel이 없다. `exec`의 `elevated: true`와 `host`, `ask` 인자가 비슷해 보이지만 다음과 같다.

| agent가 보내는 것 | 뜻 | 근거 |
|---|---|---|
| `elevated: true` | sandbox를 **통째로** 벗어나 host(gateway/node)에서 실행해 달라는 요청. 다만 운영자가 `tools.elevated.enabled`와 `allowFrom`(sender 목록)을 켜 둔 session에서만 유효하고, 아니면 "unavailable"로 취급한다. 필수 role sandbox는 elevated로도 못 나간다. 사람은 채팅에서 `/elevated on\|ask\|full\|off`로 정한다 | `docs/tools/elevated.md:21-31,60-80` |
| `host: gateway\|node\|sandbox` | 실행 위치 선택. sandbox가 활성이면 `auto`는 sandbox를 유지하고 gateway/node 지정은 거절된다 | `docs/tools/exec.md:76-84` |
| `ask: always` 등 | 기본보다 **더 조일 수만** 있다. 정책이 `off`면 channel에서 온 호출은 이 값을 무시한다 | `docs/tools/exec.md:60-63` |

경계에 걸리면(allowlist miss 등) 사람(또는 reviewer)에게 가는 것은 **명령 한 줄**이다. 경로 추가나 host 추가는 없다.

| 사람의 선택 | 범위 | 저장 |
|---|---|---|
| `allow-once` | 그 명령 한 번. 같은 session의 다음 명령은 새로 판정 | 없음 |
| `allow-always` | allowlist 항목을 만든다. **단위는 실행 파일 경로 + 정확한 argv 해시 + 승인한 cwd**("Always allow here"). 다른 directory에서는 miss다. shell wrapper 명령은 명령 text의 sha256 앞 16자(`=command:<hash>`) 항목이 된다. 인라인 eval 명령, 푸는 방법을 알 수 없는 wrapper는 항목을 만들지 않는다. `ask: always`면 allow-always 선택지 자체가 안 뜬다 | per-agent allowlist. host에 있는 SQLite `~/.openclaw/state/openclaw.sqlite`의 `exec_approvals_config` row(JSON 문서). Control UI의 Exec approvals 카드, `openclaw approvals ...` CLI로 보고 지운다. 항목마다 `lastUsedAt`, `lastUsedCommand`가 붙는다 |
| `deny` | 그 호출 한 번 | 없음. denied tool 결과가 agent로 간다. 사람이 쓴 거절 사유를 agent에게 넘기는 입력은 못 찾았다 |
| (선택지에 없음) | "이 session 동안만 허용", "이 directory를 써도 된다", "이 host에 network를 열어도 된다" | 없다 |

- allowlist 항목의 단위 분류는 코드에 있다: "command text", "argv+cwd", "argv", "any args", "inactive". `src/infra/exec-command-resolution.ts:190-210`, `src/infra/exec-approvals-allow-always.ts`(`=command:` 해시).
- 2026.8.1 이전에 만들어진 allow-always 항목은 cwd 묶임이 없다는 이유로 **무효 처리**하고 `openclaw doctor --fix`가 지운다. 호환을 접고 다시 묻는 쪽을 택한 사례다. `docs/tools/exec-approvals.md:501-507`.
- 승인 요청은 command, cwd, host, agent를 담아 gateway가 `exec.approval.requested`로 operator client(Control UI, macOS/iOS/Android app)에 뿌리고, `operator.approvals` scope가 있는 client만 `exec.approval.resolve`를 부를 수 있다. 문서는 이 scope를 "remote-execution급 권한"이라고 부른다. node host에서는 승인 시점에 만든 `systemRunPlan`(command/cwd/session 등)을 저장하고 승인 뒤 caller가 바꾼 값은 버린다.
- **MCP tool grant**: Codex 실행에서 "Allow Always"는 `(agent, MCP server, tool 이름)` 단위로 같은 approvals 문서의 `agents.<id>.mcpTools`에 저장된다. 인자는 가리지 않는다. `docs/tools/exec-approvals.md:~370-400`.
- **timeout**: 대기 중인 승인은 기본 30분(`DEFAULT_EXEC_APPROVAL_TIMEOUT_MS = 1_800_000`) 뒤 만료되어 host command의 종결(거절)이 된다. UI가 없거나 timeout이면 `askFallback`(기본 `deny`)이 정한다. `src/infra/exec-approvals-core.ts:260`, `docs/tools/exec-approvals.md:~265`.
- permission mode를 도중에 바꾸면 대기 중이던 승인은 **취소**되고(허가되지 않는다), 이미 쓴 파일·시작된 process는 되돌리지 않는다. `docs/gateway/permission-modes.md:72`.
- 승인 prompt는 chat 안에서도 처리된다. `/approve <id> allow-once|allow-always|deny`, Slack/Discord/Telegram/Matrix의 native 버튼(Matrix는 reaction 이모지). 같은 chat이 기본 승인 channel이고 `approvals.exec`로 대상 DM을 지정할 수 있다. `docs/tools/exec-approvals-advanced.md`.

## 4. 파일 tool

| 항목 | 내용 | 근거 |
|---|---|---|
| tool | `read`, `write`, `edit`, `apply_patch`(`exec`의 subtool, 기본 켜짐), `ls`(sandbox 안에서는 shell 없이 directory 나열) | `docs/tools/apply-patch.md`, `docs/gateway/sandboxing/what-gets-sandboxed.md` |
| 승인 | **파일 tool은 묻지 않는다.** 승인 체계는 exec(와 plugin·MCP tool)에만 있다 | `docs/tools/exec-approvals.md`, 파일 tool 경로에서 승인 호출 코드를 못 찾았다 |
| workspace 밖 경로 | sandbox 없이 쓰면 **기본은 host 어디든** 된다. `tools.fs.workspaceOnly`는 미설정이면 false다(`resolveEffectiveToolFsWorkspaceOnly`는 `=== true`일 때만 제한). `true`로 하면 `read/write/edit/apply_patch`와 이미지 자동 load 경로를 workspace로 가둔다. `apply_patch`만은 `tools.exec.applyPatch.workspaceOnly`가 기본 `true`라서 기본으로 workspace에 갇힌다. 이 값은 exec mode와 독립이다. 설정 쪽 `workspaceOnly: false`는 "dangerous config flag"로 audit에 잡힌다 | `src/agents/tool-fs-policy.ts:28-42,~45`, `docs/tools/apply-patch.md:42-46`, `src/security/dangerous-config-flags-core.ts:89` |
| session 경계 | session permission mode(`read-only/guarded/workspace`)에서는 file tool이 `sessionRoot`(없으면 agent workspace) 안으로 한정되고, root를 벗어나는 symlink와 `symlink/..`는 막힌다. `full`만 제한이 없다. 이 때 root 밖은 **묻지 않고 거절**이다 | `src/agents/session-permission-exec-mode.ts:55-63`, `docs/gateway/permission-modes.md:11-16,31-35` |
| 쓰기 보호 경로(설정·지침 파일) | **못 찾았다.** `AGENTS.md`, `SOUL.md`, `~/.openclaw/openclaw.json`, approvals DB(`state/openclaw.sqlite`)를 file tool이 따로 막는 코드를 찾지 못했다(`protected`/`denied path` 계열 grep). 문서도 "넓은 root(HOME 등)를 workspace로 주면 `~/.openclaw` 아래 state·config가 file tool에 노출된다"고 경고할 뿐이다. 즉 sandbox를 끄고 `workspaceOnly`를 안 켜면 agent가 자기 config와 지침을 쓸 수 있다 | `docs/gateway/security/tool-permissions.md:129` |
| 그 대신 | (1) agent가 쓰는 `gateway` tool은 config **읽기**와 update 시작만 있고 config 쓰기가 없다(owner 전용). 영구 설정 변경은 `openclaw` 위임 tool이 typed 작업으로 바꾸어 요청 run의 정책으로 승인하고(제한된 run은 사람 승인, Full Access run은 자동), 자유로운 text 응답("yes")은 승인으로 치지 않는다. (2) sandbox 안 `read`는 sandbox를 root로 한다. skill은 sandbox workspace에 **읽기 전용** mount로 넣고 container mount와 file tool이 읽기 전용을 강제한다 | `docs/gateway/security/tool-permissions.md:~10-18`, `docs/gateway/permission-modes.md:~50-65`, `docs/gateway/sandboxing/workspace-access.md:~110` |
| agent가 스스로 고치는 것 | learned skill은 agent가 만들고 고치는데 **즉시 적용**되고 이전 버전을 저장해 둬서 **undo 가능**하다. 30일 안 쓰면 archive | `docs/tools/skill-workshop.md:12-15` |

## 5. web 검색·읽기 tool

| 항목 | 내용 | 근거 |
|---|---|---|
| 묻는가 | **묻지 않는다.** `web_fetch`, `web_search`는 승인 대상이 아니다. `web_fetch`는 기본 켜짐이고 key가 필요 없다 | `docs/tools/web-fetch.md`("Enabled by default"), `src/agents/tools/web-fetch.ts`(승인 호출 없음) |
| 제한 | private/내부 hostname 차단(SSRF guard), redirect 재검사(최대 3), 응답 크기 750 KB 기본(32 KB~10 MB), 15분 cache, 결과를 `<<<EXTERNAL_UNTRUSTED_CONTENT>>>` marker로 감싼다. `tools.web.fetch.ssrfPolicy`의 `allowedHostnames`(정확한 host 예외), `blockedHostnames`(wildcard 포함 deny), `dangerouslyAllowPrivateNetwork` | `docs/tools/web-fetch.md:310-324`, `src/agents/tools/web-fetch.ts:649-657` |
| 도메인 allowlist | 일반 사용자 설정으로는 없다. **Codex native hosted search를 쓰는 turn에서만** `tools.web.search.openaiCodex.allowedDomains`가 hosted search와 `web_fetch` 둘 다를 제한한다(`hostnameAllowlist`로 SSRF policy에 합친다). "무엇이든 열되 막을 host를 deny"는 가능하고 "이 host만 열기"는 일반 경로에는 없다 | `docs/tools/web.md:356-358`, `src/agents/tools/web-fetch.ts:905,939` |
| 외부 proxy | 선택. `proxy.proxyUrl`을 두면 Gateway process의 모든 HTTP·WebSocket egress가 운영자 proxy를 지난다(DNS rebinding 완화). 기본 꺼짐 | `docs/security/network-proxy.md` |
| sandbox와의 관계 | web tool은 **Gateway 쪽에서 실행**한다. container `network: none`이어도 web tool은 된다(허용되어 있다면). 2절대로 sandbox 기본 allow에는 web이 없다 | `docs/gateway/sandboxing/supported-capability-matrix.md`, `src/agents/sandbox/constants.ts:20-40` |
| 위협 모델 | 문서는 "web_search/web_fetch/browser는 tool이 필요한 agent에게만", 신뢰 못 하는 입력은 **reader agent**(읽기 전용·tool 없음)로 요약만 받으라고 한다. 즉 web 결과는 prompt injection 입구로 보고 승인 대신 tool 분리로 막는다 | `docs/gateway/security/prompt-injection.md` |
| browser tool | 이번 조사 밖. sandbox 기본 deny에 들어 있다 | `src/agents/sandbox/constants.ts:43` |

## 6. 사람이 없는 실행

| 상황 | 동작 | 근거 |
|---|---|---|
| 승인이 필요한데 승인 UI가 없다 | `askFallback`(기본 `deny`)으로 처리. `allowlist`로 두면 allowlist에 맞을 때만 허용, `full`로 두면 허용 | `docs/tools/exec-approvals.md:92,230-240` |
| cron/automation의 agent turn 안 exec | 승인 카드를 **연결된 approval client**(Control UI, macOS/iOS/Android app, `approvals` capability를 선언한 API client)에만 보낸다. chat channel로는 안 보낸다(매번 카드가 반복되므로). 하나라도 연결돼 있으면 run은 interactive처럼 기다린다. 한 job은 single-flight라 카드는 최대 1장. **연결된 approval surface가 없으면 즉시 거절**하고 run error에 정책 수정 방법을 적는다 | `docs/tools/exec-approvals.md:566-580` |
| 그 "Always allow" | automation에서 고르면 allowlist 항목이 아니라 **standing grant**가 생긴다. 단위: agent + automation + job 설정 + (명령 text, cwd, 요청 env)가 byte 단위로 같은 것. job을 지우거나 정의를 바꾸면(원래대로 되돌려도) 무효. 기본 **취소할 때까지** 유효, `tools.exec.grantExpiryDays`나 `--expires-in-days`로 만료 지정. heredoc, 인라인 eval, mutable file operand는 grant가 있어도 매번 묻는다. Control UI Settings → Approvals에서 grant 목록·사용 횟수·상태를 보고 Revoke, CLI는 `openclaw approvals grants list/revoke`. 사용할 때마다 현재 grant와 승인 row를 다시 확인한다 | `docs/tools/exec-approvals.md:566-640` |
| automation의 tool 범위 | job을 만들 때 tool 정책을 **항상 명시 저장**한다(없으면 `*`=owner session의 현재 정책을 매번 따른다). agent가 만들 때는 유한 목록이 오면 만든 turn의 tool로 상한을 걸고 넓힐 수 없다. 만든 쪽 sandbox가 필수면 그 sandbox가 job에도 따라간다 | `docs/automation/cron-jobs/payloads.md:57-70` |
| 사람이 안 보는 것을 전제로 한 turn | "isolated automation·hook turn은 명시적으로 unattended" — 질문·확인을 하지 말고 결과물을 답으로 내라는 계약이 prompt에 들어간다 | `docs/automation/cron-jobs/payloads.md:357` |
| 위험한 면 | (a) condition-trigger script, `script` payload는 기본 켜짐이며 owning agent의 **전체 tool 정책(exec 포함)으로 unattended 실행**. `cron.triggers.enabled: false`로 막는다. (b) `command` payload는 Gateway process 안에서 operator-admin이 만든 script로 돌고 agent exec 정책이 적용되지 않는다 | `docs/automation/cron-jobs/schedules.md:146`, `docs/automation/cron-jobs/payloads.md:226` |
| subagent | 부모와 같은 tool 정책 pipeline 위에 sub-agent 제한 층을 하나 더 얹는다. 늘 잃는 tool: `gateway cron message sessions_send session_status agents_list progress_card conversations_*`. depth 한계에서는 `sessions_spawn`도 잃는다. 이 층은 persisted session envelope에서 매 turn 다시 계산해서 `allow`로 못 푼다. sandboxed 부모는 unsandboxed 대상을 spawn할 수 없고, `sandbox: "require"`로 child가 sandbox가 아니면 즉시 실패시킬 수 있다. **exec 승인의 subagent 전용 규칙은 못 찾았다**: 같은 승인 경로를 쓰고 거절 결과는 subagent·cron session에는 되돌려 주지 않는다 | `docs/tools/subagents/tool-policy.md:41-60`, `docs/tools/exec-approvals.md:766`, `docs/gateway/security/tool-permissions.md:~110` |
| 메신저 gateway(chat 입력) | 입구 통제가 중심이다: DM pairing 기본, group은 allowlist + mention gate, `tools.toolsBySender`, 비owner sender는 `cron`/`gateway` tool 불가. 열린 DM·group에는 `tools.profile: "messaging"`, `group:runtime`/`group:fs` deny, `fs.workspaceOnly`, `sandbox.mode: "all"`을 권한다(audit가 `security.exposure.open_groups_with_runtime_or_fs`로 잡는다). 신뢰 경계는 "gateway 하나당 하나"이고 적대적 사용자끼리는 gateway를 나누라고 문서가 말한다 | `docs/gateway/security/{hardened-baseline,trust-model}.md`, `docs/gateway/security/audit-checks.md:142` |
| ACPX(외부 harness) session | TTY가 없다. 기본 `permissionMode=approve-reads`, `nonInteractivePermissions=fail`(prompt가 필요하면 중단). `deny`로 바꾸면 거절하고 계속한다 | `docs/tools/acp-agents-setup.md:446-448` |
| Codex harness | local stdio app-server 기본이 **YOLO**(`approvalPolicy: never`, `sandbox: danger-full-access`) — "unattended turn과 heartbeat가 진행되도록". `tools.exec.mode: "auto"`나 `appServer.mode: "guardian"`이면 `on-request` + `auto_review` + `workspace-write`로 바뀐다 | `docs/plugins/codex-harness-reference/approval-and-sandbox.md:20-27,33-40` |

## 7. 바꾼 파일 되돌리기

| 항목 | 내용 | 근거 |
|---|---|---|
| per-turn checkpoint, 파일 undo, shadow git | **없다.** 사용자 기능으로 파일을 이전 상태로 되돌리는 것은 못 찾았다 | `docs` 전체 grep(`checkpoint`, `undo`, `shadow`, `rewind`), 아래 rewind 문구 |
| rewind | chat 메시지에서 "Rewind to here". session을 그 메시지 직전 상태로 **대화만** 되돌린다. 문서 원문: "Rewind moves chat context only — files and other tool side effects are not reverted". 이전 transcript는 append-only store에 남고 "Versions" 메뉴로 다시 고를 수 있다. agent가 일하는 동안은 비활성. `operator.admin` 필요 | `docs/web/control-ui/chat.md:523` |
| fork | 같은 prefix로 새 session을 만든다(파일 무관) | 위와 같다 |
| shell이 바꾼 파일 | 되돌리는 기능이 없다. 다만 **managed worktree**를 쓰면 session마다 git branch + checkout을 따로 받고, session diff panel(`sessions.diff`, `operator.read`)이 "이 checkout이 실제로 바꾼 것"을 file별로 보여 준다. shell이든 file tool이든 git이 보기 때문에 구분이 없다. 보기 전용이고 되돌리는 버튼은 문서에서 못 찾았다. 사용자는 git으로 직접 되돌린다 | `docs/web/control-ui/chat.md:526`, `docs/concepts/managed-worktrees.md:11-24` |
| worktree snapshot | session archive/삭제 때 tracked + untracked(ignore 제외) 파일을 synthetic commit으로 `refs/openclaw/snapshots/<id>`에 고정하고, unarchive 때 원래 branch HEAD + 저장한 dirty·untracked 파일을 복원한다(보존 30일). 이것은 session 생명주기용 복구이지 turn 단위 undo가 아니다 | `docs/concepts/managed-worktrees.md:417-423,393` |
| sandbox + managed worktree의 reconcile | Docker/Podman sandbox는 host checkout을 직접 mount하지 않고 **private git checkout**을 guest에 준다. 변경을 host worktree와 맞출 때(capture/apply) runtime을 멈추고, "pending result와 rollback journal을 SQLite에 기록"하며, 충돌하면 양쪽 버전을 보존하고 해결 전까지 정산을 막는다. 구조상 shell이 바꾼 파일을 host가 변경 단위로 받아 적용하는 경로이지만, 사용자에게 나오는 undo가 아니라 정산의 원자성용이다 | `docs/gateway/sandboxing/workspace-access.md:~60-80` |
| tool 쓰기 전 journal | file tool이 쓰기 전 내용을 저장한다는 코드는 못 찾았다 | 확인 못함 |

## 8. shell에 넘기는 환경 변수와 secret

| 대상 | 내용 | 근거 |
|---|---|---|
| sandbox exec (container) | container는 `--env-file`로 **config의 `docker.env`만** 받는다(값 검사: null byte 거절, 32 KB 초과·base64 모양은 경고). host의 `process.env`를 자동으로 넘기는 경로는 못 찾았다. 매 exec의 env는 `PATH` + `HOME=<container workdir>` + sandbox env + model이 준 env다 | `src/agents/sandbox/docker.ts:230-259,342`, `src/agents/bash-tools.shared.ts:34-45`, `src/agents/sandbox/sanitize-env-vars.ts` |
| secret 이름 차단 | `sanitizeEnvVars`(자동 전파·secret store env가 sandbox로 갈 때)는 `AWS_SECRET_ACCESS_KEY/SESSION_TOKEN`, `*_ADMIN_KEY`, `_?(API_KEY\|TOKEN\|PASSWORD\|PRIVATE_KEY\|SECRET)$`, 알려진 provider key 이름을 막는다. `strictMode`면 allowlist(`LANG LC_* PATH HOME USER SHELL TERM TZ NODE_ENV`)만 통과. 반면 `docker.env`에 **사람이 명시한** 값은 이름 검사를 안 한다 | `src/agents/sandbox/sanitize-env-vars.ts:14-30,104-118`, `src/secrets/secret-env-name.ts` |
| host exec (gateway/node) | process env를 상속하되 **blocklist를 걸러 낸다.** 코드 주입 경로를 막는 목록: `NODE_OPTIONS`, `PYTHONPATH`, `BASH_ENV`, `LD_*`/`DYLD_*`/`BASH_FUNC_*` prefix, `GIT_*`(`GIT_DIR` 등), compiler·editor·pager 변수, `JAVA_TOOL_OPTIONS` 등 110개. model이 `env`로 주는 override에는 156개(HOME, PATH, proxy, `*_CONFIG_FILE`, `XDG_*`, `NPM_CONFIG_*`/`GIT_CONFIG_*` prefix 등)를 더 막고, 막힌 key가 오면 "Security Violation"으로 command를 거절한다 | `src/infra/host-env-security-policy.json`, `src/infra/host-env-security.ts:156-175,225-256`, `src/agents/bash-tools.exec-request-preparation.ts:423-490` |
| host exec의 secret | 상속 차단 목록에 `AWS_*`, `GH_TOKEN`, `GITHUB_TOKEN`, `GITLAB_TOKEN`, `NPM_TOKEN`, `NODE_AUTH_TOKEN`, `DATABASE_URL`, `REDIS_URL`, `MONGODB_URI`, `SSH_AUTH_SOCK`, `KUBECONFIG`, `GOOGLE_APPLICATION_CREDENTIALS`, `AZURE_CLIENT_SECRET`가 들어 있다. **`OPENAI_API_KEY`·`ANTHROPIC_API_KEY` 같은 model provider key는 이 목록에 없다**(JSON grep으로 확인). 그러니 Gateway process env에 그 key를 두었다면 host shell이 본다. 문서는 대신 provider 자격증명을 auth profile SQLite나 `~/.openclaw/.env`에 두라고 한다 | `src/infra/host-env-security-policy.json`, `docs/gateway/security/secrets-and-storage.md:74` |
| shell snapshot | gateway host의 bash/zsh exec은 shell startup 파일에서 alias·function과 안전한 env만 뽑아 snapshot으로 만들어 쓴다. secret처럼 생긴 변수는 제외 | `docs/tools/exec.md:86` |
| secret store + egress proxy (기본 꺼짐) | 켜면 Gateway 쪽 agent subprocess는 shared-store `secret`을 평문이 아니라 `oc-sent-v2...` sentinel로 받는다. loopback proxy가 **허용 host(정확 일치, wildcard 없음)**로 가는 HTTPS 요청에서만 sentinel을 평문으로 바꾼다. host 허용이 없으면 치환하지 않는다. process마다 grant, process 종료·취소·timeout·shutdown에서 회수. 단 `env` 항목은 평문이고, "허용 host가 credential을 되돌려 주면" 평문이 agent에게 갈 수 있다고 문서가 경고한다 | `docs/gateway/secrets/secret-store-and-egress.md`, `docs/tools/exec.md:90-95` |
| model provider 자격증명 | SecretRef 자격증명은 model 호출 chain에서 process-local sentinel로 다니다가 요청이 나가기 직전에 치환한다. "process isolation은 아니다" | `docs/gateway/secrets/runtime-model.md:38-49` |
| 로그·transcript | transcript, tool 인자·결과, `.env` 읽기 결과는 **원문 그대로** 저장되어 자격증명을 담을 수 있다. 로그 tail·console·export만 따로 가린다. 파일 권한 `600`/디렉터리 `700`에 의존한다 | `docs/gateway/security/secrets-and-storage.md:87` |
| workspace `.env` | untrusted workspace `.env`가 provider key, `OPENCLAW_*`, endpoint 변수를 덮어쓰지 못하게 막는다 | `docs/gateway/security/secrets-and-storage.md:74-78` |

## 9. lophn에 비춰 본 점

| OpenClaw의 방식 | lophn의 A·B·C 선택에 주는 뜻 |
|---|---|
| OS sandbox가 없고 container 하나(Docker/Podman)가 유일한 격리 장치. 기본 꺼짐 | OpenClaw는 A(OS sandbox 안의 shell)를 택하지 않았다. 결론은 "host shell + 승인 + 선택적 container"이고, container가 기본으로 꺼져 있다. (1)(2)를 지키려면 경계가 기본으로 켜져 있어야 한다는 반례다 |
| 켜면 container는 network 없음, root 읽기 전용, `cap-drop ALL`, host env 미상속, 민감 경로 mount 금지(`.ssh .aws` 등), 위험 설정은 `dangerously...` 이름으로 분리 | C의 모범 설정이다. (1)(2)에는 이 수준이 맞다(앱 DB를 mount하지 않으면 container 안에서는 존재하지 않는다). 비용은 network가 없어서 shell로 패키지를 못 받는다는 것, 그래서 web을 Gateway 쪽 tool로 따로 둔다는 것이다. B(Deno flag)도 `--allow-net` 없이 같은 효과를 낼 수 있다 |
| exec 승인의 기본이 `full/off`. 승인은 "operator intent 보조"이고 containment가 아니라고 문서가 명시 | (5)와 (3)에는 기본값이 `ask` 쪽이어야 한다. OpenClaw처럼 "승인이 있으니 안전하다"로 두면 sandbox가 꺼진 순간 경계가 없다. 승인은 경계가 아니라 경계 위의 의사결정으로 둔다 |
| 판정 층: tool 정책(이름) → exec mode(allowlist/ask/auto/full) → 실행 직전 binding(실행 파일 identity, script 파일 hash) | 같은 모양이다. 특히 **"승인한 명령 = 승인한 실행 파일 identity + argv + cwd"**를 묶고 launch 직전에 재검증하는 것은 A·B·C 어느 쪽에도 가져올 만하다(승인과 실행 사이 TOCTOU). B(code run)에서는 승인 단위를 "script text 해시 + 권한 flag 묶음"으로 둘 수 있다 |
| "항상" = 실행 파일 경로 + 정확한 argv 해시 + 승인한 cwd. 다른 directory에서는 다시 묻는다. 인라인 eval은 영구화 안 함. 저장은 host SQLite의 per-agent 문서, UI·CLI로 열람·삭제. 옛 항목(cwd 없음)은 무효화 | lophn이 "항상"을 둔다면 가장 좁게 잡은 사례다(명령 prefix·host보다 좁다). Hermes(pattern), omp(tool 이름)보다 안전하다. 단위를 좁게 하면 매번 새 승인이 늘어나니 UX 대가는 있다. 영구 grant를 사람이 보는 목록(사용 횟수, 마지막 사용)으로 두고 만료를 선택으로 두는 점은 (3)에 그대로 가져올 만하다 |
| LLM reviewer(`auto`): 한 명령을 untrusted data로 보고 allow(1회)/deny(사유 반환)/ask. 묶을 수 없는 형태는 reviewer를 건너뛰고 사람에게. deny 3연속이면 사람에게 | Hermes smart mode와 같은 쪽이다. lophn의 기준(결정은 사람)과는 맞지 않는다. 참고할 것은 안전장치다: allow는 한 번만 유효, 판정 불가·형태 불명은 사람에게, reviewer 입력의 지시문은 deny, 연속 deny는 사람에게 올림. 도입하지 않아도 deny 사유를 agent에게 돌려주고 "우회 금지"를 적는 방식은 가져올 만하다 |
| agent는 경계 확장을 청하지 않는다. "sandbox 통째로 풀기"는 사람이 켠 operator gate(`elevated` + sender allowlist)로만 | (3)에 맞는 단순한 구조다. lophn은 "경로·host 더하기"를 만들 필요 없이 사람이 Settings에서 grant를 고치게 하면 된다. 다만 OpenClaw는 이 gate 밖에서 agent가 config 파일을 `write`로 쓰는 길을 막지 않는다(4절). (3)을 지키려면 지침·grant 저장소를 agent가 쓸 수 없는 경로(쓰기 mount 없음, 앱 DB 밖)에 둬야 한다 |
| 파일 tool은 묻지 않는다. 기본 workspace 제한 없음(`workspaceOnly` 미설정). `apply_patch`만 기본 workspace 제한. session mode에서는 root 밖을 거절 | file tool의 경계를 정책 값 하나(`workspaceOnly`)에 맡기면 기본이 열린다. lophn은 파일 tool의 root를 기본으로 두고 root 밖은 "묻기가 아니라 거절"(guarded 모드처럼)로 시작하는 쪽이 (2)에 안전하다 |
| 보호 경로(설정·지침 파일) 목록이 없다. 대신 `gateway` tool은 읽기만, 영구 설정 변경은 typed 작업 + 정책 승인 | (3)의 직접 사례다. "typed 작업 + 승인" 경로를 열고 raw 파일 쓰기는 경로 밖으로 두면 OpenClaw의 빈틈(raw write)이 없다. agent가 만드는 skill은 즉시 적용하되 이전 버전을 저장해 undo를 주는 방식도 참고가 된다 |
| web: 묻지 않고 SSRF guard(private 대역 차단)와 결과 wrapping, 일반 도메인 allowlist 없음. 입력이 위험하면 reader agent로 분리 | lophn이 web을 주면 (1)(2) 위협은 "외부로 새는 길"이다. OpenClaw는 이를 tool 분리(reader agent)에 맡겼다. host allowlist가 필요하면 직접 만들어야 한다. B의 Deno `--allow-net=<host>`가 이를 한 줄로 표현한다. sandbox network를 끄고 web을 Gateway 쪽 tool로 두는 구조는 A·C 어느 쪽에서도 쓸 수 있는 분리다 |
| 사람 없는 실행: 승인 UI가 없으면 `askFallback`(기본 deny). automation은 연결된 approval client가 있으면 기다리고 없으면 즉시 거절. automation의 "항상"은 allowlist가 아니라 job 정의에 묶인 standing grant(편집하면 무효) | (5)에 가장 직접 닿는 설계다. 가져올 것: (a) 기다릴지 거절할지를 "approval surface가 연결돼 있는가"로 가른다(lophn은 desktop app이 있어 대기 목록에 남겨 둘 수 있지만, 앱이 닫혀 있으면 거절). (b) unattended 실행의 "항상"은 일반 grant와 분리해 job 정의에 묶고 바뀌면 무효로 한다. (c) job이 가질 tool 상한을 만들 때 저장하고 넓힐 수 없게 한다. 주의: 기본이 `full/off`이고 `script` payload가 exec까지 unattended로 돈다. 기본이 이 반대여야 한다 |
| 되돌리기: rewind는 대화만, 파일 undo·shadow git 없음. 대신 session마다 git worktree + 읽기 전용 diff panel, archive 때 snapshot | (4)를 OpenClaw에서 가져올 구현은 없다. 단 "shell이든 file tool이든 git이 본다"는 worktree + diff는 shell이 바꾼 파일까지 포괄하는 가장 싼 방법이다. lophn의 파일이 git 밖(앱 DB, 문서)이면 안 된다. 그러면 변경 전 내용을 저장하는 journal을 직접 만들어야 하고, A에서는 sandbox 쓰기 영역을 overlay/복사본으로 두고 diff를 적용하는 방식, B에서는 code run 쪽 쓰기를 tool bridge로 모아 journal을 남기는 방식이 후보다. OpenClaw의 sandbox + managed worktree reconcile(guest의 private checkout → host 적용, 충돌 시 양쪽 보존)은 이 모양의 실제 사례다 |
| Code Mode: `node:vm`은 boundary가 아니라고 명시, `quickjs`(WASM)는 ambient host access 없음. 모든 부수 효과는 tool bridge로 나가고 정책·승인은 Gateway가 건다 | B의 근거다. code run 안에서 직접 fs·net을 쓰지 못하게 하고 tool 호출만 열면 승인 지점이 하나로 모인다. Deno 권한 flag는 이 모양을 process 권한으로 구현한 것이다. 다만 OpenClaw의 Code Mode는 "코드를 가두기"보다 "tool 호출을 모으기"가 목적이고, 쉘 명령 실행은 이 경로에 없다 |
| 문서가 "한 gateway = 한 신뢰 경계"로 고정하고, 적대적 사용자끼리는 gateway(OS user, host)를 분리하라고 한다 | lophn은 앱 하나에 사용자 하나이므로 사용자 사이 분리는 필요 없다. 다만 OpenClaw는 agent가 operator와 같은 OS 권한으로 돈다는 가정에서 출발한다. lophn은 agent를 사용자와 같은 신뢰 경계에 두지 않는 것이 (1)(2)(3)의 전제이므로 이 가정은 가져오지 않는다 |

## 확인 못한 것

- history: shallow clone이라 어느 기능(allow-always의 cwd 묶임, auto reviewer, standing grant)이 언제 생겼는지 모른다. 다만 문서에 "2026.8.1 이전 항목은 무효" 같은 문구가 있어 2026.8.1이 한 번 크게 바뀐 시점으로 보인다.
- 실제 실행: 아무것도 실행하지 않았다. sandbox가 켜진 상태에서 web tool이 정말 막히는지, container에서 실제로 어떤 env가 보이는지는 코드 읽기로만 확인했다.
- OpenClaw 자체에 Seatbelt/bwrap/Landlock 사용이 정말 없는지: `seatbelt|landlock|bwrap|sandbox-exec` grep 결과가 위 두 종류뿐이었다는 뜻이다. macOS 앱(`apps/macos`)의 entitlements와 App Sandbox 사용 여부는 열어 보지 않았다.
- Windows에서 exec의 경계(승인 정책이 같은지, Windows 전용 allowlist 분석이 어디까지인지): 코드에 `analyzeWindowsShellCommand` 분기가 있다는 것만 봤다.
- 파일 tool(`read/write/edit`)이 쓰기 전에 내용을 저장하거나 `state/`·`openclaw.json`을 막는 코드: grep으로 못 찾았지만 모든 경로를 읽은 것은 아니다.
- `tools.exec.mode`가 설정에 없을 때 새 install이 실제로 `full`로 도는지: 문서(`docs/tools/exec.md:126`, `trust-model.md:67`)와 코드 상수(`exec-approvals-config.ts:95-96`)가 일치한다는 것까지만 확인했다. onboarding wizard가 다른 값을 쓰는지는 못 봤다.
- 승인 거절 때 사람이 쓴 사유가 agent에게 가는지, macOS app 승인 panel의 세부 선택지(Allow Once / Always Allow Here / Don't Allow 외)는 문서 수준으로만 읽었다.
- subagent의 exec 승인이 부모 session 어디로 가는지(requester chat, Control UI): 전용 규칙은 못 찾았다. `docs/tools/exec-approvals.md:766`의 "denial은 subagent·cron session에 되돌리지 않는다"만 확인.
- browser tool(Chrome, CDP)의 SSRF·승인 정책은 이번 범위 밖이다.
- Codex harness(native)의 sandbox는 Codex 쪽 사실이라 다시 읽지 않았다. OpenClaw 문서가 적은 기본값(YOLO)만 옮겼다.
