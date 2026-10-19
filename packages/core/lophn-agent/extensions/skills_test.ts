import { assertEquals } from "@std/assert";
import { ok } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { AgentPlace, Role } from "../../../protocol/lophn-agent/mod.ts";
import { createSkillSnapshot, type SkillSnapshotDeps } from "./skill-read.ts";
import { receivedSkills } from "../agents/resolve.ts";
import { mergeSkillLayers, type SkillFilesPort } from "./skills.ts";
import { listSkillsSync, type SyncSkillFiles } from "./skills-sync.ts";

// 끌 수 없는 내장 skill은 어느 층에서 꺼도, 같은 이름의 사람 skill이 있어도 그대로 남는다. 이 규칙이 깨지면 role이
// 일하는 데 필요한 skill이 사람 설정 하나로 사라진다.

const skillFile = (name: string, body: string) =>
  `---\nname: ${name}\ndescription: ${name} description\n---\n${body}`;

// 메모리 안의 폴더 모양이다. 사람의 data root를 열지 않는다.
function treeOf(files: Record<string, string>) {
  const kind = (path: string) =>
    path in files
      ? "file" as const
      : Object.keys(files).some((one) => one.startsWith(`${path}/`))
      ? "dir" as const
      : null;
  const list = (dir: string) => {
    const names = new Set<string>();
    for (const path of Object.keys(files)) {
      if (path.startsWith(`${dir}/`)) {
        names.add(path.slice(dir.length + 1).split("/")[0]);
      }
    }
    return names.size === 0 ? null : [...names];
  };
  const read = (path: string) =>
    path in files ? { text: files[path], complete: true } : null;
  const port: SkillFilesPort = {
    list: (dir) => Promise.resolve(ok(list(dir))),
    kind: (path) => Promise.resolve(ok(kind(path))),
    read: (path) => Promise.resolve(ok(read(path))),
    executable: () => Promise.resolve(ok(false)),
  };
  const sync: SyncSkillFiles = { list, kind, read };
  return { port, sync };
}

const SESSION = "ses_01" as Id<"ses">;
const PLACE: AgentPlace = { kind: "project", id: "prj_01" };
const DOMAIN = "dom_01";

type Case = {
  name: string;
  role: Role;
  // 같은 이름의 사람 skill을 둔 층
  human: ("global" | "domain")[];
  off: { global?: boolean; project?: boolean; agent?: boolean };
  // 최종 kinds-yaml의 본문. null이면 목록에 없다.
  expect: "BUILTIN" | "GLOBAL" | "DOMAIN" | null;
};

const CASES: Case[] = [
  {
    name: "no human skill, nothing off",
    role: "project_manager",
    human: [],
    off: {},
    expect: "BUILTIN",
  },
  {
    name: "off at global",
    role: "project_manager",
    human: [],
    off: { global: true },
    expect: "BUILTIN",
  },
  {
    name: "off at project",
    role: "project_manager",
    human: [],
    off: { project: true },
    expect: "BUILTIN",
  },
  {
    name: "off at agent",
    role: "project_manager",
    human: [],
    off: { agent: true },
    expect: "BUILTIN",
  },
  {
    name: "off at every layer",
    role: "project_manager",
    human: [],
    off: { global: true, project: true, agent: true },
    expect: "BUILTIN",
  },
  {
    name: "global human skill with the same name",
    role: "project_manager",
    human: ["global"],
    off: {},
    expect: "BUILTIN",
  },
  {
    name: "domain human skill with the same name",
    role: "project_manager",
    human: ["domain"],
    off: {},
    expect: "BUILTIN",
  },
  {
    name: "human skills and off at every layer",
    role: "project_manager",
    human: ["global", "domain"],
    off: { global: true, project: true, agent: true },
    expect: "BUILTIN",
  },
  // 내장 skill은 선언한 role의 것만이다. 다른 role에는 이름이 비어 있어 사람 skill이 그대로 쓰인다.
  {
    name: "other role has no built-in",
    role: "operator",
    human: [],
    off: {},
    expect: null,
  },
  {
    name: "other role keeps its own skill of that name",
    role: "operator",
    human: ["domain"],
    off: {},
    expect: "DOMAIN",
  },
];

