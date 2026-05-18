# 京大PandA MFA自動入力 Chrome拡張機能

京都大学の **PandA / SSO** ログインで毎回出てくる **ワンタイムパスワード (OTP)** の入力作業を全自動化する Chrome 拡張機能。

- 「『多要素認証：メール』ログインはこちら」を自動クリック
- 確認ダイアログの **Yes** を自動クリック
- **Gmail API** で OTP メールを自動取得
- OTP を自動入力して **ログイン**ボタンを自動クリック

> **対応:** `https://auth.iimc.kyoto-u.ac.jp/` のメール認証フロー (`ninsho-qa@iimc.kyoto-u.ac.jp` から届くOTPメール)
>
> **前提:** 普段のログインで OTP が **Gmail に届く** こと（京大メールを Gmail に転送している人含む）

---

## 📨 京大メール (`@st.kyoto-u.ac.jp`) しか使ってない人へ

この拡張機能は **Gmail 専用** です。京大メール (Microsoft 365 ベース) を使っている人は、**京大メール → Gmail への転送設定** を済ませてから使ってください。所要時間 5分。

### 京大メール (Outlook web) での転送設定

1. <https://outlook.office.com/> にサインイン（@st.kyoto-u.ac.jp）
2. 右上の歯車（⚙）→ 一番下の「**Outlook のすべての設定を表示**」
3. 「メール」→「**転送**」
4. 「**転送を有効にする**」にチェック
5. 「メールの転送先」に **自分の Gmail アドレス** を入力
6. (お好みで)「**転送されたメッセージのコピーを保持する**」にチェック
7. 「保存」

これで `ninsho-qa@iimc.kyoto-u.ac.jp` から届く OTP メールが Gmail にも飛んでくるので、本拡張機能で読めるようになります。

> 💡 Gmail アカウント自体を持っていない場合は、<https://accounts.google.com/signup> で1分で作れます。OTP受信専用に使うだけなら個人情報の登録は最小限でOK。

---

## ⚠ 配布形態と前提

これは **Chrome Web Store には公開していません**。各自で:
1. このリポジトリを clone / ダウンロード
2. **自分の Google Cloud プロジェクトで OAuth クライアントを作成**
3. Chrome の「デベロッパーモード」で **未パッケージの拡張機能を読み込む**

…という手順でインストールします。所要時間: 約10分。

なぜ各自で OAuth を作る必要があるのか:
- Gmail API の `gmail.readonly` スコープは Google の制限付きスコープで、公開アプリにするには Google の審査 (数週間 + 年次セキュリティ評価) が必要
- 個人利用 / 友人配布レベルでは「各自が自分の GCP プロジェクトで OAuth クライアントを作って自分のメールにだけアクセスする」のが最も健全

---

## 📦 インストール手順

### Step 1: ソースコードを取得

```bash
git clone https://github.com/T-Yamada7/kyoto-u-mfa-autofill.git
cd kyoto-u-mfa-autofill
```

または GitHub の「Code → Download ZIP」で zip ダウンロード → 展開。

### Step 2: Google Cloud プロジェクトと OAuth クライアントを作成

1. <https://console.cloud.google.com/> にアクセス（普段使っている Google アカウントでOK）
2. 上部のプロジェクトセレクタ → 「新しいプロジェクト」→ 名前は何でもOK (例: `panda-mfa`)
3. 「APIとサービス」→「ライブラリ」→ **Gmail API** を検索して「有効にする」
4. 「APIとサービス」→「OAuth 同意画面」
   - User Type: **外部**
   - アプリ名: 何でもOK (例: `PandA MFA Autofill`)
   - ユーザーサポートメール / デベロッパー連絡先: 自分のメール
   - スコープ画面では何も追加しなくてOK（「保存して次へ」）
   - **テストユーザー**: 自分の Gmail アドレスを追加 ← 重要
5. 「APIとサービス」→「認証情報」→「+ 認証情報を作成」→「OAuth クライアントID」
   - アプリケーションの種類: **Chrome 拡張機能**
   - 名前: 何でもOK
   - **アプリケーション ID**: 次のStep 3で取得する拡張機能ID
6. クライアントIDが発行される (`123456789-xxxxx.apps.googleusercontent.com`) → コピーして保管

### Step 3: 拡張機能を Chrome に読み込む

1. Chrome で `chrome://extensions` を開く
2. 右上「**デベロッパー モード**」を ON
3. 「**パッケージ化されていない拡張機能を読み込む**」→ clone した `kyoto-u-mfa-autofill` フォルダを選択
4. 表示された **拡張機能 ID** をコピー（例: `abcdefghijklmnop...`）
5. Google Cloud Console に戻って Step 2-5 の OAuth クライアントの「**アプリケーション ID**」に貼り付けて保存

### Step 4: manifest.json にクライアントIDを設定

