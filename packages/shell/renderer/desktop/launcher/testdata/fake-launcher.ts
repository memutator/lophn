// 런처와 등록 dialog 시험·gallery·mock 모드의 가짜 통로. Projects 화면의 fake와 같은 data를 읽는다.
import { projectCardOf } from "../core-source.ts";
import {
  fakeProjects,
  type FakeProjectsOptions,
} from "../../lophn-space/projects/testdata/fake-projects.ts";
import type { LauncherSource } from "../source.ts";

export function fakeLauncher(options: FakeProjectsOptions = {}) {
  const { source: projects, calls } = fakeProjects(options);
  const source: LauncherSource = {
    async projects() {
      const read = await projects.list();
      return read.ok
        ? {
          ok: true,
          value: read.value.filter((item) => !item.archived).map(
            projectCardOf,
          ),
        }
        : read;
    },
    async register(draft) {
      const created = await projects.register(draft);
      return created.ok
        ? { ok: true, value: projectCardOf(created.value) }
        : created;
    },
    pickFolder: () => projects.pickFolder(),
  };
  return { source, calls };
}
