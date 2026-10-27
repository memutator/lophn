// CatalogSource는 project 목록과 앱 목록에서 보관하지 않은 것의 이름만 모은다. 팔레트의 project·앱 행이 쓴다.
// core를 따로 부르지 않고 런처의 통로를 그대로 쓴다.
import type { AppsSource } from "../../apps/source.ts";
import type { ProjectsSource } from "../launcher/projects/source.ts";
import type { CatalogSource } from "./catalog.ts";

export function catalogSource(
  projects: ProjectsSource,
  apps: AppsSource,
): CatalogSource {
  return {
    async catalog() {
      const [projectRows, appRows] = await Promise.all([
        projects.list(),
        apps.list(),
      ]);
      if (!projectRows.ok) return projectRows;
      if (!appRows.ok) return appRows;
      return {
        ok: true,
        value: {
          projects: projectRows.value
            .filter((row) => !row.archived)
            .map((row) => ({ id: row.id, title: row.title })),
          apps: appRows.value
            .filter((row) => !row.archived)
            .map((row) => ({
              id: row.id,
              title: row.name,
            })),
        },
      };
    },
  };
}
