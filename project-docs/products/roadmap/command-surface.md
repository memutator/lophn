# command surface: lophn agent와 coding agent가 같은 명령을 쓴다

상태: 계획 `command-surface`로 구현했다(2026-11-01, `project-docs/products/change-log/0.14/command-table-and-app-operations.yaml`). 사람 앱 Mahas와 Masup도 2026-11-01에 새 두 층 선언으로 전환했다(정한 것 16). 남은 일 없음.
배경 문서: `project-docs/architecture/app-call.md`, `project-docs/architecture/agent-definition.md`(tool 늦게 싣지 않는 규칙), `project-docs/architecture/approval.md`, `project-docs/architecture/coding-agent.md`, `project-docs/architecture/agent-call.md`, `project-docs/products/roadmap/tool-lazy-loading.md`.

## 왜

사람의 말 (2026-11-01, 요지):

- 앱 tool은 원래 "앱마다 고유한 저수준 domain operation을 두고, 그것을 추상화한 API를 골라 agent도 쓰게 포장하는 것"이었다. 지금은 화면용 operation이 그대로 agent tool이다.
  - 예: Mahas(하네스 사용량 대시보드)의 세션 탭이 세션 목록을 불러오다 앱 tool 결과 상한에 걸려 화면에서 오류가 났다. 모든 세션 목록은 agent가 쓸 기능이 아니고 program에서 끝날 일이다. agent가 쓸 것은 "harness와 session id로 그 세션의 token 소모량", "cache hit" 같은 것이다.
- lophn agent의 일을 tool calling 대신 CLI + built-in skill로 옮기고 싶다. coding agent도 같은 것을 써서 두 번 만들지 않는다. lazy tool loading은 복잡하고 provider마다 다루기 어렵다. 앱도 tool 대신 CLI처럼 내놓으면 다른 coding agent가 쉽게 쓴다.
- lophn은 vendor harness가 아니다. coding은 Claude Code보다 잘 깎을 수 없다. lophn은 여러 agent harness가 모이는 hub이고, 사람이 만든 작은 앱들이 관리되고 맞물리고 agent가 그것을 쓰는 환경이다. 다른 coding agent에게 열려 있는 것이 값이다.

## 지금 코드 (main `bdb9f57af`)

### 앱 tool은 한 층이다

- 선언의 `tools[]`(`packages/protocol/apps/declaration/types.ts`의 `ToolDeclaration`) 하나를 화면, 다른 앱, agent, job, flow가 같이 부른다. 화면이 앱 process에 닿는 길은 `lophnApp.callTool` 하나다(`packages/sdk/app-ui/use-tool.ts`, `packages/shell/main/app-frame/app-call.ts`).
- 그래서 화면용 operation이 모두 tool이 되고, 할당되면 각각 agent tool `<domain>_<tool>` 하나가 된다(`packages/core/lophn-agent/tools/app-tools.ts`의 `buildAppTools`).
- 일부러 정한 모양이다. `architecture/app-call.md`의 모델("선언의 두 층")과 지키는 것("호출 경로": 모든 tool 호출은 core를 지난다, 화면에서 앱으로 가는 직통 통로를 두지 않는다)이 그렇다. 짓는 쪽 지침도 같다: `design-app` skill의 "6. Tools: from the model and the screens", `@lophn/declaration` guide의 "다른 앱과 화면이 부르는 tool 목록".
- 화면 호출도 control frame 하나로 오가므로 결과가 `RESULT_MAX_BYTES`(약 254 KiB, `packages/core/apps/runtime/entrypoint/limits.ts`)를 넘으면 실패한다. shell의 8 MiB 한도보다 먼저 걸린다.
- Mahas의 tool 10개(`usage.sync`, `usage.dashboard`, `usage.sessions`, `usage.session`, `usage.compare`, `usage.sources`, `prices.list|set|delete|import_catalog`)는 모두 화면 backend 모양이고 모두 `public: false`다. 앱 agent가 세션 목록을 상한에 맞추려고 200행으로 줄였다(앱 commit `7194b6c` "500 rows failed live"). agent 계약의 제약이 화면 기능을 깎았다.
- `tools[]`를 읽는 관심사는 넷이다.
  - release·activation: 선언과 등록한 handler를 대조한다.
  - 호출 경로: effect·public·domain으로 막고, 줄 세우고, 기록한다.
  - agent 노출: tool 하나가 provider tool 하나다.
  - 화면 허용 목록.
  - 소비하는 곳의 표는 계획을 열 때 다시 뽑는다.
