import { assertEquals } from "@std/assert";
import { rolePrompt } from "../../../packages/core/agent-roles/roles/prompts.ts";
import type {
  CollectedModelCall,
  CollectedToolCall,
  VersionRef,
} from "../types.ts";
import { refText } from "../types.ts";
import {
  classifyPath,
  registerAuthored,
  resolveVersion,
  seenComponents,
} from "./mod.ts";

async function withTemp(run: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "eval-versions-" });
  try {
    await run(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("같은 내용은 같은 n, 바뀐 내용은 새 n, 옛 내용은 옛 n이다. 작성자가 정한 n은 건너뛰어 올릴 수 있고 max 이하의 새 n과 n의 내용이 바뀐 것은 거절한다", async () => {
  await withTemp(async (dir) => {
    const at = async (hash: string) =>
      (await resolveVersion(dir, { kind: "tool", name: "ask", hash })).ref.n;
    assertEquals(
      [await at("a"), await at("a"), await at("b"), await at("a")],
      [1, 1, 2, 1],
    );

    const ref = (n: number): VersionRef => ({ kind: "scenario", name: "s", n });
    const code = async (n: number, hash: string) => {
      const r = await registerAuthored(dir, ref(n), hash);
      return r.ok ? r.value.created : r.error.code;
    };
    assertEquals(
      [
        await code(1, "x"),
        await code(1, "x"),
        await code(1, "y"),
        await code(3, "z"),
        await code(2, "w"),
        await code(3, "q"),
      ],
      [true, false, "conflict", true, "invalid_input", "conflict"],
    );
  });
});

const TOOL_SKILL = "packages/core/lophn-agent/tools/bundles/skill.ts";
const TOOL_GUIDE = "packages/core/agent-roles/tools/guide.ts";
const SKILL_MD = "packages/core/agent-roles/skills/foo/SKILL.md";

async function write(root: string, rel: string, text: string) {
  await Deno.mkdir(`${root}/${rel.slice(0, rel.lastIndexOf("/"))}`, {
    recursive: true,
  });
  await Deno.writeTextFile(`${root}/${rel}`, text);
}

const skillMd = (description: string, body: string) =>
  `---\nname: foo\ndescription: ${description}\n---\n${body}`;

const lophn = await rolePrompt("lophn");
if (!lophn.ok) throw new Error("lophn prompt");

function modelCall(first: string): CollectedModelCall {
  return {
    call: { purpose: "judgment" },
    request: {
      model: "claude-test",
      system: [
        { type: "text", text: first },
        { type: "text", text: "# Skills\nRead a skill.\n- foo: does foo" },
      ],
      tools: [{ name: "skill_read" }, { name: "guide_read" }],
    },
  } as unknown as CollectedModelCall;
}

const openedFoo = {
  call: { tool: "skill.read", outcome: { kind: "success" } },
  input: { name: "foo" },
} as unknown as CollectedToolCall;

Deno.test("연 skill만 본문 버전을 갖고 수정은 그 component의 n만 올린다", async () => {
  await withTemp(async (dir) => {
    const root = `${dir}/root`;
    const registryDir = `${dir}/registry`;
    await write(root, SKILL_MD, skillMd("does foo", "body 1"));
    await write(root, TOOL_SKILL, 'defineTool({ name: "skill.read" });');
    await write(root, TOOL_GUIDE, 'defineTool({ name: "guide.read" });');

    const seen = async (tool_calls: CollectedToolCall[]) => {
      const r = await seenComponents(
        [{ model_calls: [modelCall(lophn.value)], tool_calls }],
        { root, registryDir },
      );
      if (!r.ok) throw new Error(r.error.message);
      return r.value.map(refText).filter((t) => !/^(assembly|runtime)/.test(t));
    };
    const base = [
      "instruction:lophn@1",
      "model:claude-test@1",
      "skill-description:foo@1",
      "tool:guide.read@1",
      "tool:skill.read@1",
    ];

    assertEquals(await seen([]), base);
    assertEquals(await seen([openedFoo]), [...base, "skill:foo@1"].sort());

    await write(root, SKILL_MD, skillMd("does foo", "body 2"));
    assertEquals(await seen([openedFoo]), [...base, "skill:foo@2"].sort());

    // frontmatter는 본문 버전에 들지 않는다. description 버전은 요청의 skills 블록이 정한다.
    await write(root, SKILL_MD, skillMd("does foo well", "body 2"));
    assertEquals(await seen([openedFoo]), [...base, "skill:foo@2"].sort());

    await write(root, TOOL_SKILL, 'defineTool({ name: "skill.read" }); // v2');
    assertEquals(
      (await seen([])).filter((t) => t.startsWith("tool:")),
      ["tool:guide.read@1", "tool:skill.read@2"],
    );

    const bad = await seenComponents(
      [{ model_calls: [modelCall("not a role prompt")], tool_calls: [] }],
      { root, registryDir },
    );
    assertEquals(bad.ok ? null : bad.error.code, "invalid_input");
  });
});

Deno.test("classifyPath는 component, tool, runtime, core를 가르고 shell·design·test는 어디에도 넣지 않는다", () => {
  const R = "packages/core/agent-roles";
  const rows: [string, string][] = [
    [`${R}/roles/lophn/prompt.md`, "instruction"],
    [`${R}/roles/prompts.ts`, "instruction"],
    [`${R}/roles/guides.ts`, "guide"],
    [`${R}/roles/lophn/guides/rewind.md`, "guide"],
    [`${R}/skills/kinds-yaml/SKILL.md`, "skill:kinds-yaml"],
    [`${R}/skills/root.ts`, "runtime"],
    [
      "packages/coding-agent/guides/skills/lophn-repair/references/investigation.md",
      "skill:lophn-repair",
    ],
    [
      "packages/core/apps/packages/template/app/tests/items_test.ts.tmpl",
      "template",
    ],
    ["packages/core/apps/packages/template/scaffold.ts", "core"],
    ["packages/core/lophn-agent/prompt-assembly/skill-list.ts", "assembly"],
    ["packages/core/lophn-agent/tools/bundles/file.ts", "tool"],
    ["packages/core/problems/agent-tools.ts", "tool"],
    [`${R}/tools/guide.ts`, "tool"],
    ["packages/core/lophn-agent/tools/define.ts", "runtime"],
    [`${R}/tool-lists.ts`, "runtime"],
    ["packages/core/main/agent-runtime/loop.ts", "runtime"],
    ["packages/core/apps/agent-tools/helper.ts", "runtime"],
    ["packages/core/apps/agent-tools/app.ts", "tool"],
    ["packages/protocol/base/mod.ts", "core"],
    ["packages/sdk/foo/guide.md", "core"],
    ["deno.json", "core"],
    ["deno.lock", "core"],
    ["packages/shell/main/x.ts", "none"],
    ["packages/design/x.ts", "none"],
    ["packages/core/lophn-agent/loop_test.ts", "none"],
    ["packages/core/node_modules/x/index.js", "none"],
    ["tests/eval/types.ts", "none"],
    ["tools/check.ts", "none"],
  ];
  for (const [path, want] of rows) {
    const c = classifyPath(path);
    assertEquals(c.group === "skill" ? `skill:${c.name}` : c.group, want, path);
  }
});

Deno.test("texts를 주면 seenComponents가 variant의 role prompt body를 거절하지 않는다", async () => {
  await withTemp(async (dir) => {
    const root = `${dir}/root`;
    const registryDir = `${dir}/registry`;
    await write(root, TOOL_SKILL, 'defineTool({ name: "skill.read" });');
    await write(root, TOOL_GUIDE, 'defineTool({ name: "guide.read" });');
    const variantLophn = `${lophn.value}\nvariant edit`;
    const texts = {
      role_prompts: {
        lophn: variantLophn,
        project_manager: "pm",
        operator: "op",
      },
      guides: {},
    };
    const call = [modelCall(variantLophn)];
    const seen = (deps: object) =>
      seenComponents([{ model_calls: call, tool_calls: [] }], {
        root,
        registryDir,
        ...deps,
      });
    assertEquals((await seen({})).ok, false);
    const r = await seen({ texts });
    assertEquals(r.ok, true);
  });
});
