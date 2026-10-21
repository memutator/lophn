# agent 정의: instruction, skill, tool, command

상태: 로드맵. 2026-10-21 사람이 "agent 정의도 달라져야 한다. skill, instruction, tool, command 기능. doctor 같은 것은 command로 쓸 수 있다"고 방향을 냈고 planner가 정리했다. 낮은 수준의 선택은 planner에게 맡겼다(`problem-ticket.md`).
배경 문서: `project-docs/architecture/agent-definition.md`, `project-docs/architecture/place-session.md`, `project-docs/products/AGENT-ROLE.md`, `project-docs/products/roadmap/problem-ticket.md`, `project-docs/products/roadmap/approval.md`, `project-docs/products/roadmap/workflow.md`.

## 왜

- **App Engineer가 직접 짓게 되면 정의의 반이 낡는다.** App Engineer 지침 241줄 가운데 약 124줄이 ticket, problem, coding agent에게 넘기기, examples, reaction 이야기다(`packages/core/agent-roles/roles/app-engineer/prompt.md`). 직접 짓는 데 필요한 tool(앱 log, invocation, preview, release 준비와 activate)은 없다.
- **같은 말이 여러 곳에 있다.** "Calls", "앱과 data 규칙", "결정은 하나씩, 선택지 2~3개와 추천", artifact 안내, domain 폴더 설명이 role 지침 넷과 제품 고정 규칙(`PRODUCT_INSTRUCTIONS`)과 guide에 되풀이된다.
- **필요할 때 읽는 글이 두 길이다.** skill(`skill.read`)과 guide(`guide.read`, 10편 546줄)다. `artifact` guide는 사실상 skill인데 guide로만 닿는다.
- **command가 반만 지어져 있다.**
  - `/` 메뉴는 있다. 하지만 role command와 skill command는 인자를 버린다. 주석은 "붙인다"고 하는데 코드가 그러지 않는다(`packages/shell/renderer/conversation/agent-view.tsx:380-384`, `packages/core/agent-roles/commands.ts:3-5`).
  - `/recap`은 core route가 없어 진짜 source에서 `unavailable`이다.
  - command의 `tool` 갈래는 만드는 곳이 없다.

## 모양

### 네 부분

| | 무엇 | 누가 부르나 | 어디 사나 |
|---|---|---|---|
| instruction | 늘 실리는 글 | 늘 | 제품 고정 규칙과 role 지침, 전역 `LOPHN.md`, project `LOPHN.md`, `DOMAIN.md`, agent 정의 본문 |
| skill | 필요할 때 읽는 절차 | agent가 판단해서, 또는 사람이 `/이름` | 내장, 전역(등록한 폴더, 개인 보관함), domain의 `skills/` |
| tool | agent의 동작 | agent | role 목록, 할당한 앱 tool과 MCP tool(`approval.md`) |
| command | 사람이 `/`로 부르는 것 | 사람 | session 조작(new, rename, archive, compact, fork, permissions)과 skill |

### command는 "사람이 이름으로 부르는 skill"이다

- 새 개념을 두지 않는다. `/` 메뉴의 항목은 session 조작 몇 개와 skill뿐이다. Claude Code도 skill을 `/`로 부른다.
- `/이름 글`로 부르면 skill 이름과 뒤의 글이 함께 다음 turn의 사람 메시지로 들어간다. 지금 버리는 인자를 잇는다.
- role command(lophn의 `new-app`, `repair-app`, PM의 `check-kinds`)는 내장 skill로 옮긴다.
- **예: `/doctor`.**
  - App Engineer가 그 앱의 domain에 skill `doctor`를 쓴다. 내용은 "앱 tool `doctor.check`를 부르고, 최근 log의 오류를 읽고, 사람에게 요약한다" 같은 것이다.
  - 그 domain의 skill이라 그 앱의 App Engineer와 그 domain을 고른 Operator의 `/` 메뉴에 저절로 뜬다.
  - 사람은 `/doctor`만 친다. lophn은 "doctor"를 모른다.
- model 없이 tool을 바로 부르는 command는 두지 않는다. 사람이 tool을 바로 누르는 곳은 앱 화면이다.

### guide는 skill이 된다

- `guide.read`와 guide 10편을 내장 skill로 옮긴다. 필요할 때 읽는 길이 하나가 된다.
- 내장 skill에는 role을 적는다. lophn 사용법 guide는 lophn에게만, artifact 쓰는 법은 artifact를 쓰는 role에게 간다. 지금 `kinds-yaml`이 그렇다(`packages/protocol/lophn-agent/skill-settings.ts:21-29`).

### instruction은 한 번만 말한다

- 모든 role에 같은 말("Calls", "앱과 data 규칙", "결정은 하나씩", artifact 한 줄)은 `PRODUCT_INSTRUCTIONS` 한 곳에 둔다.
- domain 폴더 설명과 kind 다루기는 PM과 App Engineer 지침에 두 번 쓰지 않고 내장 skill(`kinds-yaml`과 domain guide에서 온 skill)로 둔다.
- App Engineer 지침은 직접 짓는 흐름으로 다시 쓴다: 설계(재사용 → 모델 → journey → 화면 → tool), 코드, preview 확인, release 준비, `release.activate`. 목표는 지금의 반 정도다.
- lophn과 PM 지침에서 ticket 줄을 지운다(problem과 reaction 줄은 `problem-remove`가 지웠다).

