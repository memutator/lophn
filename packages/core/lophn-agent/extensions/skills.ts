import { err, ok, type Result } from "../../../base/mod.ts";
import { sha256Hex } from "../../../base/mod.ts";
import {
  BUILTIN_SKILLS,
  type Role,
  type SkillEntry as SkillRow,
  type SkillSource,
} from "../../../protocol/lophn-agent/mod.ts";

// skill 발견, 검증, 층 합치기. 층은 내장, 전역(등록 폴더와 개인 보관소), domain
// 셋이고 같은 이름은 마지막 층이 덮는다. 같은 이름이 여러 domain에 있으면 domain 이름이 앞서는 쪽이 이긴다. 다만 끌 수 없는 내장 skill은 사람 skill이 같은 이름으로 덮지 못한다.
// 끄기는 이름 단위다. 파일 IO는 SkillFilesPort로 끼운다. 이 모듈은 사람의 실제 home이나 다른 harness 보관소를
// 열지 않는다. 부르는 쪽이 폴더를 정해서 준다. 발견 cache는 없다. turn 시작마다 다시 읽어 그 turn의 판을 고정한다.

// 폴더·파일을 보는 눈이다. runtime은 실제 폴더 port를, 테스트는 temp dir port를 끼운다.
export type SkillFilesPort = {
  // 폴더의 바로 아래 이름이다. 폴더가 없으면 null이다.
  list(dir: string): Promise<Result<readonly string[] | null>>;
  // 경로 종류이다. 없으면 null이다. symlink는 따라가지 않는다.
  kind(path: string): Promise<Result<"file" | "dir" | "symlink" | null>>;
  // UTF-8 텍스트를 max_bytes 안에서 읽는다. 없으면 null이고, 상한을 넘으면 complete false다.
  read(
    path: string,
    max_bytes: number,
  ): Promise<Result<{ text: string; complete: boolean } | null>>;
  // 파일의 POSIX 실행 권한이다. 없으면 null이다.
  executable(path: string): Promise<Result<boolean | null>>;
};

type SkillSupplemental = {
  title: string;
  // bundle 폴더 안의 상대 경로다. `..`·절대 경로는 발견에서 제외한다.
  relative_path: string;
  hash: string;
};

// 층을 합친 skill 하나다. 앞 여섯 칸(domain 포함)은 `ReadSkills`가 내는 것과 같다.
export type SkillEntry = SkillRow & {
  // SKILL.md 원문의 sha256이다.
  content_hash: string;
  // 읽는 쪽만 쓰는 절대 위치다. prompt에는 나가지 않는다.
  bundle_path: string;
  supplemental: readonly SkillSupplemental[];
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
    value.startsWith("|") || value.startsWith(">") || value.startsWith("[") ||
    value.startsWith("{")
  ) {
    return "skill frontmatter value is not a plain scalar";
  }
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    if (
      value.length < 2 || !value.endsWith(quote) ||
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
};

function declaredBuiltin(name: string) {
  return BUILTIN_SKILLS.find((builtin) => builtin.name === name);
}

// 내장 폴더에 있어도 선언되지 않은 이름은 내장 skill이 아니다.
export function undeclaredBuiltinReason(name: string): string | null {
  return declaredBuiltin(name) === undefined
    ? "built-in skill is not declared"
    : null;
}

// 내장 skill은 선언한 role의 agent만 갖는다. role이 null이면 모두 본다(사람 화면의 목록).
export function builtinForRole(name: string, role: Role | null): boolean {
  const builtin = declaredBuiltin(name);
  return builtin !== undefined &&
    (role === null || (builtin.roles as readonly Role[]).includes(role));
}

