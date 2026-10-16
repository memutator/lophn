// FileSearchSource의 메모리 구현. gallery와 dev seed가 쓴다. 말뭉치는 fake 작업대의 첫 연결 폴더 안
// 파일의 줄이고 경로 순·줄 순으로 늘어서 있다.
import type { FileMatch, FileSearchSource } from "./source.ts";

const FAKE_SEARCH_FOLDER = "/home/mina/work/phroner";

const CORPUS: readonly { path: string; line: number; text: string }[] = [
  {
    path: "eval/experiments/exp-008-query-tools.md",
    line: 16,
    text: "Success: world_actions stays at 0 on every read-only scenario.",
  },
  {
    path: "eval/experiments/exp-008-query-tools.md",
    line: 24,
    text: "F-009 moved world_actions from 3 to 0 on query-leave-still.",
  },
  {
    path: "eval/rubrics/query-hygiene.json",
    line: 6,
    text: '{ "name": "world_actions", "target": 0, "weight": 0.5 },',
  },
  {
    path: "eval/rubrics/query-hygiene.json",
    line: 7,
    text: '{ "name": "tool_calls", "target": 3, "weight": 0.2 },',
  },
  {
    path: "eval/scenarios/query-leave-still/r1.yaml",
    line: 9,
    text: "expect: world_actions == 0",
  },
  {
    path: "loop/findings/F-004.md",
    line: 12,
    text: "On inv-read the change moved world_actions 2 → 0.",
  },
  {
    path: "loop/findings/F-009.md",
    line: 12,
    text: "On query-leave-still the change moved world_actions 3 → 0.",
  },
  {
    path: "loop/findings/F-010.md",
    line: 12,
    text: "On query-chest-name the change moved tool_calls 5 → 2.",
  },
];

export function fakeFileSearchSource(): FileSearchSource {
  return {
    search({ query, folder }) {
      const words = query.trim().toLowerCase();
      const matches: FileMatch[] = words === "" ? [] : CORPUS.flatMap((row) => {
        const start = row.text.toLowerCase().indexOf(words);
        const inFolder = folder === undefined ||
          `${FAKE_SEARCH_FOLDER}/${row.path}`.startsWith(`${folder}/`);
        return start === -1 || !inFolder ? [] : [{
          folder: FAKE_SEARCH_FOLDER,
          path: row.path,
          line: row.line,
          text: row.text,
          start,
          end: start + words.length,
        }];
      });
      return Promise.resolve({ ok: true, value: matches });
    },
  };
}
