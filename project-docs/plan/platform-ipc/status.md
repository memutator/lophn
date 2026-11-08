# 상태

lead만 고친다. `tools/status.py platform-ipc build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `pipc-socket-rule` | pipc-socket | 1 | 없음 | merged | pipc-socket/pipc-socket-rule | 668e3d196 | Reviewed exact path preservation, pure injected hash, POSIX modes and ownership. |
| `pipc-shell-ipc` | pipc-shell | 2 | pipc-socket-rule | merged | pipc-shell/pipc-shell-ipc | 3131b7e7d | Reviewed endpoints, independent hook readiness, cleanup and multibyte boundary coverage; Windows execution pending. |
| `pipc-powershell` | pipc-powershell | 3 | pipc-shell-ipc | merged | pipc-powershell/pipc-powershell | 084990dbe | Reviewed profile/alias/policy preservation, wrapper rules, gate removal and module-safe browser body; worker full check passed, Windows manual verification pending. |
