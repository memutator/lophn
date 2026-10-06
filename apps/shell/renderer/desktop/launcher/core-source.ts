// LauncherSource를 main의 core 통로와 폴더 선택 통로로 만든다. 응답은 main의 contract client가
// route output schema로 이미 검사했다. 아래 응답 모양은 projects.list·create schema에서 이
// 화면이 읽는 field만 옮긴 것이다.
import type {
  FolderPickerApi,
  FolderPickReply,
} from "../../../ipc/folder-picker.ts";
import type { CoreSource } from "../connection/connection.ts";
import type {
  LauncherResult,
  LauncherSource,
  ProjectCard,
  TrackingRule,
} from "./source.ts";

interface ProjectValue {
  id: string;
  name: string;
  title: string;
  purpose: string;
  folders: { path: string; description: string }[];
  tracking: {
    enabled: boolean;
    patterns: TrackingRule[];
    use_gitignore: boolean;
  };
  document_count?: number;
}

interface ProjectListValue {
  projects: ProjectValue[];
  next_cursor: string | null;
}

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 보인다. */
const PAGE_LIMIT = 20;

export function projectCardOf(value: ProjectValue): ProjectCard {
  return {
    id: value.id,
    name: value.name,
    title: value.title,
    purpose: value.purpose,
    folders: value.folders.map((folder) => ({ path: folder.path })),
    tracking: {
      enabled: value.tracking.enabled,
      patterns: value.tracking.patterns.map((rule) => ({
        effect: rule.effect,
        glob: rule.glob,
      })),
      useGitignore: value.tracking.use_gitignore,
    },
    documentCount: value.document_count ?? 0,
  };
}

/** preload가 연 폴더 선택 통로. 없으면(테스트·다른 창) 선택기를 열 수 없다. */
export function windowFolderPicker(): FolderPickerApi | undefined {
  const bridge = (globalThis as { lophnFolders?: FolderPickerApi })
    .lophnFolders;
  return bridge && typeof bridge.pick === "function" ? bridge : undefined;
}

export function coreLauncherSource(
  core: CoreSource,
  picker: FolderPickerApi | undefined,
): LauncherSource {
  return {
    async projects() {
      const cards: ProjectCard[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const reply = await core.call({
          kind: "read",
          resource: "projects",
          method: "list",
          body: { status: "active", ...(cursor ? { cursor } : {}) },
        });
        if (!reply.ok) {
          return { ok: false, code: reply.error?.code ?? "internal" };
        }
        const value = reply.value as ProjectListValue;
        cards.push(...value.projects.map(projectCardOf));
        if (value.next_cursor === null) break;
        cursor = value.next_cursor;
      }
      return { ok: true, value: cards };
    },

    async register(draft): Promise<LauncherResult<ProjectCard>> {
      // 성공 응답은 route output 그대로다. 추가 포장은 없다(platform/api#R3).
      const reply = await core.call({
        kind: "command",
        resource: "projects",
        method: "create",
        body: {
          input: {
            id: draft.id,
            name: draft.name,
            title: draft.title,
            purpose: draft.purpose,
            folders: draft.folders.map((folder) => ({
              path: folder.path,
              description: folder.description,
            })),
            // 등록 직후 추적은 꺼져 있고 규칙도 아직 고르지 않았다(documents/projects#R3).
            tracking: { enabled: false, patterns: [], use_gitignore: false },
          },
          idempotency_key: `projects-create-${draft.id}`,
          compare: {},
          prepared: [],
        },
      });
      if (!reply.ok) {
        return { ok: false, code: reply.error?.code ?? "internal" };
      }
      return { ok: true, value: projectCardOf(reply.value as ProjectValue) };
    },

    async pickFolder() {
      if (!picker) return { ok: false };
      let reply: FolderPickReply;
      try {
        reply = await picker.pick();
      } catch {
        return { ok: false };
      }
      return reply.ok ? { ok: true, path: reply.path } : { ok: false };
    },
  };
}
