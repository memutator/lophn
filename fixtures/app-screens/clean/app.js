// 앱 화면 검사 fixture. 오류 없이 뜨는 온전한 화면이다. SDK 루트 오류 경계(AppErrorBoundary)가
// 있는 화면처럼 render 오류 event 이름을 가진다(번들에 남는 글자).
globalThis.addEventListener("lophn:render-error", () => {});
