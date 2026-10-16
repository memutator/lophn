import type {
  Role,
  SkillEntry as SkillRow,
} from "../../../protocol/lophn-agent/mod.ts";
import type { SkillSource } from "../../../protocol/lophn-agent/mod.ts";
import {
  builtinForRole,
  folderSkipReason,
  joinPath,
  mergeSkillLayers,
  parseSkillFrontmatter,
  SKILL_BODY_MAX_BYTES,
  SKILL_MANIFEST,
  type SkillCandidate,
  type SkillSkipped,
  undeclaredBuiltinReason,
} from "./skills.ts";

// 동기 skill 목록. `ReadSkills`와 `/` 메뉴는 동기 handler라 비동기 발견
// (`discoverSkills`, turn 시작이 쓴다)을 기다릴 수 없다. 같은 층 규칙(`mergeSkillLayers`)을 동기 port 위에서 한 번
// 더 읽는다. 본문 hash와 딸린 파일은 만들지 않는다. 이 목록은 이름, 설명, 출처, 켜짐만 보인다.

// 폴더·파일을 동기로 보는 눈이다. 없으면 null이고 그 밖의 실패는 던진다. symlink는 따라가지 않는다.
export type SyncSkillFiles = {
  list(dir: string): readonly string[] | null;
  kind(path: string): "file" | "dir" | "symlink" | null;
  read(
    path: string,
    maxBytes: number,
  ): { text: string; complete: boolean } | null;
};

// 발견 출처다. 내장, 전역(등록 폴더는 등록 순서 그대로, 개인 보관소), project 폴더다. null은 그 출처가 없는 것이다.
export type SkillSources = {
  bundled: string | null;
  registered: readonly string[];
  personal: string | null;
  project: string | null;
};

export type SkillListing = {
  entries: readonly SkillRow[];
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

// role이 null이면 내장 skill을 모두 낸다. off는 끈 이름의 합이다.
export function listSkillsSync(
  files: SyncSkillFiles,
  sources: SkillSources,
  options: { role: Role | null; off: readonly string[] },
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
        reason: read.value === null
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
      bundle_path: bundle,
    });
  };

  // container 바로 아래 꾸러미를 폴더 이름의 영문 사전순으로 본다.
  // 개인·내장·project 폴더가 아직 없는 것은 그 출처가 비어 있을 뿐이고, 사람이 등록한 폴더가 없는 것은 알린다.
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
        reason: folder.ok && folder.value === "symlink"
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
    const names = (listed.value ?? []).filter((name) => !name.startsWith("."))
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
  for (const root of sources.registered) {
    // 등록 폴더 자신이 꾸러미일 수 있다.
    addBundle(root, "global");
    scanFolder(root, "global", true);
  }
  if (sources.personal !== null) scanFolder(sources.personal, "global", false);
  if (sources.project !== null) scanFolder(sources.project, "project", false);

  const visible = candidates.filter((candidate) =>
    candidate.source !== "builtin" ||
    builtinForRole(candidate.name, options.role)
  );
  const entries = mergeSkillLayers(visible, options.off, skipped).map((
    entry,
  ) => ({
    name: entry.name,
    description: entry.description,
    source: entry.source,
    enabled: entry.enabled,
    can_disable: entry.can_disable,
  }));
  return { entries, skipped };
}
