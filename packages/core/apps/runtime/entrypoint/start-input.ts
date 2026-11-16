// stdin 시작 JSON 한 줄의 순수 검증. protocol/apps/calls/process-wire의 appProcessStartInputSchema와
// 같은 판정.
import { endpoint, exact, id, record, SHA, text } from "./wire-check.ts";

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export type AppStart = {
  app: string;
  release: string | null;
  bundle_hash: string;
  mode: "live" | "preview";
  process_nonce: string;
  broker_socket: string;
  control_socket: string;
  data_path: string;
  broker_credential: string;
  machine: string;
};

export function parseAppStart(line: string): AppStart | undefined {
  const trimmed = line.endsWith("\n") ? line.slice(0, -1) : line;
  if (trimmed.includes("\n")) return;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return;
  }
  const source = record(value);
  if (
    !source ||
    exact(source, [
      "app",
      "release",
      "bundle_hash",
      "mode",
      "process_nonce",
      "broker_socket",
      "control_socket",
      "data_path",
      "broker_credential",
      "machine",
    ])
  )
    return;
  const app = id(source.app, "app");
  const release = source.release === null ? null : id(source.release, "rel");
  const bundle =
    typeof source.bundle_hash === "string" && SHA.test(source.bundle_hash)
      ? source.bundle_hash
      : undefined;
  const mode =
    source.mode === "live" || source.mode === "preview"
      ? source.mode
      : undefined;
  const nonce = text(source.process_nonce);
  const broker = endpoint(source.broker_socket);
  const control = endpoint(source.control_socket);
  const data = nonEmpty(source.data_path);
  const credential = nonEmpty(source.broker_credential);
  const machine = id(source.machine, "mch");
  if (
    !app ||
    release === undefined ||
    !bundle ||
    !mode ||
    !nonce ||
    !broker ||
    !control ||
    !data ||
    !credential ||
    !machine ||
    (mode === "live" && release === null)
  )
    return;
  return {
    app,
    release,
    bundle_hash: bundle,
    mode,
    process_nonce: nonce,
    broker_socket: broker,
    control_socket: control,
    data_path: data,
    broker_credential: credential,
    machine,
  };
}
