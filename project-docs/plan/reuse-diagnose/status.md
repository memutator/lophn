# 상태

lead만 고친다. `tools/status.py reuse-diagnose build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `rd-app-api-tool` | rd-app-api | 1 | 없음 | merged | rd-app-api/rd-app-api-tool | 34ca01530 |  |
| `rd-body-route` | rd-body | 1 | 없음 | merged | rd-body/rd-body-route | 42331b3ee |  |
| `rd-cap-fs` | rd-cap | 1 | 없음 | merged | rd-cap/rd-cap-fs | bbb2a6737 |  |
| `rd-cap-net-transport` | rd-cap | 1 | 없음 | running | rd-cap/rd-cap-net-transport |  |  |
| `rd-ex-shape` | rd-ex | 1 | 없음 | merged | rd-ex/rd-ex-shape | 1b94a58ac |  |
| `rd-resolve-rule` | rd-resolve | 1 | 없음 | merged | rd-resolve/rd-resolve-rule | 90effff01 |  |
| `rd-sdk-builtin` | rd-sdk | 1 | 없음 | merged | rd-sdk/rd-sdk-builtin | fb3311889 |  |
| `rd-body-cli` | rd-body | 2 | rd-body-route | merged | rd-body/rd-body-cli | 5486b2f21 |  |
| `rd-body-tool` | rd-body | 2 | rd-body-route, rd-app-api-tool, rd-resolve-rule | running | rd-body/rd-body-tool |  |  |
| `rd-cap-secret-core` | rd-cap-secret | 2 | rd-cap-net-transport | todo |  |  |  |
| `rd-ex-driver` | rd-ex | 2 | rd-ex-shape | merged | rd-ex/rd-ex-driver | 310d35722 |  |
| `rd-cap-secret-supervisor` | rd-cap-secret | 3 | rd-cap-secret-core | todo |  |  |  |
| `rd-ex-request` | rd-ex | 3 | rd-ex-driver | running | rd-ex/rd-ex-request |  |  |
| `rd-ex-prompts` | rd-ex-prompts | 3 | rd-ex-shape | merged | rd-ex-prompts/rd-ex-prompts | 7b12ccd60 |  |
| `rd-cap-net-live` | rd-cap-live | 4 | rd-cap-net-transport, rd-cap-secret-supervisor, rd-cap-fs | todo |  |  |  |
| `rd-cap-skill` | rd-cap-skill | 4 | rd-cap-net-transport, rd-cap-secret-supervisor, rd-cap-fs | todo |  |  |  |
| `rd-ex-trigger` | rd-ex | 4 | rd-ex-request | todo |  |  |  |
| `rd-ex-e2e` | rd-ex | 5 | rd-ex-trigger, rd-cap-net-live | todo |  |  |  |
