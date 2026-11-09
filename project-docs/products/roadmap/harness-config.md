# harness-config: MCP, skill, 권한, 지침 설정을 일반 harness 꼴로

상태: 단계 1, 2, 6, 8은 계획 `skill-share`로 구현했다(2026-11-02, 변경 기록 `project-docs/products/change-log/0.15/app-skills-shared-by-assignment.yaml`). 남은 단계는 3(MCP 칸 꼴), 4(project 층을 repo `.lophn/settings.json`으로), 5(권한 규칙 일반화), 7(가져오기)이고, 아직 계획으로 열지 않았다. 아래 "지금"과 단계 본문은 이 roadmap을 연 때 코드를 적은 것이라 구현한 단계의 현재 모습은 `project-docs/architecture/{agent-definition,approval,app-call,coding-agent}.md`다.
2026-11-01 사람이 "MCP, skill, permissions 설정이 일반 coding agent harness와 너무 다른 규격 같다. 최대한 비슷한 방향으로 고치는 roadmap을 열라"고 했다.
2026-11-02 command-surface 뒤에 앱 skill 공유(단계 8)를 여기에 합쳤다. 앱이 내놓은 command를 다른 agent가 알 길이 없었다: lophn agent의 workspace 정보에는 자기 앱의 command만 실리고, coding agent에게는 아무 길이 없다. 사람: "다른 agent가 쓸 수 있어야 한다고 사람이 판단하면 skill로 만들고, 필요한 agent에게 주고, CLI가 바뀌면 갱신한다. 앱을 짓는 agent는 그것을 제안할 수 있어야 한다".
조사: `research_notes/harness-config-comparison/README.md`. Claude Code, Codex, OpenCode, Hermes, omp를 같은 틀로 비교했고, harness마다 note가 따로 있다.
배경 문서: `project-docs/architecture/agent-definition.md`, `project-docs/architecture/approval.md`, `project-docs/architecture/workspace-session.md`, 열린 이슈(`node tools/records.ts issues --topic agent-definition`, `node tools/records.ts issues --topic workspace-session`).

## 왜

- 사람이 이미 쓰는 설정을 lophn에서 그대로 못 쓴다.
  - MCP server README의 `{"mcpServers": {"github": {"command": "npx", …}}}` 조각을 붙일 수 없다. lophn은 이름을 담은 배열을 쓰고, `stdio.executable`에 절대 path를 넣어야 하고, env를 `{value}`로 감싸야 한다.
  - repo에 lophn skill을 둘 자리가 없다.
  - Claude skill 중 `description: >`처럼 쓴 것은 말없이 빠진다.
- project 설정이 repo가 아니라 `~/.lophn/projects/<prj_id>/extensions.json`에 있다. repo와 같이 다니지 않고, 사람은 그 파일이 어디 있는지 모른다.
- 할당(agent가 쓸 앱과 뺀 tool)은 ledger 표 `agent_assignments`라 손으로 보거나 고칠 수 없다.
- MCP tool은 묻게 하거나 규칙으로 막을 수 없다. `mcp_off`로 숨기기만 한다. 다섯 harness는 모두 tool 이름으로 막거나 묻게 할 수 있다.

## 지금

`research_notes/harness-config-comparison/lophn.md`를 줄인 것이다.

| 무엇 | 자리 | 꼴 |
|---|---|---|
| 전역 MCP, skill 폴더, 끈 skill, shell 규칙 | `~/.lophn/settings.json` | 평평한 key 20개. `lophn-agent.extensions.mcp_servers`, `lophn-agent.extensions.skill_folders`, `lophn-agent.extensions.skills_off`, `approvals.shell_rules` |
| project MCP, 끈 skill, `mcp_off` | `~/.lophn/projects/<prj_id>/extensions.json` | `{mcp_servers[], skills_off[], mcp_off[]}`(`packages/core/lophn-agent/extensions/project-settings.ts`) |
| project shell 규칙 | `settings.json` `approvals.shell_rules.projects.<prj_id>` | `{pattern, action}` 배열(`packages/protocol/approvals/shell-rules.ts`) |
| agent 정의 | `~/.lophn/agents/<agt_id>.md` | YAML frontmatter `name, profile, model, skills_off, mcp_off, mcp_servers, apps, permissions, skip`와 본문 |
| 할당 | ledger `agent_assignments` | `[{app, removed_tools[]}]`(`packages/core/approvals/assignment/schema.ts`) |
| 지침 | `~/.lophn/LOPHN.md`, 첫 project 폴더의 `LOPHN.md`, agent 본문 | 이어 붙인다. `AGENTS.md`는 안 읽는다(`architecture/agent-definition.md`의 지침 파일 규칙) |
| skill | 내장 8개, 등록 폴더, `~/.lophn/skills`, workspace 폴더의 `.lophn/skills`, 그릇 자리의 `skills/`(workspace-data) | `SKILL.md`, 줄 단위 parser(`packages/core/lophn-agent/extensions/skills.ts:66-135`) |
| credential | `~/.lophn/secrets.json`(0600) | 이름 → 값. MCP 설정은 `{secret: "mcp.…"}`로 가리킨다 |

