// 문서·앱 view의 session 정책은 이 모듈에만 등록한다. 여러 handler가
// 덮어쓰지 않게 한 session마다 한 번 설치하고, 같은 session을 두 번 주지 않는다.

export interface DocumentSessionPolicy {
  /** session이 있을 수 있는 주소. 다른 대상으로 바뀌지 않게 해석한다. */
  allowedScheme: string;
  allowedHost: string | null;
  /** 다른 대상 요청·외부 network를 session에서 차단한다. */
  blockRequests(): void;
  clearStorageData(): Promise<void>;
}

export interface DocumentSessionRegistryInput {
  session: DocumentSessionPolicy;
  partition: string;
}

export const DOCUMENT_SCHEME = "lophn-document";

export interface DocumentSessionEntry {
  partition: string;
  policy: DocumentSessionPolicy;
}

/**
 * partition과 session을 묶어 기억한다. 닫을 때는 같은 entry로 clearStorageData를
 * 부르고 entry를 지운다.
 */
export function createDocumentSessions() {
  const entries = new Map<string, DocumentSessionEntry>();
  return {
    register({ session, partition }: DocumentSessionRegistryInput): void {
      if (entries.has(partition)) {
        throw new Error(`document session already registered: ${partition}`);
      }
      entries.set(partition, { partition, policy: session });
    },
    find(partition: string): DocumentSessionEntry | undefined {
      return entries.get(partition);
    },
    /** 닫힌 문서 view의 저장 상태를 지우고 registry에서 지운다. */
    async close(partition: string): Promise<void> {
      const entry = entries.get(partition);
      if (!entry) return;
      entries.delete(partition);
      await entry.policy.clearStorageData();
    },
  };
}
