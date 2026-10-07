// 배포 skill 하나의 형식 검사다(coding-agent/guides#R2, R3, R4). 순수 값이다. Agent Skills의 공통
// 형식(YAML frontmatter + UTF-8 Markdown)만 보고 어떤 제품 전용 metadata도 읽지 않는다. 제품 loader는
// 이 검사보다 느슨해서(조사 coding-agent-skills-and-guides) 부적합 배포의 거절은 lophn이 배포 전에 한다.
// frontmatter는 lophn skill이 쓰는 부분집합(한 줄 scalar와 한 단계 string map)만 읽는다. 그 밖의 YAML은
// 해석할 수 없는 것으로 보고 거절한다. 의존성을 더하지 않는다(stack).

export const SKILL_LIMITS = {
  nameMax: 64,
  descriptionMax: 1_024,
  compatibilityMax: 500,
  // 본문은 이 줄 수 미만이어야 한다. 줄은 CRLF·CR을 LF로 바꾼 logical line이고 끝 newline은 줄을 더하지 않는다.
  bodyLinesBelow: 500,
} as const;

export const SKILL_ENTRY = "SKILL.md";

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// 배포 skill 디렉터리 안의 파일 하나다. path는 skill 디렉터리 기준 상대 경로다.
export type SkillFileInput = {
  path: string;
  content: string | Uint8Array;
};

export type SkillIssueRule =
  | "files"
  | "utf8"
  | "frontmatter"
  | "name"
  | "description"
  | "metadata"
  | "body"
  | "reference";

export type SkillIssue = {
  rule: SkillIssueRule;
  path: string;
  message: string;
};

export type CheckedSkill = {
  name: string;
  description: string;
  metadata: Readonly<Record<string, string>>;
  body: string;
  // 본문이 직접 가리키는 보조 자료의 skill 디렉터리 기준 경로다.
  references: readonly string[];
  // 검사를 통과한 모든 파일의 UTF-8 본문이다.
  files: readonly { path: string; content: string }[];
};

export type SkillCheck = {
  issues: SkillIssue[];
  // issue가 없을 때만 있다.
  skill: CheckedSkill | null;
};

type Scalar =
  | { kind: "string"; value: string }
  | { kind: "other" };

type Entry =
  | Scalar
  | { kind: "array" }
  | { kind: "nested" }
  | { kind: "map"; values: Map<string, Scalar> };

const TOP_KEYS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);

