# 상태

lead만 고친다. `tools/status.py agent-definition build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `ad-builtin-skills` | builtin-skills | 1 | 없음 | running | builtin-skills/ad-builtin-skills |  |  |
| `ad-discovery` | discovery | 1 | 없음 | running | discovery/ad-discovery |  |  |
| `ad-commands` | commands | 2 | ad-builtin-skills, ad-discovery | todo |  |  |  |
| `ad-fields` | fields | 2 | ad-discovery | todo |  |  |  |
| `ad-instructions` | instructions | 2 | ad-builtin-skills | todo |  |  |  |