// 층 순서(내장, 전역, domain)로 늘어선 후보를 이름마다 하나로 합친다. 마지막 층이 덮고, 끌 수 없는 내장 skill은
// 같은 이름의 사람 skill이 덮지 못해 그 skill을 skipped에 이유와 함께 둔다. 끈 이름은 끌 수 있는 skill에만 먹는다.
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
    if (
      kept !== undefined && kept.source === "builtin" &&
      !canDisable(kept)
    ) {
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

// agent가 받는 skill인지다. domain 층 skill은 agent가 일하는 domain의 것만 받는다. 정의가 고른 이름이 없으면
// 모두 받고, 있으면 고른 것만 받는다. 끌 수 없는 내장 skill은 고르지 않아도 받는다. resolve, skill.read, `/` 메뉴가
// 모두 이 규칙을 쓴다.
export function skillReceived(
  skill: { name: string; can_disable: boolean; domain: string | null },
  chosen: readonly string[],
  domains: readonly string[],
): boolean {
  return (skill.domain === null || domains.includes(skill.domain)) &&
    (!skill.can_disable || chosen.length === 0 || chosen.includes(skill.name));
}

// ---- 발견 ----

type Candidate = SkillCandidate & {
  description: string;
  domain: string | null;
  content_hash: string;
  supplemental: readonly SkillSupplemental[];
};

type SkillDiscoveryInput = {
  port: SkillFilesPort;
  // 내장 skill 폴더다. 없으면 null이다.
  builtin_root: string | null;
  // 전역 층: 등록 폴더는 사람이 정한 순서 그대로, 개인 보관소는 그 뒤다. 없으면 null이다.
  registered_roots: readonly string[];
  personal_store: string | null;
  // domain 층: place 그릇의 active domain과 그 skill 폴더다. domain 이름순으로 받고 앞서는 domain이 이긴다.
  // 그릇이 없는 agent는 빈 목록이다.
  domain_stores: readonly DomainStore[];
  // 내장 skill을 이 role의 것만 남긴다. null이면 모두 남긴다.
  role: Role | null;
  // 끈 이름: 전역, project, agent 정의가 끈 것의 합이다.
  off: readonly string[];
  // manifest와 딸린 파일 읽기 상한이다.
  max_file_bytes: number;
};

export type DomainStore = { domain: string; folder: string };

export type SkillDiscovery = {
  entries: readonly SkillEntry[];
  skipped: readonly SkillSkipped[];
};

// 발견은 turn 경계에서만 한다. 내장, 등록 폴더, 개인 보관소, domain 순서로 폴더 자신과 바로 아래 꾸러미만 본다.
export async function discoverSkills(
  input: SkillDiscoveryInput,
): Promise<Result<SkillDiscovery>> {
  for (const name of input.off) {
    const reason = skillNameReason(name);
    if (reason !== null) {
      return err({ code: "invalid_input", message: reason });
    }
  }
  const candidates: Candidate[] = [];
  const skipped: SkillSkipped[] = [];
  if (input.builtin_root !== null) {
    await scanFolders(
      input,
      candidates,
      skipped,
      input.builtin_root,
      "builtin",
    );
  }
  for (const root of input.registered_roots) {
    // 등록 폴더 자신이 꾸러미일 수 있다.
    await addBundle(input, candidates, skipped, root, "global");
    await scanFolders(input, candidates, skipped, root, "global");
  }
  if (input.personal_store !== null) {
    await scanFolders(
      input,
      candidates,
      skipped,
      input.personal_store,
      "global",
    );
  }
  // 마지막 층이 덮으므로 이름이 앞서는 domain을 나중에 둔다.
  for (const store of [...input.domain_stores].reverse()) {
    await scanFolders(
      input,
      candidates,
      skipped,
      store.folder,
      "domain",
      store.domain,
    );
  }
  const visible = candidates.filter((candidate) =>
    candidate.source !== "builtin" ||
    builtinForRole(candidate.name, input.role)
  );
  return ok({
    entries: mergeSkillLayers(visible, input.off, skipped),
    skipped,
  });
}

// prompt에 나가는 skill 목록의 재료다. 켜진 skill의 이름과 설명만 이름 사전순이다. 본문과 경로는 나가지 않는다.

// 폴더 경로를 붙인다. Windows drive root는 `\`를 쓴다(표기만, 읽기는
// port가 한다).
export function joinPath(dir: string, name: string): string {
  if (dir.endsWith("/") || dir.endsWith("\\")) return `${dir}${name}`;
  const separator = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return `${dir}${separator}${name}`;
}

// 폴더의 바로 아래 skill 꾸러미를 사전순으로 본다. 아직 없는 폴더도 알린다.
async function scanFolders(
  input: SkillDiscoveryInput,
  candidates: Candidate[],
  skipped: SkillSkipped[],
  container: string,
  source: SkillSource,
  domain: string | null = null,
): Promise<void> {
  const folder = await input.port.kind(container);
  if (!folder.ok || folder.value !== "dir") {
    skipped.push({
      path: container,
      reason: folder.ok && folder.value === "symlink"
        ? "skill scope root is a symbolic link"
        : folder.ok
        ? "skill scope root is not a folder"
        : "skill scope root could not be checked",
    });
    return;
  }
  const contents = await input.port.list(container);
  if (!contents.ok) {
    skipped.push({
      path: container,
      reason: "skill scope folder could not be listed",
    });
    return;
  }
  const names = (contents.value ?? []).filter((name) => !name.startsWith("."))
    .slice()
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const name of names) {
    if (
      name === "." || name === ".." || name.includes("/") ||
      name.includes("\\")
    ) {
      skipped.push({
        path: joinPath(container, name),
        reason: "skill bundle folder name is not a folder name",
      });
      continue;
    }
    const bundle = joinPath(container, name);
    const kind = await input.port.kind(bundle);
    if (!kind.ok || kind.value !== "dir") {
      skipped.push({
        path: bundle,
        reason: kind.ok
          ? folderSkipReason(kind.value)
          : "skill bundle folder could not be checked",
      });
      continue;
    }
    await addBundle(input, candidates, skipped, bundle, source, domain);
  }
}

