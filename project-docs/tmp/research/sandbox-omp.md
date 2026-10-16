# sandbox·approval 조사: omp (oh-my-pi) (2026-10-15)

사람(요약): omp가 agent의 shell·code 실행, 파일 tool, web tool을 어떻게 가두고 승인하는지, pi 원본과 무엇이 다른지 조사한다. lophn은 file, shell(또는 code run), web tool을 줄지 정하는 중이고, 가둘 경계로 (A) OS sandbox 안의 shell, (B) Deno 권한 flag로 가둔 code run, (C) container를 견주고 있다.

- repo: github.com/can1357/oh-my-pi @ `c2cb79e4` (2026-10-14, "chore: bump version to 18.11.0"). 이 이름이 맞다: `git remote`가 `can1357/oh-my-pi`, `package.json`의 name `omp`, homepage `omp.sh`, author Stencil Labs. README 끝에 "omp is a fork of Pi (badlogic/pi-mono)"라고 적혀 있다. `--depth 1`로 받아 읽기만 했고 아무것도 실행하지 않았다. 그래서 history(승인 체계가 언제 생겼는지)는 못 봤다.
- 근거(repo 안 경로): `docs/approval-mode.md`, `docs/bash-tool-runtime.md`, `docs/natives-shell-pty-process.md`, `docs/secrets.md`, `docs/python-repl.md`, `docs/rpc.md`, `docs/tools/{checkpoint,rewind,write,edit,read,task,web_search}.md`, `packages/coding-agent/src/tools/{approval,bash,write,read,path-utils,settings,plan-mode-guard}.ts`, `src/extensibility/extensions/wrapper.ts`, `src/session/{session-tools,acp-permission-gate}.ts`, `src/internal-urls/{cfg-protocol,router}.ts`, `src/task/{executor,settings}.ts`, `src/eval/py/runtime.ts`, `src/exec/settings.ts`, `packages/utils/src/{env,procmgr}.ts`, `crates/pi-iso/src/lib.rs`, `crates/pi-shell`. 경로는 따로 적지 않으면 `packages/coding-agent/` 아래다.
- pi 원본은 이번에 다시 읽지 않았다. 아래 "pi와 다른 점"은 의뢰문에 적힌 pi 사실(permission 체계가 없고 "use a sandbox"라며 밖에 맡긴다, `docs/usage.md`)을 기준으로 omp 쪽만 확인한 것이다.

## 한 줄 결론

omp에는 OS sandbox가 없다. 대신 pi에 없는 approval 체계가 있다(tool을 read/write/exec 세 tier로 나누고 mode로 묻는다). 그런데 기본 mode가 `yolo`라서 기본으로는 아무것도 묻지 않는다. omp 문서 스스로 approval은 "containment가 아니다"라고 적는다.

## 1. shell·code 실행의 sandbox

