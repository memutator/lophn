import { assert, assertEquals } from "@std/assert";
import { encodeUtf8 } from "../../pure/utf8.ts";
import {
  extractFormat,
  formatDeclaration,
  formatDeclarations,
  formatForMediaType,
  MODULE_HASH_PLACEHOLDER,
  validateFormat,
} from "../../model.ts";
import type { FormatModuleFile, FormatModuleInput } from "../../pure/input.ts";
import { sha256Text } from "../../pure/sha256.ts";

const HASH = "ab".repeat(32);

function file(
  path: string,
  mediaType: string,
  content: string,
): FormatModuleFile {
  return {
    path,
    media_type: mediaType,
    primary: true,
    content: encodeUtf8(content),
  };
}

function input(primary: FormatModuleFile): FormatModuleInput {
  return {
    input_hash: HASH,
    module_hash: MODULE_HASH_PLACEHOLDER,
    files: [
      primary,
    ],
  };
}

function sameTwice(
  primary: FormatModuleFile,
  name: "document" | "pdf" | "image" | "data" = "document",
) {
  const bound = input(primary);
  const first = extractFormat(name, bound);
  const second = extractFormat(name, bound);
  assertEquals(second, first);
  return first;
}

function section(result: ReturnType<typeof extractFormat>, key: string) {
  assertEquals(result.status, "ready");
  if (result.status !== "ready") throw new Error("not ready");
  const found = result.sections.find((item) => item.key === key);
  assert(found !== undefined, key);
  return found!;
}

function fixtureRoot(): string {
  const url = new URL(".", import.meta.url);
  const parts = url.pathname.split("/");
  const marker = parts.lastIndexOf("packages");
  return parts.slice(0, marker).join("/") + "/fixtures/projects/";
}

async function fixture(path: string): Promise<string> {
  return await Deno.readTextFile(fixtureRoot() + path);
}

async function fixtureBytes(path: string): Promise<Uint8Array> {
  return await Deno.readFile(fixtureRoot() + path);
}

Deno.test("documents/formats#R1: four built-in formats and document is the default for Markdown and HTML", () => {
  const names = formatDeclarations().map((item) => item.name);
  assertEquals(names, ["document", "pdf", "image", "data"]);
  for (const declaration of formatDeclarations()) {
    assert(declaration.guide.text.length > 0);
    assert(declaration.template.length === 1);
    assert(declaration.vocabulary.length > 0);
  }
  assertEquals(formatForMediaType("text/markdown"), "document");
  assertEquals(formatForMediaType("text/html"), "document");
  assertEquals(formatDeclaration("document").extracts, true);
  assertEquals(formatDeclaration("pdf").extracts, false);
});

Deno.test("documents/formats#R2: document reads the five media types and plain text has no headings", async () => {
  const plain = await fixture("mixed-formats/plain.txt");
  for (const media of ["text/markdown", "text/x-markdown"] as const) {
    const result = sameTwice(file("note.md", media, "# Title\n\nBody\n"));
    assertEquals(result.status, "ready");
    if (result.status === "ready") assertEquals(result.title, "Title");
  }
  const html = sameTwice(file(
    "page.html",
    "text/html",
    "<h1>Title</h1><p>Body</p>\n",
  ));
  assertEquals(html.status, "ready");
  const xhtml = sameTwice(file(
    "page.xhtml",
    "application/xhtml+xml",
    await fixture("mixed-formats/doc.xhtml"),
  ));
  assertEquals(xhtml.status, "ready");
  if (xhtml.status === "ready") assertEquals(xhtml.title, "XHTML 제목");
  const text = sameTwice(file("plain.txt", "text/plain", plain));
  assertEquals(text.status, "ready");
  if (text.status === "ready") {
    assertEquals(text.sections.filter((item) => item.level > 0), []);
    assert(text.text.includes("heading을 만들지 않는다"));
  }
});

Deno.test("documents/formats#R3: pdf, image and data keep extraction unsupported", () => {
  for (
    const [name, media, path] of [
      ["pdf", "application/pdf", "sample.pdf"],
      ["image", "image/png", "pixel.png"],
      ["data", "application/octet-stream", "blob.bin"],
    ] as const
  ) {
    const bytes = [0, 1, 2, 255];
    const bound: FormatModuleInput = {
      input_hash: HASH,
      module_hash: MODULE_HASH_PLACEHOLDER,
      files: [{ path, media_type: media, primary: true, content: bytes }],
    };
    const result = extractFormat(name, bound);
    assertEquals(extractFormat(name, bound), result);
    assertEquals(result.status, "unsupported");
    assertEquals(validateFormat(name, bound).status, "passed");
  }
});