### tool

- 모든 role의 읽기 목록에서 `ticket.*`를 지운다. App Engineer의 ticket 쓰기도 지운다(`problem-ticket.md`).
- App Engineer에게 preview 띄우기와 그 tool 부르기, release 준비, `release.activate`를 더한다(`problem-ticket.md`). 앱 log, invocation, 상태 읽기(`app.logs`, `app.invocations`, `app.status`)는 `problem-remove`가 더했다.
- `guide.read`를 지운다(skill로 옮김).

### 정의 칸

- 지금 칸은 그대로 둔다: `name`, `profile`, `model`, `skills`, `domains`, `mcp_off`, `mcp_servers`, 본문.
- 쓰이지 않는 것을 지운다: 기본 schema의 `safe_tools`와 `permissions`(`packages/protocol/lophn-agent/agent-values.ts:160-185`, `run-loop/prepare.ts:353`), command의 `tool` 갈래, `skill_origin`, `while_running`.
- 더하는 칸은 다른 roadmap에서 온다.
  - Operator의 skip 기본값. 사람만 쓴다(`approval.md`).
  - workflow 연락처 절. 정의가 아니라 prompt에 싣는다(`workflow.md`).

## 지금 코드

- **정의 층.**
  - 내장 role 정의(`lophn.md`, `project-manager.md`, `app-engineer.md`)는 사람만 쓰고, 칸은 `model`, `skills`, `mcp_off`, 본문이다(`packages/protocol/lophn-agent/operators.ts:41-46`).
  - Operator 정의는 칸이 8개이고, 사람과 자기 place의 PM, App Engineer(`operator.create`, `operator.update`)가 쓴다. `name`과 `mcp_servers`는 사람만 쓴다.
  - model은 대화 → agent 정의 → project → 전역 순이다(`packages/core/lophn-agent/agents/resolve.ts`).
  - MCP와 skill을 끄는 층은 전역, project, agent 셋이다.
- **instruction.**
  - 순서: 제품 고정 규칙(`packages/core/agent-roles/roles/prompts.ts:30-48`)과 role 지침, 전역 `LOPHN.md`, project `LOPHN.md`(app place에는 없다), `DOMAIN.md`(합쳐 24,000자), agent 본문
  - 파일마다 32 KiB다.
  - role 지침은 lophn 79, PM 117, App Engineer 241, Operator 63줄이다.
- **ticket, problem, coding agent, reaction에 걸린 지침 줄.** App Engineer 약 124줄, PM 16~22줄, lophn 7줄, Operator 0줄이다. 제품 고정 규칙에 `<lophn-reaction>` 정의 한 줄이 있다. guide 다섯 편이 이것들을 말한다.
- **skill.**
  - 층은 내장(`kinds-yaml` 하나, PM과 App Engineer), 전역(등록한 폴더, 개인 보관함 `<LOPHN_HOME>/skills`), domain(`skills/`)이다.
  - prompt에는 이름과 설명만 싣는다. 본문은 24 KiB까지다.
  - 찾기 구현이 둘이다: turn용 비동기(`packages/core/lophn-agent/extensions/skills.ts`)와 화면과 `/` 메뉴용 동기(`skills-sync.ts`, 207줄).
- **tool.** 공통 14, 읽기 19(모든 role), 일 3(lophn 빼고). role별 합계는 lophn 36, PM 39, App Engineer 47, Operator 36이다(`packages/core/agent-roles/tool-lists.ts`).
- **shell.** `shell.run`은 기본 120초, 최대 600초에 끊는다. 배경 process는 남지 않고, env는 8개만 넘긴다(`packages/core/lophn-agent/tools/shell/run.ts:8-9`, `env.ts`). `deno test`는 `deno`가 PATH에 있으면 돈다. dev server와 watch는 못 돈다.
- **`/` 메뉴.**
  - 목록은 session마다 만든다(`packages/core/lophn-agent/commands/registry.ts`, `packages/protocol/lophn-agent/commands.ts`).
  - 묶음은 셋이다: 내장 9(new, rename, archive, compact, fork, mcp, skills, permissions, recap), role command(lophn `new-app`·`repair-app`, PM `check-kinds`), skill.
  - role command와 skill command는 사람 메시지로 들어간다. skill command의 글은 `Use the "{skill}" skill for this request.`다.
- **크기(test 제외).**
  - `packages/core/agent-roles/**` 2,264, 그 markdown 1,153(지침 500, guide 546, skill 107)
  - `packages/core/lophn-agent/agents/**` 1,958, `extensions/**` 6,261(MCP 약 4,370, skill 약 1,716)
  - `instructions/**` 597, `prompt-assembly/**` 1,016
  - 정의 편집 화면 `packages/shell/renderer/workspace/agents/**` 6,095

