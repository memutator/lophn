import { assertEquals } from "@std/assert";

import {
  documentAddress,
  fileNameOf,
  joinPage,
  stickyHead,
} from "./model.ts";

Deno.test("shell/editor#R4: 탭 제목은 상대 경로의 파일 이름이다", () => {
  assertEquals(fileNameOf("docs/plan/shell.md"), "shell.md");
  assertEquals(fileNameOf("README.md"), "README.md");
});

Deno.test("shell/editor#R4: 제목이 scroll 칸 위로 사라지면 sticky 머리와 지금 절을 보인다", () => {
  const headings = [
    { title: "Intro", top: 120 },
    { title: "Usage", top: 600 },
  ];
  assertEquals(stickyHead(80, 40, headings, 32), {
    shown: false,
    section: null,
  });
  assertEquals(stickyHead(80, 90, headings, 32), {
    shown: true,
    section: "Intro",
  });
  assertEquals(stickyHead(80, 570, headings, 32), {
    shown: true,
    section: "Usage",
  });
  assertEquals(stickyHead(200, 200, [{ title: "Late", top: 900 }], 32), {
    shown: true,
    section: null,
  });
});

Deno.test("shell/editor#R8: 본문 page는 줄 경계에서 줄바꿈으로, 잘린 긴 줄은 그대로 잇는다", () => {
  const first = joinPage(null, {
    text: "a\nbb",
    ranges: [{ start_line: 1, end_line: 2 }],
  });
  const next = joinPage(first, {
    text: "c",
    ranges: [{ start_line: 3, end_line: 3 }],
  });
  assertEquals(next.text, "a\nbb\nc");
  const cut = joinPage(
    { text: "long li", lastLine: 4 },
    { text: "ne\nnext", ranges: [{ start_line: 4, end_line: 5 }] },
  );
  assertEquals(cut, { text: "long line\nnext", lastLine: 5 });
});

Deno.test("shell/editor#R4: 링크 주소는 documents address 모양만 문서 링크로 본다", () => {
  assertEquals(documentAddress("lophn/plan"), "lophn/plan");
  assertEquals(documentAddress("lophn/plan#scope@3"), "lophn/plan#scope@3");
  assertEquals(documentAddress("https://example.com/a"), null);
  assertEquals(documentAddress("./notes.md"), null);
});
