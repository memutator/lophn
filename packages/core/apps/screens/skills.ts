import { readdir } from "node:fs/promises";
import type { BundleLocator } from "../ports.ts";
import { createScreenFileDeps } from "./adapters.ts";
import {
  isSharedCompanion,
  publicSkillNames,
  SHARED_SKILLS_DIR,
  sharedManifestDescription,
  SKILL_BODY_MAX_BYTES,
  SKILL_MANIFEST,
} from "../../lophn-agent/extensions/skills.ts";

export type AppSkill = {
  name: string;
  description: string;
  /** frontmatter까지 든 SKILL.md 전체. */
  skill_md: string;
  /** SKILL.md 옆에 딸린 `.md` 파일. */
  files: { name: string; text: string }[];
};

export type AppSkillsDeps = {
  bundles: BundleLocator;
  /** 폴더의 이름들. 폴더가 아니거나 없으면 null이다. */
  list(path: string): Promise<string[] | null>;
  readFile(path: string, maxBytes: number): Promise<Uint8Array | null>;
  /** symlink를 푼 실제 경로. 없으면 null이다. */
  realPath(path: string): Promise<string | null>;
};

// 앱 active release bundle 사본의 `.lophn/skills/<name>/`에서 선언한 public skill을 읽는다. 선언에 없는 폴더는
// 열지 않는다. 읽을 수 없는 skill(폴더 없음, 큼, 형식 틀림, bundle 밖을 가리키는 symlink)은 오류 없이 뺀다:
// 다른 agent에게 주는 덤이라 하나가 틀려도 나머지는 가야 한다.
export async function readAppSkills(
  deps: AppSkillsDeps,
  app: string,
  declared: readonly { name: string; public: boolean }[],
): Promise<AppSkill[]> {
  const publicNames = publicSkillNames(declared);
  if (publicNames.length === 0) return [];
  const bundle = deps.bundles.dir({
    mode: "live",
    app: app as never,
    release: null,
  });
  if (!bundle.ok) return [];
  const root = await deps.realPath(bundle.value);
  if (root === null) return [];

  const inside = async (path: string): Promise<string | null> => {
    const real = await deps.realPath(path);
    return real !== null && real.startsWith(`${root}/`) ? real : null;
  };
  const text = async (path: string): Promise<string | null> => {
    const real = await inside(path);
    if (real === null) return null;
    const bytes = await deps.readFile(real, SKILL_BODY_MAX_BYTES);
    return bytes === null ? null : new TextDecoder().decode(bytes);
  };

  const skills: AppSkill[] = [];
  for (const name of publicNames) {
    const dir = await inside(`${root}/${SHARED_SKILLS_DIR}/${name}`);
    if (dir === null) continue;
    const manifest = await text(`${dir}/${SKILL_MANIFEST}`);
    if (manifest === null) continue;
    const description = sharedManifestDescription(name, manifest);
    if (description === null) continue;
    const files: AppSkill["files"] = [];
    for (const file of (await deps.list(dir)) ?? []) {
      if (!isSharedCompanion(file)) continue;
      const body = await text(`${dir}/${file}`);
      if (body !== null) files.push({ name: file, text: body });
    }
    files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    skills.push({
      name,
      description,
      skill_md: manifest,
      files,
    });
  }
  return skills;
}

export function createAppSkillsDeps(bundles: BundleLocator): AppSkillsDeps {
  return {
    ...createScreenFileDeps(bundles),
    async list(path) {
      try {
        return await readdir(path);
      } catch {
        return null;
      }
    },
  };
}
