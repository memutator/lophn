# 상태

lead만 고친다. `tools/status.py agent-surface build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `surf-queue` | surf | 1 | 없음 | todo |  |  |  |
| `surf-team` | surf | 2 | surf-queue | todo |  |  |  |
| `ext-tools` | ext | 3 | surf-tui | todo |  |  |  |
| `surf-tui` | surf | 3 | 없음 | todo |  |  |  |
| `ext-tools-ui` | ext | 4 | 없음 | todo |  |  |  |
