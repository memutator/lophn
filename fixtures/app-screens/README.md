# 앱 화면 fixture

앱 화면 검사 host(shell#T46, `--app-screen-test`)에 `bundle_screens_dir`로 주는 고정 bundle 화면 폴더. shell의 host 테스트(`e2e/shell/app-screen-test_test.ts`)와 problems runner의 화면 검사(problems#T11)가 같은 폴더를 쓴다.

- `main/` — `app.js`가 `error`·`unhandledrejection`·`lophn:render-error`를 하나씩 내고, CSP에 막히는 `https://example.com/blocked?secret=fixture` fetch와 `lophnApp.call("fixture.ping", {n: 1})`을 한다.
- `hang/` — renderer가 멈춰 load가 끝나지 않는다. 깨진 view의 feedback 경로를 본다.
- `clean/` — 오류 없이 뜨는 온전한 화면이다. SDK 루트 오류 경계가 있는 화면처럼 `lophn:render-error` 글자를 가진다. 깨진 화면을 따로 두지 않은 앱이고, problems runner의 probe(오류 세 갈래·멈춤)만으로 화면 검사를 통과한다.
- `plain/` — 오류 없이 뜨지만 오류 경계 글자가 없다. 루트 오류 경계가 없는 화면이라 화면 검사가 통과하지 못한다.
