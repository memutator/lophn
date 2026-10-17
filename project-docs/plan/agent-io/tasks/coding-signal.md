# coding-signal

OpenCode의 turn 끝 신호를 하나로 한다(`HOOK_EVENT_TABLE.opencode`에서 `session.idle`을 뺀다). 개발 실행(`LOPHN_CLI`)에서는 전역 hook command가 PATH의 `lophn` 대신 그 경로를 쓰게 한다.

- 단위: coding-signal (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/coding-agent/hook-signal.ts`
  - `packages/protocol/coding-agent/hook-signal_test.ts`(새로 만든다)
  - `packages/protocol/coding-agent/cli-commands.ts`
  - `packages/coding-agent/harnesses/install.ts`
  - `packages/coding-agent/harnesses/install_test.ts`
  - `packages/coding-agent/cli/commands/harness.ts`
  - `packages/coding-agent/cli/commands/harness-run.ts`
  - `packages/shell/main/terminal/coding/requests.ts`
  - `packages/shell/main/desktop/wiring/coding.ts`
- 읽을 것:
  - 이슈: `project-docs/issues/coding-agent.md`의 "OpenCode가 turn 끝을 event 둘로 내서 TurnEnded가 두 번 간다"와 "전역 hook command가 PATH의 `lophn`을 부른다"
  - architecture: `project-docs/architecture/coding-agent.md`("전역 설정은 사람의 다른 항목을 보존한다", "전역 hook은 lophn과 상관없는 harness 실행에서도 불린다", "skill과 hook은 harness의 사용자 전역 설정에 한 번 놓고…", "hook으로 상태를 안다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `coding-agent-cli`, `coding-agent-cli-interface`, `project-docs/module-catalog.yaml`의 `packages/coding-agent`
  - 본보기: `packages/coding-agent/harnesses/install_test.ts`(메모리 port로 전역 설정을 시험한다. 실제 `~/.claude`를 건드리지 않는다)
  - test: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `HOOK_EVENT_TABLE`, `hookSignalOf`(`protocol/coding-agent/hook-signal.ts`), `harnessInstallInputSchema`(`protocol/coding-agent/cli-commands.ts`), `installGlobal`(`coding-agent/harnesses/install.ts`)
  - 내놓는 것: `harnessInstallInputSchema`에 `command`(선택, 절대 경로 문자열)가 생긴다. `installGlobal`의 입력에 `command?: string`이 생긴다. 없으면 지금처럼 `lophn`이다. `hookSignalOf("opencode", "session.idle", …)`는 null이다.

## 지킬 것(계획 README "지켜야 할 것")

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.
- protocol을 바꾸면 쓰는 쪽(shell, coding agent CLI)을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- secret 값은 보호 메모리와 전송 직전 attach 밖으로 나가지 않는다(log, event, ledger, model 입력 금지). coding token은 hook command, plugin 파일, 전역 설정 어디에도 쓰지 않는다(지금도 `CODING_TOKEN_ENV`의 존재만 plugin이 본다. 바꾸지 않는다).

## 할 일

근거: 이슈 두 절. 코드를 열어 확인한 사실: `HOOK_EVENT_TABLE.opencode`가 `session.status`와 `session.idle`을 둘 다 `TurnEnded`로 바꾸고, `opencodePlugin()`은 이 표의 key 전체(`Object.keys`)를 `EVENTS`로 듣는다. 전역 hook command는 `install.ts`의 `installJsonHook`이 `lophn hook <harness> <event>`로 쓰고(`ownedEntry`도 `lophn hook <harness> `로 시작하는 것만 우리 것으로 본다), pi extension과 OpenCode plugin은 `spawn("lophn", …)`로 부른다. 개발 실행에서 `lophn`이 PATH에 없다는 것은 `shell/main/desktop/wiring/coding.ts`의 `lophnCommand()`가 이미 안다(packaged는 `/usr/bin/lophn`, 개발은 `process.env.LOPHN_CLI`가 `/`로 시작할 때만).

1. `hook-signal.ts`: `HOOK_EVENT_TABLE.opencode`에서 `"session.idle"`을 지운다. `opencodeSignal`의 `case "session.idle":`와 표 위 주석에서 `session.idle`을 가리킨 곳도 지운다(죽은 코드). 근거: 이슈. 이미 놓인 옛 plugin 파일이 `session.idle`을 계속 넘겨도 표에 없는 이름이라 `hookSignalOf`가 null이고 core는 신호로 받지 않는다. 그래서 plugin을 다시 놓을 필요가 없다.
2. `HOOK_EVENT_TABLE.opencode`가 줄면 `opencodePlugin()`의 `EVENTS`도 같이 준다(표에서 만든다). plugin 코드에서 따로 고칠 것은 없는지 확인만 한다.
3. 개발 hook command(이슈의 "고치려면"): 설치하는 쪽이 command를 정한다.
   - `cli-commands.ts`: `harnessInstallInputSchema`에 `command: z.string().regex(/^\/[\w./-]+$/).optional()`을 더한다. 공백·따옴표·`..` 없는 절대 경로만 받는다(hook command는 shell 문자열이 되므로 quote 조합을 만들지 않는다. 맞지 않으면 `invalid_input`).
   - `install.ts`: `installGlobal`의 입력에 `command?: string`을 받고 기본은 `"lophn"`이다. `installJsonHook`의 항목 command는 `${command} hook ${harness} ${event}`, `piExtension()`/`opencodePlugin()`의 `spawn(…)` 첫 인자는 `JSON.stringify(command)`다. `ownedEntry`는 `^(lophn|/\S+) hook <harness> `로 시작하는 command를 우리 것으로 본다(개발 경로를 놓은 뒤 packaged로 돌아와도 항목이 둘이 되지 않는다. 사람이 쓴 다른 항목은 이전처럼 보존한다).
   - dry_run: `command`가 주어졌을 때만(개발) 우리 항목의 command가 기대한 것과 다르면 `missing`으로 본다(`installJsonHook`과 `installPluginFile` 둘 다). 안 주어졌을 때는 지금처럼 우리 항목이 있으면 내용이 달라도 `unchanged`다(lophn이 업데이트돼도 다시 묻지 않는다는 architecture의 규칙을 packaged에서 지킨다). 근거: 개발 머신에 packaged 때 놓은 `lophn hook …`이 이미 있으면 dry_run이 `unchanged`라 개발 경로가 영영 안 놓인다.
   - `harness.ts`와 `harness-run.ts`: `harness install`의 `command`를 `runHarnessInstall` → `installGlobal`로 넘긴다.
   - `shell/main/terminal/coding/requests.ts`: deps에 `hookCommand?: string`을 받고 `runInstall`의 input에 있을 때만 `command`를 싣는다(dry_run이든 아니든 같은 값).
   - `shell/main/desktop/wiring/coding.ts`: `hookCommand: app.isPackaged ? undefined : lophnCli ?? undefined`를 `createCodingTerminalRequests`에 넘긴다. 근거: 개발 실행은 `LOPHN_CLI`로 CLI를 부르므로 같은 경로를 hook도 쓴다. packaged는 `/usr/bin/lophn`이 PATH에 있어 지금대로 `lophn`이다.
4. test(몇 개 안 된다):
   - `hook-signal_test.ts`(새 file): OpenCode의 turn 끝 신호는 `session.status`(idle) 하나다. 표로 `session.idle` → null, `session.status` idle → `TurnEnded`(completed), busy → `TurnStarted`. 순수 함수만 본다.
   - `install_test.ts`에 `Deno.test` 하나 더: 개발 `command`로 놓으면 항목의 command가 그 경로이고, 사람이 쓴 다른 hook은 남고, 이어서 `command` 없이 다시 놓아도 우리 항목이 event마다 하나이며, `command`를 준 dry_run이 옛 `lophn hook` 항목에는 `missing`을 낸다. 기존 메모리 `InstallPorts`만 쓴다. 실제 `~/.claude`·`~/.codex`·`~/.config/opencode`·`~/.pi`를 읽거나 쓰지 않는다(`Deno.env`의 HOME도 읽지 않는다).
   - `runHarnessInstall`(실제 파일 시스템에 쓰는 CLI 쪽)을 부르는 test를 새로 쓰지 않는다. 새 subprocess·서버 test를 쓰지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "개발 command로 전역 hook을 놓아도 사람이 쓴 다른 hook이 남고 우리 항목은 event마다 하나다"(사용자 전역 설정을 잃거나 중복시키는 규칙. 같은 설정 file을 두 번 놓는 경로). 그리고 "OpenCode의 `session.idle`은 신호가 아니다"(TurnEnded가 두 번 가서 메시지 순서가 겹친 버그).
- 남지 않음: `grep -rn "session.idle" packages`가 0줄이다. `grep -rn 'spawn("lophn"' packages`가 0줄이다. `grep -rn 'startsWith(`lophn hook' packages`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`protocol/coding-agent/mod.ts`는 이미 `harnessInstallInputSchema`를 내보낸다. 확인만 한다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것. `command`를 CLI의 input 칸으로 넘기기로 한 점(대안인 CLI가 `LOPHN_CLI` 환경 변수를 읽는 길은 CLI의 `--allow-env`(`CLI_ENV`, `base/install/linux-install.ts`)에 `LOPHN_CLI`가 없어 읽히지 않는다), 공백 있는 경로는 거절하는 점을 적는다.
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: `harnessInstallInputSchema`는 이 task가 소유한 file이라 요청이 아니다. 다른 file 변경이 필요하면 적는다.
- **무겁게 짠 것**: 없음이면 "없음"
- **알려진 미완 동작**: 개발 경로를 전역 설정에 놓은 뒤 packaged로 돌아가면 `command`가 없는 dry_run이 `unchanged`라 개발 경로가 그대로 남는다(이슈 "다만 전역 설정에 개발 경로가 남는다"). 사람이 `~/.claude/settings.json` 등의 항목을 지우거나 packaged에서 다시 놓아야 한다. 실제 OpenCode에 맡겨 보지는 못했다(`.ts` plugin이 로드되는지, `node:child_process`의 spawn이 되는지는 여전히 모른다). 더 있으면 적는다.
