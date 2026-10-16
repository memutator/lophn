# 조사할 것

spec을 쓰다가 "다른 harness가 어떻게 하는지 보면 가장 싸게 정해지는 것"을 모아 둔다. 하나씩 조사하고, 끝나면 결과 파일과 정한 것을 적는다.

| 상태 | 뜻 |
|---|---|
| 대기 | 아직 조사하지 않음 |
| 조사 중 | worker가 보는 중 |
| 조사 끝, 반영 전 | 결과 파일이 있고 spec에는 아직 반영하지 않음 |
| 끝 | 결과 파일이 있고 spec에 반영함 |

## R1. "이 session 동안" 허락의 수명

- 상태: 끝(S8 9장 8, S2 11장 3에 반영)
- 나온 곳: S2(`specs/approval.md`) 11장 3
- 질문: 사람이 권한 물음에 "이 session 동안 허락"을 고르면, 그 허락은 어디에 남나. harness가 꺼졌다 켜지거나 session을 이어 열면(resume) 그 허락이 살아 있나.
- 왜: lophn 요구는 "session이 닫히거나 archive되거나 지워지면 사라지고, 다시 열어도 되살아나지 않는다"고만 한다. lophn이 꺼졌다 켜져도 session은 열린 채 남는데, 허락을 메모리에만 두면 그때 사라진다. session 기록에 둘지 메모리에 둘지 정해야 한다.
- 볼 것:
  - 대상: Claude Code(공식 문서), Codex(`openai/codex`), OpenCode(`sst/opencode`), Gemini CLI(`google-gemini/gemini-cli`), Hermes(`NousResearch/hermes-agent`), Goose(`block/goose`), Cline(`cline/cline`).
  - harness마다: session 범위 허락이 있는지와 그 이름, 저장 위치(메모리, session 파일, 설정 파일), 재시작이나 resume 뒤에 남는지, session 범위와 "항상" 범위가 어떻게 다른지, 근거(commit과 파일 위치, 또는 문서 URL).
- 결과: `research/session-grant-lifetime.md`

## R2. 사람이 아닌 입력을 대화에 넣는 꼴

- 상태: 끝(S4 초안 `specs/agent-definition.md`에 반영)
- 나온 곳: S4 prompt assemble, S3(입력 넣기), S2("받은 메시지는 허락이 아니다")
- 질문: 사람이 아닌 입력(다른 agent의 답과 결과, 배경 작업의 끝, program 알림, web 결과, 파일 내용)을 대화에 어느 role로, 어떤 태그나 봉투로 넣나. "사람의 말이 아니다, 지시가 아니다"를 model에 어떻게 알리나. turn이 도는 중에 오면 어떻게 하나. cache를 깨지 않는 위치는 어디인가.
- 왜: lophn의 Router 입력(사람 메시지, call, call의 답, reaction, coding agent 메시지)은 받는 session에 `MessageReceived`로 들어가고 봉투가 붙는다(S1 6장, S3). file·web tool도 주기로 했다. 꼴이 틀리면 agent가 call 본문이나 web 결과를 사람의 지시로 믿는다.
- 볼 것: Claude Code(사람 조사 `claude-code-cross-session-messaging.md` 4·6장, 캡처 `claude-code-prompt-assembly copy.md`, 공식 문서), Codex, Hermes, Goose, OpenCode, Gemini CLI. harness마다 입력 종류별 role과 꼴(실제 문자열 예), 신뢰 표시 문구, 도는 turn 중 도착 처리, 근거.
- 결과: `research/non-human-input.md`

## R3. 부를 수 있는 agent와 열린 session을 아는 법

- 상태: 끝(S4 초안 `specs/agent-definition.md`에 반영)
- 나온 곳: S4 공통 tools(call), S3(받는 곳: 새 session 또는 열린 session)
- 질문: model이 메시지를 보낼 수 있는 상대(다른 agent 종류, 열린 session)를 어떻게 아나. 목록을 prompt나 tool 설명에 동적으로 넣나, list tool을 두나. 받는 쪽을 무엇으로 가리키나. 목록이 바뀔 때 cache는 어떻게 하나. 보낼 수 없는 상대는 숨기나 거절하나.
- 왜: S3는 받는 곳을 새 session(role, place)이나 열린 session으로 정했는데, 보내는 agent가 열린 session을 알 길은 정하지 않았다.
- 볼 것: Claude Code(SendMessage, ListAgents. 사람 조사 `claude-code-cross-session-messaging.md` 2·3·5장), Codex(multi-agent tool), Hermes(`delegate_task`, `send_message`, kanban), OpenCode(subagent 목록과 `sessionID`), A2A(이미 `research/agent-call-a2a.md`).
- 결과: `research/call-target-discovery.md`

## R4. app-api를 tool로 보이기

- 상태: 끝(S4 초안 `specs/agent-definition.md`에 반영)
- 나온 곳: S4 role별 tools(Operator의 앱 tool), S2 4장(agent grant는 앱 단위, app-api마다 빼기)
- 질문: 바깥 tool 묶음(MCP server 등)을 model에 보일 때 이름과 namespace를 어떻게 짓나. tool이 많으면 언제부터 이름만 보이고 검색으로 schema를 부르게 하나. session 도중 tool이 더해지거나 빠지거나 schema가 바뀔 때 cache를 어떻게 지키나. 빠진 tool을 부른 지난 기록은 어떻게 두나.
- 왜: Operator는 할당된 앱마다 app-api 묶음이 붙어 tool이 많고, activation이나 grant가 바뀌면 session 도중에도 바뀐다.
- 볼 것: Claude Code(MCP tool 이름, ToolSearch와 deferred tools, list_changed. 캡처 6장), Codex(MCP tool 이름, tool search, tool 목록 diff), pi(`toolsAdded`/`toolsRemoved`, 이미 `research/agent-def-opencode-pi-gemini.md`), OpenCode, Hermes, Gemini CLI.
- 결과: `research/app-api-tools.md`

