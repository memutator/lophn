// mock 모드의 런처 프로젝트 카드, Projects 화면과 [Instructions] 통로. 등록은 메모리 목록에만 더한다.
import type { LauncherSource } from "../launcher/source.ts";
import { fakeLauncher } from "../launcher/testdata/fake-launcher.ts";
import type { ProjectItem } from "../lophn-space/projects/source.ts";
import type { ProjectsSource } from "../lophn-space/projects/source.ts";
import {
  fakeProjects,
  folderItem,
} from "../lophn-space/projects/testdata/fake-projects.ts";
import type { InstructionsApi } from "../../../ipc/instructions.ts";
import { SEED_INSTRUCTIONS_DOCUMENT } from "../dev-seed.ts";
import { PROJECT_GROCERY, PROJECT_OFFICE } from "./ids.ts";

const PROJECTS: readonly ProjectItem[] = [
  {
    id: PROJECT_GROCERY,
    title: "Grocery budget",
    purpose: "Keep the monthly food spending under the plan.",
    revision: "1",
    archived: false,
    folders: [folderItem("/home/mina/Documents/grocery", "")],
  },
  {
    id: PROJECT_OFFICE,
    title: "Home office",
    purpose: "Tax papers and receipts for the desk.",
    revision: "1",
    archived: false,
    folders: [folderItem("/home/mina/Documents/office", "")],
  },
];

export function mockLauncher(): LauncherSource {
  return fakeLauncher({
    projects: PROJECTS,
    picked: "/home/mina/Documents/new-project",
  }).source;
}

/** Projects 화면과 앱 공간의 project 고르기가 읽는 통로. 런처 카드와 같은 project를 메모리에서 고친다. */
export function mockProjects(): ProjectsSource {
  return fakeProjects({
    projects: PROJECTS,
    picked: "/home/mina/Documents/new-project",
  }).source;
}

/** 지침 문서는 시드 편집기가 여는 문서 하나다. */
export function mockInstructions(): InstructionsApi {
  return {
    open: () =>
      Promise.resolve({
        ok: true,
        value: {
          document: SEED_INSTRUCTIONS_DOCUMENT,
          version: "ver_instructions",
          path: SEED_INSTRUCTIONS_DOCUMENT,
        },
      }),
  };
}
