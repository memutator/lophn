import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { commandRequestSchema, routePath } from "../platform/mod.ts";
import { EVENTS, ROUTES } from "./mod.ts";
import {
  agentProjectSchema,
  foldersSchema,
  INITIAL_TRACKING_PROPOSAL,
  PROJECT_EVENTS,
  PROJECT_ROUTES,
  projectArchive,
  projectCompareSchema,
  projectCreate,
  projectCreated,
  projectCreateInputSchema,
  projectGet,
  projectInputSchema,
  projectPreviewTrackingInputSchema,
  projectResolve,
  projectSetTracking,
  projectSetTrackingInputSchema,
  projectSetTrackingRequestSchema,
  projectTrackingChanged,
  projectUpdated,
  projectUpdateInputSchema,
  projectUpdateRequestSchema,
  trackingPreviewOutputSchema,
  trackingPreviewSchema,
  trackingRuleSetSchema,
  userProjectSchema,
} from "./projects.ts";

const project = "prj_01arz3ndektsv4rrffq69g5fav";
const folders = [{ path: "/work/docs", description: "Documents" }];
const tracking = { ...INITIAL_TRACKING_PROPOSAL };
const preview = {
  project,
  base_revision: "1",
  folders,
  tracking,
  observed_at: "2026-10-04T00:00:00.000Z",
  entries: [{
    folder_path: "/work/docs",
    path: "report.md",
    included: true,
    reason: "include **/*.md",
  }],
  complete: true,
  next_cursor: null,
};
const create = {
  id: project,
  name: "mahas",
  title: "마하스",
  purpose: "Reports",
  folders,
  tracking: { enabled: false, patterns: [], use_gitignore: true },
};

// deno-fmt-ignore
const projectRoutePaths = ["/v1/projects/create", "/v1/projects/update", "/v1/projects/set_tracking", "/v1/projects/archive", "/v1/projects/unarchive", "/v1/projects/list", "/v1/projects/get", "/v1/projects/resolve", "/v1/projects/preview_tracking"];
// deno-fmt-ignore
const projectEventTypes = ["ProjectCreated", "ProjectUpdated", "ProjectTrackingChanged", "ProjectArchived", "ProjectUnarchived"];

Deno.test("documents/projects#R1: route and event names match architecture and mutations are user-only", () => {
  assertEquals(PROJECT_ROUTES.map(routePath), projectRoutePaths);
  assertEquals(PROJECT_EVENTS.map((event) => event.type), projectEventTypes);
  assertEquals(
    ROUTES.filter((route) => route.resource === "projects").map(routePath),
    projectRoutePaths,
  );
  assertEquals(
    ROUTES.filter((route) =>
      route.resource === "projects" && route.kind === "command"
    ).map((route) => route.name),
    PROJECT_ROUTES.filter((route) => route.kind === "command").map((route) =>
      route.name
    ),
  );
  assertEquals(
    EVENTS.filter((event) => event.type.startsWith("Project")).map((event) =>
      event.type
    ),
    PROJECT_EVENTS.map((event) => event.type),
  );
  for (const route of PROJECT_ROUTES) {
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
    if (route.kind === "command") assertEquals(route.actors, ["user"]);
  }
  for (const event of PROJECT_EVENTS) {
    assert(event.subject.safeParse(project).success);
    assert(!event.subject.safeParse(project.replace("prj_", "app_")).success);
  }
  assert(
    projectCreated.payload.safeParse({
      name: create.name,
      title: create.title,
      purpose: create.purpose,
      folders,
      tracking: create.tracking,
    }).success,
  );
  assert(
    projectUpdated.payload.safeParse({
      before: { title: "Old" },
      after: { title: "New" },
    }).success,
  );
  assert(
    projectTrackingChanged.payload.safeParse({
      before: { folders, tracking: create.tracking },
      after: { folders, tracking },
    }).success,
  );
  assert(
    projectUpdated.payload.safeParse({
      before: { hash: "a".repeat(64), size_bytes: 1000 },
      after: { title: "New" },
    }).success,
  );
});

