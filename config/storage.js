// Private object storage for verification documents (Supabase Storage REST API).
// The secret key stays server-side; objects are only ever read back through the backend.

function settings() {
  const url    = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key    = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_VERIFICATION_BUCKET;
  if (!url || !key || !bucket) throw new Error('Document storage is not configured.');
  return { url, key, bucket };
}

function objectUrl(s, storageKey) {
  return `${s.url}/storage/v1/object/${encodeURIComponent(s.bucket)}/${storageKey.split('/').map(encodeURIComponent).join('/')}`;
}

async function uploadObject(storageKey, buffer, mimeType) {
  const s = settings();
  const r = await fetch(objectUrl(s, storageKey), {
    method:  'POST',
    headers: { apikey: s.key, 'Content-Type': mimeType, 'x-upsert': 'false' },
    body:    buffer
  });
  if (!r.ok) throw new Error(`Storage upload failed (HTTP ${r.status}).`);
}

async function downloadObject(storageKey) {
  const s = settings();
  const r = await fetch(objectUrl(s, storageKey), { headers: { apikey: s.key } });
  if (!r.ok) throw new Error(`Storage download failed (HTTP ${r.status}).`);
  return Buffer.from(await r.arrayBuffer());
}

async function deleteObjects(storageKeys) {
  if (!storageKeys.length) return;
  const s = settings();
  const r = await fetch(`${s.url}/storage/v1/object/${encodeURIComponent(s.bucket)}`, {
    method:  'DELETE',
    headers: { apikey: s.key, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ prefixes: storageKeys })
  });
  if (!r.ok) throw new Error(`Storage delete failed (HTTP ${r.status}).`);
}

module.exports = { uploadObject, downloadObject, deleteObjects };
