# eval

eval 층(`tests/eval`, `project-docs/architecture/eval.md`)의 열린 이슈.


## coding session이 여럿이면 run 요약의 coding token이 session 수만큼 겹쳐 세어진다

```yaml
kind: bug
modules: [tests]
```

지금: `tests/eval/coding/metrics/jsonl.ts`의 `readClaudeUsage`는 cwd의 Claude Code project 폴더 안 jsonl을 모두 읽는다("trial마다 cwd가 새 폴더라 모두 그 trial의 것"). 같은 앱의 coding session은 모두 같은 source 폴더(cwd)에서 뜨므로, session마다 trial 전체의 합계가 붙고 run 요약은 그것을 다시 더한다. 재현: calendar-user 넷째 run은 session 2개라 요약이 output 69,434였는데 실제는 34,717이다. 앱 직접 짜기 일회성 run은 session 5개라 요약이 output 84,185였는데 실제는 16,837이다.

영향: coding agent의 token과 시간을 App Engineer나 다른 run과 견줄 때 session 수만큼 부풀어 보인다. ticket을 다시 넘긴 run일수록 틀린다.

고치려면: usage를 session이 아니라 trial에서 cwd마다 한 번 읽는다(작음. trace의 usage 칸을 trial 쪽으로 옮긴다). 또는 jsonl의 sessionId로 session마다 나눈다(작음. Claude Code session id는 core의 `coding_sessions.external_session`에 있다). **추천: sessionId로 나누기**(session별 수치가 남는다).
