// root마다 host를 달리해 origin을 가른다. 같은 root는 늘 같은 host라 localStorage가 이어진다.
// scope(workflow instance)가 있으면 root가 같아도 instance마다 host가 다르다.
import { createHash } from "node:crypto";

import type { RemoteArtifact } from "./source.ts";

export function createArtifactRoots(): {
  register(realRoot: string, scope?: string | null): string;
  /** 다른 컴퓨터의 artifact도 대상마다 host를 달리해 origin을 가른다. */
  registerRemote(target: RemoteArtifact): string;
  rootOf(host: string): string | undefined;
  scopeOf(host: string): string | undefined;
  remoteOf(host: string): RemoteArtifact | undefined;
} {
  const roots = new Map<string, { root: string; scope: string | undefined }>();
  const remotes = new Map<string, RemoteArtifact>();
  return {
    registerRemote(target) {
      const host = `r-${createHash("sha256")
        .update(
          `${target.machine}\0${target.workspace.kind}\0${target.workspace.id}\0${target.name}`,
        )
        .digest("hex")
        .slice(0, 24)}`;
      remotes.set(host, target);
      return host;
    },
    remoteOf: (host) => remotes.get(host),
    register(realRoot, scope) {
      const input = scope ? `${realRoot}\0${scope}` : realRoot;
      const host = `a-${createHash("sha256")
        .update(input)
        .digest("hex")
        .slice(0, 24)}`;
      roots.set(host, { root: realRoot, scope: scope || undefined });
      return host;
    },
    rootOf: (host) => roots.get(host)?.root,
    scopeOf: (host) => roots.get(host)?.scope,
  };
}
