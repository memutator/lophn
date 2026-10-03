import { assert, assertEquals } from "@std/assert";
import {
  absolutePathSchema,
  relativePathSchema,
  revisionSchema,
  SLUG_MAX_LENGTH,
  slugSchema,
} from "./values.ts";

Deno.test("documents/addressing#R10: Slug is independent English syntax with a bounded length", () => {
  assertEquals(SLUG_MAX_LENGTH, 63);
  for (
    const value of ["a", "mahas", "weekly-report", "report12", "a".repeat(63)]
  ) {
    assert(slugSchema.safeParse(value).success, value);
  }
  for (
    const value of [
      "",
      "_inbox",
      "Report",
      "12-report",
      "주간보고",
      "a/b",
      "a#b",
      "a@b",
      "a b",
      "a\n",
      "a--b",
      "a-",
      "a".repeat(64),
    ]
  ) assert(!slugSchema.safeParse(value).success, value);
});

Deno.test("documents/projects#R1: folder paths require absolute normalized syntax", () => {
  for (
    const value of [
      "/",
      "/home/user/docs",
      "C:\\Users\\me\\docs",
      "\\\\server\\share\\docs",
    ]
  ) {
    assert(absolutePathSchema.safeParse(value).success, value);
  }
  for (
    const value of [
      "docs",
      "../docs",
      "/docs/../other",
      "/docs/./other",
      "/docs\u0000",
    ]
  ) {
    assert(!absolutePathSchema.safeParse(value).success, value);
  }
  assert(relativePathSchema.safeParse("reports/weekly.md").success);
  for (
    const value of [
      "/report.md",
      "../report.md",
      "a//report.md",
      "C:/report.md",
      "a\\report.md",
    ]
  ) {
    assert(!relativePathSchema.safeParse(value).success, value);
  }
  assert(revisionSchema.safeParse("1").success);
  for (const value of ["0", "01", 1, "-1"]) {
    assert(!revisionSchema.safeParse(value).success);
  }
});
