# harness-empty-resume

When the GUI is asked to resume a Codex, OpenCode or omp session that the CLI never saved (the person opened the TUI and toggled to the GUI before sending a message), open a new empty session quietly instead of failing.

- 단위: adapter (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/codex.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/codex_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/opencode.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/opencode_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/omp.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/omp_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/codex/`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/opencode/`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/omp/`
- 읽을 것:
  - issue: `project-docs/issues/harness-gui.md`, section "메시지를 보내지 않은 TUI session에서 GUI로 넘기면 resume이 실패한다"
  - architecture: `project-docs/architecture/harness-gui.md` (Codex, omp, OpenCode adapter sections)
  - skill: `.claude/skills/harness-gui/SKILL.md` (no new recordings; no real model calls)
  - upstream sources (read-only, do not run): `/home/pyosechang/projects/harness-lab/codex/` (app-server `thread/resume` error for a thread without rollout), `/home/pyosechang/projects/harness-lab/omp/omp-cli` (what `--resume=<id>` does when the session file does not exist), `/home/pyosechang/projects/harness-lab/open-code/`
- 계약:
  - 쓰는 것: `HarnessGuiAdapter` (`adapter.ts`)
  - 내놓는 것: 없음

## 할 일

1. Codex (`codex.ts` start): when `thread/resume` fails because the thread has no rollout ("no rollout found" or the equivalent error in the upstream source), start a new thread (`thread/start`) instead and do not fail. The new thread id is published as `cli_session` as usual.
2. OpenCode (`opencode.ts` start): it already creates a new session when `api.get(resume)` fails, but ends a failed turn "could not be loaded". Keep the failure line only when the session really existed and failed to load; for a session that does not exist, open silently. If OpenCode cannot tell these apart, decide and report.
3. omp (`omp.ts` start): find out in the upstream source what `--resume=<id>` does for a session that was never saved. If it fails or silently creates a different session, start without `--resume` and do not fail.
4. One small test per adapter that changed behaviour, with hand-made fixture lines (say in the report that they are hand-made).

## 끝남

- `npm run check` passes.
- 위험 test: 없음 beyond the small tests above.
- 남지 않음: no `TODO`/`FIXME` added.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`, or "없음"
- **알려진 미완 동작**: or "없음"