Deno.test("documents/projects#R2: project create accepts no folders or multiple ordered folders", () => {
  assert(
    projectCreateInputSchema.safeParse({ ...create, folders: [] }).success,
  );
  assert(
    projectCreateInputSchema.safeParse({
      ...create,
      folders: [...folders, { path: "/work/notes", description: "" }],
    }).success,
  );
  assert(!foldersSchema.safeParse([...folders, ...folders]).success);
  for (
    const value of [
      { ...create, id: project.replace("prj_", "doc_") },
      { ...create, extra: true },
      { ...create, title: "" },
      { ...create, folders: [{ ...folders[0], extra: true }] },
      { ...create, tracking: { ...create.tracking, extra: true } },
    ]
  ) assert(!projectCreateInputSchema.safeParse(value).success);
  assert(
    commandRequestSchema(projectCreate).safeParse({
      input: create,
      compare: {},
      idempotency_key: "create-project",
      prepared: [],
    }).success,
  );
});

Deno.test("documents/projects#R3: create cannot enable tracking and first proposal is Markdown with gitignore", () => {
  assertEquals(INITIAL_TRACKING_PROPOSAL, {
    enabled: true,
    patterns: [{ effect: "include", glob: "**/*.md" }],
    use_gitignore: true,
  });
  assert(!projectCreateInputSchema.safeParse({ ...create, tracking }).success);
  assert(!projectCreated.payload.safeParse({ ...create, tracking }).success);
  assert(trackingRuleSetSchema.safeParse(tracking).success);
});

Deno.test("documents/projects#R4: ordered relative glob rules remain explicit without coercion", () => {
  const rules = {
    ...tracking,
    patterns: [
      { effect: "include", glob: "**/*.md" },
      { effect: "exclude", glob: "private/**" },
      { effect: "include", glob: "private/public.md" },
    ],
  };
  assertEquals(trackingRuleSetSchema.parse(rules), rules);
  assert(
    trackingRuleSetSchema.safeParse({ ...tracking, patterns: [] }).success,
  );
  for (
    const glob of [
      "",
      "/etc/**",
      "../**",
      "a/../b",
      "C:/docs/**",
      "\\\\server\\share",
    ]
  ) {
    assert(
      !trackingRuleSetSchema.safeParse({
        ...tracking,
        patterns: [{ effect: "include", glob }],
      }).success,
    );
  }
  assert(
    !trackingRuleSetSchema.safeParse({ ...tracking, enabled: "true" }).success,
  );
  assert(
    !trackingRuleSetSchema.safeParse({
      ...tracking,
      patterns: [{ effect: "unknown", glob: "**" }],
    }).success,
  );
});

Deno.test("documents/projects#R5: preview carries exclusion reasons and uses bounded root-relative entries", () => {
  const excluded = {
    ...preview,
    entries: [
      {
        ...preview.entries[0],
        path: ".git/config",
        included: false,
        reason: "internal git directory",
      },
      {
        ...preview.entries[0],
        path: "private.md",
        included: false,
        reason: "gitignore",
      },
      {
        ...preview.entries[0],
        path: "link.md",
        included: false,
        reason: "outside root symlink",
      },
    ],
  };
  assert(trackingPreviewSchema.safeParse(excluded).success);
  assert(
    trackingPreviewOutputSchema.safeParse({ ...excluded, future: true })
      .success,
  );
  assert(!trackingPreviewSchema.safeParse({ ...preview, extra: true }).success);
  assert(
    !trackingPreviewSchema.safeParse({ ...preview, next_cursor: "next" })
      .success,
  );
  assert(
    !trackingPreviewSchema.safeParse({
      ...preview,
      entries: [{ ...preview.entries[0], folder_path: "/other" }],
    }).success,
  );
  assert(
    !trackingPreviewSchema.safeParse({
      ...preview,
      entries: [{ ...preview.entries[0], path: "../secret" }],
    }).success,
  );
  assert(
    projectPreviewTrackingInputSchema.safeParse({
      project,
      base_revision: "1",
      folders,
      tracking,
    }).success,
  );
});

