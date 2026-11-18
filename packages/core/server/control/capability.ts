// shell capability. control `connect {client: shell}`이 발급하고 응답을 받은 shell main 메모리에만 둔다.
// Gateway handshake가 이 값을 보이면 그 연결의 수명이 곧 shell의 수명이다.
export type ShellCapabilities = {
  issue(): string;
  has(capability: string): boolean;
  // 그 capability로 묶인 Gateway 연결이 끝났다. capability를 버리고 onEnd listener를 부른다.
  end(capability: string): void;
  // capability가 끝날 때마다 부른다. 그 shell에 묶인 것(handle, view relay, 다른 기계의 구독)을 버리는 쪽이 건다.
  onEnd(listener: (capability: string) => void): () => void;
};

const CAPABILITY_BYTES = 32;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function createShellCapabilities(deps: {
  // 32 bytes를 채운다. 테스트가 결정적 값을 끼운다.
  random: (bytes: Uint8Array) => void;
}): ShellCapabilities {
  // 살아 있는 capability. epoch 하나와 같은 수명이라 core가 끝나면 함께 사라진다.
  const live = new Set<string>();
  const listeners = new Set<(capability: string) => void>();
  return {
    issue() {
      const bytes = new Uint8Array(CAPABILITY_BYTES);
      deps.random(bytes);
      const capability = base64url(bytes);
      live.add(capability);
      return capability;
    },
    has: (capability) => live.has(capability),
    end(capability) {
      if (!live.delete(capability)) return;
      for (const listener of [...listeners]) listener(capability);
    },
    onEnd(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
