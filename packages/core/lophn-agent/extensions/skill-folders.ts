import process from "node:process";
import type {
  AgentPlace,
  PlaceKind,
} from "../../../protocol/lophn-agent/mod.ts";
import { appSkills } from "../../../protocol/apps/declaration/read.ts";
import { skillFoldersSetting, skillsOffSetting } from "./settings.ts";
import { createListSettingsReader } from "../../config/mod.ts";
import { settingsList } from "../../../protocol/config/mod.ts";
import {
  discoverSkills,
  type PlaceSkills,
  SKILL_BODY_MAX_BYTES,
  sharedFor,
  type SharedSkill,
  type SkillEntry,
  type SkillFiles,
} from "./skills.ts";
import { createNodeSkillFiles } from "./adapters/node-fs.ts";
import type { SkillSnapshotDeps } from "./skill-read.ts";
import {
  parseProjectExtensions,
  placeSkillsOf,
  type ProjectLayer,
} from "./project-settings.ts";
import { type CoreCall, readOf } from "../run-loop/core-call.ts";

// 제품 runtime의 skill 발견이다. 파일 출처는 내장 skill 폴더, 등록 순서의 설정
// `lophn-agent.extensions.skill_folders`, data root의 개인 보관소(`<LOPHN_HOME>/skills`), agent place의 첫 폴더나 앱 source의
// `.lophn/skills`, agent place 그릇 자리의 `skills/`(place-data 층 규칙이 정한다) 다섯뿐이다. 다른 place의 폴더,
// 상위 폴더, 다른 harness 보관소(`.agents/skills` 포함), 원격은 열지 않는다. 할당한 앱의 공유 skill은 파일을 열지 않고 core의
// `app.skills`가 bundle에서 읽어 준 본문을 쓴다. 층은 내장, 공유, 전역(등록 폴더와 개인 보관소), project·app, place-data 순이다.

// 내장, 개인 보관소의 위치와 agent가 놓인 place다. null은 그 출처가 없는 것이다. 테스트는 temp 폴더를 끼운다.
type SkillStores = {
  bundled: string | null;
  personal: string | null;
  // place-data 층을 읽을 그릇이다. lophn은 null이다.
  place: AgentPlace | null;
  // project에서 끈 이름이 든 파일이다. 앱에는 없다.
  project_file: string | null;
  // data root다. place-data·project 폴더를 여는 허락이 이 아래로 좁다.
  root: string | null;
  layer: ProjectLayer;
  sourceFolder: SkillStoreDeps["sourceFolder"];
};

// 내장 skill 폴더와 project 층 규칙은 place 층의 값이라 조립이 넘긴다.
type SkillStoreDeps = {
  projectLayer: ProjectLayer;
  bundledSkillsRoot: string;
  // project의 첫 등록 폴더나 앱 source 폴더를 core에 물어 안다. 읽지 못하거나 폴더가 없으면 null이다.
  sourceFolder(machine: CoreCall, place: AgentPlace): Promise<string | null>;
};

function dataRootOfEnv(): string | null {
  const home = process.env.LOPHN_HOME;
  return home !== undefined && home.startsWith("/")
    ? home.replace(/\/+$/, "")
    : null;
}

export function productSkillStores(
  place: AgentPlace | null,
  deps: SkillStoreDeps,
): SkillStores {
  const root = dataRootOfEnv();
  const project =
    root === null || place === null ? null : deps.projectLayer.projectOf(place);
  return {
    bundled: deps.bundledSkillsRoot,
    personal: root === null ? null : `${root}/skills`,
    place,
    project_file:
      project === null
        ? null
        : deps.projectLayer.extensionsFile(root!, project),
    root,
    layer: deps.projectLayer,
    sourceFolder: deps.sourceFolder,
  };
}

