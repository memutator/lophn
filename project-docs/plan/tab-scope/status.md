# 상태

lead만 고친다. `tools/status.py tab-scope build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `browser-profile-partitions` | browser-profile | 1 | 없음 | todo |  |  |  |
| `tab-owner-core` | tab-owner | 1 | 없음 | todo |  |  |  |
| `tab-owner-layout` | tab-owner | 1 | 없음 | todo |  |  |  |
| `browser-profile-core` | browser-profile | 2 | tab-owner-core, browser-profile-partitions | todo |  |  |  |
| `tab-owner-screen` | tab-owner | 2 | tab-owner-core, tab-owner-layout, browser-profile-partitions | todo |  |  |  |
| `tab-owner-sidebar` | tab-owner | 2 | tab-owner-layout | todo |  |  |  |
| `browser-profile-settings` | browser-profile | 3 | browser-profile-core, browser-profile-partitions | todo |  |  |  |
| `tab-owner-hand` | tab-owner | 3 | tab-owner-core, tab-owner-screen, tab-owner-sidebar | todo |  |  |  |
