# 상태

lead만 고친다. `tools/status.py browser-vault build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `gmem` | gmem | 1 | 없음 | merged | gmem/gmem | c36207059 |  |
| `vault-core` | vault | 1 | 없음 | merged | vault/vault-core | ef13bf4be |  |
| `vault-fill` | vault | 2 | vault-core | running | vault/vault-fill |  |  |
| `vault-ui` | vault | 2 | vault-core | running | vault/vault-ui |  |  |
| `vault-request` | vault | 3 | vault-fill, vault-ui | todo |  |  |  |
