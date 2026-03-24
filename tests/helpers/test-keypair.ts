/**
 * Idempotent ECDSA P-256 test keypair generator.
 *
 * Generates a keypair in tests/fixtures/ if not already present.
 * Exports the public key in SSH authorized_keys format (ecdsa-sha2-nistp256).
 *
 * Per FR-109: test infrastructure needs a stable keypair for SSH integration tests.
 */

import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');
const PRIVATE_KEY_PATH = join(FIXTURES_DIR, 'test-key.pem');
const PUBLIC_KEY_PATH = join(FIXTURES_DIR, 'test-key.pub');

/**
 * Encode an ECDSA P-256 public key in SSH authorized_keys format.
 * Format: "ecdsa-sha2-nistp256 <base64-blob> agent-runner-test"
 *
 * The blob is: string("ecdsa-sha2-nistp256") + string("nistp256") + string(Q)
 * where Q is the uncompressed EC point (0x04 || x || y).
 */
function encodeSSHPublicKey(publicKeyPem: string): string {
  const pubKey = createPublicKey(publicKeyPem);
  const jwk = pubKey.export({ format: 'jwk' });

  // x and y are base64url-encoded 32-byte coordinates
  const x = Buffer.from(jwk.x!, 'base64url');
  const y = Buffer.from(jwk.y!, 'base64url');

  // Uncompressed EC point: 0x04 || x || y
  const q = Buffer.concat([Buffer.from([0x04]), x, y]);

  // SSH wire format: each field is a uint32 length prefix + data
  const identifier = Buffer.from('ecdsa-sha2-nistp256');
  const curve = Buffer.from('nistp256');

  const blob = Buffer.concat([
    encodeSSHString(identifier),
    encodeSSHString(curve),
    encodeSSHString(q),
  ]);

  return `ecdsa-sha2-nistp256 ${blob.toString('base64')} agent-runner-test`;
}

function encodeSSHString(data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, data]);
}

/**
 * Ensure the test keypair exists in tests/fixtures/.
 * If both files exist, does nothing (idempotent).
 * Returns { privateKey, publicKey, authorizedKeysLine }.
 */
export function ensureTestKeypair(): {
  privateKeyPath: string;
  publicKeyPath: string;
  privateKey: string;
  publicKey: string;
  authorizedKeysLine: string;
} {
  mkdirSync(FIXTURES_DIR, { recursive: true });

  if (!existsSync(PRIVATE_KEY_PATH) || !existsSync(PUBLIC_KEY_PATH)) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });

    writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
    writeFileSync(PUBLIC_KEY_PATH, publicKey, { mode: 0o644 });
  }

  const privateKey = readFileSync(PRIVATE_KEY_PATH, 'utf-8');
  const publicKey = readFileSync(PUBLIC_KEY_PATH, 'utf-8');
  const authorizedKeysLine = encodeSSHPublicKey(publicKey);

  return {
    privateKeyPath: PRIVATE_KEY_PATH,
    publicKeyPath: PUBLIC_KEY_PATH,
    privateKey,
    publicKey,
    authorizedKeysLine,
  };
}

// Allow running directly to generate the keypair
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const result = ensureTestKeypair();
  console.log('Private key:', result.privateKeyPath);
  console.log('Public key:', result.publicKeyPath);
  console.log('Authorized keys line:', result.authorizedKeysLine);
}
