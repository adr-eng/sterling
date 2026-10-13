// Sign in, set or change the partner's password, sign out. All logic is in
// auth/handler.mjs; this file wires in the env and the private Blob store.
import { handleAuth } from '../auth/handler.mjs';
import { blobStore } from '../auth/store.mjs';

export default {
  fetch(request) {
    return handleAuth(request, { env: process.env, store: blobStore });
  },
};
