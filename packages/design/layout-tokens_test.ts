// 페이지 틀·표·트리·수치·palette 치수 token(shell/design-system#R21, R22, R30, R31, R32, R39).
import { assertEquals } from "@std/assert";
import { tokens } from "./tokens.ts";

Deno.test("shell/design-system#R21: 페이지 틀 폭은 읽기 600/680/800·목차 220·dashboard 1440/12열·목록 360·폼 640px다", () => {
  assertEquals(tokens.page.reading, {
    narrow: "600px",
    default: "680px",
    wide: "800px",
  });
  assertEquals(tokens.page.toc, "220px");
  assertEquals(tokens.page.dashboard, { max: "1440px", columns: 12 });
  assertEquals([tokens.page.list, tokens.page.form], ["360px", "640px"]);
  // 목차 간격 48px과 dashboard 간격 16px은 space 값이다.
  assertEquals([tokens.space[11], tokens.space[6]], ["48px", "16px"]);
});

Deno.test("shell/design-system#R22: 런처 1040px·프로젝트 개요 800px이다", () => {
  assertEquals([tokens.page.launcher, tokens.page.overview], [
    "1040px",
    "800px",
  ]);
});

Deno.test("shell/design-system#R30: 표 행은 36/44px이다", () => {
  assertEquals(tokens.table.row, { compact: "36px", comfortable: "44px" });
});

Deno.test("shell/design-system#R31: 수치 타일은 한 줄 최대 4개, 값은 28/36px이다", () => {
  assertEquals(tokens.stat.perRow, 4);
  assertEquals(tokens.type.display, { size: "28px", line: "36px" });
});

Deno.test("shell/design-system#R32: 트리 행 28px·들임 12px·현재 표시 2px·들임 상한 8단이다", () => {
  assertEquals(tokens.tree, {
    row: "28px",
    indent: "12px",
    marker: "2px",
    indentCap: 8,
  });
});

Deno.test("shell/design-system#R39: palette 항목은 36px이다", () => {
  assertEquals(tokens.palette.item, "36px");
});
