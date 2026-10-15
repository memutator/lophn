// 연결한 폴더마다 다른 디스크 파일 tree. 첫 폴더 안의 파일은 상대 경로가 id이고 다른 폴더는 절대 경로다.
import type { TreeNode } from "@lophn/design/components";

import { type FileRoot, ROOTS } from "./file-data.ts";

export const PHRONER_TREE: readonly TreeNode[] = [
  {
    id: "assets",
    label: "assets",
    children: [{ id: "assets/chest-layout.png", label: "chest-layout.png" }],
  },
  {
    id: "docs",
    label: "docs",
    children: [{ id: "docs/notes.md", label: "notes.md" }],
  },
  {
    id: "eval",
    label: "eval",
    children: [
      {
        id: "eval/experiments",
        label: "experiments",
        children: [
          {
            id: "eval/experiments/exp-008-query-tools.md",
            label: "exp-008-query-tools.md",
          },
          {
            id: "eval/experiments/exp-012-ftb-quests-021-q8.md",
            label: "exp-012-ftb-quests-021-q8.md",
          },
        ],
      },
      {
        id: "eval/rubrics",
        label: "rubrics",
        children: [
          {
            id: "eval/rubrics/query-hygiene.json",
            label: "query-hygiene.json",
          },
        ],
      },
      {
        id: "eval/scenarios",
        label: "scenarios",
        children: [
          {
            id: "eval/scenarios/query-leave-still",
            label: "query-leave-still",
            children: [
              {
                id: "eval/scenarios/query-leave-still/r1.yaml",
                label: "r1.yaml",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "loop",
    label: "loop",
    children: [
      {
        id: "loop/findings",
        label: "findings",
        children: [
          { id: "loop/findings/F-009.md", label: "F-009.md" },
          { id: "loop/findings/F-010.md", label: "F-010.md" },
        ],
      },
    ],
  },
  {
    id: "reports",
    label: "reports",
    children: [{ id: "reports/weekly-12.pdf", label: "weekly-12.pdf" }],
  },
  { id: "LOPHN.md", label: "LOPHN.md" },
];

const NOTES_DIR = ROOTS[2].path;

export const NOTES_TREE: readonly TreeNode[] = [
  {
    id: `${NOTES_DIR}/meetings`,
    label: "meetings",
    children: [
      { id: `${NOTES_DIR}/meetings/2026-10-12.md`, label: "2026-10-12.md" },
      { id: `${NOTES_DIR}/meetings/2026-10-05.md`, label: "2026-10-05.md" },
    ],
  },
  { id: `${NOTES_DIR}/ideas.md`, label: "ideas.md" },
  { id: `${NOTES_DIR}/todo.md`, label: "todo.md" },
];

// 하위 폴더 root는 그 폴더 안만 보인다. id는 상위 폴더 기준 상대 경로 그대로다.
const EVAL_TREE: readonly TreeNode[] =
  PHRONER_TREE.find((node) => node.id === "eval")?.children ?? [];

/** 연결 폴더 id → 그 폴더의 tree. */
export function treeOf(root: FileRoot): readonly TreeNode[] {
  if (root.id === "notes") return NOTES_TREE;
  if (root.id === "phroner/eval") return EVAL_TREE;
  return PHRONER_TREE;
}

/** 처음에 펼쳐 두는 가지. */
export function openBranchesOf(root: FileRoot): ReadonlySet<string> {
  if (root.id === "notes") return new Set([`${NOTES_DIR}/meetings`]);
  if (root.id === "phroner/eval") return new Set(["eval/experiments"]);
  return new Set(["eval", "eval/experiments"]);
}
