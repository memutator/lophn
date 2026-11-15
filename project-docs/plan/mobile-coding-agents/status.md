# 상태

lead만 고친다. `tools/status.py mobile-coding-agents build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `mobile-coding-wireframes` | coding-phone | 1 | 없음 | merged | coding-phone/mobile-coding-wireframes | a7f10d5ac |  |
| `mobile-host-link` | host-link | 1 | 없음 | merged | host-link/mobile-host-link | 40a217651 |  |
| `mobile-coding-state` | coding-relay | 2 | mobile-host-link | merged | coding-relay/mobile-coding-state | a746cf10f |  |
| `mobile-host-link-shell` | host-link | 2 | mobile-host-link | merged | host-link/mobile-host-link-shell | d332c8bff |  |
| `mobile-coding-shell` | coding-relay | 3 | mobile-coding-state, mobile-host-link-shell | merged | coding-relay/mobile-coding-shell | ed9573d2e |  |
| `mobile-terminal-core` | terminal-view | 3 | mobile-coding-state, mobile-host-link | merged | terminal-view/mobile-terminal-core | 8c4c3838f |  |
| `mobile-terminal-shell` | terminal-view | 3 | mobile-host-link-shell | merged | terminal-view/mobile-terminal-shell | fb83aa101 |  |
| `mobile-coding-open-host` | coding-relay | 4 | mobile-coding-shell, mobile-terminal-shell | merged | coding-relay/mobile-coding-open-host | c2bdf3581 |  |
| `mobile-coding-phone-data` | coding-phone | 5 | mobile-coding-state, mobile-coding-shell, mobile-coding-open-host | running | coding-phone/mobile-coding-phone-data |  |  |
| `mobile-host-link-cleanup` | host-link | 5 | mobile-host-link-shell, mobile-coding-shell, mobile-coding-state | merged | host-link/mobile-host-link-cleanup | 5e85bdaf4 |  |
| `mobile-terminal-device-grant` | terminal-view | 5 | mobile-terminal-core | merged | terminal-view/mobile-terminal-device-grant | 77ba62755 |  |
| `mobile-coding-phone-screens` | coding-phone | 6 | mobile-coding-wireframes | todo |  |  |  |
| `mobile-terminal-phone` | terminal-view | 7 | mobile-terminal-core, mobile-terminal-shell, mobile-terminal-device-grant, mobile-coding-phone-screens | todo |  |  |  |
| `mobile-coding-open-phone` | coding-phone | 8 | mobile-coding-open-host, mobile-terminal-phone, mobile-coding-phone-screens | todo |  |  |  |
