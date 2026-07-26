// The dev build (npm run tauri dev) talks to a manually-started sidecar (see
// BUILD.md) on a different port than the bundled production sidecar, so a
// dev instance can run at the same time as an already-installed copy of the
// app without both processes fighting over the same port.
export const SIDECAR_PORT = import.meta.env.DEV ? 4001 : 4000;
export const SIDECAR_HTTP_URL = `http://localhost:${SIDECAR_PORT}`;
export const SIDECAR_WS_URL = `ws://localhost:${SIDECAR_PORT}`;