그 밖에 고칠 것:
- `settings.json`에서 key 하나가 틀리면 파일 전체를 버린다(`packages/core/config/store.ts:105`). 손으로 고치는 일이 늘면 오타 하나에 설정 전체가 앞 값으로 돌아간다.
- remote MCP OAuth는 사람이 발급자와 client id를 넣어야 한다. 동적 client 등록이 없다(`packages/core/lophn-agent/extensions/mcp-oauth.ts`).
- data root 밖 파일 migration 장치 `dataSteps`(`packages/core/main/daemon/wiring/context.ts:144`)는 있지만 쓴 wiring이 없다. 이 일이 처음 쓴다.

## 목표 꼴

```
~/.lophn/                              user 층(data root, 지금과 같다)
  LOPHN.md                             전역 지침. 없으면 CLAUDE.md
  settings.json                        mcpServers, permissions, skills + 지금의 shell.* 화면 설정
  skills/<name>/SKILL.md               지금과 같다
  agents/<agt_id>.md                   agent 정의. 할당(apps, permissions)이 이 파일로 온다
  secrets.json                         지금과 같다
<project 폴더>/                         project 층(첫 등록 폴더. 폴더가 없으면 ~/.lophn/projects/<prj_id>/)
  LOPHN.md                             project 지침. 없으면 CLAUDE.md
  .lophn/settings.json                 mcpServers, permissions, skills(지금 extensions.json과 project shell 규칙)
  .lophn/skills/<name>/SKILL.md        repo skill
~/.lophn/apps/<app>/source/            앱 workspace: .lophn/skills를 같은 규칙으로 읽는다. 공유 skill의 원본(단계 8)
```

MCP 한 칸은 Claude `.mcp.json`과 같은 꼴이다. Claude, Codex, Hermes, omp 넷이 `command`·`args`·`env`와 `url`·`headers`를 같은 뜻으로 쓴다.

```json
{
  "mcpServers": {
    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"],
                "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" } },
    "linear": { "type": "http", "url": "https://mcp.linear.app/mcp" }
  },
  "permissions": {
    "allow": ["shell.run(npm run *)"],
    "ask":   ["shell.run(git push *)", "mcp__github__create_pull_request"],
    "deny":  ["mcp__github__delete_repo", "lophn(calendar delete-event *)"]
  }
}
```

## 단계

각 단계는 계획 하나이거나 계획 하나 안의 wave 하나다. 크기는 작음, 중간, 큼으로 적었다.

1. **지침 파일은 `LOPHN.md`이고, 없으면 `CLAUDE.md`다(작음).**
   - `~/.lophn`과 project 폴더에서 `LOPHN.md`를 읽고, 그 자리에 `LOPHN.md`가 없으면 `CLAUDE.md`를 읽는다. `AGENTS.md`는 읽지 않는다.
   - 앱 template의 `AGENTS.md`(`packages/core/apps/packages/template/app/AGENTS.md.tmpl`)는 lophn 앱 agent(지침이 읽으라고 한다)와 사람의 coding agent(`CLAUDE.md.tmpl`의 `@AGENTS.md`)가 같이 읽는 글로 다시 쓴다.
   - `LOPHN.md`를 옮기는 migration은 없다.
2. **skill(작음~중간).**
   - frontmatter를 진짜 YAML로 읽는다. agent 정의가 이미 쓰는 YAML parser를 쓴다.
   - project 폴더와 앱 source의 `.lophn/skills`를 발견 자리에 더한다. 내장, 등록 폴더, `~/.lophn/skills`, 그릇 자리의 `workspace-data`는 그대로다. `.agents/skills`, `~/.agents/skills`는 읽지 않는다.
   - agent 정의의 `skills`(받을 이름 목록)를 `skills_off`(끈 이름)로 바꾼다. 이것으로 이슈 `disabling-skill-drops-other-place`가 닫힌다.