| 항목 | 내용 | 근거 |
|---|---|---|
| OS sandbox (Seatbelt, bubblewrap, Landlock, Windows) | 없음. repo 전체에서 해당 이름이 코드로 나오는 곳이 없다. `sandbox`가 나오는 곳은 전부 다른 뜻이다(Gemini API의 sandbox endpoint, `local://` 임시 쓰기 영역, `robomp` bot의 git worktree 관리, 시험 fixture) | grep 결과. `src/session/settings.ts:906`, `src/tools/write.ts:775` |
| 기본 | shell은 omp process와 같은 사용자 권한으로 돈다. "An approved command retains the shell's ambient filesystem, network, and subprocess access" | `docs/approval-mode.md:81`, `docs/bash-tool-runtime.md:48` |
| 방식 | bash tool은 Rust로 만든 in-process shell(brush 기반)이다. 일부 coreutils와 `jq`(jaq)를 in-process builtin으로 쓰지만 외부 program은 그대로 fork/exec한다. 격리 장치가 아니라 `scheme://` 경로를 shell에서 쓰고 출력을 모으려는 장치다 | `docs/natives-shell-pty-process.md:44-53`, `docs/bash-tool-runtime.md:34,146` |
| 쓰기·읽기 경로 제한 | 없음. 절대 경로, `~`, `..`를 그대로 따른다 | `src/tools/path-utils.ts:320-332` |
| network 제한 | 없음 | 위와 같다. network 차단 코드를 못 찾았다 |
| 환경 변수 제한 | 아래 8절. 부모 env를 거의 그대로 넘긴다 | |
| container | agent 격리용은 없다. 루트 `Dockerfile`, `Dockerfile.robomp`은 omp 자체나 `robomp`(GitHub triage bot)를 이미지로 만드는 것이다 | `Dockerfile:1-15`, `Dockerfile.robomp:1-12` |
| `eval` tool(Python, JS) | Python은 별도 subprocess, JS는 isolated subprocess(실패하면 Bun Worker)다. 둘 다 권한 제한은 없다. Python은 env만 걸러 낸다(8절) | `docs/tools/eval.md:245`, `docs/python-repl.md:48` |
| `bash.enabled` | `false`면 model에게 bash tool을 안 준다. 기본 `true`. 사람이 치는 `!cmd`와 RPC `bash` 요청은 여전히 된다 | `docs/bash-tool-runtime.md:19`, `src/exec/settings.ts:83-85` |
| git guard | `bash.gitGuard`(기본 `false`)를 켜면 `git stash`, `reset --hard`, 충돌 아닌 `checkout/switch/restore` 같은 "공유 작업을 버리거나 옮기는" git 명령을 shell 안에서 거절한다. git 명령 하나를 보는 장치라 sandbox가 아니다 | `src/exec/settings.ts:121-123`, `docs/natives-shell-pty-process.md:54` |
| task isolation | subagent를 격리된 복사본(Linux overlayfs / fuse-overlayfs, macOS APFS clone, Btrfs/ZFS/reflink, Windows ProjFS, 마지막 수단은 git worktree나 recursive copy)에서 돌리고 patch로 되돌려 받는다. 보안 경계가 아니라 병렬 작업 충돌을 피하는 장치다. `task.isolation.enabled` 기본 `false`, 켜면 git repo가 있어야 한다. `apply`(기본 `true`)면 성공한 변경이 부모에 적용된다 | `crates/pi-iso/src/lib.rs:1-20`, `src/task/settings.ts:27-31,148-152`, `docs/tools/task.md:109-111,164` |

omp 문서가 직접 한계를 적은 곳: pattern 규칙은 "process나 filesystem containment가 아니다"(`docs/approval-mode.md:81`), 그리고 `bash.patterns`의 `deny`는 `eval`로 같은 명령을 돌리면 소용없다. `eval`도 exec tier인데 yolo에서는 allow로 풀리기 때문이다(같은 줄).

## 2. 권한·승인 체계

pi에는 없는 부분이다. omp가 추가했다.

- **tier:** 모든 tool이 `approval`을 `read` / `write` / `exec` 중 하나로 선언한다. 선언이 없거나 잘못되면 `exec`. MCP server tool은 MCP annotation과 상관없이 `write`. (`docs/approval-mode.md:5-12`, `src/tools/approval.ts:140-171`)
- **mode(`tools.approvalMode`):** (`docs/approval-mode.md:16-26`)

  | mode | 자동 승인 | 묻는 것 |
  |---|---|---|
  | `always-ask` | read | write, exec |
  | `write` | read, write | exec |
  | `yolo` (기본) | 전부 | 없음 |

  기본값이 `yolo`인 것은 `src/tools/settings.ts:311-316`(`default: "yolo"`)에서 확인했다. 즉 설치하고 아무것도 안 만지면 bash, write, edit, eval, task, browser 모두 묻지 않는다.