- `outputSchema`는 저장하고 보이기만 한다. 결과를 검사하는 code는 없다.

### lophn agent는 내장 tool 53개를 tool calling으로 쓴다

- `TOOL_ORDER`가 53개다(`packages/core/agent-workspaces/tool-lists.ts`).
- 첫 요청에 실리는 tool 정의(2026-10-29, o200k 기준, `reports/agent-tool-cost-comparison.md`):

  | 구성 | tool 수 | 정의 token |
  |---|---|---|
  | lophn app workspace, deferral 없음 | 52 | 약 12.7k |
  | lophn app workspace, Anthropic deferral | 39 | 약 9.3k |
  | Codex, Claude Code | 11 | 약 6.6k |

- 늦게 싣는 길이 셋이다: 공통 `tool.load`/`tool.call`, Anthropic `defer_loading` + `tool_reference`, Claude 구독 profile의 이름 매핑.
  - 그 code는 `prompt-assembly/loading.ts`(69줄), `tools/bundles/tool.ts`(69줄), `tools/dispatch.ts`(26줄), test 156줄이다.
  - 그 밖에 `run-loop/prepare.ts`, `models/binding.ts`, `run-loop/history.ts`, `providers/definitions.ts`의 `supportsDeferredTools` 등에 약 250줄이 흩어져 있다.
  - 진행 중인 계획 `plan/context-cache`의 `defer` 단위 task `defer-responses`(OpenAI Responses `tool_search`)가 이 위에 쌓인다.
- 사람에게 묻는 tool은 사실상 `shell.run` 하나다. 앱 tool과 MCP tool은 실행하거나 막기만 한다(`packages/core/approvals/gate/judge.ts`의 `ASK_EXTERNAL_WHEN_ATTENDED = false`). 명령으로 옮길 37개에는 gate가 없다.
- tool 정의 하나가 지금 들고 있는 것:
  - route 목록: agent credential의 operation 상한을 여기서 계산한다(`agent-workspaces/credentials.ts`).
  - effect: 같은 batch의 병렬 실행, 실패한 write 뒤 건너뛰기, retry에 쓴다(`run-loop/tool-batch.ts`).
  - `display`: 사람 화면의 줄 제목이다. 11개만 정의했다.
  - 기록 key: `tool_calls`의 tool 이름이다. eval의 `collect/read.ts`와 `versions/components.ts`가 이것으로 센다.
  - idempotency key: `ctx.tool_call`.

### CLI는 이미 있다

- `packages/coding-agent/cli/`(1621줄)에 명령 15개가 있다. `user` 명령(`agent run`, `tool call`, `run *`, `workflow *`)은 `<data root>/run/user-token`으로 core를 부른다.
- 표가 둘로 나뉘어 있다.
  - protocol 쪽 `CODING_CLI_COMMANDS`: zod 입력, auth
  - CLI 쪽 `COMMANDS`: summary, positional, `run`
  - `mutates`는 따로 적지 않고 이름의 끝 낱말로 짐작한다. parser는 flag 목록을 손으로 고정했다(`parser.ts`의 `VALUE_FLAGS`). help와 오류 글은 한국어다.
- `cliMain`은 env, fetch, stdout 등을 주입받고 exit code를 돌려준다. `user` 명령 code(`run.ts`, `workflow.ts`, `connection/`)에는 node 전용 import가 없다.
- user token은 사람의 모든 권한이다. 사람만 하는 route(`DecideTurnRequest`, `job.approve`, `activation.consent`)도 부를 수 있고, 할당 거르기도 지나친다.
- coding agent가 lophn을 부르던 층(coding token, `POST /mcp`, CLI의 `message send`·`app …`·`package …`)은 2026-10-28에 지웠다. coding agent에게 가는 skill은 사람이 승인한 앱 공유 skill과 내장 `lophn-agent` skill뿐이다(`architecture/coding-agent.md`의 지키는 것).

### call/reply/cancel

- `calls.send`와 `calls.reply`는 actor `agent`만 받는다. 보낸 쪽은 agent credential의 session이고, dedup key는 (session, tool call id)다.
- 답은 받는 session의 queue에 들어가 새 turn이 된다(`packages/core/router/router.ts`). 보낸 쪽이 agent가 아니면 `delivered:false`다.
- 터미널의 coding agent에게는 session id도, dedup에 쓸 값도, queue도 없다.

## 정한 것

