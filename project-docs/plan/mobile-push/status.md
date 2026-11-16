# 상태

lead만 고친다. `tools/status.py mobile-push build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `mobile-attention-core` | mobile-attention | 1 | 없음 | merged | mobile-attention/mobile-attention-core | f76a3b28e |  |
| `mobile-push-send` | mobile-push | 1 | 없음 | merged | mobile-push/mobile-push-send | b00185aab |  |
| `mobile-attention-desktop` | mobile-attention | 2 | mobile-attention-core | merged | mobile-attention/mobile-attention-desktop | ceecd6e65 |  |
| `mobile-push-device` | mobile-push | 3 | mobile-attention-core, mobile-push-send, mobile-attention-desktop | merged | mobile-push/mobile-push-device | 1d31d76d6 |  |
| `mobile-push-phone` | mobile-push | 3 | mobile-push-device | merged | mobile-push/mobile-push-phone | defaa7e13 |  |
| `mobile-push-docs` | mobile-push | 4 | mobile-push-phone | todo |  |  |  |
