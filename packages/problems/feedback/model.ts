// feedback의 순수 규칙(problems/feedback#R1, R3, R4, R7, R8, R9, R14;
// problems/grouping#R6). IO가 없다: redaction·blob 준비·읽기는 work.ts가 주입받는다.
import { err, ok, type Result } from "../../base/mod.ts";
import { idSchema } from "../../protocol/platform/mod.ts";
import {
  feedbackTextSchema,
  type GroupKey,
  REPORTING_LIMITS,
} from "../../protocol/problems/mod.ts";

export const FEEDBACK_LIMITS = {
  text_scalars: REPORTING_LIMITS.feedback_text_scalars,
  state_bytes: REPORTING_LIMITS.feedback_state_bytes,
  png_long_side: REPORTING_LIMITS.feedback_png_long_side,
  png_bytes: REPORTING_LIMITS.feedback_png_bytes,
  total_bytes: REPORTING_LIMITS.feedback_total_bytes,
} as const;

export type FeedbackCaller = { actor: string; surface: string };

// 사람이 쓴 글은 인증된 shell의 user만 낼 수 있다(R1). app·agent·다른 user 통로는
// 사람의 경험을 대신 쓸 수 없고, 거절 사유로 어떤 대상의 존재도 알리지 않는다.
export function requireShellUser(caller: FeedbackCaller): Result<void> {
  return caller.actor === "user" && caller.surface === "shell"
    ? ok(undefined)
    : err({
      code: "forbidden",
      message: "사람의 [문제 알리기]만 feedback을 접수한다",
    });
}

// redaction을 통과한 글은 공백 외 1~500 Unicode scalar여야 한다(R1).
export function checkFeedbackText(text: string): Result<string> {
  const parsed = feedbackTextSchema.safeParse(text);
  return parsed.success ? ok(parsed.data) : err({
    code: "invalid_input",
    message: `글은 공백 외 1~${FEEDBACK_LIMITS.text_scalars}자여야 한다`,
  });
}

// ---- screenshot (R8) ----

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR_LENGTH = 13;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type PngHeader = { width: number; height: number };

// PNG 머리(signature와 첫 IHDR chunk의 길이·종류·crc)를 검증하고 크기를 읽는다.
// 확장자·MIME 주장은 믿지 않는다. 긴 변 1,600px, 2,097,152 bytes 이하만 받는다.
export function inspectPng(bytes: Uint8Array): Result<PngHeader> {
  const invalid = (message: string): Result<never> =>
    err({ code: "invalid_input", message });
  if (bytes.length > FEEDBACK_LIMITS.png_bytes) {
    return invalid(`이미지는 ${FEEDBACK_LIMITS.png_bytes} bytes 이하여야 한다`);
  }
  const headerEnd = 8 + 8 + IHDR_LENGTH + 4;
  if (
    bytes.length < headerEnd ||
    !PNG_SIGNATURE.every((value, index) => bytes[index] === value)
  ) {
    return invalid("PNG 이미지가 아니다");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = String.fromCharCode(...bytes.subarray(12, 16));
  if (view.getUint32(8) !== IHDR_LENGTH || type !== "IHDR") {
    return invalid("PNG 머리가 올바르지 않다");
  }
  if (crc32(bytes.subarray(12, 16 + IHDR_LENGTH)) !== view.getUint32(29)) {
    return invalid("PNG 머리가 올바르지 않다");
  }
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1) return invalid("PNG 크기가 올바르지 않다");
  if (Math.max(width, height) > FEEDBACK_LIMITS.png_long_side) {
    return invalid(
      `이미지의 긴 변은 ${FEEDBACK_LIMITS.png_long_side}px 이하여야 한다`,
    );
  }
  return ok({ width, height });
}

// ---- 전송 한도 (R9) ----

const encoder = new TextEncoder();

