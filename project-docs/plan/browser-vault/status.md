# 상태

lead만 고친다. `tools/status.py browser-vault build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `gmem` | gmem | 1 | 없음 | todo |  |  |  |
| `vault-core` | vault | 1 | 없음 | todo |  |  |  |
| `vault-fill` | vault | 2 | vault-core | todo |  |  |  |
| `vault-ui` | vault | 2 | vault-core | todo |  |  |  |
| `vault-request` | vault | 3 | vault-fill, vault-ui | todo |  |  |  |
