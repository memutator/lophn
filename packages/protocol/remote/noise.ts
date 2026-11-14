import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { RandomSource } from "../../base/mod.ts";

// Noise_IK_25519_ChaChaPoly_SHA256 (Noise spec rev 34). 폰의 JavaScript engine에서도 같은 코드가 돌아서
// Node 내장 module과 Buffer를 쓰지 않는다.
//   <- s
//   ...
//   -> e, es, s, ss
//   <- e, ee, se

// 이름이 정확히 32 bytes라 hash하지 않고 그대로 h가 된다(spec 5.2 InitializeSymmetric).
const PROTOCOL_NAME = "Noise_IK_25519_ChaChaPoly_SHA256";
const KEY_BYTES = 32;
export const NOISE_TAG_BYTES = 16;
export const NOISE_MAX_MESSAGE_BYTES = 65535;

export type KeyPair = { publicKey: Uint8Array; secretKey: Uint8Array };

export function generateKeyPair(random: RandomSource): KeyPair {
  const secretKey = new Uint8Array(KEY_BYTES);
  random.fill(secretKey);
  return { publicKey: x25519.getPublicKey(secretKey), secretKey };
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function hkdf(ck: Uint8Array, ikm: Uint8Array): [Uint8Array, Uint8Array] {
  const temp = hmac(sha256, ck, ikm);
  const out1 = hmac(sha256, temp, Uint8Array.of(1));
  const out2 = hmac(sha256, temp, concat(out1, Uint8Array.of(2)));
  return [out1, out2];
}

function nonceOf(n: number): Uint8Array {
  // 앞 4 bytes 0, 뒤 8 bytes little-endian counter.
  const nonce = new Uint8Array(12);
  const view = new DataView(nonce.buffer);
  view.setUint32(4, n >>> 0, true);
  view.setUint32(8, Math.floor(n / 0x100000000), true);
  return nonce;
}

// 방향 하나의 key와 counter. 복호화가 실패하면 던진다. 부르는 쪽은 연결을 끊는다.
export type CipherState = {
  encrypt(ad: Uint8Array, plaintext: Uint8Array): Uint8Array;
  decrypt(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array;
};

function cipherState(k: Uint8Array): CipherState {
  let n = 0;
  return {
    encrypt: (ad, plaintext) =>
      chacha20poly1305(k, nonceOf(n++), ad).encrypt(plaintext),
    decrypt: (ad, ciphertext) =>
      chacha20poly1305(k, nonceOf(n++), ad).decrypt(ciphertext),
  };
}

class SymmetricState {
  h: Uint8Array;
  private ck: Uint8Array;
  // IK에서는 처음 EncryptAndHash 앞에 늘 MixKey가 있어 key 없는 상태를 다루지 않는다.
  private cipher: CipherState | undefined;

  constructor(prologue: Uint8Array) {
    this.h = new Uint8Array(32);
    this.h.set(new TextEncoder().encode(PROTOCOL_NAME));
    this.ck = this.h;
    this.mixHash(prologue);
  }

  mixHash(data: Uint8Array) {
    this.h = sha256(concat(this.h, data));
  }

  mixKey(ikm: Uint8Array) {
    const [ck, k] = hkdf(this.ck, ikm);
    this.ck = ck;
    this.cipher = cipherState(k);
  }

  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    const ciphertext = this.need().encrypt(this.h, plaintext);
    this.mixHash(ciphertext);
    return ciphertext;
  }

  decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    const plaintext = this.need().decrypt(this.h, ciphertext);
    this.mixHash(ciphertext);
    return plaintext;
  }

  split(): [CipherState, CipherState] {
    const [k1, k2] = hkdf(this.ck, new Uint8Array());
    return [cipherState(k1), cipherState(k2)];
  }

  private need(): CipherState {
    if (!this.cipher) throw new Error("noise cipher has no key");
    return this.cipher;
  }
}

// handshake가 끝난 뒤의 두 방향. handshakeHash는 spec의 transcript hash이고 test vector가 대조한다.
export type Transport = {
  send: CipherState;
  receive: CipherState;
  remoteStatic: Uint8Array;
  handshakeHash: Uint8Array;
};

const dh = (secretKey: Uint8Array, publicKey: Uint8Array) =>
  x25519.getSharedSecret(secretKey, publicKey);

// 실패는 던진다(AEAD tag, 짧은 메시지, low-order 점). 부르는 쪽이 잡아 연결을 끊는다.
export function initiatorHandshake(options: {
  prologue: Uint8Array;
  staticKey: KeyPair;
  remoteStatic: Uint8Array;
  random: RandomSource;
}) {
  const { staticKey, remoteStatic } = options;
  const state = new SymmetricState(options.prologue);
  state.mixHash(remoteStatic);
  const ephemeral = generateKeyPair(options.random);
  return {
    writeMessage(payload: Uint8Array): Uint8Array {
      state.mixHash(ephemeral.publicKey);
      state.mixKey(dh(ephemeral.secretKey, remoteStatic));
      const s = state.encryptAndHash(staticKey.publicKey);
      state.mixKey(dh(staticKey.secretKey, remoteStatic));
      return concat(ephemeral.publicKey, s, state.encryptAndHash(payload));
    },
    readMessage(message: Uint8Array): {
      payload: Uint8Array;
      transport: Transport;
    } {
      const re = message.subarray(0, KEY_BYTES);
      state.mixHash(re);
      state.mixKey(dh(ephemeral.secretKey, re));
      state.mixKey(dh(staticKey.secretKey, re));
      const payload = state.decryptAndHash(message.subarray(KEY_BYTES));
      const [send, receive] = state.split();
      return {
        payload,
        transport: { send, receive, remoteStatic, handshakeHash: state.h },
      };
    },
  };
}

export function responderHandshake(options: {
  prologue: Uint8Array;
  staticKey: KeyPair;
  random: RandomSource;
}) {
  const { staticKey } = options;
  const state = new SymmetricState(options.prologue);
  state.mixHash(staticKey.publicKey);
  let re: Uint8Array | undefined;
  let rs: Uint8Array | undefined;
  return {
    readMessage(message: Uint8Array): { payload: Uint8Array } {
      re = message.slice(0, KEY_BYTES);
      state.mixHash(re);
      state.mixKey(dh(staticKey.secretKey, re));
      const sEnd = KEY_BYTES * 2 + NOISE_TAG_BYTES;
      rs = state.decryptAndHash(message.subarray(KEY_BYTES, sEnd));
      state.mixKey(dh(staticKey.secretKey, rs));
      return { payload: state.decryptAndHash(message.subarray(sEnd)) };
    },
    writeMessage(payload: Uint8Array): {
      message: Uint8Array;
      transport: Transport;
    } {
      if (!re || !rs) throw new Error("noise responder has not read");
      const ephemeral = generateKeyPair(options.random);
      state.mixHash(ephemeral.publicKey);
      state.mixKey(dh(ephemeral.secretKey, re));
      state.mixKey(dh(ephemeral.secretKey, rs));
      const message = concat(
        ephemeral.publicKey,
        state.encryptAndHash(payload),
      );
      const [receive, send] = state.split();
      return {
        message,
        transport: { send, receive, remoteStatic: rs, handshakeHash: state.h },
      };
    },
  };
}
