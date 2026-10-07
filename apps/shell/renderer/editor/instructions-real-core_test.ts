// 실제 core 위의 [Instructions](shell#T32, flow edit-instructions, shell/editor#R17). temp LOPHN_HOME core에
// main의 [Instructions] 통로(createInstructions·coreInstructionsPort)·파일 adapter·복원 통로·renderer의
// 버전 통로를 그대로 잇는다. Electron IPC는 빠진다. 사람 데이터 root(~/.lophn)와 실제 사람 폴더는 열지
// 않는다.
// - 전역: 파일이 없으면 문서도 없고, 사람의 첫 저장이 data root의 LOPHN.md를 만들어 첫 판이 된다.
// - 같은 편집기: 연결된 문서를 일반 문서처럼 열고 고쳐 새 판이 되며, 이력·비교·복원이 일반 문서와 같다.
// - 외부 변경: 연 뒤 바깥에서 파일을 고치면 저장은 충돌로 멈추고 파일을 덮지 않는다.
// - project: 활성 project의 첫 등록 폴더 바로 아래 LOPHN.md. 없는 project·app 층은 같은 not_found다.
import { assert, assertEquals } from "@std/assert";

import {
  coreFilesPort,
  coreInstructionsPort,
  coreRestorePort,
} from "../../main/editor/core-port.ts";
import { createFileAdapter, sha256 } from "../../main/editor/file-adapter.ts";
import { createInstructions } from "../../main/editor/instructions.ts";
import { createRestorer } from "../../main/editor/restore.ts";
import { coreLauncherSource } from "../desktop/launcher/core-source.ts";
import { shortNameOf } from "../desktop/launcher/model.ts";
import { newId } from "../desktop/lophn-space/model.ts";
import { startRealCore } from "../testdata/real-core.ts";
import { coreEditorSource } from "./core-source.ts";
import { coreVersionSource } from "./versions/core-source.ts";

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

Deno.test({
  name:
    "shell/editor#R17 shell/editor#R2 shell/editor#R13 shell/editor#R14: 실제 core에서 전역 지침은 첫 저장이 파일을 만들고, 같은 편집기로 고쳐 새 판이 되며, 이력·비교·복원과 외부 변경 충돌이 일반 문서와 같다",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const core = await startRealCore();
    try {
      const instructions = createInstructions({
        port: () => coreInstructionsPort(core.mainCalls),
        dataRoot: core.home,
        waits: 80,
        waitMs: 250,
      });
      const file = `${core.home}/LOPHN.md`;
      const global = { layer: "global" as const };

      // 파일이 없으면 문서도 없다. 빈 초안만 보이고 아무것도 만들지 않는다.
      assertEquals(await instructions.open({ target: global }), {
        ok: true,
        value: { document: null, version: null },
      });
      assert(
        await Deno.stat(file).then(() => false, () => true),
        "열기만으로 파일이 생겼다",
      );

      // 사람의 첫 저장이 파일을 만들고 documents가 그 파일을 첫 판으로 관측한다.
      const first = "# Instructions\n\nAlways answer briefly.\n";
      const created = await instructions.create({
        target: global,
        request_key: "instr-real-first-0000001",
        bytes: encoder.encode(first),
      });
      assert(created.ok, JSON.stringify(created));
      assertEquals(created.value.outcome, "saved");
      assert(created.value.document !== null && created.value.version !== null);
      const document = created.value.document;
      assertEquals(await Deno.readTextFile(file), first);
      // 이미 파일이 있으면 첫 저장을 다시 하지 않는다.
      const again = await instructions.create({
        target: global,
        request_key: "instr-real-again-0000001",
        bytes: encoder.encode("overwrite\n"),
      });
      assert(again.ok);
      assertEquals(again.value.outcome, "conflict");
      assertEquals(await Deno.readTextFile(file), first);
      const reopened = await instructions.open({ target: global });
      assertEquals(reopened, {
        ok: true,
        value: { document, version: created.value.version },
      });

      // 연결된 문서는 일반 문서와 같은 파일 adapter로 연다(지침 파일 목표).
      const adapter = createFileAdapter({
        port: () => coreFilesPort(core.mainCalls),
        log: () => {},
      });
      const opened = await adapter.open(1, document);
      assert(opened.ok, JSON.stringify(opened));
      assertEquals(opened.value.target, "instruction_file");
      assertEquals(opened.value.text, first);

      // 고침은 파일 쓰기 뒤 새 판이다. 이력·비교는 일반 문서와 같다.
      const second = "# Instructions\n\nAlways answer briefly and kindly.\n";
      const wrote = await adapter.write(1, {
        session: opened.value.session,
        request_key: "instr-real-save-0000001",
        base_hash: opened.value.base_hash,
        bytes: encoder.encode(second),
        end: true,
      });
      assert(wrote.ok && wrote.value.disk === "written", JSON.stringify(wrote));
      assertEquals(await Deno.readTextFile(file), second);
      const restorer = createRestorer({
        port: () => coreRestorePort(core.mainCalls),
        log: () => {},
      });
      const editorSource = coreEditorSource(core.source);
      const versions = coreVersionSource(core.source, editorSource, {
        restore: (input) => restorer.restore(input),
      });
      const history = await until("두 판", async () => {
        const rows = await versions.history(document);
        return rows.ok && rows.value.length === 2 ? rows.value : undefined;
      });
      assertEquals(history.map((row) => row.number), [2, 1]);
      assert(history.every((row) => row.fromFile && row.restorable));
      const facts = await versions.facts(document);
      assert(facts.ok, JSON.stringify(facts));
      assertEquals(facts.value.title, "Global instructions");
      assertEquals(facts.value.linked, true);
      const body = (version: string) =>
        until("판 본문", async () => {
          const read = await editorSource.body(document, version, () => {});
          return read.kind === "text" && read.complete ? read.text : undefined;
        });
      assertEquals(await body(history[1]!.id), first);
      assertEquals(await body(history[0]!.id), second);

      // 1번 판 복원은 현재 파일을 검사한 새 쓰기고 새 판은 관측이 만든다.
      const restored = await versions.restore(
        document,
        history[1]!.id,
        history[0]!.id,
      );
      assert(restored.ok, JSON.stringify(restored));
      assertEquals(restored.value.file, "written");
      assertEquals(await Deno.readTextFile(file), first);
      await until("복원 판", async () => {
        const rows = await versions.history(document);
        return rows.ok && rows.value.length === 3 ? rows.value : undefined;
      });

      // 연 뒤 바깥에서 고치면 저장은 충돌로 멈추고 바깥 글을 덮지 않는다.
      const mine = await adapter.open(1, document);
      assert(mine.ok, JSON.stringify(mine));
      await Deno.writeTextFile(file, "# Instructions\n\nEdited elsewhere.\n");
      const stale = await adapter.write(1, {
        session: mine.value.session,
        request_key: "instr-real-stale-0000001",
        base_hash: mine.value.base_hash,
        bytes: encoder.encode("# Instructions\n\nMine.\n"),
        end: false,
      });
      assert(stale.ok, JSON.stringify(stale));
      assertEquals(stale.value.disk, "conflict");
      assertEquals(
        await Deno.readTextFile(file),
        "# Instructions\n\nEdited elsewhere.\n",
      );
      // 바깥 글은 현재 파일로 읽는다(해결 화면의 비교 대상).
      const current = await adapter.current(1, { session: mine.value.session });
      assert(current.ok);
      assertEquals(current.value.text, "# Instructions\n\nEdited elsewhere.\n");
      assertEquals(
        current.value.hash,
        sha256(encoder.encode("# Instructions\n\nEdited elsewhere.\n")),
      );
    } catch (error) {
      throw new Error(
        `${(error as Error).message}\n--- core ---\n${core.log()}`,
      );
    } finally {
      await core.stop();
    }
  },
});

