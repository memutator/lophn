import { parse } from "yaml";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentWorkspace,
  BUILTIN_SKILLS,
  type WorkspaceKind,
  type SkillEntry as SkillRow,
  type SkillSource,
} from "../../../protocol/lophn-agent/mod.ts";

// skill 발견, 검증, 층 합치기. 층은 내장, 공유(할당한 앱의 public skill), 전역(등록 폴더와 개인 보관소), project·app(그 workspace 폴더의 `.lophn/skills`),
// workspace-data(그 workspace 그릇 자리의 `skills/`) 순이고 같은 이름은 마지막 층이 덮는다. 끌 수 없는 내장 skill은 사람 skill이 같은 이름으로 덮지 못한다.
// 끄기는 이름 단위다. 발견은 동기다(core read handler가 동기라 비동기 발견을 부르지 못하고, 비동기 함수 안에서는 동기
// 함수를 그대로 부를 수 있다). 파일 IO는 SkillFiles로 끼운다. 내장 skill은 `workspaces`에 선언된 workspace 종류만 후보다. 이 모듈은
// 사람의 실제 home이나 다른 harness 보관소를 열지 않는다. 부르는 쪽이 폴더를 정해서 준다. 발견 cache는 없다.
// turn 시작마다 다시 읽어 그 turn의 판을 고정한다.

// 폴더·파일을 동기로 보는 눈이다. 없으면 null이고 그 밖의 실패는 던진다. symlink는 따라가지 않는다.
export type SkillFiles = {
  list(dir: string): readonly string[] | null;
  kind(path: string): "file" | "dir" | "symlink" | null;
  read(
    path: string,
    maxBytes: number,
  ): { text: string; complete: boolean } | null;
};

// 층을 합친 skill 하나다. 앞 다섯 칸은 `ReadSkills`가 내는 것과 같다.
export type SkillEntry = SkillRow & {
  // 읽는 쪽만 쓰는 절대 위치다. prompt에는 나가지 않는다.
  bundle_path: string;
};

// 형식이 틀려 제외한 꾸러미와 이유다. 사람에게 알리는 진단이고 prompt에는 나가지 않는다.
export type SkillSkipped = {
  path: string;
  reason: string;
};

// 형식 상한이다.
const SKILL_NAME_MAX = 64;
const SKILL_DESCRIPTION_MAX = 1024;

// bundle 폴더 안의 manifest 이름이다.
export const SKILL_MANIFEST = "SKILL.md";

// 본문이 이 상한을 넘으면 읽기는 전체를 주지 못하고 실패다.
export const SKILL_BODY_MAX_BYTES = 24 * 1024;

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// skill 이름 검사다. 고치지 않는다: 대문자·연속 하이픈·앞뒤 하이픈은
// 제외 사유다.
function skillNameReason(name: unknown): string | null {
  if (typeof name !== "string" || name.length === 0) {
    return "skill name is missing";
  }
  if (name.length > SKILL_NAME_MAX) {
    return "skill name is over 64 characters";
  }
  if (!NAME.test(name)) {
    return "skill name uses characters outside lowercase letters, digits and single hyphens";
  }
  return null;
}

// 설명 검사다. 공백만으로 되지 않은 1~1,024자다.
function skillDescriptionReason(description: unknown): string | null {
  if (typeof description !== "string" || !/\S/.test(description)) {
    return "skill description is missing";
  }
  if (description.length > SKILL_DESCRIPTION_MAX) {
    return "skill description is over 1024 characters";
  }
  return null;
}

type SkillFrontmatter = {
  name: string;
  description: string;
  body: string;
};