Deno.test("documents/projects#R7: apply and folder changes carry exact preview and a positive CAS revision", () => {
  const input = { project, folders, tracking, preview };
  assert(projectSetTrackingInputSchema.safeParse(input).success);
  assert(
    commandRequestSchema(projectSetTracking).safeParse({
      input,
      compare: { base_revision: "1" },
      idempotency_key: "apply",
      prepared: [],
    }).success,
  );
  const request = {
    input,
    compare: { base_revision: "1" },
    idempotency_key: "apply",
    prepared: [],
  };
  assert(projectSetTrackingRequestSchema.safeParse(request).success);
  assert(
    !projectSetTrackingRequestSchema.safeParse({
      ...request,
      compare: { base_revision: "2" },
    }).success,
  );
  assert(
    !projectUpdateRequestSchema.safeParse({
      ...request,
      input: { project, folders, preview },
      compare: { base_revision: "2" },
    }).success,
  );
  assert(projectUpdateInputSchema.safeParse({ project, title: "New" }).success);
  assert(
    projectUpdateInputSchema.safeParse({ project, folders, preview }).success,
  );
  for (
    const value of [
      { project, folders },
      { project },
      { project, title: "New", preview },
      { project, folders: [], preview },
      {
        project,
        folders,
        preview: { ...preview, project: project.replace("prj_", "doc_") },
      },
    ]
  ) assert(!projectUpdateInputSchema.safeParse(value).success);
  for (
    const value of [
      { ...input, folders: [] },
      { ...input, tracking: { ...tracking, use_gitignore: false } },
      {
        ...input,
        preview: { ...preview, project: "prj_01arz3ndektsv4rrffq69g5faw" },
      },
      { ...input, extra: true },
    ]
  ) assert(!projectSetTrackingInputSchema.safeParse(value).success);
  assert(!projectCompareSchema.safeParse({ base_revision: 1 }).success);
  assert(!projectCompareSchema.safeParse({ base_revision: "0" }).success);
  assert(projectCompareSchema.safeParse({ base_revision: "1" }).success);
  assert(
    commandRequestSchema(projectArchive).safeParse({
      input: { project },
      compare: { base_revision: "1" },
      idempotency_key: "archive",
      prepared: [],
    }).success,
  );
});

Deno.test("documents/projects#R9: agent Project schema exposes stored refs without disk paths or tracking", () => {
  const metadata = {
    id: project,
    name: "mahas",
    title: "마하스",
    purpose: "Reports",
    revision: "1",
    status: "active" as const,
  };
  const result = agentProjectSchema.parse({
    ...metadata,
    documents: [],
    folders,
    tracking,
  });
  assertEquals(result, { ...metadata, documents: [] });
  assert(projectGet.input.safeParse({ project }).success);
  assert(
    !projectInputSchema.safeParse({ project: project.replace("prj_", "doc_") })
      .success,
  );
  assert(!projectGet.input.safeParse({ project, path: "/work" }).success);
  assertEquals(projectResolve.actors, ["user"]);
});

Deno.test("documents/projects#R12: file placement consumers can read enabled state and exact include rules", () => {
  const projectValue = {
    id: project,
    name: "mahas",
    title: "마하스",
    purpose: "Reports",
    revision: "1",
    status: "active",
    folders,
    tracking: {
      ...tracking,
      patterns: [
        ...tracking.patterns,
        { effect: "include", glob: "new-note.txt" },
      ],
    },
  };
  const parsed = projectGet.output.parse({
    project: {
      ...projectValue,
      document_count: 0,
      documents: [],
    },
    as_of_seq: "1",
    next_cursor: null,
  });
  const userProject = userProjectSchema.parse(parsed.project);
  assertEquals(userProject.tracking.enabled, true);
  assertEquals(userProject.tracking.patterns[1], {
    effect: "include",
    glob: "new-note.txt",
  });
});