- **tool별 사용자 정책:** `tools.approval.<tool>: allow | deny | prompt`. 모든 mode에서 먹는다. `deny`는 yolo보다 먼저 막는다. (`docs/approval-mode.md:28-62`, `src/tools/approval.ts:204-319`)
- **판정 순서:** tool 자신의 `deny` > 사용자 `deny` > (yolo면 tool의 명시 정책, 사용자 정책, 아니면 allow) > (비 yolo면 `override`, tool 명시 정책, 사용자 정책, mode와 tier 비교). (`docs/approval-mode.md:51-58`)
- **fail-closed:** 실행 시점 context에 settings도 `--auto-approve`도 없으면 `always-ask`에 grant 없음으로 처리한다. (`src/tools/approval.ts:57-84`)
- **위험 명령 pattern:** `CRITICAL_BASH_PATTERNS`가 코드에 박혀 있다. `rm -rf /`류, `sudo rm`, `chmod/chown -R … /`, fork bomb, `mkfs`, `dd of=/dev/`, `cryptsetup`, `/etc/passwd·shadow·sudoers` 덮어쓰기, `curl … | sh`와 process substitution/`eval $(curl …)`, `kill -9 1`, `shutdown/reboot`, `nc -e`. 걸리면 비 yolo mode에서 `override: true`로 prompt를 강제한다. **yolo에서는 이 override를 무시한다**("a bare critical override is ignored"). 코드 주석이 "false negative의 비용은 데이터 손실이므로 짧게 유지한다"고 적는다. (`src/tools/bash.ts:179-230`, `docs/approval-mode.md:72`)
- **사용자 pattern 규칙(`bash.patterns`):** `[{match, approval: allow|deny|prompt}]`, `*` wildcard만. 기본 빈 목록. `allow`는 명령 전체가 맞아야 하고 shell 제어 문법(`;`, `|`, redirection 등)이 든 명령은 허용하지 않는다. `bash.allowCompoundCommands`(기본 `false`)를 켜면 리터럴 인자의 `&&` chain만 segment별로 본다. critical 검사가 `allow`/`prompt`보다 먼저다. (`src/exec/settings.ts:95-144`, `src/tools/bash.ts:79-135,232-313,504-560`, `docs/approval-mode.md:72-79`)
- **LLM 분류기:** 없다. 판정은 전부 정적 규칙과 사람이다.
- **bash interceptor:** `bashInterceptor.enabled`(기본 `false`)는 `cat`, `grep` 같은 명령을 dedicated tool로 돌려보내는 routing 장치다. 문서가 "best-effort routing이지 shell-security 정책이 아니다"라고 적는다. (`docs/bash-tool-runtime.md:54-65`, `src/exec/settings.ts:147-150`)
- **extension hook:** extension의 `tool_call` handler가 `block`하거나 인자를 바꿀 수 있다. approval은 바뀐 인자로 다시 판정한다("approve one thing, run another" 방지). (`docs/hooks.md:149`, `src/extensibility/extensions/wrapper.ts:250-335`)
- **다른 tier 장치:** computer-use의 provider safety check는 yolo나 per-tool allow여도 prompt를 강제하고, UI가 없으면 실패한다. (`docs/approval-mode.md:92`)

### pi와 다른 점

| | pi (의뢰문) | omp |
|---|---|---|
| approval 체계 | 없음 | 있음. tier 3단계, mode 3개, per-tool allow/deny/prompt, bash pattern |
| 기본 | 묻지 않음 | **묻지 않음(yolo)**. 체계는 있지만 켜야 한다 |
| 격리 | "use a sandbox"라며 밖에 맡김 | 마찬가지로 없음. omp는 approval만 얹고 containment는 하지 않는다고 문서에 적었다 |
| 추가 장치 | | git guard(기본 off), interceptor(기본 off), task isolation(기본 off), secret obfuscation(기본 off) |

기본 off인 장치가 많다. omp가 "안전하게 쓰려면 사용자가 설정해야 한다" 쪽이라는 뜻이다.

## 3. 경계를 넘을 때

agent가 "청하는" 흐름은 따로 없다. agent는 tool을 호출하고, wrapper가 호출 직전에 정책을 보고 막거나 묻는다. agent가 권한을 올려 달라고 요청하는 tool은 없다(`cfg://` 예외는 아래).

### 사람의 선택지

| 표면 | 선택지 | "항상"의 단위 | 저장 |
|---|---|---|---|
| TUI(interactive) | 승인(`Ctrl+Enter`/`Ctrl+Q`), 거절(`Esc`) | **없다.** 한 번(once)과 거절뿐 | 없음 |
| RPC(`--mode rpc`, `rpc-ui`), 기타 dialog 없는 host | `ui.select(prompt, ["Approve","Deny"])`. `extension_ui_request`의 `select` frame. 전체 detail이 prompt 문자열에 들어간다 | 없다 | 없음 |
| ACP(`omp acp`) | `session/request_permission`에 `allow_once` / `allow_always` / `reject_once` / `reject_always` 4개 | `allow_always`는 **tool 이름 단위**다(`bash`면 이후 모든 일반 bash 호출). edit의 삭제는 `edit:delete`, 이동은 `edit:move` | session 객체의 메모리 `Map`. 디스크에 안 쓴다. session 정리 시 `clear()` |
| `cfg://` 쓰기(agent가 자기 설정을 바꾸려 할 때) | `once` / `session` / `deny` / `timeout` | session grant. `/save` grant는 save와 session 변경을 함께 덮는다 | 메모리. 승인되면 global `config.yml`에 설정값 자체가 써진다 |

근거: TUI 키와 RPC/ACP select는 `docs/approval-mode.md:105`, `src/tools/approval.ts:414-430`, `src/extensibility/extensions/wrapper.ts:354-421`. ACP는 `src/session/acp-permission-gate.ts:7-20`, `src/session/session-tools.ts:424,881-1000`. `cfg://`는 `src/internal-urls/cfg-protocol.ts:1-18,99-102`.

