/**
 * auth/store.mjs
 *
 * Where the partner's password hash lives: one JSON file in a PRIVATE Vercel
 * Blob store connected to this project (env BLOB_READ_WRITE_TOKEN, added by
 * Vercel when the store is connected). Only the hash, salt and settings are
 * stored, never the password. Used by the auth function only (Node runtime).
 */
import { get, put } from '@vercel/blob';

const PATH = 'auth/partner.json';

export const blobStore = {
  async load() {
    const res = await get(PATH, { access: 'private', useCache: false });
    if (!res || res.statusCode !== 200) return null;
    return JSON.parse(await new Response(res.stream).text());
  },
  async save(record) {
    await put(PATH, JSON.stringify(record), {
      access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json',
    });
  },
};
