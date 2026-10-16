// mock 모드의 런처 프로젝트 카드와 [Instructions] 통로. 등록은 메모리 목록에만 더한다.
import type { LauncherSource } from "../launcher/source.ts";
import { fakeLauncher } from "../launcher/testdata/fake-launcher.ts";
import type { ProjectItem } from "../lophn-space/projects/source.ts";
import { folderItem } from "../lophn-space/projects/testdata/fake-projects.ts";
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

/** 지침 문서는 시드 편집기가 여는 문서 하나다. 첫 저장은 메모리에서 성공만 답한다. */
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
    create: () =>
      Promise.resolve({
        ok: true,
        value: {
          outcome: "saved",
          version: "ver_instructions",
          failure: null,
          document: SEED_INSTRUCTIONS_DOCUMENT,
        },
      }),
  };
}