3. **MCP 칸 꼴(중간~큼).**
   - `mcpServers.<name>` map으로 바꾼다. stdio는 `command`(PATH에서 찾는다)·`args`·`env`·`cwd`이고, remote는 `type: "http"`·`url`·`headers`다. 그 밖에 `enabled`와 timeout을 둔다.
   - 값 안의 `${NAME}`은 `secrets.json`의 `NAME`으로 푼다. stdio `env`에도 쓸 수 있다. process env는 읽지 않는다.
   - remote OAuth는 server가 알려 준다: 401의 resource metadata에서 발급자를 찾고, 동적 client 등록과 PKCE를 쓴다. 사람이 client id를 넣는 길도 남긴다.
   - agent 정의의 `mcp_servers`도 같은 꼴의 `mcpServers`가 된다.
4. **project 층을 repo로(중간).**
   - `<project 폴더>/.lophn/settings.json`이 project 층이다. `extensions.json`과 `approvals.shell_rules.projects`가 여기로 온다.
   - file tool은 `.lophn/settings.json`을 쓰지 못한다(`forbidden`). 사람은 Settings 화면에서 바꾼다. `.lophn/skills`는 agent가 쓰는 자리라 막지 않는다.
   - repo 파일에서 온 MCP server는 사람이 한 번 승인해야 띄운다. lophn 화면이 쓴 server는 쓸 때 승인된 것으로 둔다.
   - `settings.json`은 틀린 key만 버리고 나머지는 읽는다.
5. **권한 규칙(중간).**
   - `permissions.allow/ask/deny` 배열을 쓰고, 규칙은 `tool(specifier)` 꼴이다(Claude 꼴). tool 이름은 lophn 정본 이름이다: `shell.run(git push *)`, `mcp__github__delete_repo`, `mcp__github__*`. 명령(내장과 앱 command)은 shell 규칙처럼 argv 낱말로 쓴다: `lophn(calendar delete-event *)`, `lophn(release activate *)`. Claude의 `Bash(git push *)`와 같은 모양이다.
   - 규칙을 받는 것은 지금 gate가 있는 셋(shell, 앱 command, MCP tool)이다.
   - 평가 순서: 제품 floor deny, deny, ask, allow, 제품 ask, 그 밖은 run. 층(user, project, agent) 어디에 있든 deny가 이긴다. Claude, Codex, Hermes와 같다. 지금은 마지막에 맞은 규칙이 이긴다.
   - MCP tool도 `ask`와 `deny`를 받는다. 기본은 지금처럼 run이다(사람, 2026-10-21 "할당한 tool은 묻지 않는다"를 지킨다). `mcp_off`는 deny 규칙으로 흡수한다. deny인 tool은 목록에서도 뺀다.
   - "always"는 project workspace면 그 project의 `.lophn/settings.json`, 그 밖이면 `~/.lophn/settings.json`의 `permissions.allow`에 줄을 더한다. 지금 쓰는 층과 같다.
6. **할당을 agent 정의 파일로(중간).**
   - `agent_assignments`의 `{app, removed_tools}`를 agent 정의의 `apps`(할당한 앱)와 `permissions.deny`(뺀 command, 지금은 `lophn(<slug> <command>)` 꼴)로 옮긴다. 옛 ledger 표는 data step이 옮기며 지운다(schema step은 이미 적용한 ledger가 id를 기록해 남기고, 새 data root에는 빈 표가 남는다).
   - 할당은 그 앱의 public skill도 준다(단계 8).
   - agent 정의는 user → project 다음의 셋째 층이다. `mcpServers`, `permissions`, `skills_off`는 settings와 같은 꼴이고, 어느 층이든 deny가 이긴다. `apps`, `skip`, `profile`은 lophn에만 있다. harness는 agent가 하나라 "어디서"(층)로만 갈리고, lophn은 오래 사는 agent가 여럿이라 "누가"(정의)가 한 축 더 있다.
   - 이 두 칸도 `mcpServers`, `skip`처럼 사람만 쓴다. `agent.create`·`agent.update` 입력에 넣지 않는다.
   - Claude의 `tools`·`disallowedTools`, OpenCode의 agent `permissions`와 같은 자리다.
