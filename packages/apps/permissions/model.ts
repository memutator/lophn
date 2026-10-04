import { err, ok, type Result } from "../../base/mod.ts";
import { hostOf } from "../../contracts/apps/blueprint-scope.ts";
// fs scope의 path는 lexical 절대 경로다(contracts). 여기서는 부여 때 푼
// 실제 절대 경로로 바꿔 경계를 정한다.

export type FsScope = { path: string; recursive: boolean };
export type NetScope = { host: string; port: number };

export type ResolvedFsScope = FsScope & {
  // 폴더 안 lexical link 중 그 폴더 밖을 가리키는 경로. 그 kind의 deny 인자다.
  outsideLinks: string[];
};

export type ResolvedRequirement = {
  kind: "fs.read" | "fs.write";
  scope: ResolvedFsScope;
  reason: string;
} | {
  kind: "net.fetch" | "net.listen";
  scope: NetScope;
  reason: string;
} | {
  kind: "secret.use";
  scope: { name: string };
  reason: string;
} | {
  kind: "document.save";
  scope: { key: string };
  reason: string;
};

export type PathResolver = {
  // ~ 와 상대 경로를 포함한 입력을 실제 절대 경로로 푼다. 실패하면 undefined.
  realPath(path: string): Promise<string | undefined>;
  isDirectory(path: string): Promise<boolean>;
  // 폴더 안의 lexical link와 그 대상의 실제 경로. 대상을 못 풀면 target은 undefined.
  linksIn(directory: string): Promise<{ link: string; target?: string }[]>;
};

export type ProtectedRoots = {
  // home 전체가 아니라 credential 폴더만. ~/.ssh, ~/.aws, ~/.gnupg, keychain.
  credentialRoots: readonly string[];
  // 플랫폼 data root와 그 아래 다른 앱 DB, source.
  dataRoot: string;
  appRoots: readonly string[];
  sourceRoots: readonly string[];
};

function fail(
  code: "invalid_input" | "forbidden",
  message: string,
): Result<never> {
  return err({ code, message });
}

function isFs(
  scope: FsScope | NetScope | { name: string } | { key: string },
): scope is FsScope {
  return "path" in scope;
}

function isNet(
  scope: FsScope | NetScope | { name: string } | { key: string },
): scope is NetScope {
  return "host" in scope;
}

// descendant는 실제 경로의 경로 구성요소 관계다. 문자열 prefix는 쓰지 않는다.
export function isSameOrInside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export function containsProtected(
  path: string,
  roots: ProtectedRoots,
): boolean {
  const guarded = [
    ...roots.credentialRoots,
    roots.dataRoot,
    ...roots.appRoots,
    ...roots.sourceRoots,
  ];
  return guarded.some((root) =>
    isSameOrInside(path, root) || isSameOrInside(root, path)
  );
}

function checkFs(scope: FsScope, roots: ProtectedRoots): Result<FsScope> {
  if (containsProtected(scope.path, roots)) {
    return fail("forbidden", "path covers a protected root");
  }
  return ok(scope);
}

function checkNet(
  kind: "net.fetch" | "net.listen",
  scope: NetScope,
): Result<NetScope> {
  if (
    hostOf(scope.host) !== undefined || scope.port < 1 || scope.port > 65535
  ) {
    return fail("invalid_input", "host and port must be exact");
  }
  if (kind === "net.listen") {
    // 방향(듣기만)은 Deno flag로 표현하지 못한다. OS 제한 없이 거절한다.
    return fail("forbidden", "listen direction cannot be enforced");
  }
  return ok(scope);
}

export async function resolveRequirement(
  requirement: {
    kind: ResolvedRequirement["kind"];
    scope: FsScope | NetScope | { name: string } | { key: string };
    reason: string;
  },
  roots: ProtectedRoots,
  paths: PathResolver,
): Promise<Result<ResolvedRequirement>> {
  if (requirement.kind === "fs.read" || requirement.kind === "fs.write") {
    if (!isFs(requirement.scope)) {
      return fail("invalid_input", "fs scope is required");
    }
    const real = await paths.realPath(requirement.scope.path);
    if (real === undefined) {
      return fail("invalid_input", "path cannot be resolved");
    }
    const directory = await paths.isDirectory(real);
    if (directory && !requirement.scope.recursive) {
      return fail("invalid_input", "non-recursive directory grant is rejected");
    }
    if (!directory && requirement.scope.recursive) {
      return fail("invalid_input", "recursive grant requires a directory");
    }
    const scope = { path: real, recursive: requirement.scope.recursive };
    const checked = checkFs(scope, roots);
    if (!checked.ok) return checked;
    const outsideLinks: string[] = [];
    if (directory) {
      for (const found of await paths.linksIn(scope.path)) {
        // 대상을 못 푸는 link는 나중에 어디든 가리킬 수 있다. lexical 경로를 deny한다.
        if (found.target === undefined) {
          outsideLinks.push(found.link);
          continue;
        }
        if (containsProtected(found.target, roots)) {
          return fail("forbidden", "link points at a protected root");
        }
        if (!isSameOrInside(found.target, scope.path)) {
          outsideLinks.push(found.link);
        }
      }
    }
    outsideLinks.sort();
    return ok({
      kind: requirement.kind,
      scope: { ...scope, outsideLinks },
      reason: requirement.reason,
    });
  }
  if (requirement.kind === "net.fetch" || requirement.kind === "net.listen") {
    if (!isNet(requirement.scope)) {
      return fail("invalid_input", "net scope is required");
    }
    const checked = checkNet(requirement.kind, requirement.scope);
    if (!checked.ok) return checked;
    return ok({
      kind: requirement.kind,
      scope: requirement.scope,
      reason: requirement.reason,
    });
  }
  if (requirement.kind === "secret.use") {
    if (!("name" in requirement.scope)) {
      return fail("invalid_input", "secret scope is required");
    }
    return ok({
      kind: "secret.use",
      scope: { name: requirement.scope.name },
      reason: requirement.reason,
    });
  }
  if (!("key" in requirement.scope)) {
    return fail("invalid_input", "document scope is required");
  }
  return ok({
    kind: "document.save",
    scope: { key: requirement.scope.key },
    reason: requirement.reason,
  });
}

// 요구 목록을 정규 순서로 비교한다. 중복은 거절하고 순서는 결과에 영향을 주지 않는다.
export function canonicalOrder(
  requirements: readonly ResolvedRequirement[],
): Result<
  ResolvedRequirement[]
> {
  const seen = new Set<string>();
  for (const requirement of requirements) {
    const key = `${requirement.kind}:${JSON.stringify(requirement.scope)}`;
    if (seen.has(key)) {
      return fail("invalid_input", "duplicate permission scope");
    }
    seen.add(key);
  }
  return ok(
    [...requirements].sort((a, b) =>
      `${a.kind}:${JSON.stringify(a.scope)}`.localeCompare(
        `${b.kind}:${JSON.stringify(b.scope)}`,
      )
    ),
  );
}