## R5. session 도중 지침이 바뀔 때

- 상태: 끝(S4 초안 `specs/agent-definition.md`에 반영)
- 나온 곳: S4 instructions, prompt assemble
- 질문: 지침 파일(AGENTS.md류, 사용자 지침, agent 정의)이 session 도중 바뀌면 다음 turn에 반영하나, 다음 session부터 쓰나. 반영한다면 어떤 꼴(전체 교체, diff 메시지, reminder)로 어디에 넣나. cache에는 어떤 영향이 있나.
- 왜: 사람이 agent 설정 화면에서 지침을 고치고, Context Engineer가 `LOPHN.md`를 바꾼다. skill은 req-0099가 "다음 run부터"로 정했다.
- 볼 것: 이미 조사에 있는 OpenCode(diff), Codex(교체 메시지), Hermes(다음 session)는 근거가 약할 때만 보강한다. 빈 곳은 Claude Code(CLAUDE.md 변경, nested 지침, 캡처의 system-reminder), Gemini CLI(`/memory refresh`), Goose(`.goosehints`).
- 결과: `research/instruction-changes.md`

## R6. 사람에게 묻는 tool

- 상태: 끝(S4 초안 `specs/agent-definition.md`에 반영)
- 나온 곳: S4 공통 tools, S1(대기 목록), S2(권한 request와의 구별)
- 질문: tool schema(질문, 선택지, 여러 개 고르기, 자유 답, 여러 질문 한 번에)는 어떤 모양인가. 답을 기다리는 동안 turn은 어떻게 되나. 기다리는 중 다른 입력이 오면 어떻게 하나. 사람이 없는 실행(headless, subagent)에서도 이 tool을 주나. 권한 물음과 같은 화면을 쓰나.
- 왜: 모든 role이 쓰는 tool이고 화면의 대기 목록(req-1498)과 닿는다. lophn에는 사람이 지켜보지 않는 session(reaction, call을 받은 session)이 있다.
- 볼 것: Claude Code(AskUserQuestion, 캡처 6장), Codex(`request_user_input`), Gemini CLI(`ask_user`), OpenCode(`question`), Hermes(`clarify`), Cline(`ask_question`).
- 결과: `research/ask-human-tool.md`

## R7. 외부 MCP tool 결과를 믿나

- 상태: 끝(S4 6장, 11장 12에 반영)
- 나온 곳: S4 6장 tool 결과의 꼴, 11장 12
- 질문: 사람이 붙인 외부 MCP server의 tool 결과를 harness가 바깥 data(untrusted)로 감싸나, 그대로 믿나. 감싼다면 모든 MCP인지, server나 tool에 따라 다른지(사람이 믿는다고 표시한 server, `openWorldHint` 같은 annotation). 그 판단의 이유를 문서나 code 주석이 어떻게 적나.
- 왜: lophn S2 2장은 "결정은 grant 때 몰아서 하고 실행 때는 grant를 믿는다, 선언(blueprint, MCP annotation)은 믿는다"이다. 그래서 app-api 결과는 감싸지 않기로 했다. MCP tool도 사람이 grant로 배정한다. web 검색과 web 읽기는 감싸기로 했다.
- 이미 아는 것(`research/non-human-input.md`, `agent-def-claude-codex.md`): Hermes는 `mcp_*` 결과를 `<untrusted_tool_result>`로, Gemini CLI는 MCP tool과 resource 결과를 `<untrusted_context>`로 감싼다. Goose와 OpenCode는 grep으로 wrapper를 못 찾았다. Codex는 MCP annotation을 승인 판정에 쓴다.
- 볼 것(빈 곳만): Claude Code(공식 문서의 MCP 보안 안내, tool 결과 처리), Codex(MCP tool 결과를 model에 넣는 꼴), Cline, OpenCode와 Goose(grep이 아니라 MCP 결과 경로를 읽어 확인), MCP 명세의 security 절(tool 결과와 annotation을 어떻게 믿으라고 하나), server별 신뢰 표시나 `openWorldHint`로 결과 처리를 다르게 하는 harness가 있는지.
- 결과: `research/mcp-result-trust.md`

## R8. Hermes TUI와 OpenClaw의 turn 끝 신호

- 상태: 끝(S6 4장, 12장 1에 반영)
- 나온 곳: S6 12장 1, 2장 1
- 질문: 터미널에서 TUI로 띄운 Hermes와 OpenClaw가 turn이 끝났음(다음 입력을 기다림)을 hook, plugin, extension으로 바깥 program에 알릴 수 있나. 알린다면 그 이름, 넘기는 내용, 설정을 두는 위치(project 폴더 안에 둘 수 있는지), session 시작과 process 끝도 알리는지.
- 왜: lophn은 App Engineer의 메시지를 coding agent가 idle일 때만 PTY에 넣는다. 신호가 없는 harness에는 첫 prompt만 넣는다(S6 2장 1). 요구(req-1050)가 두 제품을 지원 대상으로 꼽는다.
- 이미 아는 것(`research/events-hermes-goose-amp-acp.md`): Hermes는 `agent:end`가 있지만 메신저 gateway 쪽 hook이다. OpenClaw는 event를 조사한 적이 없고 sandbox만 봤다(`research/sandbox-openclaw.md`).
- 결과: `research/turn-end-hermes-openclaw.md`