// 글·상태 facts·이미지를 함께 보낸 바이트. 항목별 한도와 따로 검사한다.
export function transferBytes(parts: {
  text: string;
  facts: unknown;
  screenshot: Uint8Array | null;
}): number {
  return encoder.encode(parts.text).length +
    (parts.facts === null
      ? 0
      : encoder.encode(JSON.stringify(parts.facts)).length) +
    (parts.screenshot?.length ?? 0);
}

export function checkTransfer(bytes: number): Result<void> {
  return bytes <= FEEDBACK_LIMITS.total_bytes ? ok(undefined) : err({
    code: "invalid_input",
    message:
      `feedback 전체 전송은 ${FEEDBACK_LIMITS.total_bytes} bytes 이하여야 한다`,
  });
}

export function checkStateBytes(text: string): Result<void> {
  return encoder.encode(text).length <= FEEDBACK_LIMITS.state_bytes
    ? ok(undefined)
    : err({
      code: "invalid_input",
      message: `화면 상태는 ${FEEDBACK_LIMITS.state_bytes} bytes 이하여야 한다`,
    });
}

// ---- 지목 대상 (R3, R4) ----

export type CommandStart = "started" | "blocked_before_start" | "unknown";

// 사람이 [문제 알리기]를 누른 시점에 shell이 고정한 지목. 마지막 요청이나 시간 근접으로
// 고르지 않는다. 모르는 것은 null이다(R3).
export type FeedbackTargets = {
  // 사람이 본 결과를 낸 실제 invocation.
  invocation: string | null;
  // 자동 실행이 낸 결과를 지목할 때의 automation 이름.
  automation: string | null;
  // 고정한 문서나 데이터 판.
  version: string | null;
  command_start: CommandStart;
};

export type TargetState = { state: "known"; id: string } | {
  state: "unknown";
};

const target = (id: string | null): TargetState =>
  id === null ? { state: "unknown" } : { state: "known", id };

export type ResolvedTargets = {
  // 실제로 연결한 invocation. 실행 전 실패와 모름에는 없다(R4).
  invocation: string | null;
  invocation_missing: string | null;
  state: {
    invocation: TargetState;
    automation: TargetState;
    version: TargetState;
    command_start: CommandStart;
  };
};

export const TARGET_REASONS = {
  unknown: "연결된 invocation을 모른다",
  blocked: "실행 전: 입력 검사에서 막혀 command가 시작되지 않았다",
} as const;

export function resolveTargets(
  targets: FeedbackTargets,
): Result<ResolvedTargets> {
  if (
    targets.invocation !== null &&
      !idSchema("inv").safeParse(targets.invocation).success ||
    targets.version !== null &&
      !idSchema("ver").safeParse(targets.version).success ||
    targets.automation !== null && !/\S/.test(targets.automation)
  ) {
    return err({
      code: "invalid_input",
      message: "지목한 대상의 형식이 올바르지 않다",
    });
  }
  // 시작하지 못한 command는 invocation이 없다. 있다고 주장해도 만들어 붙이지 않는다.
  const blocked = targets.command_start === "blocked_before_start";
  const invocation = blocked ? null : targets.invocation;
  return ok({
    invocation,
    invocation_missing: invocation !== null
      ? null
      : blocked
      ? TARGET_REASONS.blocked
      : TARGET_REASONS.unknown,
    state: {
      invocation: target(invocation),
      automation: target(targets.automation),
      version: target(targets.version),
      command_start: targets.command_start,
    },
  });
}

// ---- 안전한 화면 상태 (R7) ----

export type ScreenFacts = {
  tab: string | null;
  // view의 URL. path와 안전한 hash만 남기고 query 값은 버린다.
  url: string | null;
  // 입력 칸의 이름과 값. 값은 버리고 모양만 남긴다.
  inputs: readonly { name: string; value: unknown }[];
  // 아래 셋은 있어도 자동으로 복사하지 않는다. 있었다는 사실과 이유만 남긴다.
  business_data?: unknown;
  command_input?: unknown;
  read_result?: unknown;
};

