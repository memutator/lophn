# wf-cli

사람과 program이 쓰는 CLI 명령 `lophn workflow start|report|stop|show`를 만든다. 자격은 run과 같은 user token이다.

- 단위: cli (wave 2)
- 선행: wf-contract
- 소유(이 task만 고친다):
  - `packages/coding-agent/cli/commands/workflow.ts`(새 file)
  - `packages/coding-agent/cli/registry.ts`
  - `packages/coding-agent/cli/parser.ts`
  - `packages/coding-agent/cli/main.ts`
  - `packages/coding-agent/cli/help.ts`
  - `packages/protocol/coding-agent/cli-commands.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/run.md`("CLI와 자격": 명령 표, 종료 코드, user token, 표에 route를 두지 않는 이유), `project-docs/architecture/coding-agent.md`("같은 CLI를 사람도 쓴다")
  - 제품 결정: `project-docs/products/roadmap/workflow.md`의 "instance와 report"(시작과 report), `project-docs/plan/workflow/README.md`의 "시작과 멈춤", "report, 고치기, 넘기기"
  - 본보기 코드: `packages/coding-agent/cli/commands/run.ts`(route를 직접 부르는 `call`, `entryOf`, `positional`, `ExitWith`), `packages/protocol/coding-agent/cli-commands.ts`의 `user(...)`과 `agent run`·`run show` 항목, `packages/coding-agent/cli/main.ts`(위치 인자와 flag를 `candidate`로 모으는 곳, `entry.input.safeParse`), `packages/coding-agent/cli/output.ts`(`--json`이 아니면 `renderLines`로 줄을 푼다, `CLI_EXITS`), `packages/coding-agent/cli/main_test.ts`(`cliMain`에 fake `fetch`·`readText`를 끼우는 법)
- 계약:
  - 쓰는 것: `wf-contract`의 `StartWorkflow`·`ReportWorkflow`·`StopWorkflow`·`ReadWorkflowInstance`. 본보기는 `packages/coding-agent/cli/commands/run.ts`와 `cli-commands.ts`의 `user(...)` 명령(`agent run`, `run wait|show|cancel`)
  - 내놓는 것(명령은 `CODING_CLI_COMMANDS` 표에 `auth: "user"`로 더하고 route는 표에 두지 않는다. runs와 같은 import 순환 이유다):

| 명령 | 위치 인자 | flag | 부르는 route | stdout |
|---|---|---|---|---|
| `workflow start` | `<workflow>`(`<project 이름>/<name>`), `<text>` | `--step <step>` | `StartWorkflow` | instance id(`--json`이면 `{instance, handed}`) |
| `workflow report` | `<instance>`, `<step>`, `<text>` | `--next <step\|end>`, `--session new\|same` | `ReportWorkflow` | `line` 번호와 `handed` 요약(`--json`이면 출력 그대로) |
| `workflow stop` | `<instance>` | 없음 | `StopWorkflow`(`running`·`ended`에서 성공) | instance(JSON) |
| `workflow show` | `<instance>` | 없음 | `ReadWorkflowInstance`(`cursor`를 따라 줄을 끝까지) | `{instance, last_reports, lines}` JSON |

    - `--next`와 `--step`은 parser에 새로 더하는 flag다(`--session`은 이미 있다. `workflow report`에서는 `new|same`만 받는다). 다른 명령이 이 flag를 주면 지금처럼 "모르는 칸"으로 거절된다.
    - 종료 코드는 `output.ts`의 `CLI_EXITS`를 그대로 쓴다. report가 `not_handed`여도 명령은 성공(0)이고 `handed` 요약에 이유가 나온다.
    - coding token 안에서는 route가 `forbidden`이다(coding session은 workflow를 부르지 못한다).

## 할 일

