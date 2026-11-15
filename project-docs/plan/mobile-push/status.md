# 상태

lead만 고친다. `tools/status.py mobile-push build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `mobile-attention-core` | mobile-attention | 1 | 없음 | todo |  |  |  |
| `mobile-push-send` | mobile-push | 1 | 없음 | todo |  |  |  |
| `mobile-attention-desktop` | mobile-attention | 2 | mobile-attention-core | todo |  |  |  |
| `mobile-push-device` | mobile-push | 3 | mobile-attention-core, mobile-push-send, mobile-attention-desktop | todo |  |  |  |
| `mobile-push-phone` | mobile-push | 3 | mobile-push-device | todo |  |  |  |