const NON_STRING_PLAIN =
  /^(?:true|false|yes|no|on|off|null|~|[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+)$/i;

function codePoints(text: string): number {
  return [...text].length;
}

function scalarOf(rest: string): Scalar | "array" | "nested" | null {
  if (rest.startsWith('"')) {
    if (rest.length < 2 || !rest.endsWith('"')) return null;
    try {
      const value = JSON.parse(rest);
      return typeof value === "string" ? { kind: "string", value } : null;
    } catch {
      return null;
    }
  }
  if (rest.startsWith("'")) {
    if (rest.length < 2 || !rest.endsWith("'")) return null;
    const inner = rest.slice(1, -1);
    if (/(^|[^'])'([^']|$)/.test(inner)) return null;
    return { kind: "string", value: inner.replaceAll("''", "'") };
  }
  if (rest.startsWith("[")) return "array";
  if (rest.startsWith("{")) return "nested";
  if (/^[|>&*!%@`]/.test(rest)) return null;
  const plain = rest.replace(/\s+#.*$/, "").trim();
  if (plain === "") return null;
  if (NON_STRING_PLAIN.test(plain)) return { kind: "other" };
  return { kind: "string", value: plain };
}

type Frontmatter =
  | { ok: true; entries: Map<string, Entry> }
  | { ok: false; message: string };

function parseFrontmatter(lines: readonly string[]): Frontmatter {
  const entries = new Map<string, Entry>();
  let index = 0;
  const skippable = (line: string) =>
    line.trim() === "" || line.trimStart().startsWith("#");
  while (index < lines.length) {
    const line = lines[index];
    if (skippable(line)) {
      index += 1;
      continue;
    }
    if (/^\s/.test(line)) {
      return { ok: false, message: `들여쓴 줄이 key 아래에 있지 않다: ${line}` };
    }
    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s+(.*)|\s*)$/);
    if (match === null) {
      return { ok: false, message: `key: value 줄이 아니다: ${line}` };
    }
    const key = match[1];
    if (entries.has(key)) {
      return { ok: false, message: `key가 겹친다: ${key}` };
    }
    const rest = (match[2] ?? "").trim();
    index += 1;
    if (rest !== "") {
      const scalar = scalarOf(rest);
      if (scalar === null) {
        return { ok: false, message: `해석할 수 없는 값이다: ${key}` };
      }
      entries.set(
        key,
        scalar === "array"
          ? { kind: "array" }
          : scalar === "nested"
          ? { kind: "nested" }
          : scalar,
      );
      continue;
    }
    // 값이 없는 key는 아래 들여쓴 줄이 값이다.
    const block: string[] = [];
    while (
      index < lines.length && (skippable(lines[index]) || /^\s/.test(lines[index]))
    ) {
      if (!skippable(lines[index])) block.push(lines[index]);
      index += 1;
    }
    if (block.length === 0) {
      return { ok: false, message: `값이 없다: ${key}` };
    }
    if (/^\s*-(\s|$)/.test(block[0])) {
      entries.set(key, { kind: "array" });
      continue;
    }
    const values = new Map<string, Scalar>();
    const indent = block[0].match(/^\s*/)?.[0].length ?? 0;
    let nested = false;
    for (const inner of block) {
      const innerIndent = inner.match(/^\s*/)?.[0].length ?? 0;
      const pair = inner.trim().match(/^([A-Za-z0-9_.-]+):(?:\s+(.*)|\s*)$/);
      if (innerIndent !== indent || pair === null) {
        nested = true;
        break;
      }
      const value = (pair[2] ?? "").trim();
      const scalar = value === "" ? null : scalarOf(value);
      if (scalar === null || scalar === "array" || scalar === "nested") {
        nested = true;
        break;
      }
      if (values.has(pair[1])) {
        return { ok: false, message: `${key}의 key가 겹친다: ${pair[1]}` };
      }
      values.set(pair[1], scalar);
    }
    entries.set(key, nested ? { kind: "nested" } : { kind: "map", values });
  }
  return { ok: true, entries };
}

function logicalLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (normalized === "") return [];
  return (normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized)
    .split("\n");
}

// 코드 span과 fenced block은 링크로 읽지 않는다.
function withoutCode(text: string): string {
  return text
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "")
    .replace(/`[^`\n]*`/g, "");
}

// 본문의 markdown 링크·이미지 중 파일을 가리키는 상대 경로다. URL과 같은 문서 안 anchor는 보조 자료
// 참조가 아니다.
export function relativeLinksOf(text: string): string[] {
  const found: string[] = [];
  for (
    const match of withoutCode(text).matchAll(
      /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g,
    )
  ) {
    const target = match[1];
    if (target.startsWith("#")) continue;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) continue;
    found.push(target);
  }
  return found;
}

function referencePath(target: string): string | null {
  const path = target.replace(/[#?].*$/, "");
  if (path === "" || path.startsWith("/") || path.includes("\\")) return null;
  const segments = path.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  return segments.join("/");
}

function safeFilePath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\")) return false;
  return path.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

const decoder = new TextDecoder("utf-8", { fatal: true });

// skill 디렉터리 `directory`의 파일 묶음을 검사한다. 실패는 issue 목록이고 첫 issue에서 멈추지 않는다.
export function checkSkill(
  directory: string,
  files: readonly SkillFileInput[],
): SkillCheck {
  const issues: SkillIssue[] = [];
  const issue = (rule: SkillIssueRule, path: string, message: string) =>
    issues.push({ rule, path, message });
  const texts = new Map<string, string>();
  for (const file of files) {
    if (!safeFilePath(file.path)) {
      issue("files", file.path, "skill 디렉터리 밖을 가리키는 경로다");
      continue;
    }
    if (texts.has(file.path)) {
      issue("files", file.path, "같은 경로가 겹친다");
      continue;
    }
    if (typeof file.content === "string") {
      texts.set(file.path, file.content);
      continue;
    }
    try {
      texts.set(file.path, decoder.decode(file.content));
    } catch {
      issue("utf8", file.path, "UTF-8이 아니다");
    }
  }
  const entry = texts.get(SKILL_ENTRY);
  if (entry === undefined) {
    if (!issues.some((item) => item.path === SKILL_ENTRY)) {
      issue("files", SKILL_ENTRY, "SKILL.md가 없다");
    }
    return { issues, skill: null };
  }
  if (entry.charCodeAt(0) === 0xfeff) {
    issue("frontmatter", SKILL_ENTRY, "BOM이 있다");
  }
  const all = entry.replace(/\r\n?/g, "\n").split("\n");
  if (all[0] !== "---") {
    issue("frontmatter", SKILL_ENTRY, "첫 줄이 `---`가 아니다");
    return { issues, skill: null };
  }
  const close = all.indexOf("---", 1);
  if (close < 0) {
    issue("frontmatter", SKILL_ENTRY, "frontmatter를 닫는 `---`가 없다");
    return { issues, skill: null };
  }
  const front = parseFrontmatter(all.slice(1, close));
  if (!front.ok) {
    issue("frontmatter", SKILL_ENTRY, front.message);
    return { issues, skill: null };
  }
  const body = all.slice(close + 1).join("\n");
  const { entries } = front;

  for (const key of entries.keys()) {
    if (!TOP_KEYS.has(key)) {
      issue("frontmatter", SKILL_ENTRY, `허용하지 않는 key다: ${key}`);
    }
  }

  const name = entries.get("name");
  let nameValue = "";
  if (name?.kind !== "string") {
    issue("name", SKILL_ENTRY, "name은 문자열이어야 한다");
  } else {
    nameValue = name.value;
    const length = codePoints(nameValue);
    if (length < 1 || length > SKILL_LIMITS.nameMax) {
      issue("name", SKILL_ENTRY, `name은 1~${SKILL_LIMITS.nameMax}자다`);
    }
    if (!SKILL_NAME_PATTERN.test(nameValue)) {
      issue(
        "name",
        SKILL_ENTRY,
        "name은 소문자 영문·숫자와 단일 하이픈만 쓰고 앞뒤·연속 하이픈이 없어야 한다",
      );
    }
    if (nameValue !== directory) {
      issue("name", SKILL_ENTRY, "name이 디렉터리 이름과 다르다");
    }
  }

  const description = entries.get("description");
  let descriptionValue = "";
  if (description?.kind !== "string") {
    issue("description", SKILL_ENTRY, "description은 문자열이어야 한다");
  } else {
    descriptionValue = description.value;
    const length = codePoints(descriptionValue);
    if (descriptionValue.trim() === "") {
      issue("description", SKILL_ENTRY, "description이 비어 있다");
    } else if (length > SKILL_LIMITS.descriptionMax) {
      issue(
        "description",
        SKILL_ENTRY,
        `description은 ${SKILL_LIMITS.descriptionMax}자 이하다`,
      );
    }
  }

  for (const key of ["license", "allowed-tools"]) {
    const value = entries.get(key);
    if (value !== undefined && value.kind !== "string") {
      issue("frontmatter", SKILL_ENTRY, `${key}는 문자열이어야 한다`);
    }
  }
  const compatibility = entries.get("compatibility");
  if (compatibility !== undefined) {
    if (compatibility.kind !== "string") {
      issue("frontmatter", SKILL_ENTRY, "compatibility는 문자열이어야 한다");
    } else if (
      codePoints(compatibility.value) < 1 ||
      codePoints(compatibility.value) > SKILL_LIMITS.compatibilityMax
    ) {
      issue(
        "frontmatter",
        SKILL_ENTRY,
        `compatibility는 1~${SKILL_LIMITS.compatibilityMax}자다`,
      );
    }
  }

  const metadata: Record<string, string> = {};
  const rawMetadata = entries.get("metadata");
  if (rawMetadata !== undefined) {
    if (rawMetadata.kind !== "map") {
      issue(
        "metadata",
        SKILL_ENTRY,
        "metadata는 문자열에서 문자열로의 map이어야 한다(배열·중첩 map·빈 값 불가)",
      );
    } else {
      for (const [key, value] of rawMetadata.values) {
        if (value.kind !== "string") {
          issue("metadata", SKILL_ENTRY, `metadata 값이 문자열이 아니다: ${key}`);
        } else metadata[key] = value.value;
      }
    }
  }

  if (logicalLines(body).length >= SKILL_LIMITS.bodyLinesBelow) {
    issue(
      "body",
      SKILL_ENTRY,
      `본문은 ${SKILL_LIMITS.bodyLinesBelow}줄 미만이어야 한다`,
    );
  }

  // 보조 자료는 본문이 직접 가리키는 한 단계 상대 경로뿐이고 보조 자료는 다시 다른 자료를 가리키지 않는다.
  const references: string[] = [];
  for (const target of relativeLinksOf(body)) {
    const path = referencePath(target);
    if (path === null) {
      issue("reference", SKILL_ENTRY, `skill 디렉터리 밖 참조다: ${target}`);
    } else if (path === SKILL_ENTRY) {
      issue("reference", SKILL_ENTRY, "자기 자신을 참조한다");
    } else if (!texts.has(path)) {
      issue("reference", SKILL_ENTRY, `없는 파일을 참조한다: ${path}`);
    } else if (!references.includes(path)) references.push(path);
  }
  for (const path of texts.keys()) {
    if (path === SKILL_ENTRY) continue;
    if (!references.includes(path)) {
      issue("reference", path, "본문이 직접 가리키지 않는 파일이다");
      continue;
    }
    const inner = relativeLinksOf(texts.get(path) ?? "");
    if (inner.length > 0) {
      issue("reference", path, "보조 자료가 다른 파일을 다시 참조한다");
    }
  }

  if (issues.length > 0) return { issues, skill: null };
  return {
    issues,
    skill: {
      name: nameValue,
      description: descriptionValue,
      metadata,
      body,
      references,
      files: [...texts].map(([path, content]) => ({ path, content })),
    },
  };
}
