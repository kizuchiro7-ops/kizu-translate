// Session tokens and one-time-code primitives.
//
// Tokens are stateless: a JWT-shaped payload signed with HMAC-SHA256 using the
// SESSION_SECRET Worker secret. Nothing is stored server-side, so verifying a
// token on the chat/TTS hot path costs zero KV reads.

const CODE_LENGTH = 6;

export function normalizeEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

export function isValidEmailShape(email) {
  // Deliberately permissive: real validation is "is it on the allowlist".
  return email.length > 0 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Masks an address for logging, e.g. "tanaka@gmail.com" -> "t***@gmail.com". */
export function maskEmail(email) {
  const at = email.indexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

function b64urlEncode(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecodeToBytes(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signToken(env, email) {
  const ttlDays = Number(env.SESSION_TTL_DAYS || 30);
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    e: email,
    iat: now,
    exp: now + ttlDays * 24 * 60 * 60,
    v: Number(env.SESSION_VERSION || 1),
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const encodedPayload = b64urlEncode(payloadBytes);

  const key = await hmacKey(env.SESSION_SECRET);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encodedPayload));

  return `${encodedPayload}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** Returns {ok:true, email} or {ok:false, reason}. Never throws on bad input. */
export async function verifyToken(env, token) {
  if (!token || typeof token !== "string") return { ok: false, reason: "missing" };

  const dot = token.indexOf(".");
  if (dot < 1) return { ok: false, reason: "malformed" };

  const encodedPayload = token.slice(0, dot);
  const encodedSig = token.slice(dot + 1);

  let sigBytes;
  try {
    sigBytes = b64urlDecodeToBytes(encodedSig);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  // crypto.subtle.verify is constant-time; never compare signatures with ===.
  const key = await hmacKey(env.SESSION_SECRET);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    new TextEncoder().encode(encodedPayload),
  );
  if (!valid) return { ok: false, reason: "bad_signature" };

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecodeToBytes(encodedPayload)));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  // Break-glass mass logout: bumping SESSION_VERSION in wrangler.toml invalidates
  // every token already in the wild on the next deploy.
  if (Number(payload.v) !== Number(env.SESSION_VERSION || 1)) {
    return { ok: false, reason: "version_revoked" };
  }
  if (!payload.exp || Math.floor(Date.now() / 1000) >= payload.exp) {
    return { ok: false, reason: "expired" };
  }
  if (!payload.e) return { ok: false, reason: "malformed" };

  return { ok: true, email: payload.e };
}

/**
 * 6 random digits. Rejection-sampled: a byte >= 250 is discarded rather than
 * folded with `% 10`, which would make digits 0-5 more likely than 6-9.
 */
export function generateCode() {
  let out = "";
  while (out.length < CODE_LENGTH) {
    const buf = new Uint8Array(CODE_LENGTH * 2);
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b >= 250) continue;
      out += String(b % 10);
      if (out.length === CODE_LENGTH) break;
    }
  }
  return out;
}

/**
 * Hashes the code together with the email and a server-side pepper, so a KV
 * dump reveals no usable codes and a code can't be replayed for another address.
 */
export async function hashCode(env, email, code) {
  const data = new TextEncoder().encode(`${email}:${code}:${env.OTP_PEPPER}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time-ish comparison for equal-length hex strings. */
export function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
