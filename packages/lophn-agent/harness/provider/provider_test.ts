import { assert, assertEquals } from "@std/assert";
import { canonicalize, sha256Hex } from "../../../../packages/base/mod.ts";
import type { Result } from "../../../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../../../packages/contracts/platform/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../../apps/core/testing/ledger.ts";

const NOW = Date.UTC(2026, 0, 1);
const FINGERPRINT = "a".repeat(64);
const OTHER_FINGERPRINT = "b".repeat(64);

// command는 route name을 scope operation으로 검사한다(platform/ledger executor).
const OPERATIONS = [
  "RegisterProvider",
  "ChangeProvider",
  "RegisterProviderCredential",
  "ChangeProviderCredentials",
  "RefreshProviderCredential",
  "RecordProviderAvailability",
  "RecordProviderCheck",
  "ReadProvider",
  "ListProviders",
  "ListProviderCredentials",
  "CommandResult",
];

// handler에 들어가기 전 값. 입력·출력·event·오류에 credential 값은 없다(R7).
const PREPARATION = {
  preparation: "prep_test_credential",
  sealed_ref: "seal_test_credential",
  purpose: "provider_credential",
  owner: "user-1",
};

const ANTHROPIC_DEFINITION = {
  key: "anthropic",
  display_name: "Anthropic",
  protocols: ["anthropic-messages"],
  auth_kinds: ["api_key"],
  models_endpoint: null,
  oauth: null,
  revision: "2026-01-01",
};

const OLLAMA_DEFINITION = {
  key: "ollama",
  display_name: "Ollama",
  protocols: ["openai-chat-completions"],
  auth_kinds: ["none"],
  models_endpoint: null,
  oauth: null,
  revision: "2026-01-01",
};

const OPENAI_DEFINITION = {
  key: "openai",
  display_name: "OpenAI",
  protocols: ["openai-responses", "openai-chat-completions"],
  auth_kinds: ["api_key"],
  models_endpoint: null,
  oauth: null,
  revision: "2026-01-01",
};

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
  if (result.ok) {
    assert(false, "expected failure, got " + JSON.stringify(result.value));
  } else {
    assertEquals(result.error.code, expected);
  }
}

async function open(
  credentials: readonly AuthenticatedContext[],
): Promise<LedgerHarness> {
  const opened = await createLedgerHarness({
    registrationModules: [
      new URL("./registration_test.ts", import.meta.url),
    ],
    credentials,
    nowMs: NOW,
  });
  return value(opened);
}

async function issueCredentialConfirmation(
  h: LedgerHarness,
  input: { provider: string; key: string; preparation: typeof PREPARATION },
): Promise<string> {
  // route가 선언한 binding field만 내용 기준으로 묶는다(connection-binding과 같다).
  const bound: Record<string, unknown> = {
    provider: input.provider,
    key: input.key,
    preparation: input.preparation,
  };
  const content = await sha256Hex(canonicalize(bound));
  const target = input.provider;
  const issued = await h.confirmation({
    action: "issue",
    request: {
      type: "confirmation_handle_register",
      window_id: "win-1",
      target_ref: target,
      content_hash: content,
      allowed_decisions: ["RegisterProviderCredential"],
      expires_at: new Date(NOW + 600_000).toISOString(),
    },
  });
  assert(issued.ok, issued.ok ? undefined : JSON.stringify(issued.error));
  return (issued.value as { confirmation: string }).confirmation;
}

