# review-fixes

- 목표: 전수 리뷰 follow-up. turn 도중 자동 Compact(요약)를 대세 coding agent(Codex·opencode·Claude Code·omp)처럼 들인다. 사람이 정했다(2026-11-06).
- 재료: `project-docs/issues/agent-definition.md`의 "turn 안에서는 오래된 tool 결과를 요약하지 않고 지운다", `project-docs/architecture/agent-definition.md`의 compact 항목, Codex `codex-rs/core/src/session/turn.rs`의 mid-turn `run_auto_compact`(요약 뒤 같은 turn loop를 `continue`).
- 범위 밖: 화면에 새 칸을 그리는 일. 사람의 Compact·"Summarize from here"·다음 turn 전 자동 Compact는 그대로.
- 단위: run-loop. 순서: wave 1 하나.
- Windows: `npm run check:full`만 쓴다. `python3` 대신 `python`. worktree prep은 lead가 손으로 한다.
