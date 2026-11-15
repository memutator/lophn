# 상태

lead만 고친다. `tools/status.py mobile-app build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `mobile-kit` | design-native | 1 | 없음 | merged | design-native/phone-kit | cd7edc692 |  |
| `mobile-data` | mobile-data | 1 | 없음 | merged | mobile-data/phone-data | df4394a23 |  |
| `mobile-routes` | remote-routes | 1 | 없음 | merged | remote-routes/phone-routes | 07854024a |  |
| `mobile-files` | core-files | 2 | mobile-routes | merged | core-files/mobile-files | 88081b6ed |  |
| `mobile-frame` | mobile-app | 2 | mobile-kit, mobile-data | merged | mobile-app/mobile-frame | 7873d1cbc |  |
| `mobile-frame-fixes` | mobile-app | 3 | mobile-frame | merged | mobile-app/mobile-frame-fixes | 801ca4c61 |  |
| `mobile-home` | mobile-app | 3 | mobile-frame | merged | mobile-app/mobile-home | facbfd489 |  |
| `mobile-inbox` | mobile-app | 3 | mobile-frame | merged | mobile-app/mobile-inbox | 4d94c2ff6 |  |
| `mobile-ops` | mobile-app | 3 | mobile-frame, mobile-routes | merged | mobile-app/mobile-ops | c1ea944a8 |  |
| `mobile-places` | mobile-app | 3 | mobile-frame, mobile-routes, mobile-files | merged | mobile-app/mobile-places | e074f0030 |  |
| `mobile-session` | mobile-app | 3 | mobile-frame, mobile-routes | merged | mobile-app/mobile-session | eb5235e2e |  |
| `mobile-web-removal` | remote-web | 3 | mobile-frame | merged | remote-web/mobile-web-removal | a631fd6c3 |  |
| `mobile-attach` | mobile-app | 4 | mobile-session | todo |  |  |  |
| `mobile-polish` | mobile-app | 4 | mobile-home, mobile-session, mobile-inbox, mobile-places, mobile-ops, mobile-frame-fixes, mobile-web-removal | todo |  |  |  |
