import { err, ok, type Result } from "../../../base/mod.ts";
import { sha256Hex } from "../../../base/mod.ts";
import type { Clock } from "../../../base/mod.ts";

// skill 발견·검증·선택(concern lophn-agent/extensions). 파일 IO는 FilesPort로
// 끼운다. 이 모듈은 사람의 실제 home·app 소스·다른 harness 보관소를 열지 않는다:
// 부르는 쪽이 발견 root·개인 보관소·동봉 폴더를 정해서 준다. 테스트는
// temp dir만 쓴다. 발견 cache는 없다: run 경계마다 다시 스캔해서 RunBasis에
// 고정할 content hash를 만든다.

// 폴더·파일을 보는 눈이다. runtime은 실제 폴더 port를, 테스트는 temp dir
// port를 끼운다. 사람의 실제 home을 이 모듈이 직접 읽지 않는다.
export type SkillFilesPort = {
  // 폴더의 바로 아래 이름이다. 폴더가 없으면 null이다.
  list(dir: string): Promise<Result<readonly string[] | null>>;
  // 경로 종류이다. 없으면 null이다. symlink는 따라가지 않는다.
  kind(path: string): Promise<Result<"file" | "dir" | "symlink" | null>>;
  // UTF-8 텍스트를 max_bytes 안에서 읽는다. 없으면 null이고, 상한을 넘으면
  // complete false다. 부분 성공 없이 실패를 판단하려면 complete가 필요하다.
  read(
    path: string,
    max_bytes: number,
  ): Promise<Result<{ text: string; complete: boolean } | null>>;
  // 파일의 POSIX 실행 권한이다. 없으면 null이다.
  executable(path: string): Promise<Result<boolean | null>>;
};

export type SkillScope = "place" | "registered" | "personal" | "bundled";

export type SkillSupplemental = {
  title: string;
  // bundle 폴더 안의 상대 경로다. `..`·절대 경로는 발견에서 제외한다.
  relative_path: string;
  hash: string;
};

export type SkillEntry = {
  name: string;
  description: string;
  // SKILL.md 원문의 sha256이다. run 시작에 RunBasis로 고정한다.
  content_hash: string;
  source_kind: SkillScope;
  // registered root의 등록 순번이다. personal·bundled에는 없다.
  folder_order: number | null;
  // platform이 읽는 절대 위치다. agent prompt에는 나가지 않는다.
  bundle_path: string;
  supplemental: readonly SkillSupplemental[];
  // 발견 목록과 preset의 정확한 이름 선택의 교집합이다.
  selected: boolean;
  discovered_at: string;
};

// 사람에게 알릴 제외 진단이다. bundle_path처럼 진단은 사람용이고
// agent prompt에는 나가지 않는다.
export type SkillSkipped = {
  path: string;
  reason: string;
};

// 같은 이름으로 밀려난 발견이다. 먼저 발견한 것 하나만 남는다.
export type SkillShadowing = {
  name: string;
  kept_bundle: string;
  dropped_bundle: string;
};

export type SkillDiscovery = {
  entries: readonly SkillEntry[];
  skipped: readonly SkillSkipped[];
  shadowing: readonly SkillShadowing[];
  // preset이 골랐지만 발견하지 못한 이름이다.
  missing: readonly string[];
};

// 형식 상한이다.
export const SKILL_NAME_MAX = 64;
export const SKILL_DESCRIPTION_MAX = 1024;

// bundle 폴더 안의 manifest 이름이다.
export const SKILL_MANIFEST = "SKILL.md";

