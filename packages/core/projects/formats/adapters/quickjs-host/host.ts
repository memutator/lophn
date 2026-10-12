// 호출마다 새 QuickJS runtime. guest에는 JSON 계산만 남기고 시간·난수·동적 코드를 지운다.
import {
  newQuickJSWASMModule,
  type QuickJSWASMModule,
  RELEASE_SYNC,
} from "quickjs-emscripten";
import {
  GUEST_CALL_TIMEOUT_MS,
  GUEST_INPUT_MAX_BYTES,
  GUEST_MEMORY_BYTES,
  GUEST_OUTPUT_MAX_BYTES,
} from "../../guest/contract.ts";

export type GuestFailure = "limit" | "crash" | "invalid_output";

export type GuestRun =
  | { ok: true; output: string }
  | { ok: false; failure: GuestFailure; detail: string };

let modulePromise: Promise<QuickJSWASMModule> | undefined;

function wasmModule(): Promise<QuickJSWASMModule> {
  modulePromise ??= newQuickJSWASMModule(RELEASE_SYNC);
  return modulePromise;
}

const INTRINSICS = {
  BaseObjects: true,
  Date: false,
  // evalCode가 Eval intrinsic을 요구한다. 로드 직후 전역 eval·Function은 지운다.
  Eval: true,
  StringNormalize: true,
  RegExp: true,
  JSON: true,
  Proxy: false,
  MapSet: true,
  // parse5의 entity 표가 Uint8Array 하나를 만든다. host 메모리는 runtime limit 안이다.
  TypedArrays: true,
  Promise: false,
  BigInt: false,
  BigFloat: false,
  BigDecimal: false,
  BignumExt: false,
} as const;

// 기본 intrinsic 가운데 시간·난수·동적 코드로 가는 것만 지운다.
const STRIP = `
delete globalThis.Date;
delete globalThis.eval;
delete globalThis.Function;
if (typeof Math === "object" && Math !== null) delete Math.random;
if (typeof crypto === "object" && crypto !== null) {
  delete crypto.getRandomValues;
  delete crypto.randomUUID;
}
undefined;
`;

function utf8Size(value: string): number {
  return new TextEncoder().encode(value).length;
}

export async function runGuest(
  bundle: string,
  inputJson: string,
  limits: {
    memoryBytes?: number;
    timeoutMs?: number;
    inputMaxBytes?: number;
    outputMaxBytes?: number;
  } = {},
): Promise<GuestRun> {
  const inputMax = limits.inputMaxBytes ?? GUEST_INPUT_MAX_BYTES;
  const outputMax = limits.outputMaxBytes ?? GUEST_OUTPUT_MAX_BYTES;
  const timeoutMs = limits.timeoutMs ?? GUEST_CALL_TIMEOUT_MS;
  if (utf8Size(inputJson) > inputMax) {
    return { ok: false, failure: "limit", detail: "input exceeds limit" };
  }
  let wasm: QuickJSWASMModule;
  try {
    wasm = await wasmModule();
  } catch (error) {
    return {
      ok: false,
      failure: "crash",
      detail: error instanceof Error ? error.message : "wasm load failed",
    };
  }
  const runtime = wasm.newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes ?? GUEST_MEMORY_BYTES);
  const deadline = Date.now() + timeoutMs;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const context = runtime.newContext({ intrinsics: { ...INTRINSICS } });
  let finished: GuestRun | undefined;
  try {
    const stripped = context.evalCode(STRIP, "strip.js");
    if (stripped.error) {
      const detail = String(context.dump(stripped.error));
      stripped.error.dispose();
      return { ok: false, failure: "crash", detail };
    }
    stripped.value.dispose();
    const loaded = context.evalCode(bundle, "bundle.js");
    if (loaded.error) {
      const detail = JSON.stringify(context.dump(loaded.error));
      loaded.error.dispose();
      return { ok: false, failure: "crash", detail };
    }
    loaded.value.dispose();
    const call = `JSON.stringify(dispatch(${inputJson}))`;
    const result = context.evalCode(call, "call.js");
    if (result.error) {
      const dumped = context.dump(result.error);
      result.error.dispose();
      const message = typeof dumped === "object" && dumped !== null &&
          "message" in dumped
        ? String(dumped.message)
        : String(dumped);
      const interrupted = message === "interrupted" ||
        message.includes("out of memory");
      return {
        ok: false,
        failure: interrupted ? "limit" : "crash",
        detail: message,
      };
    }
    const output = result.value.consume(context.getString);
    finished = { ok: true, output };
  } catch (error) {
    finished = {
      ok: false,
      failure: "crash",
      detail: error instanceof Error ? error.message : "guest crashed",
    };
  } finally {
    context.dispose();
    runtime.dispose();
  }
  if (finished === undefined) {
    return { ok: false, failure: "crash", detail: "guest produced no result" };
  }
  if (finished.ok && utf8Size(finished.output) > outputMax) {
    return { ok: false, failure: "limit", detail: "output exceeds limit" };
  }
  return finished;
}