// YAML 머리에서 name·description을 읽는다. 다른 key는 지우지 않고 무시한다(Agent Skills 형식의 다른 기록 필드를 남기기 위해서다).
// 닫히지 않은 fence, 틀린 YAML, map이 아닌 머리는 고치지 않고 실패 사유다. `description: >`나 `|` 같은 block scalar도 읽는다.
export function parseSkillFrontmatter(
  source: string,
): Result<SkillFrontmatter, string> {
  const lines = source.split("\n");
  if (lines[0].replace(/\r$/, "") !== "---") {
    return err("skill manifest has no frontmatter");
  }
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].replace(/\r$/, "") === "---") {
      close = i;
      break;
    }
  }
  if (close === -1) return err("skill frontmatter is not closed");
  let fields: unknown;
  try {
    fields = parse(lines.slice(1, close).join("\n"), { schema: "core" });
  } catch {
    // 사람이 쓴 옛 skill에는 따옴표 없는 값에 ": "가 든 것이 있어 YAML이 못 읽는다. 옛 줄 단위 읽기로 되돌려
    // 전에 읽히던 skill이 사라지지 않게 한다.
    const lined = plainLineFields(lines.slice(1, close));
    if (!lined.ok) return lined;
    fields = lined.value;
  }
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
    return err("skill frontmatter is not a map");
  }
  const { name, description } = fields as Record<string, unknown>;
  const nameFail = skillNameReason(name);
  if (nameFail !== null) return err(nameFail);
  const descriptionFail = skillDescriptionReason(description);
  if (descriptionFail !== null) return err(descriptionFail);
  return ok({
    name: name as string,
    description: (description as string).trim(),
    body: lines.slice(close + 1).join("\n"),
  });
}

