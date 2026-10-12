import type {
  SkillShadow,
  SkillSkipped,
  SkillSummary,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  folderSkipReason,
  joinPath,
  parseSkillFrontmatter,
  SKILL_BODY_MAX_BYTES,
  SKILL_MANIFEST,
  type SkillScope,
} from "./skills.ts";

// 동기 skill 목록(concern lophn-agent/extensions). agents read와 `/` 메뉴는 동기 handler라 비동기 발견
// (`discoverSkills`, run 준비가 쓴다)을 기다릴 수 없다. 같은 규칙을 동기 port 위에서 한 번 더 구현하고
// 두 구현이 같은 목록을 내는지는 시험이 지킨다. 본문 hash·보조 자료는 만들지 않는다: 이 목록은 이름과 설명,
// 출처만 보이고 run은 시작할 때 비동기 발견으로 다시 고정한다.

// 폴더·파일을 동기로 보는 눈이다. 없으면 null이고 그 밖의 실패는 던진다. symlink는 따라가지 않는다.
export type SyncSkillFiles = {
  list(dir: string): readonly string[] | null;
  kind(path: string): "file" | "dir" | "symlink" | null;
  read(
    path: string,
    maxBytes: number,
  ): { text: string; complete: boolean } | null;
};

// 발견 출처다. 자리 층(place)이 먼저고 등록 폴더는 등록 순서 그대로다. null은 그 출처가 없는 것이다.
export type SkillSources = {
  place: string | null;
  registered: readonly string[];
  personal: string | null;
  bundled: string | null;
};

export type SkillListing = {
  entries: readonly SkillSummary[];
  shadowed: readonly SkillShadow[];
  skipped: readonly SkillSkipped[];
};

type Candidate = { name: string; description: string; scope: SkillScope };

function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function attempt<T>(read: () => T): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: read() };
  } catch {
    return { ok: false };
  }
}

export function listSkillsSync(
  files: SyncSkillFiles,
  sources: SkillSources,
): SkillListing {
  const candidates: Candidate[] = [];
  const skipped: SkillSkipped[] = [];

  const addBundle = (bundle: string, scope: SkillScope): void => {
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
    candidates.push({
      name: parsed.value.name,
      description: parsed.value.description,
      scope,
    });
  };

  // container 바로 아래 꾸러미를 폴더 이름의 영문 사전순으로 본다.
  // 자리·개인·동봉 폴더가 아직 없는 것은 그 출처가 비어 있을 뿐이고, 사람이 등록한 폴더가 없는 것은 알린다.
  const scanFolder = (
    container: string,
    scope: SkillScope,
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
      .sort(byName);
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
      addBundle(bundle, scope);
    }
  };

  if (sources.place !== null) scanFolder(sources.place, "place", false);
  for (const root of sources.registered) {
    // 등록 폴더 자신이 꾸러미일 수 있다.
    addBundle(root, "registered");
    scanFolder(root, "registered", true);
  }
  if (sources.personal !== null) {
    scanFolder(sources.personal, "personal", false);
  }
  if (sources.bundled !== null) scanFolder(sources.bundled, "bundled", false);

  const entries: SkillSummary[] = [];
  const shadowed: SkillShadow[] = [];
  const kept = new Map<string, SkillScope>();
  for (const candidate of candidates) {
    const winner = kept.get(candidate.name);
    if (winner !== undefined) {
      shadowed.push({
        name: candidate.name,
        kept: winner,
        hidden: candidate.scope,
      });
      continue;
    }
    kept.set(candidate.name, candidate.scope);
    entries.push({
      name: candidate.name,
      description: candidate.description,
      source_kind: candidate.scope,
    });
  }
  return { entries, shadowed, skipped };
}
