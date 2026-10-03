import { ok } from "../../base/mod.ts";
import {
  identityCurrent,
  type ReadDefinition,
} from "../../contracts/platform/mod.ts";
import { authorize } from "./model.ts";
import type { CredentialRegistry } from "./registry.ts";

export function identityCurrentRead(
  registry: CredentialRegistry,
): ReadDefinition<typeof identityCurrent> {
  return {
    route: identityCurrent,
    handle(snapshot, ctx) {
      const current = registry.revalidate(ctx);
      if (!current.ok) return current;
      const allowed = authorize(
        current.value,
        "identity/current",
        current.value.scope.targets,
      );
      if (!allowed.ok) return allowed;
      return ok({
        actor: current.value.actor,
        scope: current.value.scope,
        conditions: current.value.conditions,
        as_of_seq: snapshot.as_of_seq,
        next_cursor: null,
      });
    },
  };
}
