// LauncherSource를 projects 통로 위에 만든다. 폴더 선택은 projects의 core-source가 같이 쓴다.
import type { FolderPickerApi } from "../../../ipc/folder-picker.ts";
import type { CoreSource } from "../connection/connection.ts";
import {
  createProject,
  readProjects,
  windowFolderPicker,
} from "../lophn-space/projects/core-source.ts";
import type { ProjectItem } from "../lophn-space/projects/source.ts";
import type { LauncherSource, ProjectCard } from "./source.ts";

export { windowFolderPicker };

export function projectCardOf(item: ProjectItem): ProjectCard {
  return {
    id: item.id,
    title: item.title,
    purpose: item.purpose,
    folders: item.folders.map((folder) => ({
      path: folder.path,
      found: folder.found,
    })),
  };
}

export function coreLauncherSource(
  core: CoreSource,
  picker: FolderPickerApi | undefined,
): LauncherSource {
  return {
    async projects() {
      const read = await readProjects(core, "active");
      return read.ok
        ? { ok: true, value: read.value.map(projectCardOf) }
        : read;
    },

    async register(draft) {
      const created = await createProject(core, draft);
      return created.ok
        ? { ok: true, value: projectCardOf(created.value) }
        : created;
    },

    async pickFolder() {
      if (!picker) return { ok: false };
      try {
        const reply = await picker.pick({ purpose: "register" });
        return reply.ok ? { ok: true, path: reply.path } : { ok: false };
      } catch {
        return { ok: false };
      }
    },
  };
}
