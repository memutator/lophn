# coding-cli

CLI에서 coding session token이 있어야 도는 명령(`message send`, `app show|status|declaration|invocations|logs`, `app preview start|stop`, `package list|show`)과 coding token 인증 길을 지운다. `hook`, `harness detect|refresh|install`(터미널 agent 층)과 user 명령(`run`, `tool call`, `workflow`)은 남긴다.

- 단위: coding (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/coding-agent/cli/commands/{app,message,package}.ts` (지운다)
  - `packages/coding-agent/cli/commands/types.ts`
  - `packages/coding-agent/cli/{registry,help,main,main_test,parser}.ts`
  - `packages/coding-agent/connection`
  - `packages/protocol/coding-agent/cli-commands.ts`
- 추가 소유(뼈대 검토, planner): 살 단계가 "소유 줄 밖"으로 적은 file을 소유로 옮긴다. 그 step의 "넘길 줄"/"lead가 소유에 더한다" 표시는 이제 이 task의 일이다.
  - `packages/protocol/coding-agent/registry.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/coding-agent.md`의 "지키는 것" 가운데 CLI 줄(명령 목록, `auth` 셋, user token file, `not_found` 글 바꾸기)과 "왜 이 모양인가"의 "통로는 CLI와 앱 tool용 MCP 하나" 줄. 이 task가 지우는 것이 여기 있다.
  - architecture: `project-docs/architecture/terminal-agent.md`의 "`lophn hook`은 core가 아니라 터미널을 가진 shell main에 보낸다" 줄. 남기는 것이다.
  - architecture: `project-docs/architecture/run.md`, `project-docs/architecture/workflow.md`의 CLI 줄. 남는 user 명령이다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `coding-agent-cli`, `coding-agent-cli-interface`. `project-docs/module-catalog.yaml`의 `packages/coding-agent`(boundary `coding-agent`).
  - 계획: `project-docs/plan/remove-role/README.md`의 "주소와 넘기기" 마지막 줄(`lophn run`은 wave 2·3이 바꾼다)과 "뼈대 검토"의 "coding 갈래 지우기는 lophn이 띄운 coding session에만 쓰이는 것만이다" 줄. `project-docs/plan/remove-role/tasks/coding-core.md`(이 task 뒤에 protocol file과 core coding token을 지운다).
  - 코드: `packages/protocol/coding-agent/cli-commands.ts`, `packages/protocol/coding-agent/registry.ts`, `packages/coding-agent/cli/{main,registry,help,parser,main_test}.ts`, `packages/coding-agent/cli/commands/{types,app,message,package,hook,harness,run,workflow}.ts`, `packages/coding-agent/connection/{call,mod}.ts`, `packages/coding-agent/connection/client/core.ts`. 그리고 `packages/core/server/identity/coding-token.ts`(고치지 않는다. 아래 "정한 것"의 이유다).
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: CLI 명령의 `auth`는 `user`와 `local` 둘이다(`coding_token` 없음). CLI는 `packages/protocol/coding-agent/{message,token}.ts`를 import하지 않는다. 그래서 `coding-core`가 그것들을 지울 수 있다. `run` 명령의 `--agent` 꼴은 바꾸지 않는다(wave 2 `runs-core`, wave 3 `cli-run`).

## 할 일

선: coding token(`LOPHN_CODING_TOKEN`)으로 core를 부르던 명령과 그 인증 길을 지운다. 그 token은 lophn이 띄운 coding session만 받았고 지금은 여는 길이 없다(`coding-agent.md`). 남는 명령은 `hook`, `harness detect|refresh|install`(`local`)과 `agent run`, `tool call`, `run wait|show|cancel`, `workflow start|report|stop|show`(`user`)다.

1. 명령 file을 지운다.
   - `packages/coding-agent/cli/commands/{app,message,package}.ts`를 지운다.
   - `packages/coding-agent/cli/registry.ts`에서 `APP_COMMANDS`, `MESSAGE_COMMANDS`, `PACKAGE_COMMANDS`의 import와 `COMMANDS`의 spread를 뺀다.
   - 남는 가장 긴 명령 이름은 두 단어다. `matchCommand`의 `Math.min(3, …)`을 2로, 주석의 "`app preview start`까지 세 단어"를 고친다.
2. `packages/protocol/coding-agent/cli-commands.ts`를 고친다.
   - `CODING_CLI_COMMANDS`에서 token 명령 열 줄을 지운다: `message send`, `app show`, `app preview start`, `app preview stop`, `app status`, `app declaration`, `app invocations`, `app logs`, `package list`, `package show`. `token()` helper도 지운다.
   - `CODING_ROUTES`를 지운다. 그것이 모으던 import(`HARNESS_ROUTES`, `codingMessageSend`·`MESSAGE_ROUTES`, `TERMINAL_ROUTES`)를 지운다. `coding-core`가 `message.ts`, `harness-report.ts`, `terminal-requests.ts`를 지우려면 이 file이 셋을 import하지 않아야 한다(계약은 `message`·`token`만 적었지만 셋 다 지워진다).
   - 앱 route import(`appGet`, `appTools`, `appInvocations`, `packageVersionNameSchema`, `packagesList`, `packagesVersions`, `previewsStart`, `previewsStop`, `appLogs`, `appRuntime`)를 지운다. `toolNameSchema`(`tool call`), `idSchema`, `jsonValueSchema`, `harnessDetectionSchema`, `harnessIdSchema`, `HOOK_EVENT_MAX_CHARS`는 남는다.
   - `packages/protocol/coding-agent/registry.ts`는 `CODING_ROUTES`를 펼치던 등록 file이다(이 task 소유 밖). import를 빼고 `export const ROUTES = [] as const;`로 둔다. orchestrate review의 "지운 것을 가리키던 등록 줄만 뺀 것"이다. 보고의 "등록할 것"에 적는다. `packages/protocol/mod.ts`의 `...codingAgentRoutes`는 그대로 돈다.
   - 머리 주석을 고친다: 인증은 `user`와 `local` 둘이다. "`app`은 route가 정한 대로다…" 줄은 token 명령의 것이라 지운다.
   - `CodingCliCommand` type의 `auth`의 `"coding_token"`과 `route?` 칸은 남긴다(아래 "정한 것").
3. `packages/coding-agent/cli/commands/types.ts`를 고친다.
   - `CODING_TOKEN_ENV`·`callRoute` import, `noToken`, `routeRun`을 지운다.
   - `entryOf`의 `options.run`을 필수로 한다. 남는 `entryOf` 호출(`hook.ts`, `harness.ts`, `run.ts`, `workflow.ts`)은 모두 `run`을 넘긴다. 이 file들은 고치지 않는다.
   - `READ_WORDS`는 남는 읽기 명령의 끝 낱말만 둔다: `show`(`run show`, `workflow show`), `wait`(`run wait`), `detect`(`harness detect`).
   - `RunContext.client` 주석: "user 명령이 아니거나 user token이 없으면 undefined다".
4. `packages/coding-agent/cli/main.ts`를 고친다.
   - `CODING_TOKEN_ENV` import와 `token` 변수를 지운다. user token file(`<data root>/run/user-token`)은 `user` 명령일 때만 읽고, 그 token만 자격이다.
   - `credential`은 `entry.auth === "user" ? userToken : undefined`다. `discoverDaemonAddress`의 `dataRoot`는 `userDataRoot`다. `createCoreClient`에 `appScoped`를 넘기지 않는다. `createOutput`의 `secrets`는 user token 하나다.
   - user token file이 없으면 `unavailable`(exit 5)로 끝나는 것은 그대로다(`coding-agent.md`).
   - 머리 주석과 "`user` 명령은 coding token이 먼저다" 주석을 고친다.
5. `packages/coding-agent/cli/help.ts`: `CODING_TOKEN_ENV` import와 `coding_token` 가지를 지운다. `user` 명령의 인증 줄은 "lophn이 켜져 있으면 data root의 user token file"이다. `local`은 그대로다.
6. `packages/coding-agent/connection`을 고친다.
   - `client/core.ts`: `CoreClientOptions.appScoped`, `sameAsAbsent`, `UNREADABLE_MESSAGE`를 지운다. `not_found`는 core가 준 글 그대로 돌려준다(지금 user token일 때와 같다). 머리 주석과 `token` 칸 주석의 coding token을 뺀다.
   - `call.ts`: 주석 "호출자가 `CODING_CLI_COMMANDS`의 route만 넘긴다"를 지금 호출자에 맞춘다. 부르는 쪽은 `run.ts`·`workflow.ts`이고 `protocol/runs`·`protocol/workflows`의 route를 넘긴다.
   - `mod.ts`, `client/daemon.ts`는 고칠 것이 없다(`LOPHN_DAEMON_URL`은 user 명령도 쓴다).
7. `packages/coding-agent/cli/main_test.ts`: token test 둘을 지운다. "app이 필수인 token 명령은 app 없이 부르면 보내지 않고 app 칸을 짚는다"와 "app preview start는 route 입력의 input 칸을 지우지 않고 그대로 보낸다"다. hook test와 user token 누출 test(`user token으로 부른 run show는 token을 출력에 남기지 않는다`)는 그대로 둔다.
8. `packages/coding-agent/cli/parser.ts`: 머리 주석의 위치 인자 목록에 지운 명령이 없다. 고칠 것이 없으면 그대로 둔다.
9. 이름 grep. 지운 이름(`coding_token`, `CODING_TOKEN_ENV`, `appScoped`, `noToken`, `routeRun`, `CODING_ROUTES`, `message send`, `app preview`, `package show`)을 `packages tools tests`에서 찾아 소유 안의 주석과 오류 글을 고친다. 소유 밖에 남는 것은 고치지 않고 보고에 적는다. 알려진 것은 아래 "소유 밖에 남는 것"이다.

### 정한 것

- **`CodingCliCommand`의 `auth` type의 `"coding_token"`과 `route?` 칸은 이 task가 지우지 않는다.**
  - `packages/core/server/identity/coding-token.ts`와 그 test가 `command.auth === "coding_token" && command.route`를 읽는다. 둘을 빼면 이 task의 `npm run check`에서 core type check가 깨진다.
  - 그 file은 `coding-core`가 지운다(이 task 뒤). 명령 표의 값은 모두 `user`나 `local`이라 계약의 "명령의 `auth`는 둘이다"는 지킨다.
  - type을 좁히는 일은 보고의 "안 쓰게 된 export"에 적는다.
- **`registry.ts`의 `ROUTES`는 빈 배열로 둔다.** coding route 셋(`coding_agent_sessions/send_message`, `coding_agent_harnesses/*`, `coding_agent_terminals/*`)은 이 task 뒤 `coding-core`가 core와 함께 지운다. 그 사이 protocol 목록(`ALL_ROUTES`)에는 없고 core 등록에는 있다. 그래도 core 기동의 memory route 대조는 core 안의 두 목록끼리 해서 깨지지 않는다.
- **token 명령 test 둘은 지운다.** 지키던 것(앱 범위 token 명령의 `app` 칸, route 입력의 `input` 칸)이 명령과 같이 없어진다. user token이 출력에 남지 않는 test는 secret 경계라 남긴다.
- **`READ_WORDS`를 줄인다.** help가 읽기와 변경을 이 낱말로 가른다. 남는 명령에 없는 낱말(`list`, `status`, `declaration`, `invocations`, `logs`)을 두면 뒤에 같은 끝 낱말의 변경 명령이 읽기로 잘못 보인다.

### 소유 밖에 남는 것(고치지 않고 보고에 적는다)

- `packages/base/install/linux-install.ts`의 `cliLauncher` 주석 "token은 환경 변수 `LOPHN_CODING_TOKEN`으로 받는다". 이 file을 소유한 task가 없다.
- `packages/core/server/identity/coding-token.ts`(와 `_test`)의 `CODING_CLI_COMMANDS` 읽기. `coding-core`가 지운다.
- `packages/core/apps/agent-tools/runtime.ts` 주석의 "coding agent CLI(`app status`·`app logs`·`app invocations`)".
- `packages/core/lophn-agent/tools/shell/env_test.ts`의 `LOPHN_CODING_TOKEN`은 "lophn token이 shell 환경에 나가지 않는다"의 예시 값이다. 그대로 둔다.

## 끝남

- `npm run check`가 통과한다. protocol을 고쳐서 core·shell type check도 돈다.
- 위험 test: 없음. 남는 test(`packages/coding-agent/cli/main_test.ts`의 hook test와 user token 누출 test)가 그대로 통과한다.
- 남지 않음:
  - `grep -rn "CODING_TOKEN_ENV\|appScoped\|sameAsAbsent\|noToken\|routeRun\|APP_COMMANDS\|MESSAGE_COMMANDS\|PACKAGE_COMMANDS\|CODING_ROUTES\|MESSAGE_ROUTES\|HARNESS_ROUTES\|TERMINAL_ROUTES" packages/coding-agent packages/protocol/coding-agent/cli-commands.ts packages/protocol/coding-agent/registry.ts`가 0줄이다.
  - `grep -rn "coding_token" packages/coding-agent packages/protocol/coding-agent/cli-commands.ts`는 `cli-commands.ts`의 `CodingCliCommand` type 한 줄만 나온다(정한 것).
  - `grep -rn "\"message send\"\|\"app show\"\|\"app status\"\|\"app declaration\"\|\"app invocations\"\|\"app logs\"\|\"app preview\|\"package list\"\|\"package show\"" packages tools`가 0줄이다.
  - `test ! -e packages/coding-agent/cli/commands/app.ts && test ! -e packages/coding-agent/cli/commands/message.ts && test ! -e packages/coding-agent/cli/commands/package.ts`가 성공한다.
- `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron packages/coding-agent/cli/main.ts help`가 0으로 끝나고, 목록에 `message`·`app`·`package` 명령이 없고 `hook`·`harness`·`agent run`·`tool call`·`run`·`workflow`가 있다. core는 띄우지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