7. **가져오기(중간).**
   - Settings에 "Claude Code에서 가져오기"와 "Codex에서 가져오기"를 둔다. 누를 때 한 번 옮긴다(Codex `external-agent-migration`, `hermes import-agent`와 같은 길).
   - 옮기는 것:
     - MCP server: `~/.claude.json`, `.mcp.json`, `~/.codex/config.toml` `[mcp_servers]`.
     - skill: `~/.claude/skills`, `.claude/skills`, `~/.codex/skills`를 `~/.lophn/skills`나 project `.lophn/skills`로 복사한다.
     - `Bash(x)` 규칙은 `shell.run(x)`로 바꾼다.
   - credential 값은 가져오지 않는다. `env`에 값이 그대로 적힌 것은 `${NAME}`으로 바꾸고, 사람에게 Settings에서 넣으라고 보인다.

8. **앱 skill 공유(중간~큼).** 앱이 다른 agent에게 쓸모 있는 기능을 skill로 내놓고, 할당 하나로 알게 하고 부르게 한다.
   - 원본은 앱 source의 `.lophn/skills/<name>/SKILL.md`다. 그 앱의 lophn agent가 읽는다(단계 2). SKILL.md는 harness 공용 칸(name, description)만 쓴다. 본문에 `lophn <slug> <command>` 부르는 법과 결과 읽는 법을 쓴다.
   - 앱 template의 `.gitignore`는 지금 `.lophn/` 전체(SDK 설치 사본)를 뺀다. `.lophn/sdk/`만 빼도록 바꿔 `.lophn/skills`가 commit되게 한다. 이미 있는 앱은 skill을 처음 더할 때 앱 agent가 고친다(release 준비가 commit에 skill 폴더가 없으면 막아 알린다).
   - 선언 `lophn.ts`에 `skills: [{name, public, commands}]`를 둔다. `commands`는 그 skill이 부르는 이 앱의 command다. release 준비는 skill 폴더가 commit에 있는지, `commands`가 선언에 있고 public인지 본다. public skill이나 그 skill이 쓰는 command를 지우는 release는 `removed_public_tools`처럼 준비 결과에 드러난다.
   - release bundle이 public skill 폴더를 담는다. 공유되는 판은 active release의 것이라 HEAD의 작업 중 판은 새지 않고, activation이 곧 갱신이다.
   - 앱을 할당받은 agent는 그 앱의 public command를 부르고(지금과 같다), 그 앱 active release의 public skill을 skill 목록과 `skill.read`로 받는다. `skills_off`로 뺄 수 있다. 공유받은 skill을 적는 칸은 따로 두지 않는다. lophn agent에게는 사본을 만들지 않고 bundle을 바로 읽는다.
   - 앱 workspace의 agent가 skill을 쓰고 "이 앱을 A, B에게 할당" 요청을 명령으로 낸다. 사람이 대기 목록에서 한 번 승인하면 agent 정의의 `apps`에 들어간다. agent가 할당을 직접 쓰는 길은 없다(지금과 같다).
   - coding agent는 lophn 안에 정의가 없고 사람의 user token으로 부르므로 줄 것은 앎뿐이다. 승인 요청에서 coding agent에게도 줄지 고르고(harness별로 고르지는 않는다), 고른 앱 slug는 `~/.lophn/settings.json`의 `coding-agent.shared_apps`에 남는다. lophn hook을 설치한 harness마다 adapter의 전역 skill 폴더(`skill_dir`: Claude Code `~/.claude/skills`, Codex·pi `~/.agents/skills`, OpenCode `~/.config/opencode/skills`)에 사본을 둔다. core는 data root 밖을 쓰지 않으므로 `lophn harness` 쪽 코드가 core에서 공유 skill을 읽어 쓰고, shell main이 lophn 기동 때와 activation·설정 바뀜 때 부른다. session 시작 hook은 core를 부르지 않아 쓰지 않는다. lophn이 쓴 사본에는 표시 file을 두고 그것만 덮고 지운다.
   - 지침: `design-app`과 앱 template `AGENTS.md`(`packages/core/apps/packages/template/app/AGENTS.md.tmpl`)에 command가 다른 agent에게 `lophn <slug> <command>`로 보이고 `description`이 help가 된다는 것, 새로 만들 때와 바꿀 때 "이 기능이 다른 agent에게 쓸모 있나, 누구에게"를 묻고 쓸모 있으면 skill과 할당 요청을 내라는 것을 쓴다. `AGENTS.md`에 두는 것은 coding agent도 앱을 짓기 때문이다.

