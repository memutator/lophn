# 계획: lophn-agent를 harness와 lophn domain으로 나누기

상태: 열었음. brief는 `tasks/`, 상태는 `status.md`(`python3 -I project-docs/plan/tools/status.py harness-domain build`). lead는 `project-docs/plan/tools/lead/lead.sh harness-domain`이 여는 worktree(branch `plan/harness-domain`)에서 돌린다.

## 이 계획

- 목표: harness(loop, tool registry·호출·Gate 연결, prompt 조립 틀, provider·model, 범용 tool)는 role 이름, place 종류, domain route를 모르게 하고, domain tool 정의는 각 domain module이, role·place 규칙과 prompt 내용은 새 role 층이 갖게 한다. agent가 보는 tool 이름, 입력, role별 목록, prompt 글은 나누기 전과 같다.
- 재료: `project-docs/products/roadmap/harness-domain-split.md`(지금 모양, 목표 모양, 지켜야 할 것, 단계, 끝남 기준), `project-docs/architecture/layers.md`, `project-docs/architecture/agent-definition.md`, `project-docs/boundary-catalog.yaml`의 `lophn-agent`, `agent-tools`, `run-loop`, `agent-roles`, `agent-tool-spi`, `project-docs/module-catalog.yaml`, `project-docs/issues/mistakes.md`의 숨은 SQL 의존.
- 범위 밖: harness를 외부 라이브러리로 바꾸기, tool 이름·입력·prompt 글 고치기, lophn tool과 coding agent CLI를 한 정의로 내기, `tools/questions/`와 `extensions/`의 domain 섞임, `projects>apps` 예외(Worker가 직접 여는 파일이라 따로 본다).
- 단위(brief가 확정한다):
  - `harness-spi`: registry가 조립 쪽에서 넘긴 tool 목록을 받게 한다. `tools/builtin.ts`의 bundle 정적 import 17개를 composition root로 옮긴다. `ToolDefinition`에서 옛 칸(`revision`, `confirm`, `contract`, `reversible`, `idempotent`)을 지우고 `defineBuiltin`을 harness의 `defineTool`로 바꾼다. 먼저 agent credential의 operation 목록이 tool 이름(`ticket.create`)과 route 이름(`CreateTicket`)을 어떻게 잇는지 코드로 확인한다(`contract` 칸을 지우면 이것이 깨질 수 있다).
  - `domain-tools`: domain tool bundle을 domain으로 옮긴다. ticket·app·package·release·visual → `packages/core/apps`, problem → `packages/core/problems`, context·outline → `packages/core/projects`. domain마다 task 하나.
  - `role-layer`: 새 core module에 role 층을 모은다: `protocol/lophn-agent/tool-catalog.ts`의 role별 목록, `places.ts`의 role·place 규칙, `roles/`(prompt, guide), `agents/`의 role 분기, `place-info.ts`·`context-text.ts`의 role 규칙, `commands/role-prompts.ts`, `PRODUCT_INSTRUCTIONS`, operator·guide·instructions tool. `turn-prompt.ts`는 글을 인자로 받는다.
  - `harness-hooks`: 범용 tool 안의 lophn 규칙(`LOPHN.md` 쓰기 Gate, rewind 기록, place 폴더 가두기)을 harness의 hook으로 바꾸고 role 층이 채운다.
  - `role-ports`: `lophn-agent/register.ts`의 `contextStatusOf` import와 `agentLookups`의 다른 module 표 SQL을 role 층이 wiring에서 받는 port로 바꾸고 `tools/check-deps.ts`의 `lophn-agent>projects` 예외를 지운다.
  - `layer-checks`: `tools/check-deps.ts`가 새 층을 지킨다(harness 폴더에서 `protocol/apps`·`problems`·`projects`·`coding-agent` import 0, role 이름 문자열 0, role 층과 domain은 서로 import하지 않음).
