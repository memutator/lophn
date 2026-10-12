// 의미 검사 test가 같이 쓰는 올바른 묶음과 환경. test는 이것을 복사해 한 곳만 바꾼다.
import {
  type BundleContent,
  bundleContentSchema,
} from "../../../protocol/projects/mod.ts";
import type { ValidationEnv } from "./types.ts";

const text = (name: string, from: unknown) => ({
  name,
  from,
  value_type: "string",
});

export function sampleBundle(): BundleContent {
  return bundleContentSchema.parse({
    schema: 1,
    contract: {
      types: [
        {
          name: "Experiment",
          summary: "One run comparing arms on scenarios",
          visibility: "public",
          source: {
            kind: "series",
            pattern: "eval/experiments/exp-{n:03}-*.md",
          },
          key: "id",
          fields: [
            {
              ...text("id", { kind: "path", capture: "n" }),
              visibility: "public",
            },
            text("title", { kind: "title" }),
            {
              name: "status",
              from: { kind: "frontmatter", key: "status" },
              value_type: "enum",
              values: ["planned", "running", "done"],
              required: true,
              visibility: "public",
            },
            {
              name: "scenarios",
              from: { kind: "frontmatter", key: "scenarios" },
              value_type: "list",
              item_type: "string",
            },
            text("rubric", { kind: "frontmatter", key: "rubric" }),
            text("question", { kind: "section", heading: "질문" }),
          ],
          relations: [
            {
              name: "runs_on",
              label: "runs on",
              to: "Scenario",
              via: "scenarios",
              cardinality: "many",
              visibility: "public",
            },
            {
              name: "graded_by",
              label: "graded by",
              to: "rubrics/Rubric",
              via: "rubric",
              cardinality: "optional",
            },
          ],
          rules: [
            {
              id: "status-required",
              kind: "required_field",
              params: { field: "status" },
              message: "Every experiment says its status",
            },
            {
              id: "status-known",
              kind: "enum_value",
              params: { field: "status" },
              message: "Status is planned, running or done",
            },
            {
              id: "scenarios-exist",
              kind: "relation_target_exists",
              params: { relation: "runs_on" },
              message: "Every scenario an experiment runs on exists",
            },
          ],
        },
        {
          name: "Scenario",
          summary: "A task the agent is graded on",
          visibility: "public",
          source: { kind: "docs", paths: ["eval/scenarios/*.md"] },
          key: "id",
          fields: [
            text("id", { kind: "path", capture: "file" }),
            text("title", { kind: "title" }),
          ],
        },
        {
          name: "Finding",
          summary: "What an experiment showed",
          source: { kind: "series", pattern: "loop/findings/F-{n:03}.md" },
          key: "id",
          fields: [
            text("id", { kind: "path", capture: "n" }),
            text("title", { kind: "title" }),
            text("experiment", { kind: "frontmatter", key: "experiment" }),
          ],
          relations: [{
            name: "about",
            label: "about",
            to: "Experiment",
            via: "experiment",
            cardinality: "one",
          }],
          rules: [{
            id: "about-exists",
            kind: "relation_target_exists",
            params: { relation: "about" },
            message: "A finding points at an experiment that exists",
          }],
        },
        {
          name: "Decision",
          summary: "One decision in the decision log",
          source: {
            kind: "section",
            documents: ["docs/decisions.md"],
            level: 2,
          },
          key: "title",
          fields: [
            text("title", { kind: "title" }),
            text("why", { kind: "section", heading: "Why" }),
          ],
        },
        {
          name: "Guide",
          summary: "A guide linked from the README",
          source: { kind: "index", document: "docs/README.md" },
          key: "id",
          fields: [
            text("id", { kind: "path", capture: "file" }),
            text("title", { kind: "title" }),
          ],
        },
        {
          name: "GuideHeading",
          summary: "A heading inside a guide",
          source: {
            kind: "outline",
            from_type: "Guide",
            format: "markdown",
            max_level: 3,
          },
          key: "title",
          fields: [text("title", { kind: "title" })],
        },
        {
          name: "Event",
          summary: "A calendar event",
          source: {
            kind: "app-data",
            app: "calendar",
            command: "events.list",
            result_path: ["items"],
          },
          key: "id",
          fields: [
            text("id", { kind: "item", key_path: ["id"] }),
            text("title", { kind: "item", key_path: ["summary"] }),
          ],
        },
      ],
    },
    searches: [
      {
        name: "findings_for_experiment",
        title: "Findings for an experiment",
        inputs: [{
          name: "experiment",
          label: "Experiment",
          type: "entity",
          of: "Experiment",
          required: true,
        }],
        query: {
          from: "Finding",
          where: {
            path: "experiment",
            op: "eq",
            value: { input: "experiment" },
          },
          follow: [{ relation: "about", as: "exp", direction: "forward" }],
          sort: [{ path: "key", dir: "desc" }],
        },
        result: {
          kind: "table",
          columns: [
            { label: "Finding", path: "key" },
            { label: "Title", path: "title" },
            { label: "Experiment status", path: "exp.status" },
          ],
        },
      },
      {
        name: "experiments_by_status",
        title: "Experiments by status",
        inputs: [{
          name: "status",
          label: "Status",
          type: "value",
          of: "Experiment.status",
          many: true,
        }],
        query: {
          from: "Experiment",
          where: { path: "status", op: "in", value: { input: "status" } },
        },
        result: { kind: "board", board_by: "status" },
      },
      {
        name: "experiments_on_scenario",
        title: "Experiments that run on a scenario",
        inputs: [{
          name: "scenario",
          label: "Scenario",
          type: "entity",
          of: "Scenario",
          required: true,
        }],
        query: {
          from: "Scenario",
          where: { path: "key", op: "eq", value: { input: "scenario" } },
          follow: [{ relation: "runs_on", as: "exp", direction: "reverse" }],
        },
        result: {
          kind: "table",
          columns: [
            { label: "Experiment", path: "exp.key" },
            { label: "Status", path: "exp.status" },
          ],
        },
      },
    ],
    saved_views: [{
      name: "Running experiments",
      search: "experiments_by_status",
      inputs: { status: ["running"] },
    }],
    examples: [
      {
        kind: "search",
        search: "findings_for_experiment",
        inputs: { experiment: "008" },
        expect_keys: ["009"],
      },
      {
        kind: "entity",
        path: "eval/experiments/exp-008-sight.md",
        expect: { type: "Experiment", key: "008", fields: { status: "done" } },
      },
    ],
  });
}

export function sampleEnv(): ValidationEnv {
  return {
    externalTypes: [
      {
        context: "rubrics",
        name: "Rubric",
        visibility: "public",
        key: "id",
        fields: [
          { name: "id", visibility: "public", value_type: "string" },
          { name: "weight", visibility: "private", value_type: "number" },
        ],
      },
      {
        context: "rubrics",
        name: "Draft",
        visibility: "private",
        key: "id",
        fields: [{ name: "id", visibility: "private", value_type: "string" }],
      },
    ],
    appCommandEffect(app, command) {
      if (app !== "calendar") return "unknown";
      if (command === "events.list") return "read";
      if (command === "events.create") return "write";
      if (command === "invites.send") return "external";
      return "unknown";
    },
  };
}

// test가 묶음의 일부를 바꿀 때 쓴다. 바꾼 뒤에도 모양 검사를 다시 지나게 한다.
export function changed(
  // deno-lint-ignore no-explicit-any
  edit: (bundle: any) => void,
): BundleContent {
  const raw = structuredClone(sampleBundle());
  edit(raw);
  return bundleContentSchema.parse(raw);
}