순서:
- 먼저 2·6·8을 한 계획으로 한다. 8은 2의 `.lophn/skills`와 `skills_off`, 6의 agent 정의 `apps`에 기댄다. 8을 ledger 할당 위에 먼저 만들고 6에서 옮기면 두 번 일이다. 6의 `permissions.deny`는 5 전이라 앱 command를 빼는 데만 쓴다.
- 그 다음 1, 5, 3·4, 7. 1·3은 서로 기대지 않는다. 4는 3의 꼴로 바로 쓴다. 5는 4의 파일 자리를 쓰고, 7은 3~5가 끝난 뒤다.

## 정한 것

- 앱 skill 공유는 할당에 붙인다. 앱을 할당받은 agent가 그 앱의 public skill도 받는다. agent 정의에 공유 skill 칸을 따로 두지 않는다. 따로 두면 아는 것과 부를 수 있는 것이 두 칸으로 갈라져 어긋난다. (사람, 2026-11-02)
- 공유 skill의 원본은 그릇 data 자리가 아니라 앱 source `.lophn/skills`이고 release와 같이 봉한다. CLI를 바꾸는 commit에 skill이 같이 들어간다. (agent)
- 지침 파일은 `LOPHN.md`, 없으면 `CLAUDE.md`다. `AGENTS.md`는 읽지 않고 `LOPHN.md`를 옮기는 migration도 없다. lophn은 본질적으로 coding agent가 아니다. (사람, 2026-11-02)
- project 설정과 skill은 project 폴더의 `.lophn/`에 둔다(`.lophn/settings.json`, `.lophn/skills`). 같은 이유로 공용 자리 `.agents/skills`, `~/.agents/skills`는 읽지 않는다. (사람, 2026-11-02. 공용 자리를 안 읽는 것은 agent)
- 정할 것 4~8은 추천대로 간다. (사람, 2026-11-02)
- lophn agent는 bundle을 참조하고 coding agent에게만 사본을 둔다. 사본은 동기화가 틀릴 길만 늘린다. coding agent는 자기 skill 폴더만 읽는다. (agent)
- 권한 규칙에서 명령은 `lophn(<낱말> *)` 꼴이다. shell 규칙과 같은 모양이고 command-surface의 argv와 같다. (agent)
- agent 정의는 user → project 다음의 셋째 층이고 칸 이름은 settings와 같다. (agent)

## 정할 것과 추천

1~3은 2026-11-02 사람이 정했다(위 "정한 것"). 2는 `architecture/approval.md`의 shell 규칙 층 문장(사람의 project 폴더에 두지 않는다, project workspace의 agent가 그 폴더를 file tool로 쓰기 때문이다)을 뒤집는다. 그 걱정은 보호 path로 막는다(단계 4). 남는 구멍은 `shell.run`이다. shell은 file 범위 밖이라 `.lophn/settings.json`을 쓸 수 있다. 이것은 이미 열린 이슈(`node tools/records.ts issues --topic workspace-session`)의 shell.run은 file 범위 밖과 같은 구멍이고, 그 이슈의 결정을 따른다. 4~8은 추천대로 간다.

4. **repo에서 온 MCP server 승인 단위.**
   - 추천: server 이름과 정의 hash로 한 번 승인하고, `~/.lophn/settings.json`에 둔다. 정의가 바뀌면 다시 묻는다. git pull로 승인한 이름의 command만 바뀌는 경우가 실제로 위험한 길이다.
   - Claude는 이름만 본다. 더 단순하게 가려면 이름만 본다.
   - `permissions`와 skill은 폴더를 등록한 것이 trust다. 폴더를 고른 사람의 행동이 Claude workspace trust 창과 같은 일을 한다.
5. **`${NAME}` secret의 이름 공간.**
   - 지금 MCP credential은 `mcp.`로 시작해야 하고, 접두 없는 이름은 앱 secret이다.
   - 추천: MCP 설정에서는 접두 없는 이름도 받고, `provider.`, `provider-oauth.`, `mcp-oauth.`, `app-oauth.`는 거절한다. 목적지 binding은 "그 이름을 가리키는 켜진 http server의 origin"으로 지금처럼 둔다.
   - 앱 secret과 이름이 겹칠 때 두 목적지를 다 허락할지는 계획에서 정한다.
