import { err, ok, type Result } from "../../../base/mod.ts";
import { sha256Hex } from "../../../base/mod.ts";
import type { SkillEntry } from "./skills.ts";
import { SKILL_MANIFEST, type SkillFilesPort } from "./skills.ts";

// 선택한 skill 읽기(concern lophn-agent/extensions). `skill.read`는 이름으로만
// 부르고 경로 입력은 없다(architecture §5.3 선택 skill). 읽기 앞에 RunBasis에
// 고정한 hash와 현재 파일을 비교한다(architecture §5.5): 다르거나 없으면
// 실패다. 본문은 전체이거나 실패이고 부분 성공은 없다. 보조 자료는
// 제목 목록만 돌려주고 자동으로 본문을 읽지 않는다.

export type SkillReadErrorCode =
  | "not_selected"
  | "missing"
  | "changed"
  | "invalid_path"
  | "invalid_format";

export type SkillReadFailure = {
  code: SkillReadErrorCode;
  // 사람용 이유다. 절대 경로가 나가지 않도록 만들어 쓴다.
  message: string;
};

export type SkillReadResult = {
  name: string;
  // 성공이면 SKILL.md의 frontmatter를 뺀 전체 본문이다. 실패면 null이다.
  body: string | null;
  // 보조 자료 제목 목록이다. 자동 본문 읽기는 없다.
  supplemental_titles: readonly string[];
  // 실패 이유다. 성공이면 null이다.
  error: SkillReadFailure | null;
};

export type SkillReadInput = {
  port: SkillFilesPort;
  entries: readonly SkillEntry[];
  // 이번 run에 제공한 skill 이름이다.
  name: string;
  // RunBasis에 고정한 content hash다. 없으면 이번 run에 고정하지 않은
  // 이름이다.
  pinned_hash: string | null;
  max_file_bytes: number;
};

// 목록의 entry로 읽는다. 이름은 정확히 하나만 받는다: 대상 찾기는
// 등록에 고정한 발견 목록에서만 하고 이 경로에서 새로 찾지 않는다.
export async function readSkill(
  input: SkillReadInput,
): Promise<Result<SkillReadResult>> {
  const entry = input.entries.find((candidate) =>
    candidate.name === input.name
  );
  if (entry === undefined) {
    return ok(failure(input.name, "missing", "skill is not in the run list"));
  }
  if (!entry.selected) {
    return ok(
      failure(
        input.name,
        "not_selected",
        "skill is discovered but not selected for this run",
      ),
    );
  }
  if (input.pinned_hash !== entry.content_hash) {
    return ok(
      failure(
        input.name,
        "changed",
        "skill changed after the run fixed its content hash",
      ),
    );
  }
  const bundleCheck = await input.port.kind(entry.bundle_path);
  if (!bundleCheck.ok) {
    return ok(failure(input.name, "missing", "skill folder is not available"));
  }
  if (bundleCheck.value === null) {
    return ok(failure(input.name, "missing", "skill folder is gone"));
  }
  if (bundleCheck.value === "symlink") {
    return ok(
      failure(
        input.name,
        "invalid_path",
        "skill folder is a symbolic link",
      ),
    );
  }
  if (bundleCheck.value !== "dir") {
    return ok(
      failure(input.name, "invalid_path", "skill folder is not a folder"),
    );
  }
  const manifest = `${
    entry.bundle_path.endsWith("/") ||
      entry.bundle_path.endsWith("\\")
      ? entry.bundle_path
      : entry.bundle_path.includes("\\") && !entry.bundle_path.includes("/")
      ? `${entry.bundle_path}\\`
      : `${entry.bundle_path}/`
  }${SKILL_MANIFEST}`;
  const manifestKind = await input.port.kind(manifest);
  if (!manifestKind.ok || manifestKind.value !== "file") {
    return ok(failure(input.name, "missing", "skill manifest is gone"));
  }
  const read = await input.port.read(manifest, input.max_file_bytes);
  if (!read.ok) {
    return ok(
      failure(input.name, "missing", "skill manifest is not available"),
    );
  }
  const file = read.value;
  if (file === null) {
    return ok(failure(input.name, "missing", "skill manifest is gone"));
  }
  if (!file.complete) {
    return ok(
      failure(
        input.name,
        "changed",
        "skill body does not fit the read limit in full",
      ),
    );
  }
  const parsed = parseFrontmatterBody(file.text);
  if (parsed === null) {
    return ok(
      failure(
        input.name,
        "invalid_format",
        "skill manifest is not valid frontmatter format",
      ),
    );
  }
  const hash = await sha256Hex(file.text);
  if (hash !== input.pinned_hash) {
    return ok(
      failure(
        input.name,
        "changed",
        "skill content changed after the run fixed its content hash",
      ),
    );
  }
  return ok({
    name: input.name,
    body: parsed,
    supplemental_titles: entry.supplemental.map((file) => file.title),
    error: null,
  });
}