중요한 점:
- 명령 prefix, 경로, host 단위의 "항상"은 없다. 가장 넓은 것이 ACP의 tool 이름 단위이고, 그것도 메모리에만 있다.
- 사람이 "항상"에 가까운 것을 원하면 설정 파일에 `tools.approval.<tool>: allow`나 `bash.patterns`를 직접 써야 한다. prompt에서 승인하며 규칙이 만들어지는 길은 없다.
- ACP에서 critical 명령이나 명시적 `prompt` pattern으로 강제된 prompt는 "Always allow"를 골라도 cache하지 않는다(`cacheable = !resolved.override`, `src/session/session-tools.ts:918`).
- 거절 시 agent가 받는 것: wrapper는 `Tool call denied by user: <tool>` 오류를 던진다. ACP는 `Tool call rejected by user (<tool>)`. TUI에서는 composer에 메시지를 보내면 대기 중인 approval이 전부 거절되고 그 메시지로 turn을 steering한다. 그래서 agent가 이유를 안다(`docs/approval-mode.md:105`).
- 승인 prompt는 키 입력 실수를 막으려고 처음 0.5초는 approve 키를 무시하고, composer 빈 상태의 Enter는 승인하지 않는다(같은 줄).

### ACP로 띄울 때의 모양

- `omp acp` 서버가 ACP client의 capability에 따라 bash를 `terminal/create`, read를 `fs/read_text_file`, write를 `fs/write_text_file`로 보낸다. (`README.md:554-565`, `src/modes/acp/acp-client-bridge.ts:33-69`)
- permission 요청에는 `toolCallId`, `toolName`, `title`(bash는 명령 앞 80자), `kind: "execute"`(bash), `rawInput`(인자 전체), `content`(`$ <command>`), `locations`(절대 경로)가 실린다. (`src/session/session-tools.ts:948-975`)
- gate가 걸리는 tool은 `bash`, `edit`(patch에 삭제나 이름 변경이 있을 때만), `delete`, `move`뿐이다(`PERMISSION_REQUIRED_TOOLS`, `getPermissionIntent`: `src/session/acp-permission-gate.ts:7-97`). 일반 파일 내용 edit와 `write`는 ACP gate가 없다(`docs/approval-mode.md:172`). README 표는 "`edit, bash` -> `session/request_permission`"이라고만 적어서 읽으면 모든 edit이 묻는 것처럼 보이지만 source는 그렇지 않다.
- **기본 yolo인데 ACP bash는 묻는다.** 명시적으로 yolo를 고르지 않았으면(설정 파일이나 flag에 안 적었으면) schema 기본 yolo를 `always-ask`로 바꿔서 판정한다. `--yolo`, `--auto-approve`, `--approval-mode yolo`, 또는 `tools.approvalMode: yolo`를 명시하면 gate를 끈다. (`src/session/session-tools.ts:881-918`, `docs/approval-mode.md:168`) 즉 omp 스스로 "기본 yolo는 외부 client에 내줄 기본값이 못 된다"고 본 것이다.
- ACP는 session별 approval-policy 필드가 없다. session별로 다르게 하려면 `omp acp` process를 따로 띄워야 한다(`docs/approval-mode.md:166`).
- generic prompt는 client가 `elicitation.form`을 광고하면 form elicitation으로 간다(`docs/approval-mode.md:172`).

## 4. 파일 tool