1. **명령 표.** `packages/protocol/coding-agent/cli-commands.ts`의 `CODING_CLI_COMMANDS`에 `user(...)`로 넷을 더한다(`run cancel` 뒤). route를 표에 두지 않는다(이유는 `user` 위 주석). 입력 schema는 CLI 칸이다:
   - `workflow start`: `z.strictObject({ workflow: z.string().min(1), text: z.string().min(1), step: z.string().min(1).optional() })`
   - `workflow report`: `z.strictObject({ instance: idSchema("wfi"), step: z.string().min(1), text: z.string().min(1), next: z.string().min(1).optional(), session: z.enum(["new", "same"]).optional() })`
   - `workflow stop`, `workflow show`: `z.strictObject({ instance: idSchema("wfi") })`
   각 칸에 `.describe(...)`로 help 한 줄을 붙인다(예: `workflow`는 `<project 이름>/<name>`, `next`는 `다음 step 이름 또는 end`, `session`은 `new | same`). 형식 검사는 core의 route schema가 하므로 CLI 표는 `idSchema("wfi")`와 `new|same`만 좁힌다(문자열 검사까지 베끼면 `protocol/workflows`와 `coding-agent` 사이 import가 생겨 순환 위험이 있고, 이중 정본이 된다).
2. **명령.** `packages/coding-agent/cli/commands/workflow.ts`(새 file)에 `WORKFLOW_COMMANDS: readonly CommandEntry[]`를 `entryOf`로 만든다(`run.ts`와 같은 꼴, `call` helper는 `run.ts`의 것이 export가 아니라 같은 여섯 줄을 둔다). route 값은 `packages/protocol/workflows/mod.ts`에서 import한다(변수 이름은 `wf-contract`의 `routes.ts`를 본다). `positional`: start `["workflow", "text"]`, report `["instance", "step", "text"]`, stop·show `["instance"]`.
   - **start:** 입력 `{ workflow, text, step? }`를 `StartWorkflow`에 그대로 보낸다. stdout은 `instance.id`, `--json`이면 `{ instance, handed }` 전체다. `handed.outcome`이 `not_handed`면 `ExitWith(CLI_EXITS.success, <stdout 값>, "not_handed: <reason>: <message>")`로 stderr에 한 줄을 더한다(정한 것).
   - **report:** `{ instance, step, text, next?, session? }`를 `ReportWorkflow`에 보낸다. `text`가 8 KiB(UTF-8)를 넘으면 core가 `invalid_input`으로 거절한다(`wf-contract`. 긴 내용은 file에 두고 경로를 적는다). CLI는 크기를 따로 검사하지 않는다. `--json`이면 출력 그대로. 아니면 `{ line, handed }`를 낸다. `handed`는 한 줄 글이다: `null`이면 `none`, `handed`면 `handed <step> -> <receiver>`(사람 step이면 ` (human turn)`), `not_handed`면 `not_handed <step>: <reason>`. report가 `not_handed`여도 명령은 성공(0)이다(기록은 남았다).
   - **stop:** `{ instance }`를 `StopWorkflow`에 보내 `instance`를 낸다. `running`뿐 아니라 `ended` instance에도 성공하고(끝난 instance를 사람이 멈춰 되살아나지 못하게 한다), 이미 `stopped`면 `conflict`다. CLI는 이 판정을 하지 않고 core의 오류를 그대로 낸다.
   - **show:** `ReadWorkflowInstance`를 `{ instance }`로 부르고 `next_cursor`가 null일 때까지 `cursor`를 따라 줄을 모은다. 값은 `{ instance, last_reports, lines }`다(`instance`와 `last_reports`는 마지막 page의 것). `--json`이면 JSON 하나, 아니면 `output.ts`가 줄로 푼다(다른 명령과 같다).
   - 읽기 이름 규칙(`types.ts`의 `READ_WORDS`)에 `show`가 이미 있어 `show`만 읽기, 나머지 셋은 변경으로 help에 나온다. `READ_WORDS`는 고치지 않는다.
   - `--idempotency-key`는 memory route라 쓰이지 않는다. 중복을 막는 것은 호출한 쪽의 일이다(`workflow report`를 다시 부르면 줄이 하나 더 남는다).
