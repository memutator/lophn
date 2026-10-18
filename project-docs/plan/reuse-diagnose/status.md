# 상태

lead만 고친다. `tools/status.py reuse-diagnose build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `rd-app-api-tool` | rd-app-api | 1 | 없음 | todo |  |  |  |
| `rd-body-route` | rd-body | 1 | 없음 | todo |  |  |  |
| `rd-cap-sdk` | rd-cap | 1 | 없음 | todo |  |  |  |
| `rd-resolve-rule` | rd-resolve | 1 | 없음 | todo |  |  |  |
| `rd-sdk-builtin` | rd-sdk | 1 | 없음 | todo |  |  |  |
| `rd-body-cli` | rd-body | 2 | rd-body-route | todo |  |  |  |
| `rd-body-tool` | rd-body | 2 | rd-body-route, rd-app-api-tool, rd-resolve-rule | todo |  |  |  |
| `rd-cap-net-live` | rd-cap | 2 | rd-cap-sdk | todo |  |  |  |