6. **`settings.json`의 모양.**
   - 추천: `mcpServers`, `permissions`, `skills`를 top-level 절로 둔다(Claude, OpenCode와 같은 이름). `shell.*` 화면 설정은 지금 평평한 key 그대로 둔다. `mcpServers` 조각을 그대로 붙일 수 있어야 하는 것이 이유다.
   - 파일 형식은 JSON 그대로다. 다섯 사이에 모인 형식이 없다.
7. **project 폴더가 여럿일 때.**
   - 추천: project 층 파일(`LOPHN.md`나 `CLAUDE.md`, `.lophn/settings.json`, `.lophn/skills`)은 첫 등록 폴더에서만 읽는다. 지금 `LOPHN.md` 규칙과 같다. 여러 폴더를 다 읽는 것은 쓰는 사람이 생길 때 한다.
8. **`command`의 PATH.**
   - Electron을 dock에서 띄우면 PATH가 짧아 `npx`를 못 찾는다.
   - 추천: login shell의 PATH를 한 번 읽어 MCP child에 준다. lophn terminal이 쓰는 PATH와 같은 값을 쓴다.

## 위험 test

- agent의 file tool이 `.lophn/` 아래를 쓰지 못한다.
- 승인하지 않은 repo MCP server는 띄우지 않고, 정의가 바뀌면 다시 묻는다.
- 제품 floor deny는 어느 층의 allow로도 풀리지 않는다. deny는 ask와 allow보다 이긴다.
- `${NAME}` secret은 그것을 가리키는 server의 origin으로만 가고, `provider.*`와 `mcp-oauth.*`는 가리킬 수 없다.
- migration이 기존 MCP server, shell 규칙, `LOPHN.md`, 할당, `mcp_off`를 잃지 않고 새 자리로 옮긴다. 옮긴 뒤 같은 agent가 같은 tool을 보고 같은 판정을 받는다.
- 앱을 할당받지 않은 agent는 그 앱의 skill을 목록에서도 `skill.read`로도 받지 않는다. 비공개 skill은 할당이 있어도 받지 않는다.
- agent는 할당을 쓰지 못한다. 할당 요청은 사람의 승인 뒤에만 agent 정의에 들어간다.
- coding agent skill 사본은 lophn이 쓴 표시가 있는 것만 덮고 지운다.

## 하지 않는 것

- **다른 harness 전용 파일을 직접 읽기**(`.claude/`, `~/.claude.json`, `~/.codex/`). 직접 읽는 것은 omp(user 층은 기본 꺼짐)와 OpenCode(`.claude/skills`만)뿐이다. 직접 읽으면 무엇이 prompt에 들어가는지 모른다. 전용 자리는 가져오기로 옮긴다. 예외는 `LOPHN.md`가 없을 때의 `CLAUDE.md` 하나다(단계 1).
- **공용 자리 `AGENTS.md`, `.agents/skills`, `~/.agents/skills` 읽기.** lophn은 coding agent가 아니고 자기 자리 `.lophn/`을 쓴다.
- **`settings.local.json` 층과 관리자 층.** 한 사람이 쓰는 제품이다. `.local`은 다섯 가운데 Claude만 있다.
- **project 층 agent 정의(`.lophn/agents/`).** lophn agent는 workspace를 건너는 전역 agent이고 workspace는 session이 정한다(`architecture/workspace-session.md`). harness의 subagent와 하는 일이 다르다.
- **사용자 hook, 파일로 쓰는 command, plugin.** 쓰는 곳이 없다. Claude와 Codex는 command를 skill로 합쳤고, lophn `/` 메뉴는 이미 skill이다.
- **SSE transport, MCP resources·prompts.** SSE는 MCP spec에서 deprecated이고 Codex도 받지 않는다. resources와 prompts는 쓰는 곳이 생길 때 한다.
- **파일 tool의 path 규칙(`Edit(path)`).** file tool은 workspace 범위가 막고 쓰기는 rewind로 되돌린다(`architecture/approval.md`).
- **`Bash(...)` 같은 다른 harness tool 이름을 규칙에서 받기.** 가져오기가 옮긴다.
- **OS sandbox.** `roadmap/approval.md`의 "하지 않는 것"과 같다.
