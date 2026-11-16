# 상태

lead만 고친다. `tools/status.py mobile-local-apps build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `mobile-local-sdk` | sdk | 1 | 없음 | merged | sdk/mobile-local-sdk | 4e56c9a2e |  |
| `mobile-sync-core` | sync | 1 | 없음 | merged | sync/mobile-sync-core | ee90bd3fd |  |
| `mobile-local-build` | phone-backend | 2 | mobile-local-sdk | merged | phone-backend/mobile-local-build | d813013f8 |  |
| `mobile-sync-runtime` | sync | 2 | mobile-sync-core, mobile-local-sdk | merged | sync/mobile-sync-runtime | caa7c4e42 |  |
| `mobile-sync-ledger` | sync | 3 | mobile-sync-runtime, mobile-sync-core | merged | sync/mobile-sync-ledger | 888d35f1f |  |
| `mobile-local-db-native` | phone-host | 4 | 없음 | running | phone-host/mobile-local-db-native |  |  |
| `mobile-local-decl` | sdk | 4 | 없음 | running | sdk/mobile-local-decl |  |  |
| `mobile-local-prepare` | phone-backend | 5 | mobile-local-decl, mobile-local-build | todo |  |  |  |
| `mobile-local-gate` | phone-host | 5 | mobile-sync-ledger, mobile-local-prepare | todo |  |  |  |
| `mobile-local-runtime-phone` | phone-host | 5 | mobile-local-db-native, mobile-local-build, mobile-local-sdk | todo |  |  |  |
| `mobile-local-sync-phone` | phone-host | 6 | mobile-local-runtime-phone, mobile-local-gate, mobile-local-prepare, mobile-sync-ledger, mobile-sync-core | todo |  |  |  |
| `mobile-local-screens` | phone-host | 7 | mobile-local-sync-phone | todo |  |  |  |
| `mobile-local-guidance` | sdk | 7 | mobile-local-decl, mobile-local-prepare, mobile-local-sync-phone, mobile-local-sdk | todo |  |  |  |
