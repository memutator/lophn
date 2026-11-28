import type { ReadDefinition } from "../../../protocol/server/mod.ts";
import { platformEntryUrl } from "../../install-and-update/mod.ts";
import { type ReaderRegistrationModule, readKey } from "./reads.ts";

export type ReaderReads = Map<
  string,
  { read: ReadDefinition; ports: ReadonlyMap<unknown, unknown> }
>;

type MaybeBundledReaderModule = ReaderRegistrationModule & {
  BUNDLED_TEAM_MODULES?: readonly ReaderRegistrationModule[];
};

function expandReaderModules(
  loaded: readonly MaybeBundledReaderModule[],
): ReaderRegistrationModule[] {
  return loaded.flatMap((mod) =>
    Array.isArray(mod.BUNDLED_TEAM_MODULES) ? mod.BUNDLED_TEAM_MODULES : [mod],
  );
}

// core가 reader Worker에 건넬 등록 module이다. ledger 자신의 read 등록이 먼저이고, createReaderRegistration을
// 내보내는 팀 module이 그 뒤다. read 없이 환경만 놓는 module도 그 export로 reader에 들어간다.
export async function readerModulesOf(
  modules: readonly string[],
): Promise<URL[]> {
  const found = [platformEntryUrl(import.meta.url, "readerRegistration")];
  const loaded = (await Promise.all(
    modules.map((url) => import(url)),
  )) as MaybeBundledReaderModule[];
  for (let i = 0; i < modules.length; i += 1) {
    const mod = loaded[i];
    const hasReader =
      mod !== undefined &&
      expandReaderModules([mod]).some(
        (entry) => typeof entry?.createReaderRegistration === "function",
      );
    if (hasReader) {
      found.push(new URL(modules[i]!));
    }
  }
  return found;
}

// reader Worker가 건네받은 module마다 등록을 만들어 read와 port를 모은다. writer의 tx port처럼 어느 등록이 낸 port든
// 모든 read가 쓴다. 같은 port key나 read 경로를 두 곳에서 등록하면 조용히 덮이지 않게 기동 때 던진다.
// `own`은 Worker가 자기 closure에 든 port(알려진 secret matcher)다.
export async function composeReaderReads(
  modules: readonly string[],
  own: ReadonlyMap<unknown, unknown>,
): Promise<ReaderReads> {
  const raw = (await Promise.all(
    modules.map((url) => import(url)),
  )) as MaybeBundledReaderModule[];
  const loaded = expandReaderModules(raw);
  const registrations = loaded.flatMap((module) =>
    module.createReaderRegistration ? [module.createReaderRegistration()] : [],
  );
  const shared = new Map<unknown, unknown>();
  for (const registration of registrations) {
    for (const [key, port] of registration.ports) {
      if (shared.has(key)) {
        throw new Error(
          `duplicate reader port ${(key as { name: string }).name}`,
        );
      }
      shared.set(key, port);
    }
  }
  const ports = new Map([...shared, ...own]);
  const reads: ReaderReads = new Map();
  for (const registration of registrations) {
    for (const read of registration.reads) {
      const key = readKey(read.route);
      if (reads.has(key)) throw new Error("duplicate read registration");
      reads.set(key, { read, ports });
    }
  }
  return reads;
}
