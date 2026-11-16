# 상태

lead만 고친다. `tools/status.py mobile-browser-use build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `mobile-drive-contract` | drive-contract | 1 | 없음 | merged | drive-contract/mobile-drive-contract | 5a67ea4ca |  |
| `mobile-drive-preview-read` | drive-core | 1 | 없음 | merged | drive-core/mobile-drive-preview-read | bee6276b6 |  |
| `mobile-drive-kit` | drive-kit | 1 | 없음 | merged | drive-kit/mobile-drive-kit | d55c49bfa |  |
| `mobile-drive-cli` | drive-agent | 2 | mobile-drive-contract | merged | drive-agent/mobile-drive-cli | a45bc3c78 |  |
| `mobile-drive-core` | drive-core | 2 | mobile-drive-contract | merged | drive-core/mobile-drive-core | 285a64940 |  |
| `mobile-drive-native` | drive-phone | 2 | mobile-drive-contract | merged | drive-phone/mobile-drive-native | de2c32971 |  |
| `mobile-drive-phone` | drive-phone | 3 | mobile-drive-native, mobile-drive-preview-read, mobile-drive-contract, mobile-drive-core | merged | drive-phone/mobile-drive-phone | 4c4aa5794 |  |
| `mobile-drive-guidance` | drive-agent | 4 | mobile-drive-cli, mobile-drive-kit, mobile-drive-phone | merged | drive-agent/mobile-drive-guidance | a71158c67 |  |
| `mobile-drive-verify` | drive-check | 5 | mobile-drive-phone, mobile-drive-core, mobile-drive-cli, mobile-drive-guidance | merged | plan/mobile-browser-use | 93875426a | lead가 plan branch에서 직접 |
