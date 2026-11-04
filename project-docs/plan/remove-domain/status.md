# 상태

lead만 고친다. `tools/status.py remove-domain build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `rd-kinds` | kinds | 1 | 없음 | merged | kinds/rd-kinds | ad78c1635 |  |
| `rd-commands` | commands | 2 | rd-kinds | merged | commands/rd-commands | 492f6f25f |  |
| `rd-artifacts` | artifacts | 3 | rd-commands | merged | artifacts/rd-artifacts | 5640e363a |  |
| `rd-layers` | layers | 4 | rd-artifacts | todo |  |  |  |
| `rd-domains` | domains | 5 | rd-layers | todo |  |  |  |