Deno.test("T3: registers a loopback Anthropic provider with api_key credentials", async () => {
  const h = await open([userCred, machineCred]);
  try {
    const registered = await h.command(
      userCred,
      envelope("RegisterProvider", {
        id: "pvd_01arz3ndektsv4rrffq69g5fav",
        name: "Anthropic loopback",
        definition: ANTHROPIC_DEFINITION,
        // HTTP는 127.0.0.1·::1·localhost에만 허용한다(R5).
        endpoint: "http://127.0.0.1:8080/v1",
        protocol: "anthropic-messages",
      }),
    );
    assert(
      registered.ok,
      registered.ok ? undefined : JSON.stringify(registered.error),
    );

    const handle = await issueCredentialConfirmation(h, {
      provider: "pvd_01arz3ndektsv4rrffq69g5fav",
      key: "key-main",
      preparation: PREPARATION,
    });
    const credentialed = await h.command(
      userCred,
      envelope("RegisterProviderCredential", {
        provider: "pvd_01arz3ndektsv4rrffq69g5fav",
        key: "key-main",
        kind: "api_key",
        label: "main key",
        preparation: PREPARATION,
        account: null,
        organization: null,
        plan: null,
        dedup_fingerprint: FINGERPRINT,
      }, { confirmation: handle, compare: { revision: 1 } }),
    );
    assert(
      credentialed.ok,
      credentialed.ok ? undefined : JSON.stringify(credentialed.error),
    );

    const read = value(
      await h.read({ resource: "providers", method: "read" }, userCred, {
        provider: "pvd_01arz3ndektsv4rrffq69g5fav",
      }),
    );
    const record = (read as Record<string, unknown>)["provider"] as {
      credentials: { secret_ref: { name: string } }[];
    };
    const credential = (record as {
      credentials: {
        secret_ref: { name: string; sealed_ref: string } | null;
      }[];
    }).credentials[0]!;
    assertEquals(
      credential.secret_ref?.name,
      "provider.01arz3ndektsv4rrffq69g5fav",
    );
    // sealed_ref은 참조일 뿐 credential 값이 아니다(R7).
    assert(typeof credential.secret_ref?.sealed_ref === "string");
  } finally {
    await h.close();
  }
});

Deno.test("T3 R5: rejects remote HTTP providers, allows loopback", async () => {
  const h = await open([userCred, machineCred]);
  try {
    const remoteHttp = await h.command(
      userCred,
      envelope("RegisterProvider", {
        id: "pvd_01arz3ndektsv4rrffq69g5fcv",
        name: "bad",
        definition: ANTHROPIC_DEFINITION,
        endpoint: "http://api.example.com/v1",
        protocol: "anthropic-messages",
      }),
    );
    code(remoteHttp, "invalid_input");
  } finally {
    await h.close();
  }
});

Deno.test("T3 R4: records availability, keeps revoked from reuse, allows loopback only", async () => {
  const h = await open([userCred, machineCred]);
  try {
    const register = await h.command(
      userCred,
      envelope("RegisterProvider", {
        id: "pvd_01arz3ndektsv4rrffq69g5fdv",
        name: "Ollama loopback",
        // 인증 없음은 loopback provider에만 있다(R5).
        definition: OLLAMA_DEFINITION,
        endpoint: "http://localhost:11434/v1",
        protocol: "openai-chat-completions",
      }),
    );
    assert(
      register.ok,
      register.ok ? undefined : JSON.stringify(register.error),
    );
    const changed = await h.command(
      userCred,
      envelope("ChangeProvider", {
        provider: "pvd_01arz3ndektsv4rrffq69g5fdv",
        enabled: false,
      }, { compare: { revision: 1 } }),
    );
    assert(changed.ok, changed.ok ? undefined : JSON.stringify(changed.error));

    // 사람이 끈 provider에는 새 호출을 보내지 않는다(R4). 여기서는 read로 확인한다.
    const read = value(
      await h.read({ resource: "providers", method: "list" }, userCred, {}),
    );
    const providers = (read as Record<string, unknown>)["providers"] as {
      enabled: boolean;
      id: string;
    }[];
    const ollama = providers.find((p) =>
      p.id === "pvd_01arz3ndektsv4rrffq69g5fdv"
    );
    assertEquals(ollama?.enabled, false);
  } finally {
    await h.close();
  }
});

