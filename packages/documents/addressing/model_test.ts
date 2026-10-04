import { assert, assertEquals } from "@std/assert";
import {
  addressSchema,
  checkName,
  documentRefSchema,
  formatAddress,
  parseAddress,
  placeRefSchema,
  SLUG_MAX_LENGTH,
  suggestName,
} from "./mod.ts";

Deno.test("documents/addressing#R1: public address grammar preserves section and positive decimal versions", () => {
  const address = {
    place: "mahas",
    document: "weekly-report",
    section: "summary",
    version: 3,
  };
  assertEquals(parseAddress("mahas/weekly-report#summary@3"), {
    ok: true,
    value: address,
  });
  assertEquals(formatAddress(address), {
    ok: true,
    value: "mahas/weekly-report#summary@3",
  });
  assertEquals(parseAddress("mahas/weekly-report"), {
    ok: true,
    value: { ...address, section: null, version: null },
  });
  for (
    const suffix of [
      "@0",
      "@01",
      "@-1",
      "@+1",
      "@1.0",
      "@1e2",
      "@１",
      "@",
      "@9007199254740992",
      "@3#summary",
      "##summary",
      "#summary@@3",
    ]
  ) {
    const result = parseAddress(`mahas/weekly-report${suffix}`);
    assert(!result.ok, suffix);
    assertEquals(result.error.code, "invalid_input");
  }
  assert(parseAddress("mahas/weekly-report@9007199254740991").ok);
  assert(!addressSchema.safeParse({ ...address, context: "ctx" }).success);
  assert(!placeRefSchema.safeParse({ kind: "context", id: "ctx" }).success);
  assert(!parseAddress("_inbox/report").ok);
  assert(!parseAddress("mahas/../report").ok);
  assert(!formatAddress({ ...address, version: 0 }).ok);
  assert(
    documentRefSchema.safeParse({
      document: "doc_01arz3ndektsv4rrffq69g5fav",
      version: null,
      section: null,
    }).success,
  );
});

Deno.test("documents/addressing#R1: public percent encoding decodes exactly once", () => {
  const address = {
    place: "mahas",
    document: "report",
    section: "소개/summary#@%",
    version: 3,
  };
  const formatted = formatAddress(address);
  assert(formatted.ok);
  assertEquals(
    formatted.value,
    "mahas/report#%EC%86%8C%EA%B0%9C/summary%23%40%25@3",
  );
  assertEquals(parseAddress(formatted.value), { ok: true, value: address });
  assertEquals(parseAddress("mahas/report#%2523%2540%252F"), {
    ok: true,
    value: { ...address, section: "%23%40%2F", version: null },
  });
  for (const section of ["%", "%GG", "%FF", "%C0%AF", "%00", "%0A"]) {
    assert(!parseAddress(`mahas/report#${section}`).ok, section);
  }
});

Deno.test("documents/addressing#R10: names consume the bounded public Slug schema", () => {
  assertEquals(SLUG_MAX_LENGTH, 63);
  for (const name of ["a", "weekly-report", "report12", "a".repeat(63)]) {
    assertEquals(checkName(name), { ok: true, value: name });
  }
  for (
    const name of [
      "",
      "_inbox",
      "_system",
      "a/b",
      "a#b",
      "a@b",
      "a%2Fb",
      "a b",
      "a\t",
      "a\n",
      "a\u0000",
      "a\u007f",
      "a--b",
      "a-",
      "12-report",
      "Report",
      "주간보고",
      "a".repeat(64),
      null,
      1,
    ]
  ) {
    const result = checkName(name);
    assert(!result.ok);
    assertEquals(result.error.code, "invalid_input");
  }
});

Deno.test("documents/addressing#R10: deterministic suggestions use title then first file without changing Korean title", () => {
  const title = "주간 보고";
  assertEquals(suggestName("Weekly Report"), "weekly-report");
  assertEquals(suggestName("Weekly Report", "other.md"), "weekly-report");
  assertEquals(
    suggestName(title, "/reports/Weekly Report.md"),
    "weekly-report",
  );
  assertEquals(suggestName(title, "C:\\reports\\First_File.txt"), "first-file");
  assertEquals(suggestName(title, "주간보고.md"), "document");
  assertEquals(suggestName(title), "document");
  assertEquals(suggestName("Kİ", "Report.md"), "report");
  assertEquals(title, "주간 보고");
  assertEquals(suggestName("2026 Report"), "document-2026-report");
  assertEquals(suggestName("!!!", "---.md"), "document");
  assertEquals(suggestName("한글 Summary"), "summary");
  assertEquals(suggestName("a".repeat(62) + " b"), "a".repeat(62));
  for (
    const value of ["a".repeat(100), "9".repeat(100), "-".repeat(100), "한글"]
  ) {
    const name = suggestName(value);
    assert(checkName(name).ok);
    assert(name.length <= SLUG_MAX_LENGTH);
    assertEquals(suggestName(value), name);
  }
  assert(checkName("human-chosen-name").ok);
});