// project에서 끈 이름이다. 파일이 없거나 틀렸거나 읽다 던지면 끈 것이 없다.
function projectOff(port: SkillFiles, file: string | null): readonly string[] {
  if (file === null) return [];
  try {
    const read = port.read(file, SKILL_BODY_MAX_BYTES);
    if (read === null || !read.complete) return [];
    const parsed = parseProjectExtensions(read.text);
    return parsed.ok ? parsed.value.skills_off : [];
  } catch {
    return [];
  }
}

// place 그릇 자리의 `skills/` 폴더다. lophn(home)은 그릇이 없다. 아직 없는 폴더는 발견이 skill이 없는 것으로 넘긴다.
function placeDataSkills(stores: SkillStores): string | null {
  return stores.root === null || stores.place === null
    ? null
    : stores.layer.placeDataSkillsFolder(stores.root, stores.place);
}

// 읽지 못하거나 폴더가 없으면 그 층이 없는 것이다.
async function placeSkillsOfStores(
  machine: CoreCall,
  stores: SkillStores,
): Promise<PlaceSkills | null> {
  if (stores.place === null) return null;
  return placeSkillsOf(
    stores.layer,
    stores.place,
    await stores.sourceFolder(machine, stores.place),
  );
}

// 할당한 앱(slug)의 active release가 내놓은 public skill이다. 같은 이름은 slug 앞선 앱의 것만 남긴다. 앱 자기 place에서는
// 그 앱의 `app` 층으로 이미 보이므로 싣지 않는다. 읽지 못하면 공유 skill이 없는 것으로 본다.
export async function sharedSkillsOf(
  machine: CoreCall,
  apps: readonly string[],
  place: AgentPlace | null,
): Promise<readonly SharedSkill[]> {
  if (apps.length === 0) return [];
  const read = await readOf(machine, appSkills, { apps: [...apps] });
  return read.ok ? sharedFor(read.value.skills, place) : [];
}

// 층을 합친 목록이다. 내장 skill은 그 place 종류에 선언된 것만이다. 전역과 project에서 끈 것이 enabled false다.
export async function registeredSkillEntries(
  machine: CoreCall,
  stores: SkillStores,
  kind: PlaceKind,
  apps: readonly string[],
): Promise<readonly SkillEntry[]> {
  const { roots, off } = await globalSkillSettings(machine);
  const place = await placeSkillsOfStores(machine, stores);
  const port = productFiles(roots, stores, place);
  return discoverSkills(
    port,
    {
      bundled: stores.bundled,
      registered: roots,
      personal: stores.personal,
      place,
      placeData: placeDataSkills(stores),
      shared: await sharedSkillsOf(machine, apps, stores.place),
    },
    {
      kind,
      off: [...new Set([...off, ...projectOff(port, stores.project_file)])],
    },
  ).entries;
}

// turn 시작에 skill 판을 고정하는 재료다(`createSkillSnapshot`). place마다 폴더가 달라 port는 data root 아래
// 모든 place-data·project 폴더를 열 수 있다.
export function productSkillSnapshotDeps(
  machine: CoreCall,
  deps: SkillStoreDeps,
): SkillSnapshotDeps {
  const base = productSkillStores(null, deps);
  return {
    port: productFiles([], base, null),
    builtin_root: base.bundled,
    personal_store: base.personal,
    global: async () => {
      const { roots, off } = await globalSkillSettings(machine);
      return { roots, off };
    },
    shared: (apps, place) => sharedSkillsOf(machine, apps, place),
    place: async (place) => {
      const where = productSkillStores(place, deps);
      const place_skills = await placeSkillsOfStores(machine, where);
      const port = productFiles([], where, place_skills);
      return {
        place_skills,
        place_data: placeDataSkills(where),
        off: projectOff(port, where.project_file),
      };
    },
  };
}

// 등록 폴더(순서대로)와 전역에서 끈 skill 이름이다. 읽지 못하거나 값이 틀리면 둘 다 없는 것으로 본다.
async function globalSkillSettings(
  machine: CoreCall,
): Promise<{ roots: readonly string[]; off: readonly string[] }> {
  const read = await readOf(machine, settingsList, {
    keys: [skillFoldersSetting.key, skillsOffSetting.key],
  });
  if (!read.ok) return { roots: [], off: [] };
  const settings = createListSettingsReader(read.value.settings);
  return {
    roots: settings.get(skillFoldersSetting) ?? [],
    off: settings.get(skillsOffSetting) ?? [],
  };
}