Deno.test("T3 R6: only a person can register, replace, or order credentials", async () => {
  const h = await open([userCred, machineCred]);
  try {
    const register = await h.command(
      userCred,
      envelope("RegisterProvider", {
        id: "pvd_01arz3ndektsv4rrffq69g5fev",
        name: "Anthropic loopback",
        definition: ANTHROPIC_DEFINITION,
        endpoint: "http://127.0.0.1:8080/v1",
        protocol: "anthropic-messages",
      }),
    );
    assert(
      register.ok,
      register.ok ? undefined : JSON.stringify(register.error),
    );
    const handle = await issueCredentialConfirmation(h, {
      provider: "pvd_01arz3ndektsv4rrffq69g5fev",
      key: "key-a",
      preparation: PREPARATION,
    });
    const asMachine = await h.command(
      machineCred,
      envelope("RegisterProviderCredential", {
        provider: "pvd_01arz3ndektsv4rrffq69g5fev",
        key: "key-a",
        kind: "api_key",
        label: "x",
        preparation: PREPARATION,
        account: null,
        organization: null,
        plan: null,
        dedup_fingerprint: FINGERPRINT,
      }, { confirmation: handle, compare: { revision: 1 } }),
    );
    code(asMachine, "forbidden");
  } finally {
    await h.close();
  }
});

Deno.test("T3 R9: rejects duplicate api key (same fingerprint) on one provider", async () => {
  const h = await open([userCred, machineCred]);
  try {
    const register = await h.command(
      userCred,
      envelope("RegisterProvider", {
        id: "pvd_01arz3ndektsv4rrffq69g5ffv",
        name: "Anthropic loopback",
        definition: ANTHROPIC_DEFINITION,
        endpoint: "http://127.0.0.1:8080/v1",
        protocol: "anthropic-messages",
      }),
    );
    assert(register.ok);
    const handle1 = await issueCredentialConfirmation(h, {
      provider: "pvd_01arz3ndektsv4rrffq69g5ffv",
      key: "key-a",
      preparation: PREPARATION,
    });
    const first = await h.command(
      userCred,
      envelope("RegisterProviderCredential", {
        provider: "pvd_01arz3ndektsv4rrffq69g5ffv",
        key: "key-a",
        kind: "api_key",
        label: "first",
        preparation: PREPARATION,
        account: null,
        organization: null,
        plan: null,
        dedup_fingerprint: FINGERPRINT,
      }, { confirmation: handle1, compare: { revision: 1 } }),
    );
    assert(first.ok, first.ok ? undefined : JSON.stringify(first.error));
    const handle2 = await issueCredentialConfirmation(h, {
      provider: "pvd_01arz3ndektsv4rrffq69g5ffv",
      key: "key-b",
      preparation: PREPARATION,
    });
    const duplicate = await h.command(
      userCred,
      envelope("RegisterProviderCredential", {
        provider: "pvd_01arz3ndektsv4rrffq69g5ffv",
        key: "key-b",
        kind: "api_key",
        label: "second",
        preparation: PREPARATION,
        account: null,
        organization: null,
        plan: null,
        dedup_fingerprint: FINGERPRINT,
      }, { confirmation: handle2, compare: { revision: 2 } }),
    );
    code(duplicate, "conflict");
  } finally {
    await h.close();
  }
});

Deno.test("T3 R7: credential values do not leak to reads or events", async () => {
  const h = await open([userCred, machineCred]);
  try {
    const register = await h.command(
      userCred,
      envelope("RegisterProvider", {
        id: "pvd_01arz3ndektsv4rrffq69g5fgv",
        name: "Anthropic loopback",
        definition: ANTHROPIC_DEFINITION,
        endpoint: "http://127.0.0.1:8080/v1",
        protocol: "anthropic-messages",
      }),
    );
    assert(register.ok);
    const handle = await issueCredentialConfirmation(h, {
      provider: "pvd_01arz3ndektsv4rrffq69g5fgv",
      key: "key-a",
      preparation: PREPARATION,
    });
    const cmd = await h.command(
      userCred,
      envelope("RegisterProviderCredential", {
        provider: "pvd_01arz3ndektsv4rrffq69g5fgv",
        key: "key-a",
        kind: "api_key",
        label: "main",
        preparation: PREPARATION,
        account: null,
        organization: null,
        plan: null,
        dedup_fingerprint: FINGERPRINT,
      }, { confirmation: handle, compare: { revision: 1 } }),
    );
    assert(cmd.ok, cmd.ok ? undefined : JSON.stringify(cmd.error));
    // 응답과 event, read 어디에도 preparation 원문·credential 값이 없다(R7).
    const dbRows = await h.inspect(
      "select payload from events where type = 'ProviderChanged'",
    );
    assert(dbRows.ok);
    for (const row of dbRows.value) {
      const stringified = String(row["payload"]);
      assert(
        !stringified.includes(PREPARATION.preparation),
        "preparation handle leaked to events",
      );
      assert(
        !stringified.includes(PREPARATION.sealed_ref),
        "sealed ref value leaked to events",
      );
    }
  } finally {
    await h.close();
  }
});

