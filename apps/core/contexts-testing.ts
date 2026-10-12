// context worker를 실제로 띄우는 core 시험이 같이 쓰는 환경 조립이다(contexts-worker_test.ts,
// contexts-watch_test.ts). eval-project fixture 계약이 기대는 두 가지를 진짜 데이터로 둔다.
// - 같은 Project의 다른 context `rubrics`: fixture 관계 `rubrics/Rubric`이 가리키는 public type.
// - 앱 `calendar`: fixture의 app-data type이 부르는 read command `events.list`를 선언한 active release(blueprint).
export const RUBRICS_CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fas";
export const RUBRICS_TITLE = "rubrics";
export const RUBRIC_PATH = "eval/rubrics/schedule-quality.md";

// fixture 실험 문서(`rubric: schedule-quality`)가 가리키는 Rubric 하나를 가진 계약이다.
export function rubricsContract(): Record<string, unknown> {
  return {
    schema: 1,
    contract: {
      types: [{
        name: "Rubric",
        summary: "How an experiment is graded",
        visibility: "public",
        source: { kind: "docs", paths: ["eval/rubrics/*.md"] },
        key: "id",
        fields: [
          {
            name: "id",
            from: { kind: "path", capture: "file" },
            value_type: "string",
            required: false,
            visibility: "public",
          },
          {
            name: "title",
            from: { kind: "title" },
            value_type: "string",
            required: false,
            visibility: "public",
          },
        ],
        relations: [],
        rules: [],
      }],
    },
    searches: [],
    saved_views: [],
    examples: [],
  };
}

// Project 폴더에 Rubric 문서를 둔다. fixture 계약의 경로 밖이라 Evaluation의 개체와 위반은 그대로다.
export async function writeRubricFiles(folder: string): Promise<void> {
  await Deno.mkdir(`${folder}/eval/rubrics`, { recursive: true });
  await Deno.writeTextFile(
    `${folder}/${RUBRIC_PATH}`,
    "# Schedule quality\n\nHow well the plan fits the calendar.\n",
  );
}

// 앱 `calendar`의 active release에 고정되는 blueprint다: 읽기 `events.list`와 쓰기 `events.create`를 선언한다.
// 시험이 `seedLedger(home, CALENDAR_BLUEPRINT, ...)`로 ledger에 심는다(앱 감독이 앱을 띄우지 않게 run_enabled는 0).
export const CALENDAR_BLUEPRINT = JSON.stringify({
  commands: [
    { key: "events.list", effect: "read" },
    { key: "events.create", effect: "write" },
  ],
});
