import { assert, assertEquals } from "@std/assert";
import { canonicalize, sha256Hex } from "../../../../packages/base/mod.ts";
import type { Result } from "../../../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../../../packages/contracts/platform/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../../apps/core/testing/ledger.ts";
import { createProviderSecretRefSource } from "./mod.ts";

// 사람 결정(2026-10-12): provider 하나에 credential 하나다. Connect는 credential까지 받는 RegisterProvider
// 하나고, 바꾸거나 다시 로그인하려면 Disconnect 뒤 Connect한다.

const NOW = Date.UTC(2026, 0, 1);
const PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fav";

const OPERATIONS = [
  "RegisterProvider",
  "DisconnectProvider",
  "RefreshProviderCredential",
  "RecordProviderAvailability",
  "ReadProvider",
  "ListProviders",
  "CommandResult",
];

const ANTHROPIC = {
  key: "anthropic",
  display_name: "Anthropic",
  protocols: ["anthropic-messages"],
  auth_kinds: ["api_key"],
  models_endpoint: null,
  oauth: null,
  revision: "2026-01-01",
};

const CUSTOM_LOCAL = {
  key: "my-local",
  display_name: "My local",
  protocols: ["openai-chat-completions"],
  auth_kinds: ["none"],
  models_endpoint: null,
  oauth: null,
  revision: "1",
};

function preparationOf(owner: string, id = "one") {
  return {
    preparation: `prep_${id}`,
    sealed_ref: `seal_${id}`,
    purpose: "provider_credential",
    owner,
  };
}

const userCred: AuthenticatedContext = {
  actor: "user",
  principal: "user-1",
  credential_ref: "test:user-1:user",
  scope: { operations: OPERATIONS, targets: {} },
  conditions: {},
};

const machineCred: AuthenticatedContext = {
  actor: "machine",
  principal: "machine-1",
  credential_ref: "test:machine-1:machine",
  scope: { operations: OPERATIONS, targets: {} },
  conditions: {},
};

let idempotency = 0;
function envelope(
  command: string,
  input: unknown,
  extra: Record<string, unknown> = {},
) {
  idempotency++;
  return {
    command,
    input,
    compare: {},
    idempotency_key: `k-${idempotency}`,
    prepared: [],
    ...extra,
  };
}

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function code(result: Result<unknown>, expected: string) {
  if (result.ok) assert(false, "expected failure: " + JSON.stringify(result));
  else assertEquals(result.error.code, expected);
}

async function open(): Promise<LedgerHarness> {
  return value(
    await createLedgerHarness({
      registrationModules: [
        new URL("./registration_test.ts", import.meta.url),
      ],
      credentials: [userCred, machineCred],
      nowMs: NOW,
    }),
  );
}

function connectInput(id = PROVIDER, sealed = "one") {
  return {
    id,
    name: "Anthropic",
    definition: ANTHROPIC,
    endpoint: "https://api.anthropic.com/v1",
    protocol: "anthropic-messages",
    credential: { kind: "api_key", preparation: preparationOf(id, sealed) },
  };
}

async function disconnectHandle(
  h: LedgerHarness,
  provider: string,
): Promise<string> {
  const content = await sha256Hex(canonicalize({ provider }));
  const issued = await h.confirmation({
    action: "issue",
    request: {
      type: "confirmation_handle_register",
      window_id: "win-1",
      target_ref: provider,
      content_hash: content,
      allowed_decisions: ["DisconnectProvider"],
      expires_at: new Date(NOW + 600_000).toISOString(),
    },
  });
  assert(issued.ok, issued.ok ? undefined : JSON.stringify(issued.error));
  return (issued.value as { confirmation: string }).confirmation;
}

async function connect(h: LedgerHarness, id = PROVIDER, sealed = "one") {
  return await h.command(
    userCred,
    envelope("RegisterProvider", connectInput(id, sealed)),
  );
}

