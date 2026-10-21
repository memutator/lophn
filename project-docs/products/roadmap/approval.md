# approval: 할당이 허락이다

상태: 로드맵. 2026-10-20 사람이 지금 approval이 쓸데없이 복잡하다며 다시 설계하라고 했다. planner가 다른 harness 다섯(Codex, OpenCode, Hermes, OpenClaw, oh-my-pi)과 대조해 정리했다. 같은 날 사람이 미결정 대부분을 정했고, 남은 것은 "정할 것"에 있다.
배경 문서: `project-docs/architecture/approval.md`(지금 코드), `project-docs/architecture/agent-call.md`, `project-docs/products/AGENT-ROLE.md`(H2~H4, T3~T6, 6절), `project-docs/products/roadmap/headless-schedule.md`, `project-docs/products/roadmap/workflow.md`, `project-docs/issues/place-session.md`(`shell.run`).

## 왜

- **개념이 너무 많다.** intent 7종, actor 3, origin 4, 효과 3, grant 4종(저장소 3), 줄 설정 3, 묻는 길 2(+coding harness mirror), 선택지 5, 취소 이유 3이 있고, applier, fingerprint, "이 session 동안" 허락이 더 있다. 다른 harness는 개념이 2~15개다.
- **같은 판정을 여러 번 한다.** agent call은 call tool의 gate와 Router tx에서 두 번 판정하고, 그 둘을 `gate_allowed`로 잇는다. reaction은 event가 올 때와 applier에서 판정한다. activation은 `prepared`를 세 곳에서 본다.
- **할당했는데 또 묻는다.** 사람이 agent에게 앱을 할당해도, 실행 때 tool별 ask와 "이 session 동안" 허락이 다시 끼어든다.
- **사람이 없는 실행이 멈춘다.** workflow, headless run, job에서 물음이 걸리면 기한 없이 기다린다. workflow를 쓰겠다는 것은 바깥 효과까지 책임지겠다는 뜻이고, 사람은 그 loop에서 자주 빠진다.
- **주 위험인 shell은 묻지 않는다.** 다른 다섯 harness는 모두 shell 명령이 주 gate다. lophn은 shell을 묻지 않고, 덜 위험한 call과 설정 쓰기를 묻는다.

## 다른 harness와 대조 (2026-10-20 조사)

| | 규칙 단위 | 사람이 없을 때 | 크기(test 제외) |
|---|---|---|---|
| pi | 없음. extension의 `tool_call` hook이 block | UI가 없으면 confirm이 false | 약 200줄 |
| OpenCode | `{permission, pattern, action}` wildcard, 마지막 일치 | `run`은 자동 reject, `--auto`면 allow | 약 500줄 |
| oh-my-pi | tool tier(read/write/exec), tool별 allow/deny/prompt, bash pattern | 실패로 끝남(fail closed). subagent는 yolo로 돌고, 부모가 띄운 것을 허락으로 본다 | 1.4k~2k |
| Hermes | 위험 명령 regex key, 사용자 deny glob, allowlist | cron, `-q`, webhook은 즉시 거절(기본). 300초 지나면 거절 | 약 4.3k |
| Codex | 전역 mode, 명령 prefix 규칙, OS sandbox | `exec`은 Never로 고정, 요청은 거절 | 승인 약 5.4k, sandbox까지 25k+ |
| OpenClaw | 실행 파일 glob(+argv, cwd), tool 정책 층 여럿 | UI가 없으면 거절, 30분 지나면 거절 | 39k+ |
| lophn(지금) | agent grant 줄의 never/ask/excluded, 효과 기본값 | 기한 없이 기다림 | core·protocol·wiring 약 3.3k, shell UI 약 3.6k |

- 공통점: 묻는 길은 "기다리는 turn" 하나뿐이다. "항상"은 규칙 한 줄을 더하는 것이다. 사람이 없으면 기다리지 않는다.
- lophn에만 있는 것: 보류 request 길(표, applier, resume), 두 번 판정, fingerprint 재확인, event 종류별 reaction ask.
- 출처: `~/.cache/lophn-orch/repos/`의 codex, opencode, pi(2026-09-28~29), `~/.hermes/hermes-agent`(2026-10-11), oh-my-pi(2026-10-19 clone). OpenClaw는 대부분 문서로 읽었다.

## 모양

### 원칙

