import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../../base/mod.ts";
import { routePath } from "../../../protocol/base/mod.ts";
import {
  providerRead,
  type ProviderRecord,
} from "../../../protocol/lophn-agent/mod.ts";
import { bundledSnapshot } from "./snapshot-catalog.ts";
import { createModelResolver } from "./resolve.ts";

function resolverFor(definitionKey: string) {
  const provider: ProviderRecord = {
    id: "pvd_00000000000000000000000000",
    name: "mine",
    definition: {
      key: definitionKey,
      display_name: definitionKey,
      protocols: ["openai-chat-completions"],
      auth_kinds: ["none"],
      models_endpoint: null,
      oauth: null,
      revision: "test",
    },
    endpoint: "http://127.0.0.1:1",
    protocol: "openai-chat-completions",
    credential: {
      kind: "none",
      secret_ref: null,
      revision: 1,
      state: "available",
      unavailable_reason: null,
      until: null,
      expires_at: null,
      logged_in_at: null,
      refreshed_at: null,
      model_blocks: [],
      reported_models: null,
    },
    revision: 1,
  };
  return createModelResolver({
    machine: (path) =>
      Promise.resolve(
        path === routePath(providerRead)
          ? ok({ provider, as_of_seq: "0", next_cursor: null })
          : err({ code: "not_found", message: path }),
      ),
    catalog: () => Promise.resolve(ok(bundledSnapshot.entries)),
  });
}

const choice = (model_name: string) => ({
  provider: "pvd_00000000000000000000000000",
  model_name,
  option_values: {},
});

// custom provider에서 사람이 적은 model은 catalog에 없어도 turn을 준비할 수 있다. 오타를 막으려고
// 목록이 있는 provider의 모르는 이름은 계속 거절한다.
Deno.test("catalog에 목록이 없는 custom provider의 model은 기본 한계로 준비되고, 목록이 있는 provider의 모르는 이름은 거절된다", async () => {
  const custom = await resolverFor("my-local")({
    model: choice("whatever:7b"),
  });
  assert(custom.ok);
  assertEquals(custom.value.call.limits.context_limit, 131072);
  const typo = await resolverFor("anthropic")({ model: choice("claude-typo") });
  assert(!typo.ok);
  assertEquals(typo.error.code, "invalid_input");
});
