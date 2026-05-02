import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const PARAMS = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;
const SALT_BYTES = 16;

export async function hashPassword(plaintext: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(plaintext, salt, KEYLEN, PARAMS);
  return `scrypt$N=${PARAMS.N},r=${PARAMS.r},p=${PARAMS.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(plaintext: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const params: Record<string, number> = {};
  for (const kv of parts[1].split(',')) {
    const [k, v] = kv.split('=');
    const n = Number(v);
    if (!Number.isFinite(n)) return false;
    params[k] = n;
  }
  if (!params.N || !params.r || !params.p) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[2], 'base64');
    expected = Buffer.from(parts[3], 'base64');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  const derived = await scrypt(plaintext, salt, expected.length, {
    N: params.N,
    r: params.r,
    p: params.p,
  });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
