import { err, ok, type Result } from "../../../base/mod.ts";
import type { Clock } from "../../../base/mod.ts";
import {
  CONFIRMATION_HANDLE_TTL_MS,
  type ConfirmationHandleRegister,
  type ConfirmationRef,
  confirmationRefSchema,
} from "../../../protocol/base/mod.ts";

// 사람 클릭의 일회 근거. 원문은 이 메모리 표에만 있고 ledger·event·log에 쓰지 않는다.
// core epoch 하나와 main 연결 하나의 수명이다.

type ConfirmationBinding = {
  target: unknown;
  content: unknown;
};

export type ConfirmationUse = {
  ref: ConfirmationRef;
  decision: string;
  binding: ConfirmationBinding;
};

type Entry = {
  windowId: string;
  targetRef: string;
  contentHash: string;
  allowedDecisions: readonly string[];
  // 발급 시각에서 120초와 대상 기한 중 이른 시각.
  expiresAtMs: number;
  // transaction이 잡고 있는 사용. commit 실패면 이 예약만 푼다.
  reserved: boolean;
};

type ConfirmationRegistryOptions = {
  clock: Clock;
  // 32 bytes를 채운다. 테스트가 결정적 값을 끼운다.
  random: (bytes: Uint8Array) => void;
};

const REF_BYTES = 32;

export class ConfirmationRegistry {
  #entries = new Map<string, Entry>();
  #clock: Clock;
  #random: (bytes: Uint8Array) => void;

  constructor(options: ConfirmationRegistryOptions) {
    this.#clock = options.clock;
    this.#random = options.random;
  }

  // main↔core 비공개 통로의 등록 메시지에서만 발급한다. 창·대상·내용 기준·허용 결정·기한에 묶인다.
  issue(request: ConfirmationHandleRegister): Result<{
    confirmation: ConfirmationRef;
    expires_at: string;
  }> {
    const now = this.#clock.nowMs();
    const targetExpires = Date.parse(request.expires_at);
    const ttlExpires = now + CONFIRMATION_HANDLE_TTL_MS;
    const expiresAtMs = Math.min(targetExpires, ttlExpires);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
      return err({ code: "invalid_input", message: "확인 기한이 이미 지났다" });
    }
    const bytes = new Uint8Array(REF_BYTES);
    this.#random(bytes);
    const ref = base64url(bytes);
    const parsed = confirmationRefSchema.safeParse(ref);
    if (!parsed.success) {
      return err({ code: "internal", message: "확인 참조를 만들지 못했다" });
    }
    if (this.#entries.has(parsed.data)) {
      return err({ code: "internal", message: "확인 참조가 겹친다" });
    }
    this.#entries.set(parsed.data, {
      windowId: request.window_id,
      targetRef: request.target_ref,
      contentHash: request.content_hash,
      allowedDecisions: [...request.allowed_decisions],
      expiresAtMs,
      reserved: false,
    });
    return ok({
      confirmation: parsed.data,
      expires_at: new Date(expiresAtMs).toISOString(),
    });
  }

  // 창 닫기는 그 창의 handle만 무효로 한다. 침묵도 닫기도 결정이 아니다.
  closeWindow(windowId: string): void {
    for (const [ref, entry] of this.#entries) {
      if (entry.windowId === windowId) this.#entries.delete(ref);
    }
  }

  // main 연결 종료·core 재시작은 epoch 전체를 버린다. 종료한 handle은 되살리지 않는다.
  clear(): void {
    this.#entries.clear();
  }

  // writer transaction 안에서 현재 상태와 함께 검증하고 예약한다. 원문은 어디에도 남기지 않는다.
  reserve(use: ConfirmationUse): Result<void> {
    const entry = this.#live(use.ref);
    if (!entry.ok) return entry;
    if (entry.value.reserved) {
      return err({ code: "conflict", message: "확인을 이미 쓰고 있다" });
    }
    if (!entry.value.allowedDecisions.includes(use.decision)) {
      return err({ code: "forbidden", message: "허용되지 않은 결정이다" });
    }
    if (!same(entry.value.targetRef, use.binding.target)) {
      return err({ code: "forbidden", message: "확인 대상이 다르다" });
    }
    if (!same(entry.value.contentHash, use.binding.content)) {
      return err({ code: "forbidden", message: "확인 내용이 다르다" });
    }
    entry.value.reserved = true;
    return ok(undefined);
  }

  // commit이 끝나면 소비한다. 만료·종료 handle은 여기까지 오지 않는다.
  consume(ref: ConfirmationRef): void {
    this.#entries.delete(ref);
  }

  // commit 실패면 살아 있는 handle의 예약만 푼다. 그 사이에 끝난 handle은 되살리지 않는다.
  release(ref: ConfirmationRef): void {
    const entry = this.#entries.get(ref);
    if (entry === undefined || this.#clock.nowMs() >= entry.expiresAtMs) return;
    entry.reserved = false;
  }

  #live(ref: string): Result<Entry> {
    const entry = this.#entries.get(ref);
    if (entry === undefined) {
      return err({
        code: "forbidden",
        message: "확인이 없거나 이미 소비되었다",
      });
    }
    if (this.#clock.nowMs() >= entry.expiresAtMs) {
      this.#entries.delete(ref);
      return err({ code: "forbidden", message: "확인 기한이 지났다" });
    }
    return ok(entry);
  }
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

// 대상·내용은 발급 때 고정한 문자열 그대로다. 다른 모양은 다른 대상이다.
function same(expected: string, given: unknown): boolean {
  return typeof given === "string" && given === expected;
}
