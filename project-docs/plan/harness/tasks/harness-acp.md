# harness-acp

shell host가 ACP client로 harness를 ACP process로 띄우고, session update를 lophn session 기록으로 옮기고, 권한 요청을 lophn이 판정한다.

- 단위: harness (wave 4)
- 선행: harness-reply.
- 소유(이 task만 고친다):
  - `packages/shell/main/harness/acp/**`
  - root `package.json`, `package-lock.json`(`@agentclientprotocol/sdk`, `@agentclientprotocol/claude-agent-acp`, `@agentclientprotocol/codex-acp`, 판 정확히 고정)
  - `packages/core/main/daemon/wiring/`의 harness wiring(권한 판정 route), `tools/check-deps.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/approval.md`(judge, turn mode)
  - 사실: ACP method(`initialize`, `session/new|load|resume|prompt|cancel`, `session/update`, `session/request_permission`), turn 끝은 `session/prompt` 응답의 `stopReason`. OpenCode는 `opencode acp`, Claude와 Codex는 adapter
  - 제품 결정: 계획 README 정한 것 7, 8
- 계약:
  - 쓰는 것: `harness-core`의 host route, `harness-reply`의 turn 자격
  - 내놓는 것: route `HarnessJudge {session, kind, target}` → allow | deny | ask

## 할 일

1. host: ACP process를 띄우고(OpenCode는 `opencode acp`, 둘은 고정한 adapter) stdio로 말한다. update를 메시지와 `harness_tool` part로 옮긴다. content block은 lophn block과 ACP block 사이를 옮긴다(이미지는 blob을 읽어 base64).
2. 권한: `request_permission`의 kind를 gate 종류로 옮겨 `HarnessJudge`로 묻는다. deny는 늘 막고, `ask`는 대화 화면에 묻는다(사람 없는 turn이면 거절).
3. 구독 막기(`--hide-claude-auth`)는 우회하지 않는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "ACP kind → gate 종류 표와 deny가 늘 막는 것"
  - "녹화 또는 문서 transcript에서 update → 기록 대응"
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 가짜 ACP agent를 띄우는 test는 만들지 말고 적는다.
