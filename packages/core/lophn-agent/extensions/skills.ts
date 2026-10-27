import { err, ok, type Result } from "../../../base/mod.ts";
import {
  BUILTIN_SKILLS,
  type Role,
  type SkillEntry as SkillRow,
  type SkillSource,
} from "../../../protocol/lophn-agent/mod.ts";

// skill 발견, 검증, 층 합치기. 층은 내장, 전역(등록 폴더와 개인 보관소), domain
// 셋이고 같은 이름은 마지막 층이 덮는다. 다만 domain 층 skill은 domain마다 따로 남는다. 어느 domain의 것이 이기는지는
// agent가 일하는 domain을 거른 뒤 `pickSkills`가 정한다. 끌 수 없는 내장 skill은 사람 skill이 같은 이름으로 덮지 못한다.
// 끄기는 이름 단위다. 발견은 동기다(core read handler가 동기라 비동기 발견을 부르지 못하고, 비동기 함수 안에서는 동기
// 함수를 그대로 부를 수 있다). 파일 IO는 SkillFiles로 끼운다. 내장 skill은 `role`에 선언된 것만 후보다. 이 모듈은
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

// 층을 합친 skill 하나다. 앞 여섯 칸(domain 포함)은 `ReadSkills`가 내는 것과 같다.
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

// YAML 머리에서 name·description만 단순행으로 본다. 전체 YAML을 풀지
// 않는다: 블록·flow 표기·중복 key·닫히지 않은 fence는 고치지 않고 실패 사유다.
// 모르는 단순 key는 지우지 않고 무시한다(Agent Skills 형식의 다른 기록 필드를
// 남기기 위해서다).
export function parseSkillFrontmatter(
  source: string,
): Result<SkillFrontmatter, string> {
  if (!source.startsWith("---")) {
    return err("skill manifest has no frontmatter");
  }
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
  const fields = new Map<string, string>();
  for (const raw of lines.slice(1, close)) {
    const line = raw.replace(/\r$/, "");
    if (line.trim().length === 0) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(.*)$/.exec(line);
    if (match === null) {
      return err("skill frontmatter is not name and description lines");
    }
    const value = scalarReasonOrValue(match[2]);
    if (typeof value === "string") return err(value);
    if (fields.has(match[1])) {
      return err(`skill frontmatter has a duplicated ${match[1]}`);
    }
    fields.set(match[1], value.value);
  }
  const name = fields.get("name");
  const description = fields.get("description");
  const nameFail = skillNameReason(name);
  if (nameFail !== null) return err(nameFail);
  const descriptionFail = skillDescriptionReason(description);
  if (descriptionFail !== null) return err(descriptionFail);
  return ok({
    name: name as string,
    description: description as string,
    body: lines.slice(close + 1).join("\n"),
  });
}

// 단순 scalar만 받는다. 따옴표는 한 겹까지만 벗긴다. 블록·flow 표기는
// 고치지 않는다.
function scalarReasonOrValue(raw: string): string | { value: string } {
  const value = raw.replace(/^\s+/, "").replace(/\s+$/, "");
  if (value.length === 0) return { value: "" };
  if (
    value.startsWith("|") ||
    value.startsWith(">") ||
    value.startsWith("[") ||
    value.startsWith("{")
  ) {
    return "skill frontmatter value is not a plain scalar";
  }
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    if (
      value.length < 2 ||
      !value.endsWith(quote) ||
      value.slice(1, -1).includes(quote)
    ) {
      return "skill frontmatter value is not a closed scalar";
    }
    return { value: value.slice(1, -1) };
  }
  return { value };
}

// ---- 층 합치기 ----

export type SkillCandidate = {
  name: string;
  source: SkillSource;
  bundle_path: string;
  // domain 층 skill이 속한 domain id다. 그 밖의 skill은 null이다.
  domain: string | null;
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

// 내장 skill은 선언한 role의 agent만 갖는다. role이 null이면 모두 본다(사람 화면의 목록).
export function builtinForRole(name: string, role: Role | null): boolean {
  const builtin = declaredBuiltin(name);
  return (
    builtin !== undefined &&
    (role === null || (builtin.roles as readonly Role[]).includes(role))
  );
}

// 층 순서(내장, 전역, domain)로 늘어선 후보를 합친다. 내장과 전역은 이름마다 하나이고 마지막 층이 덮는다. domain 층은
// 합치지 않고 domain마다 남긴다(전역 `x`가 domain `x`에 가려져 그 domain을 고르지 않은 agent가 잃지 않게). 끌 수 없는 내장
// skill은 같은 이름의 사람 skill이 덮지 못해 그 skill을 skipped에 이유와 함께 둔다. 끈 이름은 끌 수 있는 skill에만 먹는다.
// 지금 발견되지 않는 끈 이름은 아무 일도 하지 않는다. 결과는 이름 사전순이고 같은 이름은 전역, domain(받은 순서) 순이다.
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
  const perDomain: T[] = [];
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
    if (candidate.domain === null) byName.set(candidate.name, candidate);
    else perDomain.push(candidate);
  }
  const offNames = new Set(off);
  return [...byName.values(), ...perDomain]
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

