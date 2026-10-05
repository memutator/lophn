// 설정 merge 테스트다(coding-agent/harnesses#R8, T29). lophn 소유 key만 바꾸고
// 기존 server·env·permission은 보존하며 깨진 설정은 무변경이다.
import { assert, assertEquals } from "@std/assert";
import { ownedFragment, parseJson, removeOwned, setOwned } from "./json.ts";
import { removeOwned as removeToml, setOwned as setToml } from "./toml.ts";
import {
  parseYaml,
  removeOwned as removeYaml,
  setOwned as setYaml,
} from "./yaml.ts";

Deno.test("coding-agent/harnesses#R8: JSON은 소유 key만 넣고 주변 key를 보존한다", () => {
  const before =
    '{\n  "mcpServers": { "other": { "command": "keep" } },\n  "env": { "A": "1" }\n}\n';
  const set = setOwned(before, "mcpServers.lophn", { command: "lophn" });
  assert(set.kind === "changed");
  if (set.kind !== "changed") return;
  const parsed = parseJson(set.text);
  assert(parsed.ok);
  if (!parsed.ok) return;
  assertEquals(parsed.value.mcpServers, {
    other: { command: "keep" },
    lophn: { command: "lophn" },
  });
  assertEquals(parsed.value.env, { A: "1" });
  // 같은 값이면 파일을 바꾸지 않는다.
  assertEquals(
    setOwned(set.text, "mcpServers.lophn", { command: "lophn" }).kind,
    "unchanged",
  );
});

Deno.test("coding-agent/harnesses#R8: JSON 제거는 소유 key만 지운다", () => {
  const text =
    '{"mcpServers":{"lophn":{"command":"lophn"},"other":{"command":"keep"}}}';
  const removed = removeOwned(text, "mcpServers.lophn");
  assert(removed.kind === "changed");
  if (removed.kind !== "changed") return;
  const parsed = parseJson(removed.text);
  assert(parsed.ok);
  if (!parsed.ok) return;
  assertEquals(parsed.value.mcpServers, { other: { command: "keep" } });
  // 없는 key는 무변경이다.
  assertEquals(removeOwned(removed.text, "mcpServers.lophn").kind, "unchanged");
});

Deno.test("coding-agent/harnesses#R8: 깨진 JSON·TOML·YAML은 무변경이다", () => {
  assertEquals(setOwned("{ broken", "mcpServers.lophn", {}).kind, "broken");
  assertEquals(setToml("= broken", "mcp_servers.lophn", {}).kind, "broken");
  assertEquals(setYaml(":\n broken", "mcp_servers.lophn", {}).kind, "broken");
});

Deno.test("coding-agent/harnesses#R8: TOML은 소유 테이블만 넣고 다른 테이블을 보존한다", () => {
  const before =
    '[mcp_servers.other]\ncommand = "keep"\n\n[permissions]\nallow = ["Bash"]\n';
  const set = setToml(before, "mcp_servers.lophn", { command: "lophn" });
  assert(set.kind === "changed");
  if (set.kind !== "changed") return;
  assert(set.text.includes("keep"));
  assert(set.text.includes("Bash"));
  assert(set.text.includes("lophn"));
  const removed = removeToml(set.text, "mcp_servers.lophn");
  assert(removed.kind === "changed");
  if (removed.kind !== "changed") return;
  assert(!removed.text.includes("lophn"));
  assert(removed.text.includes("keep"));
});

Deno.test("coding-agent/harnesses#R8: YAML은 소유 map만 넣고 다른 key를 보존한다", () => {
  const before = 'mcp_servers:\n  other:\n    command: keep\nenv:\n  A: "1"\n';
  const parsed = parseYaml(before);
  assert(parsed.ok);
  const set = setYaml(before, "mcp_servers.lophn", { command: "lophn" });
  assert(set.kind === "changed");
  if (set.kind !== "changed") return;
  const after = parseYaml(set.text);
  assert(after.ok);
  if (!after.ok) return;
  assertEquals(after.value.env, { A: "1" });
  const servers = after.value.mcp_servers;
  assert(typeof servers !== "string" && !Array.isArray(servers));
  assertEquals(servers.other, { command: "keep" });
  assertEquals(servers.lophn, { command: "lophn" });
  const removed = removeYaml(set.text, "mcp_servers.lophn");
  assert(removed.kind === "changed");
  if (removed.kind !== "changed") return;
  const gone = parseYaml(removed.text);
  assert(gone.ok);
  if (!gone.ok) return;
  const left = gone.value.mcp_servers;
  assert(typeof left !== "string" && !Array.isArray(left));
  assertEquals(left.lophn, undefined);
  assertEquals(left.other, { command: "keep" });
});

