// project를 더하는 순서 하나. 사람에게는 title 하나만 보이고, call의 workspace가 맞춰 쓰는 slug는 title에서 만든다.
// 등록 화면(projects/add)과 clone이 같이 쓴다.
import { err, type IdSource, ok, type Result } from "../../base/mod.ts";
import {
  projectApi,
  type ProjectFolder,
  type ProjectRecord,
} from "../../protocol/projects/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import type { Writer } from "../storage/ledger/mod.ts";

const NAME_ATTEMPTS = 5;
const SLUG_MAX = 63;

function slugOf(title: string): string {
  const words = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const start = /^[a-z]/.test(words)
    ? words
    : words === ""
      ? "project"
      : `project-${words}`;
  return start.slice(0, SLUG_MAX).replace(/-+$/, "");
}

function slugAttempt(base: string, attempt: number): string {
  if (attempt === 1) return base;
  const suffix = `-${attempt}`;
  return `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
}

export type ProjectAddInput = {
  title: string;
  purpose: string;
  folders: readonly ProjectFolder[];
  // clone이 다른 기계에서 들고 온 id.
  identity?: string;
};

export type ProjectAddDeps = {
  writer: Pick<Writer, "command">;
  ids: IdSource;
};

// slug가 겹치면(conflict) -2부터 번호를 붙여 다섯 번까지 해 본다. 다른 실패는 바로 돌려준다.
export async function addProject(
  ctx: AuthenticatedContext,
  input: ProjectAddInput,
  deps: ProjectAddDeps,
): Promise<Result<ProjectRecord>> {
  const id = deps.ids.newId("prj");
  const base = slugOf(input.title);
  let last: Result<ProjectRecord> = err({
    code: "conflict",
    message: "project name is taken",
  });
  for (let attempt = 1; attempt <= NAME_ATTEMPTS; attempt += 1) {
    const done = await deps.writer.command(ctx, {
      command: projectApi.register.name,
      input: {
        id,
        name: slugAttempt(base, attempt),
        title: input.title,
        purpose: input.purpose,
        folders: input.folders,
        ...(input.identity === undefined ? {} : { identity: input.identity }),
      },
      idempotency_key: `project-add-${id}-${attempt}`,
      compare: {},
      prepared: [],
    });
    if (done.ok) return ok(done.value.result as ProjectRecord);
    last = done;
    if (
      done.error.code !== "conflict" ||
      done.error.details?.["reason"] === "identity_in_use"
    ) {
      break;
    }
  }
  return last;
}