1. **lophn이 내놓는 일은 명령 표 하나로 둔다(사람, 2026-11-01).** 꼴은 `lophn <group> <verb>`다. lophn agent와 coding agent가 같은 명령과 같은 help를 쓰고, 다른 것은 자격뿐이다.
2. **lophn agent는 native tool `lophn` 하나로 명령을 부른다(agent).**
   - 입력은 명령줄이다. CLI binary와 같은 명령 code를 agent runtime 안에서 agent credential(`ctx.core`)로 돌린다. session, turn, tool call 신원이 지금처럼 붙는다.
   - shell로 binary를 부르지 않는 이유: home에는 shell이 없고, shell env에 token을 넣으면 shell 안의 어느 process든 그 token을 쓸 수 있다.
3. **native로 남는 것은 `ask`, `visual.show`, `skill.read`, file 여섯, `pdf.read`, `image.read`, `web.search`, `web.fetch`, `shell.run`이다(사람·agent, 2026-11-01).**
   - 기준은 "coding agent도 써야 하는가"다. `call`/`reply`/`cancel`/`session.list`도 명령으로 간다(사람).
   - `skill.read`는 native에 둔다(agent). turn 시작 때 agent 정의와 domain으로 거른 snapshot을 읽고(`lophn-agent/extensions/skill-read.ts`), 부를 core route가 없기 때문이다.
4. **늦게 싣기를 지운다(agent).**
   - 내장 tool이 workspace 종류마다 고정된 작은 집합이 되어 숨길 것이 없어진다. 외부 MCP tool은 14번대로 처음부터 싣는다.
   - 지울 것: `tool.load`, `tool.call`, `defer_loading`·`tool_reference`, `supportsDeferredTools`, `exposedToolNames`.
   - `plan/context-cache`의 `defer-responses`는 하지 않는다.
5. **명령 하나가 지금 tool 정의 하나가 들던 것을 든다(agent).**
   - route 목록(credential 상한), effect, display, 기록 이름을 명령마다 둔다.
   - `tool_calls`에는 `lophn`이 아니라 명령 이름(`release.prepare`)을 적는다. 그래야 기록과 관측의 key가 유지된다.
   - `lophn` 호출 하나에 명령 하나다(`&&`, pipe 없음). idempotency key와 effect가 호출 단위이기 때문이다.
6. **CLI를 `packages/coding-agent`에서 떼어 독립 package `packages/cli`로 옮기고, 명령 표는 거기 하나만 둔다(사람·agent, 2026-11-01).**
   - CLI는 이제 coding agent 연결 장치가 아니라 lophn이 내놓는 명령 전체의 입구다. lophn agent, coding agent, 사람이 같이 쓴다.
   - 모양:
     - `packages/cli/commands/`: 명령 표. protocol과 base만 import한다. core의 `lophn` tool도 이것을 import한다.
     - parser, help, output: 표의 schema에서 만든다.
     - `connection/`: `packages/coding-agent/connection/`에서 옮긴다. user token, core 주소 찾기, HTTP client가 들어 있다.
     - `main.ts`: binary 입구. node 전용이고, `local` 명령은 `packages/coding-agent`에서 받아 끼운다.
   - core는 `commands/`와 parser·help만 import하고 `main.ts`·`connection/`은 import하지 않는다. agent runtime에 node 전용 code, harness code, HTTP client가 실리지 않게 하려는 것이다.
   - `packages/coding-agent`에는 harness 감지, hook 설치, `hook` 명령만 남는다.
   - 표를 protocol에 두지 않는다(2026-11-01에 처음 정한 것을 바꾼다). 지금 표가 둘인 것은 protocol 표에 실행 code와 route를 둘 수 없어서다. 표를 protocol에 두면 실행 code가 다른 곳에 생겨 또 둘이 된다. 명령의 모양을 실행 code 없이 읽는 곳도 없다.
   - 명령 code는 얇게 둔다: route를 부르고 결과를 다듬는 것까지다. 부른 쪽에 따라 달라지는 규칙은 core route로 옮긴다. 같은 명령을 binary가 user token으로도 부르기 때문이다. 예: `app.tools`가 `ctx.domains`로 다른 domain의 비공개 tool을 숨기는 것, `domain.create`가 workspace에서 owner를 정하는 것.
   - 같이 고칠 곳: binary 경로를 쓰는 `packages/base/install/linux-install.ts`, `tools/dev.ts`(dev launcher), `tools/doctor/checks.ts`, build packaging, `module-catalog.yaml`·`boundary-catalog.yaml`의 `coding-agent-cli`·`coding-agent-cli-interface`, `architecture/coding-agent.md`·`run.md`·`workflow.md`.
   - 명령마다 이름, 설명, zod 입력, effect, route, positional, 실행 code를 같이 둔다.
   - flag와 help는 입력 schema에서 만든다. 꼴은 `--field value`이고, 복잡한 값은 `--input` JSON으로 받는다.
   - 지금의 두 표, 손으로 고정한 flag 목록, 이름 끝 낱말로 짐작하는 `mutates`는 없앤다.
   - help와 오류 글은 영어로 쓴다. model이 읽는 글이고, 지금 tool 설명도 영어다.
