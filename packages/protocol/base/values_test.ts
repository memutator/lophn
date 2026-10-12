import { assert, assertEquals } from "@std/assert";
import { parseSeq } from "../../base/mod.ts";
import {
  archiveStateSchema,
  atSchema,
  derivedProvenanceSchema,
  durationMsSchema,
  seqSchema,
  sha256Schema,
} from "./values.ts";

const MAX_SEQ = ((1n << 63n) - 1n).toString();

Deno.test(
  "platform/ledger#R8: 시각은 UTC ISO 8601 밀리초 문자열만 받는다",
  () => {
    assert(atSchema.safeParse("2026-10-04T05:46:07.123Z").success);
    for (
      const bad of [
        "2026-10-04T05:46:07Z",
        "2026-10-04T05:46:07.12Z",
        "2026-10-04t05:46:07.123z",
        "2026-10-04T05:46:07.123+00:00",
        "2026-10-04",
      ]
    ) {
      assert(!atSchema.safeParse(bad).success, bad);
    }
  },
);

Deno.test("platform/ledger#R8: 기간은 0 이상 정수 밀리초다", () => {
  assert(durationMsSchema.safeParse(0).success);
  assert(durationMsSchema.safeParse(Number.MAX_SAFE_INTEGER).success);
  for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1"]) {
    assert(!durationMsSchema.safeParse(bad).success);
  }
  // 2^53 너머는 JS number가 정수를 정확히 담지 못한다.
  assert(!durationMsSchema.safeParse(Number.MAX_SAFE_INTEGER + 2).success);
});

Deno.test(
  "platform/ledger#R9: seq는 base의 parseSeq와 같은 판정이다",
  () => {
    const samples = [
      "0",
      "1",
      (2n ** 53n + 1n).toString(),
      MAX_SEQ,
      "01",
      "-1",
      "1.5",
      "",
      (BigInt(MAX_SEQ) + 1n).toString(),
    ];
    for (const sample of samples) {
      assertEquals(seqSchema.safeParse(sample).success, parseSeq(sample).ok);
    }
  },
);

Deno.test("platform/ledger#R13: hash는 소문자 hex sha256이다", () => {
  const hex = "a".repeat(64);
  assert(sha256Schema.safeParse(hex).success);
  for (
    const bad of [
      "A".repeat(64),
      "a".repeat(63),
      "a".repeat(65),
      "g".repeat(64),
    ]
  ) {
    assert(!sha256Schema.safeParse(bad).success);
  }
});

Deno.test("platform/ledger#R8: ArchiveState는 active와 archived뿐", () => {
  assert(archiveStateSchema.safeParse("active").success);
  assert(archiveStateSchema.safeParse("archived").success);
  assert(!archiveStateSchema.safeParse("deleted").success);
});

const provenance = {
  source_versions: ["ver_01h455vb4pex5v6nkc6gd5fdw1"],
  source_seq_from: "3",
  source_seq_through: "9",
  method: "outline@1",
  indexed_through_seq: "9",
};

Deno.test(
  "platform/ledger#R18: DerivedProvenance는 판 또는 seq 구간 근거가 있어야 한다",
  () => {
    assert(derivedProvenanceSchema.safeParse(provenance).success);
    const seqOnly = { ...provenance, source_versions: [] };
    assert(derivedProvenanceSchema.safeParse(seqOnly).success);
    const versionsOnly = {
      ...provenance,
      source_seq_from: null,
      source_seq_through: null,
    };
    assert(derivedProvenanceSchema.safeParse(versionsOnly).success);
    const none = {
      ...seqOnly,
      source_seq_from: null,
      source_seq_through: null,
    };
    assert(!derivedProvenanceSchema.safeParse(none).success);
  },
);

Deno.test(
  "platform/ledger#R9: DerivedProvenance의 seq 구간은 함께 있고 시작이 끝 이하다",
  () => {
    assert(
      !derivedProvenanceSchema.safeParse({
        ...provenance,
        source_seq_from: null,
      })
        .success,
    );
    assert(
      !derivedProvenanceSchema.safeParse({
        ...provenance,
        source_seq_from: "10",
        source_seq_through: "9",
      }).success,
    );
    const extra = { ...provenance, note: "later" };
    assert(derivedProvenanceSchema.safeParse(extra).success);
  },
);