// YAML이 못 읽는 머리의 옛 읽기다. `key: 단순 값` 줄만 받고 block·flow 표기와 중복 key는 실패다. 따옴표는 한 겹 벗긴다.
function plainLineFields(
  headLines: readonly string[],
): Result<Record<string, string>, string> {
  const fields: Record<string, string> = {};
  for (const raw of headLines) {
    const line = raw.replace(/\r$/, "");
    if (line.trim().length === 0) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(.*)$/.exec(line);
    if (match === null) return err("skill frontmatter is not valid YAML");
    let value = match[2].trim();
    if (/^[|>[{]/.test(value))
      return err("skill frontmatter is not valid YAML");
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      if (
        value.length < 2 ||
        !value.endsWith(quote) ||
        value.slice(1, -1).includes(quote)
      ) {
        return err("skill frontmatter is not valid YAML");
      }
      value = value.slice(1, -1);
    }
    if (Object.hasOwn(fields, match[1])) {
      return err("skill frontmatter is not valid YAML");
    }
    fields[match[1]] = value;
  }
  return ok(fields);
}

// ---- 층 합치기 ----

export type SkillCandidate = {
  name: string;
  source: SkillSource;
  bundle_path: string;
};

function declaredBuiltin(name: string) {
  return BUILTIN_SKILLS.find((builtin) => builtin.name === name);
}

// 내장 폴더에 있어도 선언되지 않은 이름은 내장 skill이 아니다.
function undeclaredBuiltinReason(name: string): string | null {
  return declaredBuiltin(name) === undefined
    ? "built-in skill is not declared"
    : null;
}

// 내장 skill은 선언한 workspace 종류만 갖는다. kind가 null이면 모두 본다(사람 화면의 목록).
export function builtinForWorkspace(
  name: string,
  kind: WorkspaceKind | null,
): boolean {
  const builtin = declaredBuiltin(name);
  return (
    builtin !== undefined &&
    (kind === null ||
      (builtin.workspaces as readonly WorkspaceKind[]).includes(kind))
  );
}

// 층 순서(내장, 공유, 전역, project·app, workspace-data)로 늘어선 후보를 이름마다 하나로 합친다. 마지막 층이 덮는다. 끌 수 없는 내장
// skill은 같은 이름의 사람 skill이 덮지 못해 그 skill을 skipped에 이유와 함께 둔다. 끈 이름은 끌 수 있는 skill에만 먹는다.
// 지금 발견되지 않는 끈 이름은 아무 일도 하지 않는다. 결과는 이름 사전순이다.
export function mergeSkillLayers<T extends SkillCandidate>(
  candidates: readonly T[],
  off: readonly string[],
  skipped: SkillSkipped[],
  // 내장 skill을 끌 수 있는지다. 기본은 선언(BUILTIN_SKILLS)이 말한다.
  builtinCanDisable: (name: string) => boolean = (name) =>
    declaredBuiltin(name)?.can_disable !== false,
): (T & { enabled: boolean; can_disable: boolean })[] {
  const canDisable = (candidate: SkillCandidate): boolean =>
    candidate.source !== "builtin" || builtinCanDisable(candidate.name);
  const byName = new Map<string, T>();
  for (const candidate of candidates) {
    const kept = byName.get(candidate.name);
    if (kept !== undefined && kept.source === "builtin" && !canDisable(kept)) {
      skipped.push({
        path: candidate.bundle_path,
        reason:
          "a built-in skill that cannot be turned off has this name, so it stays",
      });
      continue;
    }
    byName.set(candidate.name, candidate);
  }
  const offNames = new Set(off);
  return [...byName.values()]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((candidate) => {
      const disable = canDisable(candidate);
      return {
        ...candidate,
        can_disable: disable,
        enabled: !disable || !offNames.has(candidate.name),
      };
    });
}

// agent가 받는 skill인지다. 정의가 끈 이름(`skills_off`)은 받지 않는다. 끌 수 없는 내장 skill은 늘 받는다.
// resolve, skill.read, `/` 메뉴, 공유 skill이 모두 이 규칙을 쓴다.
export function skillReceived(
  skill: { name: string; can_disable: boolean },
  off: readonly string[],
): boolean {
  return !skill.can_disable || !off.includes(skill.name);
}

// 발견 출처다. 내장, 전역(등록 폴더는 등록 순서 그대로, 개인 보관소), workspace 폴더, workspace 그릇 자리의 `skills/`와 core가 읽어 준 공유 skill(`shared`)이다. null은 그 출처가 없는 것이다.
export type SkillSources = {
  bundled: string | null;
  registered: readonly string[];
  personal: string | null;
  // project나 app workspace의 `.lophn/skills` 폴더다. 전역 다음 층이다. 그 workspace 밖이나 폴더가 없으면 없다.
  workspace?: WorkspaceSkills | null;
  // workspace 그릇 자리(`<data>/projects/<prj>`, `<data>/apps/<app>`)의 `skills/` 폴더다. 마지막 층이고 폴더 없는 project도 받는다. home이면 없다.
  workspaceData?: string | null;
  // 할당한 앱의 public skill이다. 내장 바로 위, 전역 아래 층이다. 같은 이름은 앞의 것이 이긴다(부르는 쪽이 slug 순으로 준다).
  shared?: readonly SharedSkillHead[];
};

export type WorkspaceSkills = { source: "project" | "app"; folder: string };

// 할당한 앱이 active release로 내놓은 public skill이다. 목록(prompt, `/` 메뉴, 개수)에는 head면 되고, `skill.read`는 본문까지 든
// SharedSkill을 쓴다.
export type SharedSkillHead = {
  // 앱 id와 slug. slug 순이 같은 이름의 우선이다.
  app: string;
  slug: string;
  name: string;
  description: string;
};

// core가 bundle에서 읽어 준 본문이다. 파일이 아니라 이 값이 곧 skill이다.
export type SharedSkill = SharedSkillHead & {
  // frontmatter까지 든 SKILL.md 전체와 딸린 `.md` 파일이다.
  skill_md: string;
  files: readonly { name: string; text: string }[];
};

// 앱 bundle 안에서 skill 폴더들이 있는 자리다.
export const SHARED_ROOT_DIR = ".lophn";
export const SHARED_SKILLS_DIR = `${SHARED_ROOT_DIR}/skills`;

// 선언에서 다른 agent에게 주는 skill의 이름이다. 선언에 없는 폴더는 열지 않는다.
export function publicSkillNames(
  declared: readonly { name: string; public: boolean }[],
): string[] {
  return declared
    .filter((skill) => skill.public)
    .map((skill) => skill.name)
    .sort();
}

// 공유 skill의 SKILL.md가 맞는 꼴이면 설명을 준다. 폴더 이름과 frontmatter 이름이 다르면 읽지 않는다.
export function sharedManifestDescription(
  name: string,
  text: string,
): string | null {
  const parsed = parseSkillFrontmatter(text);
  return parsed.ok && parsed.value.name === name
    ? parsed.value.description
    : null;
}

// SKILL.md 옆에서 같이 주는 file인지다.
export function isSharedCompanion(file: string): boolean {
  return (
    !file.startsWith(".") && file !== SKILL_MANIFEST && file.endsWith(".md")
  );
}

// 받는 쪽이 쓰는 공유 skill이다. slug 순으로 같은 이름은 앞의 것만 남기고, 앱 자기 workspace에서는 그 앱의 `app` 층으로
// 이미 보이므로 싣지 않는다.
export function sharedFor<T extends SharedSkillHead>(
  shared: readonly T[],
  workspace: AgentWorkspace | null,
): T[] {
  const names = new Set<string>();
  return [...shared]
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .filter((skill) => {
      if (workspace?.kind === "app" && skill.app === workspace.id) return false;
      if (names.has(skill.name)) return false;
      names.add(skill.name);
      return true;
    });
}

// 공유 skill의 `bundle_path`다. 파일 위치가 아니라 이 값으로 snapshot이 본문을 찾는다.
export function sharedPathOf(
  skill: Pick<SharedSkillHead, "slug" | "name">,
): string {
  return `shared:${skill.slug}/${skill.name}`;
}

// 한 앱의 active release bundle 사본과 그 선언의 public skill 이름이다(앱 module이 sql로 알려 준다).
export type SharedFolder = {
  app: string;
  slug: string;
  bundle: string;
  names: readonly string[];
};

// 동기 목록 읽기다(`/` 메뉴, Agents 탭 개수). 이름과 설명만 읽는다. 본문 읽기(`app.skills`)와 같은 규칙을 쓰되 realpath 대신
// bundle 아래 길의 마디마다 lstat로 symlink가 아닌 폴더인지 본다. 읽을 수 없는 skill은 오류 없이 뺀다.
export function readSharedHeads(
  files: SkillFiles,
  folders: readonly SharedFolder[],
): SharedSkillHead[] {
  const heads: SharedSkillHead[] = [];
  for (const folder of folders) {
    for (const name of folder.names) {
      const found = attempt(() => {
        const lophn = joinPath(folder.bundle, SHARED_ROOT_DIR);
        const skills = joinPath(folder.bundle, SHARED_SKILLS_DIR);
        const dir = joinPath(skills, name);
        if (![lophn, skills, dir].every((path) => files.kind(path) === "dir")) {
          return null;
        }
        const read = files.read(
          joinPath(dir, SKILL_MANIFEST),
          SKILL_BODY_MAX_BYTES,
        );
        if (read === null || !read.complete) return null;
        return sharedManifestDescription(name, read.text);
      });
      if (found.ok && found.value !== null) {
        heads.push({
          app: folder.app,
          slug: folder.slug,
          name,
          description: found.value,
        });
      }
    }
  }
  return heads;
}

export type SkillListing = {
  entries: readonly SkillEntry[];
  skipped: readonly SkillSkipped[];
};

type Candidate = SkillCandidate & { description: string };

function attempt<T>(read: () => T): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: read() };
  } catch {
    return { ok: false };
  }
}

