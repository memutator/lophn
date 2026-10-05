// 설치·갱신 engine이다(coding-agent/harnesses#R6–R9, T29). plan의 exact target만
// 쓰고, 교체 직전에 hash를 다시 비교한다(R7). 쓰기는 temp·fsync·rename이고
// resource별 결과를 낸다(R9). home root는 인자로 받는다. 고정 HOME은 없다.
import { fingerprint, sha256Hex } from "../../../base/mod.ts";
import type {
  ReceiptOutcome,
  ResourceInstallResult,
} from "../../../contracts/coding-agent/mod.ts";
import * as json from "../adapters/json.ts";
import * as region from "../adapters/region.ts";
import * as toml from "../adapters/toml.ts";
import * as yaml from "../adapters/yaml.ts";
import type { InstallPlan, PlannedResource } from "./plan.ts";
import { persist } from "./remove.ts";
import type { Digest, Journal, OwnedResource, Receipt } from "./receipt.ts";
import { plannedDigest, treeDigest } from "./tree.ts";

// 파일 눈이다. fixture home을 끼운다. symlink는 따라가지 않는다(R7). 디렉터리를
// error로 뭉개면 skill 재설치가 막힌다(guides#R4).
export type FilePort = {
  read(path: string): Promise<
    | { kind: "file"; text: string }
    | { kind: "directory" }
    | { kind: "absent" }
    | { kind: "symlink" }
    | { kind: "error" }
  >;
  listFiles(dir: string): Promise<
    | { kind: "files"; files: readonly { path: string; text: string }[] }
    | { kind: "symlink"; path: string }
    | { kind: "error" }
  >;
  escapes(root: string, path: string): Promise<boolean>;
  writeAtomic(path: string, text: string): Promise<boolean>;
  writeTree(
    dir: string,
    files: readonly { path: string; content: string }[],
  ): Promise<boolean>;
  remove(path: string): Promise<boolean>;
};

export type Store = {
  receipt(target: InstallPlan["target"]): Promise<Receipt | null>;
  saveReceipt(receipt: Receipt): Promise<boolean>;
  journal(): Promise<Journal>;
  saveJournal(journal: Journal): Promise<boolean>;
};

export type ApplyResult = {
  resources: ResourceInstallResult[];
  receipt_stored: boolean;
  recovery_pending: boolean;
};

const EMPTY_HASH = "0".repeat(64);

export function result(
  identity: string,
  outcome: ReceiptOutcome,
  stored: boolean,
  reason: string,
): ResourceInstallResult {
  return {
    resource_identity: identity,
    outcome,
    receipt_stored: stored,
    reason,
  };
}

// 계획 때 읽은 파일 hash다. 교체 직전에 다시 읽어 비교한다(R7).
export type ObservedHashes = ReadonlyMap<string, Digest>;

async function hashOf(
  port: FilePort,
  path: string,
): Promise<Digest | "symlink" | "error" | null> {
  const read = await port.read(path);
  if (read.kind === "absent") return null;
  if (read.kind === "symlink") return "symlink";
  if (read.kind === "error") return "error";
  if (read.kind === "directory") return await directoryHash(port, path);
  return await sha256Hex(read.text);
}

async function directoryHash(
  port: FilePort,
  dir: string,
): Promise<Digest | "symlink" | "error"> {
  const listed = await port.listFiles(dir);
  if (listed.kind === "symlink") return "symlink";
  if (listed.kind === "error") return "error";
  return await treeDigest(listed.files);
}

export async function observe(
  port: FilePort,
  root: string,
  plan: InstallPlan,
): Promise<ObservedHashes | "blocked"> {
  const hashes = new Map<string, Digest>();
  for (const resource of plan.resources) {
    const path = join(root, resource.path);
    if (await port.escapes(root, path)) return "blocked";
    const read = await hashOf(port, path);
    if (read === "symlink" || read === "error") return "blocked";
    if (read !== null) hashes.set(resource.path, read);
  }
  return hashes;
}

export async function fragmentDigest(
  text: string | null,
  resource: PlannedResource,
): Promise<Digest | "broken"> {
  if (text === null || resource.owned_key === null) {
    return text === null ? EMPTY_HASH : await sha256Hex(text);
  }
  const fragment = fragmentOf(text, resource);
  if (fragment === "broken") return "broken";
  return await fingerprint(fragment);
}

