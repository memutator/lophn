# coding-agent-cli

`packages/coding-agent`의 CLI를 새 명령 목록으로 줄이고, `mcp-server`와 core로 닿는 옛 길(앱 직접 통로, 문서 저장, credential helper)을 지운다. 인증은 환경 변수 `LOPHN_CODING_TOKEN` 하나다. `hook` 명령을 새로 만든다.

- 단위: coding-agent (wave 3)
- 선행: 없음. 계약 고정 뒤에 열린다.
- 소유(이 task만 고친다):
  - `packages/coding-agent/cli/`(`commands/harness.ts`와 `commands/harness-run.ts`는 `coding-agent-harness`가 뒤에 다시 고친다. 이 task는 두 file을 건드리되 engine 호출 export는 안 바꾼다)
  - `packages/coding-agent/connection/`
  - `packages/coding-agent/mcp-server/`
  - `packages/coding-agent/mod.ts`
- 읽을 것:
  - spec: S6 4장 hook 경로, 5장 6, 9·10장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/coding-agent.md`
  - inventory: `I1.6#1`, `I1.6#3`, `I1.6#4`, `I1.6#5`, `I1.6#9`, `I1.6#10`, `I1.6#12`, `I1.6#13`, `I1.6#14`, `I1.6#15`, `I1.6#16`, `I2.6#4`, `I2.6#9`, `I3.6#7`, `I3.6#11`, `I3.6#12`, `I3.6#21`(CLI 읽기)
  - 일부만 닿는 줄(나머지는 다른 단위): `I2.6#3`(`cli/launch.ts`·`launch-entry.ts`의 Deno 권한 계획을 core loopback과 읽기 위주로 줄인다. `packages/base/install`의 wrapper는 platform), `I2.6#7`(`cli/output.ts`가 내는 사람 말·앱 문자열·log 원문을 모두 data fence로 감싼다. `fenceBlock` 같은 작은 함수를 이 package 안에 둔다. core의 `fenceBlock`은 import할 수 없다)
  - 결정: `../README.md` 3장 #66·67, #69
  - 계약: `packages/protocol/coding-agent/cli-commands.ts`(`CODING_CLI_COMMANDS`), `token.ts`(`CODING_TOKEN_ENV`), `hook.ts`, `message.ts`, `source-diff.ts`, `ticket/`, `harness-report.ts`. 명령 목록과 입출력은 이 file들이 정본이다.
- 계약:
  - 쓰는 것: 위 계약 file들. 옛 `packages/protocol/coding-agent/{cli-*,mcp-*,connections,connection-auth,sessions}.ts`는 이 task가 안 쓰게 한다.
  - 내놓는 것: `lophn <명령>` 실행 file(`cli/main.ts`)이 `CODING_CLI_COMMANDS`의 명령만 받는다. 표 밖 명령은 실행 전에 거절한다.

## 할 일

1. **mcp-server 삭제**(`I1.6#1`, `I1.6#3`의 MCP 출력 꼴): `packages/coding-agent/mcp-server/` 전체를 지운다. 먼저 CLI가 빌려 쓰던 op → route 표(`cli/commands/app.ts`의 `APP_OP_ROUTES`, `problem.ts`의 `MCP_PROBLEM_ROUTES`)를 CLI 쪽 file로 옮긴다. 옮긴 뒤 `cli`가 `mcp-server`를 import하지 않는지 `grep -rn "mcp-server" packages/coding-agent`로 확인한다.
2. **명령 정리**: `cli/commands/`와 `cli/registry.ts`를 `CODING_CLI_COMMANDS`와 같은 목록으로 맞춘다.
   - 지운다: `mcp.ts`(`I1.6#4`), `doctor.ts`(`I1.6#5`), `daemon.ts`, `connection.ts`, `session.ts`(`I1.6#9`, `I1.6#10`), `skills.ts`, `approval.ts`, `question.ts`(`I1.6#12`), `document.ts`, `save.ts`, `series.ts`, `format.ts`, `index.ts`, `project.ts`(`I1.6#14`). `cli/commands/harness.ts`에서는 `harness list/inspect/plan/update/remove`를 지우고 `detect`·`refresh`·`install`만 남긴다(`I1.6#16`).
   - 고친다: `app.ts`(`I2.6#4`: show, test, preview start/stop, status, blueprint, invocations, logs만. `release prepare`는 별도 명령), `problem.ts`(list, show, more, diff, record-fix), `sdk.ts` → `package.ts`(list, show. `add`와 `deno.json` 쓰기를 뺀다), `ticket.ts`(list, show, claim, renew, report. `ticket claim`은 안내가 아니라 `ticketClaim` route를 실제로 부른다, S6 5장 6)
   - 새로 만든다: `hook.ts`(`lophn hook <harness> <event>`: stdin JSON을 읽어 `codingHook` route로 보낸다. 상한은 64KiB. **token이 없으면 아무것도 보내지 않고 0이 아닌 exit code로 끝낸다**, `I3.6#7`), `message.ts`(`lophn message send`, `I3.6#11`), `release.ts`(`release prepare`)
   - 읽기·변경 이름 규칙(`I2.6#9`): 이름 pattern만으로 읽기를 가릴 수 있어야 한다. 읽기 명령은 `list`·`show`·`status`·`blueprint`·`invocations`·`logs`·`more`·`diff`·`detect`이고, 나머지는 변경이다. `registry.ts`의 `CommandEntry`에 `mutates: boolean` 칸을 더하고 help가 이 칸으로 가른다.
