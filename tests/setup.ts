// Imported first by every database test: an in-memory Postgres and a fixed admin.
process.env.SCROLL_DB_MEMORY = "1";
process.env.APP_SECRET = "test-secret-test-secret-test-secret-0123";
process.env.ADMIN_WALLETS = "0x00000000000000000000000000000000000ad313";
delete process.env.DATABASE_URL;
delete process.env.TREASURY_PRIVATE_KEY;

export const ADMIN = "0x00000000000000000000000000000000000ad313";

/** A header-valid PNG of the given size. `seed` makes the bytes (and so the hash) unique. */
export function fakePng(width: number, height: number, seed: number): Uint8Array {
  const b = new Uint8Array(96);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(b.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  view.setUint32(40, seed);
  return b;
}
