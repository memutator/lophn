// mock 모드의 런처 프로젝트 카드와 [Instructions] 통로. 등록과 보관은 메모리 목록에만 더한다.
import type {
  ProjectItem,
  ProjectsSource,
} from "../launcher/projects/source.ts";
import {
  fakeProjects,
  folderItem,
} from "../launcher/projects/testdata/fake-projects.ts";
import type { InstructionsApi } from "../../../ipc/instructions.ts";
import { SEED_INSTRUCTIONS_DOCUMENT } from "../dev-seed.ts";
import { PROJECT_GROCERY, PROJECT_OFFICE, PROJECT_TAX } from "./ids.ts";

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
  {
    id: PROJECT_TAX,
    title: "Old tax notes",
    purpose: "Notes from last year's filing.",
    revision: "1",
    archived: true,
    folders: [folderItem("/home/mina/Documents/tax", "")],
  },
];

/** 런처 카드와 앱 공간의 project 고르기가 읽는 통로. 메모리에서 고친다. */
export function mockProjects(): ProjectsSource {
  return fakeProjects({
    projects: PROJECTS,
    // 런처 카드의 폴더 다시 잡기를 보이려고 한 폴더는 없는 것으로 읽는다.
    missingFolder: "/home/mina/Documents/office",
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