async function readProvider(h: LedgerHarness, id = PROVIDER) {
  return value(
    await h.read({ resource: "providers", method: "read" }, userCred, {
      provider: id,
    }),
  ) as { provider: Record<string, unknown> };
}

Deno.test("lophn-agent/harness/provider#R8: Connect stores the provider and its one credential, and the record has no account list, enabled or last check", async () => {
  const h = await open();
  try {
    value(await connect(h));
    const { provider } = await readProvider(h);
    for (const gone of ["credentials", "enabled", "last_check"]) {
      assert(!(gone in provider), gone);
    }
    const credential = provider["credential"] as Record<string, unknown>;
    assertEquals(credential["kind"], "api_key");
    assertEquals(credential["state"], "available");
    assertEquals(credential["revision"], 1);
    assertEquals(
      (credential["secret_ref"] as Record<string, unknown>)["name"],
      "provider.01arz3ndektsv4rrffq69g5fav",
    );
    for (
      const gone of [
        "key",
        "label",
        "order",
        "enabled",
        "account",
        "organization",
        "plan",
        "dedup_fingerprint",
      ]
    ) {
      assert(!(gone in credential), gone);
    }
    const listed = value(
      await h.read({ resource: "providers", method: "list" }, userCred, {}),
    ) as { providers: { id: string }[] };
    assertEquals(listed.providers.map((entry) => entry.id), [PROVIDER]);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/provider#R8: a connected provider takes no second credential, so connecting the same id again is a conflict", async () => {
  const h = await open();
  try {
    value(await connect(h));
    code(await connect(h, PROVIDER, "two"), "conflict");
    const { provider } = await readProvider(h);
    const credential = provider["credential"] as {
      secret_ref: { sealed_ref: string };
    };
    assertEquals(credential.secret_ref.sealed_ref, "seal_one");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/provider#R6: only a person connects, and the secret reference never reaches the event", async () => {
  const h = await open();
  try {
    code(
      await h.command(
        machineCred,
        envelope("RegisterProvider", connectInput()),
      ),
      "forbidden",
    );
    value(await connect(h));
    const events = await h.inspect(
      "select payload from events where type = 'ProviderRegistered'",
    );
    assert(events.ok);
    assertEquals(events.value.length, 1);
    const payload = String(events.value[0]!["payload"]);
    assert(!payload.includes("seal_one"));
    assert(!payload.includes("prep_one"));
    assertEquals(JSON.parse(payload)["auth_kind"], "api_key");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/provider#R5: a custom provider connects without a secret only at a loopback address", async () => {
  const h = await open();
  try {
    const local = {
      id: PROVIDER,
      name: "My local",
      definition: CUSTOM_LOCAL,
      endpoint: "http://127.0.0.1:11434/v1",
      protocol: "openai-chat-completions",
      credential: { kind: "none", preparation: null },
    };
    value(await h.command(userCred, envelope("RegisterProvider", local)));
    const { provider } = await readProvider(h);
    const credential = provider["credential"] as Record<string, unknown>;
    assertEquals(credential["kind"], "none");
    assertEquals(credential["secret_ref"], null);
    code(
      await h.command(
        userCred,
        envelope("RegisterProvider", {
          ...local,
          id: "pvd_01arz3ndektsv4rrffq69g5fbv",
          endpoint: "http://10.0.0.8:11434/v1",
        }),
      ),
      "invalid_input",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/provider#R6: Disconnect needs the confirmation window, deletes the provider and its credential, and a later Connect can reuse the id", async () => {
  const h = await open();
  try {
    value(await connect(h));
    const revision = (await readProvider(h)).provider["revision"];
    // 확인 창 없이는 지우지 않는다.
    code(
      await h.command(
        userCred,
        envelope("DisconnectProvider", { provider: PROVIDER }, {
          compare: { revision },
        }),
      ),
      "forbidden",
    );
    await readProvider(h);
    // 사람이 아니면 확인 창이 있어도 지우지 못한다.
    const handle = await disconnectHandle(h, PROVIDER);
    code(
      await h.command(
        machineCred,
        envelope("DisconnectProvider", { provider: PROVIDER }, {
          confirmation: handle,
          compare: { revision },
        }),
      ),
      "forbidden",
    );
    const gone = await h.command(
      userCred,
      envelope("DisconnectProvider", { provider: PROVIDER }, {
        confirmation: await disconnectHandle(h, PROVIDER),
        compare: { revision },
      }),
    );
    value(gone);
    code(
      await h.read({ resource: "providers", method: "read" }, userCred, {
        provider: PROVIDER,
      }),
      "not_found",
    );
    const listed = value(
      await h.read({ resource: "providers", method: "list" }, userCred, {}),
    ) as { providers: unknown[] };
    assertEquals(listed.providers, []);
    for (
      const table of [
        "providers",
        "provider_credentials",
        "provider_credential_model_blocks",
      ]
    ) {
      const rows = await h.inspect(`select count(*) as n from ${table}`);
      assert(rows.ok);
      assertEquals(Number(rows.value[0]!["n"]), 0, table);
    }
    const events = await h.inspect(
      "select payload from events where type = 'ProviderDisconnected' and subject = ?",
      [PROVIDER],
    );
    assert(events.ok);
    assertEquals(events.value.length, 1);
    assertEquals(JSON.parse(String(events.value[0]!["payload"])), {
      definition_key: "anthropic",
    });
    // 같은 ID로 다시 Connect한다.
    value(await connect(h, PROVIDER, "two"));
    const again = (await readProvider(h)).provider["credential"] as {
      secret_ref: { sealed_ref: string };
    };
    assertEquals(again.secret_ref.sealed_ref, "seal_two");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/provider#R6: Disconnect compares the provider revision and rejects one that is not connected", async () => {
  const h = await open();
  try {
    value(await connect(h));
    code(
      await h.command(
        userCred,
        envelope("DisconnectProvider", { provider: PROVIDER }, {
          confirmation: await disconnectHandle(h, PROVIDER),
          compare: { revision: 999 },
        }),
      ),
      "conflict",
    );
    const other = "pvd_01arz3ndektsv4rrffq69g5fcv";
    code(
      await h.command(
        userCred,
        envelope("DisconnectProvider", { provider: other }, {
          confirmation: await disconnectHandle(h, other),
          compare: { revision: 1 },
        }),
      ),
      "not_found",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/provider#R4: rejected and usage wait are states of the one credential, and a revoked one comes back only through Disconnect and Connect", async () => {
  const h = await open();
  try {
    value(await connect(h));
    let revision = Number((await readProvider(h)).provider["revision"]);
    const waiting = value(
      await h.command(
        machineCred,
        envelope("RecordProviderAvailability", {
          provider: PROVIDER,
          state: "usage_wait",
          unavailable_reason: "quota",
          until: new Date(NOW + 3_600_000).toISOString(),
          model_block: null,
        }, { compare: { revision } }),
      ),
    );
    revision = Number(
      (waiting.result as { provider: { revision: number } }).provider.revision,
    );
    const afterWait = (await readProvider(h)).provider["credential"] as Record<
      string,
      unknown
    >;
    assertEquals(afterWait["state"], "usage_wait");
    assertEquals(afterWait["unavailable_reason"], "quota");
    // 한 model만 막는 제한은 credential 상태를 그대로 두고 그 model만 막는다.
    const blocked = value(
      await h.command(
        machineCred,
        envelope("RecordProviderAvailability", {
          provider: PROVIDER,
          state: "usage_wait",
          unavailable_reason: "quota",
          until: new Date(NOW + 3_600_000).toISOString(),
          model_block: {
            model_name: "claude-x",
            reason: "not_found",
            until: null,
          },
        }, { compare: { revision } }),
      ),
    );
    revision = Number(
      (blocked.result as { provider: { revision: number } }).provider.revision,
    );
    const withBlock = (await readProvider(h)).provider["credential"] as {
      model_blocks: { model_name: string }[];
    };
    assertEquals(withBlock.model_blocks.map((b) => b.model_name), ["claude-x"]);
    const revoked = value(
      await h.command(
        machineCred,
        envelope("RecordProviderAvailability", {
          provider: PROVIDER,
          state: "revoked",
          unavailable_reason: "authentication",
          until: null,
          model_block: null,
        }, { compare: { revision } }),
      ),
    );
    revision = Number(
      (revoked.result as { provider: { revision: number } }).provider.revision,
    );
    code(
      await h.command(
        machineCred,
        envelope("RecordProviderAvailability", {
          provider: PROVIDER,
          state: "available",
          unavailable_reason: null,
          until: null,
          model_block: null,
        }, { compare: { revision } }),
      ),
      "conflict",
    );
    // Disconnect 뒤 Connect한 새 credential만 쓸 수 있다.
    value(
      await h.command(
        userCred,
        envelope("DisconnectProvider", { provider: PROVIDER }, {
          confirmation: await disconnectHandle(h, PROVIDER),
          compare: { revision },
        }),
      ),
    );
    value(await connect(h, PROVIDER, "two"));
    const fresh = (await readProvider(h)).provider["credential"] as {
      state: string;
      model_blocks: unknown[];
    };
    assertEquals(fresh.state, "available");
    assertEquals(fresh.model_blocks, []);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/provider#R17: an OAuth refresh replaces the one credential's reference and bumps its revision", async () => {
  const h = await open();
  try {
    value(await connect(h));
    const revision = Number((await readProvider(h)).provider["revision"]);
    value(
      await h.command(
        machineCred,
        envelope("RefreshProviderCredential", {
          provider: PROVIDER,
          preparation: preparationOf(PROVIDER, "refreshed"),
          expires_at: new Date(NOW + 3_600_000).toISOString(),
          unavailable_reason: null,
        }, { compare: { revision } }),
      ),
    );
    const credential = (await readProvider(h)).provider["credential"] as {
      revision: number;
      secret_ref: { sealed_ref: string; revision: number };
    };
    assertEquals(credential.revision, 2);
    assertEquals(credential.secret_ref.sealed_ref, "seal_refreshed");
    assertEquals(credential.secret_ref.revision, 2);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/provider#R6: the commands for accounts, the check and the connection test are not registered", async () => {
  const h = await open();
  try {
    value(await connect(h));
    for (
      const name of [
        "ChangeProvider",
        "RegisterProviderCredential",
        "ChangeProviderCredentials",
        "RecordProviderCheck",
      ]
    ) {
      const result = await h.command(
        userCred,
        envelope(name, { provider: PROVIDER }),
      );
      assert(!result.ok, name);
    }
  } finally {
    await h.close();
  }
});

Deno.test("platform/secrets#R1: the provider's secret references come from its one credential and Disconnect refreshes them", async () => {
  const source = createProviderSecretRefSource();
  assertEquals(source.commands.includes("RegisterProvider"), true);
  assertEquals(source.commands.includes("DisconnectProvider"), true);
  assertEquals(source.commands.includes("RefreshProviderCredential"), true);
  for (
    const gone of ["RegisterProviderCredential", "ChangeProviderCredentials"]
  ) {
    assertEquals(source.commands.includes(gone), false, gone);
  }
  const h = await open();
  try {
    value(await connect(h));
    const rows = await h.inspect(
      "select provider, secret_sealed_ref from provider_credentials",
    );
    assert(rows.ok);
    assertEquals(rows.value.length, 1);
    assertEquals(rows.value[0]!["provider"], PROVIDER);
  } finally {
    await h.close();
  }
});
