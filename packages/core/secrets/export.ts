// secret.export·secret.import.
// keychain 읽기·쓰기는 이 경계의 메모리에서만 하고, 참조 교체는 기존 SetSecret 준비 흐름이다.
// import가 하나라도 실패하면 새 참조를 하나도 제출하지 않는다. 기존 참조는 그대로다.

import { err, ok, type Result } from "../../base/mod.ts";
import type {
  SecretExportInput,
  SecretImportInput,
  SecretImportOutput,
  SecretPreparation,
  SecretPrepareInput,
  SecretValue,
} from "../../protocol/secrets/mod.ts";
import type { KnownSecretRegistry } from "../../base/redaction/mod.ts";
import type { KeychainAdapter } from "./adapters/keychain.ts";
import {
  openExchange,
  sealExchange,
  type SecretExchangeFile,
  type SecretExchangeItem,
} from "./exchange.ts";
import type { SecretRecord } from "./model.ts";

export type SecretSelection = {
  // 사람이 명시적으로 고른 현재 참조. 값은 여기 없고 항목마다 용도·소유가 있다.
  records: readonly {
    name: string;
    sealedRef: string;
    purpose: SecretPrepareInput["purpose"];
    owner: string;
  }[];
};

export type ImportCommit = {
  name: string;
  preparation: SecretPreparation;
  // 현재 참조·판. 없으면 이름 부재 CAS.
  current: { sealed_ref: string; revision: number } | undefined;
};

export type SecretTransfer = {
  exportSelected(options: {
    selection: SecretSelection;
    passphrase: string;
  }): Promise<Result<SecretExchangeFile>>;
  // 복호·새 keychain 준비까지. 참조 CAS는 caller가 ImportCommit으로 제출한다.
  // 준비 중 하나라도 실패하면 이미 준비한 새 값을 지우고 커밋을 비운다.
  importSelected(options: {
    file: SecretExchangeFile;
    passphrase: string;
    current: (name: string) => SecretRecord | undefined;
  }): Promise<Result<readonly ImportCommit[]>>;
  // contract callback. 암호·암호문은 인자로만 오고 응답에는 크기·준비만 남는다.
  // 암호문 bytes는 결과로 돌려 callback·byte chunk에만 둔다. JSON 응답에는 크기만 간다.
  exportBytes(
    input: SecretExportInput,
    passphrase: SecretValue,
  ): Promise<Result<Uint8Array>>;
  importBytes(
    input: SecretImportInput,
    passphrase: SecretValue,
    ciphertext: Uint8Array,
  ): Promise<Result<SecretImportOutput>>;
};

export function createSecretTransfer(options: {
  keychain: KeychainAdapter;
  registry: KnownSecretRegistry;
  prepare: (
    input: SecretPrepareInput,
    value: Uint8Array,
  ) => Promise<Result<SecretPreparation>>;
  // 보호 입력과 같은 machine 경계. 원값은 이 호출에 넣지 않는다.
  context: SecretPrepareInput["context"];
}): SecretTransfer {
  return {
    async exportSelected(request) {
      const status = await options.keychain.status();
      if (status !== "available") {
        return err({
          code: "unavailable",
          message: "OS keychain을 사용할 수 없다",
        });
      }
      if (request.selection.records.length === 0) {
        return err({ code: "invalid_input", message: "선택한 secret이 없다" });
      }
      const items: SecretExchangeItem[] = [];
      for (const record of request.selection.records) {
        const loaded = await options.keychain.load(record.sealedRef);
        if (!loaded.ok) return loaded;
        items.push({
          name: record.name,
          purpose: record.purpose,
          owner: record.owner,
          value: loaded.value,
        });
      }
      const sealed = await sealExchange({
        items,
        passphrase: request.passphrase,
      });
      if (!sealed.ok) return sealed;
      if (plaintextLeft(sealed.value.bytes, items)) {
        return err({ code: "internal", message: "보호 파일이 원값을 담는다" });
      }
      return sealed;
    },
    async exportBytes(input, passphrase) {
      const exported = await this.exportSelected({
        selection: {
          records: input.secrets.map((secret) => ({
            name: secret.name,
            sealedRef: secret.sealed_ref,
            purpose: secret.purpose,
            owner: secret.owner,
          })),
        },
        passphrase: textOf(passphrase),
      });
      if (!exported.ok) return exported;
      return ok(exported.value.bytes);
    },
    async importBytes(input, passphrase, ciphertext) {
      const byName = new Map(input.current.map((reference) => [
        reference.name,
        {
          name: reference.name,
          sealedRef: reference.sealed_ref,
          revision: reference.revision,
        },
      ]));
      const imported = await this.importSelected({
        file: { bytes: ciphertext },
        passphrase: textOf(passphrase),
        current: (name) => byName.get(name),
      });
      if (!imported.ok) return imported;
      return ok({
        commits: imported.value.map((commit) => ({
          name: commit.name,
          preparation: commit.preparation,
          compare: commit.current === undefined
            ? { sealed_ref: null, revision: null }
            : commit.current,
        })),
      });
    },
    async importSelected(request) {
      const status = await options.keychain.status();
      if (status !== "available") {
        return err({
          code: "unavailable",
          message: "OS keychain을 사용할 수 없다",
        });
      }
      const opened = await openExchange({
        file: request.file,
        passphrase: request.passphrase,
      });
      if (!opened.ok) return opened;
      const commits: ImportCommit[] = [];
      for (const item of opened.value) {
        options.registry.register([new TextDecoder().decode(item.value)]);
        const prepared = await options.prepare(
          {
            context: options.context,
            purpose: item.purpose,
            owner: item.owner,
          },
          item.value,
        );
        if (!prepared.ok) {
          await dropPreparations(options.keychain, commits, request.current);
          return prepared;
        }
        const current = request.current(item.name);
        commits.push({
          name: item.name,
          preparation: prepared.value,
          current: current === undefined
            ? undefined
            : { sealed_ref: current.sealedRef, revision: current.revision },
        });
      }
      return ok(commits);
    },
  };
}

async function dropPreparations(
  keychain: KeychainAdapter,
  commits: readonly ImportCommit[],
  current: (name: string) => SecretRecord | undefined,
): Promise<void> {
  for (const commit of commits) {
    // 이번 준비가 만든 참조만 지운다. 기존 참조와 같으면 그대로 둔다.
    if (current(commit.name)?.sealedRef === commit.preparation.sealed_ref) {
      continue;
    }
    await keychain.remove(commit.preparation.sealed_ref);
  }
}

function textOf(value: SecretValue): string {
  return typeof value === "string" ? value : new TextDecoder().decode(value);
}

function plaintextLeft(
  file: Uint8Array,
  items: readonly SecretExchangeItem[],
): boolean {
  const text = new TextDecoder().decode(file);
  for (const item of items) {
    const value = new TextDecoder().decode(item.value);
    if (value.length > 0 && text.includes(value)) return true;
  }
  return false;
}
