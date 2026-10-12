import { assert, assertEquals } from "@std/assert";
import {
  addressSchema,
  documentRefSchema,
  formatAddress,
  parseAddress,
  placeRefSchema,
  resolvedAddressSchema,
} from "./address.ts";

const doc = "doc_01arz3ndektsv4rrffq69g5fav";
const ver = "ver_01arz3ndektsv4rrffq69g5fav";

Deno.test("documents/addressing#R1: Address parse and format preserve fixed versions", () => {
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
    const value of [
      "mahas/weekly-report@0",
      "mahas/weekly-report@03",
      "mahas/weekly-report@-1",
      "mahas/weekly-report@1.5",
      "mahas/weekly-report@9007199254740992",
      "mahas/weekly-report@3#summary",
      "mahas/weekly-report##summary",
      "mahas/weekly-report#summary@@3",
      "mahas/weekly-report#",
      "mahas/weekly-report@",
      "../weekly-report",
      "mahas/../weekly-report",
      "_inbox/report",
    ]
  ) {
    const result = parseAddress(value);
    assert(!result.ok, value);
    assertEquals(result.error.code, "invalid_input");
  }
  assert(!addressSchema.safeParse({ ...address, context: "ctx" }).success);
  assert(!formatAddress({ ...address, version: 0 }).ok);
});

Deno.test("documents/addressing#R4: section paths and UTF-8 delimiters decode exactly once", () => {
  const section = "소개/summary#@%";
  const value = { place: "mahas", document: "report", section, version: 3 };
  const formatted = formatAddress(value);
  assert(formatted.ok);
  assertEquals(
    formatted.value,
    "mahas/report#%EC%86%8C%EA%B0%9C/summary%23%40%25@3",
  );
  assertEquals(parseAddress(formatted.value), { ok: true, value });
  const decoded = parseAddress("mahas/report#%2523");
  assert(decoded.ok);
  assertEquals(decoded.value.section, "%23");
  for (
    const value of [
      "mahas/report#%",
      "mahas/report#%GG",
      "mahas/report#%FF",
      "mahas/report#%00",
    ]
  ) {
    assert(!parseAddress(value).ok);
  }
});

Deno.test("documents/addressing#R2: PlaceRef ties shared names to the exact target kind", () => {
  assert(
    placeRefSchema.safeParse({
      kind: "project",
      id: "prj_01arz3ndektsv4rrffq69g5fav",
    }).success,
  );
  assert(
    placeRefSchema.safeParse({
      kind: "app",
      id: "app_01arz3ndektsv4rrffq69g5fav",
    }).success,
  );
  for (
    const value of [
      { kind: "project", id: "app_01arz3ndektsv4rrffq69g5fav" },
      { kind: "app", id: "prj_01arz3ndektsv4rrffq69g5fav" },
      { kind: "context", id: doc },
      { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fav", extra: true },
    ]
  ) assert(!placeRefSchema.safeParse(value).success);
});

Deno.test("documents/addressing#R3: DocumentRef and ResolvedAddress support placeless fixed reads", () => {
  const reference = { document: doc, version: ver, section: null };
  assert(documentRefSchema.safeParse(reference).success);
  assert(documentRefSchema.safeParse({ ...reference, version: null }).success);
  assert(!documentRefSchema.safeParse({ ...reference, version: doc }).success);
  assert(
    !documentRefSchema.safeParse({ ...reference, place: "_inbox" }).success,
  );
  const resolved = {
    document: doc,
    version: ver,
    section: null,
    redirected: true,
    current_reference: reference,
    section_status: "whole",
  };
  assert(resolvedAddressSchema.safeParse(resolved).success);
  assert(
    !resolvedAddressSchema.safeParse({ ...resolved, section_status: "similar" })
      .success,
  );
  assert(resolvedAddressSchema.safeParse({ ...resolved, extra: true }).success);
});