export type InputShape =
  | { type: "string"; length: number }
  | { type: "array"; length: number }
  | { type: "object"; keys: number }
  | { type: "number" | "boolean" | "null" | "other" };

export type SafeScreenState = {
  screen: string;
  tab: string | null;
  location: { path: string; hash: string | null } | null;
  inputs: { name: string; shape: InputShape }[];
  target: ResolvedTargets["state"];
  omitted: { item: string; reason: string }[];
};

const OMISSIONS = {
  url_query: "URL query 값은 자동으로 담지 않는다",
  url_hash: "안전한 형태가 아닌 URL hash는 담지 않는다",
  url_invalid: "URL을 읽지 못해 위치를 담지 않는다",
  business_data: "업무 DB 값은 자동으로 담지 않는다",
  command_input: "command 입력 원문은 자동으로 담지 않는다",
  read_result: "read command 결과 전체는 자동으로 담지 않는다",
} as const;

const SAFE_HASH = /^#[A-Za-z0-9_\-/]{1,64}$/;

function shapeOf(value: unknown): InputShape {
  if (typeof value === "string") {
    return { type: "string", length: [...value].length };
  }
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (value === null || value === undefined) return { type: "null" };
  if (typeof value === "number") return { type: "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  if (typeof value === "object") {
    return { type: "object", keys: Object.keys(value).length };
  }
  return { type: "other" };
}

export function safeScreenState(
  name: string,
  facts: ScreenFacts,
  targets: ResolvedTargets,
): SafeScreenState {
  const omitted: { item: string; reason: string }[] = [];
  let location: SafeScreenState["location"] = null;
  if (facts.url !== null) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(facts.url, "http://view.invalid");
    } catch {
      omitted.push({ item: "url", reason: OMISSIONS.url_invalid });
    }
    if (parsed !== null) {
      if (parsed.search.length > 1) {
        omitted.push({ item: "url_query", reason: OMISSIONS.url_query });
      }
      const safeHash = parsed.hash === ""
        ? null
        : SAFE_HASH.test(parsed.hash)
        ? parsed.hash
        : null;
      if (parsed.hash !== "" && safeHash === null) {
        omitted.push({ item: "url_hash", reason: OMISSIONS.url_hash });
      }
      location = { path: parsed.pathname, hash: safeHash };
    }
  }
  for (
    const item of ["business_data", "command_input", "read_result"] as const
  ) {
    if (facts[item] !== undefined) {
      omitted.push({ item, reason: OMISSIONS[item] });
    }
  }
  return {
    screen: name,
    tab: facts.tab,
    location,
    inputs: facts.inputs.map((input) => ({
      name: input.name,
      shape: shapeOf(input.value),
    })),
    target: targets.state,
    omitted,
  };
}

// ---- 묶기 (grouping#R6, R14) ----

export type SelectedProblem = { id: string; app: string; group_key: GroupKey };

// 기존 문제에는 같은 앱의 명시적 선택일 때만 덧붙인다. 그 밖에는 이 Report 자기 ID로
// 새 문제를 만든다: 비슷한 글이나 같은 화면은 같은 결함의 증거가 아니다. 다른 앱의
// 문제와 없는 문제는 구별하지 않는다. 비운영 보고는 운영 문제를 만들지 않으므로 선택이
// 있어도 쓰지 않는다. "직접 해 봤지만 안 됩니다"도 이 경로의 새 Report다(R14).
export function feedbackGroup(
  reportId: string,
  app: string,
  mode: "live" | "preview" | "test",
  selected: SelectedProblem | null,
): {
  group_key: GroupKey;
  existing_problem: string | null;
} {
  if (selected !== null && selected.app === app && mode === "live") {
    return {
      group_key: selected.group_key,
      existing_problem: selected.id,
    };
  }
  return {
    group_key: {
      kind: "feedback",
      code: "_feedback",
      discriminator: reportId,
    },
    existing_problem: null,
  };
}
