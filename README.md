# KIZU 翻訳 / KIZU Chiropractic Translator

KIZUカイロプラクティックに来院する英語圏の患者さんと、スタッフのための
日本語⇄英語コミュニケーション支援アプリ（PWA）。

受付 → 問診 → 施術中 → 施術後の説明 → 会計・予約 の全フローをカバーします。

- **アプリ**: https://kizuchiro7-ops.github.io/kizu-translate/
- **翻訳API**: https://kizu-translate.kizuchiro7.workers.dev （`/health` で疎通確認）

```
kizu-translate/
├── web/                     ← スマホに入れるアプリ本体（静的ファイルのみ）
│   ├── index.html           … アプリ全体（フレーズ集・UI・ロジックが1ファイル）
│   ├── manifest.webmanifest … ホーム画面追加の設定
│   ├── sw.js                … オフライン動作
│   ├── icon.svg / icon-192.png / icon-512.png / apple-touch-icon.png
└── worker/                  ← AI翻訳のバックエンド（Cloudflare Worker）
    ├── src/index.js
    └── wrangler.toml
```

## できること

| 機能 | 通信 | 説明 |
|---|---|---|
| 定型フレーズ集（264文） | **不要** | スタッフ用190文 + 患者用74文。5カテゴリ。タップで両言語を大きく表示 |
| 読み上げ | 不要 | 端末内蔵の音声合成。日本語・英語それぞれ、患者向けにやや遅めの速度 |
| 人体図 | 不要 | 前面/背面の42部位。患者さんにタップしてもらい、部位名を日英で確定 |
| 痛みスケール 0〜10 | 不要 | 数字＋日英の程度表現 |
| 選択式問診 | 不要 | 痛みの種類／いつから／経過 を患者さんにタップで選んでもらう |
| 金額・時間の差し込み | 不要 | `◯◯円` などに数字を入力。端末ごとに保存されるので施術者別の料金に対応 |
| よく使う（★） | 不要 | 端末ごとに保存 |
| AI翻訳 | **必要** | 定型にない内容をその場で翻訳。音声入力対応 |

**院内のWi-Fiが切れてもAI翻訳以外はすべて動きます。**

### 使い方の要点

- 上部の「スタッフ→患者 / 患者→スタッフ」で、**自分が読む言語**が主表示に切り替わります。
- フレーズをタップすると全画面で大きく出るので、**そのまま相手に画面を見せます**。
  左右スワイプで前後のフレーズへ移動できます。
- ⚠️ 危険信号のスクリーニング項目には、患者さんには表示されない
  **スタッフ向けメモ**（🔒）が一覧側にだけ付いています。

## セットアップ

### 1. 金額・時間の入力について（事前設定は不要）

料金は施術者ごと・初回/2回目で違うため、**アプリ側に固定値は持たせていません**。
`◯◯円` `___分` を含むフレーズを開くと上部に入力欄が出るので、そこに数字を入れます。

入力した値は**その端末のそのフレーズに保存される**ので、スタッフ各自のスマホには
自分の料金が入ったまま残ります。次回からは開くだけで正しい金額が表示されます。
入力欄の見出し（円・分・回など）は日本語文から自動で拾っています。

日本語の `◯` と英語の `___` は同じ順番で対応します。フレーズを追加するときは
**両言語で個数を揃えてください**（数が合わない分は差し込まれません）。

```bash
grep -n "◯\|___" web/index.html
```

### 2. Worker（AI翻訳）をデプロイ

```bash
cd worker && npx wrangler deploy
```

続けてシークレットを設定します。

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

```bash
npx wrangler secret put CLINIC_KEY
```

`CLINIC_KEY` は `web/index.html` の `const CLINIC_KEY = "..."` と同じ値にしてください。
本物の認証ではなく、Worker のURLを見つけたボットに API クレジットを使わせないための足止めです。

動作確認:

```bash
curl -s https://kizu-translate.kizuchiro7.workers.dev/health
```

### 3. Web側の更新（GitHub Pages）

`main` に `web/` を編集してコミットしたあと、`gh-pages` ブランチへ反映します。
Pages は `gh-pages` ブランチのルートを配信しています。

```bash
git subtree push --prefix web origin gh-pages
```

反映には30〜60秒かかります。確認:

```bash
curl -s https://kizuchiro7-ops.github.io/kizu-translate/ | grep -c ようこそ
```

スマホ側は Service Worker がHTMLを network-first で取りに行くので、
アプリを開き直せば新しいフレーズが反映されます。

### 4. スマホに入れる

https://kizuchiro7-ops.github.io/kizu-translate/ を開いて:

- **iPhone**: Safari で開く →「共有」→「ホーム画面に追加」
- **Android**: Chrome で開く → メニュー →「アプリをインストール」

ホーム画面のアイコンから起動すると、アドレスバーのない通常のアプリとして開きます。

## 運用上の注意

- カイロプラクティックは日本では医療行為ではないため、英訳は意図的に
  `treatment` / `diagnosis` ではなく `care` / `assessment` を使っています。
  Worker のシステムプロンプトにも同じ制約を入れてあります。
- AI翻訳は入力文を**データとして**扱うよう指示済みですが、医療的に重要な内容は
  必ず定型フレーズ側を使ってください。
- 患者さんの入力内容は端末の localStorage に最大30件残ります（翻訳履歴）。
  共有端末で運用する場合は、必要に応じて履歴機能を外してください。

## コスト

- Web（GitHub Pages）: 無料
- Cloudflare Worker: 無料枠（1日10万リクエスト）で十分
- AI翻訳: 1回あたり概ね 1円未満。定型フレーズを使う限り課金は発生しません
