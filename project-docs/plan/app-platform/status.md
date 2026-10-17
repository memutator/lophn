# 상태

lead만 고친다. `tools/status.py app-platform build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `approval-reads` | approval-reads | 1 | 없음 | merged | approval-reads/approval-reads | 9f06363f3 |  |
| `call-frames-result` | call-frames | 1 | 없음 | running | call-frames/call-frames-result |  |  |
| `call-frames-rewind` | call-frames | 1 | approval-reads | running | call-frames/call-frames-rewind |  |  |
| `crash-log` | crash-log | 1 | approval-reads, call-frames-rewind | todo |  |  |  |
| `doc-paths` | doc-paths | 1 | 없음 | merged | doc-paths/doc-paths | 4f1ae1fd7 |  |
| `release-files` | release-files | 1 | 없음 | running | release-files/release-files |  |  |
| `screen-maps` | screen-maps | 1 | release-files | todo |  |  |  |
| `sdk-install-copies` | sdk-install | 1 | 없음 | running | sdk-install/sdk-install-copies |  |  |
| `sdk-install-startup` | sdk-install | 1 | sdk-install-copies, sdk-install-template | todo |  |  |  |
| `sdk-install-template` | sdk-install | 1 | 없음 | running | sdk-install/sdk-install-template |  |  |
| `test-wait` | test-wait | 1 | 없음 | merged | test-wait/test-wait | 1337ef9a2 |  |