Deno.test("documents/formats#R9: extraction text drops BOM, uses LF and NFC without changing source bytes", async () => {
  const raw = await fixtureBytes("notes-basic/encoding/bom-crlf.md");
  const nfd = await fixtureBytes("notes-basic/encoding/nfd-hangul.md");
  const bom = input({
    path: "bom-crlf.md",
    media_type: "text/markdown",
    primary: true,
    content: [...raw],
  });
  const result = extractFormat("document", bom);
  assertEquals(extractFormat("document", bom), result);
  assertEquals(result.status, "ready");
  if (result.status !== "ready") return;
  assert(!result.text.startsWith("﻿"));
  assert(!result.text.includes("\r"));
  assertEquals(result.title, "BOM과 CRLF");
  const hangul = input({
    path: "nfd-hangul.md",
    media_type: "text/markdown",
    primary: true,
    content: [...nfd],
  });
  const normalized = extractFormat("document", hangul);
  assertEquals(normalized.status, "ready");
  if (normalized.status !== "ready") return;
  assert(normalized.text.includes("분해형 한글".normalize("NFC")));
  assert(!normalized.text.includes("분해형".normalize("NFD")));
  assertEquals(hangul.files[0]?.content, [...nfd]);
});

Deno.test("documents/formats#R10: Markdown keeps real headings and drops front matter, fences and pre", async () => {
  const text = await fixture("notes-basic/fenced.md");
  const result = sameTwice(file("fenced.md", "text/markdown", text));
  assertEquals(result.status, "ready");
  if (result.status !== "ready") return;
  const titles = result.sections.filter((item) => item.level > 0).map((
    item,
  ) => item.title);
  assert(titles.includes("실제 제목") === false);
  assertEquals(result.title, "실제 제목");
  assertEquals(titles, ["코드 블록", "HTML pre", "마지막"]);
  assert(!titles.some((title) => title.includes("가짜")));
  const setext = sameTwice(file(
    "setext.md",
    "text/markdown",
    await fixture("notes-basic/setext.md"),
  ));
  assertEquals(setext.status, "ready");
  if (setext.status === "ready") {
    assertEquals(setext.title, "setext 제목 하나");
    assertEquals(
      setext.sections.filter((item) => item.level > 0).map((item) =>
        item.level
      ),
      [2, 2],
    );
  }
});

Deno.test("documents/formats#R11: skipped levels nest under the nearest lower heading", async () => {
  const text = await fixture("notes-basic/index.md");
  const result = sameTwice(file("index.md", "text/markdown", text));
  assertEquals(result.status, "ready");
  if (result.status !== "ready") return;
  const skipped = section(result, "건너뛴-level/건너뛴-level의-하위");
  assertEquals(skipped.parent, "건너뛴-level");
  assertEquals(skipped.level, 4);
  const parent = section(result, "건너뛴-level");
  assert(skipped.subtree_range.start_line > parent.subtree_range.start_line);
  assert(skipped.subtree_range.end_line <= parent.subtree_range.end_line);
  const next = result.sections.find((item) => item.key === "회의");
  assert(next !== undefined);
  assertEquals(
    parent.subtree_range.end_line,
    next!.subtree_range.start_line - 1,
  );
});

Deno.test("documents/formats#R12: one h1 is the title, several h1 stay, and the lead is a preamble", async () => {
  const index = sameTwice(file(
    "index.md",
    "text/markdown",
    await fixture("notes-basic/index.md"),
  ));
  assertEquals(index.status, "ready");
  if (index.status === "ready") {
    assertEquals(index.title, "프로젝트 노트");
    assert(index.sections.every((item) => item.title !== "프로젝트 노트"));
    const preamble = section(index, "_preamble");
    assertEquals(preamble.level, 0);
    assert(preamble.own_ranges.length > 0);
  }
  const many = sameTwice(file(
    "multi-h1.md",
    "text/markdown",
    await fixture("notes-basic/multi-h1.md"),
  ));
  assertEquals(many.status, "ready");
  if (many.status === "ready") {
    assertEquals(many.title, null);
    assertEquals(
      many.sections.filter((item) => item.level === 1).map((item) =>
        item.title
      ),
      ["첫 번째 h1", "두 번째 h1"],
    );
  }
});

