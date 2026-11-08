# agent-surface

- 목표: agent가 작업 중에 자기 밑으로 session을 열어 팀을 늘리고 줄이며, 팀원끼리 연락하고, shell에 agent 대화 탭·harness agent의 TUI 탭·browser 탭을 연다. extension이 schema 있는 진짜 tool을 등록해 할당한 agent가 쓴다. 둘은 core → shell host queue 하나를 같이 쓴다.
- 재료: `project-docs/products/roadmap/agent-surface.md`, `project-docs/products/roadmap/tool-extension.md`(둘 다 정한 것과 "지금 코드"), `project-docs/architecture/{workspace-layout,agent-call,agent-definition,acp,coding-agent,harness-gui,browser-tab,terminal-agent,extension,approval,workspace-session}.md`, `project-docs/products/roadmap/{agent-platform,standalone-core,command-surface}.md`, `../harness-lab/_report/tool-extension-architecture.md`, `project-docs/boundary-catalog.yaml`, `project-docs/module-catalog.yaml`.
- 범위 밖: 두 roadmap의 "하지 않는 것"(browser page 내용·조작, 앱 화면 읽기, 표준 ACP·A2A, 아무 명령의 터미널, workflow를 팀으로 옮기기, 사람의 `join`, 실행 중 tool 등록, 늦게 싣기). agent definition 화면 정리는 계획 `agent-scope`다.

## 정한 것

두 roadmap의 "정한 것"이 이 계획의 결정이다. 줄여 적으면:

- 팀은 spawn tree다(`team spawn`으로 연 session에 `spawned_by`). desk는 root가 있는 그리는 자리이고, layout group은 배치일 뿐이다. (사람)
- 규칙 세 줄: spawn은 내 밑으로만 / spawn된 session의 call은 부모·형제·내 밑으로만(workspace 정책은 위에 겹침) / 끝내기는 내 밑만. (사람)
- 지금 `call.send`의 `to: {agent, workspace}` 새 session은 팀 밖으로 그대로 둔다. (agent)
- 상한(root session 아래 열린 자손 수, 깊이)은 설정이고, 넘으면 `conflict`다. 연락처는 prompt가 아니라 `team read`로 읽고, 바뀌면 `team_changed` notice만 보낸다. (agent)
- ACP·A2A는 lophn 규격을 넓힌다. ACP는 바꾸지 않는다. (사람)
- agent는 탭을 열고(`beside | group | float` 힌트, focus 안 뺏음) 자기가 연 탭만 닫는다. browser는 자기가 연 탭의 url·title·loading만 읽는다. (사람·agent)
- TUI는 harness agent session을 그 CLI의 resume으로 연다. 열린 동안 headless turn은 쉬고 입력은 queue에 남는다. TUI 안의 turn은 lophn 기록에 없다. (사람·agent)
- extension tool: manifest에 schema를 정적으로 선언하고, `ctx.tools.handle`로 처리한다. 사람만 쓰는 정의 칸 `extensions`로 할당하고, Gate는 `extension_tool`이다. 묻지 않고 감싸지 않는다. handler는 그 호출 session의 agent 자격을 쓴다. 처음부터 싣는다. (사람·agent)
- host queue는 harness queue와 같은 꼴(core 메모리, shell main이 가져감)로 새로 둔 queue 하나다. harness queue는 그대로 둔다. shell이 없으면 탭 요청은 대기하고, tool 호출은 `unavailable`이다. (agent)

## task

| wave | id | 하는 일 |
|---|---|---|
| 1 | `surf-queue` | host queue(harness queue와 같은 꼴로 새로), `tab open`(agent session, browser), `browser read`, 창으로 push와 `openAt()` 배치 |
| 2 | `surf-team` | `spawned_by` ledger step, `team spawn\|read\|end`, 규칙 세 줄과 상한, `team_changed` notice, 자식을 부모 옆 group에 열기 |
| 3 | `surf-tui` | harness agent의 TUI 탭(CLI resume, cwd, 열린 동안 headless 쉼) |
| 3 | `ext-tools` | `contributes.tools`, `ctx.tools.handle`, host queue 호출 길, registry origin `extension`, Gate `extension_tool`, 정의 칸 `extensions`, handler 자격 |
| 4 | `ext-tools-ui` | harness agent용 CLI 꼴, 편집기 할당 화면, 명함 `diff.plus`, test extension fixture |

wave 3의 두 task는 소유가 겹치면(extension registry, `packages/protocol/lophn-agent/`) lead가 선행으로 줄 세운다.

## lead가 할 일

- **wave 1은 `standalone-core`가 land한 뒤에 연다.** host queue가 control 연결과 shell 재연결 위에 서기 때문이다. 외부 선행은 status 도구가 판정하지 않으므로 lead가 직접 막는다.
- `project-docs/plan/tools/lead/lead.sh agent-surface`가 연 worktree에서만 일한다.
- context 수집과 brief(`tasks/<id>.md`, `.claude/skills/orchestrate/brief-template.md` 꼴)는 lead가 쓴다. 쓴 뒤 `status.py agent-surface build`를 돌린다. brief를 쓰다가 roadmap의 정한 것이 코드와 맞지 않으면, 고치지 말고 planner에게 보고한다.
- 사람에게 물을 것: 새 subprocess·Worker·서버 test와 E2E를 만들기 전. harness CLI를 실제로 띄우는 확인(TUI resume). 실제 model provider 호출.
- 위험 test 후보: 팀 규칙(밖으로 call, 형제 spawn, 남의 자식 끝내기가 막히는지), 상한, extension handler가 사람 권한을 얻지 못하는지, 할당 안 한 extension tool이 Gate에서 막히는지. 정의 칸 `extensions`가 serializer whitelist(`definition-file.ts`의 `orderedFrontmatter`)에서 사라지지 않는지.
- 정의 칸이나 session 모양을 바꾸면 같은 변경에 migration(ledger step 또는 `dataSteps`)을 넣는다. protocol은 쓰는 곳을 같은 변경에서 맞춘다.
- 동작을 land하는 같은 변경에서 문서를 고친다: `agent-call.md`(팀, `team_changed`), `agent-definition.md`(정의 칸 `extensions`, tool 출처), `approval.md`(Gate `extension_tool`), `extension.md`(`contributes.tools`, `ctx.tools`), `coding-agent.md`(TUI 탭), `browser-tab.md`(agent가 연 탭과 `browser read`), `workspace-layout.md`(agent가 연 탭의 배치). `agent-platform.md` 정한 것에 "agent도 client는 뺀다"를 탭·browser 상태까지 연 것을 적고, `roadmap/browser-tab.md` "하지 않는 것"도 맞춘다.
- 끝나면 changelog 열린 판에 항목을 남기고, 두 roadmap의 상태 줄을 고친다.
