# gui-claude

Claude Code adapter. Agent SDK로 사람의 `claude`를 띄워 streaming input으로 대화하고, SDK가 내는 것을 ACP update로, 창의 ACP 입력을 SDK 호출로 옮긴다.

- 단위: gui (wave 2)
- 선행: gui-protocol. 그 task의 `HarnessGuiAdapter`와 `AcpSessionHandle`을 쓴다.
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/claude.ts`(새 file)
  - `packages/shell/main/extensions/bundled/harness-gui/claude_test.ts`(새 file)
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/claude/`(새 폴더)
- 읽을 것:
  - 계획: `project-docs/plan/harness-gui/README.md`의 정한 것 1, 2, 6
  - 근거: `/home/pyosechang/projects/harness-lab/cli-to-gui-report.md` §2.2(Happy 원격 모드의 SDK `query()`), §3.2(Happy Agent `claude_code`: `systemPrompt: {preset: "claude_code"}`, `settingSources: ["user","project","local"]`, `canUseTool`), `/home/pyosechang/projects/harness-lab/chat-ui-ux-report.md` §2.1(Claude 데스크톱이 SDK로 하는 것)
  - ACP: `project-docs/architecture/acp.md`, `packages/protocol/acp/`
  - 지금 headless parser(본보기, 고치지 않는다): `packages/protocol/coding-agent/headless/claude.ts`
- 계약:
  - 쓰는 것: `HarnessGuiAdapter`, `AcpSessionHandle`, `packages/protocol/acp/`
  - 내놓는 것: adapter 표의 `claude` 칸

## 할 일

1. `@anthropic-ai/claude-agent-sdk`를 판을 고정해 쓴다(package.json 등록은 lead, 보고의 "등록할 것"). `claude` 실행 파일은 사람의 PATH에서 찾아 SDK에 넘긴다. 사람의 설정·CLAUDE.md·skill·login을 그대로 쓴다(`settingSources` user, project, local).
2. SDK 메시지 → ACP: 사람 메시지, 흘러나오는 글(partial message)과 reasoning, tool 시작·끝(종류는 Edit·Write → `edit`, 나머지 `generic`), turn 시작·끝, 오류. subagent 메시지(`parent_tool_use_id`)는 부모 tool 줄 안에 두거나 빼고, 어느 쪽인지 보고에 적는다.
3. 승인: `canUseTool`을 ACP pending approval로 내고 창의 결정(한 번, 이 session 동안, 거절)을 돌려준다. `AskUserQuestion`은 ACP 질문으로 낸다. 전부 허락 mode(`bypassPermissions`)는 쓰지 않는다.
4. ACP 입력 → SDK: send(streaming input에 넣기, 실행 중이면 SDK가 하는 대로), stop(interrupt), 승인·질문 답.
5. `--resume <id>`는 SDK resume으로 넘긴다. 앞 대화를 다시 그리지 못하면 창에 "앞 대화는 CLI에 있다" notice 하나를 낸다.
6. fixture: 실제 실행 녹화는 lead가 사람 허락을 받은 뒤다. 그 전에는 SDK type과 문서로 만든 fixture로 test하고 보고에 적는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "승인 요청은 창이 답하기 전까지 tool을 실행하지 않고, 거절하면 tool이 거절로 끝난다"(fixture로 adapter를 돌린다. 실제 `claude`를 띄우지 않는다).
- 남지 않음: 없음.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 실제 실행으로 확인하지 못한 SDK 동작을 적는다.