- **시킨 것이 승낙이다.** 사람이 agent에게 시킨 일은 그 자체로 허락이다. "10일마다 이 폴더를 옮겨 줘"라고 했으면, agent가 job을 만들고 켜는 것까지 사람이 승낙한 것이다. 다시 묻지 않는다.
- **할당이 허락이다.** 사람이 agent에게 준 tool은 쓰라고 준 것이다.

### 세 가지만 정한다

1. **무엇을 쓸 수 있나: 할당.**
   - 사람이 agent에게 앱(그 앱의 domain tool)과 MCP server를 할당한다. 할당한 것만 tool 목록에 뜬다.
   - **할당이 허락이다.** read와 write tool은 실행 때 다시 묻지 않는다.
   - 할당은 사람만 한다. agent는 자기 할당을 넓히지 못한다(지금과 같다).
2. **실행 때 무엇을 묻나: 둘뿐이다.**
   - 바깥 효과(`external`) tool. 앱 tool은 blueprint 선언으로, MCP tool은 `readOnlyHint`로 효과를 안다.
   - shell 규칙이 `ask`인 명령.
3. **언제 묻지 않나: turn의 mode.**

### turn mode

| mode | 그 turn을 연 것 | `ask` 판정은 |
|---|---|---|
| attended | 사람 메시지, attended turn이 보낸 call, reaction | 사람에게 묻고 turn이 기다린다 |
| unattended | headless run, job, unattended turn이 보낸 call | 묻지 않고 실행한다 |
| skip | skip을 켠 session(dangerously-skip-permissions). Operator 정의의 기본값이나 CLI `--dangerously-skip-permissions`로도 켠다 | 묻지 않고 실행한다 |

- `deny`는 어느 mode에서나 막는다. 할당 안 된 tool은 목록에 없고, shell의 floor 규칙과 사람이 쓴 deny 규칙은 skip에서도 막는다.
- **unattended는 call을 따라 간다.** unattended turn이 보낸 call로 열린 turn은 unattended다. workflow는 headless run이나 job으로 시작하므로, 그 안의 call 사슬이 모두 묻지 않는다. attended turn이 보낸 call은 attended로 남는다.
- unattended turn의 `ask` tool(사람에게 묻는 질문)은 기다리지 않는다. "사람이 없다. 스스로 정하거나, 못 한 것으로 남겨라"를 바로 돌려준다.
- skip은 session에 붙는 표시다. Operator 정의에 기본값 칸을 두면, 그 Operator의 새 session이 skip으로 시작한다. 이 칸은 `mcp_servers`처럼 사람만 쓴다.
- skip은 call을 따라 가지 않는다. 사람이 정한 것은 그 대화이지, 그 대화가 부른 다른 agent가 아니다.

### 묻는 길은 하나다

- turn 안 request뿐이다. 메모리에 있고, turn이 기다리고, 대기 목록과 toast에 뜬다(지금의 turn request와 같다).
- 선택지는 셋이다.
  - `once`: 이번 한 번 실행한다.
  - `always`: 다시 묻지 않는다. 바깥 효과 tool이면 그 할당 줄에 "묻지 않음"을 적고, shell이면 그 명령 prefix의 allow 규칙을 더한다.
  - `reject`: 거절한다. 사유 한 줄이 agent에게 간다.
- "이 session 동안" 허락은 없다. 할당했으면 허락한 것이고, 아니면 한 번씩 묻는다.
- 물은 입력을 그대로 실행한다. 허락은 그 turn이 메모리에 쥔 같은 호출을 풀어 줄 뿐이고, intent를 다시 만들어 대조하지 않는다.
- 재시작하면 request는 cancelled다(지금과 같다).

### shell 규칙

- 규칙은 `{pattern, action}`이다. `pattern`은 `*`를 쓰는 명령 prefix(`git push *`)이고, `action`은 `allow | ask | deny`다. 마지막에 맞은 규칙이 이긴다(OpenCode).
- 명령은 `&&`, `||`, `;`, `|`로 나눠 조각마다 본다. 한 조각이라도 deny면 deny, ask면 ask다.
- 층은 셋이다: 제품 기본(floor deny와 위험 ask), 전역, project. 뒤 층이 앞 층을 덮지만 floor deny는 덮을 수 없다. 맞는 규칙이 없으면 allow다.
  - 전역과 project 규칙은 lophn data(Settings)에 둔다. 사람의 project 폴더에 두지 않는다. PM이 그 폴더를 file tool로 쓰기 때문이다.
  - `always`는 그 turn의 place가 project면 그 project 층에, 앱 place면 전역 층에 줄을 더한다.
  - floor deny 예: `rm -rf /`, `rm -rf ~`, `mkfs*`, `dd * of=/dev/*`, fork bomb. 위험 ask 예: `rm -r*`, `git push --force*`, `git reset --hard*`, `curl * | sh`. 목록은 계획에서 정한다.
