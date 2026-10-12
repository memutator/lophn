// TrackingSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route output
// schema로 이미 검사했다. 아래 응답 모양은 projects.get·list, preview_tracking·set_tracking
// schema에서 이 화면이 읽는 field만 옮긴 것이다.
import type { CoreSource } from "../../desktop/connection/connection.ts";
import type {
  Preview,
  PreviewEntry,
  RuleSet,
  TrackedRoot,
  TrackingProject,
  TrackingResult,
  TrackingRule,
  TrackingSource,
} from "./source.ts";

interface RuleSetValue {
  enabled: boolean;
  patterns: TrackingRule[];
  use_gitignore: boolean;
}

interface ProjectValue {
  id: string;
  title: string;
  revision: string;
  status?: string;
  folders: { path: string; description: string }[];
  tracking: RuleSetValue;
  initial_tracking_proposal?: RuleSetValue;
}

interface PreviewValue {
  base_revision: string;
  entries: {
    folder_path: string;
    path: string;
    included: boolean;
    reason: string;
  }[];
  complete: boolean;
  next_cursor: string | null;
}

/** 미리보기 page 상한. documents는 page마다 200개를 준다. */
const PREVIEW_PAGE_LIMIT = 100;
/** projects.list page 상한. */
const LIST_PAGE_LIMIT = 20;

function rulesOf(value: RuleSetValue): RuleSet {
  return {
    enabled: value.enabled,
    patterns: value.patterns.map((rule) => ({
      effect: rule.effect,
      glob: rule.glob,
    })),
    useGitignore: value.use_gitignore,
  };
}

function rulesValue(rules: RuleSet): RuleSetValue {
  return {
    enabled: rules.enabled,
    patterns: rules.patterns.map((rule) => ({
      effect: rule.effect,
      glob: rule.glob,
    })),
    use_gitignore: rules.useGitignore,
  };
}

function projectOf(value: ProjectValue): TrackingProject {
  const tracking = rulesOf(value.tracking);
  return {
    id: value.id,
    title: value.title,
    revision: value.revision,
    folders: value.folders.map((folder) => ({
      path: folder.path,
      description: folder.description,
    })),
    tracking,
    proposal: value.initial_tracking_proposal
      ? rulesOf(value.initial_tracking_proposal)
      : tracking,
  };
}

function folderValues(project: TrackingProject) {
  return project.folders.map((folder) => ({
    path: folder.path,
    description: folder.description,
  }));
}

function failed(
  reply: { error?: { code: string } },
): { ok: false; code: string } {
  return { ok: false, code: reply.error?.code ?? "internal" };
}

export function coreTrackingSource(core: CoreSource): TrackingSource {
  return {
    async project(id) {
      const reply = await core.call({
        kind: "read",
        resource: "projects",
        method: "get",
        body: { project: id },
      });
      if (!reply.ok) return failed(reply);
      return {
        ok: true,
        value: projectOf((reply.value as { project: ProjectValue }).project),
      };
    },

    async trackedRoots(except) {
      const roots: TrackedRoot[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < LIST_PAGE_LIMIT; page += 1) {
        const reply = await core.call({
          kind: "read",
          resource: "projects",
          method: "list",
          body: { status: "active", ...(cursor ? { cursor } : {}) },
        });
        if (!reply.ok) return failed(reply);
        const value = reply.value as {
          projects: ProjectValue[];
          next_cursor: string | null;
        };
        for (const project of value.projects) {
          if (project.id === except || !project.tracking.enabled) continue;
          for (const folder of project.folders) {
            roots.push({
              project: project.id,
              title: project.title,
              path: folder.path,
            });
          }
        }
        if (value.next_cursor === null) break;
        cursor = value.next_cursor;
      }
      return { ok: true, value: roots };
    },

    // 끝 page까지 모은다. 적용은 complete인 마지막 page를 근거로 보낸다.
    async preview(project, rules): Promise<TrackingResult<Preview>> {
      const entries: PreviewEntry[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < PREVIEW_PAGE_LIMIT; page += 1) {
        const reply = await core.call({
          kind: "worker",
          resource: "projects",
          method: "preview_tracking",
          body: {
            project: project.id,
            base_revision: project.revision,
            folders: folderValues(project),
            tracking: rulesValue(rules),
            ...(cursor ? { cursor } : {}),
          },
        });
        if (!reply.ok) return failed(reply);
        const value = reply.value as PreviewValue;
        entries.push(...value.entries.map((entry) => ({
          folder: entry.folder_path,
          path: entry.path,
          included: entry.included,
          reason: entry.reason,
        })));
        if (value.complete) {
          return {
            ok: true,
            value: {
              baseRevision: value.base_revision,
              rules,
              entries,
              basis: value,
            },
          };
        }
        if (value.next_cursor === null) break;
        cursor = value.next_cursor;
      }
      return { ok: false, code: "unavailable" };
    },

    async apply(project, preview) {
      // 성공 응답은 route output 그대로다. 추가 포장은 없다.
      const reply = await core.call({
        kind: "command",
        resource: "projects",
        method: "set_tracking",
        body: {
          input: {
            project: project.id,
            folders: folderValues(project),
            tracking: rulesValue(preview.rules),
            preview: preview.basis,
          },
          idempotency_key: `projects-set_tracking-${crypto.randomUUID()}`,
          compare: { base_revision: preview.baseRevision },
          prepared: [],
        },
      });
      if (!reply.ok) return failed(reply);
      return { ok: true, value: projectOf(reply.value as ProjectValue) };
    },
  };
}
