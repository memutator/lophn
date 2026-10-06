# 앱 화면 fixture

앱 화면 검사 host(shell#T46, `--app-screen-test`)에 `bundle_screens_dir`로 주는 고정 bundle 화면 폴더. shell의 host 테스트(`e2e/shell/app-screen-test_test.ts`)와 problems runner의 화면 검사(problems#T11)가 같은 폴더를 쓴다.

- `main/` — `app.js`가 `error`·`unhandledrejection`·`lophn:render-error`를 하나씩 내고, CSP에 막히는 `https://example.com/blocked?secret=fixture` fetch와 `lophnApp.call("fixture.ping", {n: 1})`을 한다.
- `hang/` — renderer가 멈춰 load가 끝나지 않는다. 깨진 view의 feedback 경로를 본다.