| 항목 | 내용 | 근거 |
|---|---|---|
| tier | `read`, `grep`, `glob`은 read. `write`, `edit`, `ast_edit`는 write. 일반 경로면 대상이 어디든 write tier다. tier는 경로가 아니라 **scheme(`local://`, `xd://`, `cfg://` 등)** 에 따라 달라진다 | `src/tools/write.ts:462-473`, `src/internal-urls/router.ts:403-409`, `src/tools/read.ts:987-996`, `src/edit/index.ts:383-391` |
| workspace 밖 경로 | **막지도 묻지도 않는다.** `resolveToCwd`는 절대 경로, `~`, `..`를 그대로 허용한다. workspace 안으로 가두는 함수(`symlink` 포함)는 있지만 "원격 peer가 준 경로" 용(Cursor download)이고 일반 tool은 쓰지 않는다 | `src/tools/path-utils.ts:320-345` |
| 보호 경로(설정, 지침, secret 파일) | **없다.** `AGENTS.md`, `~/.omp/agent/config.yml`, `.omp/`, `~/.ssh`, `.env`를 쓰거나 읽는 것을 별도로 막거나 묻는 코드를 못 찾았다(`protected`, `.ssh`, `config.yml` 등을 grep). 그냥 write tier다 | grep 결과 |
| 그 밖의 쓰기 막이 | 자동 생성 파일 덮어쓰기 거절(`edit.blockAutoGenerated`, 기본 `true`). plan mode에서는 working tree 쓰기·삭제·이름 변경을 거절하고 `local://` 임시 영역만 허용. 읽기 전용 scheme(`artifact://`, `skill://` 등)은 prompt 없이 deny | `src/tools/auto-generated-guard.ts`, `src/tools/plan-mode-guard.ts:124-151`, `docs/tools/write.md:151` |
| 안내문 | edit은 `edit.enforceSeenLines`(기본 `true`)로 본 적 없는 줄은 고치지 못한다. 정합성 장치이지 보안 장치는 아니다 | `docs/tools/edit.md:150` |
| agent의 자기 설정 변경 | 설정은 `cfg://<setting>`으로만 바꾸게 안내한다. **상호작용 TUI의 최상위 session만** 쓸 수 있고 매번 사람 승인을 받는다. subagent, print, RPC, ACP, 백그라운드 fork는 거절한다. credential 값은 읽을 때 가려진다. 다만 이는 `cfg://` 경로의 규칙이다. 같은 일을 `write`로 `config.yml`에 직접 하는 것은 위 "보호 경로 없음"이라 막지 않는다 | `src/internal-urls/cfg-protocol.ts:1-18,296-318`, `src/main.ts:2255` |

즉 (3) "agent가 자기 grant나 지침을 고치지 못하는 것"은 omp에서 `cfg://` 하나만 지켜지고, 파일 경로로는 열려 있다.

## 5. web 검색·읽기 tool

| 항목 | 내용 | 근거 |
|---|---|---|
| `web_search` | 있다. approval tier `read`(묻지 않음). provider chain(Anthropic, Brave, Exa, DuckDuckGo 등 수십 종, key 없는 scrape 포함)에서 첫 쓸 만한 결과를 쓴다. 질의의 `site:`는 provider 필터로 변환될 뿐 사용자 도메인 정책이 아니다 | `src/web/search/index.ts:392`, `docs/tools/web_search.md:59` |
| URL 읽기 | `read` tool이 `http://`, `https://`, `www.` 경로를 받아 fetch한다. tier는 `read`다(internal scheme이 아니면 read). 별도 web fetch tool이 있는 것이 아니라 `read` 안에 들어 있다 | `docs/tools/read.md:271-285`, `src/tools/read.ts:987-996`, `src/tools/fetch.ts` |
| 도메인 제한 | allowlist, denylist, 사용자 설정 없음. private/loopback/link-local(`127.0.0.1`, `169.254`) 차단도 `fetch.ts`와 `web/scrapers/utils.ts`에서 못 찾았다. 확인 못함: 다른 파일에 SSRF 방어가 있는지 | grep 결과 |
| 묻는 경우 | 없다. 단, URL 안에 `ssh://` 같은 exec tier scheme이 들어가면 tier가 올라간다(`readTier`가 substring으로 최대 tier를 찾는다. `ssh://`의 readTier가 exec: `src/internal-urls/ssh-protocol.ts:249`). `browser` tool은 exec | `src/internal-urls/router.ts:411-421`, `docs/approval-mode.md:7` |

즉 network 경계는 두 가지가 다 열려 있다. shell은 network 제한이 없고, `read`로 임의 URL을 묻지 않고 가져온다. 데이터 유출 경로(`curl`, `web` tool)에 대한 정책이 없다.

## 6. 사람이 없는 실행

