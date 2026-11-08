# 상태

lead만 고친다. `tools/status.py browser-use build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `bu-preview` | bu-preview | 1 | 없음 | merged | bu-preview/bu-preview | 620305e43 | 진짜 Electron 확인(lead, bu-preview-screen 뒤): 저절로 열기, 앱 화면, [Preview], Stop 뒤 안내, 멈춘 뒤 conflict |
| `bu-preview-screen` | bu-preview | 1 | 없음 | merged | bu-preview/bu-preview-screen | cde754acf |  |
| `bu-call` | bu-call | 2 | bu-preview | merged | bu-call/bu-call | c140f80ec |  |
| `bu-cdp` | bu-cdp | 3 | bu-call | merged | bu-cdp/bu-cdp | c35d6fd6a |  |
| `bu-cdp-ghost` | bu-cdp | 3 | 없음 | todo |  |  |  |
| `bu-device` | bu-device | 4 | bu-cdp | todo |  |  |  |
