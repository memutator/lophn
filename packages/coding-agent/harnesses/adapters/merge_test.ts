// 설정 merge 테스트다(coding-agent/harnesses#R8, T29). lophn 소유 key만 바꾸고
// 기존 server·env·permission은 보존하며 깨진 설정은 무변경이다.
import { assert, assertEquals } from "@std/assert";
import { ownedFragment, parseJson, removeOwned, setOwned } from "./json.ts";
import {
  parseToml as parseTomlText,
  removeOwned as removeToml,
  setOwned as setToml,
} from "./toml.ts";
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

// 사람의 주석·빈 줄·테이블 스타일은 텍스트 패치로 그대로 남는다(T30).
Deno.test("coding-agent/harnesses#R8: TOML patch는 주석·빈 줄·다른 표의 bytes를 보존한다", () => {
  // 사람이 쓰던 config.toml이다. 주석·빈 줄·quote 없는 값·다른 표가 있다.
  const before = [
    "# 사람의 주석이다",
    'editor = "vim"',
    "",
    "[mcp_servers.other]",
    '  command = "uvx --from mcp-other other-server"',
    "  # 다른 서버 주석",
    '  args = ["--flag"]',
    "",
    "[mcp_servers.profile]",
    "command = 'literal'",
    "",
    "[features]",
    "flag = true",
    "",
  ].join("\n");
  const set = setToml(before, "mcp_servers.lophn", {
    command: "lophn",
    args: ["--connection", "cac_x"],
    env: { LOPHN_MCP_TOOLSETS: "core" },
  });
  assert(set.kind === "changed");
  if (set.kind !== "changed") return;
  // 주석·빈 줄·다른 표의 원문은 그대로다(T30).
  assert(set.text.includes("# 사람의 주석이다"));
  assert(set.text.includes('editor = "vim"'));
  assert(set.text.includes("# 다른 서버 주석"));
  assert(set.text.includes("command = 'literal'"));
  assert(set.text.includes("flag = true"));
  // 소유 표의 기존 스타일은 흉내 내지 않고, 몸만 최소 표기로 바꾼다.
  const parsed = parseTomlText(set.text);
  assert(parsed.ok);
  if (!parsed.ok) return;
  const servers = parsed.value.mcp_servers as Record<
    string,
    Record<string, unknown>
  >;
  assertEquals(servers.lophn, {
    command: "lophn",
    args: ["--connection", "cac_x"],
    env: { LOPHN_MCP_TOOLSETS: "core" },
  });
  assertEquals(
    (servers.other as Record<string, unknown>).args,
    ["--flag"],
  );
  // 같은 값이면 파일을 바꾸지 않는다.
  assertEquals(
    setToml(set.text, "mcp_servers.lophn", {
      command: "lophn",
      args: ["--connection", "cac_x"],
      env: { LOPHN_MCP_TOOLSETS: "core" },
    }).kind,
    "unchanged",
  );
  // 제거는 소유 표 행만 빼고 주석·빈 줄·다른 표를 남긴다.
  const removed = removeToml(set.text, "mcp_servers.lophn");
  assert(removed.kind === "changed");
  if (removed.kind !== "changed") return;
  assert(!removed.text.includes("lophn"));
  assert(removed.text.includes("# 사람의 주석이다"));
  assert(removed.text.includes("# 다른 서버 주석"));
  assert(removed.text.includes("command = 'literal'"));
  const gone = parseTomlText(removed.text);
  assert(gone.ok);
  if (!gone.ok) return;
  const left = gone.value.mcp_servers as Record<string, unknown>;
  assertEquals(left.lophn, undefined);
  assertEquals(
    ((left.other as Record<string, unknown>) as Record<string, unknown>).args,
    ["--flag"],
  );
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

Deno.test("coding-agent/harnesses#R8: YAML 소유 블록의 args 목록을 바꿔도 주석·다른 key·다른 목록은 그대로다", () => {
  const before = [
    "# 사람의 주석이다",
    "mcp_servers:",
    "  # 다른 서버 주석",
    "  other:",
    "    command: keep",
    "    args:",
    "    - -y",
    "  lophn:",
    "    command: old",
    "    args:",
    "    - old",
    "    - --flag",
    "",
    "allow:",
    "- Bash",
    "",
  ].join("\n");
  const set = setYaml(before, "mcp_servers.lophn", {
    command: "lophn",
    args: ["mcp", "--x"],
  });
  assert(set.kind === "changed");
  if (set.kind !== "changed") return;
  assert(set.text.includes("# 사람의 주석이다\n"));
  assert(set.text.includes("  # 다른 서버 주석\n"));
  assert(set.text.includes("    args:\n    - -y\n"));
  assert(set.text.includes("\n\nallow:\n- Bash\n"));
  assert(!set.text.includes("old"));
  assert(set.text.includes('    args:\n      - mcp\n      - "--x"\n'));
  const after = parseYaml(set.text);
  assert(after.ok);
  if (!after.ok) return;
  assertEquals(after.value.allow, ["Bash"]);
  const servers = after.value.mcp_servers;
  assert(typeof servers !== "string" && !Array.isArray(servers));
  assertEquals(servers.other, { command: "keep", args: ["-y"] });
  assertEquals(servers.lophn, { command: "lophn", args: ["mcp", "--x"] });
  // 제거는 소유 블록의 목록까지 빼고 나머지는 남긴다.
  const removed = removeYaml(set.text, "mcp_servers.lophn");
  assert(removed.kind === "changed");
  if (removed.kind !== "changed") return;
  assert(!removed.text.includes("lophn") && !removed.text.includes("--x"));
  assert(removed.text.includes("# 사람의 주석이다"));
  assert(removed.text.includes("- Bash"));
});

Deno.test("coding-agent/harnesses#R8: 깨진 YAML 목록은 무변경이다", () => {
  assertEquals(setYaml("a:\n  - x: y\n", "m.l", {}).kind, "broken");
  assertEquals(setYaml("- x\n", "m.l", {}).kind, "broken");
  assertEquals(setYaml("a:\n  - x\nb: 1\n- y\n", "m.l", {}).kind, "broken");
});

// 사람의 주석·빈 줄·다른 key는 텍스트 패치로 그대로 남는다(T30).
Deno.test("coding-agent/harnesses#R8: YAML patch는 주석·빈 줄·다른 key의 bytes를 보존한다", () => {
  // Hermes config.yaml이다(문서 예제를 fixture로 다시 쓴 것). 주석·빈 줄·
  // 다른 key가 있다.
  const before = [
    "# 사람의 주석이다",
    "editor: vim",
    "",
    "mcp_servers:",
    "  other:",
    "    # 다른 서버 주석",
    "    command: keep",
    "    args:",
    "      - --flag",
    "",
    "features:",
    "  flag: true",
    "",
  ].join("\n");
  const set = setYaml(before, "mcp_servers.lophn", {
    command: "lophn",
    args: "one",
  });
  assert(set.kind === "changed");
  if (set.kind !== "changed") return;
  // 주석·빈 줄·다른 key의 원문은 그대로다(T30).
  assert(set.text.includes("# 사람의 주석이다"));
  assert(set.text.includes("editor: vim"));
  assert(set.text.includes("# 다른 서버 주석"));
  assert(set.text.includes("- --flag"));
  assert(set.text.includes("flag: true"));
  const after = parseYaml(set.text);
  assert(after.ok);
  if (!after.ok) return;
  const servers = after.value.mcp_servers;
  assert(typeof servers !== "string" && !Array.isArray(servers));
  assertEquals(servers.lophn, { command: "lophn", args: "one" });
  assert(typeof servers.other !== "string" && !Array.isArray(servers.other));
  assertEquals(servers.other.command, "keep");
  // 소유 조각을 다시 바꾸면 상위 블록 몸 안에서 몸만 바꾼다.
  const updated = setYaml(set.text, "mcp_servers.lophn", { command: "lophn2" });
  assert(updated.kind === "changed");
  if (updated.kind !== "changed") return;
  const again = parseYaml(updated.text);
  assert(again.ok);
  if (!again.ok) return;
  const next = again.value.mcp_servers;
  assert(typeof next !== "string" && !Array.isArray(next));
  assertEquals(next.lophn, { command: "lophn2" });
  assert(typeof next.other !== "string" && !Array.isArray(next.other));
  assertEquals(next.other.command, "keep");
  assert(updated.text.includes("# 다른 서버 주석"));
  // 제거는 소유 블록만 빼고 주석·빈 줄·다른 key를 남긴다.
  const removed = removeYaml(updated.text, "mcp_servers.lophn");
  assert(removed.kind === "changed");
  if (removed.kind !== "changed") return;
  assert(!removed.text.includes("lophn"));
  assert(removed.text.includes("# 사람의 주석이다"));
  assert(removed.text.includes("# 다른 서버 주석"));
  const gone = parseYaml(removed.text);
  assert(gone.ok);
  if (!gone.ok) return;
  const left = gone.value.mcp_servers;
  assert(typeof left !== "string" && !Array.isArray(left));
  assertEquals(left.lophn, undefined);
  assert(typeof left.other !== "string" && !Array.isArray(left.other));
  assertEquals(left.other.command, "keep");
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

Deno.test("coding-agent/guides#R15: 관리 구간은 안쪽만 바꾸고 marker 없음·중복은 무변경이다", async () => {
  const { setRegion, removeRegion } = await import("./region.ts");
  const text =
    "앞\n<!-- begin lophn-managed -->\n옛\n<!-- end lophn-managed -->\n뒤\n";
  const set = setRegion(text, "@AGENTS.md");
  assertEquals(
    set.kind === "changed" && set.text,
    "앞\n<!-- begin lophn-managed -->\n@AGENTS.md\n<!-- end lophn-managed -->\n뒤\n",
  );
  assertEquals(
    setRegion(set.kind === "changed" ? set.text : "", "@AGENTS.md"),
    {
      kind: "unchanged",
    },
  );
  assertEquals(setRegion("없음\n", "x"), { kind: "broken" });
  assertEquals(setRegion(text + text, "x"), { kind: "broken" });
  const gone = removeRegion(set.kind === "changed" ? set.text : "");
  assertEquals(
    gone.kind === "changed" && gone.text,
    "앞\n<!-- begin lophn-managed -->\n<!-- end lophn-managed -->\n뒤\n",
  );
});

Deno.test("coding-agent/harnesses#R8: JSON 배열 원소 소유는 다른 원소를 보존하고 그 원소만 지운다", () => {
  const text = '{"context":{"fileName":["A.md","B.md"]}}\n';
  const set = setOwned(text, "context.fileName#AGENTS.md", "AGENTS.md");
  assert(set.kind === "changed");
  if (set.kind !== "changed") return;
  assertEquals(JSON.parse(set.text).context.fileName, [
    "A.md",
    "B.md",
    "AGENTS.md",
  ]);
  assertEquals(
    setOwned(set.text, "context.fileName#AGENTS.md", "AGENTS.md").kind,
    "unchanged",
  );
  const removed = removeOwned(set.text, "context.fileName#AGENTS.md");
  assert(removed.kind === "changed");
  if (removed.kind !== "changed") return;
  assertEquals(JSON.parse(removed.text).context.fileName, ["A.md", "B.md"]);
});

Deno.test("coding-agent/harnesses#R8: 없는 config.toml은 빈 표로 시작해 처음 설치한다", () => {
  const set = setToml("", "mcp_servers.lophn", { command: "x" });
  assert(set.kind === "changed");
});