| 상황 | approval | 근거 |
|---|---|---|
| RPC(`--mode rpc`) | 기본 yolo면 prompt 자체가 없다. `always-ask`/`write`로 제한하면 `extension_ui_request`로 `select`(Approve/Deny)를 host에 보낸다. host가 답하지 않으면 `select`는 undefined이고 승인이 안 된다. `--no-ui`면 dialog를 안 보내고 "requires approval but no interactive UI available" 오류로 **fail-closed**다 | `docs/rpc.md:1199-1208`, `src/extensibility/extensions/wrapper.ts:392-406` |
| 상호작용 UI가 없는 session(print 등) | 같은 오류. 안내문이 "yolo로 바꾸든, `tools.approval.<tool>: allow`를 쓰든, 상호작용 UI를 쓰라"고 한다 | 같은 곳 |
| subagent(`task`) | `tools.approvalMode`를 **강제로 yolo**로 둔다("부모 `task` 승인이 authorization 경계"). 사용자 `deny`는 여전히 절대이고, `prompt`로 풀리는 호출은 headless라 **거절**된다. 부모의 `task`는 exec tier라 `write`/`always-ask` mode에서는 부모 쪽에서 한 번 묻는다 | `src/task/executor.ts:1170-1173`, `docs/approval-mode.md:174-176`, `docs/tools/task.md:112,161` |
| subagent의 설정 변경 | `cfg://` 거절("Subagents cannot change settings") | `src/internal-urls/cfg-protocol.ts:301-318` |
| background(async bash, `workpool`, eval의 `agent()`) | approval은 tool 호출 시점에 wrapper에서 한 번 판정되고(코드 구조상 launch 전), 이후 job은 그대로 돈다. 별도 재승인 흐름은 못 찾았다. 확인 못함: 오래 도는 job 중간에 정책이 바뀌었을 때의 동작 | `wrapper.ts:324-335` 구조에서 추정 |
| 추가로 사람이 없는 경우의 안전 장치 | 대기 timeout, `cancelled` 구별, 재연결 시 대기 목록 복원 등은 못 찾았다. approval 대기는 tool call이 await하는 Promise이고 TUI에서는 composer 메시지가 오면 일괄 거절된다 | `docs/approval-mode.md:105` |

## 7. 바꾼 파일 되돌리기

| 장치 | 파일을 되돌리나 | 근거 |
|---|---|---|
| `checkpoint` / `rewind` tool | **아니다.** conversation(message 수, session tree entry id)만 접는다. 문서가 "git-based checkpoint라는 summary 문구와 달리 git을 부르지도, 파일 시스템 snapshot을 만들지도 않는다", "working tree contents or staged changes는 캡처하지 않는다"고 적는다. 기본 off(`checkpoint.enabled`) | `docs/tools/checkpoint.md:78-87`, `docs/tools/rewind.md:62` |
| `/branch` (alias `/rewind`), `/fork`, session tree | 대화 지점으로 leaf를 옮긴다. 파일은 안 되돌린다 | `docs/tree.md:234`, `docs/session-operations-export-share-fork-resume.md:31` |
| 파일 undo, shadow git, file history | **없다.** `undo`, `backup`, snapshot 계열을 file 변경 쪽에서 못 찾았다(grep). shell이 바꾼 파일은 물론 `write`/`edit`이 바꾼 파일도 omp가 되돌려 주지 않는다. 사용자가 git으로 되돌려야 한다 | grep 결과 |
| task isolation + patch | 격리된 복사본에서 돈 subagent의 변경은 patch나 branch로 캡처되어 `apply=false`면 적용 전에 보류할 수 있고, 적용 실패 시 recovery artifact가 남는다. 이는 subagent의 shell 변경도 포함해 "적용 전 보류"가 가능하다는 뜻이다. 다만 기본 off이고 main agent에는 안 걸린다 | `docs/tools/task.md:92,111,133,196` |
| git guard | 되돌리기가 아니라 `reset --hard`, `stash` 같은 파괴를 막는 쪽(기본 off) | 1절 |

## 8. shell에 넘기는 환경 변수와 secret

