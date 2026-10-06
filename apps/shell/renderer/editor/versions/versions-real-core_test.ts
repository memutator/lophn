// 실제 core 위의 버전 이력·복원(shell#T18, flow restore-document). fake core는 이력·준비·복원
// 명령의 응답 모양을 잘못 흉내 내도 통과하므로 temp LOPHN_HOME core를 띄우고, renderer의 버전
// 통로(coreVersionSource)와 main의 복원 통로(createRestorer·coreRestorePort)를 그대로 잇는다.
// Electron IPC는 빠진다. 사람 데이터 root(~/.lophn)와 실제 사람 폴더는 열지 않는다.
import { assert, assertEquals } from "@std/assert";

import {
  coreFilesPort,
  coreRestorePort,
} from "../../../main/editor/core-port.ts";
import {
  createFileAdapter,
  sha256,
} from "../../../main/editor/file-adapter.ts";
import { createRestorer } from "../../../main/editor/restore.ts";
import { coreLauncherSource } from "../../desktop/launcher/core-source.ts";
import { shortNameOf } from "../../desktop/launcher/model.ts";
import { newId } from "../../desktop/lophn-space/model.ts";
import { type RealCore, startRealCore } from "../../testdata/real-core.ts";
import { coreTrackingSource } from "../../workspace/tracking/core-source.ts";
import { coreEditorSource } from "../core-source.ts";
import { coreVersionSource } from "./core-source.ts";

const encoder = new TextEncoder();

