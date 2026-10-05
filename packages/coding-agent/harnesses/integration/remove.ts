// 제거와 receipt 복구다(coding-agent/harnesses#R7, R9, T29). 제거는 receipt에
// 있는 resource만 지우고 사람이 고친 것은 conflict로 보존한다(R7). receipt
// 저장이 실패하면 journal에 남기고, 복구는 hash를 다시 확인해 무조건
// 재설치하지 않는다(R9).
import { sha256Hex } from "../../../base/mod.ts";
import type { ResourceInstallResult } from "../../../contracts/coding-agent/mod.ts";
import {
  type ApplyResult,
  type FilePort,
  fragmentDigest,
  join,
  removed,
  result,
  type Store,
} from "./apply.ts";
import type { InstallPlan, PlannedResource } from "./plan.ts";
import type { JournalEntry, OwnedResource, Receipt } from "./receipt.ts";
import { RECEIPT_SCHEMA_VERSION } from "./receipt.ts";

// receipt를 저장한다(R9). 실패하면 journal에 남기고 다음 갱신을 막는다.
export async function persist(
  store: Store,
  plan: InstallPlan,
  owned: readonly OwnedResource[],
  results: ResourceInstallResult[],
  operationId: string,
  writtenAt: string,
): Promise<ApplyResult> {
  const changed = results.some((item) => item.outcome === "changed");
  if (!changed && owned.length === 0) {
    return {
      resources: results,
      receipt_stored: false,
      recovery_pending: false,
    };
  }
  const distribution = await sha256Hex(
    results.map((item) => item.resource_identity).join("\n"),
  );
  const receipt: Receipt = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    target: plan.target,
    connection: plan.connection,
    catalog_revision: plan.catalog_revision,
    adapter_revision: plan.adapter_revision,
    distribution_hash: distribution,
    resources: [...owned],
    operation_id: operationId,
    written_at: writtenAt,
  };
  const stored = await store.saveReceipt(receipt);
  if (stored) {
    return {
      resources: results.map((item) => ({
        ...item,
        receipt_stored: item.outcome === "changed",
      })),
      receipt_stored: true,
      recovery_pending: false,
    };
  }
  const entry: JournalEntry = {
    operation_id: operationId,
    target: plan.target,
    written_hash: distribution,
    path: plan.target.harness_id,
    reason: "receipt_store_failed",
    written_at: writtenAt,
  };
  const journal = await store.journal();
  await store.saveJournal({ entries: [...journal.entries, entry] });
  return { resources: results, receipt_stored: false, recovery_pending: true };
}

// 제거다(R7). receipt에 있는 resource만 지우고, 사람이 고친 것은 conflict다.
export async function remove(
  port: FilePort,
  store: Store,
  root: string,
  plan: InstallPlan,
  operationId: string,
  writtenAt: string,
): Promise<ApplyResult> {
  const journal = await store.journal();
  if (journal.entries.length > 0) {
    return {
      resources: plan.resources.map((resource) =>
        result(resource.identity, "skipped", false, "복구 전 제거를 거절한다")
      ),
      receipt_stored: false,
      recovery_pending: true,
    };
  }
  const receipt = await store.receipt(plan.target);
  const results: ResourceInstallResult[] = [];
  const remaining: OwnedResource[] = [...(receipt?.resources ?? [])];
  for (const resource of plan.resources) {
    const owned = remaining.find((item) =>
      item.canonical_identity === resource.identity
    );
    if (owned === undefined) {
      results.push(result(
        resource.identity,
        "skipped",
        false,
        "receipt에 없는 resource는 지우지 않는다",
      ));
      continue;
    }
    const outcome = await removeResource(port, root, resource, owned);
    results.push(outcome);
    if (outcome.outcome === "changed") {
      const index = remaining.indexOf(owned);
      if (index >= 0) remaining.splice(index, 1);
    }
  }
  return await persist(store, plan, remaining, results, operationId, writtenAt);
}

async function removeResource(
  port: FilePort,
  root: string,
  resource: PlannedResource,
  owned: OwnedResource,
): Promise<ResourceInstallResult> {
  const path = join(root, resource.path);
  const current = await port.read(path);
  if (current.kind === "symlink") {
    return result(
      resource.identity,
      "conflict",
      false,
      "외부 symlink는 지우지 않는다",
    );
  }
  if (current.kind === "absent") {
    return result(resource.identity, "unchanged", false, "이미 없다");
  }
  if (current.kind === "error") {
    return result(resource.identity, "failed", false, "파일을 읽지 못했다");
  }
  const digest = await fragmentDigest(current.text, resource);
  if (digest === "broken" || digest !== owned.owned_fragment_digest) {
    return result(
      resource.identity,
      "conflict",
      false,
      "사람이 고친 resource는 보존한다",
    );
  }
  if (resource.owned_key === null || resource.format === "directory") {
    const gone = await port.remove(path);
    return gone
      ? result(resource.identity, "changed", false, "지웠다")
      : result(resource.identity, "failed", false, "지우기에 실패했다");
  }
  const next = removed(current.text, resource);
  if (next.kind === "broken") {
    return result(
      resource.identity,
      "conflict",
      false,
      "깨진 설정은 고치지 않는다",
    );
  }
  if (next.kind === "unchanged") {
    return result(
      resource.identity,
      "unchanged",
      false,
      "소유 조각이 이미 없다",
    );
  }
  const wrote = await port.writeAtomic(path, next.text);
  return wrote
    ? result(resource.identity, "changed", false, "소유 조각만 지웠다")
    : result(resource.identity, "failed", false, "쓰기에 실패했다");
}

// journal을 비운다(R9). 복구는 hash를 다시 확인하고 무조건 재설치하지 않는다.
// 파일이 journal의 hash와 같으면 receipt만 다시 저장하고, 다르면 보존한다.
export async function recover(
  store: Store,
  receipt: Receipt | null,
): Promise<{ recovered: boolean; preserved: boolean }> {
  const journal = await store.journal();
  if (journal.entries.length === 0) {
    return { recovered: false, preserved: false };
  }
  if (receipt === null) return { recovered: false, preserved: true };
  const matches = journal.entries.every((entry) =>
    entry.written_hash === receipt.distribution_hash
  );
  if (!matches) return { recovered: false, preserved: true };
  const stored = await store.saveReceipt(receipt);
  if (!stored) return { recovered: false, preserved: true };
  await store.saveJournal({ entries: [] });
  return { recovered: true, preserved: false };
}
