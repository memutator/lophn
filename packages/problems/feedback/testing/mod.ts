// feedback leaf의 테스트 전용 fixture(code-map.md 의존 규칙: 제품 코드와 mod.ts는
// import하지 않는다). 실제 PNG 머리 bytes와 실제 redaction처럼 통과하지 못하면 null을
// 내는 fail-closed redactor를 만든다. 실제 SHA-256 준비 경계(snapshots의 realPrepare)는
// 다른 leaf의 fixture라서 `*_test.ts`가 `store`로 넣는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { SnapshotBlobPrepare } from "../../snapshots/mod.ts";
import {
  assembleFeedback,
  type FeedbackDeps,
  type FeedbackView,
  type SelectedProblem,
} from "../mod.ts";
import type { SubmitFeedbackInput } from "../../../contracts/problems/mod.ts";

export const APP_A = "app_01arz3ndektsv4rrffq69g5fav";
export const APP_B = "app_01arz3ndektsv4rrffq69g5faw";
export const RELEASE = "rel_01arz3ndektsv4rrffq69g5fav";
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
export const rpt = (serial: number): `rpt_${string}` =>
  `rpt_01arz3ndektsv4rrffq69g5f${ALPHABET[Math.floor(serial / 32) % 32]}${
    ALPHABET[serial % 32]
  }`;
export const AT = "2026-10-04T12:00:00.000Z";
export const NOW = "2026-10-04T12:00:05.000Z";

// 비밀로 보이는 값은 대체 문자로 바꾸고, UNREDACTABLE이 든 자료는 통과시키지 않는다.
export const SECRET = "sk-live-0123456789abcdef";
export function fakeRedact(
  body: string,
  _mediaType: "text/plain" | "application/json",
): Promise<string | null> {
  if (body.includes("UNREDACTABLE")) return Promise.resolve(null);
  return Promise.resolve(body.replaceAll(SECRET, "[REDACTED]"));
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// 머리(signature + IHDR)가 맞는 PNG. 뒤는 size까지 채운 IDAT 모양의 바이트다.
export function pngBytes(
  width = 800,
  height = 600,
  size = 256,
): Uint8Array {
  const out = new Uint8Array(Math.max(size, 33));
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(out.buffer);
  view.setUint32(8, 13);
  out.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  out.set([8, 6, 0, 0, 0], 24);
  view.setUint32(29, crc32(out.subarray(12, 29)));
  for (let index = 33; index < out.length; index++) out[index] = index % 251;
  return out;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export function view(patch: Partial<FeedbackView> = {}): FeedbackView {
  return {
    binding: "binding-1",
    name: "Monthly report",
    app: APP_A,
    release: RELEASE,
    mode: "live",
    bundle_hash: "a".repeat(64),
    diagnostic_scope: null,
    observed_at: AT,
    capture: null,
    final_screenshot_hash: null,
    ...patch,
  };
}

// 계약 입력에서 PNG 선언 크기 대신 request channel로 오는 바이트를 둔 것.
export type Submission = Omit<SubmitFeedbackInput, "screenshot"> & {
  screenshot: Uint8Array | null;
};

export function assemble(patch: Partial<Submission>, deps: FeedbackDeps) {
  const { screenshot, ...rest } = intake(patch);
  return assembleFeedback(
    {
      ...rest,
      screenshot: screenshot === null
        ? null
        : { size_bytes: screenshot.length },
    },
    screenshot,
    deps,
  );
}

export function intake(patch: Partial<Submission> = {}): Submission {
  return {
    report_id: rpt(1),
    app: APP_A,
    text: "The monthly total is wrong.",
    existing_problem: null,
    observed_at: AT,
    selection: { screen: false, screenshot: false },
    view: null,
    facts: null,
    screenshot: null,
    targets: {
      invocation: null,
      automation: null,
      version: null,
      command_start: "unknown",
    },
    ...patch,
  };
}

// 준비한 바이트를 목적별로 모아 둔다. 같은 purpose를 실패시킬 수 있다.
export type PrepareStore = {
  prepare: SnapshotBlobPrepare["prepare"];
  stored: Map<string, Uint8Array>;
};

export function feedbackHarness(options: {
  store: PrepareStore;
  detailCollection?: boolean | null;
  failPurpose?: string;
  lookup?: (id: string) => Promise<Result<SelectedProblem | null>>;
  arrived?: boolean;
  caller?: FeedbackDeps["caller"];
  redact?: FeedbackDeps["redact"];
}) {
  const prepare = options.store;
  const prepared: { purpose: string; bytes: Uint8Array }[] = [];
  const deps: FeedbackDeps = {
    caller: options.caller ?? { actor: "user", surface: "shell" },
    blobPrepare: {
      prepare: async (input, bytes) => {
        if (input.purpose === options.failPurpose) {
          return err({ code: "unavailable", message: "disk full" });
        }
        const result = await prepare.prepare(input, bytes);
        if (result.ok) {
          prepared.push({
            purpose: input.purpose,
            bytes: prepare.stored.get(result.value.hash)!,
          });
        }
        return result;
      },
    },
    principal: "collector",
    nowAt: NOW,
    redact: options.redact ?? fakeRedact,
    detailCollection: options.detailCollection === undefined
      ? true
      : options.detailCollection,
    lookupProblem: options.lookup ?? (() => Promise.resolve(ok(null))),
    invocationArrived: () => Promise.resolve(options.arrived ?? true),
  };
  return {
    deps,
    prepared,
    bytesOf(purpose: string): Uint8Array | undefined {
      return prepared.find((entry) => entry.purpose === purpose)?.bytes;
    },
    textOf(purpose: string): string | undefined {
      const bytes = prepared.find((entry) => entry.purpose === purpose)?.bytes;
      return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
    },
  };
}
