# 상태

lead만 고친다. `tools/status.py mobile-user-apps build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `mobile-phone-target` | app-place | 1 | 없음 | merged | app-place/mobile-phone-target | 7c678c889 |  |
| `mobile-place-decl` | app-place | 1 | 없음 | merged | app-place/mobile-place-decl | cf5bbecfa |  |
| `mobile-views-core` | app-views | 1 | 없음 | merged | app-views/mobile-views-core | a463b4036 |  |
| `mobile-shell-views` | app-views | 2 | mobile-views-core, mobile-place-decl | merged | app-views/mobile-shell-views | e46a20145 |  |
| `mobile-phone-contract` | phone-screen | 2 | mobile-phone-target | merged | phone-screen/mobile-phone-contract | 395081091 |  |
| `mobile-build-phone` | phone-screen | 3 | mobile-phone-contract, mobile-place-decl | merged | phone-screen/mobile-build-phone | def945466 |  |
| `mobile-phone-changed-notice` | phone-screen | 4 | mobile-phone-target, mobile-place-decl | merged | phone-screen/mobile-phone-changed-notice | d7088a955 |  |
| `mobile-phone-reads` | phone-screen | 4 | mobile-phone-contract, mobile-build-phone | running | phone-screen/mobile-phone-reads |  |  |
| `mobile-sdk-kit` | phone-sdk | 5 | mobile-build-phone, mobile-phone-contract | todo |  |  |  |
| `mobile-sdk-phone-hooks` | phone-sdk | 5 | mobile-sdk-kit, mobile-phone-contract | todo |  |  |  |
| `mobile-phone-guest` | phone-host | 6 | mobile-phone-contract, mobile-sdk-kit, mobile-sdk-phone-hooks, mobile-build-phone | todo |  |  |  |
| `mobile-remote-gate` | phone-host | 6 | mobile-views-core, mobile-phone-reads, mobile-phone-contract | todo |  |  |  |
| `mobile-preview-phone` | phone-screen | 6 | mobile-build-phone, mobile-shell-views, mobile-sdk-kit, mobile-sdk-phone-hooks, mobile-phone-target | todo |  |  |  |
| `mobile-agent-guidance` | app-guidance | 7 | mobile-preview-phone, mobile-sdk-kit, mobile-sdk-phone-hooks, mobile-build-phone, mobile-place-decl, mobile-phone-target | todo |  |  |  |
| `mobile-phone-apps` | phone-host | 7 | mobile-phone-guest, mobile-remote-gate, mobile-phone-reads | todo |  |  |  |
