// shell capability. control `connect {client: shell}`이 발급하고 응답을 받은 shell main 메모리에만 둔다.
// Gateway handshake가 이 값을 보이면 그 연결의 수명이 곧 shell의 수명이다.
export type ShellCapabilities = {
  issue(): string;
  has(capability: string): boolean;
  // 그 capability로 묶인 Gateway 연결이 끝났다. capability와 그 shell의 handle을 버린다.
  end(capability: string): void;
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
  // shell이 끝났다. 그 shell의 view relay와 미소비 handle을 버린다.
  ended(): void;
}): ShellCapabilities {
  // 살아 있는 capability. epoch 하나와 같은 수명이라 core가 끝나면 함께 사라진다.
  const live = new Set<string>();
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
      deps.ended();
    },
  };
}