Deno.test("coding-agent/harnesses#R8: YAML install은 args를 block sequence로 쓰고 다시 읽으면 배열이다", () => {
  const before = "mcp_servers:\n  other:\n    command: keep\n";
  const owned = {
    command: "lophn",
    args: ["mcp", "--flag", "@scope/x y", "-y"],
    env: { A: "1" },
  };
  const set = setYaml(before, "mcp_servers.lophn", owned);
  assert(set.kind === "changed");
  if (set.kind !== "changed") return;
  // index map(`0:`)이 아니라 `- ` 항목이다.
  assert(!/^\s*\d+:/m.test(set.text));
  assert(set.text.includes('    args:\n      - mcp\n      - "--flag"\n'));
  const after = parseYaml(set.text);
  assert(after.ok);
  if (!after.ok) return;
  const servers = after.value.mcp_servers;
  assert(typeof servers !== "string" && !Array.isArray(servers));
  assertEquals(servers.lophn, owned);
  assertEquals(servers.other, { command: "keep" });
  // 같은 값을 다시 install하면 무변경이다.
  assertEquals(setYaml(set.text, "mcp_servers.lophn", owned).kind, "unchanged");
  // 목록이 바뀌면 바뀐다.
  const next = setYaml(set.text, "mcp_servers.lophn", {
    ...owned,
    args: ["mcp"],
  });
  assert(next.kind === "changed");
});

Deno.test("coding-agent/harnesses#R8: YAML은 다른 server의 목록과 같은 들여쓰기 목록을 보존한다", () => {
  const before =
    'mcp_servers:\n  other:\n    command: keep\n    args:\n    - "-y"\n    - pkg\nallow:\n  - Bash\n';
  const set = setYaml(before, "mcp_servers.lophn", {
    command: "lophn",
    args: ["a"],
  });
  assert(set.kind === "changed");
  if (set.kind !== "changed") return;
  const after = parseYaml(set.text);
  assert(after.ok);
  if (!after.ok) return;
  assertEquals(after.value.allow, ["Bash"]);
  const servers = after.value.mcp_servers;
  assert(typeof servers !== "string" && !Array.isArray(servers));
  assertEquals(servers.other, { command: "keep", args: ["-y", "pkg"] });
  assertEquals(servers.lophn, { command: "lophn", args: ["a"] });
  const removed = removeYaml(set.text, "mcp_servers.lophn");
  assert(removed.kind === "changed");
  if (removed.kind !== "changed") return;
  assert(removed.text.includes("- pkg") && removed.text.includes("- Bash"));
});

Deno.test("coding-agent/harnesses#R8: 깨진 YAML 목록은 무변경이다", () => {
  assertEquals(setYaml("a:\n  - x: y\n", "m.l", {}).kind, "broken");
  assertEquals(setYaml("- x\n", "m.l", {}).kind, "broken");
});

Deno.test("coding-agent/harnesses#R7: 소유 조각 digest는 lophn key만 본다", () => {
  const text = '{"mcpServers":{"lophn":{"command":"lophn"}},"theme":"dark"}';
  const fragment = ownedFragment(text, "mcpServers.lophn");
  assert(fragment.ok);
  if (!fragment.ok) return;
  assertEquals(fragment.value, { command: "lophn" });
  // 없는 key는 null이다.
  const missing = ownedFragment(text, "mcpServers.absent");
  assert(missing.ok);
  if (!missing.ok) return;
  assertEquals(missing.value, null);
});