// agent가 받는 skill인지다. domain 층 skill은 agent가 일하는 domain의 것만 받는다. 정의가 고른 이름이 없으면
// 모두 받고, 있으면 고른 것만 받는다. 끌 수 없는 내장 skill은 고르지 않아도 받는다. resolve, skill.read, `/` 메뉴가
// 모두 이 규칙을 쓴다.
export function skillReceived(
  skill: { name: string; can_disable: boolean; domain: string | null },
  chosen: readonly string[],
  domains: readonly string[],
): boolean {
  return (
    (skill.domain === null || domains.includes(skill.domain)) &&
    (!skill.can_disable || chosen.length === 0 || chosen.includes(skill.name))
  );
}

// 합친 목록에서 이름마다 한 줄만 남긴다. 받는 줄 가운데 domain 층이 전역을 덮고, domain 사이는 목록에서 앞선 쪽이
// 이긴다. 받는 줄이 없으면 첫 줄이다. 받는 쪽(`received`)은 resolve, skill.read, `/` 메뉴가 `skillReceived`로 정한다.
export function pickSkills<T extends { name: string; domain: string | null }>(
  entries: readonly T[],
  received: (entry: T) => boolean,
): T[] {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    groups.set(entry.name, [...(groups.get(entry.name) ?? []), entry]);
  }
  return [...groups.values()].map((group) => {
    const got = group.filter(received);
    return got.find((entry) => entry.domain !== null) ?? got[0] ?? group[0];
  });
}

// 발견 출처다. 내장, 전역(등록 폴더는 등록 순서 그대로, 개인 보관소), domain 폴더들이다. null은 그 출처가 없는 것이다.
// domain은 이름순으로 받는다.
export type SkillSources = {
  bundled: string | null;
  registered: readonly string[];
  personal: string | null;
  domains: readonly DomainStore[];
};

// domain 층 skill은 `domain`이 그 domain id이고 아니면 null이다.
export type SkillListing = {
  entries: readonly SkillEntry[];
  skipped: readonly SkillSkipped[];
};

type Candidate = SkillCandidate & { description: string };

export type DomainStore = { domain: string; folder: string };

function attempt<T>(read: () => T): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: read() };
  } catch {
    return { ok: false };
  }
}

// role이 null이면 내장 skill을 모두 낸다(사람 화면만). off는 끈 이름의 합이다.
export function discoverSkills(
  files: SkillFiles,
  sources: SkillSources,
  options: { role: Role | null; off: readonly string[] },
): SkillListing {
  const candidates: Candidate[] = [];
  const skipped: SkillSkipped[] = [];

  const addBundle = (
    bundle: string,
    source: SkillSource,
    domain: string | null = null,
  ): void => {
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
            : "skill manifest is over the read limit",
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
      domain,
      bundle_path: bundle,
    });
  };

  // container 바로 아래 꾸러미를 폴더 이름의 영문 사전순으로 본다.
  // 개인·내장·domain 폴더가 아직 없는 것은 그 출처가 비어 있을 뿐이고, 사람이 등록한 폴더가 없는 것은 알린다.
  const scanFolder = (
    container: string,
    source: SkillSource,
    reportMissing: boolean,
    domain: string | null = null,
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
      addBundle(bundle, source, domain);
    }
  };

  if (sources.bundled !== null) scanFolder(sources.bundled, "builtin", false);
  for (const root of sources.registered) {
    // 등록 폴더 자신이 꾸러미일 수 있다.
    addBundle(root, "global");
    scanFolder(root, "global", true);
  }
  if (sources.personal !== null) scanFolder(sources.personal, "global", false);
  for (const store of sources.domains) {
    scanFolder(store.folder, "domain", false, store.domain);
  }

  const visible = candidates.filter(
    (candidate) =>
      candidate.source !== "builtin" ||
      builtinForRole(candidate.name, options.role),
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