| 항목 | 내용 | 근거 |
|---|---|---|
| bash tool 환경 | 부모(omp) process env를 거의 그대로 상속한다. 걸러 내는 것: ① 안전하지 않은 이름·값, ② omp 시작 project의 dotenv(`.env`, `.env.local` 등)에서 온 값(다른 project의 session이 받지 않게), ③ `GIT_DIR`, `GIT_WORK_TREE` 등 repo 위치를 고정하는 git 변수. 이 필터는 **correctness 목적**(git이 엉뚱한 repo를 만지지 않게)이지 secret 차단이 아니다. `*_KEY`, `*_TOKEN`을 이름으로 거르는 코드는 없다 | `packages/utils/src/env.ts:52-67,153-240`, `packages/utils/src/procmgr.ts`(buildSpawnEnv) |
| 덧씌우는 값 | non-interactive 기본값(`PAGER=cat`, `GIT_TERMINAL_PROMPT=0`, `CI=true`, `AGENT=1`, npm/pip 등 자동화 flag). direnv/devenv 변수를 command별로 얹는다 | `src/exec/non-interactive-env.ts:6-53`, `docs/bash-tool-runtime.md:154-174` |
| model이 env를 주는 길 | 없다. bash tool에는 model-facing `env` parameter가 없고 command 안의 assignment로만 가능하다 | `docs/bash-tool-runtime.md:13` |
| `eval`(Python) | allowlist(`PATH`, `HOME`, locale, `VIRTUAL_ENV`, `PYTHONPATH` 등 + `LC_`, `XDG_`, `PI_` prefix)로 걸러 낸 뒤 그 위에 API key 9종 denylist(OPENAI, ANTHROPIC, GOOGLE, GEMINI, OPENROUTER, PERPLEXITY, EXA, AZURE_OPENAI, MISTRAL 등)를 뺀다. bash보다 엄격한 유일한 경로다. 단 Python process가 `~/.aws/credentials` 같은 파일을 읽는 것은 막지 않는다 | `src/eval/py/runtime.ts:12-146`, `docs/python-repl.md:134-141` |
| `eval`(JS) | env 필터를 못 찾았다. 확인 못함 | `src/eval/js/executor.ts` grep |
| secret obfuscation | `secrets.enabled`, **기본 off.** 켜면 secret처럼 보이는 env(`KEY`, `SECRET`, `TOKEN`, `PASSWORD`…) 값, `secrets.yml` 항목, 알려진 token 모양(GitHub, OpenAI, Anthropic, AWS, JWT, PEM 등)을 **model이 보는 text에서** 가리고(`$$HASH$$` 형태의 가역 placeholder, 또는 `replace` mode의 되돌릴 수 없는 치환), model이 쓴 tool 인자에서는 실행 전에 원래 값으로 복원한다. 가려지는 곳은 provider로 가는 context이지 process의 env가 아니다. 즉 "model이 secret을 못 보게" 하는 것이지 "agent가 실행하는 process가 secret을 못 쓰게" 하는 것이 아니다 | `docs/secrets.md:3-24` |
| 파일 secret | `~/.ssh`, `.env`를 읽는 것은 막지 않는다. 읽은 결과의 token 모양은 obfuscation이 켜져 있으면 가려진다 | 4절 |

## 9. lophn에 비춰 본 점

lophn이 지켜야 하는 것: (1) 앱 DB를 그 앱의 process만 여는 것, (2) secret 파일, (3) agent가 자기 grant나 지침을 고치지 못하는 것, (4) agent가 바꾼 파일을 session 안에서 되돌리는 것, (5) 사람이 지켜보지 않을 때 도는 session.

