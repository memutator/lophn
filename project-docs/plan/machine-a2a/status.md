# 상태

lead만 고친다. `tools/status.py machine-a2a build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `mail-link` | mail | 1 | mail-router | merged | mail/mail-link | 24189690b |  |
| `mail-lists` | mail | 1 | mail-router | merged | mail/mail-lists | e79569113 |  |
| `mail-router` | mail | 1 | 없음 | merged | mail/mail-router | db3b2dc69 |  |
| `mail-screen` | mail | 1 | mail-router | merged | mail/mail-screen | 2ff28f1f0 |  |
| `mail-carry` | mail | 2 | 없음 | running | mail/mail-carry |  |  |
| `mail-hold` | mail | 2 | 없음 | running | mail/mail-hold |  |  |
| `mail-hold-card` | mail | 2 | mail-hold | todo |  |  |  |
| `handoff-note` | handoff | 3 | 없음 | todo |  |  |  |
| `handoff-screen` | handoff | 3 | handoff-note | todo |  |  |  |