async function until<T>(
  label: string,
  read: () => Promise<T | undefined>,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await read();
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error(`기다림 초과: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function versionsOf(core: RealCore) {
  const restorer = createRestorer({
    port: () => coreRestorePort(core.mainCalls),
    log: () => {},
  });
  return coreVersionSource(
    core.source,
    coreEditorSource(core.source),
    { restore: (input) => restorer.restore(input) },
  );
}

async function register(core: RealCore, folder: string): Promise<string> {
  const id = newId("prj");
  const registered = await coreLauncherSource(core.source, undefined)
    .register({
      id,
      name: shortNameOf("Plans", []),
      title: "Plans",
      purpose: "",
      folders: [{ path: folder, description: "Plans" }],
    });
  assert(registered.ok, JSON.stringify(registered));
  return id;
}

Deno.test({
  name:
    "shell/editor#R6 shell/editor#R14: 실제 core에서 원본 연결 문서의 이력을 새 판부터 읽고, 옛 판 복원은 파일을 쓰고 새 최신 판을 만들며 다시 하면 변경 없음이다",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const folder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-editor-versions-" }),
    );
    const file = `${folder}/plan.md`;
    const first = "# Plan\n\n## Goal\n\nfirst\n";
    const second = "# Plan\n\n## Goal\n\nsecond\n";
    await Deno.writeTextFile(file, first);
    const core = await startRealCore();
    try {
      const project = await register(core, folder);
      const tracking = coreTrackingSource(core.source);
      const read = await tracking.project(project);
      assert(read.ok, JSON.stringify(read));
      const preview = await tracking.preview(read.value, read.value.proposal);
      assert(preview.ok, JSON.stringify(preview));
      assert((await tracking.apply(read.value, preview.value)).ok);
      const document = await until("문서", async () => {
        const listed = await core.source.call({
          kind: "read",
          resource: "documents",
          method: "list",
          body: {},
        });
        if (!listed.ok) return undefined;
        const rows = (listed.value as {
          documents: { document: { id: string } }[];
        }).documents;
        return rows[0]?.document.id;
      });

      // 편집기 저장 흐름으로 두 번째 판을 만든다(파일 쓰기 → 관측 → 판).
      const adapter = createFileAdapter({
        port: () => coreFilesPort(core.mainCalls),
        log: () => {},
      });
      const opened = await adapter.open(1, document);
      assert(opened.ok, JSON.stringify(opened));
      const wrote = await adapter.write(1, {
        session: opened.value.session,
        request_key: "versions-edit-0000000001",
        base_hash: opened.value.base_hash,
        bytes: encoder.encode(second),
        end: true,
      });
      assert(wrote.ok && wrote.value.disk === "written", JSON.stringify(wrote));

      const versions = versionsOf(core);
      const history = await until("두 판", async () => {
        const rows = await versions.history(document);
        return rows.ok && rows.value.length === 2 ? rows.value : undefined;
      });
      // 새 판이 위다. 파일 관측으로 생긴 판이고 경로별 원문이 있어 되살릴 수 있다.
      assertEquals(history.map((row) => row.number), [2, 1]);
      assertEquals(history.map((row) => row.savedBy), ["machine", "machine"]);
      assert(history.every((row) => row.fromFile && row.restorable));
      const facts = await versions.facts(document);
      assert(facts.ok, JSON.stringify(facts));
      assertEquals(facts.value.linked, true);
      assertEquals(facts.value.latestNumber, 2);
      assertEquals(facts.value.primaryPath, "plan.md");
      const contexts = await versions.contexts(document);
      assertEquals(contexts, { ok: true, value: [] });

      // 1번 판을 되살린다: 원본 파일에 1번 바이트를 쓰고 그 관측으로 새 최신 판이 선다.
      const restored = await versions.restore(document, history[1]!.id);
      assert(restored.ok, JSON.stringify(restored));
      assertEquals(restored.value.outcome, "saved");
      assertEquals(restored.value.file, "written");
      assertEquals(await Deno.readTextFile(file), first);
      const after = await versions.history(document);
      assert(after.ok, JSON.stringify(after));
      assertEquals(after.value.map((row) => row.number), [3, 2, 1]);
      assertEquals(after.value[0]!.id, restored.value.version);
      assertEquals(after.value[0]!.savedBy, "user");
      assertEquals(after.value[0]!.contentHash, history[1]!.contentHash);

      // 같은 판을 다시 되살리면 파일도 판도 그대로다.
      const again = await versions.restore(document, history[1]!.id);
      assert(again.ok, JSON.stringify(again));
      assertEquals(again.value, {
        outcome: "unchanged",
        version: restored.value.version,
        file: "same",
        failure: null,
      });
      const last = await versions.history(document);
      assert(last.ok);
      assertEquals(last.value.length, 3);
    } catch (error) {
      throw new Error(
        `${(error as Error).message}\n--- core ---\n${core.log()}`,
      );
    } finally {
      await core.stop();
      await Deno.remove(folder, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "shell/editor#R14: 실제 core에서 검사 한도(1 MiB)를 넘는 명시 format 판도 같은 바이트·FormatRef의 새 최신 판으로 되살린다",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const folder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-editor-big-" }),
    );
    const core = await startRealCore();
    const calls = core.mainCalls;
    try {
      const project = await register(core, folder);
      const big = `# Plan\n\n${"한 줄\n".repeat(400_000)}`;
      const bigBytes = encoder.encode(big);
      assert(bigBytes.byteLength > 1024 * 1024);
      const upload = async (bytes: Uint8Array) => {
        const hash = sha256(bytes);
        const sent = await calls.upload("documents", "upload", {
          blob_hash: hash,
          bytes: bytes.byteLength,
        }, bytes);
        assert(sent.ok, JSON.stringify(sent));
        return [{
          path: "plan.md",
          blob_hash: hash,
          bytes: bytes.byteLength,
          media_type: "text/markdown",
          primary: true,
          content: { kind: "prepared", blob: sent.value },
        }];
      };
      type Prepared = {
        preparation_ref: string;
        format: { name: string; module_hash: string; explicit: boolean };
      };
      // 명시 format 아래 이미 저장돼 있던 큰 판(한도가 생기기 전의 저장)을 만든다.
      const implicit = await calls.internal("worker", "documents", "prepare", {
        document: newId("doc"),
        base_version: null,
        metadata: {
          title: "Plan",
          place: { kind: "project", id: project },
          name: "plan",
        },
        files: await upload(bigBytes),
        source: null,
        idempotency_key: "big-prepare-0001",
      });
      assert(implicit.ok, JSON.stringify(implicit));
      const prepared = implicit.value as Prepared & { document: string };
      const document = prepared.document;
      const explicit = { ...prepared.format, explicit: true };
      const saved = await calls.internal("command", "documents", "save", {
        input: { ...prepared, format: explicit },
        idempotency_key: "big-prepare-0001",
        compare: { base_version: null },
        prepared: [prepared.preparation_ref],
      });
      assert(saved.ok, JSON.stringify(saved));
      const bigVersion = (saved.value as { version: string }).version;
      // 작은 판이 이어진다. 생략한 형식은 기준 판의 정확한 FormatRef다.
      const small = await calls.internal("worker", "documents", "prepare", {
        document,
        base_version: bigVersion,
        files: await upload(encoder.encode("# Plan\n\nshort\n")),
        source: null,
        idempotency_key: "small-prepare-0001",
      });
      assert(small.ok, JSON.stringify(small));
      const smallPrepared = small.value as Prepared;
      const smallSaved = await calls.internal("command", "documents", "save", {
        input: smallPrepared,
        idempotency_key: "small-prepare-0001",
        compare: { base_version: bigVersion },
        prepared: [smallPrepared.preparation_ref],
      });
      assert(smallSaved.ok, JSON.stringify(smallSaved));

      const versions = versionsOf(core);
      const history = await versions.history(document);
      assert(history.ok, JSON.stringify(history));
      assertEquals(history.value.map((row) => row.number), [2, 1]);
      const facts = await versions.facts(document);
      assert(facts.ok);
      assertEquals(facts.value.linked, false);
      assertEquals(facts.value.formatExplicit, true);

      const restored = await versions.restore(document, bigVersion);
      assert(restored.ok, JSON.stringify(restored));
      // 원본 파일이 없는 문서라 파일 단계는 없다.
      assertEquals(restored.value.outcome, "saved");
      assertEquals(restored.value.file, null);
      const latest = await calls.internal("read", "documents", "get", {
        document,
      });
      assert(latest.ok, JSON.stringify(latest));
      const value = latest.value as {
        version: {
          id: string;
          number: number;
          content_hash: string;
          format: { explicit: boolean };
        };
      };
      assertEquals(value.version.id, restored.value.version);
      assertEquals(value.version.number, 3);
      assertEquals(value.version.content_hash, history.value[1]!.contentHash);
      assertEquals(value.version.format.explicit, true);
      const bytes = await calls.readStream("documents", "file", {
        version: value.version.id,
        path: "plan.md",
      }, 8 * 1024 * 1024);
      assert(bytes.ok, JSON.stringify(bytes));
      assertEquals(sha256(bytes.value), sha256(bigBytes));
    } catch (error) {
      throw new Error(
        `${(error as Error).message}\n--- core ---\n${core.log()}`,
      );
    } finally {
      await core.stop();
      await Deno.remove(folder, { recursive: true });
    }
  },
});