// 등록 root·내장 폴더·개인 보관소·place의 `.lophn/skills`·place-data skill 폴더와 그 아래만 연다. symlink는 lstat로 보고 따라가지 않는다.
// ~/.lophn, ~/.config/lophn, home 자체는 등록돼 있어도 열지 않는다. 개인 보관소와 place-data의 skill 폴더, project의
// 끈 이름 파일은 data root 안의 정해진 곳만 예외로 연다.
function productFiles(
  roots: readonly string[],
  stores: SkillStores,
  place: PlaceSkills | null,
): SkillFiles {
  // data root 아래 place-data skill 폴더와 project의 설정 파일만이다.
  const projectPath = (path: string): boolean => {
    if (stores.root === null) return false;
    const { layer } = stores;
    const root = stores.root;
    const target = lexical(path);
    if (target === null) return false;
    if (layer.isPlaceDataSkills(lexical(root) ?? root, target)) return true;
    const area = lexical(layer.settingsFolderArea(root));
    if (area === null || !target.startsWith(`${area}/`)) return false;
    const id = layer.projectIdOfFolder(
      target.slice(area.length + 1).split("/")[0],
    );
    return id !== null && target === lexical(layer.extensionsFile(root, id));
  };
  const allowed = (path: string): boolean =>
    projectPath(path) ||
    (stores.personal !== null && under(stores.personal, path)) ||
    (!privateRoot(path) &&
      (roots.some((root) => under(root, path)) ||
        (place !== null && under(place.folder, path)) ||
        (stores.bundled !== null && under(stores.bundled, path))));

  // 허락 밖 path는 던진다. 읽기는 node adapter가 한다(symlink는 lstat로 보고 따라가지 않는다).
  const node = createNodeSkillFiles();
  const guard = (path: string): void => {
    if (!allowed(path)) {
      throw new Error("skill path is outside the registered folder");
    }
  };
  return {
    list(dir) {
      guard(dir);
      const kind = node.kind(dir);
      if (kind === null) return null;
      if (kind !== "dir") {
        throw new Error("skill folder is not a plain directory");
      }
      return node.list(dir);
    },
    kind(path) {
      guard(path);
      return node.kind(path);
    },
    read(path, maxBytes) {
      guard(path);
      return node.read(path, maxBytes);
    },
  };
}

function under(root: string, path: string): boolean {
  const base = lexical(root);
  const target = lexical(path);
  if (base === null || target === null) return false;
  const separator = base.includes("\\") ? "\\" : "/";
  return target === base || target.startsWith(`${base}${separator}`);
}

function privateRoot(path: string): boolean {
  const home = process.env.HOME;
  if (home === undefined || home.length === 0) return false;
  const base = lexical(home);
  const target = lexical(path);
  if (base === null || target === null) return false;
  if (target === base) return true;
  for (const suffix of ["/.lophn", "/.config/lophn"] as const) {
    const root = `${base}${suffix}`;
    if (target === root || target.startsWith(`${root}/`)) return true;
  }
  return false;
}

// `.`와 `..`만 접고 symlink는 풀지 않는다. 절대 경로가 아니면 null이다.
function lexical(path: string): string | null {
  const windows = /^[A-Za-z]:[\\/]/.test(path);
  if (!windows && !path.startsWith("/")) return null;
  const drive = windows ? path.slice(0, 2) : "";
  const body = windows ? path.slice(2) : path;
  const kept: string[] = [];
  for (const piece of body.split(/[\\/]+/)) {
    if (piece === "" || piece === ".") continue;
    if (piece === "..") {
      if (kept.length === 0) return null;
      kept.pop();
      continue;
    }
    kept.push(piece);
  }
  return windows ? `${drive}\\${kept.join("\\")}` : `/${kept.join("/")}`;
}
