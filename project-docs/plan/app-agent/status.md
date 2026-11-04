# 상태

lead만 고친다. `tools/status.py app-agent build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `app-agent-bridge` | app-agent | 1 | 없음 | running | app-agent/app-agent-bridge |  |  |
| `app-agent-sdk` | app-agent | 2 | app-agent-bridge | todo |  |  |  |
