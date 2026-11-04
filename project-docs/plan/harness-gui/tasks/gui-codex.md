# gui-codex

Codex adapter. `codex app-server`를 stdio로 띄워 JSON-RPC로 대화하고, 그 이벤트를 ACP로, 창의 입력을 RPC로 옮긴다.

- 단위: gui (wave 3)
- 선행: gui-claude. adapter 꼴과 ACP 옮기기를 그 task의 claude adapter에 맞춘다.
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/codex.ts`(새 file)
  - `packages/shell/main/extensions/bundled/harness-gui/codex_test.ts`(새 file)
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/codex/`(새 폴더)
- 읽을 것:
  - 계획: `project-docs/plan/harness-gui/README.md`의 정한 것 1, 2, 6
  - 근거: `/home/pyosechang/projects/harness-lab/cli-to-gui-report.md` §2.3, §3.2(Happy가 app-server에 붙는 법), `/home/pyosechang/projects/harness-lab/chat-ui-ux-report.md` §2.2(Codex 데스크톱이 app-server로 하는 것), lab의 `codex/codex-cli/codex-rs/`(app-server protocol 정의)
  - 본보기: `bundled/harness-gui/claude.ts`
- 계약:
  - 쓰는 것: `HarnessGuiAdapter`, `AcpSessionHandle`, `packages/protocol/acp/`
  - 내놓는 것: adapter 표의 `codex` 칸

## 할 일

1. 사람의 PATH의 `codex`로 `codex app-server`를 띄운다. 사람의 설정과 login을 쓴다. 전부 허락 sandbox(`danger-full-access`)는 쓰지 않는다.
2. app-server 이벤트 → ACP: 흘러나오는 글, reasoning, 명령·patch tool(patch → `edit`), turn 시작·끝. 승인 요청(명령, patch)은 ACP pending approval로, 창의 결정은 RPC 답으로.
3. 입력: send(실행 중이면 app-server가 하는 steer), stop(interrupt), 승인 답. resume은 app-server의 thread resume이다.
4. fixture는 gui-claude와 같은 규칙이다(실제 실행은 lead가 허락을 받은 뒤).

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "명령 승인은 창이 답하기 전까지 실행되지 않고, 거절하면 거절로 끝난다"(fixture).
- 남지 않음: 없음.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로.

## lead가 더한 것

- (lead가 더함) 실제 녹화가 `/home/pyosechang/projects/lophn/.claude/worktrees/plan-harness-gui/.dev-data/recordings/codex/`에 있다(먼저 `/home/pyosechang/projects/lophn/.claude/worktrees/plan-harness-gui/.dev-data/recordings/README.md`). fixture는 여기서 test에 필요한 것만 README의 scrub 규칙대로 `fixtures/codex/`에 옮긴다. 문서·type으로 만든 fixture는 쓰지 않는다.
- (lead가 더함) ACP 약속은 `gui-claude.md`의 "lead가 더한 것" 마지막 항목(seq, session, message id, id 짝, start)과 같다.
- (lead가 더함) 이 기계의 사람 설정은 `approval_policy = "never"`, `sandbox_mode = "danger-full-access"`다. 그대로면 승인 카드가 뜨지 않고 brief가 금한 full access다. `thread/start`·`thread/resume`에 `sandbox: "workspace-write"`, `approvalPolicy: "on-request"`를 늘 넘긴다(Codex 데스크톱의 기본). 이 판의 protocol type은 `codex app-server generate-ts --out <dir>`로 뽑는다(model을 부르지 않는다. `.dev-data/gui-codex/`에 둔다).
- (lead가 더함) resume 응답의 `thread.turns`에 앞 turn과 item이 실려 온다. 그것으로 앞 대화를 그린다.
