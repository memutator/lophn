import {
  BUILTIN_SKILLS,
  type SkillCheckIssue,
  type SkillCheckResult,
  type SkillSource,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  joinPath,
  parseSkillFrontmatter,
  SKILL_BODY_MAX_BYTES,
  SKILL_MANIFEST,
  type SkillFiles,
} from "./skills.ts";

// `lophn skill check`의 결정적 정적 검사기다. frontmatter 파서·크기 상한·내장 목록은 런타임 발견기(skills.ts,
// BUILTIN_SKILLS)의 것을 그대로 써서 검사 통과인데 런타임에서 빠지는 불일치를 막는다.

export type SkillCheckFiles = SkillFiles & {
  // lstat 기준 파일 크기(byte). 없거나 열지 못하면 null이다.
  size(path: string): number | null;
};

export type SkillCheckExisting = {
  name: string;
  source: SkillSource;
  bundle_path: string;
};

const DESCRIPTION_WARN_MAX = 120;
const BODY_WARN_MAX_LINES = 300;
const AUXILIARY_NAMES = new Set([
  "readme.md",
  "changelog.md",
  "install.md",
  "license",
  "license.md",
]);

function trimTrailingSlash(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed === "" ? path : trimmed;
}

function baseNameOf(path: string): string {
  const clean = trimTrailingSlash(path);
  const slash = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  return slash === -1 ? clean : clean.slice(slash + 1);
}

function normalizePath(path: string): string {
  return trimTrailingSlash(path).replaceAll("\\", "/");
}

function isAuxiliaryFile(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    AUXILIARY_NAMES.has(lower) || lower === ".env" || lower.startsWith(".env.")
  );
}

function isNonDisableableBuiltin(name: string): boolean {
  return BUILTIN_SKILLS.some(
    (builtin) => builtin.name === name && !builtin.can_disable,
  );
}

type SkillReadRef = {
  name: string | null;
  path: string;
};

