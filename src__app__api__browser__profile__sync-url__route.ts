import { NextRequest, NextResponse } from "next/server";

// POST /api/browser/profile/sync-url — INTERNAL endpoint for the browser
// host (Hugging Face Space gate). The host's disk is ephemeral, so browser
// profiles live in Supabase Storage (private bucket "profiles") and the
// host syncs them in/out. The host never sees the service-role key: this
// route checks the shared orchestrator token and hands back a short-lived
// signed URL for exactly one object: profiles/<storageKey>.tar.gz.
//
// Body: { storageKey, op: "download" | "upload" } -> { url: string | null }
// download returns url:null when no saved profile exists yet (first run).

const BUCKET = "profiles";

function storageBase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return { base: `${url.replace(/\/$/, "")}/storage/v1`, key };
}

async function storageFetch(path: string, init: RequestInit) {
  const s = storageBase();
  if (!s) throw new Error("storage not configured");
  return fetch(`${s.base}${path}`, {
    ...init,
    headers: {
      apikey: s.key,
      authorization: `Bearer ${s.key}`,
      // Only claim a JSON body when there IS one: Supabase Storage (Fastify)
      // rejects an empty body sent with content-type application/json —
      // "Body cannot be empty when content-type is set to 'application/json'"
      // (this broke signed upload URLs with a 502; found live 2026-10-22).
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {})
    }
  });
}

async function ensureBucket() {
  const res = await storageFetch("/bucket", {
    method: "POST",
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false })
  });
  // 200/201 created; 409/already-exists is fine — anything else is logged by caller.
  return res.ok || res.status === 409 || res.status === 400;
}

export async function POST(req: NextRequest) {
  const expected = process.env.ORCHESTRATOR_INTERNAL_TOKEN || "";
  if (!expected || req.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!storageBase()) {
    return NextResponse.json({ error: "storage not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const storageKey = typeof body.storageKey === "string" ? body.storageKey : "";
  const op = body.op === "upload" ? "upload" : body.op === "download" ? "download" : null;
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(storageKey) || !op) {
    return NextResponse.json({ error: "invalid storageKey or op" }, { status: 400 });
  }
  const objectPath = `${storageKey}.tar.gz`;
  const s = storageBase()!;

  try {
    await ensureBucket();

    if (op === "download") {
      const res = await storageFetch(`/object/sign/${BUCKET}/${objectPath}`, {
        method: "POST",
        body: JSON.stringify({ expiresIn: 900 })
      });
      if (!res.ok) return NextResponse.json({ url: null }); // no saved profile yet
      const data = await res.json();
      if (!data.signedURL) return NextResponse.json({ url: null });
      return NextResponse.json({ url: `${s.base}${data.signedURL}` });
    }

    // upload: remove any previous object first so the signed upload URL can
    // always be used for a fresh PUT (the host also sends x-upsert).
    await storageFetch(`/object/${BUCKET}`, {
      method: "DELETE",
      body: JSON.stringify({ prefixes: [objectPath] })
    }).catch(() => null);

    const res = await storageFetch(`/object/upload/sign/${BUCKET}/${objectPath}`, {
      method: "POST",
      body: JSON.stringify({})
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({ error: `could not sign upload URL (${res.status}) ${text.slice(0, 120)}` }, { status: 502 });
    }
    const data = await res.json();
    if (!data.url) return NextResponse.json({ error: "no upload URL returned" }, { status: 502 });
    return NextResponse.json({ url: `${s.base}${data.url}` });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "sync-url failed" }, { status: 500 });
  }
}
