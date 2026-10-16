import type { Id } from "../../../protocol/base/ids.ts";
import type { Place } from "../../../protocol/lophn-agent/places.ts";

type ProjectCaller =
  | { kind: "person" }
  | { kind: "agent"; place: Place | null }
  // 부른 invocation의 project.
  | { kind: "app"; project: Id<"prj"> | null };

type ProjectPick =
  | { ok: true; project: Id<"prj"> | null }
  | { ok: false; code: "project_required" | "project_mismatch" };

// 범위 아닌 app-api는 project를 받지 않는다. 앱은 입력으로 project를 정하지 못한다.
export function pickProject(
  scoped: boolean,
  given: Id<"prj"> | null | undefined,
  caller: ProjectCaller,
): ProjectPick {
  const asked = given ?? null;
  if (!scoped || caller.kind === "app") {
    if (asked !== null) return { ok: false, code: "project_mismatch" };
    if (!scoped) return { ok: true, project: null };
  }
  if (caller.kind === "app") {
    return caller.project === null
      ? { ok: false, code: "project_required" }
      : { ok: true, project: caller.project };
  }
  if (caller.kind === "agent" && caller.place?.kind === "project") {
    if (asked !== null && asked !== (caller.place.id as Id<"prj">)) {
      return { ok: false, code: "project_mismatch" };
    }
    return { ok: true, project: caller.place.id as Id<"prj"> };
  }
  return asked === null
    ? { ok: false, code: "project_required" }
    : { ok: true, project: asked };
}
