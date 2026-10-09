import { appBlueprint } from "../../packages/contracts/apps/mod.ts";
import {
  type ContextOutlineEntry,
  outlineContext,
  outlineDocument,
} from "../../packages/contracts/documents/mod.ts";
import type { MaterialSource } from "../../packages/lophn-agent/harness/prompt-assemble/mod.ts";
import { type CoreCall, readOf } from "./core-call.ts";

// preset이 고른 context의 초기 자료(prompt-assemble#R4). 항목마다 이 run의 agent 자격으로
// 다시 읽는다. 실패·권한 밖은 그 항목을 통째로 빼서 제목도 남기지 않는다. 본문은 넣지 않는다.
// 앱 command는 주소만 두고 호출하지 않는다. kind가 context가 아니면 자료를 더하지 않는다.
// context 이름이나 "all" 같은 선택 라벨이 읽기·앱 command 범위를 넓히지 않게 한다.

const PAGE_LIMIT = 8;

type Selection = { kind: string; target: string | null };

export async function contextMaterials(
  agent: CoreCall,
  selections: readonly Selection[],
): Promise<MaterialSource[]> {
  const sources: MaterialSource[] = [];
  const seen = new Set<string>();
  const reads = new Map<string, ReadonlySet<string> | null>();
  for (const selection of selections) {
    if (selection.kind !== "context" || selection.target === null) continue;
    if (seen.has(selection.target)) continue;
    seen.add(selection.target);
    const entries = await contextEntries(agent, selection.target);
    if (entries === null) continue;
    for (const entry of entries) {
      const source = await sourceOf(agent, entry, reads);
      if (source !== null) sources.push(source);
    }
  }
  return sources;
}

async function contextEntries(
  agent: CoreCall,
  context: string,
): Promise<ContextOutlineEntry[] | null> {
  const entries: ContextOutlineEntry[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    const read = await readOf(agent, outlineContext, {
      context,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!read.ok) return null;
    entries.push(...read.value.entries);
    if (read.value.complete || read.value.next_cursor === null) return entries;
    cursor = read.value.next_cursor;
  }
  return entries;
}

async function sourceOf(
  agent: CoreCall,
  entry: ContextOutlineEntry,
  reads: Map<string, ReadonlySet<string> | null>,
): Promise<MaterialSource | null> {
  if (!entry.readable) return null;
  if (entry.kind === "app_command") {
    const allowed = await readCommand(
      agent,
      reads,
      entry.target.app,
      entry.target.command,
    );
    if (!allowed) return null;
    return {
      target: entry.target,
      perspective: entry.perspective,
      title: "",
      version: null,
      summary: null,
      outline: [],
      changed: false,
      change_seq: null,
      sections: [],
    };
  }
  if (entry.latest_version === null) return null;
  const outline = await topOutline(
    agent,
    entry.target.document,
    entry.latest_version,
  );
  if (outline === null) return null;
  return {
    target: entry.target,
    perspective: entry.perspective,
    title: entry.title,
    version: outline.version,
    summary: null,
    outline: outline.sections,
    changed: false,
    change_seq: null,
    sections: [],
  };
}

// contexts.watch는 이 자격에 없다. 비교 없이 변경됨으로 두지 않는다.
async function topOutline(
  agent: CoreCall,
  document: string,
  version: string,
): Promise<
  {
    version: string;
    sections: { key: string; title: string; parent: null }[];
  } | null
> {
  const sections: { key: string; title: string; parent: null }[] = [];
  let readVersion: string | null = null;
  let cursor: string | undefined;
  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    const read = await readOf(agent, outlineDocument, {
      reference: { document, version, section: null },
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!read.ok) return null;
    readVersion ??= read.value.version;
    for (const section of read.value.entries) {
      if (section.parent !== null) continue;
      sections.push({
        key: section.key,
        title: section.title,
        parent: null,
      });
    }
    if (read.value.complete || read.value.next_cursor === null) {
      return readVersion === null ? null : { version: readVersion, sections };
    }
    cursor = read.value.next_cursor;
  }
  return readVersion === null ? null : { version: readVersion, sections };
}

// blueprint 읽기가 거절되거나 command가 read가 아니면 항목을 넣지 않는다.
async function readCommand(
  agent: CoreCall,
  reads: Map<string, ReadonlySet<string> | null>,
  app: string,
  command: string,
): Promise<boolean> {
  if (!reads.has(app)) {
    const read = await readOf(agent, appBlueprint, { app });
    reads.set(
      app,
      read.ok
        ? new Set(
          read.value.commands.filter((item) => item.effect === "read").map((
            item,
          ) => item.key),
        )
        : null,
    );
  }
  return reads.get(app)?.has(command) === true;
}
