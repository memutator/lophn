// platform/secrets#R1 platform/redaction#R1 lophn-agent/extensions#R17 [agent-I52]: MCP credential의 알려진 값 참조 통로는
// 설정이 가리키는 secrets 표의 참조에 더해 OAuth token 보관이 가진 참조도 낸다. 값은 어디에도 없고 이름과 참조만 있다.
import { assert, assertEquals } from "@std/assert";
import { createMcpSecretRefSource, MCP_SECRET_OWNER } from "./mod.ts";

type Rows = Record<string, string | number | null>[];

// 설정 행과 secrets 표만 흉내 내는 읽기 눈이다.
function sqlOf(options: { setting?: unknown; secrets?: Rows }) {
  return {
    all(query: string): Rows {
      if (query.includes("from setting_choices")) {
        return options.setting === undefined
          ? []
          : [{ value: JSON.stringify(options.setting) }];
      }
      if (query.includes("from secrets")) return options.secrets ?? [];
      return [];
    },
  };
}

const OAUTH_REFS = [
  { name: "mcp-oauth/global/notes/access", sealedRef: "sealed-a" },
  { name: "mcp-oauth/global/notes/refresh", sealedRef: "sealed-r" },
];

Deno.test("platform/secrets#R1 lophn-agent/extensions#R17 [agent-I52]: OAuth 보관이 가진 참조는 설정에 secret 참조가 하나도 없어도 알려진 값 참조로 나온다", () => {
  const source = createMcpSecretRefSource(() => OAUTH_REFS);
  assertEquals(source.owner, MCP_SECRET_OWNER);
  const read = source.read(sqlOf({}));
  assert(read.ok);
  assertEquals(read.value, OAUTH_REFS);
});

Deno.test("platform/secrets#R1 lophn-agent/extensions#R17 [agent-I52]: 설정이 가리키는 bearer 참조와 OAuth 보관 참조가 함께 나오고 참조가 없는 core는 비어 있다", () => {
  const bearer = {
    all: sqlOf({
      setting: [{
        name: "notes",
        http: {
          url: "https://mcp.example.test/rpc",
          headers: {},
          auth: { kind: "bearer", secret_ref: "sec:mcp-notes" },
        },
      }],
      secrets: [{ name: "mcp-notes", sealed_ref: "sealed-b" }],
    }).all,
  };
  const source = createMcpSecretRefSource(() => OAUTH_REFS);
  const read = source.read(bearer);
  assert(read.ok);
  assertEquals(
    read.value.map((ref) => ref.name).sort(),
    ["mcp-notes", ...OAUTH_REFS.map((ref) => ref.name)].sort(),
  );
  // OAuth 보관이 없으면 이전과 같다.
  const plain = createMcpSecretRefSource();
  const nothing = plain.read(sqlOf({}));
  assert(nothing.ok);
  assertEquals(nothing.value, []);
});
