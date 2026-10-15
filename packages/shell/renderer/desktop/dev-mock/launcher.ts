// mock 모드의 런처 프로젝트 카드와 [Instructions] 통로. 등록은 메모리 목록에만 더한다.
import type {
  LauncherSource,
  ProjectCard,
  ProjectDraft,
} from "../launcher/source.ts";
import type { InstructionsApi } from "../../../ipc/instructions.ts";
import { SEED_INSTRUCTIONS_DOCUMENT } from "../dev-seed.ts";
import { PROJECT_GROCERY, PROJECT_OFFICE } from "./ids.ts";

const TRACKING = {
  enabled: true,
  patterns: [
    { effect: "include" as const, glob: "**/*.md" },
    { effect: "exclude" as const, glob: "archive/**" },
  ],
  useGitignore: true,
};

const OFF = { enabled: false, patterns: [], useGitignore: true };

export function mockLauncher(): LauncherSource {
  const cards: ProjectCard[] = [
    {
      id: PROJECT_GROCERY,
      name: "grocery-budget",
      title: "Grocery budget",
      purpose: "Keep the monthly food spending under the plan.",
      folders: [{ path: "/home/mina/Documents/grocery" }],
      tracking: TRACKING,
      documentCount: 12,
    },
    {
      id: PROJECT_OFFICE,
      name: "home-office",
      title: "Home office",
      purpose: "Tax papers and receipts for the desk.",
      folders: [{ path: "/home/mina/Documents/office" }],
      tracking: OFF,
      documentCount: 4,
    },
  ];
  const register = (draft: ProjectDraft): ProjectCard => ({
    id: draft.id,
    name: draft.name,
    title: draft.title,
    purpose: draft.purpose,
    folders: draft.folders.map((folder) => ({ path: folder.path })),
    tracking: OFF,
    documentCount: 0,
  });
  return {
    projects: () => Promise.resolve({ ok: true, value: [...cards] }),
    register(draft) {
      const card = register(draft);
      cards.push(card);
      return Promise.resolve({ ok: true, value: card });
    },
    pickFolder: () =>
      Promise.resolve({ ok: true, path: "/home/mina/Documents/new-project" }),
  };
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
