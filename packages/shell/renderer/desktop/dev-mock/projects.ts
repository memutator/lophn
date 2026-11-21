// mock 모드의 Workspaces panel project 목록. 등록과 보관은 메모리 목록에만 더한다.
import type {
  ProjectItem,
  ProjectsSource,
} from "../workspaces/projects/source.ts";
import {
  fakeProjects,
  folderItem,
} from "../workspaces/projects/testdata/fake-projects.ts";
import { PROJECT_GROCERY, PROJECT_OFFICE, PROJECT_TAX } from "./ids.ts";

const PROJECTS: readonly ProjectItem[] = [
  {
    id: PROJECT_GROCERY,
    title: "Grocery budget",
    purpose: "Keep the monthly food spending under the plan.",
    revision: "1",
    archived: false,
    identity: "pri_01h455vb4pex5v6nkc6gd5fd71",
    repo: "git",
    folders: [folderItem("/home/mina/Documents/grocery", "")],
  },
  {
    id: PROJECT_OFFICE,
    title: "Home office",
    purpose: "Tax papers and receipts for the desk.",
    revision: "1",
    archived: false,
    identity: "pri_01h455vb4pex5v6nkc6gd5fd72",
    repo: "git",
    folders: [folderItem("/home/mina/Documents/office", "")],
  },
  {
    id: PROJECT_TAX,
    title: "Old tax notes",
    purpose: "Notes from last year's filing.",
    revision: "1",
    archived: true,
    identity: "pri_01h455vb4pex5v6nkc6gd5fd73",
    repo: "git",
    folders: [folderItem("/home/mina/Documents/tax", "")],
  },
];

/** Workspaces panel과 앱 공간의 project 고르기가 읽는 통로. 메모리에서 고친다. */
export function mockProjects(): ProjectsSource {
  return fakeProjects({
    projects: PROJECTS,
    // Workspaces panel의 폴더 다시 잡기를 보이려고 한 폴더는 없는 것으로 읽는다.
    missingFolder: "/home/mina/Documents/office",
    picked: "/home/mina/Documents/new-project",
  }).source;
}
