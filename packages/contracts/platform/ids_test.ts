import { assert, assertEquals } from "@std/assert";
import { ID_PREFIXES, idSchema, runIdSchema } from "./ids.ts";

const ULID = "01h455vb4pex5v6nkc6gd5fdw1";

Deno.test(
  "platform/ledger#R8: ID 접두사는 domain model 표의 32개다",
  () => {
    assertEquals(Object.keys(ID_PREFIXES).sort(), [
      "app",
      "apr",
      "asg",
      "cac",
      "cbn",
      "chk",
      "ctx",
      "doc",
      "grt",
      "inv",
      "mcl",
      "msg",
      "ntf",
      "pkg",
      "prb",
      "prj",
      "pst",
      "pvd",
      "qgr",
      "qst",
      "rel",
      "rpt",
      "run",
      "rvt",
      "ser",
      "ses",
      "snp",
      "tcl",
      "tkt",
      "trm",
      "ver",
      "viw",
      "vrf",
    ]);
    assertEquals(Object.keys(ID_PREFIXES).length, 32);
    assertEquals(ID_PREFIXES.run, "Run");
  },
);

Deno.test(
  "platform/ledger#R8: ID는 접두사와 소문자 Crockford ULID 26자이고 첫 글자는 0~7이다",
  () => {
    assert(runIdSchema.safeParse(`run_${ULID}`).success);
    const doc = idSchema("doc");
    assert(doc.safeParse(`doc_${ULID}`).success);
    for (
      const bad of [
        `run_${"8" + ULID.slice(1)}`,
        `run_${ULID.slice(0, 25)}`,
        `run_${ULID}0`,
        `run_${ULID.toUpperCase()}`,
        `run_${ULID.slice(0, 5)}i${ULID.slice(6)}`,
        `run_${ULID.slice(0, 5)}l${ULID.slice(6)}`,
        `run_${ULID.slice(0, 5)}o${ULID.slice(6)}`,
        `run_${ULID.slice(0, 5)}u${ULID.slice(6)}`,
        `doc_${ULID}`,
        `run${ULID}`,
        ULID,
      ]
    ) {
      assert(!runIdSchema.safeParse(bad).success, bad);
    }
  },
);
