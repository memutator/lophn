import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { err, ok } from "../../../base/mod.ts";
import type {
  AgentId,
  AgentWorkspace,
} from "../../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import { resolveInWorkspace } from "../tools/file/scope.ts";
import { checkSkill, type SkillCheckFiles } from "./skill-check.ts";
import { createSkillCommandHandlers } from "./skill-commands.ts";
import { parseSkillFrontmatter, SKILL_BODY_MAX_BYTES } from "./skills.ts";

const VALID_SKILL = (name = "my-skill", desc = "Short clear description.") =>
  `---\nname: ${name}\ndescription: "${desc}"\n---\n\n# My Skill\n\nDo the work.\n`;

function memFiles(
  entries: Record<string, string | { kind: "dir" | "symlink"; size?: number }>,
): SkillCheckFiles {
  const dirs = new Set<string>();
  const children = new Map<string, Set<string>>();
  const addParent = (path: string) => {
    const slash = path.lastIndexOf("/");
    if (slash <= 0) return;
    const parent = path.slice(0, slash);
    const child = path.slice(slash + 1);
    dirs.add(parent);
    if (!children.has(parent)) children.set(parent, new Set());
    children.get(parent)!.add(child);
    addParent(parent);
  };
  for (const [path, val] of Object.entries(entries)) {
    if (typeof val !== "string" && val.kind === "dir") dirs.add(path);
    addParent(path);
  }
  const encoder = new TextEncoder();
  return {
    list: (dir) => {
      const set = children.get(dir);
      return set === undefined ? (dirs.has(dir) ? [] : null) : [...set];
    },
    kind: (path) => {
      if (path in entries) {
        const val = entries[path]!;
        return typeof val === "string" ? "file" : val.kind;
      }
      return dirs.has(path) ? "dir" : null;
    },
    size: (path) => {
      if (path in entries) {
        const val = entries[path]!;
        return typeof val === "string"
          ? encoder.encode(val).byteLength
          : (val.size ?? 0);
      }
      return null;
    },
    read: (path, maxBytes) => {
      const val = entries[path];
      if (typeof val !== "string") return null;
      const bytes = encoder.encode(val).byteLength;
      return bytes > maxBytes
        ? { text: "", complete: false }
        : { text: val, complete: true };
    },
  };
}