7. **묻기는 옮기지 않는다(agent).**
   - 2026-11-01에 추천했던 "묻기를 core로 옮긴다"는 거둔다. 명령으로 갈 37개에는 묻는 것이 없고, 유일하게 묻는 `shell.run`은 native로 남는다. coding agent의 shell은 그 harness가 묻는다.
   - 명령이 물어야 할 일이 생기면, turn 없이도 되는 지금의 꼴(`release.activate`의 `waiting_consent`, job 승인)을 따른다.
8. **사람만 하는 일은 명령으로 두지 않는다(agent).**
   - 대상: turn 요청 정하기, job 승인과 hold 결정, activation 동의, rewind. 모두 화면에서 사람이 한다.
   - 그러면 CLI가 user token을 써도, coding agent가 명령으로 자기 물음에 답하거나 job을 승인하지 못한다.
   - coding agent는 처음엔 지금의 `lophn tool call`처럼 user token을 쓰고, 그 호출은 person으로 기록된다. 범위를 좁힌 token은 쓰는 곳이 생기면 만든다.
   - 2026-11-01에 "사람만 하는 route를 뺀 token이 처음부터 있어야 한다"고 한 것을 이렇게 바꾼다. 막을 것은 agent의 실수이고(AGENTS.md), 그 실수가 지나는 길은 명령 표다.
9. **workspace가 필요한 명령은 `--app`/`--project`로 받는다(agent).** lophn agent의 `lophn` tool은 session의 workspace를 채워 넣고, CLI는 flag로 받는다. cwd로 짐작하지 않는다.
10. **앱은 두 층이다(층을 나누는 것은 사람, 2026-11-01. 세부는 agent).**
    - **앱 내부 operation**: 화면과 앱 자신이 쓰는 저수준 domain 동작이다. agent에게 보이지 않고 할당 후보에도 오르지 않는다. lophn이 아는 것은 이름과 effect뿐이다. effect가 필요한 이유는 write를 core로 보내 changeset을 떠야 하기 때문이다. schema와 설명은 앱 code의 일이다.
    - **바깥 명령**: 앱이 골라 내놓는 API다. `lophn <domain> <command>`로 agent, 다른 앱, job, flow가 부른다. 의미 단위이고 결과가 작다. handler는 앱 code의 domain 함수를 감싼다.
11. **화면의 write도 rewind 대상이다(agent).**
    - 앱 code는 AI가 썼으니, 사람이 누른 write가 버그로 data를 망칠 수 있다.
    - 그래서 화면 operation 호출은 지금처럼 core를 지나 줄, 기록, changeset을 거친다.
    - read도 같은 길로 둔다. rewind의 drain이 지켜지고 길이 하나로 남는다.
    - operation은 호출 기록에 tool이 아니라 operation으로 남는다.
    - core는 operation을 사람(화면)과 그 앱 자신만 부르게 하고, agent·다른 앱·job·flow가 부르면 막는다. 두 층을 core가 지키는 자리다.
    - 예외: 그 앱 workspace의 session은 preview에서 operation도 부른다. 앱을 짓는 쪽은 화면 operation도 확인해야 하기 때문이다. live에서는 부르지 못한다.
12. **화면 operation의 결과 크기는 control frame 한도에 묶지 않는다(agent).**
    - 256 KiB는 전송 한도이지 제품 규칙이 아니다.
    - rewind apply가 이미 bytes frame과 `end`로 큰 본문을 보낸다(`apps.apply`). 화면 결과도 그 꼴로 shell 한도(8 MiB)까지 받는다.
    - 바깥 명령은 결과가 작은 것이 맞으니 지금 한도를 그대로 둔다.
13. **선언에서 MCP 모양을 뺀다(agent).**
    - MCP endpoint는 10-28에 지웠고, tool마다 provider tool을 만드는 일도 없어진다.
    - `title`(화면 `ToolButton`이 씀)은 operation 쪽으로 옮긴다. 아무도 검사하지 않는 `outputSchema`, 그리고 `toMcpTool`과 annotation은 지운다.
