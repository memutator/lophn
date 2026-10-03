import { parseSeq } from "../../base/mod.ts";
import { z } from "zod";

// 기록 시각은 이 형식만 쓴다(domain-model platform/ledger "시각·기간·seq").
const AT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;

export const atSchema = z.string().regex(AT);

export type At = z.infer<typeof atSchema>;

// JS number는 2^53 너머에서 정수를 정확히 담지 못한다.
export const durationMsSchema = z.number().refine(
  (n): n is number => Number.isSafeInteger(n) && n >= 0,
  { message: "invalid duration" },
);

export type DurationMs = z.infer<typeof durationMsSchema>;

// base의 parseSeq와 같은 판정: 앞자리 0 없는 십진 문자열, 0 이상 2^63−1 이하.
export const seqSchema = z.string().refine((s) => parseSeq(s).ok, {
  message: "invalid seq",
});

export type Seq = z.infer<typeof seqSchema>;

export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export type Sha256 = z.infer<typeof sha256Schema>;

export const ARCHIVE_STATES = ["active", "archived"] as const;

export const archiveStateSchema = z.enum(ARCHIVE_STATES);

export type ArchiveState = z.infer<typeof archiveStateSchema>;

// ledger 밖 derived store에만 둔다(domain-model platform/ledger DerivedProvenance).
export const derivedProvenanceSchema = z.object({
  source_versions: z.array(z.string()),
  source_seq_from: seqSchema.nullable(),
  source_seq_through: seqSchema.nullable(),
  method: z.string(),
  indexed_through_seq: seqSchema,
}).refine(
  (value) =>
    (value.source_seq_from === null) === (value.source_seq_through === null),
  { message: "source seq bounds must be both set or both null" },
).refine(
  (value) =>
    value.source_seq_from === null ||
    value.source_seq_through === null ||
    BigInt(value.source_seq_from) <= BigInt(value.source_seq_through),
  { message: "source seq range is inverted" },
).refine(
  (value) => value.source_versions.length > 0 || value.source_seq_from !== null,
  { message: "derived provenance needs a source" },
);

export type DerivedProvenance = z.infer<typeof derivedProvenanceSchema>;
