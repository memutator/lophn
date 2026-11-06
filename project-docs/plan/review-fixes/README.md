# review-fixes

- 목표: 전수 리뷰의 P0·성능 고침(8 task, 모두 merged) 뒤의 follow-up. 자동 Compact를 "turn이 끝난 뒤"에서 "그 session의 다음 turn을 시작하기 전"으로 되돌리되, turn pump를 막지 않게 둔다.
- 재료: Codex·Claude Code·opencode·omp 조사(2026-11-06). Codex·opencode·Claude Code는 다음 model 요청 직전에 lazy하게 compact하고, turn 끝 eager compact는 omp만 기본이다. 사람이 lazy로 정했다.
- 범위 밖: turn 도중(mid-turn) compaction(이슈로 따로 둔다).
- 단위: run-loop. 순서: wave 1 하나.
- Windows: `npm run check:full`만 쓴다. `python3` 대신 `python`. worktree prep은 lead가 손으로 한다.
