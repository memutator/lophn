// 다른 컴퓨터의 artifact를 봉한 scheme으로 여는 길. 그 컴퓨터의 core가 `artifacts/*` route로 byte를 주고(읽기 전용, artifact 폴더 안만),
// 이 컴퓨터는 같은 sealed partition·CSP·상한 규칙으로 그 byte를 내보낸다. main tsc가 protocol의 zod file을 보지 못해 route 이름은 글이다.
import { err, ok, type Result } from "../../../base/result.ts";
import {
  ARTIFACT_ENTRY,
  type ArtifactWorkspace,
  artifactWorkspaceOf,
} from "../../../protocol/projects/artifact.ts";
import {
  type ArtifactListItem,
  artifactListItemSchema,
} from "../../ipc/artifact.ts";
import type { CoreReply } from "../../ipc/core-api.ts";
import type {
  ArtifactSource,
  RemoteArtifact,
  ResolvedSource,
} from "./source.ts";

/** 그 기계의 core에 닿는 link. 이름을 모르는 기계면 undefined다. */
export type RemoteArtifactLink = (machine: string) =>
  | {
      call(input: {
        resource: string;
        method: string;
        body: unknown;
      }): Promise<CoreReply>;
    }
  | undefined;

const containerOf = (workspace: ArtifactWorkspace) =>
  workspace.kind === "project"
    ? { project: workspace.id }
    : { app: workspace.id };

function parseList(value: unknown): ArtifactListItem[] | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = (value as { artifacts?: unknown }).artifacts;
  if (!Array.isArray(raw)) return null;
  const items: ArtifactListItem[] = [];
  for (const entry of raw) {
    const parsed = artifactListItemSchema.safeParse(entry);
    if (parsed.success) items.push(parsed.data);
  }
  return items;
}

export function createRemoteArtifacts(link: RemoteArtifactLink): {
  list(
    machine: string,
    workspace: ArtifactWorkspace,
  ): Promise<ArtifactListItem[]>;
  resolve(
    source: Extract<ArtifactSource, { kind: "artifact" }> & {
      machine: string;
    },
  ): Promise<Result<ResolvedSource>>;
  /** 그 artifact 폴더 안 file 하나. 없거나 읽지 못하면 null이다. */
  read(target: RemoteArtifact, path: string): Promise<Uint8Array | null>;
} {
  async function fetchList(
    machine: string,
    workspace: ArtifactWorkspace,
  ): Promise<Result<ArtifactListItem[]>> {
    const target = link(machine);
    if (target === undefined) {
      return err({ code: "unavailable", message: "computer is not linked" });
    }
    const reply = await target
      .call({
        resource: "artifacts",
        method: "list",
        body: containerOf(workspace),
      })
      .catch(() => undefined);
    if (reply === undefined || !reply.ok) {
      return err({
        code: "unavailable",
        message: reply?.error?.message ?? "computer did not answer",
      });
    }
    const items = parseList(reply.value);
    if (items === null) {
      return err({ code: "unavailable", message: "unexpected list response" });
    }
    return ok(items);
  }

  return {
    async list(machine, workspace) {
      const listed = await fetchList(machine, workspace);
      return listed.ok ? listed.value : [];
    },
    async resolve(source) {
      const workspace = artifactWorkspaceOf(source);
      const listed = await fetchList(source.machine, workspace);
      if (!listed.ok) return listed;
      if (!listed.value.some((item) => item.name === source.name)) {
        return err({ code: "not_found", message: "artifact not found" });
      }
      return ok({
        // 이 컴퓨터의 폴더가 아니다. view의 신원은 `remote`가 정한다.
        root: "",
        entry: ARTIFACT_ENTRY,
        file: "",
        name: source.name,
        scope: null,
        remote: { machine: source.machine, workspace, name: source.name },
      });
    },
    async read(target, path) {
      const machine = link(target.machine);
      if (machine === undefined) return null;
      const reply = await machine
        .call({
          resource: "artifacts",
          method: "file",
          body: {
            ...containerOf(target.workspace),
            name: target.name,
            path,
          },
        })
        .catch(() => undefined);
      if (reply === undefined || !reply.ok) return null;
      const base64 = (reply.value as { base64?: unknown } | null)?.base64;
      if (typeof base64 !== "string") return null;
      return new Uint8Array(Buffer.from(base64, "base64"));
    },
  };
}
