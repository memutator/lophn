# 상태

lead만 고친다. `tools/status.py phone-shell build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `mobile-spike` | mobile | 1 | 없음 | merged | mobile/mobile-spike | f7434718d |  |
| `mobile-pairing` | mobile | 2 | mobile-spike | running | mobile/mobile-pairing |  |  |
| `mobile-webview` | mobile | 2 | mobile-spike | running | mobile/mobile-webview |  |  |
| `mobile-remote` | mobile | 3 | mobile-pairing, mobile-webview | todo |  |  |  |