| omp의 방식 | lophn의 A·B·C 선택에 주는 뜻 |
|---|---|
| OS sandbox, network 제한, 경로 제한이 아무것도 없다. approval이 유일한 방어이고 omp 문서가 "containment가 아니다"라고 선언한다 | omp는 A, B, C 어느 쪽의 예도 아니다. (1), (2)를 omp 같은 규칙 층만으로 지킬 수 없다는 반증이다. 경계는 규칙 위에 있어야 한다. A(OS sandbox), B(Deno `--allow-*`), C(container) 중 무엇을 고르든 approval은 그 위의 사람 결정 층이다 |
| 기본 mode가 `yolo`(묻지 않음). ACP로 띄울 때만 omp가 bash를 `always-ask`로 되돌린다 | 기본값을 어느 쪽에 두느냐가 (5)에 직결된다. omp 자신도 외부 client에 기본 yolo를 내주지 않았다. lophn은 경계 안(DB 접근 없음, secret 없음, 쓰기 범위 제한)에서는 allow, 경계를 넘을 때만 ask인 구조가 맞다 |
| tool을 read/write/exec tier로 나누고, 선언 없는 tool은 exec, context 없으면 `always-ask`(fail-closed) | lophn의 allow/ask/deny와 같은 모양이다. 모르는 것은 가장 강한 tier로 보는 기본값은 그대로 가져올 만하다 |
| `bash.patterns` deny는 `eval`로 같은 명령을 돌리면 우회된다. 정책이 tool 이름 단위다 | B(code run)와 A(shell)를 둘 다 열면 같은 경계가 두 경로에 걸려야 한다는 교훈이다. 명령 문자열 규칙은 우회되므로 process 권한(A의 sandbox, B의 Deno flag, C의 container mount)에서 막아야 한다. B는 shell 대신 code run 하나만 두므로 이 문제가 줄어든다 |
| critical pattern 목록(rm -rf /, curl\|sh, mkfs 등)을 비 yolo mode에서만 prompt로 강제한다. yolo에서는 무시한다 | pattern 목록은 보조 신호일 뿐이다. 경계가 있으면 필요 없고, 없으면 우회된다. lophn에서는 가져오지 않거나 UI 경고 정도로만 두는 쪽을 권한다 |
| "항상"이 없다. ACP의 `allow_always`는 tool 이름 단위이고 메모리뿐이다. 영구화는 사람이 설정 파일에 직접 쓴다 | 가장 넓은 단위(tool 전체)가 위험하다는 사례다. lophn에서 "항상"을 둔다면 명령 prefix, 경로, host 같은 좁은 단위로, Settings 규칙으로 저장해 사람이 보고 지울 수 있게 해야 한다. 대신 omp처럼 "항상"을 아예 없애고 설정 편집만 두는 것도 선택지다 |
| agent의 자기 설정 변경은 `cfg://` 하나로만 열고, 최상위 interactive session만, 매번 사람 승인, subagent와 headless는 거절 | (3)과 같은 목적이고 모양이 맞다. 다만 omp는 같은 파일을 `write`로 직접 쓰는 길을 막지 않아서 우회된다. lophn에서는 지침·grant·skill 파일을 경계 밖(agent가 쓸 수 없는 경로, 쓰기 mount 없음)에 두어야 (3)이 성립한다 |
| 보호 경로가 없다. `AGENTS.md`, `~/.ssh`, `.env`, workspace 밖 경로를 write tier로 그냥 허용한다 | (2), (3)에서 omp를 따르면 안 된다는 직접 사례다. A에서는 sandbox profile의 deny 경로, B에서는 `--deny-read`/`--allow-read` 범위, C에서는 mount 제외로 만들어야 한다 |
| 환경 변수는 거의 그대로 상속. Python `eval`만 allowlist와 key denylist로 거른다. secret obfuscation은 model이 보는 text만 가리고 기본 off | env는 process 시작 때 allowlist로 만드는 쪽이 맞다(omp의 Python 경로가 그 모양이다). obfuscation은 (2)를 지켜 주지 않는다. 모델 context 안의 secret 유출을 줄이는 별도 층이다 |
| web: `web_search`와 URL `read`가 둘 다 read tier라 묻지 않고, 도메인이나 private 대역 제한이 없다 | 유출 경로가 열려 있다. lophn이 web을 주면 host allowlist와 private 대역 차단을 같이 정해야 한다. B의 Deno `--allow-net=<host>`는 이를 flag 하나로 표현한다. A에서는 network를 통째로 끄거나 proxy로 걸러야 한다 |
| 사람이 없는 실행: RPC `--no-ui`는 fail-closed, subagent는 yolo로 강제하되 `prompt`로 풀리는 호출은 거절하고 사용자 `deny`는 유지 | (5)의 모양은 맞다. prompt가 필요한 호출은 headless에서 기다리지 않고 거절한다. 다만 omp는 기본이 yolo라 이 안전장치가 기본으로는 일어나지 않는다. lophn은 기본이 ask 쪽이어야 이 거절이 의미가 있다 |
| 되돌리기: `checkpoint`/`rewind`는 conversation만, 파일 undo, shadow git 없음. subagent만 격리된 복사본(overlay/APFS clone/worktree)에서 돌려 patch로 받을 수 있다(기본 off) | (4)를 omp에서 가져올 것은 없다. 파일 변경 journal(변경 전 내용)은 lophn이 직접 만들어야 한다. shell이 바꾼 파일까지 되돌리려면 shell 쪽을 격리된 복사본이나 overlay에서 돌리고 diff를 적용하는 omp의 isolation 방식이 참고가 된다. A(sandbox shell)와 C(container)는 mount를 overlay로 하면 자연스럽고, B(code run)는 변경 경로를 lophn tool로 한정하면 journal이 쉽다 |
| git guard는 `reset --hard`, `stash` 같은 파괴만 거절(기본 off) | 파일 undo가 없는 omp가 만든 부분 대체 수단이다. lophn이 file journal을 가지면 필요 없다 |

## 확인 못한 것

- pi 원본과의 정확한 diff: pi repo를 이번에 읽지 않았다. omp 쪽 사실만 확인했다.
- history: shallow clone이라 approval 체계가 언제 생겼는지 모른다.
- `eval`(JS)의 env 필터, URL fetch의 private 대역 차단, background job 중 정책 변경 동작은 코드에서 못 찾았다.
- plan mode에서 main session의 `bash`가 어떻게 되는지는 읽은 범위 안에서 못 봤다(edit/write 쪽 guard만 확인).
- omp.sh의 웹 문서는 열지 않았고 repo의 `docs/`와 source만 읽었다.
