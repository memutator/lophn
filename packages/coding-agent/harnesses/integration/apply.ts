// 설치·갱신·제거 engine이다(coding-agent/harnesses#R6–R9, T29). plan이 고른
// exact target만 쓰고, receipt의 소유 증거와 계획 때 읽은 hash를 교체 직전에
// 다시 비교한다(R7). 쓰기는 같은 폴더 temp·fsync·rename이고 resource별 결과를
// 낸다(R9). receipt 저장 실패는 partial과 recovery journal로 남고 복구 전
// 다음 갱신을 거절한다(R9). home root는 인자로 받는다. 고정 HOME을 읽지 않는다.
import { fingerprint, sha256Hex } from "../../../base/mod.ts";
import type {
  ReceiptOutcome,
  ResourceInstallResult,
} from "../../../contracts/coding-agent/mod.ts";
import * as json from "../adapters/json.ts";
import * as toml from "../adapters/toml.ts";
import * as yaml from "../adapters/yaml.ts";
import type { InstallPlan, PlannedResource } from "./plan.ts";
import { persist } from "./remove.ts";
import type { Digest, Journal, OwnedResource, Receipt } from "./receipt.ts";

// 파일 눈이다. 테스트가 fixture home으로 끼운다. symlink는 따라가지 않고
// 그 사실만 보고한다(R7, 조사 9.7).
export type FilePort = {
  // 파일이 있으면 내용, 없으면 null이다. symlink면 "symlink"다.
  read(path: string): Promise<
    | { kind: "file"; text: string }
    | { kind: "absent" }
    | { kind: "symlink" }
    | {
      kind: "error";
    }
  >;
  // 같은 폴더 temp·fsync·rename으로 바꾼다. 폴더가 없으면 만든다.
  writeAtomic(path: string, text: string): Promise<boolean>;
  // 디렉터리를 만들고 파일을 쓴다. skill 설치가 쓴다(guides#R4).
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
  // receipt 저장까지 됐으면 true다. 하나라도 실패면 false다(R9).
  receipt_stored: boolean;
  // journal에 복구가 남아 있으면 true다. 다음 갱신을 거절하는 근거다(R9).
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
  return await sha256Hex(read.text);
}

// plan을 만들기 전에 현재 파일 hash를 읽는다(R7). 설치는 이 값을 교체 직전에
// 다시 비교해 그 사이 사람 수정을 덮지 않는다.
export async function observe(
  port: FilePort,
  root: string,
  plan: InstallPlan,
): Promise<ObservedHashes | "blocked"> {
  const hashes = new Map<string, Digest>();
  for (const resource of plan.resources) {
    const read = await hashOf(port, join(root, resource.path));
    if (read === "symlink" || read === "error") return "blocked";
    if (read !== null) hashes.set(resource.path, read);
  }
  return hashes;
}

// 소유 조각의 digest다(R7). 파일이 없거나 조각이 없으면 빈 digest다.
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
  const read = resource.format === "json"
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

// 쓸 본문을 만든다. config는 소유 key만 merge하고 나머지는 보존한다(R8).
function merged(
  current: string | null,
  resource: PlannedResource,
): { kind: "text"; text: string } | { kind: "unchanged" } | { kind: "broken" } {
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
  const set = resource.format === "json"
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

// 설치·갱신이다(R6–R9). journal에 복구가 남아 있으면 거절한다(R9).
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
  const owned: OwnedResource[] = [];
  for (const resource of plan.resources) {
    const outcome = await writeResource(
      port,
      root,
      resource,
      observed,
      receipt,
    );
    results.push(outcome.result);
    if (outcome.owned) owned.push(outcome.owned);
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
  const now = text === null ? null : await sha256Hex(text);
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
  // 파일이 있는데 receipt가 없으면, 소유 조각이 이미 있을 때만 conflict다.
  // 조각이 없으면 사람이 쓰던 설정에 lophn key만 더하는 merge다(R8). 파일 전체를
  // 소유하는 resource(skill·지침)는 동명 파일이 있으면 항상 conflict다(R7).
  if (text !== null && previous === undefined) {
    const fragment = resource.owned_key === null
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
  if (previous !== undefined && text !== null) {
    const digest = await fragmentDigest(text, resource);
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
    ? await treeHash(resource.content)
    : await sha256Hex(next.text);
  const digest = await fragmentDigest(
    Array.isArray(resource.content) ? null : next.text,
    resource,
  );
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

async function treeHash(
  files: readonly { path: string; content: string }[],
): Promise<Digest> {
  const body = files.map((file) => `${file.path}\n${file.content}`).join("\n");
  return await sha256Hex(body);
}
