# 상태

lead만 고친다. `tools/status.py mobile-coding-agents build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `mobile-coding-wireframes` | coding-phone | 1 | 없음 | merged | coding-phone/mobile-coding-wireframes | a7f10d5ac |  |
| `mobile-host-link` | host-link | 1 | 없음 | merged | host-link/mobile-host-link | 40a217651 |  |
| `mobile-coding-state` | coding-relay | 2 | mobile-host-link | running | coding-relay/mobile-coding-state |  |  |
| `mobile-host-link-shell` | host-link | 2 | mobile-host-link | merged | host-link/mobile-host-link-shell | d332c8bff |  |
| `mobile-coding-shell` | coding-relay | 3 | mobile-coding-state, mobile-host-link-shell | todo |  |  |  |
| `mobile-terminal-core` | terminal-view | 3 | mobile-coding-state, mobile-host-link | todo |  |  |  |
| `mobile-terminal-shell` | terminal-view | 3 | mobile-host-link-shell | todo |  |  |  |
| `mobile-coding-open-host` | coding-relay | 4 | mobile-coding-shell, mobile-terminal-shell | todo |  |  |  |
| `mobile-coding-phone-data` | coding-phone | 5 | mobile-coding-state, mobile-coding-shell, mobile-coding-open-host | todo |  |  |  |
| `mobile-host-link-cleanup` | host-link | 5 | mobile-host-link-shell, mobile-coding-shell, mobile-coding-state | todo |  |  |  |
| `mobile-terminal-device-grant` | terminal-view | 5 | mobile-terminal-core | todo |  |  |  |
| `mobile-coding-phone-screens` | coding-phone | 6 | mobile-coding-wireframes | todo |  |  |  |
| `mobile-terminal-phone` | terminal-view | 7 | mobile-terminal-core, mobile-terminal-shell, mobile-terminal-device-grant, mobile-coding-phone-screens | todo |  |  |  |
| `mobile-coding-open-phone` | coding-phone | 8 | mobile-coding-open-host, mobile-terminal-phone, mobile-coding-phone-screens | todo |  |  |  |
