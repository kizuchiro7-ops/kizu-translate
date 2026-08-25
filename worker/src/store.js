// 認証で使う KV アクセスをここに集約する。キー名の文字列がこのファイル以外に
// 散らないようにするため。バインディング: AUTH (namespace TRANSLATE_AUTH)
//
// キー構成:
//   staff:<email>    名簿(=許可リスト本体), TTLなし
//   otp:<email>      {hash, exp, attempts}, 600秒  … 発行中のログインコード
//   rl:cool:<email>  "1", 60秒                     … 再送クールダウン
//   rl:day:<email>   "<count>", 86400秒            … 1日あたりの発行上限
//   seen:<email>     {last, count}, TTLなし        … 最終ログイン記録
//
// 書き込み回数の注意: KV無料プランは1日1,000書き込み。書き込むのはログイン経路
// だけで、翻訳経路は署名済みトークンを検証するだけの読み取りゼロにしてある。
// 施術中に何十回も翻訳しても KV の枠を消費しない。

const OTP_TTL_SECONDS = 600;
const RESEND_COOLDOWN_SECONDS = 60;
const DAILY_CODE_LIMIT = 5;
const MAX_CODE_ATTEMPTS = 5;

const kStaff = (email) => `staff:${email}`;
const kOtp = (email) => `otp:${email}`;
const kCooldown = (email) => `rl:cool:${email}`;
const kDaily = (email) => `rl:day:${email}`;
const kSeen = (email) => `seen:${email}`;

export async function isAllowed(env, email) {
  return (await env.AUTH.get(kStaff(email))) !== null;
}

/**
 * メールアドレス単位の制限。{ok:true} か {ok:false, reason, retryAfterSec} を返す。
 * 送信前に確認するので、特定アドレスを叩かれても日次のメール枠を焼かれない。
 */
export async function checkEmailRate(env, email) {
  if (await env.AUTH.get(kCooldown(email))) {
    return { ok: false, reason: "cooldown", retryAfterSec: RESEND_COOLDOWN_SECONDS };
  }
  const used = Number((await env.AUTH.get(kDaily(email))) || 0);
  if (used >= DAILY_CODE_LIMIT) {
    return { ok: false, reason: "daily_limit", retryAfterSec: 3600 };
  }
  return { ok: true };
}

export async function markCodeSent(env, email) {
  const used = Number((await env.AUTH.get(kDaily(email))) || 0);
  await Promise.all([
    env.AUTH.put(kCooldown(email), "1", { expirationTtl: RESEND_COOLDOWN_SECONDS }),
    env.AUTH.put(kDaily(email), String(used + 1), { expirationTtl: 86400 }),
  ]);
}

export async function putOtp(env, email, hash) {
  const record = { hash, exp: Date.now() + OTP_TTL_SECONDS * 1000, attempts: 0 };
  await env.AUTH.put(kOtp(email), JSON.stringify(record), { expirationTtl: OTP_TTL_SECONDS });
  return OTP_TTL_SECONDS;
}

export async function getOtp(env, email) {
  const raw = await env.AUTH.get(kOtp(email));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function clearOtp(env, email) {
  await env.AUTH.delete(kOtp(email));
}

/**
 * 失敗を1回数える。MAX_CODE_ATTEMPTS に達したらコード自体を消すので、
 * 総当たりは「1コードにつき5回 × 1日5コード」に抑えられる。残り回数を返す。
 */
export async function bumpAttempts(env, email, record) {
  const attempts = (record.attempts || 0) + 1;
  if (attempts >= MAX_CODE_ATTEMPTS) {
    await clearOtp(env, email);
    return 0;
  }
  const remainingTtl = Math.max(60, Math.ceil((record.exp - Date.now()) / 1000));
  await env.AUTH.put(
    kOtp(email),
    JSON.stringify({ ...record, attempts }),
    { expirationTtl: remainingTtl },
  );
  return MAX_CODE_ATTEMPTS - attempts;
}

/** ログイン成功時にだけ書く（上の書き込み回数の注意を参照）。 */
export async function recordLogin(env, email) {
  let prev = { count: 0 };
  const raw = await env.AUTH.get(kSeen(email));
  if (raw) {
    try {
      prev = JSON.parse(raw);
    } catch {
      /* 壊れていたら無視して上書き */
    }
  }
  await env.AUTH.put(
    kSeen(email),
    JSON.stringify({ last: new Date().toISOString(), count: (prev.count || 0) + 1 }),
  );
}
