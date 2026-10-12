import { assertEquals } from "@std/assert";

import { LAUNCHER, openLophn, routeTitle } from "./router.ts";

Deno.test("shell/desktop#R24: 새 기본 창은 런처로 시작하고 창 제목은 공간 이름 뒤에 — lophn을 붙인다", () => {
  assertEquals(LAUNCHER, { space: "launcher" });
  assertEquals(routeTitle(LAUNCHER), "lophn");
  const lophn = openLophn();
  assertEquals(lophn, { space: "lophn" });
  assertEquals(routeTitle(lophn), "lophn — lophn");
});
