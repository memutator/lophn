# use-cli

사람의 터미널에서 다른 기계에 명령을 보낸다: `lophn <명령> --on <기계>`와 `lophn <앱 slug> <command> --on <기계>`. CLI는 이 기계의 core에 붙은 채 사람의 CLI token으로 `machines/call`을 shell capability 없이 부르고, 그래서 core가 요청한 쪽을 `terminal`로 정해 넘긴다(capability가 있는 호출만 `screen`이다).

- 단위: use (wave 2)
- 선행: use-contract. 계약의 이름으로 짓는다.
- 소유(이 task만 고친다):
  - `packages/cli/main.ts`, `packages/cli/help.ts`, `packages/cli/commands/app-command.ts`
  - `packages/cli/remote-core.ts`(새 file), `packages/cli/main_test.ts`
  - `project-docs/flows/areas/cli.yaml`, `project-docs/flows/tests/libs-tooling.yaml`
- 읽을 것:
  - `project-docs/plan/remote-use/tasks/use-contract.md`의 "내놓는 것"과 표(`terminal` 줄)
  - 계획 README "정한 것"의 "기계는 인자 하나로 고른다", "사람의 터미널은 다른 기계에 명령을 보낸다"
  - architecture: `approval.md`("폰(기기) 자격"의 기기 목록, `use-contract` 초안), `app-call.md`("경계와 계약"의 agent 명령과 사람의 binary 호출)
  - 조사 `reports/multi-device/survey-n3-remote-use.md` 1.2(1·11·12), 1.7. 이슈 `project-docs/issues/cli-help-lists-forbidden-commands.yaml`
  - boundary·module: `coding-agent-cli-interface`, `core-api`; module `coding-agent-cli`
- 계약:
  - 쓰는 것: `splitOn`(`packages/cli/parser.ts`), `machinesCall`(입력 `machine`은 이름·`mch_`·`dev_`), `appRemoteCall`, `appList`, `appTools`, `CommandCore`(`packages/cli/commands/types.ts`)
  - 내놓는 것: 없음

## 할 일

1. `main.ts`: 맨 앞에서 `splitOn(argv)`. `--on`이 없으면 지금과 같다. 있으면:
   - `version`, `LOCAL_COMMANDS`, `CORE_COMMANDS`(binary 명령)와 함께 쓰면 `invalid_input`(`--on runs core commands only`).
   - 이 기계의 core에 붙어(`connect()`) 그 `CommandCore`를 `remoteCore(core, on)`으로 감싸 명령에 준다. 명령의 `workspace`는 넘기지 않는다(`LOPHN_WORKSPACE`는 이 기계의 workspace다).
   - 표에 없는 첫 낱말이면 `loadAppCommands(remoteCore, word)`로 그 기계의 앱 command를 읽는다.
   - `lophn <slug> --help --on <기계>`가 그 기계의 command를 보인다.
2. `remote-core.ts`의 `remoteCore(core, on): CommandCore`: `read`와 `command`를 `machines/call {machine: on, resource, method, body}`로 바꾼다. `shell_capability` 칸은 싣지 않는다(CLI에는 capability가 없고, 그 칸이 없는 것이 `terminal`이다). body는 받는 기계의 HTTP body와 같은 꼴이다(read·memory는 입력 그대로, command는 `{input, idempotency_key, compare?}` envelope). 꼴은 `packages/core/remote/call.ts`가 dispatch에 넘기는 Request와 `packages/cli/connection/`의 HTTP client를 보고 맞춘다. 그 기계의 오류(`forbidden`: 기기 목록 밖이나 사람 route, 후보가 여럿인 `invalid_input`의 `details.candidates`)를 그대로 돌려준다.
3. `app-command.ts`: `--on`이면 앱 command의 `routes`와 `run`이 `runs/start`·`runs/wait` 대신 `apps/remote_call {app, command, input}` 하나다(받는 기계의 `createRemoteCall`이 `by`를 채운다. 이 꼴은 route 입력 schema로 미리 검사하지 않는다). 결과(`ToolCallOutput`)는 성공이면 result, 막힘·실패·결과 모름은 지금 run 결과처럼 실패 exit로 보인다.
4. `help.ts`의 `COMMON_FLAGS`에 `--on <machine>`(다른 컴퓨터에서 돈다. 이름, 같은 이름이 여럿이면 기기 id). `lophn help`의 묶음 목록은 이 기계의 표 그대로다.
5. flows(`flows` skill): `cli.yaml`의 `cli-argv`에 `--on` 갈래(보냄, binary 명령과 함께 써서 거절, 이름을 못 풂, 후보가 여럿, 그 기계가 거절, 그 기계에 닿지 않음)와 앱 command를 다른 기계에서 부르는 outcome. test file을 더하거나 지우면 `libs-tooling.yaml`.

정한 것:
- 받는 기계가 거절할 명령을 CLI가 미리 거르지 않는다: 기기 목록은 받는 기계의 것이고 판이 다를 수 있다. 오류 문구가 그 까닭을 말한다.
- 다른 기계의 앱 command는 run 기록을 남기지 않는다: 그 기계의 호출 기록이 `remote` caller로 남는다. run은 이 기계의 앱을 이 기계에서 부를 때의 기록이다.
- 이 기계를 고른 `--on`은 core가 `invalid_input`으로 돌려주는 그대로 둔다(`--on`을 빼라).

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음. 요청한 쪽을 `terminal`로 정하는 것은 core(`use-send`), 받는 기계의 거절은 `use-receive`가 본다. 바꾼 parse가 틀린 기계로 보내는 일은 `splitOn`(`use-contract`)과 core의 이름 풀기가 막는다.
- subprocess로 binary를 띄우는 test, 실제 두 core를 띄우는 test와 E2E는 만들지 않는다(필요하면 사람에게 묻도록 보고에 적는다).
- 남지 않음: 없음(지우는 것이 없다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

## 시작 전에 다시 볼 것

- `fix-setup`의 `machinesCall` 입력 `shell_capability`와 `createMachineRoutes`, `use-send`가 그것을 "칸 없음 = `terminal`"로 바꾼 모양(CLI token이 `machines/call`의 scope에 있는지). `fix-roster`가 `cliMain`에 넣은 거절: `LOPHN_SESSION_ID`가 `term:`으로 시작하면 `remote.invite|join|remove`를 core에 붙기 전에 `forbidden`으로 끝낸다. `--on`을 뗀 뒤에도 그 거절이 먼저 서게 둔다(그 명령의 route `roster/*`는 기기 목록 밖이라 받는 기계도 거절한다), `cli-argv` flow의 그때 모양, `packages/cli/connection/`의 HTTP body 꼴.