function fragmentOf(
  text: string,
  resource: PlannedResource,
): unknown | "broken" {
  const key = resource.owned_key;
  if (key === null) return text;
  const read = resource.format === "text"
    ? region.regionFragment(text)
    : resource.format === "json"
    ? json.ownedFragment(text, key)
    : resource.format === "toml"
    ? toml.ownedFragment(text, key)
    : resource.format === "yaml"
    ? yaml.ownedFragment(text, key)
    : null;
  if (read === null) return text;
  if (!read.ok) return "broken";
  return read.value;
}

function merged(
  current: string | null,
  resource: PlannedResource,
): { kind: "text"; text: string } | { kind: "unchanged" } | { kind: "broken" } {
  if (resource.format === "text" && resource.owned_key !== null) {
    const body = typeof resource.content === "string" ? resource.content : "";
    const set = region.setRegion(current ?? "", body);
    if (set.kind === "broken") return { kind: "broken" };
    if (set.kind === "unchanged") return { kind: "unchanged" };
    return { kind: "text", text: set.text };
  }
  if (resource.format === "directory" || resource.format === "text") {
    const text = typeof resource.content === "string" ? resource.content : "";
    return current === text ? { kind: "unchanged" } : { kind: "text", text };
  }
  const value = typeof resource.content === "string"
    ? JSON.parse(resource.content)
    : {};
  const base = current ?? (resource.format === "toml" ? "" : "{}\n");
  const set = resource.format === "json"
    ? json.setOwned(base, resource.owned_key ?? "", value)
    : resource.format === "toml"
    ? toml.setOwned(base, resource.owned_key ?? "", value)
    : yaml.setOwned(base, resource.owned_key ?? "", value);
  if (set.kind === "broken") return { kind: "broken" };
  if (set.kind === "unchanged") return { kind: "unchanged" };
  return { kind: "text", text: set.text };
}

export function removed(
  current: string,
  resource: PlannedResource,
): { kind: "text"; text: string } | { kind: "unchanged" } | { kind: "broken" } {
  if (resource.owned_key === null) return { kind: "text", text: "" };
  const set = resource.format === "text"
    ? region.removeRegion(current)
    : resource.format === "json"
    ? json.removeOwned(current, resource.owned_key)
    : resource.format === "toml"
    ? toml.removeOwned(current, resource.owned_key)
    : resource.format === "yaml"
    ? yaml.removeOwned(current, resource.owned_key)
    : { kind: "unchanged" as const };
  if (set.kind === "broken") return { kind: "broken" };
  if (set.kind === "unchanged") return { kind: "unchanged" };
  return { kind: "text", text: set.text };
}

export function join(root: string, path: string): string {
  return `${root}/${path}`;
}

export async function install(
  port: FilePort,
  store: Store,
  root: string,
  plan: InstallPlan,
  observed: ObservedHashes,
  operationId: string,
  writtenAt: string,
): Promise<ApplyResult> {
  const journal = await store.journal();
  if (journal.entries.length > 0) {
    return {
      resources: plan.resources.map((resource) =>
        result(resource.identity, "skipped", false, "복구 전 갱신을 거절한다")
      ),
      receipt_stored: false,
      recovery_pending: true,
    };
  }
  const receipt = await store.receipt(plan.target);
  const results: ResourceInstallResult[] = [];
  // 한 target을 root별 plan 여러 개로 나눠 설치해도(Codex config는 CODEX_HOME,
  // skill은 home) 앞 plan의 소유 기록이 남도록 이 plan 밖 resource는 이어 둔다.
  const owned: OwnedResource[] = (receipt?.resources ?? []).filter((item) =>
    !plan.resources.some((planned) =>
      planned.identity === item.canonical_identity
    )
  );
  // 같은 파일의 소유 조각이 둘 이상이면(Gemini settings의 mcp와 context) 앞
  // resource가 쓴 hash를 다음 resource의 기준으로 이어 준다. 계획 뒤 사람이
  // 바꾼 파일은 여전히 conflict다.
  const seen = new Map(observed);
  for (const resource of plan.resources) {
    const outcome = await writeResource(
      port,
      root,
      resource,
      seen,
      receipt,
    );
    results.push(outcome.result);
    if (outcome.owned) owned.push(outcome.owned);
    if (outcome.result.outcome === "changed" && outcome.owned) {
      seen.set(resource.path, outcome.owned.last_written_hash);
    }
  }
  return await persist(store, plan, owned, results, operationId, writtenAt);
}

