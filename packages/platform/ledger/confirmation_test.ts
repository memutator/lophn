import { assert, assertEquals } from "@std/assert";
import { canonicalize } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../contracts/platform/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../apps/core/testing/ledger.ts";
import { confirmationBinding } from "../identity/confirmation-binding.ts";
import { guardedRoute } from "../../../apps/core/testing/confirmation-registration_test.ts";

const NOW = Date.UTC(2026, 0, 1);
const HASH = "ab".repeat(32);
const INPUT = { target: "cac_01arz3ndektsv4rrffq69g5fav", content: HASH };

const ctx: AuthenticatedContext = {
  actor: "user",
  principal: "user-1",
  credential_ref: "test:user-1:user",
  scope: { operations: ["guarded_apply", "CommandResult"], targets: {} },
  conditions: {},
};

function envelope(key: string, input: unknown = INPUT, extra: Record<string, unknown> = {}) {
  return {
    command: "guarded_apply",
    input,
    compare: {},
    idempotency_key: key,
    prepared: [],
    ...extra,
  };
}

async function open(): Promise<LedgerHarness> {
  const opened = await createLedgerHarness({
    registrationModules: [
      new URL(
        "../../../apps/core/testing/confirmation-registration_test.ts",
        import.meta.url,
      ),
    ],
    credentials: [ctx],
    nowMs: NOW,
  });
  if (!opened.ok) throw new Error(opened.error.code);
  return opened.value;
}

async function issue(h: LedgerHarness, input: unknown = INPUT) {
  const binding = await confirmationBinding(guardedRoute, input);
  assert(binding);
  const issued = await h.confirmation({
    action: "issue",
    request: {
      type: "confirmation_handle_register",
      window_id: "win-1",
      target_ref: binding.target,
      content_hash: binding.content,
      allowed_decisions: ["guarded_apply"],
      expires_at: new Date(NOW + 600_000).toISOString(),
    },
  });
  assert(issued.ok, issued.ok ? undefined : JSON.stringify(issued.error));
  return issued.value as { confirmation: string };
}

Deno.test("platform/approvals#R3: 사람 결정 확인이 없으면 confirmation command를 거절한다", async () => {
  const h = await open();
  try {
    const denied = await h.command(ctx, envelope("k1"));
    assert(!denied.ok);
    assertEquals(denied.error.code, "forbidden");
    const rows = await h.inspect("select count(*) as n from confirmation_probe");
    assert(rows.ok);
    assertEquals(rows.value[0].n, 0n);
  } finally {
    await h.close();
  }
});

Deno.test("platform/approvals#R5: 대상·내용이 다른 확인은 거절하고 맞는 확인만 한 번 적용한다", async () => {
  const h = await open();
  try {
    const other = await issue(h, { ...INPUT, content: "cd".repeat(32) });
    const mismatched = await h.command(ctx, envelope("k1", INPUT, {
      confirmation: other.confirmation,
    }));
    assert(!mismatched.ok);
    assertEquals(mismatched.error.code, "forbidden");
    const right = await issue(h);
    const applied = await h.command(ctx, envelope("k2", INPUT, {
      confirmation: right.confirmation,
    }));
    assert(applied.ok, applied.ok ? undefined : JSON.stringify(applied.error));
    assertEquals(applied.value.replayed, false);
    const reused = await h.command(ctx, envelope("k3", INPUT, {
      confirmation: right.confirmation,
    }));
    assert(!reused.ok);
    assertEquals(reused.error.code, "forbidden");
  } finally {
    await h.close();
  }
});

Deno.test("platform/approvals#R4: 창을 닫으면 그 handle은 결정이 되지 않는다", async () => {
  const h = await open();
  try {
    const issued = await issue(h);
    const closed = await h.confirmation({ action: "close-window", windowId: "win-1" });
    assert(closed.ok);
    const denied = await h.command(ctx, envelope("k1", INPUT, {
      confirmation: issued.confirmation,
    }));
    assert(!denied.ok);
    assertEquals(denied.error.code, "forbidden");
  } finally {
    await h.close();
  }
});

Deno.test("platform/ledger#R13: 같은 key의 재전달은 소비한 handle 없이 저장 결과를 돌려준다", async () => {
  const h = await open();
  try {
    const issued = await issue(h);
    const first = await h.command(ctx, envelope("k1", INPUT, {
      confirmation: issued.confirmation,
    }));
    assert(first.ok);
    const replay = await h.command(ctx, envelope("k1"));
    assert(replay.ok, replay.ok ? undefined : JSON.stringify(replay.error));
    assertEquals(replay.value.replayed, true);
    assertEquals(replay.value.result, first.value.result);
    const stored = await h.inspect(
      "select fingerprint from command_results where idempotency_key = ?",
      ["k1"],
    );
    assert(stored.ok);
    const fingerprint = String(stored.value[0].fingerprint);
    assert(!fingerprint.includes(issued.confirmation));
    assert(canonicalize(INPUT).length > 0);
  } finally {
    await h.close();
  }
});

Deno.test("platform/ledger#R13: commit 실패는 handle을 소비하지 않아 다시 쓸 수 있다", async () => {
  const h = await open();
  try {
    const failing = { target: INPUT.target, content: "fail" };
    const issued = await issue(h, failing);
    const failed = await h.command(ctx, envelope("k1", failing, {
      confirmation: issued.confirmation,
    }));
    assert(!failed.ok);
    assertEquals(failed.error.code, "conflict");
    const recovered = await h.command(ctx, envelope("k2", failing, {
      confirmation: issued.confirmation,
    }));
    assert(!recovered.ok);
    assertEquals(recovered.error.code, "conflict");
    const rows = await h.inspect("select count(*) as n from confirmation_probe");
    assert(rows.ok);
    assertEquals(rows.value[0].n, 0n);
  } finally {
    await h.close();
  }
});
