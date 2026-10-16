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

// base의 parseSeq와 같은 판정: 앞자리 0 없는 십진 문자열, 0 이상 2^63−1 이하.
export const seqSchema = z.string().refine((s) => parseSeq(s).ok, {
  message: "invalid seq",
});

export type Seq = z.infer<typeof seqSchema>;

export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

const ARCHIVE_STATES = ["active", "archived"] as const;

export const archiveStateSchema = z.enum(ARCHIVE_STATES);

// ledger 밖 derived store에만 둔다(domain-model platform/ledger DerivedProvenance).

// 목록 read의 cursor다.
export const readCursorSchema = z.string().min(1);

export const positiveSafeIntegerSchema = z.number().refine(
  (value): value is number => Number.isSafeInteger(value) && value >= 1,
  { message: "expected a positive safe integer" },
);

export const positiveRevisionSchema = positiveSafeIntegerSchema;

// 준비한 blob의 크기다.
export const blobSizeSchema = z.number().int().nonnegative().max(
  Number.MAX_SAFE_INTEGER,
);