for (const one of CASES) {
  Deno.test(`kinds-yaml stays: ${one.name}`, async () => {
    const files: Record<string, string> = {
      "/b/kinds-yaml/SKILL.md": skillFile("kinds-yaml", "BUILTIN"),
      "/b/spare-builtin/SKILL.md": skillFile("spare-builtin", "BUILTIN"),
    };
    if (one.human.includes("global")) {
      files["/g/kinds-yaml/SKILL.md"] = skillFile("kinds-yaml", "GLOBAL");
    }
    if (one.human.includes("domain")) {
      files["/p/kinds-yaml/SKILL.md"] = skillFile("kinds-yaml", "DOMAIN");
    }
    const { port, sync } = treeOf(files);
    const globalOff = one.off.global ? ["kinds-yaml"] : [];
    const projectOff = one.off.project ? ["kinds-yaml"] : [];
    // 정의가 다른 skill만 골랐다.
    const chosen = one.off.agent ? ["spare-builtin"] : [];
    const deps: SkillSnapshotDeps = {
      port,
      builtin_root: "/b",
      personal_store: null,
      global: () => Promise.resolve({ roots: ["/g"], off: globalOff }),
      place: () =>
        Promise.resolve({
          domain_stores: [{ domain: DOMAIN, folder: "/p" }],
          off: projectOff,
        }),
    };
    const snapshot = await createSkillSnapshot(deps, {
      id: SESSION,
      role: one.role,
      place: PLACE,
      skills: chosen,
    });

    const listed = snapshot.skills.find((skill) => skill.name === "kinds-yaml");
    const read = await snapshot.reader.read(SESSION, "kinds-yaml");
    if (one.expect === null) {
      assertEquals(listed, undefined);
      assertEquals(read.ok, false);
    } else {
      assertEquals(listed?.enabled, true);
      assertEquals(read.ok && read.value.trim(), one.expect);
    }

    // 같은 규칙을 동기로 한 번 더 읽는 목록(ReadSkills)도 같은 답이다.
    const rows = listSkillsSync(sync, {
      bundled: "/b",
      registered: ["/g"],
      personal: null,
      domains: [{ domain: DOMAIN, folder: "/p" }],
    }, { role: one.role, off: [...globalOff, ...projectOff] });
    assertEquals(
      rows.entries.find((row) => row.name === "kinds-yaml")?.enabled,
      one.expect === null ? undefined : true,
    );
  });
}

Deno.test("a skill that can be turned off goes off, and a human skill of the same name replaces it", () => {
  const candidates = [
    { name: "maker", source: "builtin" as const, bundle_path: "/b/maker" },
  ];
  const canOff = () => true;
  assertEquals(
    mergeSkillLayers(candidates, ["maker"], [], canOff).map((one) =>
      one.enabled
    ),
    [false],
  );
  const replaced = mergeSkillLayers(
    [...candidates, {
      name: "maker",
      source: "global" as const,
      bundle_path: "/g/maker",
    }],
    [],
    [],
    canOff,
  );
  assertEquals(replaced.map((one) => one.source), ["global"]);
  assertEquals(replaced.map((one) => one.enabled), [true]);
});

Deno.test("the agent gets only the skills it chose, all when it chose none, and a built-in that cannot be turned off always", async () => {
  const { port } = treeOf({
    "/b/kinds-yaml/SKILL.md": skillFile("kinds-yaml", "BUILTIN"),
    "/g/a/SKILL.md": skillFile("a", "A"),
    "/g/b/SKILL.md": skillFile("b", "B"),
  });
  const deps: SkillSnapshotDeps = {
    port,
    builtin_root: "/b",
    personal_store: null,
    global: () => Promise.resolve({ roots: ["/g"], off: [] }),
    place: () => Promise.resolve({ domain_stores: [], off: [] }),
  };
  const receivedOf = async (skills: string[]) => {
    const snapshot = await createSkillSnapshot(deps, {
      id: SESSION,
      role: "project_manager",
      place: PLACE,
      skills,
    });
    const code = async (name: string) => {
      const read = await snapshot.reader.read(SESSION, name);
      return read.ok ? "ok" : read.error.code;
    };
    const listed = snapshot.skills.filter((s) => s.enabled).map((s) => s.name);
    const available = snapshot.skills.map((s) => ({
      name: s.name,
      can_disable: s.name !== "kinds-yaml",
      domain: null,
    }));
    return {
      listed,
      // resolve가 받는 이름도 목록과 같다.
      resolved: receivedSkills(available, skills, []),
      b: await code("b"),
      builtin: await code("kinds-yaml"),
    };
  };
  assertEquals(await receivedOf([]), {
    listed: ["a", "b", "kinds-yaml"],
    resolved: ["a", "b", "kinds-yaml"],
    b: "ok",
    builtin: "ok",
  });
  assertEquals(await receivedOf(["a", "missing"]), {
    listed: ["a", "kinds-yaml"],
    resolved: ["a", "kinds-yaml"],
    b: "forbidden",
    builtin: "ok",
  });
});

Deno.test("the same skill name in two domains goes to the domain whose name comes first", () => {
  const { sync } = treeOf({
    "/a/shared/SKILL.md": skillFile("shared", "A"),
    "/b/shared/SKILL.md": skillFile("shared", "B"),
    "/b/only-b/SKILL.md": skillFile("only-b", "B"),
  });
  const listing = listSkillsSync(sync, {
    bundled: null,
    registered: [],
    personal: null,
    domains: [{ domain: "dom_a", folder: "/a" }, {
      domain: "dom_b",
      folder: "/b",
    }],
  }, { role: null, off: [] });
  assertEquals(
    listing.entries.map((entry) => [entry.name, entry.domain]),
    [["only-b", "dom_b"], ["shared", "dom_a"]],
  );
});
