# gui-opencode

OpenCode adapter. `opencode acp`를 stdio로 띄워 표준 Agent Client Protocol로 대화하고, 그것을 lophn ACP로 옮긴다. 표준 protocol은 이 adapter 안에서만 쓴다.

- 단위: gui (wave 3)
- 선행: gui-claude. adapter 꼴과 ACP 옮기기를 그 task의 claude adapter에 맞춘다.
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/opencode.ts`(새 file)
  - `packages/shell/main/extensions/bundled/harness-gui/opencode_test.ts`(새 file)
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/opencode/`(새 폴더)
- 읽을 것:
  - 계획: `project-docs/plan/harness-gui/README.md`의 정한 것 1, 2, 6
  - 근거: `/home/pyosechang/projects/harness-lab/cli-to-gui-report.md` §1.4(Emdash가 `opencode acp`에 붙는 법), lab의 `open-code/`(acp 하위 명령 구현)
  - 본보기: `bundled/harness-gui/claude.ts`
- 계약:
  - 쓰는 것: `HarnessGuiAdapter`, `AcpSessionHandle`, `packages/protocol/acp/`
  - 내놓는 것: adapter 표의 `opencode` 칸

## 할 일

1. 사람의 PATH의 `opencode`로 `opencode acp`를 띄운다. 사람의 설정과 login을 쓴다.
2. 표준 protocol의 `session/update`(글, tool call과 갱신), `session/request_permission`, prompt 응답의 `stopReason`을 lophn ACP로 옮긴다. 승인은 lophn 승인 카드로 묻는다.
3. 입력: send(`session/prompt`), stop(`session/cancel`), 승인 답. resume은 그 protocol의 session load가 되면 쓰고, 안 되면 새 session으로 열고 보고한다.
4. 표준 protocol client library를 쓰면 판을 고정한다(등록은 lead). 손으로 짜도 된다. 고른 쪽과 이유를 보고한다.
5. fixture는 gui-claude와 같은 규칙이다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "permission 요청은 창이 답하기 전까지 tool을 실행하지 않는다"(fixture).
- 남지 않음: 없음.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로.

## lead가 더한 것

- (lead가 더함) 실제 녹화가 `/home/pyosechang/projects/lophn/.claude/worktrees/plan-harness-gui/.dev-data/recordings/opencode/`에 있다(먼저 `/home/pyosechang/projects/lophn/.claude/worktrees/plan-harness-gui/.dev-data/recordings/README.md`). fixture는 여기서 test에 필요한 것만 README의 scrub 규칙대로 `fixtures/opencode/`에 옮긴다. 문서·type으로 만든 fixture는 쓰지 않는다.
- (lead가 더함) ACP 약속은 `gui-claude.md`의 "lead가 더한 것" 마지막 항목(seq, session, message id, id 짝, start)과 같다.
- (lead가 더함) OpenCode 기본 설정은 shell과 edit를 묻지 않고 실행한다(녹화는 `OPENCODE_CONFIG_CONTENT`로 ask를 걸었다). adapter는 사람 설정을 그대로 쓰고 바꾸지 않는다. 그래서 사람이 ask를 걸지 않았으면 승인 카드가 뜨지 않는다. 그렇다고 보고에 적는다.
- (lead가 더함) `session/load`는 응답 전에 앞 대화를 `session/update`로 다시 흘린다. 그것으로 앞 대화를 그린다. reject는 prompt 전체를 `stopReason: "cancelled"`로 끝낸다.