test("checkSkill passes a valid skill and reports byte sizes", () => {
  const manifest = `${VALID_SKILL("my-skill")}\nRead \`skill.read({ name: "my-skill", path: "guide.md" })\`.\n`;
  const guide = "# Guide\n\nDetails.\n";
  const result = checkSkill(
    "/skills/my-skill",
    memFiles({
      "/skills/my-skill/SKILL.md": manifest,
      "/skills/my-skill/guide.md": guide,
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.name, "my-skill");
  assert.deepStrictEqual(result.errors, []);
  assert.deepStrictEqual(result.warnings, []);
  assert.equal(result.bytes.manifest, Buffer.byteLength(manifest));
  assert.deepStrictEqual(result.bytes.companions, {
    "guide.md": Buffer.byteLength(guide),
  });
});

test("checkSkill returns exact error and warning codes for each defect", () => {
  const codes = (res: ReturnType<typeof checkSkill>) => ({
    errors: res.errors.map((e) => e.code),
    warnings: res.warnings.map((w) => w.code),
  });

  // missing_manifest
  assert.deepStrictEqual(codes(checkSkill("/missing", memFiles({}))).errors, [
    "missing_manifest",
  ]);
  assert.deepStrictEqual(
    codes(
      checkSkill(
        "/skills/empty",
        memFiles({ "/skills/empty": { kind: "dir" } }),
      ),
    ).errors,
    ["missing_manifest"],
  );

  // symlink_forbidden (folder, SKILL.md, companion)
  assert.deepStrictEqual(
    codes(
      checkSkill(
        "/skills/link",
        memFiles({ "/skills/link": { kind: "symlink" } }),
      ),
    ).errors,
    ["symlink_forbidden"],
  );
  assert.deepStrictEqual(
    codes(
      checkSkill(
        "/skills/s",
        memFiles({
          "/skills/s/SKILL.md": { kind: "symlink" },
          "/skills/s/a.md": { kind: "symlink" },
        }),
      ),
    ).errors,
    ["symlink_forbidden", "symlink_forbidden"],
  );

  // size_exceeded (SKILL.md and companion)
  const big = `${VALID_SKILL("big")}${"x".repeat(SKILL_BODY_MAX_BYTES + 10)}`;
  assert.ok(
    codes(
      checkSkill("/skills/big", memFiles({ "/skills/big/SKILL.md": big })),
    ).errors.includes("size_exceeded"),
  );
  assert.ok(
    codes(
      checkSkill(
        "/skills/comp",
        memFiles({
          "/skills/comp/SKILL.md": VALID_SKILL("comp"),
          "/skills/comp/huge.md": "y".repeat(SKILL_BODY_MAX_BYTES + 1),
        }),
      ),
    ).errors.includes("size_exceeded"),
  );

  // name_dir_mismatch, builtin_name_collision, empty_body, angle_brackets_in_description
  assert.ok(
    codes(
      checkSkill(
        "/skills/wrong-dir",
        memFiles({ "/skills/wrong-dir/SKILL.md": VALID_SKILL("right-name") }),
      ),
    ).errors.includes("name_dir_mismatch"),
  );
  assert.ok(
    codes(
      checkSkill(
        "/skills/write-skill",
        memFiles({
          "/skills/write-skill/SKILL.md": VALID_SKILL("write-skill"),
        }),
      ),
    ).errors.includes("builtin_name_collision"),
  );
  assert.ok(
    codes(
      checkSkill(
        "/skills/blank",
        memFiles({
          "/skills/blank/SKILL.md":
            "---\nname: blank\ndescription: ok\n---\n   \n",
        }),
      ),
    ).errors.includes("empty_body"),
  );
  assert.ok(
    codes(
      checkSkill(
        "/skills/angles",
        memFiles({
          "/skills/angles/SKILL.md": VALID_SKILL("angles", "Use <tag> here"),
        }),
      ),
    ).errors.includes("angle_brackets_in_description"),
  );

  // unfinished placeholder outside fence vs allowed inside fence, and unclosed_code_fence
  const marker = `[${"TO"}${"DO"}: fill in]`;
  assert.ok(
    codes(
      checkSkill(
        "/skills/ph",
        memFiles({
          "/skills/ph/SKILL.md": `${VALID_SKILL("ph")}\n${marker}\n`,
        }),
      ),
    ).errors.includes("unfinished_todo"),
  );
  assert.deepStrictEqual(
    codes(
      checkSkill(
        "/skills/fenced",
        memFiles({
          "/skills/fenced/SKILL.md": `${VALID_SKILL("fenced")}\n\`\`\`md\n${marker}\n\`\`\`\n`,
        }),
      ),
    ).errors,
    [],
  );
  assert.ok(
    codes(
      checkSkill(
        "/skills/unclosed",
        memFiles({
          "/skills/unclosed/SKILL.md": `${VALID_SKILL("unclosed")}\n\`\`\`ts\nconst x = 1;\n`,
        }),
      ),
    ).errors.includes("unclosed_code_fence"),
  );

  // missing_companion (missing flat file & subdirectory reference)
  const subRef = `${VALID_SKILL("refs")}\nRead \`skill.read({ name: "refs", path: "references/a.md" })\` and \`skill.read({ name: "refs", path: "nope.md" })\`.\n`;
  assert.deepStrictEqual(
    codes(
      checkSkill("/skills/refs", memFiles({ "/skills/refs/SKILL.md": subRef })),
    ).errors,
    ["missing_companion", "missing_companion"],
  );

  // All 6 warnings (still ok: true)
  const longDesc = "a".repeat(130);
  const longBody = `${VALID_SKILL("warn-me", longDesc)}\n${"line\n".repeat(310)}`;
  const warned = checkSkill(
    "/ws/skills/warn-me",
    memFiles({
      "/ws/skills/warn-me/SKILL.md": longBody,
      "/ws/skills/warn-me/references": { kind: "dir" },
      "/ws/skills/warn-me/README.md": "# readme",
      "/ws/skills/warn-me/script.ts": "console.log(1);",
    }),
    {
      existing: [
        { name: "warn-me", source: "global", bundle_path: "/global/warn-me" },
      ],
    },
  );
  assert.equal(warned.ok, true);
  assert.deepStrictEqual(warned.warnings.map((w) => w.code).sort(), [
    "auxiliary_file",
    "body_long",
    "description_long",
    "nested_subdirs_ignored",
    "non_md_companion",
    "shadows_existing",
  ]);
});

test("every input rejected by parseSkillFrontmatter fails checkSkill", () => {
  const broken = [
    "no frontmatter at all",
    "---\nname: x\ndescription: y\n",
    "---\n- not-a-map\n---\nbody",
    "---\nname: Bad_Name\ndescription: ok\n---\nbody",
    `---\nname: ${"a".repeat(65)}\ndescription: ok\n---\nbody`,
    '---\nname: ok\ndescription: "   "\n---\nbody',
    `---\nname: ok\ndescription: "${"d".repeat(1025)}"\n---\nbody`,
  ];
  for (const manifest of broken) {
    assert.equal(parseSkillFrontmatter(manifest).ok, false);
    const checked = checkSkill(
      "/skills/ok",
      memFiles({ "/skills/ok/SKILL.md": manifest }),
    );
    assert.equal(checked.ok, false);
    assert.ok(checked.errors.some((e) => e.code === "invalid_frontmatter"));
  }
});

test("skills/list exposes skipped skills and skills/check enforces agent read scope and shadow detection", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "lophn-skill-cmd-"));
  try {
    const dataRoot = join(temp, "data");
    const homeSkills = join(dataRoot, "home", "skills");
    const homeTools = join(dataRoot, "home", "tools");
    const globalSkills = join(dataRoot, "skills");
    const projectSkills = join(dataRoot, "projects", "prj_1", "skills");
    const agentsDir = join(dataRoot, "agents");
    const projectFolder = join(temp, "repo");
    const outsideDir = join(temp, "outside");

    await mkdir(join(homeSkills, "local-ok"), { recursive: true });
    await mkdir(join(homeSkills, "too-big"), { recursive: true });
    await mkdir(homeTools, { recursive: true });
    await mkdir(join(globalSkills, "shared-name"), { recursive: true });
    await mkdir(join(homeSkills, "shared-name"), { recursive: true });
    await mkdir(join(projectSkills, "prj-only"), { recursive: true });
    await mkdir(agentsDir, { recursive: true });
    await mkdir(projectFolder, { recursive: true });
    await mkdir(outsideDir, { recursive: true });

    await writeFile(
      join(homeSkills, "local-ok", "SKILL.md"),
      VALID_SKILL("local-ok"),
    );
    await writeFile(
      join(homeSkills, "too-big", "SKILL.md"),
      `${VALID_SKILL("too-big")}${"z".repeat(SKILL_BODY_MAX_BYTES + 100)}`,
    );
    await writeFile(
      join(globalSkills, "shared-name", "SKILL.md"),
      VALID_SKILL("shared-name", "Global copy"),
    );
    await writeFile(
      join(homeSkills, "shared-name", "SKILL.md"),
      VALID_SKILL("shared-name", "Home override"),
    );
    await writeFile(
      join(projectSkills, "prj-only", "SKILL.md"),
      VALID_SKILL("prj-only"),
    );
    await writeFile(join(dataRoot, "secrets.json"), "{}");
    await writeFile(join(dataRoot, "settings.json"), "{}");

    // symlink inside Home skills pointing outside must report symlink_forbidden without reading target
    try {
      await symlink(outsideDir, join(homeSkills, "evil-link"));
    } catch (thrown) {
      if (process.platform !== "win32") throw thrown;
      return t.skip("symlink requires developer mode on Windows");
    }

    const homeScope = {
      read: [projectFolder, homeSkills, homeTools, globalSkills],
      write: [homeSkills, homeTools, globalSkills],
    };
    const projectScope = {
      read: [projectFolder, projectSkills],
      write: [projectFolder, projectSkills],
      base: projectFolder,
    };

    // Home write boundary check: allows home skills, home tools, global skills; forbids project folder, agents, secrets, settings, app data
    assert.equal(
      (
        await resolveInWorkspace(
          homeScope,
          join(homeSkills, "x", "SKILL.md"),
          "write",
        )
      ).ok,
      true,
    );
    assert.equal(
      (await resolveInWorkspace(homeScope, join(homeTools, "t.ts"), "write"))
        .ok,
      true,
    );
    assert.equal(
      (
        await resolveInWorkspace(
          homeScope,
          join(globalSkills, "g", "SKILL.md"),
          "write",
        )
      ).ok,
      true,
    );
    for (const denied of [
      join(projectFolder, "file.txt"),
      join(agentsDir, "lophn_home.md"),
      join(dataRoot, "secrets.json"),
      join(dataRoot, "settings.json"),
      join(dataRoot, "apps", "app_1", "data", "db.sqlite"),
    ]) {
      const res = await resolveInWorkspace(homeScope, denied, "write");
      assert.equal(res.ok, false, denied);
      if (!res.ok) assert.equal(res.error.code, "forbidden", denied);
    }
    // Project session cannot write to global skills folder
    const prjGlobal = await resolveInWorkspace(
      projectScope,
      join(globalSkills, "g", "SKILL.md"),
      "write",
    );
    assert.equal(prjGlobal.ok, false);
    if (!prjGlobal.ok) assert.equal(prjGlobal.error.code, "forbidden");

    const handlers = new Map(
      createSkillCommandHandlers({
        dataRoot,
        bundledSkillsRoot: join(temp, "empty-bundled"),
        projectLayer: {
          workspaceDataSkillsFolder: (root, ws) =>
            ws === null
              ? join(root, "home", "skills")
              : join(root, `${ws.kind}s`, ws.id, "skills"),
          isWorkspaceDataSkills: () => false,
          extensionsFile: (root, ws) =>
            ws === null
              ? join(root, "home", "extensions.json")
              : join(root, `${ws.kind}s`, ws.id, "extensions.json"),
          isExtensionsFile: () => false,
          settingsFolderAreas: () => [],
          workspaceOfFolder: () => null,
          workspaceSkillsFolder: (folder) => join(folder, ".lophn", "skills"),
        },
        globalSettings: () => ({ roots: [], off: [] }),
        sessionInfo: (session) =>
          session === "ses_01000000000000000000000001"
            ? ok({
                agent: "lophn_home" as AgentId,
                workspace: null,
                readScope: homeScope,
              })
            : session === "ses_01000000000000000000000002"
              ? ok({
                  agent: "lophn_prj_1" as AgentId,
                  workspace: { kind: "project", id: "prj_1" } as AgentWorkspace,
                  readScope: projectScope,
                })
              : ok(null),
        resolveProject: (ref) =>
          ref === "prj_1"
            ? ok({ kind: "project", id: "prj_1" } as AgentWorkspace)
            : err({ code: "not_found", message: "project not found" }),
        resolveApp: () => err({ code: "not_found", message: "app not found" }),
        sourceFolder: () => ok(projectFolder),
        agentOwn: () => ok({ skills_off: [], apps: [] }),
        sharedFolders: () => ok([]),
      }),
    );

    const homeCtx = {
      principal: "agent:ses_01000000000000000000000001",
      actor: "agent:ses_01000000000000000000000001",
      scope: { operations: [], targets: {} },
      conditions: { session: "ses_01000000000000000000000001" },
      credential_ref: "test",
    } as AuthenticatedContext;
    const prjCtx = {
      ...homeCtx,
      principal: "agent:ses_01000000000000000000000002",
      actor: "agent:ses_01000000000000000000000002",
      conditions: { session: "ses_01000000000000000000000002" },
    } as AuthenticatedContext;

    // list reports oversized skill in skipped with path + reason
    const listed = await handlers.get("skills/list")!(homeCtx, {});
    assert.ok(listed.ok);
    const listVal = listed.value as {
      skills: { name: string; source: string; path: string }[];
      skipped: { path: string; reason: string }[];
    };
    assert.ok(
      listVal.skills.some(
        (s) => s.name === "local-ok" && s.source === "workspace-data",
      ),
    );
    assert.ok(
      listVal.skipped.some(
        (s) => s.path.includes("too-big") && s.reason.includes("24 KiB"),
      ),
    );

    // check detects shadows_existing even though homeSkills/shared-name is already written on disk
    const shadowed = await handlers.get("skills/check")!(homeCtx, {
      path: join(homeSkills, "shared-name"),
    });
    assert.ok(shadowed.ok);
    const shadowVal = shadowed.value as {
      ok: boolean;
      warnings: { code: string }[];
    };
    assert.equal(shadowVal.ok, true);
    assert.ok(shadowVal.warnings.some((w) => w.code === "shadows_existing"));

    // check catches symlink inside allowed scope without reading target
    const linkRes = await handlers.get("skills/check")!(homeCtx, {
      path: join(homeSkills, "evil-link"),
    });
    assert.ok(linkRes.ok);
    assert.deepStrictEqual(
      (linkRes.value as { errors: { code: string }[] }).errors.map(
        (e) => e.code,
      ),
      ["symlink_forbidden"],
    );

    // check rejects paths outside session read scope with forbidden
    const outsideRes = await handlers.get("skills/check")!(homeCtx, {
      path: outsideDir,
    });
    assert.equal(outsideRes.ok, false);
    if (!outsideRes.ok) assert.equal(outsideRes.error.code, "forbidden");

    // project session cannot check global skills folder (outside project read scope)
    const prjCheckGlobal = await handlers.get("skills/check")!(prjCtx, {
      path: join(globalSkills, "shared-name"),
    });
    assert.equal(prjCheckGlobal.ok, false);
    if (!prjCheckGlobal.ok)
      assert.equal(prjCheckGlobal.error.code, "forbidden");

    // project session cannot list another workspace
    const prjListOther = await handlers.get("skills/list")!(homeCtx, {
      project: "prj_1",
    });
    assert.equal(prjListOther.ok, false);
    if (!prjListOther.ok) assert.equal(prjListOther.error.code, "forbidden");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