14. **외부 MCP tool은 명령으로 옮기지 않고 provider tool로 둔다(사람, 2026-11-01).**
    - 늦게 싣기를 지우므로 사람이 켠 server의 tool은 처음부터 `tools[]`에 실린다. tool이 많은 server를 켜면 첫 요청이 커지고, 이것은 사람이 server를 켜고 끄는 것으로 조절한다.
    - 그래서 `tools[]`는 workspace 종류와 MCP 설정으로 정해진다. session 시작 때 목록을 고정하고, 바뀌면 `tools_changed` notice로 알리는 규칙은 MCP tool 때문에 남는다.
15. **coding agent가 답을 받는 길은 이 roadmap에서 다루지 않는다.**
    - `call`을 보낸 coding agent가 `reply`를 받으려면 session과 queue가 있어야 한다.
    - 이것은 coding agent를 workflow 참가자로 두는 일(`products/roadmap/workflow.md`)에서 함께 정한다.
    - 이 roadmap에서는 actor `agent`만 받는 `calls.send`·`calls.reply`를 그대로 둔다.

16. **data root의 앱(Mahas, Masup 포함)은 migration code 대신 Claude Code worker가 직접 옮긴다(사람 제안, 2026-11-01).**
    - AGENTS.md "호환성"의 "저장된 data의 모양이 바뀌면 migration을 같은 변경에 넣는다"에 대한 이번만의 예외다. 규칙은 고치지 않는다(사람, 2026-11-01). 이 계획이 land하는 판의 changelog 결정에 남긴다.
    - 봉인된 release의 `declaration.json`, bundle 안 SDK, 화면 code가 옛 `tools[]` 모양이다. 앱 셋을 위해 봉인 사본과 bundle hash를 고치는 data step을 짜는 것보다, worker가 앱 source를 새 모양으로 고쳐 다시 release하는 편이 싸다.
    - 같이 얻는 것: 옛 tool을 모두 바깥 명령으로 옮기는 기계적 변환이 아니라, 바깥 명령을 처음부터 제대로 나눈다. 예: Mahas는 화면 operation과 "harness와 session id로 세션 token 소모량", "cache hit" 같은 명령으로 나눈다. 옛 bundle을 살릴 일이 없으므로 SDK와 화면 bridge의 이름도 새 설계에 맞게 고를 수 있다.
    - 순서:
      1. 계획이 lophn을 짓는 동안, worker가 앱마다 source에 branch를 만들어 새 선언, handler, 화면을 준비한다. 사람이 바깥 명령 목록을 본다. 시험은 앱 사본을 `.dev-data`에 두고 새 판의 dev build로 한다.
      2. 사람이 새 판으로 올린 직후 branch를 합치고, release를 준비하고, 사람이 activation한다. 앱이 멈추는 것은 이 사이뿐이다.
    - `~/.lophn`을 읽고 쓰는 일이라 단계마다 사람에게 묻는다(AGENTS.md "사람에게 묻는 것").
    - lophn.db의 기록(옛 release 행)은 손으로 고치지 않는다. 새 판의 code가 옛 release 행을 읽다 깨지면, 고치는 것은 ledger schema step이다. 필요한지는 계획을 열 때 확인한다.

## 순서

1. **명령 표와 `lophn` tool**
   - 내장 tool 37개를 명령으로 옮기고 늦게 싣기를 지운다.
   - 내장 skill 8개와 workspace prompt에 적힌 tool 이름을 고친다. 점 이름이 약 76줄, `ask`/`call` 같은 맨 이름이 약 22곳이다.
2. **앱 두 층**
   - 선언(operation + 바깥 명령), SDK(`@lophn/cap-tool`, `@lophn/app-ui`), 화면 호출 경로와 큰 결과, 할당과 Grants 화면, `design-app`, app template, `architecture/app-call.md`를 바꾼다.
   - 앱 tool마다 provider tool을 만들던 `buildAppTools`를 지운다.
3. **CLI binary가 같은 명령 표를 쓴다.** coding agent가 사람의 터미널에서 `lophn …`을 쓴다. `local` 명령(`hook`, `harness *`)은 shell main과 harness hook이 부르는 장치라서 명령 표에 넣지 않고 지금처럼 둔다.

## 끝나면

- lophn agent의 `tools[]`는 workspace 종류와 MCP 설정으로 정해지고, provider마다 갈리는 길이 없다.
- Claude Code에서 `lophn <domain> <command> --help`와 `lophn release prepare …`를 부르면 lophn agent가 받는 것과 같은 글과 결과가 나온다.
- Mahas 세션 탭이 500행 넘게 한 번에 그린다. agent에게는 Mahas가 내놓은 명령만 보인다.