- shell의 효과 칸(`read`)은 지운다. shell은 효과가 아니라 규칙으로 판정한다.
- 규칙은 실수를 줄일 뿐 경계가 아니다(oh-my-pi도 "approval is not containment"라고 적는다). `shell.run`이 file 범위와 rewind 밖이라는 이슈(`issues/place-session.md`)는 그대로다.

### 할당 (agent grant)

- agent마다 할당 줄 목록 하나를 둔다. 줄은 두 종류다.
  - `{app, removed_tools, no_ask_tools}`: 앱 단위로 할당하고, 뺀 tool과 묻지 않을 바깥 효과 tool을 적는다.
  - `{mcp_server, removed_tools, no_ask_tools}`: MCP server 단위로 할당한다.
- 다른 domain의 비공개 tool은 할당해도 열리지 않는다(지금과 같다).
- agent 줄과 settings 줄은 없다. agent call은 묻지도 막지도 않는다(아래 "지우는 것").

### 묻지 않는 것

- **agent call.** 부르는 것 자체에는 묻지 않고, 받은 agent는 자기 할당으로만 일한다(AGENT-ROLE T5, T6). 누구를 부르는지는 지침과 workflow 연락처의 일이다.
- **file, web, pdf, image tool**은 place가 범위다(지금과 같다).
- **지침 파일(`LOPHN.md`) 쓰기.** write라서 rewind로 되돌린다.
- **사람이 앱 화면에서 누르는 것**(지금과 같다).
- **coding agent의 tool call.** harness의 일이다.
  - attended에서는 harness의 물음을 지금처럼 대기 목록에 비춘다.
  - unattended에서는 lophn이 hook으로 받은 그 물음에 shell 규칙으로 답한다. deny와 floor면 거절하고, 나머지는 허락한다. coding agent도 lophn agent와 같은 바닥을 쓴다.
  - 2026-10-21 App Engineer가 coding agent에게 맡기는 흐름을 막았다(`problem-ticket.md`). 그 흐름이 다시 열릴 때까지 위 두 줄은 쓰이지 않는다.

### 앱 쪽 (activation 동의와 앱 grant)

- 앱이 쓸 자원(fs, net, secret, 다른 앱 tool)은 activation 때 사람이 허락한다. 이것도 할당이고, 실행 때 묻지 않는다.
- activation 동의는 generic approval이 아니라 activation의 상태("동의 대기")와 사람의 동의 command로 둔다. 대기 목록에 같이 보인다.
- unattended에서도 activation 동의는 사람이 한다. 저절로 동의하는 장치를 두지 않는다.
- 앱이 다른 앱 tool을 부를 때는 grant(`app.call`)가 있나만 본다. 없으면 막는다. 묻지 않는다.

### reaction

- event 종류마다 `off | on`이다. `ask`를 지운다. reaction은 program이 여는 일이라 물으면 보류 request 길이 다시 필요하다.

## 지금 코드

- 문서는 `project-docs/architecture/approval.md`(66줄)다.
- **크기**
  - `packages/core/approvals/` 1661줄(28 file), test 645줄
  - `packages/protocol/approvals/` 939줄. 그 가운데 `approvals.ts` 370줄은 handler 없는 옛 route 9개다.
  - wiring과 부르는 쪽의 approval 몫은 약 700줄이다.
  - shell UI(대기 목록, toast, 대화 안 card, reaction 설정, grant 편집)는 ts/tsx 약 3.6k줄이다.
- **묻는 길 둘**
  - turn request: `packages/core/approvals/turn-requests.ts` 219줄, 메모리
  - 보류 request: 표 `approval_requests`, `commands.ts`, `applier.ts`, `ledger`, `routes`. 약 606줄이고 activation과 reaction만 쓴다.
