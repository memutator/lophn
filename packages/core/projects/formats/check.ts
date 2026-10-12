// host가 guest 출력을 다시 검사한다. module의 주장을 그대로 받지 않는다.
import {
  type FormatValidationResult,
  formatValidationResultSchema,
  type SectionExtractionResult,
  sectionExtractionResultSchema,
  sectionsFitResult,
} from "../../../protocol/projects/mod.ts";
import { GUEST_OUTPUT_MAX_BYTES } from "./guest/contract.ts";
import type { GuestExtraction, GuestValidation } from "./pure/input.ts";

export type OutputCheck =
  | { ok: true; value: SectionExtractionResult | FormatValidationResult }
  | { ok: false; reason: string };

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function checkExtraction(
  output: unknown,
  limits: { outputMaxBytes?: number } = {},
): OutputCheck {
  const max = limits.outputMaxBytes ?? GUEST_OUTPUT_MAX_BYTES;
  if (byteLength(output) > max) {
    return { ok: false, reason: "output exceeds limit" };
  }
  const parsed = sectionExtractionResultSchema.safeParse(output);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "extraction output does not match the contract",
    };
  }
  if (parsed.data.status === "ready") {
    if (!sectionsFitResult(parsed.data.text, parsed.data.sections)) {
      return {
        ok: false,
        reason: "sections are not unique, bounded, or acyclic",
      };
    }
  }
  return { ok: true, value: parsed.data };
}

export function checkValidation(output: unknown): OutputCheck {
  const parsed = formatValidationResultSchema.safeParse(output);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation output does not match the contract",
    };
  }
  return { ok: true, value: parsed.data };
}

export function asExtraction(value: GuestExtraction): SectionExtractionResult {
  return value;
}

export function asValidation(value: GuestValidation): FormatValidationResult {
  return value;
}
