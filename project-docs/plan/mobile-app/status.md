# 상태

lead만 고친다. `tools/status.py mobile-app build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `mobile-kit` | design-native | 1 | 없음 | merged | design-native/phone-kit | cd7edc692 |  |
| `mobile-data` | mobile-data | 1 | 없음 | merged | mobile-data/phone-data | df4394a23 |  |
| `mobile-routes` | remote-routes | 1 | 없음 | merged | remote-routes/phone-routes | 07854024a |  |
| `mobile-files` | core-files | 2 | mobile-routes | merged | core-files/mobile-files | 88081b6ed |  |
| `mobile-frame` | mobile-app | 2 | mobile-kit, mobile-data | merged | mobile-app/mobile-frame | 7873d1cbc |  |
| `mobile-frame-fixes` | mobile-app | 3 | mobile-frame | running | mobile-app/mobile-frame-fixes |  |  |
| `mobile-home` | mobile-app | 3 | mobile-frame | running | mobile-app/mobile-home |  |  |
| `mobile-inbox` | mobile-app | 3 | mobile-frame | running | mobile-app/mobile-inbox |  |  |
| `mobile-ops` | mobile-app | 3 | mobile-frame, mobile-routes | running | mobile-app/mobile-ops |  |  |
| `mobile-places` | mobile-app | 3 | mobile-frame, mobile-routes, mobile-files | running | mobile-app/mobile-places |  |  |
| `mobile-session` | mobile-app | 3 | mobile-frame, mobile-routes | running | mobile-app/mobile-session |  |  |
| `mobile-web-removal` | remote-web | 3 | mobile-frame | running | remote-web/mobile-web-removal |  |  |
