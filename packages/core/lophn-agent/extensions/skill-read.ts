import { err, ok } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { Place, Role } from "../../../protocol/lophn-agent/mod.ts";
import type { SkillReader } from "../tools/ports.ts";
import {
  discoverSkills,
  joinPath,
  SKILL_BODY_MAX_BYTES,
  SKILL_MANIFEST,
  type SkillEntry,
  type SkillFilesPort,
  skillReceived,
  type SkillSkipped,
} from "./skills.ts";

// turn 시작에 고정하는 skill 판이다. 그 turn이 볼 skill 목록과 읽을 수 있는 본문,
// 딸린 파일 본문을 메모리에 읽어 둔다. 도는 turn은 파일이 그 사이에 바뀌어도 이 판만 쓴다. 꺼진 skill은 막는다.
// 전역 skill은 lophn data에 있어 file tool이 닿지 않는다. 이 reader만 읽는다.

export type SkillSnapshotDeps = {
  port: SkillFilesPort;
  // 내장 skill 폴더와 개인 보관소다.
  builtin_root: string | null;
  personal_store: string | null;
  // 사람이 등록한 폴더(등록 순서)와 전역에서 끈 이름이다. turn마다 읽는다.
  global(): Promise<{ roots: readonly string[]; off: readonly string[] }>;
  // project의 skill 폴더와 그 project에서 끈 이름이다. 파일이 없으면 끈 이름은 비어 있다.
  project(
    project: Id<"prj">,
  ): Promise<{ store: string | null; off: readonly string[] }>;
};

type SkillSession = {
  id: Id<"ses">;
  role: Role;
  // project에 놓인 agent의 project다. lophn은 null이다(project 층이 없다).
  project: Id<"prj"> | null;
  // agent 정의가 고른 이름이다. 비면 고르지 않은 것이다.
  skills: readonly string[];
};

type SkillSnapshot = {
  // prompt의 skill 목록 재료다. 끈 skill도 enabled false로 남는다.
  skills: readonly { name: string; description: string; enabled: boolean }[];
  skipped: readonly SkillSkipped[];
  reader: SkillReader;
};

type Fixed = { body: string; files: Map<string, string> };

export async function createSkillSnapshot(
  deps: SkillSnapshotDeps,
  session: SkillSession,
): Promise<SkillSnapshot> {
  const global = await deps.global();
  const project = session.project === null
    ? { store: null, off: [] as readonly string[] }
    : await deps.project(session.project);
  const found = await discoverSkills({
    port: deps.port,
    builtin_root: deps.builtin_root,
    registered_roots: global.roots,
    personal_store: deps.personal_store,
    project_store: project.store,
    role: session.role,
    off: [...new Set([...global.off, ...project.off])],
    max_file_bytes: SKILL_BODY_MAX_BYTES,
  });
  // 고른 이름이 있으면 그 밖의 skill은 꺼진다. 끌 수 없는 내장 skill은 남는다.
  const entries: readonly SkillEntry[] = found.ok
    ? found.value.entries.map((entry) => ({
      ...entry,
      enabled: entry.enabled && skillReceived(entry, session.skills),
    }))
    : [];
  const skipped = found.ok ? found.value.skipped : [];

  const fixed = new Map<string, Fixed>();
  for (const entry of entries) {
    if (!entry.enabled) continue;
    const read = await readFixed(deps.port, entry);
    if (read !== null) fixed.set(entry.name, read);
  }

  const reader: SkillReader = {
    read(id, name, path) {
      if (id !== session.id) {
        return Promise.resolve(
          err({ code: "not_found", message: "no skill list for this session" }),
        );
      }
      const entry = entries.find((one) => one.name === name);
      if (entry === undefined) {
        return Promise.resolve(
          err({ code: "not_found", message: `skill ${name} does not exist` }),
        );
      }
      if (!entry.enabled) {
        return Promise.resolve(
          err({ code: "forbidden", message: `skill ${name} is turned off` }),
        );
      }
      const one = fixed.get(name);
      if (one === undefined) {
        return Promise.resolve(
          err({
            code: "unavailable",
            message: `skill ${name} could not be read`,
          }),
        );
      }
      if (path === undefined) return Promise.resolve(ok(one.body));
      const file = one.files.get(path);
      return Promise.resolve(
        file === undefined
          ? err({
            code: "not_found",
            message: `skill ${name} has no file ${path}`,
          })
          : ok(file),
      );
    },
  };

  return {
    skills: entries.map((entry) => ({
      name: entry.name,
      description: entry.description,
      enabled: entry.enabled,
    })),
    skipped,
    reader,
  };
}

// SKILL.md 본문(frontmatter 뒤)과 딸린 파일을 읽어 둔다. 하나라도 온전히 못 읽으면 그 skill은 읽을 수 없다.
async function readFixed(
  port: SkillFilesPort,
  entry: SkillEntry,
): Promise<Fixed | null> {
  const manifest = await port.read(
    joinPath(entry.bundle_path, SKILL_MANIFEST),
    SKILL_BODY_MAX_BYTES,
  );
  if (!manifest.ok || manifest.value === null || !manifest.value.complete) {
    return null;
  }
  const body = bodyOf(manifest.value.text);
  if (body === null) return null;
  const files = new Map<string, string>();
  for (const file of entry.supplemental) {
    const read = await port.read(
      joinPath(entry.bundle_path, file.relative_path),
      SKILL_BODY_MAX_BYTES,
    );
    if (!read.ok || read.value === null || !read.value.complete) return null;
    files.set(file.relative_path, read.value.text);
  }
  return { body, files };
}

// frontmatter 다음 줄부터가 본문이다. 형식 검사는 발견이 했다.
function bodyOf(source: string): string | null {
  const lines = source.split("\n");
  if (lines[0]?.replace(/\r$/, "") !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].replace(/\r$/, "") === "---") {
      return lines.slice(i + 1).join("\n");
    }
  }
  return null;
}

// turn이 처음 skill을 읽을 때 판을 고정하는 reader다. agent가 켠 skill(`enabled`)만 읽는다.
export function turnSkillReader(
  deps: SkillSnapshotDeps,
  session: {
    id: string;
    agent: { role: Role };
    place: Place | null;
  },
  enabled: readonly string[],
): SkillReader {
  let snapshot: Promise<SkillSnapshot> | undefined;
  return {
    async read(id, name, path) {
      if (!enabled.includes(name)) {
        return err({
          code: "forbidden",
          message: `skill ${name} is not available to this agent`,
        });
      }
      snapshot ??= createSkillSnapshot(deps, {
        id: session.id as Id<"ses">,
        role: session.agent.role,
        project: (session.place?.id ?? null) as Id<"prj"> | null,
        skills: [],
      });
      return (await snapshot).reader.read(id, name, path);
    },
  };
}
