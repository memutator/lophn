// root마다 host를 달리해 origin을 가른다. 같은 root는 늘 같은 host라 localStorage가 이어진다.
// scope(workflow instance)가 있으면 root가 같아도 instance마다 host가 다르다.
import { createHash } from "node:crypto";

export function createArtifactRoots(): {
  register(realRoot: string, scope?: string | null): string;
  rootOf(host: string): string | undefined;
  scopeOf(host: string): string | undefined;
} {
  const roots = new Map<string, { root: string; scope: string | undefined }>();
  return {
    register(realRoot, scope) {
      const input = scope ? `${realRoot}\0${scope}` : realRoot;
      const host = `a-${
        createHash("sha256").update(input).digest("hex").slice(0, 24)
      }`;
      roots.set(host, { root: realRoot, scope: scope || undefined });
      return host;
    },
    rootOf: (host) => roots.get(host)?.root,
    scopeOf: (host) => roots.get(host)?.scope,
  };
}