// 본문이 이 상한을 넘으면 읽기는 전체를 주지 못하고 실패다.
export const SKILL_BODY_MAX_BYTES = 24 * 1024;

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// skill 이름 검사다. 고치지 않는다: 대문자·연속 하이픈·앞뒤 하이픈은
// 제외 사유다.
export function skillNameReason(name: unknown): string | null {
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
export function skillDescriptionReason(description: unknown): string | null {
  if (typeof description !== "string" || !/\S/.test(description)) {
    return "skill description is missing";
  }
  if (description.length > SKILL_DESCRIPTION_MAX) {
    return "skill description is over 1024 characters";
  }
  return null;
}

export type SkillFrontmatter = {
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

type Candidate = {
  name: string;
  description: string;
  hash: string;
  scope: SkillScope;
  folder_order: number | null;
  bundle_path: string;
  supplemental: readonly SkillSupplemental[];
};

export type SkillDiscoveryInput = {
  port: SkillFilesPort;
  clock: Clock;
  // 그 agent 자리(project·app)의 skill 폴더다. 가장 먼저 찾고 폴더 자신은 꾸러미가 아니라
  // 꾸러미를 담는 폴더다. 없으면 null이다.
  place_store?: string | null;
  // 등록 root는 사람이 정한 등록 순서 그대로다.
  registered_roots: readonly string[];
  // 개인 skill 보관소 폴더다. 없으면 null이다.
  personal_store: string | null;
  // 동봉 skill 폴더다(설치 bundle의 assets/skills). 없으면 null이다.
  bundled_root: string | null;
  // manifest·보조 파일 읽기 상한이다.
  max_file_bytes: number;
  // preset이 고른 정확한 skill 이름이다. null은 아직 고정이 아니고
  // 빈 목록은 0개다.
  selection: readonly string[] | null;
};

// 발견은 run 경계에서만 한다. 자리→등록 root 순서→개인→동봉 순서로 폴더 자신과
// 바로 아래 skill 꾸러미만 본다. 같은 이름은 먼저 발견한 것을 남기고,
// selection은 정확한 이름 목록의 교집합이다.
export async function discoverSkills(
  input: SkillDiscoveryInput,
): Promise<Result<SkillDiscovery>> {
  const selectionCheck = checkSelectionInput(input.selection);
  if (!selectionCheck.ok) return selectionCheck;
  const candidates: Candidate[] = [];
  const skipped: SkillSkipped[] = [];
  const listed: string[] = [];
  if (input.place_store !== undefined && input.place_store !== null) {
    await scanFoldersOnly(
      input,
      candidates,
      skipped,
      listed,
      input.place_store,
      "place",
      null,
    );
  }
  for (const [order, root] of input.registered_roots.entries()) {
    await scanRoot(
      input,
      candidates,
      skipped,
      listed,
      root,
      "registered",
      order,
    );
  }
  if (input.personal_store !== null) {
    await scanFoldersOnly(
      input,
      candidates,
      skipped,
      listed,
      input.personal_store,
      "personal",
      null,
    );
  }
  if (input.bundled_root !== null) {
    await scanFoldersOnly(
      input,
      candidates,
      skipped,
      listed,
      input.bundled_root,
      "bundled",
      null,
    );
  }
  const entries: SkillEntry[] = [];
  const shadowing: SkillShadowing[] = [];
  const seen = new Map<string, SkillEntry>();
  for (const candidate of candidates) {
    const kept = seen.get(candidate.name);
    if (kept !== undefined) {
      shadowing.push({
        name: candidate.name,
        kept_bundle: kept.bundle_path,
        dropped_bundle: candidate.bundle_path,
      });
      continue;
    }
    const entry: SkillEntry = {
      name: candidate.name,
      description: candidate.description,
      content_hash: candidate.hash,
      source_kind: candidate.scope,
      folder_order: candidate.folder_order,
      bundle_path: candidate.bundle_path,
      supplemental: candidate.supplemental,
      selected: false,
      discovered_at: input.clock.now(),
    };
    seen.set(candidate.name, entry);
    entries.push(entry);
  }
  const missing: string[] = [];
  if (input.selection !== null) {
    for (const name of input.selection) {
      if (!seen.has(name)) missing.push(name);
    }
    for (const entry of entries) {
      entry.selected = input.selection.includes(entry.name);
    }
  }
  return ok({ entries, skipped, shadowing, missing });
}

// 선택 목록 자체의 거절이다. 정확한 이름 형식만 받고 중복과 전체 선택
// 표식은 거절이다. 발견 밖 이름은 거절이 아니라 누락 알림이다.
function checkSelectionInput(
  selection: readonly string[] | null,
): Result<void> {
  if (selection === null) return ok(undefined);
  const seen = new Set<string>();
  for (const name of selection) {
    const reason = skillNameReason(name);
    if (reason !== null) {
      return err({ code: "invalid_input", message: reason });
    }
    if (seen.has(name)) {
      return err({
        code: "invalid_input",
        message: "skill selection has a duplicate name",
      });
    }
    seen.add(name);
  }
  return ok(undefined);
}

// preset 저장 검사다. 정확한 이름만 받는다: 형식이 맞지 않는 이름·중복·
// 전체 선택 표식은 거절이고 발견 목록에 없는 이름도 거절이다(사람이 로컬
// 꾸러미를 준비해 등록한 뒤에만 목록에 온다).
export function validateSkillSelection(
  discovered: readonly { readonly name: string }[],
  selection: readonly string[],
): Result<void> {
  const checked = checkSelectionInput(selection);
  if (!checked.ok) return checked;
  const names = new Set(discovered.map((entry) => entry.name));
  for (const name of selection) {
    if (!names.has(name)) {
      return err({
        code: "invalid_input",
        message: "skill selection has a name that is not discovered",
      });
    }
  }
  return ok(undefined);
}

// prompt에 나가는 skill 절이다. 이름과 설명만 이름 사전순이다. 본문·보조
// 자료·bundle 경로·설치 명령·로컬 주소는 나가지 않는다.
export function skillPromptSection(
  entries: readonly SkillEntry[],
): readonly { name: string; description: string }[] {
  return entries
    .filter((entry) => entry.selected)
    .map((entry) => ({ name: entry.name, description: entry.description }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// 폴더 경로를 붙인다. Windows drive root는 `\`를 쓴다(epresentation만, 읽기는
// port가 한다).
export function joinPath(dir: string, name: string): string {
  if (dir.endsWith("/") || dir.endsWith("\\")) return `${dir}${name}`;
  const separator = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return `${dir}${separator}${name}`;
}

async function scanRoot(
  input: SkillDiscoveryInput,
  candidates: Candidate[],
  skipped: SkillSkipped[],
  listed: string[],
  root: string,
  scope: SkillScope,
  order: number,
): Promise<void> {
  // root 자신이 skill 꾸러미일 수 있다(폴더 자체).
  await addBundle(input, candidates, skipped, root, scope, order);
  await scanFoldersOnly(input, candidates, skipped, listed, root, scope, order);
}

// root의 바로 아래 skill 꾸러미를 사전순으로 본다. 폴더 이름은 그
// 범위 안의 순서 key다.
async function scanFoldersOnly(
  input: SkillDiscoveryInput,
  candidates: Candidate[],
  skipped: SkillSkipped[],
  listed: string[],
  container: string,
  scope: SkillScope,
  order: number | null,
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
  if (contents.value !== null) listed.push(container);
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
    await addBundle(input, candidates, skipped, bundle, scope, order);
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

// 한 skill 꾸러미를 읽는다. manifest가 없거나 잘못된 형식은 이유와
// 함께 제외하고 고치지 않는다.
async function addBundle(
  input: SkillDiscoveryInput,
  candidates: Candidate[],
  skipped: SkillSkipped[],
  bundle: string,
  scope: SkillScope,
  order: number | null,
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
  candidates.push({
    name: parsed.value.name,
    description: parsed.value.description,
    hash: await sha256Hex(file.text),
    scope,
    folder_order: order,
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
