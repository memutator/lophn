# 상태

lead만 고친다. `tools/status.py app-platform build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `approval-reads` | approval-reads | 1 | 없음 | todo |  |  |  |
| `call-frames-result` | call-frames | 1 | 없음 | todo |  |  |  |
| `call-frames-rewind` | call-frames | 1 | approval-reads | todo |  |  |  |
| `crash-log` | crash-log | 1 | approval-reads, call-frames-rewind | todo |  |  |  |
| `doc-paths` | doc-paths | 1 | 없음 | todo |  |  |  |
| `release-files` | release-files | 1 | 없음 | todo |  |  |  |
| `screen-maps` | screen-maps | 1 | release-files | todo |  |  |  |
| `sdk-install-copies` | sdk-install | 1 | 없음 | todo |  |  |  |
| `sdk-install-startup` | sdk-install | 1 | sdk-install-copies, sdk-install-template | todo |  |  |  |
| `sdk-install-template` | sdk-install | 1 | 없음 | todo |  |  |  |
| `test-wait` | test-wait | 1 | 없음 | todo |  |  |  |
