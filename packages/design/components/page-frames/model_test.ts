import { assertEquals } from "@std/assert";
import {
  columnBox,
  readingBox,
  tocPlacement,
  tocSideMinimum,
} from "./model.ts";

Deno.test("shell/design-system#R23: 목차는 안쪽 칸 868·948·1068px부터 본문 오른쪽 48px에 붙고 그 아래는 머리로 간다", () => {
  for (
    const [width, minimum] of [
      ["narrow", 868],
      ["default", 948],
      ["wide", 1068],
    ] as const
  ) {
    assertEquals(tocSideMinimum(width), minimum);
    assertEquals(tocPlacement(minimum, width), "side");
    assertEquals(tocPlacement(minimum - 1, width), "head");
  }
  // 1068px 안쪽 칸은 패딩 32px 양쪽을 더한 1132px 칸이다.
  const wide = readingBox(1132, "wide");
  assertEquals([wide.toc, wide.body, wide.left, wide.right], [
    "side",
    800,
    32,
    32,
  ]);
  assertEquals(readingBox(1131, "wide").toc, "head");
});

Deno.test("shell/design-system#R42: 520px 칸은 양쪽 16px 여백 뒤 읽기 폭 488px다", () => {
  const box = readingBox(520, "default");
  assertEquals([box.padding, box.inner, box.body, box.toc], [
    16,
    488,
    488,
    "head",
  ]);
  assertEquals(readingBox(639, "narrow").padding, 16);
  assertEquals(readingBox(640, "narrow").padding, 32);
});

Deno.test("shell/design-system#R22: 최대폭 기둥은 800·1280·1920px 칸에서 가운데이고 좌우 여백이 같다", () => {
  const frames = { form: 640, launcher: 1040, overview: 800, reading: 680 };
  for (const pane of [800, 1280, 1920]) {
    for (const [name, max] of Object.entries(frames)) {
      const box = columnBox(pane, max);
      assertEquals(box.left, box.right, `${name} at ${pane}`);
      assertEquals(box.width, Math.min(max, pane - 64), `${name} at ${pane}`);
    }
  }
  assertEquals(columnBox(1920, 1040).left, 440);
  assertEquals(columnBox(800, 1040), {
    padding: 32,
    inner: 736,
    width: 736,
    left: 32,
    right: 32,
  });
  for (const pane of [1280, 1920]) {
    const box = readingBox(pane, "default");
    assertEquals(box.toc, "side");
    assertEquals(box.left, box.right);
  }
});