async function writeResource(
  port: FilePort,
  root: string,
  resource: PlannedResource,
  observed: ObservedHashes,
  receipt: Receipt | null,
): Promise<{ result: ResourceInstallResult; owned: OwnedResource | null }> {
  const path = join(root, resource.path);
  if (await port.escapes(root, path)) {
    return {
      result: result(
        resource.identity,
        "conflict",
        false,
        "경로가 root 밖을 가리킨다",
      ),
      owned: null,
    };
  }
  const current = await port.read(path);
  if (current.kind === "symlink") {
    return {
      result: result(
        resource.identity,
        "conflict",
        false,
        "외부 symlink는 쓰지 않는다",
      ),
      owned: null,
    };
  }
  if (current.kind === "error") {
    return {
      result: result(resource.identity, "failed", false, "파일을 읽지 못했다"),
      owned: null,
    };
  }
  const text = current.kind === "file" ? current.text : null;
  const now = current.kind === "directory"
    ? await directoryHash(port, path)
    : text === null
    ? null
    : await sha256Hex(text);
  if (now === "symlink" || now === "error") {
    return {
      result: result(
        resource.identity,
        "conflict",
        false,
        "디렉터리 안 symlink는 쓰지 않는다",
      ),
      owned: null,
    };
  }
  const seen = observed.get(resource.path) ?? null;
  if (now !== seen) {
    return {
      result: result(
        resource.identity,
        "conflict",
        false,
        "계획 뒤 파일이 바뀌었다",
      ),
      owned: null,
    };
  }
  const previous = receipt?.resources.find((item) =>
    item.canonical_identity === resource.identity
  );
  const present = text !== null || current.kind === "directory";
  if (present && previous === undefined) {
    const fragment = resource.owned_key === null || text === null
      ? "present"
      : fragmentOf(text, resource);
    if (fragment === "broken") {
      return {
        result: result(
          resource.identity,
          "conflict",
          false,
          "깨진 설정은 고치지 않는다",
        ),
        owned: null,
      };
    }
    if (fragment !== null) {
      return {
        result: result(
          resource.identity,
          "conflict",
          false,
          "receipt 없는 동명 resource는 덮지 않는다",
        ),
        owned: null,
      };
    }
  }
  if (
    previous !== undefined && (text !== null || current.kind === "directory")
  ) {
    const digest = current.kind === "directory"
      ? await directoryHash(port, path)
      : await fragmentDigest(text, resource);
    if (digest === "broken" || digest !== previous.owned_fragment_digest) {
      return {
        result: result(
          resource.identity,
          "conflict",
          false,
          "사람이 소유 조각을 고쳤다",
        ),
        owned: null,
      };
    }
  }
  if (Array.isArray(resource.content)) {
    const planned = await plannedDigest(resource.content);
    if (planned === now) {
      return {
        result: result(
          resource.identity,
          "unchanged",
          false,
          "이미 같은 내용이다",
        ),
        owned: previous ?? null,
      };
    }
  }
  const next = merged(text, resource);
  if (next.kind === "broken") {
    return {
      result: result(
        resource.identity,
        "conflict",
        false,
        "깨진 설정은 고치지 않는다",
      ),
      owned: null,
    };
  }
  if (next.kind === "unchanged") {
    return {
      result: result(
        resource.identity,
        "unchanged",
        false,
        "이미 같은 내용이다",
      ),
      owned: previous ?? null,
    };
  }
  const wrote = Array.isArray(resource.content)
    ? await port.writeTree(path, resource.content)
    : await port.writeAtomic(path, next.text);
  if (!wrote) {
    return {
      result: result(resource.identity, "failed", false, "쓰기에 실패했다"),
      owned: null,
    };
  }
  const written = Array.isArray(resource.content)
    ? await plannedDigest(resource.content)
    : await sha256Hex(next.text);
  const digest = Array.isArray(resource.content)
    ? written
    : await fragmentDigest(next.text, resource);
  return {
    result: result(resource.identity, "changed", false, "썼다"),
    owned: {
      canonical_identity: resource.identity,
      path: resource.path,
      owned_key: resource.owned_key,
      last_written_hash: written,
      owned_fragment_digest: digest === "broken" ? written : digest,
      topology: resource.format === "directory" ? "directory" : "file",
    },
  };
}
