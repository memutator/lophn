import { assertEquals } from "@std/assert";

import {
  escapeLinkTitle,
  type LinkTarget,
  linkRows,
  linkText,
  rowAt,
  triggerAt,
} from "./link-picker.ts";

const targets: LinkTarget[] = [
  { address: "lophn/roadmap", title: "Roadmap", name: "roadmap" },
  { address: "lophn/plan", title: "Release plan", name: "plan" },
  { address: "lophn/notes", title: "Notes", name: "notes" },
];

Deno.test("shell/editor#R11: `[[`는 단어 시작에서만 열리고 줄바꿈·닫은 링크에서 닫힌다", () => {
  assertEquals(triggerAt("see [[pla", 9), { from: 4, to: 9, query: "pla" });
  assertEquals(triggerAt("word[[x", 7), null);
  assertEquals(triggerAt("[[a]] b", 7), null);
  assertEquals(triggerAt("[[a\nb", 5), null);
  assertEquals(triggerAt("[", 1), null);
});

Deno.test("shell/editor#R11: 목록은 제목 시작, 제목 포함, 이름·주소 순이다", () => {
  assertEquals(
    linkRows(targets, "pl").map((row) => row.address),
    ["lophn/plan"],
  );
  assertEquals(
    linkRows(targets, "r").map((row) => row.address),
    ["lophn/roadmap", "lophn/plan"],
  );
  assertEquals(linkRows(targets, "").length, 3);
  assertEquals(linkRows(targets, "nothing"), []);
});

Deno.test("shell/editor#R11: 고른 문서는 address를 가리키는 Markdown 링크로 들어간다", () => {
  assertEquals(
    linkText({ address: "lophn/plan", title: "Plan [draft]" }),
    "[Plan \\[draft\\]](lophn/plan)",
  );
  assertEquals(escapeLinkTitle("a\\b"), "a\\\\b");
});

Deno.test("shell/editor#R11: 강조 행은 목록 끝에서 돈다", () => {
  assertEquals(rowAt(targets, 3), targets[0]);
  assertEquals(rowAt(targets, -1), targets[2]);
  assertEquals(rowAt([], 0), null);
});