Deno.test({
  name:
    "shell/editor#R17: 실제 core에서 project 지침은 첫 등록 폴더의 LOPHN.md를 첫 저장으로 만들고, 없는 project와 app 층은 같은 not_found다",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const folder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-editor-instructions-" }),
    );
    const core = await startRealCore();
    try {
      const instructions = createInstructions({
        port: () => coreInstructionsPort(core.mainCalls),
        dataRoot: core.home,
        waits: 80,
        waitMs: 250,
      });
      const project = newId("prj");
      const registered = await coreLauncherSource(core.source, undefined)
        .register({
          id: project,
          name: shortNameOf("Alpha", []),
          title: "Alpha",
          purpose: "",
          folders: [{ path: folder, description: "Alpha" }],
        });
      assert(registered.ok, JSON.stringify(registered));
      const target = { layer: "project" as const, place: project };
      assertEquals(await instructions.open({ target }), {
        ok: true,
        value: { document: null, version: null },
      });
      const text = "# Alpha\n\nUse metric units.\n";
      // 등록은 core가 documents에 관측 근거를 보내는 사이에만 아직 모른다(저장하지 않고 invalid_input).
      const created = await until("project 지침 등록", async () => {
        const reply = await instructions.create({
          target,
          request_key: "instr-real-project-00001",
          bytes: encoder.encode(text),
        });
        return reply.ok && reply.value.failure === "invalid_input"
          ? undefined
          : reply;
      });
      assert(created.ok, JSON.stringify(created));
      assertEquals(created.value.outcome, "saved", JSON.stringify(created));
      assertEquals(await Deno.readTextFile(`${folder}/LOPHN.md`), text);
      const opened = await instructions.open({ target });
      assert(opened.ok && opened.value.document === created.value.document);
      // 전역 대상은 따로다. 전역 파일은 만들어지지 않았다.
      assertEquals(
        await instructions.open({ target: { layer: "global" } }),
        { ok: true, value: { document: null, version: null } },
      );
      // 없는 project와 범위 밖 app 층은 같은 답이다.
      const missing = await instructions.open({
        target: { layer: "project", place: newId("prj") },
      });
      const app = await instructions.open({
        target: { layer: "app", place: newId("app") },
      });
      assertEquals(missing, { ok: false, code: "not_found" });
      assertEquals(app, missing);
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