- **묻는 입구 셋**
  - run-loop tool gate: `packages/core/lophn-agent/tool-judgment/tool-gate.ts` 114줄
  - 앱 호출의 `askGate`: `packages/core/apps/calls/gate.ts` 87줄. 같은 일을 따로 구현했다.
  - coding harness mirror: `packages/core/apps/tickets/coding/hook.ts`
- **agent call의 두 번 판정**
  - call tool의 gate, Router `callGate`(`packages/core/main/daemon/wiring/router-registration.ts:52-86`), `gate_allowed`(`packages/protocol/lophn-agent/calls.ts:184`)다.
- **fingerprint**: `intentFingerprint`, `consumeTurnAllow`(`turn-requests.ts:158-186`), `intentOf`를 두 번 부른다(`tool-gate.ts:101`).
- **"이 session 동안"**: `packages/core/approvals/grants/session-allowances.ts`
- **reaction grant**: 6종 × `off|open|ask`(`packages/protocol/approvals/grants.ts:111-126`). 문서는 "다섯"이라고 적었는데 코드는 6이다.
- **쓰이지 않는 것**
  - intent `app_resource`는 만드는 곳이 없다.
  - `settings_edit.what` 5값 가운데 쓰이는 것은 `instructions` 하나다.
- **앱 tool 할당**: 자기 domain의 tool도 앱 단위 할당이 있어야 tool 목록에 뜬다(`packages/core/lophn-agent/tools/app-tools.ts:24-35`).
- **shell**: `shell.run`은 effect `read`이고 Gate가 없다(`packages/core/lophn-agent/tool-judgment/tool-gate.ts:16`).

## 무엇을 만드나

### 지우는 것

- 보류 request 길 전체
  - 표 `approval_requests`, applier, `resume`, allow와 applied를 나눈 기록
  - `ApprovalDecided`, `ApprovalRequested`, `ListPendingApprovals`, `DecideApproval`, core machine route 5개
- agent call 판정: call tool의 gate, Router `callGate`, `gate_allowed`, grant의 `agent` 줄, "Agents you can call"의 grant 거름
- `settings_edit` intent와 grant의 `settings` 줄
- intent `app_resource`, `packages/protocol/approvals/approvals.ts`(370줄)
- fingerprint, consume, `ToolGateResult`의 `changed`
- "이 session 동안" 허락(`SessionAllowances`), 선택지 `session`과 `allow`
- 앱 호출의 `askGate`. 묻는 자리는 run-loop tool gate 하나로 둔다. core의 앱 호출 경로는 할당과 grant를 확인해 막기만 한다.
- reaction grant의 `ask`
- 옛 표, event, route는 migration 없이 지운다. 개발 data는 지우고 새로 만든다(AGENTS.md "호환성").

### 남기거나 새로 두는 것

- **Gate**: 순수 함수 `judge(호출, 할당, shell 규칙, mode) → run | ask | deny` 하나. 입력은 tool 호출과 shell 명령 두 종류다.
- **turn mode**: 그 turn을 연 입력과 session의 skip 표시로 정한다. unattended는 call 봉투에 실어 받는 turn으로 넘긴다.
- **turn request**: 지금 것을 그대로 쓰되 선택지를 `once | always | reject`로 줄인다.
- **shell 규칙**: 제품 기본 목록, Settings의 전역 규칙과 project 규칙, `always`가 더하는 allow 줄
- **skip**: session 표시, 대화 화면의 켜고 끄는 자리, Operator 정의의 기본값 칸(사람만 쓴다), CLI flag
- **coding harness 물음의 자동 답**: unattended면 hook으로 받은 물음을 shell 규칙으로 판정해 답한다. 맡기는 흐름이 막힌 동안은 만들지 않는다.
- **activation 동의**: activation module의 상태와 사람의 동의 command
- **대기 목록**: turn request(lophn agent, coding harness)와 activation 동의만 보인다.
- **할당 편집 화면**: 앱과 MCP server 줄, 뺀 tool, 묻지 않을 바깥 효과 tool

## 정한 것 (사람, 2026-10-20)

