# 상태

lead만 고친다. `tools/status.py phone-app build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `phone-kit` | design-native | 1 | 없음 | running | design-native/phone-kit |  |  |
| `phone-data` | mobile-data | 1 | 없음 | running | mobile-data/phone-data |  |  |
| `phone-routes` | remote-routes | 1 | 없음 | running | remote-routes/phone-routes |  |  |
| `mobile-files` | core-files | 2 | phone-routes | todo |  |  |  |
| `phone-frame` | mobile-app | 2 | phone-kit, phone-data | todo |  |  |  |
| `phone-home` | mobile-app | 3 | phone-frame | todo |  |  |  |
| `phone-inbox` | mobile-app | 3 | phone-frame | todo |  |  |  |
| `phone-ops` | mobile-app | 3 | phone-frame, phone-routes | todo |  |  |  |
| `phone-places` | mobile-app | 3 | phone-frame, phone-routes, mobile-files | todo |  |  |  |
| `phone-session` | mobile-app | 3 | phone-frame, phone-routes | todo |  |  |  |
| `phone-web-removal` | remote-web | 3 | phone-frame | todo |  |  |  |