// kind가 null이면 내장 skill을 모두 낸다(사람 화면만). off는 끈 이름의 합이다.
export function discoverSkills(
  files: SkillFiles,
  sources: SkillSources,
  options: { kind: WorkspaceKind | null; off: readonly string[] },
): SkillListing {
  const candidates: Candidate[] = [];
  const skipped: SkillSkipped[] = [];

  const addBundle = (bundle: string, source: SkillSource): void => {
    const manifest = joinPath(bundle, SKILL_MANIFEST);
    const kind = attempt(() => files.kind(manifest));
    // 검사 실패와 manifest 없음은 조용히 건너뛴다: 꾸러미가 아닌 폴더이거나 보관소 오류다.
    if (!kind.ok || kind.value === null) return;
    if (kind.value === "symlink") {
      skipped.push({
        path: manifest,
        reason: "skill manifest is a symbolic link",
      });
      return;
    }
    if (kind.value !== "file") {
      skipped.push({ path: manifest, reason: "skill manifest is not a file" });
      return;
    }
    const read = attempt(() => files.read(manifest, SKILL_BODY_MAX_BYTES));
    if (!read.ok) {
      skipped.push({
        path: manifest,
        reason: "skill manifest could not be read",
      });
      return;
    }
    if (read.value === null || !read.value.complete) {
      skipped.push({
        path: manifest,
        reason:
          read.value === null
            ? "skill manifest is missing"
            : `skill manifest is larger than ${SKILL_BODY_MAX_BYTES / 1024} KiB; move parts of it into bundled .md files`,
      });
      return;
    }
    const parsed = parseSkillFrontmatter(read.value.text);
    if (!parsed.ok) {
      skipped.push({ path: manifest, reason: parsed.error });
      return;
    }
    if (source === "builtin") {
      const undeclared = undeclaredBuiltinReason(parsed.value.name);
      if (undeclared !== null) {
        skipped.push({ path: manifest, reason: undeclared });
        return;
      }
    }
    candidates.push({
      name: parsed.value.name,
      description: parsed.value.description,
      source,
      bundle_path: bundle,
    });
  };

  // container 바로 아래 꾸러미를 폴더 이름의 영문 사전순으로 본다.
  // 개인·내장·workspace-data 폴더가 아직 없는 것은 그 출처가 비어 있을 뿐이고, 사람이 등록한 폴더가 없는 것은 알린다.
  const scanFolder = (
    container: string,
    source: SkillSource,
    reportMissing: boolean,
  ): void => {
    const folder = attempt(() => files.kind(container));
    if (folder.ok && folder.value === null && !reportMissing) return;
    if (!folder.ok || folder.value !== "dir") {
      skipped.push({
        path: container,
        reason:
          folder.ok && folder.value === "symlink"
            ? "skill scope root is a symbolic link"
            : folder.ok
              ? "skill scope root is not a folder"
              : "skill scope root could not be checked",
      });
      return;
    }
    const listed = attempt(() => files.list(container));
    if (!listed.ok) {
      skipped.push({
        path: container,
        reason: "skill scope folder could not be listed",
      });
      return;
    }
    const names = (listed.value ?? [])
      .filter((name) => !name.startsWith("."))
      .slice()
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const name of names) {
      if (name.includes("/") || name.includes("\\")) {
        skipped.push({
          path: joinPath(container, name),
          reason: "skill bundle folder name is not a folder name",
        });
        continue;
      }
      const bundle = joinPath(container, name);
      const kind = attempt(() => files.kind(bundle));
      if (!kind.ok || kind.value !== "dir") {
        skipped.push({
          path: bundle,
          reason: kind.ok
            ? folderSkipReason(kind.value)
            : "skill bundle folder could not be checked",
        });
        continue;
      }
      addBundle(bundle, source);
    }
  };

  if (sources.bundled !== null) scanFolder(sources.bundled, "builtin", false);
  for (const skill of sources.shared ?? []) {
    candidates.push({
      name: skill.name,
      description: skill.description,
      source: "shared",
      bundle_path: sharedPathOf(skill),
    });
  }
  for (const root of sources.registered) {
    // 등록 폴더 자신이 꾸러미일 수 있다.
    addBundle(root, "global");
    scanFolder(root, "global", true);
  }
  if (sources.personal !== null) scanFolder(sources.personal, "global", false);
  if (sources.workspace != null) {
    scanFolder(sources.workspace.folder, sources.workspace.source, false);
  }
  if (sources.workspaceData != null) {
    scanFolder(sources.workspaceData, "workspace-data", false);
  }

  const visible = candidates.filter(
    (candidate) =>
      candidate.source !== "builtin" ||
      builtinForWorkspace(candidate.name, options.kind),
  );
  return { entries: mergeSkillLayers(visible, options.off, skipped), skipped };
}

// 폴더 경로를 붙인다. Windows drive root는 `\`를 쓴다(표기만, 읽기는
// port가 한다).
export function joinPath(dir: string, name: string): string {
  if (dir.endsWith("/") || dir.endsWith("\\")) return `${dir}${name}`;
  const separator = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return `${dir}${separator}${name}`;
}

function folderSkipReason(kind: "file" | "dir" | "symlink" | null): string {
  switch (kind) {
    case "symlink":
      return "skill bundle folder is a symbolic link";
    case "file":
      return "skill bundle folder is a file";
    default:
      return "skill bundle folder is missing";
  }
}