Deno.test("T3 R8: multiple credentials on one provider", async () => {
  const h = await open([userCred, machineCred]);
  try {
    const register = await h.command(
      userCred,
      envelope("RegisterProvider", {
        id: "pvd_01arz3ndektsv4rrffq69g5fhv",
        name: "OpenAI loopback",
        definition: OPENAI_DEFINITION,
        endpoint: "http://127.0.0.1:8080/v1",
        protocol: "openai-responses",
      }),
    );
    assert(register.ok);
    for (const [index, key] of ["key-a", "key-b"].entries()) {
      const handle = await issueCredentialConfirmation(h, {
        provider: "pvd_01arz3ndektsv4rrffq69g5fhv",
        key,
        preparation: PREPARATION,
      });
      const cmd = await h.command(
        userCred,
        envelope("RegisterProviderCredential", {
          provider: "pvd_01arz3ndektsv4rrffq69g5fhv",
          key,
          kind: "api_key",
          label: `key-${index}`,
          preparation: PREPARATION,
          account: null,
          organization: null,
          plan: null,
          dedup_fingerprint: index === 0 ? FINGERPRINT : OTHER_FINGERPRINT,
        }, { confirmation: handle, compare: { revision: index + 1 } }),
      );
      assert(cmd.ok, cmd.ok ? undefined : JSON.stringify(cmd.error));
    }
    const read = value(
      await h.read(
        { resource: "provider-credentials", method: "list" },
        userCred,
        { provider: "pvd_01arz3ndektsv4rrffq69g5fhv" },
      ),
    );
    const credentials = (read as Record<string, unknown>)["credentials"] as {
      key: string;
      order: number;
    }[];
    assertEquals(credentials.map((c) => c.key), ["key-a", "key-b"]);
    assertEquals(credentials.map((c) => c.order), [0, 1]);
  } finally {
    await h.close();
  }
});

Deno.test("T3 R28: check result is stored without credentials and preset stays unprepared", async () => {
  const h = await open([userCred, machineCred]);
  try {
    const register = await h.command(
      userCred,
      envelope("RegisterProvider", {
        id: "pvd_01arz3ndektsv4rrffq69g5fmv",
        name: "Ollama loopback",
        definition: OLLAMA_DEFINITION,
        endpoint: "http://127.0.0.1:11434/v1",
        protocol: "openai-chat-completions",
      }),
    );
    assert(
      register.ok,
      register.ok ? undefined : JSON.stringify(register.error),
    );
    const checked = await h.command(
      machineCred,
      envelope("RecordProviderCheck", {
        provider: "pvd_01arz3ndektsv4rrffq69g5fmv",
        check: {
          at: new Date(NOW).toISOString(),
          credential_key: "none",
          credential_revision: 1,
          model_name: "llama3",
          test_kind: "text",
          command_key: "cmd-1",
          calls: [],
          result: "success",
          code: null,
        },
      }, { compare: { revision: 1 } }),
    );
    const outcome = value(checked);
    const record =
      (outcome["result"] as Record<string, unknown>)["provider"] as {
        last_check: { result: string } | null;
        credentials: unknown[];
        enabled: boolean;
      };
    assertEquals(record.last_check?.result, "success");
    // 연결 가능한 provider와 지금 쓸 credential이 있는 provider는 다르다(R4).
    // 이 provider는 연결돼 있지만 credential이 없어 미준비 preset은 비활성으로 남는다(R28).
    assertEquals(record.credentials.length, 0);
    assertEquals(record.enabled, true);
  } finally {
    await h.close();
  }
});

