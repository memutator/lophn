# dt-mcp-harness

lophn이 띄우는 coding agent가 core의 MCP endpoint(`dt-mcp-endpoint`)를 쓰도록 harness마다 설정을 session 시작 때 넣는다. 사람의 전역 설정(`~/.claude.json`, `~/.codex/config.toml` 등)은 쓰지 않는다. 설정은 그 session의 실행 계획(`argv`, `env`)에만 실리고 token 원문은 계획의 env `LOPHN_CODING_TOKEN`에만 있다.

- 단위: domain-tools (wave 3)
- 선행: dt-mcp-endpoint
- 소유(이 task만 고친다):
  - `packages/protocol/coding-agent/harness-adapter.ts`
  - `packages/protocol/coding-agent/mcp-launch.ts`(새 file)
  - `packages/protocol/coding-agent/mod.ts`
  - `packages/core/apps/tickets/coding/relay.ts`
  - `packages/core/main/daemon/wiring/coding-sessions.ts`
  - `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`
  - `packages/coding-agent/guides/skills/lophn-repair/SKILL.md`
- 읽을 것:
  - architecture: `project-docs/architecture/coding-agent.md`("token 원문은 저장하지 않는다", "skill과 hook은 harness의 사용자 전역 설정에 한 번 놓고 놓기 전에 사람에게 묻는다", "coding agent의 권한 mode는 lophn이 정하지 않는다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `coding-agent-harness-api`, `coding-agent-cli-interface`, `project-docs/module-catalog.yaml`의 `packages/coding-agent`, `packages/core/apps`
  - 계획: `project-docs/plan/domain-tools/README.md`의 "coding agent MCP endpoint"(harness가 이 endpoint를 쓰게 하는 설정은 harness마다 정한다)와 "같이 도는 계획" 표(`packages/coding-agent/*`는 `domain-place`도 고친다. skill에는 MCP 문단만 더한다)
  - 지금 코드: `packages/protocol/coding-agent/launch-plan.ts`의 `launchPlanOf`(argv 조립. prompt는 argv의 한 인자), `packages/core/apps/tickets/coding/relay.ts`의 `open()`(commit 뒤 token을 만들어 `plan.env`에 담는다), `packages/core/apps/tickets/coding/launch.ts`의 `openSession`(계획을 짜는 곳. core의 port를 모른다), `packages/shell/terminal-host/launch-plan.ts`(계획을 PTY 인자로 바꾼다. `plan.env`는 상속 환경 위에 얹힌다)
- 계약:
  - 쓰는 것: `CODING_MCP_PATH`, `CODING_MCP_SERVER_NAME`(`dt-mcp-endpoint`의 `packages/protocol/coding-agent/mcp.ts`), `CODING_TOKEN_ENV`(`packages/protocol/coding-agent/token.ts`)
  - 내놓는 것: `withCodingMcp(plan, url)`(순수 함수. 계획에 harness별 MCP 설정을 더해 새 계획을 돌려준다. 지원하지 않는 harness는 그대로)

## harness별 결정

url은 core가 열린 port로 만든 `http://127.0.0.1:<port>/mcp`(`CODING_MCP_PATH`)이고 server 이름은 `lophn`이다. 이 컴퓨터에 설치된 판(Claude Code 2.1.303, Codex 0.161.0, OpenCode 1.18.35)으로 확인한 것과 확인 못한 것을 구분해 적는다.

| harness | 방법 | 확인 |
|---|---|---|
| Claude Code (`claude`) | argv 끝(prompt 뒤)에 `--mcp-config <JSON 문자열>`을 더한다. JSON은 `{"mcpServers":{"lophn":{"type":"http","url":"<url>","headers":{"Authorization":"Bearer ${LOPHN_CODING_TOKEN}"}}}}`다. `--strict-mcp-config`는 쓰지 않는다(사람이 이미 쓰는 MCP server를 지우지 않는다) | `--mcp-config <configs...>`는 variadic이라 뒤에 오는 positional을 config 파일로 삼킨다(확인함: `mcp list`가 파일 이름으로 읽혔다). 그래서 prompt가 먼저이고 이 flag가 맨 끝이다. 확인 못함: 인라인 JSON의 header에서 `${LOPHN_CODING_TOKEN}`이 환경 변수로 풀리는지. 이 task가 `https://code.claude.com/docs/en/mcp`의 환경 변수 확장 절을 읽고 확인한다. 풀리지 않으면 token을 argv에 넣지 말고(argv는 `ps`에 보인다) 보고에 적어 멈춘다 |
| Codex (`codex`) | prompt 앞(model flag 앞)에 `-c`, `mcp_servers.lophn.url="<url>"`, `-c`, `mcp_servers.lophn.bearer_token_env_var="LOPHN_CODING_TOKEN"`을 더한다. token은 env 이름만 참조한다 | 확인함: `codex mcp add --url --bearer-token-env-var`가 `config.toml`에 `[mcp_servers.lophn] url=…, bearer_token_env_var=…`를 쓴다(임시 `CODEX_HOME`으로). `-c key=value` override가 이 키에 먹는지는 확인 못함(`codex mcp get lophn -c …`로 본다) |
| OpenCode (`opencode`) | 계획 env에 `OPENCODE_CONFIG_CONTENT`를 더한다. 값은 `{"mcp":{"lophn":{"type":"remote","url":"<url>","headers":{"Authorization":"Bearer {env:LOPHN_CODING_TOKEN}"}}}}`이다. argv는 바꾸지 않는다 | 확인함: 이 값으로 `opencode mcp list`가 server를 읽고 요청에 `Authorization: Bearer <env 값>`을 실어 보낸다 |
| Gemini CLI, pi, Hermes, OpenClaw | 연결하지 않는다 | Gemini: MCP는 `settings.json`에서만 정하고(per-session flag·env를 확인 못함) 쓰려면 앱 source 폴더나 사람의 전역 설정에 파일을 써야 한다. pi: MCP 지원이 없다. Hermes·OpenClaw: 맡길 수 없는 제품이다 |

`plan.env`는 PTY의 상속 환경 위에 얹히므로 OpenCode는 사람이 `OPENCODE_CONFIG_CONTENT`를 이미 쓰고 있으면 이 값이 그것을 덮는다. 알려진 한계로 둔다.

## 할 일

1. `harness-adapter.ts`의 표에 harness마다 `mcp` 칸(`"argv_after_prompt" | "argv_before_prompt" | "env" | null`)을 두고 위 표대로 채운다.
2. `mcp-launch.ts`: `withCodingMcp(plan, url)`을 순수 함수로 만든다. `launchPlanOf`가 만든 계획의 argv·env를 harness별로 위치에 맞게 바꾸고 `codingLaunchPlanSchema`로 다시 검증한다. 지원하지 않는 harness는 계획을 그대로 돌려준다. token 값은 이 함수가 받지 않는다(env 이름 `CODING_TOKEN_ENV`만 쓴다). `mod.ts`에서 내보낸다.
3. `relay.ts`: `open()`이 token을 `plan.env`에 담을 때 `deps.mcpUrl()`이 url을 주면 `withCodingMcp`를 적용한다. `CodingRelayDeps`에 `mcpUrl(): string | null`을 더한다. `coding-sessions.ts`는 `ctx.server.port`로 만든다(server는 relay보다 늦게 열리므로 호출 때 읽는다. 열리지 않았으면 `null`이라 MCP 없이 띄운다).
4. 두 skill의 해당 절에 두세 줄을 더한다: build-app 9번(preview 확인), repair 7번(preview). 내용은 "harness에 MCP server `lophn`이 연결돼 있으면 preview를 연 뒤 이 앱의 tool을 MCP로 부를 수 있다. preview가 없으면 `unavailable`이다. 운영 앱은 부를 수 없다. MCP가 안 보이면 `lophn app preview start` 뒤 harness에서 MCP를 다시 연결한다".
5. 확인 못한 두 가지(Claude의 header 환경 변수 확장, Codex의 `-c` override)를 실제로 확인하고 결과를 보고에 적는다. model provider를 부르는 확인은 하지 않는다(AGENTS.md "사람에게 묻는 것"). `claude`·`codex`를 model 호출까지 가게 실행하지 말고, config를 읽는 하위 명령이나 잘못된 경로 오류 문구처럼 호출 전에 끝나는 확인만 쓴다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 — 계획 조립은 순수 변환이고 token 원문은 이 함수가 받지 않는다. 사람의 전역 설정을 쓰지 않는 것은 구조(계획의 argv·env만 바꾼다)가 지킨다.
- 남지 않음: `grep -rnE "\.claude\.json|config\.toml|settings\.json" packages/protocol/coding-agent/mcp-launch.ts packages/core/apps/tickets/coding`가 0줄이다(전역 설정 file을 쓰는 코드가 없다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것: 확인한 것과 확인 못한 것(위 표 갱신)
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: Gemini CLI, pi는 MCP로 붙지 않는다. 사람의 `OPENCODE_CONFIG_CONTENT`가 덮인다. harness의 MCP tool 권한 물음은 터미널 탭에서 사람이 답한다