- approval을 크게 줄인다.
- domain tool은 할당이 허락이다. 할당한 것을 session에서 또 허락하게 하지 않는다.
- shell 권한은 다른 harness처럼 다룬다.
- dangerously-skip-permissions 같은 것을 둔다.
- 바깥 효과는 물어도 좋다. 그러나 workflow에서는 묻지 않는다. workflow로 쓴다는 것은 바깥 효과까지 책임지겠다는 뜻이고, 사람이 loop에서 빠지는 일이 많아 approval을 기다리면 안 된다.
- 시킨 것이 승낙이다. job은 agent가 만들고 켠다.
- unattended에서 activation을 저절로 동의하는 장치는 두지 않는다. 일하던 agent가 "필요한 tool이 없고 App Engineer가 만들 수 있다"를 알아채는 상황은 LLM에 메타인지가 없어 일어나지 않는다.
- workflow 안의 coding agent: unattended면 lophn이 harness의 물음에 shell 규칙으로 답한다.
- skip은 session 표시와 Operator 정의의 기본값 둘 다 둔다.
- shell 규칙은 제품 기본, 전역, project 세 층이다.
- CLI 자격에서 같은 OS 사용자가 file을 읽을 수 있다는 위험은 신경 쓰지 않는다.

## 정한 것 (agent)

- **묻는 길은 기다리는 turn 하나다.** 근거: 조사한 다섯 harness가 모두 그렇다. 보류 request 길은 reaction ask와 activation 둘만 쓰는데, reaction ask는 지우고 activation 동의는 activation이 자기 상태로 갖는다.
- **선택지는 `once | always | reject`다.** 근거: "이 session 동안"은 사람이 "할당했으면 또 허락하지 않는다"고 한 것과 겹친다. Claude Code도 bash에 session 범위가 없다.
- **물은 입력을 그대로 실행하고 fingerprint를 두지 않는다.** 근거: 허락은 메모리에서 기다리는 같은 호출을 푼다. intent를 다시 만들지 않으면 바꿔치기할 틈이 없다.
- **agent call은 묻지도 막지도 않는다.** 근거: AGENT-ROLE T5(부르는 것 자체에는 묻지 않는다), T6(권한은 넘어가지 않는다). 사람이 workflow에서 "call 금지 같은 딱딱한 규칙을 두지 않는다"고 정했다. 지금도 기본은 묻지 않음이다.
- **unattended는 call을 따라 간다.** 근거: workflow 안의 call 사슬이 다 묻지 않아야 한다. workflow 이름을 봉투에 싣지 않아도 "누가 시작했나"만으로 정해진다.
- **`deny`는 skip에서도 막는다.** 근거: skip은 묻지 않는 것이지 금지를 푸는 것이 아니다. Hermes의 floor도 yolo보다 먼저 돈다.
- **shell 규칙은 prefix와 `*`, 마지막 일치다.** 근거: OpenCode와 Codex의 prefix 규칙이 가장 작다. regex(Hermes)와 tree-sitter(OpenCode)는 쓰지 않는다.
- **`LOPHN.md` 쓰기를 묻지 않는다.** 근거: write는 rewind로 되돌린다(PRODUCT 4절). 지침은 grant가 아니다.
- **reaction은 `off | on`이다.** 근거: `ask`만이 reaction을 보류 request 길에 묶는다. 기본이 open이라 지금도 거의 쓰이지 않는다.
- **Operator 정의의 skip 기본값 칸은 사람만 쓴다.** 근거: PM과 App Engineer가 `operator.update`로 정의를 고치고, `architecture/agent-definition.md`는 "Operator 정의를 만들고 고치는 tool은 grant를 주지 못한다"고 정한다. `mcp_servers`와 같은 자리다.
- **skip은 call을 따라 가지 않는다.** 근거: 사람이 skip으로 정한 것은 그 대화다. unattended가 call을 따라 가는 것은 workflow를 시작한 사람이 그 사슬 전체를 시켰기 때문이다.
- **전역과 project shell 규칙은 lophn data에 둔다.** 근거: 사람의 project 폴더는 PM의 file 범위라, 거기 두면 agent가 자기 allow 규칙을 쓴다.
- **`always`의 층은 place로 정한다.** project place면 그 project 층, 앱 place면 전역 층이다. 근거: card에 층을 고르는 칸을 두지 않으려는 것이다. Settings에서 옮기고 고친다.

## 정할 것 (기록만, 2026-10-20 정하지 않음)

