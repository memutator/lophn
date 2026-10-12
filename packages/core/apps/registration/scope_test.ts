// 앱 하나 범위 connection의 읽기·쓰기 범위 시험이다(apps/registration#R3, coding-agent/connection#R5).
// 범위 밖 앱은 없는 앱과 같은 응답이고 목록에는 범위 안 앱만 있으며 범위 밖 앱에는 source를
// 연결하지 못한다. 실제 ledger harness를 쓴다.
import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../../base/mod.ts";
import type {
  AuthenticatedContext,
  SqlRow,
} from "../../../protocol/server/mod.ts";

type CommandEnvelope = {
  command: string;
  input: unknown;
  idempotency_key: string;
  compare: unknown;
  prepared: readonly string[];
};
type CommandSuccess = { result: unknown; replayed: boolean };
type LedgerHarness = {
  command(
    ctx: AuthenticatedContext,
    envelope: CommandEnvelope,
  ): Promise<Result<CommandSuccess>>;
  read(
    route: { resource: string; method: string },
    ctx: AuthenticatedContext,
    input: unknown,
  ): Promise<Result<unknown>>;
  inspect(
    query: string,
    params?: readonly unknown[],
  ): Promise<Result<SqlRow[]>>;
  setCredential(ctx: AuthenticatedContext): Promise<Result<void>>;
  close(): Promise<void>;
};

const registration = new URL("../../../../apps/core/apps.ts", import.meta.url);
const documents = new URL(
  "../../../../apps/core/documents.ts",
  import.meta.url,
);
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const ABSENT = "app_01arz3ndektsv4rrffq69g5fb9";
const OPERATIONS = [
  "app.create",
  "app.connect_source",
  "app.list",
  "app.get",
  "project.create",
  "CommandResult",
];

function credential(
  actor: string,
  ref: string,
  conditions: Record<string, string> = {},
): AuthenticatedContext {
  return {
    actor,
    principal: "test-user",
    credential_ref: ref,
    scope: { operations: OPERATIONS, targets: {} },
    conditions,
  };
}

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function envelope(
  command: string,
  key: string,
  input: unknown,
  compare: unknown = {},
): CommandEnvelope {
  return {
    command,
    input,
    compare,
    idempotency_key: key,
    prepared: [],
  };
}

Deno.test("apps/registration#R3, coding-agent/connection#R5: 앱 하나 범위 connection은 자기 앱만 읽고 연결한다", async () => {
  const user = credential("user", "test:user");
  const specifier = "../../../apps/core/testing/ledger.ts";
  const harness = await import(specifier);
  const opened: LedgerHarness = value(
    await harness.createLedgerHarness({
      registrationModules: [documents, registration],
      credentials: [user],
    }),
  );
  try {
    const make = async (slug: string) => (value(
      await opened.command(
        user,
        envelope("app.create", `create-${slug}`, {
          slug,
          name: slug,
          description: "collect usage",
        }),
      ),
    ).result as { id: string; revision: string });
    const own = (await make("first")).id;
    const foreignApp = await make("second");
    const other = foreignApp.id;
    const scoped = credential(
      `coding_agent:${CAC}`,
      "test:scoped",
      { app: own },
    );
    await opened.setCredential(scoped);

    const listed = value(
      await opened.read({ resource: "apps", method: "list" }, scoped, {}),
    ) as { apps: { id: string }[] };
    assertEquals(listed.apps.map((app) => app.id), [own]);

    const read = (app: string) =>
      opened.read({ resource: "apps", method: "get" }, scoped, { app });
    value(await read(own));
    const absent = await read(ABSENT);
    const foreign = await read(other);
    assert(!absent.ok && !foreign.ok);
    assertEquals(foreign.error, absent.error);

    const connect = (app: string, key: string, revision: string) =>
      opened.command(
        scoped,
        envelope(
          "app.connect_source",
          key,
          { app, source_path: "/tmp/foreign" },
          { base_revision: revision },
        ),
      );
    const refused = await connect(other, "source-foreign", foreignApp.revision);
    const refusedAbsent = await connect(ABSENT, "source-absent", "1");
    assert(!refused.ok && !refusedAbsent.ok);
    assertEquals(refused.error, refusedAbsent.error);
    const row = value(
      await opened.inspect("select source_path from apps where id = ?", [
        other,
      ]),
    )[0];
    assertEquals(row.source_path, null);
  } finally {
    await opened.close();
  }
});