`manifest.json` を開いて、以下の行の `YOUR_OAUTH_CLIENT_ID...` を Step 2-6 で取得したクライアントIDに書き換える:

```json
"oauth2": {
  "client_id": "YOUR_OAUTH_CLIENT_ID.apps.googleusercontent.com",
  ...
}
```

書き換えたら `chrome://extensions` の拡張機能ページでこの拡張の **🔄 (更新)** ボタンを押す。

> 💡 編集後に誤って git push してしまわないように、以下を実行しておくと安全:
> ```bash
> git update-index --skip-worktree manifest.json
> ```

### Step 5: Gmail にサインイン

1. 拡張機能アイコン（パズルピース）→ 「京大PandA MFA自動入力」をピン留め
2. ピン留めしたアイコンをクリック → ポップアップが開く
3. 「**Gmailにサインイン**」をクリック → Google の認証画面が出るので承認
4. 「Gmail認証 認証済み」と表示されれば完了

---

## 🚀 使い方

セットアップが終われば、もう何もしなくてOK。

1. 普通にPandA (<https://panda.ecs.kyoto-u.ac.jp/>) や ECS-IDログインが必要なサービスにアクセス
2. ID / Pass を入力（Chrome のオートフィルが効くはず）
3. MFA画面に遷移 → **自動で全部やってくれる**:
   - メール認証に切替
   - OTPメール送信を承認
   - Gmail からOTP取得
   - 自動入力
   - ログイン

---

## ⚙ オプション設定

ポップアップ右下「**詳細設定**」を開くと:

| 項目 | デフォルト | 説明 |
|---|---|---|
| 送信元アドレスで絞り込む | `ninsho-qa@iimc.kyoto-u.ac.jp` | OTPメール送信元 |
| Gmail検索クエリ | `subject:(ワンタイムパスワード OR "one time password" OR OTP OR 認証コード) newer_than:1h` | Gmail 検索クエリ |
| 自動入力を有効にする | ON | 一時的に止めたいときOFF |

---

## 🔐 セキュリティとプライバシー

- 要求するスコープは **`gmail.readonly`** のみ（メール閲覧のみ。送信・削除・他人への共有は不可能）
- **OTPコードはディスクに保存しません** （メモリ上のみ、ポップアップ表示はマスク `12**78`）
- **パスワードは扱いません**（Chrome 本体の自動入力に任せる）
- content script は `auth.iimc.kyoto-u.ac.jp` と `lms.gakusei.kyoto-u.ac.jp` にしか注入されません
- すべて手元で動作。**外部サーバへの送信は一切なし** (Gmail API への通信を除く)
- 各ユーザは自分の GCP プロジェクト・自分のGmailで完結 → 開発者が他人のメールを覗くことは構造的に不可能

ソースコードは全部このリポジトリにあります。気になる人は読んでください（合計1000行程度）。

---

## 🐛 動かないとき

ポップアップ右下の「**ログ**」を見ると、どこで詰まっているか分かります。

| 症状 | 原因 / 対処 |
|---|---|
| 「サインイン失敗: bad client id」 | manifest.json のClient IDが間違い、または拡張機能IDがGCPに登録されてない |
| 「サインイン失敗: access_denied」 | OAuth同意画面のテストユーザに自分を追加してない |
| ログに何も出ない | 拡張機能が当該ページに注入されてない。`chrome://extensions` でリロード |
| 「OTPメールがタイムアウト」 | Gmail にOTPが届いてない、または検索クエリが合ってない。OTPメールの**送信元**を popup の「送信元アドレスで絞り込む」に貼って保存 |
| MFA画面で何も起きない | DevTools Console (F12) で `[kyoto-u-mfa-autofill]` ログを確認 |

---

## 🛠 開発

```
kyoto-u-mfa-autofill/
├── manifest.json     # Manifest V3
├── background.js     # Service Worker (Gmail API + OTP抽出 + ポーリング)
├── content.js        # MFA画面のDOM操作 (リンククリック / Yes / OTP入力)
├── popup.{html,js,css}  # ポップアップUI
├── icons/            # 拡張機能アイコン
├── LICENSE           # MIT
└── README.md
```

技術スタック: バニラ JS、ビルドツールなし。`chrome://extensions` のリロードだけで反映。

PR / Issue 歓迎。特に:
- OTPメールの送信元・件名が変わった場合（IIMCが仕様変更した時）
- 他大学版への移植
- アプリ認証（TOTP）対応

---

## 📄 License

[MIT](./LICENSE)

---

## 🙋 既知の制限

- Chrome Web Store には公開していない（公開には Google の本審査が必要）
- Service Worker は idle で落ちるので、OTP取得は 30 秒以内に完結する設計
- メール転送の遅延が大きい場合は届く前にタイムアウトする可能性あり
- IIMC が MFA フローを変更した場合は更新が必要