export function folderSkipReason(
  kind: "file" | "dir" | "symlink" | null,
): string {
  switch (kind) {
    case "symlink":
      return "skill bundle folder is a symbolic link";
    case "file":
      return "skill bundle folder is a file";
    default:
      return "skill bundle folder is missing";
  }
}

// 한 skill 꾸러미를 읽는다. manifest가 없거나 잘못된 형식은 이유와 함께 제외하고 고치지 않는다.
async function addBundle(
  input: SkillDiscoveryInput,
  candidates: Candidate[],
  skipped: SkillSkipped[],
  bundle: string,
  source: SkillSource,
  domain: string | null = null,
): Promise<void> {
  const manifest = joinPath(bundle, SKILL_MANIFEST);
  const kind = await input.port.kind(manifest);
  if (!kind.ok) return; // port 검사 실패는 조용히 건너뛴다: 보관소 오류이다.
  if (kind.value === null) return; // skill 꾸러미가 아닌 폴더다.
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
  const read = await input.port.read(manifest, input.max_file_bytes);
  if (!read.ok) {
    skipped.push({
      path: manifest,
      reason: "skill manifest could not be read",
    });
    return;
  }
  const file = read.value;
  if (file === null || !file.complete) {
    skipped.push({
      path: manifest,
      reason: file === null
        ? "skill manifest is missing"
        : "skill manifest is over the read limit",
    });
    return;
  }
  const parsed = parseSkillFrontmatter(file.text);
  if (!parsed.ok) {
    skipped.push({ path: manifest, reason: parsed.error });
    return;
  }
  const supplemental = await scanSupplemental(input, skipped, bundle);
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
    content_hash: await sha256Hex(file.text),
    bundle_path: bundle,
    supplemental,
  });
}

// 보조 자료는 bundle 폴더 안의 UTF-8 Markdown 파일뿐이다. 밖을 가리키는
// symlink·실행 파일은 제외하고 이유를 남긴다.
async function scanSupplemental(
  input: SkillDiscoveryInput,
  skipped: SkillSkipped[],
  bundle: string,
): Promise<readonly SkillSupplemental[]> {
  const contents = await input.port.list(bundle);
  if (!contents.ok) return [];
  const supplemental: SkillSupplemental[] = [];
  for (const name of contents.value ?? []) {
    if (name.startsWith(".") || name === SKILL_MANIFEST) continue;
    if (!name.endsWith(".md")) continue;
    const path = joinPath(bundle, name);
    const kind = await input.port.kind(path);
    if (!kind.ok || kind.value !== "file") {
      skipped.push({
        path,
        reason: kind.ok
          ? "supplemental document is not a plain file"
          : "supplemental document could not be checked",
      });
      continue;
    }
    const executable = await input.port.executable(path);
    if (executable.ok && executable.value === true) {
      skipped.push({
        path,
        reason: "supplemental document is executable",
      });
      continue;
    }
    const read = await input.port.read(path, input.max_file_bytes);
    if (!read.ok || read.value === null || !read.value.complete) {
      skipped.push({
        path,
        reason: "supplemental document could not be read in full",
      });
      continue;
    }
    supplemental.push({
      title: name.slice(0, -3),
      relative_path: name,
      hash: await sha256Hex(read.value.text),
    });
  }
  return supplemental;
}
