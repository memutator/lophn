import { createHash } from "node:crypto";
import { dirname, isAbsolute } from "node:path";
import { err, ok, type Result } from "../../../base/mod.ts";
import { idSchema } from "../../../protocol/base/ids.ts";
import { type AgentId, isLophn } from "../../../protocol/lophn-agent/mod.ts";
import { parseAgentFile, serializeAgentFile } from "./definition-file.ts";
import type { RemoteAppLine } from "./directory.ts";
import type { AgentFileSystem, ReadSql } from "./ports.ts";

// 정의 파일을 lophn data root 아래에서 읽고 쓰는 저장소다. 정의는 project나 앱 폴더가 아니라 lophn data의
// `agents/`에 둔다. 파일 IO는 port로 받는다. hash는 파일 글의 sha256이고 CAS가 이것을 비교한다.

export type AgentSlot = { folder: string; file: string };

function fileHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export type AgentFile = { text: string; hash: string };

export type AgentStore = {
  root: string;
  read(slot: AgentSlot): Result<AgentFile | null>;
  // 쓴 글의 hash를 돌려준다.
  write(slot: AgentSlot, text: string): Result<string>;
  remove(slot: AgentSlot): Result<void>;
  // 폴더 안의 파일 이름에서 뺀 `agt_...` id들(이름순).
  agentIds(): Result<string[]>;
};

function unavailable(what: string): Result<never> {
  return err({
    code: "unavailable",
    message: `agent file could not be ${what}`,
  });
}

export function createAgentStore(
  files: AgentFileSystem,
  root: string,
): AgentStore {
  const folder = `${root}/agents`;
  const pathOf = (slot: AgentSlot) => `${slot.folder}/${slot.file}`;
  return {
    root,
    read(slot) {
      try {
        const text = files.read(pathOf(slot));
        return ok(text === null ? null : { text, hash: fileHash(text) });
      } catch {
        return unavailable("read");
      }
    },
    write(slot, text) {
      try {
        files.writeAtomic(pathOf(slot), text);
        return ok(fileHash(text));
      } catch {
        return unavailable("written");
      }
    },
    remove(slot) {
      try {
        files.remove(pathOf(slot));
        return ok(undefined);
      } catch {
        return unavailable("removed");
      }
    },
    agentIds() {
      try {
        const ids = files
          .list(folder)
          .filter(
            (name) =>
              name.endsWith(".md") &&
              idSchema("agt").safeParse(name.slice(0, -3)).success,
          )
          .map((name) => name.slice(0, -3));
        return ok(ids.sort());
      } catch {
        return unavailable("listed");
      }
    },
  };
}

export function agentSlotOf(root: string, id: string): AgentSlot {
  return { folder: `${root}/agents`, file: `${id}.md` };
}

// agent memory 파일. 사람이 만든 agent마다 하나다. `<data>/agents/*.md`(정의)를 훑는 옛 data step과 섞이지 않게
// 폴더를 따로 둔다. agent를 지우면 함께 지운다.
export function agentMemoryFile(root: string, agentId: string): string {
  return `${root}/agent-memory/${agentId}.md`;
}

// 코드가 data root를 따로 받지 않으면 ledger 파일이 있는 폴더가 data root다(reader도 같은 파일을 연다).
export function dataRootOf(
  sql: ReadSql,
  fixed: string | undefined,
): Result<string> {
  if (fixed !== undefined) return ok(fixed);
  const row = sql.get(
    "select file from pragma_database_list where name = 'main'",
    [],
  );
  const file = row?.["file"];
  // 메모리 DB는 빈 이름이다. Windows 경로는 `\`로 나뉘어 `/`로 자르지 않는다.
  if (typeof file !== "string" || !isAbsolute(file)) {
    return err({ code: "unavailable", message: "ledger location is unknown" });
  }
  return ok(dirname(file));
}

// 할당(`apps`, `remote_apps`, `permissions.deny`, `permissions.ask`)만 바꿔 정의 파일에 다시 쓴다. 다른 칸과 본문은 그대로다.
// 파일이 없는 agent는 쓰지 않는다(할당은 정의가 있는 agent의 것이다). lophn은 파일이 없어도 기본 정의가 있다.
export function writeAgentAssignment(
  store: AgentStore,
  agent: AgentId,
  assignment: {
    apps: readonly string[];
    deny: readonly string[];
    ask?: readonly string[];
    remoteApps: readonly RemoteAppLine[];
  },
): Result<string> {
  const slot = agentSlotOf(store.root, agent);
  const read = store.read(slot);
  if (!read.ok) return read;
  // 파일이 없는 lophn은 기본 정의다.
  const current = read.value?.text ?? (isLophn(agent) ? "" : null);
  if (current === null) {
    return err({ code: "not_found", message: "agent not found" });
  }
  const parsed = parseAgentFile(current, { agent });
  if (!parsed.ok) return parsed;
  const ask = assignment.ask ?? parsed.value.permissions?.ask ?? [];
  const text = serializeAgentFile(
    {
      ...parsed.value,
      apps: [...assignment.apps],
      remote_apps: assignment.remoteApps.map((line) => ({
        machine: line.machine,
        app: line.app,
        name: line.name,
        removed: [...line.removed],
        ...(line.ask && line.ask.length > 0 ? { ask: [...line.ask] } : {}),
      })),
      permissions: {
        deny: [...assignment.deny],
        ...(ask.length > 0 ? { ask: [...ask] } : {}),
      },
    },
    { agent },
  );
  if (!text.ok) return text;
  return store.write(slot, text.value);
}
