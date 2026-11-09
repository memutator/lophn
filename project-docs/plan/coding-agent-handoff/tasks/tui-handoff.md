# tui-handoff

lophn agent가 사람이 이어서 만질 일을 즐겨찾기 coding agent에게 넘길 때, 그 project에 새 터미널 탭을 열어 그 coding agent를 TUI로 띄우고 handoff 글을 첫 prompt로 준다. 지침(project prompt, 내장 skill `lophn-agent`, CLI help)이 "handoff는 TUI, 일회성은 headless"를 말하게 한다.

- 단위: surface (wave 2)
- 선행: coding-builtin. `codingAgentsSetting` export와 내장 coding agent handle을 쓴다.
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/host-queue.ts`
  - `packages/protocol/coding-agent/harness-adapter.ts`
  - `packages/core/main/daemon/wiring/host-queue.ts`
  - `packages/core/main/daemon/wiring/host-queue_test.ts`
  - `packages/core/host-queue/`
  - `packages/cli/commands/tab.ts`
  - `packages/cli/commands/team.ts`
  - `packages/cli/commands/call.ts`
  - `packages/shell/renderer/workspace/use-surface-requests.ts`
  - `packages/shell/renderer/workspace/kinds/terminal.tsx`
  - `packages/shell/renderer/shell/agent-sections.tsx`
  - `packages/coding-agent/skills/lophn-agent.ts`
  - `packages/core/agent-workspaces/prompts/`
- 읽을 것:
  - `project-docs/plan/coding-agent-handoff/README.md`의 "정한 것"
  - architecture: `project-docs/architecture/workspace-layout.md`("agent가 연 탭"), `project-docs/architecture/coding-agent.md`(TUI 열기 요청, adapter), `project-docs/architecture/terminal-agent.md`(사람 터미널의 coding agent)
  - flow: `project-docs/flows/areas/harness.yaml`의 `host-tab-open`, `harness-tui-open`, `host-queue-poll`; `project-docs/flows/areas/shell-workspace.yaml`의 `agent-tab-request`
- 계약:
  - 쓰는 것: `codingAgentsSetting`(`packages/core/config/mod.ts`), `HARNESS_ADAPTERS`
  - 내놓는 것: `tabs/open` target `{coding: {harness: <harness id>, handoff: <글>}}`, tab_open payload의 `handoff: {harness, file} | null`(`resume` 옆), adapter의 첫 prompt 인자 꼴, CLI `lophn tab open --coding <harness> --handoff <글> [--place]`

## 할 일

1. adapter: `harness-adapter.ts`의 adapter 항목에 TUI 첫 prompt 인자 꼴(예: `session.prompt: ["{prompt}"]`, opencode는 `["--prompt", "{prompt}"]`)을 더한다. 그 CLI의 지금 판이 실제로 받는 꼴만 적는다(설치된 CLI의 `--help`로 확인. 확인 못 한 adapter는 비워 두고 보고). 없는 adapter는 handoff 대상이 아니다.
2. protocol: `host-queue.ts`의 `hostTabTargetSchema`에 `{coding: {harness, handoff}}`를, `tabOpenPayloadSchema`에 `handoff: {harness, file} | null`을 더한다. handoff 글 크기 상한을 둔다(예: 64 KiB).
3. core(`wiring/host-queue.ts`의 `createTabHandlers.open`): agent 자격만 받는다(사람 token은 `invalid_input`, session·tui와 같다). 부른 session의 workspace가 project가 아니면 `invalid_input`(home·앱은 터미널이 없다). harness가 `shell.coding_agents.favorites`에 없거나 adapter에 첫 prompt 꼴이 없으면 `invalid_input`이고 message에 열 수 있는 harness id를 싣는다. 통과하면 글을 `<data root>/handoffs/<tab>.md`(0600, 폴더 0700)에 쓰고 tab_open(`target {coding}`, `handoff {harness, file}`, owner는 부른 session)을 넣는다. session·hold는 만들지 않는다. 쓰기는 이미 있는 fs 인자 길을 쓴다(AGENTS.md "코드": 파일 시스템은 인자로 받는다).
4. renderer(`use-surface-requests.ts`): `coding` 요청이면 이 창의 project에 터미널 탭을 연다(`openTerminal`의 `command`). 명령은 사람의 즐겨찾기 명령(`agent-sections.tsx`의 `codingCommand`, 사람이 고친 명령 포함) 뒤에 adapter의 첫 prompt 인자를 붙인다. prompt는 lophn이 정한 영어 한 줄 고정 글과 file path뿐이다: `Read the handoff at <path> and continue the work it describes.` agent가 쓴 글은 터미널에 치지 않는다. path와 고정 글은 큰따옴표로 감싸고, path에 큰따옴표·`$`·backtick·`\`·줄바꿈이 있으면 열지 않고 ack하지 않는다. 터미널 통로가 없거나 명령이 없으면 지금처럼 ack하지 않아 main이 되돌린다.
5. CLI(`tab.ts`): `--coding <harness>`와 `--handoff <글>`(둘이 짝이다)을 더하고 `given` 검사와 help를 고친다. help는 "사람이 이어서 볼 handoff는 이것으로 TUI 탭에 연다. 사람 손이 필요 없는 일회성 일은 `lophn team spawn <handle>`로 headless로 보낸다"를 말한다.
6. 지침:
   - `packages/core/agent-workspaces/prompts/project.md`: coding agent에게 일을 넘기는 기준 한 단락. 사람이 이어서 만질 일(handoff, 같이 디버깅) → `lophn tab open --coding <harness> --handoff <글>`. 결과만 받으면 되는 일회성 일 → `lophn team spawn <handle> --body <글>`(내장 coding agent handle `claude`·`codex`·`opencode`가 "Agents you can call"에 있을 때). handoff 글은 다른 agent가 처음 읽는 글처럼 목표, 지금까지 안 것, 다음 할 일을 담는다.
   - `home.md`·`app.md`: 터미널이 없으니 headless만 된다는 한 줄(필요하면).
   - `packages/coding-agent/skills/lophn-agent.ts`: "Hand work to another agent" 절에 같은 기준을 더한다(coding agent가 다른 coding agent에게 넘길 때).
   - `team.ts`·`call.ts` help: TUI handoff는 `tab open --coding`이라는 한 줄.
7. 바뀐 이름·문구를 grep해 주석과 기대값(`tests/` 포함)을 맞춘다.

## 끝남

- `npm run check:full`이 통과하고 `node packages/shell/renderer/build.ts`가 된다.
- 위험 test(`wiring/host-queue_test.ts`):
  - "사람 token, project가 아닌 session, 즐겨찾기에 없는 harness의 coding handoff는 invalid_input이고 file도 요청도 남지 않는다"
  - "받은 handoff는 data root `handoffs/`에 0600으로 쓰이고 tab_open payload에는 글이 아니라 file path만 있다"
- 남지 않음: renderer가 터미널에 치는 줄에 handoff 글 자체가 들어가는 길이 없다(diff로 확인).

## 보고

[brief-template.md](../../../../.claude/skills/orchestrate/brief-template.md)의 "보고" 꼴. 확인한 CLI 판과 첫 prompt 꼴을 적는다.