export type SkillSupplementalReadInput = {
  port: SkillFilesPort;
  entry: SkillEntry;
  title: string;
  max_file_bytes: number;
};

// 보조 자료 본문이다. 제목으로만 고른 UTF-8 문서를 읽고 경로 입력은
// 없다(architecture §5.5 `skill.read_supplemental(name,title)`): 경로는
// 발견이 고정한 relative_path다. `..`·절대 경로·symlink·실행 파일은 거절이다.
// 스크립트를 실행하지 않는다: 이 경로에는 run tool이 없다.
export async function readSkillSupplemental(
  input: SkillSupplementalReadInput,
): Promise<Result<SkillReadResult>> {
  const titleCheck = checkTitle(input.title);
  if (!titleCheck) {
    return ok(
      failure(
        input.title,
        "invalid_path",
        "supplemental title is not a title from the discovery list",
      ),
    );
  }
  const supplemental = input.entry.supplemental.find((file) =>
    file.title === input.title
  );
  if (supplemental === undefined) {
    return ok(
      failure(
        input.title,
        "not_selected",
        "supplemental title is not in the discovery list",
      ),
    );
  }
  if (
    supplemental.relative_path.includes("..") ||
    supplemental.relative_path.startsWith("/") ||
    supplemental.relative_path.includes("\\")
  ) {
    return ok(
      failure(
        input.title,
        "invalid_path",
        "supplemental path leaves the skill folder",
      ),
    );
  }
  const path = `${
    input.entry.bundle_path.endsWith("/")
      ? input.entry.bundle_path
      : `${input.entry.bundle_path}/`
  }${supplemental.relative_path}`;
  const kind = await input.port.kind(path);
  if (!kind.ok) {
    return ok(
      failure(
        input.title,
        "missing",
        "supplemental document is not available",
      ),
    );
  }
  if (kind.value === null) {
    return ok(failure(input.title, "missing", "supplemental document is gone"));
  }
  if (kind.value === "symlink") {
    return ok(
      failure(
        input.title,
        "invalid_path",
        "supplemental document is a symbolic link",
      ),
    );
  }
  if (kind.value === "dir") {
    return ok(
      failure(
        input.title,
        "invalid_path",
        "supplemental path is not a document",
      ),
    );
  }
  const executable = await input.port.executable(path);
  if (executable.ok && executable.value === true) {
    return ok(
      failure(
        input.title,
        "invalid_path",
        "supplemental document is executable",
      ),
    );
  }
  const read = await input.port.read(path, input.max_file_bytes);
  if (!read.ok || read.value === null) {
    return ok(
      failure(
        input.title,
        "missing",
        "supplemental document is not available",
      ),
    );
  }
  if (!read.value.complete) {
    return ok(
      failure(
        input.title,
        "invalid_format",
        "supplemental document does not fit the read limit in full",
      ),
    );
  }
  return ok({
    name: input.title,
    body: read.value.text,
    supplemental_titles: [],
    error: null,
  });
}

// 보조 자료 제목은 발견이 만든 `{파일명에서 .md를 뺀 값}`이다. 경로로 쓰지
// 않는다: `/`·`\`·`..`·빈 값은 거절이다.
function checkTitle(title: string): boolean {
  if (title.length === 0 || title.length > 128) return false;
  if (title.includes("/") || title.includes("\\")) return false;
  if (title.includes("..")) return false;
  return true;
}

// frontmatter 다음 줄부터 본문이다. 검사는 discovery가 했다.
function parseFrontmatterBody(source: string): string | null {
  if (!source.startsWith("---")) return null;
  const lines = source.split("\n");
  if (lines[0].replace(/\r$/, "") !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].replace(/\r$/, "") === "---") {
      return lines.slice(i + 1).join("\n");
    }
  }
  return null;
}

function failure(
  name: string,
  code: SkillReadErrorCode,
  message: string,
): SkillReadResult {
  return {
    name,
    body: null,
    supplemental_titles: [],
    error: { code, message },
  };
}

// 실패는 command result의 안전한 결과로 포장하기 위한 helper다. 직접 쓰는
// Result 거절이 아니라 읽기 실패 값을 만든다(architecture §5.5).
export function skillReadToolFailure(
  result: SkillReadResult,
): string {
  return `skill\u0000${result.error?.code ?? "missing"}`;
}

export type { SkillEntry };
export { err };
