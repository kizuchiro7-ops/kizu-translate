// ログインコードの送信。Resend の REST API を素の fetch で叩く
// (SDKを入れないことで Worker を依存ゼロ・ビルド不要のまま保つ)。
//
// 送信ドメインは KIZU AI と共用の bwm-kid.com。SPF/DKIM/DMARC が設定済みで
// 実績があるため。kizuchiro.com は本番のメールが動いているので触らない。

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function buildText(code) {
  return `KIZU 翻訳（院内スタッフ用）のログインコードです。

  ログインコード: ${code}

このコードをアプリの画面に入力してください。有効期限は10分間です。

このメールに心当たりがない場合は破棄してください。
コードは第三者に教えないでください。

――――――――――――――――
KIZUカイロプラクティック
`;
}

function buildHtml(code) {
  // 意図的に素朴なHTML。装飾の重いメールは迷惑メール判定を受けやすく、
  // 携帯キャリアのメールアプリでの表示も崩れやすい。
  return `<div style="font-family:sans-serif;line-height:1.8;color:#12232b">
<p>KIZU 翻訳（院内スタッフ用）のログインコードです。</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px;color:#0f766e;margin:24px 0">${code}</p>
<p>このコードをアプリの画面に入力してください。有効期限は<strong>10分間</strong>です。</p>
<p style="font-size:13px;color:#5b7180">このメールに心当たりがない場合は破棄してください。コードは第三者に教えないでください。</p>
<hr style="border:none;border-top:1px solid #dde5ea;margin:24px 0">
<p style="font-size:12px;color:#8fa3ad">KIZUカイロプラクティック</p>
</div>`;
}

/**
 * {ok:true} か {ok:false, reason} を返す。Resend が日次上限を報告した場合は
 * reason が "quota" になるので、呼び出し側が専用のメッセージを出せる。
 */
export async function sendOtpEmail(env, to, code) {
  const body = {
    from: env.EMAIL_FROM,
    to: [to],
    subject: `【KIZU 翻訳】ログインコード ${code}`,
    text: buildText(code),
    html: buildHtml(code),
  };
  if (env.EMAIL_REPLY_TO) body.reply_to = env.EMAIL_REPLY_TO;

  let resp;
  try {
    resp = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, reason: "network", detail: err.message };
  }

  if (resp.ok) return { ok: true };

  const detail = await resp.text();
  const isQuota = resp.status === 429 || /quota|rate.?limit|daily/i.test(detail);
  return { ok: false, reason: isQuota ? "quota" : "send_failed", status: resp.status, detail };
}
