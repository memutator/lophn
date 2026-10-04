import { assertEquals } from "@std/assert";
import { rowPixels, shortId, virtualizes, virtualWindow } from "./model.ts";

Deno.test("shell/design-system#R30: 표 행은 36·44px이고 1,000행을 넘을 때만 가상 scroll한다", () => {
  assertEquals([rowPixels("compact"), rowPixels("comfortable")], [36, 44]);
  assertEquals([virtualizes(1000), virtualizes(1001)], [false, true]);
});

Deno.test("shell/design-system#R30: 가상 scroll 창은 보이는 행과 위아래 overscan, 나머지 자리 행 수를 낸다", () => {
  assertEquals(virtualWindow(5000, 36, 0, 360), {
    start: 0,
    end: 18,
    before: 0,
    after: 4982,
  });
  assertEquals(virtualWindow(5000, 36, 36_000, 360), {
    start: 992,
    end: 1018,
    before: 992,
    after: 3982,
  });
  // 끝을 넘은 scroll과 음수 위치도 범위 안에 묶는다.
  const end = virtualWindow(1200, 44, 1_000_000, 440);
  assertEquals([end.start, end.end, end.after], [1192, 1200, 0]);
  assertEquals(virtualWindow(1200, 44, -50, 440).start, 0);
  for (const top of [0, 17, 3600, 43_163]) {
    const window = virtualWindow(1200, 36, top, 500);
    assertEquals(
      window.before + (window.end - window.start) + window.after,
      1200,
    );
  }
});

Deno.test("shell/design-system#R30: diagnostics ID는 앞 8자로 줄인다", () => {
  assertEquals(shortId("prj_01J8ZK2Q9X"), "prj_01J8");
  assertEquals(shortId("abc"), "abc");
});
