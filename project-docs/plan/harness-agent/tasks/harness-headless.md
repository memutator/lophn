# harness-headless

shell host가 harness 입력함의 입력을 그 harness의 headless CLI 명령으로 실행하고, 구조 출력을 lophn session 기록으로 옮긴다.

- 단위: harness (wave 2)
- 선행: harness-core.
- 소유(이 task만 고친다):
  - `packages/protocol/coding-agent/harness-adapter.ts`(+test), 새 `packages/protocol/coding-agent/headless/**`(parser, 권한 표, fixture)
  - 새 `packages/shell/main/harness/**`(설정이 켜졌을 때만 dynamic import), shell main 조립 file 하나
  - `tools/check-deps.ts`(새 folder 규칙)
- 읽을 것:
  - architecture: `project-docs/architecture/coding-agent.md`, `terminal-agent.md`
  - 사실: 각 CLI의 `--help`(`claude -p`의 `--output-format stream-json`·`--session-id`·`--resume`·`--permission-mode`·`--disallowedTools`, `codex exec`의 `--json`·`-o`·`exec resume`·`-C`·`-s`, `opencode run`의 `--format json`·`--session`·`--standalone`)
  - 제품 결정: 계획 README 정한 것 4~6
- 계약:
  - 쓰는 것: `harness-core`의 host route
  - 내놓는 것: `HARNESS_ADAPTERS[*].headless {command, args(prompt, sessionId, cwd), permissions(table)}`

## 할 일

1. `HARNESS_ADAPTERS`에 `headless` 칸(claude-code, codex, opencode). parser는 순수 함수다: 구조 출력 → 메시지 글, `harness_tool` part, 외부 session id, 끝.
2. 권한 표(정한 것 5): 정의의 deny → disallow flag, 전부 허락 flag는 쓰지 않는다. 표에 없는 harness는 띄우지 않는다.
3. host: 입력을 꺼내 받은 block을 prompt로(이미지는 harness가 받는 꼴이 없으면 글 자리 표시) 실행한다. cwd는 session의 place 폴더. 외부 session id가 있으면 resume. 멈추면 process를 죽이고 turn을 끊긴 것으로 끝낸다.
4. spawn env: harness가 자기 API key를 써야 하므로 `childCliRunner`의 이름 거르기를 쓰지 않는다. lophn의 user token은 넣지 않는다.
5. fixture: 실제 녹화가 허락되기 전에는 각 CLI 문서로 만든 fixture이고 test 이름에 그렇게 적는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "parser가 fixture에서 메시지, tool part, session id, 끝을 낸다"(harness마다)
  - "권한 표는 deny를 disallow로 옮기고 전부 허락 flag를 내지 않는다"
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 실제 harness를 띄우는 test는 만들지 말고 적는다.