## 정한 것 (사람, 2026-10-21)

- agent 정의를 instruction, skill, tool, command로 다시 본다.
- doctor 같은 것은 command로 쓸 수 있다.

## 정한 것 (agent, 사람이 맡김)

- **command는 "사람이 `/`로 부르는 skill"이다. 새 개념을 두지 않는다.** 근거: `/` 메뉴가 이미 skill을 보이고 사람 메시지로 넣는다. 끊긴 인자만 이으면 된다. model 없이 tool을 바로 부르는 갈래는 앱 화면이 하는 일과 겹친다.
- **role command는 내장 skill로 옮긴다.** 근거: 사람이 부르는 것이 skill 하나로 모인다.
- **guide를 내장 skill로 옮기고 `guide.read`를 지운다.** 근거: 필요할 때 읽는 길이 둘일 이유가 없다. 내장 skill은 이미 role로 거른다.
- **모든 role에 같은 말은 `PRODUCT_INSTRUCTIONS`에 한 번만 둔다.** 근거: 여러 곳에 두면 한 곳만 고쳐지고 나머지가 낡는다.
- **App Engineer 지침은 직접 짓는 흐름으로 다시 쓴다.** 근거: `problem-ticket.md`. 지울 줄과 더할 tool이 같은 계획(`ae-builds`)에서 바뀌어야 지침과 tool이 어긋나지 않는다.
- **쓰이지 않는 칸과 갈래를 지운다**(`safe_tools`, `permissions`, command의 `tool`, `skill_origin`, `while_running`). 근거: 읽는 곳이 없다.
- **`/recap`은 지운다.** 근거: core route가 없어 진짜 source에서 돈 적이 없다. 필요해지면 skill로 둔다.
- **skill 찾기 구현을 하나로 합친다.** 근거: 같은 층 합치기를 두 번 구현했다.
- **정의 칸, 끄기 층, 개인 skill 보관함, profile 그림은 그대로 둔다.** 근거: 절차를 박아 둔 것이 아니라 사람이 쓰는 기능이다. project 층은 shell 규칙에서도 사람이 "다른 harness도 이 모양"이라며 골랐다(`approval.md`).

## 정할 것

- 없음. App Engineer가 coding agent에게 맡기는 흐름은 지금 막는다(`problem-ticket.md`). `call`의 받는 곳 `coding_agent`는 받지 않고, coding agent 연결의 크기는 보류다.

## 단계

- 계획을 따로 열지 않고 다른 계획에 나눠 싣는다. 지침과 tool이 같은 변경에서 바뀌어야 하기 때문이다.
  - `problem-remove`: 모든 role에서 `problem.*` 읽기와 reaction 줄, `<lophn-reaction>`을 지운다. lophn의 L7을 앱 상태와 log 읽기로 바꾼다.
  - `ae-builds`: App Engineer 지침을 다시 쓰고, `ticket.*`를 지우고, App Engineer tool을 더한다. 쓰기 전에 shell에서 앱 test를 돌릴 `deno`가 PATH에 있는지 확인하고, 없으면 lophn이 쓰는 `deno`를 shell PATH에 넣는다.
  - 새 계획 `agent-definition`(작음): command 인자 잇기, role command를 skill로, guide를 skill로, 겹친 지침을 `PRODUCT_INSTRUCTIONS`로, 쓰이지 않는 칸 지우기, `/recap` 지우기, skill 찾기 하나로 합치기. `problem-remove`와 순서가 상관없다.
- `/` 메뉴와 정의 편집 화면이 바뀌면 `ui-design` skill로 wireframe부터 고친다. 문구는 `wording` skill을 따른다.

test(AGENTS.md "속도", `write-test` skill):
- skill에 role을 적으면 다른 role의 prompt와 `/` 메뉴에 뜨지 않는다.
- Operator 정의의 skip 기본값 칸은 PM과 App Engineer의 tool로 쓸 수 없다(`approval.md`).

계획 끝에 고칠 것:
- `architecture/agent-definition.md`(guide, skill, command, 지침 층)
- `project-docs/products/AGENT-ROLE.md`(L6의 "제품 안내", L7)
- changelog 열린 판

## 끝남 기준

- App Engineer가 그 앱 domain에 `doctor` skill을 쓰면, 사람이 `/doctor 오늘 동기화가 실패했어`라고 쳤을 때 App Engineer가 그 글과 함께 skill을 따라 점검하고 요약한다.
- `guide.read`가 없고, lophn은 사용법 질문에 내장 skill을 읽어 답한다.
- role 지침 넷을 합쳐 지금 500줄보다 눈에 띄게 짧고, 같은 문단이 두 곳에 없다.

## 하지 않는 것

- **command를 skill과 다른 개념으로 두기.**
- **model 없이 tool을 바로 부르는 command.** 앱 화면이 그 일을 한다.
- **정의 칸이나 끄기 층을 줄이기.** 사람이 쓰는 기능이다.