type MarkdownScan = {
  unclosedFence: boolean;
  hasTodoOutsideFence: boolean;
  skillReadRefs: SkillReadRef[];
};

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const UNFINISHED_TODO = /\[TODO:/i;
const SKILL_READ_CALL = /skill\.read\s*\(\s*\{([^}]*)\}\s*\)/g;
const PATH_ARG = /\bpath\s*:\s*(["'])([^"']+)\1/;
const NAME_ARG = /\bname\s*:\s*(["'])([^"']+)\1/;

// 코드 펜스 안팎을 한 번에 훑는다: 닫히지 않은 펜스, 펜스 밖 미완성 placeholder, skill.read path 참조를 모은다.
function scanMarkdown(text: string): MarkdownScan {
  let open: { char: "`" | "~"; length: number } | null = null;
  let hasTodoOutsideFence = false;
  const skillReadRefs: SkillReadRef[] = [];

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const fence = FENCE_LINE.exec(line);
    if (fence !== null) {
      const marker = fence[1]!;
      const rest = fence[2]!;
      const char = marker[0] as "`" | "~";
      if (open === null) {
        // CommonMark: backtick 펜스의 info string 안에는 backtick이 올 수 없다(한 줄 인라인 코드 제외).
        if (!(char === "`" && rest.includes("`"))) {
          open = { char, length: marker.length };
          continue;
        }
      } else if (
        open.char === char &&
        marker.length >= open.length &&
        rest.trim() === ""
      ) {
        open = null;
        continue;
      }
    }
    if (open !== null) continue;
    if (UNFINISHED_TODO.test(line)) hasTodoOutsideFence = true;
    for (const match of line.matchAll(SKILL_READ_CALL)) {
      const args = match[1] ?? "";
      const pathMatch = PATH_ARG.exec(args);
      if (pathMatch === null) continue;
      const nameMatch = NAME_ARG.exec(args);
      skillReadRefs.push({
        name: nameMatch === null ? null : nameMatch[2]!,
        path: pathMatch[2]!,
      });
    }
  }

  return {
    unclosedFence: open !== null,
    hasTodoOutsideFence,
    skillReadRefs,
  };
}

export function checkSkill(
  dirPath: string,
  files: SkillCheckFiles,
  options: { existing?: readonly SkillCheckExisting[] } = {},
): SkillCheckResult {
  const dir = trimTrailingSlash(dirPath);
  const errors: SkillCheckIssue[] = [];
  const warnings: SkillCheckIssue[] = [];
  const companions: Record<string, number> = {};

  const folderKind = files.kind(dir);
  if (folderKind === "symlink") {
    errors.push({
      code: "symlink_forbidden",
      file: ".",
      message: "skill folder is a symbolic link",
    });
    return {
      ok: false,
      name: null,
      bytes: { manifest: 0, companions },
      errors,
      warnings,
    };
  }
  if (folderKind === null) {
    errors.push({
      code: "missing_manifest",
      file: SKILL_MANIFEST,
      message: "skill folder does not exist",
    });
    return {
      ok: false,
      name: null,
      bytes: { manifest: 0, companions },
      errors,
      warnings,
    };
  }
  if (folderKind !== "dir") {
    errors.push({
      code: "missing_manifest",
      file: SKILL_MANIFEST,
      message: "skill path is not a directory",
    });
    return {
      ok: false,
      name: null,
      bytes: { manifest: 0, companions },
      errors,
      warnings,
    };
  }

  const manifestPath = joinPath(dir, SKILL_MANIFEST);
  const manifestKind = files.kind(manifestPath);
  const manifestSize = files.size(manifestPath) ?? 0;
  let manifestText: string | null = null;

  if (manifestKind === "symlink") {
    errors.push({
      code: "symlink_forbidden",
      file: SKILL_MANIFEST,
      message: "SKILL.md is a symbolic link",
    });
  } else if (manifestKind !== "file") {
    errors.push({
      code: "missing_manifest",
      file: SKILL_MANIFEST,
      message: "SKILL.md is missing or not a regular file",
    });
  } else {
    const oversized = manifestSize > SKILL_BODY_MAX_BYTES;
    if (oversized) {
      errors.push({
        code: "size_exceeded",
        file: SKILL_MANIFEST,
        message: `SKILL.md is ${manifestSize} bytes, over the ${SKILL_BODY_MAX_BYTES} byte (24 KiB) limit`,
      });
    } else {
      const read = files.read(manifestPath, SKILL_BODY_MAX_BYTES);
      if (read === null) {
        errors.push({
          code: "missing_manifest",
          file: SKILL_MANIFEST,
          message: "SKILL.md could not be read",
        });
      } else if (!read.complete) {
        errors.push({
          code: "size_exceeded",
          file: SKILL_MANIFEST,
          message: `SKILL.md is over the ${SKILL_BODY_MAX_BYTES} byte (24 KiB) limit`,
        });
      } else {
        manifestText = read.text;
      }
    }
  }

  const validCompanions = new Set<string>();
  const companionTexts = new Map<string, string>();
  const entries = [...(files.list(dir) ?? [])].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  for (const entry of entries) {
    if (entry === SKILL_MANIFEST) continue;
    const entryPath = joinPath(dir, entry);
    const kind = files.kind(entryPath);
    const auxiliary = isAuxiliaryFile(entry);
    if (entry.startsWith(".") && !auxiliary) continue;

    if (kind === "symlink") {
      errors.push({
        code: "symlink_forbidden",
        file: entry,
        message: `"${entry}" is a symbolic link`,
      });
      continue;
    }
    if (auxiliary) {
      warnings.push({
        code: "auxiliary_file",
        file: entry,
        message: `unnecessary auxiliary file "${entry}" should not live inside a skill folder`,
      });
      if (entry.startsWith(".") || kind !== "file" || !entry.endsWith(".md")) {
        continue;
      }
    }
    if (kind === "dir") {
      warnings.push({
        code: "nested_subdirs_ignored",
        file: entry,
        message: `subdirectory "${entry}/" is ignored by skill.read; place companion docs as flat .md files next to SKILL.md`,
      });
      continue;
    }
    if (kind !== "file") continue;
    if (!entry.endsWith(".md")) {
      warnings.push({
        code: "non_md_companion",
        file: entry,
        message: `"${entry}" is not a .md file and will not be read by skill.read`,
      });
      continue;
    }

    const size = files.size(entryPath) ?? 0;
    companions[entry] = size;
    validCompanions.add(entry);
    if (size > SKILL_BODY_MAX_BYTES) {
      errors.push({
        code: "size_exceeded",
        file: entry,
        message: `"${entry}" is ${size} bytes, over the ${SKILL_BODY_MAX_BYTES} byte (24 KiB) limit`,
      });
      continue;
    }
    const read = files.read(entryPath, SKILL_BODY_MAX_BYTES);
    if (read !== null && !read.complete) {
      errors.push({
        code: "size_exceeded",
        file: entry,
        message: `"${entry}" is over the ${SKILL_BODY_MAX_BYTES} byte (24 KiB) limit`,
      });
    } else if (read !== null) {
      companionTexts.set(entry, read.text);
    }
  }

  let skillName: string | null = null;
  if (manifestText !== null) {
    const parsed = parseSkillFrontmatter(manifestText);
    if (!parsed.ok) {
      errors.push({
        code: "invalid_frontmatter",
        file: SKILL_MANIFEST,
        message: parsed.error,
      });
    } else {
      const { name, description, body } = parsed.value;
      skillName = name;

      const dirName = baseNameOf(dir);
      if (dirName !== name) {
        errors.push({
          code: "name_dir_mismatch",
          file: SKILL_MANIFEST,
          message: `frontmatter name "${name}" does not match folder name "${dirName}"`,
        });
      }
      if (isNonDisableableBuiltin(name)) {
        errors.push({
          code: "builtin_name_collision",
          file: SKILL_MANIFEST,
          message: `name "${name}" collides with a built-in skill that cannot be overridden`,
        });
      }
      if (body.trim().length === 0) {
        errors.push({
          code: "empty_body",
          file: SKILL_MANIFEST,
          message: "skill body after frontmatter is empty",
        });
      }
      if (/[<>]/.test(description)) {
        errors.push({
          code: "angle_brackets_in_description",
          file: SKILL_MANIFEST,
          message: 'description must not contain "<" or ">"',
        });
      }
      if (UNFINISHED_TODO.test(description)) {
        errors.push({
          code: "unfinished_todo",
          file: SKILL_MANIFEST,
          message: "description contains an unfinished placeholder",
        });
      }

      const bodyScan = scanMarkdown(body);
      if (bodyScan.unclosedFence) {
        errors.push({
          code: "unclosed_code_fence",
          file: SKILL_MANIFEST,
          message: "unclosed code fence in SKILL.md",
        });
      }
      if (bodyScan.hasTodoOutsideFence) {
        errors.push({
          code: "unfinished_todo",
          file: SKILL_MANIFEST,
          message:
            "SKILL.md contains an unfinished placeholder outside code fences",
        });
      }
      for (const ref of bodyScan.skillReadRefs) {
        if (ref.path.includes("<") || ref.path.includes(">")) continue;
        if (
          ref.name !== null &&
          ref.name !== name &&
          !ref.name.includes("<") &&
          !ref.name.includes(">")
        ) {
          continue;
        }
        const cleaned = ref.path.replace(/^(?:\.\/)+/, "");
        if (cleaned === "" || cleaned === "." || cleaned === SKILL_MANIFEST) {
          continue;
        }
        if (ref.path.includes("/") || ref.path.includes("\\")) {
          errors.push({
            code: "missing_companion",
            file: SKILL_MANIFEST,
            message: `skill.read path "${ref.path}" points into a subdirectory; lophn only reads flat .md files next to SKILL.md`,
          });
        } else if (!validCompanions.has(ref.path)) {
          errors.push({
            code: "missing_companion",
            file: SKILL_MANIFEST,
            message: `skill.read path "${ref.path}" does not exist as a flat .md companion file`,
          });
        }
      }

      if (description.length > DESCRIPTION_WARN_MAX) {
        warnings.push({
          code: "description_long",
          file: SKILL_MANIFEST,
          message: `description is ${description.length} characters (recommended <= ${DESCRIPTION_WARN_MAX})`,
        });
      }
      const lineCount = manifestText.split("\n").length;
      if (lineCount > BODY_WARN_MAX_LINES) {
        warnings.push({
          code: "body_long",
          file: SKILL_MANIFEST,
          message: `SKILL.md is ${lineCount} lines (recommended <= ${BODY_WARN_MAX_LINES}; split conditional details into flat .md files)`,
        });
      }
      const normalizedDir = normalizePath(dir);
      const shadowed = (options.existing ?? []).find(
        (entry) =>
          entry.name === name &&
          entry.source !== "builtin" &&
          normalizePath(entry.bundle_path) !== normalizedDir,
      );
      if (shadowed !== undefined) {
        warnings.push({
          code: "shadows_existing",
          file: SKILL_MANIFEST,
          message: `shadows existing ${shadowed.source} skill "${name}" (${shadowed.bundle_path})`,
        });
      }
    }
  }

  for (const [file, text] of companionTexts) {
    const scan = scanMarkdown(text);
    if (scan.unclosedFence) {
      errors.push({
        code: "unclosed_code_fence",
        file,
        message: `unclosed code fence in ${file}`,
      });
    }
    if (scan.hasTodoOutsideFence) {
      errors.push({
        code: "unfinished_todo",
        file,
        message: `${file} contains an unfinished placeholder outside code fences`,
      });
    }
  }

  return {
    ok: errors.length === 0,
    name: skillName,
    bytes: { manifest: manifestSize, companions },
    errors,
    warnings,
  };
}
