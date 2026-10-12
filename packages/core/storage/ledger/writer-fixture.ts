import { err, ok } from "../../../base/mod.ts";
import {
  createIdSource,
  manualClock,
  seededRandom,
} from "../../../base/mod.ts";
import { definePort } from "../../../protocol/platform/mod.ts";
import { defineTxPort } from "./tx-ports.ts";
import type { AuthenticatedContext } from "../../../protocol/platform/mod.ts";
import { advanceSubscriberCursorCommand } from "./commands.ts";
import { createSubscriberGate } from "../../events/subscriber-registration.ts";
import {
  recordLooseNoteCommand,
  recordNoteCommand,
  recordWideNoteCommand,
} from "./test-commands.ts";
import { serveWriter } from "./writer-loop.ts";
import { createWriterRegistration } from "./writer-registration.ts";

const START = Date.parse("2026-01-01T00:00:00.000Z");
const clock = manualClock(START);
const notePort = definePort<{ mark: string }>("note");

// Worker는 모듈 사본을 따로 가진다. 회수 mirror는 임시 DB 디렉터리에만 둔다.
function mirrorFile(ledgerPath: string): string {
  const slash = ledgerPath.lastIndexOf("/");
  const dir = slash === -1 ? "." : ledgerPath.slice(0, slash);
  return `${dir}/.writer-revoked`;
}

function mirrorPath(): string {
  const started = JSON.parse(self.name) as { path: string };
  return mirrorFile(started.path);
}

function revokedRefs(): Set<string> {
  try {
    return new Set(
      Deno.readTextFileSync(mirrorPath()).split("\n").filter((line) =>
        line.length > 0
      ),
    );
  } catch {
    return new Set();
  }
}

export function revokeCredential(ledgerPath: string, ref: string): void {
  const file = mirrorFile(ledgerPath);
  let current = "";
  try {
    current = Deno.readTextFileSync(file);
  } catch {
    current = "";
  }
  const refs = new Set(current.split("\n").filter((line) => line.length > 0));
  refs.add(ref);
  Deno.writeTextFileSync(file, [...refs].join("\n"));
}

export function resetCredentialMirror(ledgerPath: string): void {
  try {
    Deno.removeSync(mirrorFile(ledgerPath));
  } catch {
    // 없으면 그대로다.
  }
}

// current authority가 제출 scope보다 좁아질 수 있음을 흉내 낸다. 제출 ctx는 그대로 넓게 둔다.
function scopeMirrorFile(ledgerPath: string): string {
  const slash = ledgerPath.lastIndexOf("/");
  const dir = slash === -1 ? "." : ledgerPath.slice(0, slash);
  return `${dir}/.writer-scope`;
}

function scopeMirrorPath(): string {
  const started = JSON.parse(self.name) as { path: string };
  return scopeMirrorFile(started.path);
}

function narrowedOperations(): readonly string[] | undefined {
  let text: string;
  try {
    text = Deno.readTextFileSync(scopeMirrorPath());
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  return Array.isArray(parsed) && parsed.every((v) => typeof v === "string")
    ? parsed
    : undefined;
}

export function narrowCredentialScope(
  ledgerPath: string,
  operations: readonly string[],
): void {
  Deno.writeTextFileSync(
    scopeMirrorFile(ledgerPath),
    JSON.stringify(operations),
  );
}

export function resetScopeMirror(ledgerPath: string): void {
  try {
    Deno.removeSync(scopeMirrorFile(ledgerPath));
  } catch {
    // 없으면 그대로다.
  }
}

export const writerNotePort = notePort;

const cursorGate = createSubscriberGate([{
  name: "notifications",
  authorize: (ctx) =>
    ok(
      ctx.actor === "machine" && ctx.principal === "machine-1" &&
        ctx.credential_ref === "cred-m" &&
        ctx.scope.operations.includes("AdvanceSubscriberCursor"),
    ),
}, {
  name: "notes",
  authorize: (ctx) =>
    ok(
      ctx.principal === "user-1" && ctx.credential_ref === "cred-1" &&
        ctx.scope.operations.includes("AdvanceSubscriberCursor"),
    ),
}]);
if (!cursorGate.ok) throw new Error("subscriber gate");

serveWriter(
  self as unknown as Parameters<typeof serveWriter>[0],
  createWriterRegistration({
    commands: [
      advanceSubscriberCursorCommand,
      recordNoteCommand,
      recordWideNoteCommand,
      recordLooseNoteCommand,
    ],
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
    ports: [defineTxPort(notePort, () => ({ mark: "fixed" }))],
    registerBlobRef: () => err({ code: "unavailable", message: "blob 없음" }),
    call: () => err({ code: "unavailable", message: "dispatch 없음" }),
    subscriberGate: cursorGate.value,
    checkCredential(ctx: AuthenticatedContext) {
      if (revokedRefs().has(ctx.credential_ref)) {
        return err({ code: "unauthorized", message: "자격이 회수되었다" });
      }
      if (ctx.expires_at !== undefined && ctx.expires_at < clock.now()) {
        return err({ code: "unauthorized", message: "자격이 만료되었다" });
      }
      const narrowed = narrowedOperations();
      if (narrowed !== undefined) {
        return ok({
          ...ctx,
          scope: { ...ctx.scope, operations: [...narrowed] },
        });
      }
      return ok(ctx);
    },
  }),
);