3. **연결 층 정리**(`connection/`): 
   - 지운다: `app-direct.ts`·`app-direct-unix.ts`(`I1.6#15`), `policy.ts`(`I1.6#13`: `FORBIDDEN_ACTIONS`·`FORBIDDEN_ROUTES`), `decision-view.ts`·`sdk-source.ts`·`document-save.ts`·`upload-bytes.ts`·`submission.ts`·`save-result.ts`(문서·확인 창 쪽, `I1.6#12`, `I1.6#14`), `credential/`(helper와 provider. `I2.6#2`: 연결 참조와 credential helper가 없어진다), `unreadable.ts`가 쓰이지 않으면 그것도
   - 고친다: `client/core.ts`가 token을 환경 변수 `CODING_TOKEN_ENV`에서 직접 읽는다(`connectionFromRef` 삭제). `client/daemon.ts`의 core 주소 찾기는 유지한다. `ticket-ops.ts`, `app-ops.ts`, `problem-ops.ts`는 새 route를 부르게 바꾸고, 앱은 token이 정하므로 `target-app.ts`와 `--app` 칸을 지운다. `sdk-ops.ts`는 `package list/show` 읽기만 남긴다
   - 새로 만든다: source diff 읽기(`problem diff`가 `codingSourceDiff`를 부른다, `I3.6#12`), `ticket show` 출력에 근거 annotation(메모, component, source 위치, release, screenshot 파일 경로)을 그대로 보인다(`I3.6#21`)
4. **인증과 launcher**(`I2.6#2`, `I2.6#3` 일부): `cli/main.ts`, `dispatch.ts`, `launch.ts`, `launch-entry.ts`에서 연결 참조 해석과 helper 실행을 걷어 낸다. Deno 권한은 core loopback network와 읽기 위주로 줄인다. `harness install`만 쓰기 권한이 필요하면 그 명령만 따로 권한을 올리는 방식을 쓰고, 어디에 쓰는지 보고에 적는다.
5. **출력**(`I2.6#7` 일부): `cli/output.ts`에서 사람 말·앱 문자열·log 원문을 data fence로 감싼다.
6. **help**: `cli/help.ts`(1,059줄)는 `CODING_CLI_COMMANDS` 표에서 만든 짧은 help로 다시 쓴다. 옛 help 본문은 옮기지 않는다.
7. `packages/coding-agent/mod.ts`가 지운 module을 내보내지 않게 고친다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "hook CLI는 token 없이 거절된다". `cli/commands/hook.ts`의 실행 함수를 환경 변수 없이 부르면 core 호출이 한 번도 일어나지 않고 실패 code를 낸다(fake client로 호출 횟수가 아니라 결과를 본다: 반환 code와 stdout·stderr). subprocess는 띄우지 않는다.
- 남지 않음: `grep -rn "mcp-server\|LOPHN_CONNECTION\|app-direct\|credential/helper\|lophn_ticket\|toolsets" packages/coding-agent/cli packages/coding-agent/connection packages/coding-agent/mod.ts`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 없음(`deno.json` 의존이 바뀌면 적는다). `packages/base/install/linux-install.ts`(185~195행)와 `tools/package-linux.ts`가 `packages/coding-agent/mcp-server/main.ts`를 가리킨다. 이 task가 지우면 packaging이 깨진다. 소유 밖이라 고치지 않고 platform과 check 단위에 넘긴다고 적는다.
- 안 쓰게 된 export: `packages/protocol/coding-agent/{mcp-*,cli-*,connections,connection-auth,sessions,output}.ts` 가운데 이 package가 더는 import하지 않는 것의 목록
- 정한 것:
  - `harness install`의 쓰기 권한 방식
  - `mutates` 칸 모양
  - 지운 `connection/` file 가운데 core나 shell이 쓰던 것이 있었는지
- 계약 바꾸기 요청: 계약의 입출력이 CLI 구현과 맞지 않으면 여기에 적는다.