- 순서(초안): wave 1 `harness-spi`. wave 2 `domain-tools-*`와 `role-layer`(같은 file은 선행으로). wave 3 `harness-hooks`, `role-ports`. wave 4 `layer-checks`.
- 사람이 정할 것: 없음. roadmap의 정할 것 여섯은 아래처럼 정했다(바꾸려면 말한다).

## 정한 것

roadmap "정할 것"의 답이다. 근거는 roadmap의 "지켜야 할 것"과 AGENTS.md "속도"(가장 단순한 구현)다.

1. **SPI 모양과 자리.** harness가 `ToolDefinition`(옛 칸을 뺀 것)과 `defineTool`을 낸다. domain은 `<domain>/agent-tools.ts` 같은 file 하나에서 tool 목록을 낸다. 이 file은 protocol과 harness의 tool type만 import한다(agent runtime child에서 실려 domain의 store·DB 코드가 딸려 오면 안 된다). 입력 schema는 지금처럼 protocol의 route가 갖고, 중앙 `TOOL_INPUTS`·`BuiltinToolName` 표는 없앤다. `ToolContext`의 lophn 칸은 가장 단순하게 role 층이 type을 정하는 값 하나로 묶고, harness는 그 안을 보지 않는다.
2. **role 층은 새 core module이다.** `packages/core/lophn-agent` 안 하위 폴더로 두면 check-deps가 harness와 role 층을 path 말고는 가를 수 없다. 이름과 boundary(지금 `lophn-agent`의 자식 `agent-roles`)는 brief가 코드를 보고 정하고, catalog는 lead가 고친다. 층은 domain과 role 층이 둘 다 harness 위이고 서로 import하지 않는다. composition root가 domain의 tool 목록과 role 층의 목록을 harness에 넘긴다.
3. **lophn tool과 coding agent CLI를 한 정의로 내지 않는다.** 둘은 이미 같은 route를 쓴다. 감싸는 코드를 합치는 일은 CLI 출력·인증과 얽혀 이 계획을 키운다.
4. **범용 tool 안의 lophn 규칙은 이번에 hook으로 뺀다**(`LOPHN.md` Gate, rewind 기록, place 가두기). `tools/questions/`(2,517줄)와 `extensions/`(약 6,000줄)는 이번에 손대지 않는다.
5. **credential operation 이름은 `harness-spi`의 첫 일로 코드에서 확인한다.** 확인 결과가 SPI 모양을 바꾸면 lead가 brief를 고친다.
6. **층 예외는 `lophn-agent>projects`만 이번에 없앤다.** `projects>apps`는 범위 밖이다.

## 지켜야 할 것(worker brief에 그대로 넣는다)

- 동작을 바꾸지 않는다. agent가 보는 tool 목록과 입력이 role마다 나누기 전과 같아야 한다(`tools/registry_test.ts`가 role별 목록을 본다).
- tool 정의 file은 agent runtime child에서 실린다. domain의 store나 DB 코드를 import하지 않는다(`layers.md` "실행 때 import가 뜻하는 것").
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.

## 돌리기 전에

- ui-kit 계획과 같이 돌 수 있다. 겹칠 수 있는 곳은 `packages/core/apps`(ui-kit은 `releases/ui-build`·app template, 이 계획은 apps의 agent tool file)와 `tools/check.ts` 정도다. `status.py ready`가 lead worktree를 건너 소유 겹침을 거른다.

## lead가 할 일

- merge 때마다 관련 이슈 절을 `issue` skill대로 닫는다.
- 모두 merged면 `architecture/layers.md`(그림, 예외, harness와 domain 표), `architecture/agent-definition.md`, boundary-catalog(`agent-tool-spi`, role 층 boundary, 목표 모양 주석 지우기), module-catalog, `context-component-registry.yaml`을 고치고, changelog 열린 판에 항목을 덧붙이고, roadmap 파일과 이 폴더를 지운 commit까지 land한다.
