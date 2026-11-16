# 상태

lead만 고친다. `tools/status.py mobile-browser-use build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `mobile-drive-contract` | drive-contract | 1 | 없음 | running | drive-contract/mobile-drive-contract |  |  |
| `mobile-drive-preview-read` | drive-core | 1 | 없음 | running | drive-core/mobile-drive-preview-read |  |  |
| `mobile-drive-kit` | drive-kit | 1 | 없음 | running | drive-kit/mobile-drive-kit |  |  |
| `mobile-drive-cli` | drive-agent | 2 | mobile-drive-contract | todo |  |  |  |
| `mobile-drive-core` | drive-core | 2 | mobile-drive-contract | todo |  |  |  |
| `mobile-drive-native` | drive-phone | 2 | mobile-drive-contract | todo |  |  |  |
| `mobile-drive-phone` | drive-phone | 3 | mobile-drive-native, mobile-drive-preview-read, mobile-drive-contract, mobile-drive-core | todo |  |  |  |
| `mobile-drive-guidance` | drive-agent | 4 | mobile-drive-cli, mobile-drive-kit, mobile-drive-phone | todo |  |  |  |
| `mobile-drive-verify` | drive-check | 5 | mobile-drive-phone, mobile-drive-core, mobile-drive-cli, mobile-drive-guidance | todo |  |  |  |