3. **flag.** `packages/coding-agent/cli/parser.ts`: `ParsedArgs`에 `step`, `next`를 더하고 `VALUE_FLAGS`, `FLAG_KEYS`, 초기값에 `--step`, `--next`를 더한다(값 flag라 `--session`과 같은 취급). 머리 주석의 위치 인자 목록에 `workflow start|report|stop|show`를 더한다. `packages/coding-agent/cli/main.ts`: `parsed.step`, `parsed.next`가 있으면 `candidate.step`, `candidate.next`에 넣는다(`parsed.session`과 같은 자리, 주석 "이 칸들은 run 명령만 받는다"를 맞춘다). 다른 명령이 이 flag를 주면 strict 입력이 "모르는 칸"으로 거절한다(지금 `--agent`와 같다). 주의: `workflow report`는 `step`이 위치 인자라서 `--step`과 칸이 겹친다. flag가 위치 인자를 덮어쓰지 못하게 `slots`에 같은 칸이 있으면 `invalid_input`("<step> 위치 인자와 --step을 같이 쓰지 않는다")으로 거절한다.
4. **등록.** `packages/coding-agent/cli/registry.ts`의 `COMMANDS`에 `...WORKFLOW_COMMANDS`를 더한다. 표와 이름이 어긋나면 기동 때 던진다(`registry.ts`의 대조). `packages/coding-agent/cli/help.ts`는 표에서 만들어져 보통 고칠 일이 없다. `lophn workflow report --help`를 한 번 돌려 `<instance> <step> <text>`와 `--next`, `--session`이 읽히는지 본다.
5. **자격.** 따로 만들 것이 없다. `auth: "user"`라 `main.ts`가 coding token이 있으면 그것을, 없으면 user token file을 쓴다. coding session 안에서는 coding token의 actor가 route의 `actors`(user, agent)에 없어 core가 `forbidden`으로 돌려준다(CLI 코드는 그것을 가리지 않는다). user token의 줄 `by`는 `{ kind: "user" }`다(`wf-service`).
6. **test.** 새 test는 만들지 않는다. `main_test.ts`는 표와 어긋남을 기동 때 던지는 것으로 이미 본다. 돌려서 깨지지 않는지만 확인한다.

## 정한 것

- **route 값은 표에 두지 않고 명령이 직접 부른다.** `run.ts`와 같은 이유다(protocol import 순환).
- **CLI 표는 형식을 좁히지 않는다.** core의 route가 `workflowKeySchema`·`stepNameSchema`로 검사해 `invalid_input`을 돌려준다. CLI는 id(`wfi`)와 `new|same`만 본다.
- **`workflow start`가 첫 step을 넘기지 못했으면 stderr에 한 줄을 더한다.** 시작은 성공이고 종료 코드는 0이다. 근거: 조용히 잃지 않는다(`agent-call.md`). `--json`은 `handed`에 이유가 있다.
- **`workflow report`의 `--next`는 값을 검사하지 않는다.** 없는 step이면 core가 `not_handed`로 줄에 남긴다(README "담당을 풀 수 없으면 넘기지 않고 그 사실을 줄로 남긴다").

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음.
- 남지 않음: 없음(옛 이름을 지우는 task가 아니다).
- 손으로 확인: `lophn help`의 읽기 명령에 `workflow show`, 변경 명령에 `workflow start|report|stop`이 나온다. 실제 core를 띄우는 확인은 하지 않는다(새 e2e는 사람에게 묻는다).

## 보고

- 바꾼 file, 통과한 check.
- 등록할 것: 없음(`registry.ts`는 이 task가 고친다).
- 안 쓰게 된 export: 없음.
- 정한 것: 위 "정한 것" 밖에 worker가 정한 것.
- 넘길 줄: 없음이 기본. route 변수 이름이 `wf-contract`와 달라 맞춘 곳이 있으면 적는다.
- 계약 바꾸기 요청: 있으면 적는다.
- **무겁게 짠 것**: 없으면 "없음".
- **알려진 미완 동작**: 위치 인자 `<text>`가 `-`로 시작하면 parser가 option으로 읽어 거절한다(`agent run <prompt>`와 같은 기존 한계). 고치려면 parser에 `--`(옵션 끝) 처리가 필요하다. 이 task에서 만들지 않고 이 항목으로 보고한다.