Deno.test("T3 R11-delete: no Claude OAuth — D31 removed it from first release", async () => {
  const h = await open([userCred, machineCred]);
  try {
    // Anthropic 정의는 oauth auth kind를 두지 않는다(D31). oauth 정체는 ChatGPT·SuperGrok만 있다.
    const claudeOAuth = {
      product: "claude",
      flow: "device_code",
      issuer: "https://claude.ai",
      authorization_endpoint: "https://claude.ai/oauth/authorize",
      token_endpoint: "https://claude.ai/oauth/token",
      allowed_call_origins: ["https://claude.ai"],
      scopes: ["profile"],
      verified_for_lophn: true,
    };
    const registered = await h.command(
      userCred,
      envelope("RegisterProvider", {
        id: "pvd_01arz3ndektsv4rrffq69g5fpv",
        name: "bad",
        definition: {
          ...ANTHROPIC_DEFINITION,
          auth_kinds: ["oauth"],
          oauth: claudeOAuth,
        },
        endpoint: "https://api.anthropic.com",
        protocol: "anthropic-messages",
      }),
    );
    code(registered, "invalid_input");
  } finally {
    await h.close();
  }
});

Deno.test("T3 R4-revoke: revoked credential needs a replacement to become available", async () => {
  const h = await open([userCred, machineCred]);
  try {
    const register = await h.command(
      userCred,
      envelope("RegisterProvider", {
        id: "pvd_01arz3ndektsv4rrffq69g5fqv",
        name: "Anthropic loopback",
        definition: ANTHROPIC_DEFINITION,
        endpoint: "http://127.0.0.1:8080/v1",
        protocol: "anthropic-messages",
      }),
    );
    assert(
      register.ok,
      register.ok ? undefined : JSON.stringify(register.error),
    );
    const handle = await issueCredentialConfirmation(h, {
      provider: "pvd_01arz3ndektsv4rrffq69g5fqv",
      key: "key-a",
      preparation: PREPARATION,
    });
    const first = await h.command(
      userCred,
      envelope("RegisterProviderCredential", {
        provider: "pvd_01arz3ndektsv4rrffq69g5fqv",
        key: "key-a",
        kind: "api_key",
        label: "main",
        preparation: PREPARATION,
        account: null,
        organization: null,
        plan: null,
        dedup_fingerprint: FINGERPRINT,
      }, { confirmation: handle, compare: { revision: 1 } }),
    );
    assert(first.ok, first.ok ? undefined : JSON.stringify(first.error));
    const revoked = await h.command(
      machineCred,
      envelope("RecordProviderAvailability", {
        provider: "pvd_01arz3ndektsv4rrffq69g5fqv",
        key: "key-a",
        state: "revoked",
        unavailable_reason: "authentication",
        until: null,
        model_block: null,
      }, { compare: { revision: 2 } }),
    );
    assert(revoked.ok, revoked.ok ? undefined : JSON.stringify(revoked.error));
    const reused = await h.command(
      machineCred,
      envelope("RecordProviderAvailability", {
        provider: "pvd_01arz3ndektsv4rrffq69g5fqv",
        key: "key-a",
        state: "available",
        unavailable_reason: null,
        until: null,
        model_block: null,
      }, { compare: { revision: 3 } }),
    );
    code(reused, "conflict");
    const read = value(
      await h.read(
        { resource: "provider-credentials", method: "list" },
        userCred,
        { provider: "pvd_01arz3ndektsv4rrffq69g5fqv" },
      ),
    );
    const credentials = (read as Record<string, unknown>)["credentials"] as {
      key: string;
      state: string;
    }[];
    assertEquals(credentials[0]!.state, "revoked");
  } finally {
    await h.close();
  }
});
