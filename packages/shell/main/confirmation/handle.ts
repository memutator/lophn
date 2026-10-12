// 일회 handle 원문은 main 메모리에만 있다. renderer는 displayId만 안다.
// 발급·검증·소비는 core(platform#T56)가 하고, 여기는 그 참조의 수명만 맡는다.
import { createHash } from "node:crypto";

import { canonicalize } from "./canonical.ts";
import type { ConfirmationHandleRegister, ConfirmationRef } from "./types.ts";

export type { ConfirmationHandleRegister, ConfirmationRef } from "./types.ts";

/** contracts CONFIRMATION_HANDLE_TTL_MS. 발급 시각에서 120초. */
const CONFIRMATION_HANDLE_TTL_MS = 120_000;

export const HANDLE_TTL_MS = CONFIRMATION_HANDLE_TTL_MS;

export type HandleReason =
  | "closed"
  | "cancelled"
  | "crashed"
  | "disconnected"
  | "restarted"
  | "replaced"
  | "expired";

export interface IssuedHandle {
  readonly ref: ConfirmationRef;
  readonly expiresAtMs: number;
}

export interface CoreHandlePort {
  /** 비공개 main↔core 통로의 등록. 원문은 core가 만들고 참조만 온다. */
  register(
    request: ConfirmationHandleRegister,
  ): Promise<
    | { ok: true; confirmation: ConfirmationRef; expiresAt: string }
    | { ok: false; error: { code: string; message: string } }
  >;
  /** 창이 닫히면 그 창의 미사용 handle을 core에서도 버린다. */
  closeWindow(windowId: string): Promise<void>;
  /** main 연결 종료·core 재시작은 epoch 전체를 버린다. */
  clear(): Promise<void>;
}

export interface HandleClock {
  now(): number;
}

/**
 * 내용 기준. core confirmationBinding과 같이 canonical JSON의 sha256 hex다.
 * route binding field만 넘긴다. 키 순서가 달라도 같은 hash가 된다.
 */
export function contentBasis(bound: unknown): string {
  return createHash("sha256").update(canonicalize(bound)).digest("hex");
}

export interface LiveHandle {
  readonly ref: ConfirmationRef;
  readonly windowId: string;
  readonly displayId: string;
  readonly targetRef: string;
  readonly contentHash: string;
  readonly allowed: readonly string[];
  readonly epoch: string;
  readonly expiresAtMs: number;
  /** 제출을 한 번 보냈으면 같은 handle로 다시 보내지 않는다. */
  spent: boolean;
  /** 결과를 모르면 receipt만 다시 본다. 새 handle을 만들지 않는다. */
  unknown: boolean;
}

/**
 * 창 하나와 core epoch 하나에 묶인 handle 표.
 * 닫힘·취소·crash·단절·재시작·다른 대상은 참조를 지운다.
 */
export class HandleTable {
  readonly #live = new Map<string, LiveHandle>();

  remember(handle: LiveHandle): void {
    this.#live.set(handle.displayId, handle);
  }

  find(displayId: string): LiveHandle | undefined {
    return this.#live.get(displayId);
  }

  /** 창이 닫히거나 그 창의 제출이 끝나면 그 display만 지운다. */
  drop(displayId: string): LiveHandle | undefined {
    const handle = this.#live.get(displayId);
    this.#live.delete(displayId);
    return handle;
  }

  /** 같은 창의 남은 handle. 다른 대상을 열면 옛 것을 먼저 무효로 한다. */
  forWindow(windowId: string): LiveHandle[] {
    return [...this.#live.values()].filter((handle) =>
      handle.windowId === windowId
    );
  }

  /** epoch가 바뀌면 옛 handle은 전부 무효다. */
  dropEpoch(epoch: string): void {
    for (const [id, handle] of this.#live) {
      if (handle.epoch !== epoch) this.#live.delete(id);
    }
  }

  clear(): void {
    this.#live.clear();
  }
}

/** 발급 시각에서 120초와 대상 기한 중 이른 시각. 이미 지났으면 null. */
export function earlierDeadline(
  nowMs: number,
  targetExpiresAt: string | null,
): number | null {
  const ttl = nowMs + HANDLE_TTL_MS;
  const target = targetExpiresAt === null ? ttl : Date.parse(targetExpiresAt);
  if (!Number.isFinite(target)) return null;
  const at = Math.min(ttl, target);
  return at > nowMs ? at : null;
}
