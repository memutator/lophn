# 상태

lead만 고친다. `tools/status.py mobile-user-apps build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `mobile-phone-target` | app-place | 1 | 없음 | merged | app-place/mobile-phone-target | 7c678c889 |  |
| `mobile-place-decl` | app-place | 1 | 없음 | merged | app-place/mobile-place-decl | cf5bbecfa |  |
| `mobile-views-core` | app-views | 1 | 없음 | running | app-views/mobile-views-core |  |  |
| `mobile-shell-views` | app-views | 2 | mobile-views-core, mobile-place-decl | todo |  |  |  |
