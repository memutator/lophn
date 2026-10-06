// 앱 화면 검사 fixture. 처리되지 않은 오류 세 갈래와 CSP에 막히는 바깥 요청, 앱 command 호출을 낸다.
lophnApp.call("fixture.ping", { n: 1 }).catch(() => {});
fetch("https://example.com/blocked?secret=fixture").catch(() => {});
setTimeout(() => {
  throw new Error("screen fixture error");
}, 0);
Promise.reject(new TypeError("screen fixture rejection"));
globalThis.dispatchEvent(
  new CustomEvent("lophn:render-error", {
    detail: { name: "RenderError", message: "screen fixture render" },
  }),
);
