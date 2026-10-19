// root마다 host를 달리해 origin을 가른다. 같은 root는 늘 같은 host라 localStorage가 이어진다.
import { createHash } from "node:crypto";

export function createArtifactRoots(): {
  register(realRoot: string): string;
  rootOf(host: string): string | undefined;
} {
  const roots = new Map<string, string>();
  return {
    register(realRoot) {
      const host = `a-${
        createHash("sha256").update(realRoot).digest("hex").slice(0, 24)
      }`;
      roots.set(host, realRoot);
      return host;
    },
    rootOf: (host) => roots.get(host),
  };
}