1. **할당한 domain tool의 바깥 효과를 attended에서 물을까.**
   - 위 설계는 "묻는다(기본), 할당 줄에서 끌 수 있다"이다.
   - "시킨 것이 승낙이다"와 "할당이 허락이다"를 그대로 따르면 묻지 않는 쪽이 된다. 그러면 attended에서 묻는 것은 shell 규칙의 `ask`(agent의 실수 잡기)만 남는다.
2. **reaction이 연 turn의 mode.** 사람이 따로 더 고민하기로 했다(2026-10-20). 위 설계는 attended다. 사람이 없을 때 앱 문제로 열린 App Engineer가 바깥 효과 tool을 부르면 기다린다.
   - 2026-10-21 reaction 여섯을 모두 지우기로 했다(`problem-ticket.md`). `problem-remove`가 land하면 이 항목과 위 "reaction" 절, 지우는 것의 "reaction grant의 `ask`"는 없어진다.

## 단계

- 계획 하나 `approval-simplify`로 연다. 두 wave다.
  1. 지우기: 보류 request 길, agent call 판정, fingerprint, "이 session 동안", `settings_edit`, `app_resource`, 옛 protocol file, 앱 호출의 `askGate`. activation 동의를 activation 상태로 옮긴다. reaction을 `off | on`으로 바꾼다.
  2. 더하기: turn mode(attended, unattended, skip), shell 규칙(기본 목록, 전역, project)과 `always`의 줄 더하기, skip 화면과 flag와 Operator 정의 칸, 할당 편집 화면 정리
  - unattended coding harness 물음의 자동 답은 coding agent에게 맡기는 흐름이 다시 열릴 때 한다.
- `headless-schedule.md`의 1단계(headless run)는 이 계획 뒤에 연다. unattended mode가 run의 전제다.
- 화면(대기 목록, skip, 할당 편집, shell 규칙 설정)은 `ui-design` skill로 wireframe을 먼저 고친다. 문구는 `wording` skill을 따른다.

test(AGENTS.md "속도", `write-test` skill):
- attended turn에서 바깥 효과 tool은 사람이 허락하기 전에 실행되지 않는다.
- unattended와 skip에서도 deny(shell floor, 사람의 deny 규칙)는 막힌다. 할당 안 된 tool은 부를 수 없다.
- attended turn이 보낸 call은 attended로 열린다. unattended가 attended 사슬로 새지 않는다.
- unattended coding agent가 floor 명령을 물으면 lophn이 거절한다(맡기는 흐름이 다시 열릴 때).
- project 층의 allow 규칙은 floor deny를 덮지 못한다.
- agent는 자기 할당을 넓히지 못한다(지금 test가 보면 옮긴다).

계획 끝에 고칠 것:
- `architecture/approval.md` 전체, `architecture/agent-call.md`(call 판정 지움, 봉투의 mode), `architecture/event.md`(지운 event)
- `project-docs/products/AGENT-ROLE.md`: H3(할당 대상), H4, T3·T4(grant가 call을 정함), 6절(reaction grant)
- `headless-schedule.md`와 `workflow.md`의 "보류" 줄
- changelog 열린 판

## 끝남 기준

- 사람이 Operator에게 앱을 할당하면, 그 앱의 read와 write tool은 어느 session에서도 묻지 않고 돈다.
- attended session에서 바깥 효과 tool은 한 번 묻고, `always`를 고르면 다시 묻지 않는다.
- headless run과 그 안의 call 사슬은 아무것도 묻지 않고 끝까지 돈다. `rm -rf /`는 그 안에서도 막힌다.
- skip을 켠 session은 묻지 않는다.
- 대기 목록에는 turn request와 activation 동의만 있다. `approval_requests` 표가 없다.

## 하지 않는 것

- **OS sandbox.** 다섯 가운데 기본으로 켜는 것은 Codex뿐이다. shell 규칙은 실수를 줄일 뿐 경계가 아니다.
- **LLM 판정(guardian, smart).** 판정은 program이 결정적으로 하고, 결정은 사람과 할당이 한다(지금 `architecture/approval.md`의 이유와 같다).
- **timeout.** attended에서는 사람이 대기 목록에서 답하고, unattended에서는 묻지 않는다. 기다리다 끊을 경우가 없다.
- **명령 parser(tree-sitter)와 위험 명령 regex 사전.** prefix 규칙과 짧은 기본 목록으로 시작한다.
