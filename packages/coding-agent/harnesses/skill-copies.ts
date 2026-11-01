// coding agent harness의 skill 폴더에 앱의 공유 skill 사본을 맞춘다. 폴더마다 표시 file(`.lophn-shared`)을 두고,
// 표시가 있는 폴더만 덮고 지운다. 같은 이름의 폴더가 사람의 것이면(표시 없음) 건드리지 않고 건너뛴다.
// 표시 file이 쓴 file 이름을 적어 두므로 지울 때도 우리가 쓴 file만 지운다(`remove`가 recursive가 아니다).
import type { InstallPorts } from "./install-common.ts";

export const SHARED_SKILL_MARKER = ".lophn-shared";

export type SharedSkill = {
  /** 앱 slug. */
  slug: string;
  release: string;
  name: string;
  skill_md: string;
  files: { name: string; text: string }[];
};

export type SkillCopyResult = {
  written: string[];
  removed: string[];
  skipped: { name: string; reason: string }[];
};

type Marker = { app: string; release: string; files: string[] };

const FOLDER_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

// core가 준 이름이 폴더 밖으로 나가지 못하게 한다.
function safeFile(name: string): boolean {
  return name
    .split("/")
    .every(
      (part) =>
        part !== "" &&
        part !== "." &&
        part !== ".." &&
        !part.includes("\\") &&
        part !== SHARED_SKILL_MARKER,
    );
}

async function markerOf(
  ports: InstallPorts,
  folder: string,
): Promise<Marker | null> {
  const text = await ports.read(`${folder}/${SHARED_SKILL_MARKER}`);
  if (text === null) return null;
  try {
    const value = JSON.parse(text) as Partial<Marker>;
    const files = Array.isArray(value.files)
      ? value.files.filter(
          (file): file is string => typeof file === "string" && safeFile(file),
        )
      : [];
    return { app: String(value.app), release: String(value.release), files };
  } catch {
    // 표시는 있으나 읽을 수 없다. 우리 폴더로 보되 아는 file은 SKILL.md뿐이다.
    return { app: "", release: "", files: ["SKILL.md"] };
  }
}

// 빈 폴더만 지운다. 사람이 넣은 file이 있어 비지 않으면 그대로 둔다.
async function removeEmptyDirs(
  ports: InstallPorts,
  folder: string,
  files: string[],
): Promise<void> {
  const dirs = new Set<string>([folder]);
  for (const file of files) {
    const parts = file.split("/").slice(0, -1);
    for (let at = 1; at <= parts.length; at++) {
      dirs.add(`${folder}/${parts.slice(0, at).join("/")}`);
    }
  }
  for (const dir of [...dirs].toSorted((a, b) => b.length - a.length)) {
    try {
      await ports.remove(dir);
    } catch {
      // 비지 않았다.
    }
  }
}

async function removeCopy(
  ports: InstallPorts,
  folder: string,
  marker: Marker,
): Promise<void> {
  for (const file of marker.files) {
    await ports.remove(`${folder}/${file}`).catch(() => {});
  }
  await ports.remove(`${folder}/${SHARED_SKILL_MARKER}`);
  await removeEmptyDirs(ports, folder, marker.files);
}

/** `dir`(절대 경로)의 사본을 `skills`에 맞춘다. 같은 이름이 둘이면 앞의 것만 쓴다. */
export async function syncSkillCopies(
  ports: InstallPorts,
  input: { dir: string; skills: readonly SharedSkill[] },
): Promise<SkillCopyResult> {
  const result: SkillCopyResult = { written: [], removed: [], skipped: [] };
  const existing = (await ports.list(input.dir)) ?? [];
  const owned = new Map<string, Marker>();
  for (const name of existing) {
    const marker = await markerOf(ports, `${input.dir}/${name}`);
    if (marker !== null) owned.set(name, marker);
  }

  const wanted = new Set<string>();
  for (const skill of input.skills) {
    const folder = `${input.dir}/${skill.name}`;
    const extra = skill.files.filter((file) => file.name !== "SKILL.md");
    const skip = (reason: string) =>
      result.skipped.push({ name: skill.name, reason });
    if (!FOLDER_NAME.test(skill.name)) {
      skip("the skill name is not a safe folder name");
    } else if (wanted.has(skill.name)) {
      skip("another shared app already has a skill with this name");
    } else if (!extra.every((file) => safeFile(file.name))) {
      skip("a file name is not safe");
    } else if (existing.includes(skill.name) && !owned.has(skill.name)) {
      skip("a folder with this name is not written by lophn");
    } else {
      wanted.add(skill.name);
      const files = [{ name: "SKILL.md", text: skill.skill_md }, ...extra];
      const marker: Marker = {
        app: skill.slug,
        release: skill.release,
        files: files.map((file) => file.name),
      };
      // 표시를 먼저 둔다. 쓰다 멈춰도 다음에 우리 폴더로 알아본다.
      const markerText = `${JSON.stringify(marker)}\n`;
      const markerPath = `${folder}/${SHARED_SKILL_MARKER}`;
      if ((await ports.read(markerPath)) !== markerText) {
        await ports.write(markerPath, markerText);
      }
      for (const file of files) {
        const path = `${folder}/${file.name}`;
        if ((await ports.read(path)) !== file.text) {
          await ports.write(path, file.text);
        }
      }
      const stale = (owned.get(skill.name)?.files ?? []).filter(
        (file) => !marker.files.includes(file),
      );
      for (const file of stale) {
        await ports.remove(`${folder}/${file}`).catch(() => {});
      }
      await removeEmptyDirs(ports, folder, stale).catch(() => {});
      result.written.push(skill.name);
    }
  }

  for (const [name, marker] of owned) {
    if (wanted.has(name)) continue;
    await removeCopy(ports, `${input.dir}/${name}`, marker);
    result.removed.push(name);
  }
  return result;
}