Deno.test("documents/formats#R13: HTML extraction ignores script and hidden regions and stays stable", async () => {
  const page = await fixture("mixed-formats/page.html");
  const result = sameTwice(file("page.html", "text/html", page));
  assertEquals(result.status, "ready");
  if (result.status !== "ready") return;
  const titles = result.sections.map((item) => item.title);
  assertEquals(titles.includes("script가 추가한 제목"), false);
  for (
    const hidden of [
      "nav 안의 제목",
      "textarea 안의 제목",
      "hidden 제목",
      "aria-hidden 제목",
      "template 안의 제목",
      "pre 안의 제목",
      "style 안의 제목",
    ]
  ) {
    assertEquals(titles.includes(hidden), false, hidden);
  }
  assert(titles.includes("첫 제목"));
  assert(titles.includes("마지막 제목"));
});

Deno.test("documents/formats#R14: heading id wins, a wrapping section id applies once, and title is the fallback", async () => {
  const page = await fixture("mixed-formats/page.html");
  const result = sameTwice(file("page.html", "text/html", page));
  assertEquals(result.status, "ready");
  if (result.status !== "ready") return;
  assertEquals(result.title, "혼합 형식 문서");
  assertEquals(section(result, "intro").anchor, "intro");
  const first = section(result, "intro/sec-a");
  const second = result.sections.find((item) =>
    item.title === "section 안의 두 번째 제목"
  );
  assertEquals(first.anchor, "sec-a");
  assert(second !== undefined);
  assertEquals(second!.anchor, null);
  assert(second!.key.endsWith("/section-안의-두-번째-제목"));
});

Deno.test("documents/formats#R15: explicit anchors win and automatic slugs keep letters", async () => {
  const text = await fixture("notes-basic/index.md");
  const result = sameTwice(file("index.md", "text/markdown", text));
  assertEquals(result.status, "ready");
  if (result.status !== "ready") return;
  assertEquals(section(result, "a--b").title, "A & B");
  assertEquals(section(result, "intro").anchor, "intro");
  assertEquals(section(result, "한글-제목").title, "한글 제목");
});

Deno.test("documents/formats#R16: empty slugs, sibling suffixes and duplicate explicit anchors", async () => {
  const text = await fixture("notes-basic/index.md");
  const result = sameTwice(file("index.md", "text/markdown", text));
  assertEquals(result.status, "ready");
  if (result.status === "ready") {
    assertEquals(section(result, "section").title, "!!!");
    assert(result.sections.some((item) => item.key === "회의"));
    assert(result.sections.some((item) => item.key === "회의-2"));
  }
  const duplicate = sameTwice(file(
    "dup-anchor.md",
    "text/markdown",
    await fixture("notes-basic/dup-anchor.md"),
  ));
  assertEquals(duplicate.status, "failed");
  const validation = validateFormat(
    "document",
    input(file(
      "dup-anchor.md",
      "text/markdown",
      await fixture("notes-basic/dup-anchor.md"),
    )),
  );
  assertEquals(validation.status, "failed");
  assertEquals(validation.error_count, 1);
  const diagnostic = validation.diagnostics;
  assert(Array.isArray(diagnostic));
  if (Array.isArray(diagnostic)) {
    assertEquals(diagnostic[0]?.code, "duplicate_anchor");
    assertEquals(diagnostic[0]?.file, "dup-anchor.md");
    assert(diagnostic[0]?.start_line !== null);
  }
});

Deno.test("documents/formats#R17: body hash ignores the heading and text hash covers the representative text", () => {
  const first = sameTwice(file(
    "note.md",
    "text/markdown",
    "# Title\n\n## Kept\n\nbody line\n",
  ));
  const renamed = sameTwice(file(
    "note.md",
    "text/markdown",
    "# Title\n\n## Renamed\n\nbody line\n",
  ));
  const edited = sameTwice(file(
    "note.md",
    "text/markdown",
    "# Title\n\n## Kept\n\nchanged\n",
  ));
  assertEquals(first.status, "ready");
  assertEquals(renamed.status, "ready");
  assertEquals(edited.status, "ready");
  if (
    first.status !== "ready" || renamed.status !== "ready" ||
    edited.status !== "ready"
  ) return;
  const body = first.sections.find((item) => item.level > 0);
  const renamedBody = renamed.sections.find((item) => item.level > 0);
  const editedBody = edited.sections.find((item) => item.level > 0);
  assert(
    body !== undefined && renamedBody !== undefined && editedBody !== undefined,
  );
  assertEquals(renamedBody!.body_hash, body!.body_hash);
  assert(editedBody!.body_hash !== body!.body_hash);
  assertEquals(first.text_hash, sha256Text(first.text));
  assertEquals(body!.characters > 0, true);
  assert(body!.subtree_range.end_line >= body!.subtree_range.start_line);
});
