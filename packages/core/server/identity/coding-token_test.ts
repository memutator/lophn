import { assert, assertEquals } from "@std/assert";
import { cryptoRandom, manualClock } from "../../../base/mod.ts";
import {
  CODING_CLI_COMMANDS,
  CODING_MCP_OPERATION,
} from "../../../protocol/coding-agent/mod.ts";
import { ticketUploadSummary } from "../../../protocol/coding-agent/ticket/mod.ts";
import { createCodingTokens } from "./coding-token.ts";
import { type OperationPolicy } from "./model.ts";
import { CredentialRegistry } from "./registry.ts";

const id = (prefix: string, n: number) =>
  `${prefix}_${String(n).padStart(26, "0")}`;

const tokenRoutes = [
  ticketUploadSummary.name,
  CODING_MCP_OPERATION,
  ...CODING_CLI_COMMANDS.flatMap((command) =>
    command.auth === "coding_token" && command.route ? [command.route.name] : []
  ),
];
const OUTSIDE = "approvals.decide";

Deno.test("coding token은 그 앱 하나만 열고 회수하면 새 호출이 거절된다", async () => {
  const registry = new CredentialRegistry({
    epoch: "epoch",
    random: cryptoRandom,
    clock: manualClock(Date.parse("2026-10-16T00:00:00Z")),
    operations: [
      ...tokenRoutes.map((name): OperationPolicy => ({
        name,
        actors: ["coding_agent"],
        kind: "read",
      })),
      { name: OUTSIDE, actors: ["user"], kind: "command" },
    ],
  });
  const tokens = createCodingTokens({ registry });
  const [appA, appB] = [id("app", 1), id("app", 2)];
  const [s1, s2] = [id("ses", 1), id("ses", 2)];
  const first = tokens.issue({ session: s1, app: appA });
  const second = tokens.issue({ session: s2, app: appA });
  assert(first.ok && second.ok);

  const auth = await registry.authenticate(first.value.token);
  assert(auth.ok);
  const operation = tokenRoutes[0];
  assert(registry.authorize(auth.value, operation, { app: appA }).ok);
  const otherApp = registry.authorize(auth.value, operation, { app: appB });
  // 다른 앱은 있는지도 알려 주지 않는다.
  assert(!otherApp.ok && otherApp.error.code === "not_found");
  const outside = registry.authorize(auth.value, OUTSIDE, { app: appA });
  assert(!outside.ok && outside.error.code === "forbidden");

  assert(tokens.revoke(s1).ok);
  const revoked = await registry.authenticate(first.value.token);
  assert(!revoked.ok && revoked.error.code === "unauthorized");
  assertEquals(
    revoked.ok ? "" : revoked.error.message.includes(first.value.token),
    false,
  );
  assert((await registry.authenticate(second.value.token)).ok);
});
