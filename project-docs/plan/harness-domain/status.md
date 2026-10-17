# 상태

lead만 고친다. `tools/status.py harness-domain build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `harness-spi-inputs` | harness-spi | 1 | harness-spi-registry | merged | harness-spi/harness-spi-inputs | 9f9955b24 |  |
| `harness-spi-registry` | harness-spi | 1 | 없음 | merged | harness-spi/harness-spi-registry | d233212f5 |  |
| `domain-tools-apps` | domain-tools | 2 | 없음 | merged | domain-tools/domain-tools-apps | 92a45f461 |  |
| `role-layer-prompts` | role-layer | 2 | role-layer-tools | merged | role-layer/role-layer-prompts | e259b7517 |  |
| `role-layer-tools` | role-layer | 2 | 없음 | merged | role-layer/role-layer-tools | d1fba856d |  |
| `harness-hooks` | harness-hooks | 3 | 없음 | merged | harness-hooks/harness-hooks | 849b23ef0 |  |
| `role-ports` | role-ports | 3 | 없음 | running | role-ports/role-ports |  |  |
| `layer-checks` | layer-checks | 4 | 없음 | todo |  |  |  |
