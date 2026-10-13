/**
 * auth/store.mjs
 *
 * Sign-in records, one small JSON file each, in a PRIVATE Vercel Blob store
 * connected to this project (env BLOB_READ_WRITE_TOKEN, added by Vercel when
 * the store is connected). Used by the auth function only (Node runtime).
 *
 *   partner  the partner's password hash + used setup codes
 *   admin    Adrian's password hash + used setup codes
 *   invite   the hash of the newest partner setup link made on /admin
 *
 * Only hashes are stored, never a password or a setup code.
 */
import { get, put } from '@vercel/blob';

const NAMES = new Set(['partner', 'admin', 'invite']);
const pathOf = (name) => {
  if (!NAMES.has(name)) throw new Error(`Unknown auth record "${name}"`);
  return `auth/${name}.json`;
};

export const blobStore = {
  async load(name) {
    const res = await get(pathOf(name), { access: 'private', useCache: false });
    if (!res || res.statusCode !== 200) return null;
    return JSON.parse(await new Response(res.stream).text());
  },
  async save(name, record) {
    await put(pathOf(name), JSON.stringify(record), {
      access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json',
    });
  },
};
