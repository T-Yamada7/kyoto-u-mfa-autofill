# 京大PandA MFA自動入力 Chrome拡張機能

京都大学の **PandA / SSO** ログインで毎回出てくる **ワンタイムパスワード (OTP)** の入力作業を全自動化する Chrome 拡張機能。

- 「『多要素認証：メール』ログインはこちら」を自動クリック
- 確認ダイアログの **Yes** を自動クリック
- **Gmail API** で OTP メールを自動取得
- OTP を自動入力して **ログイン**ボタンを自動クリック

> **対応:** `https://auth.iimc.kyoto-u.ac.jp/` のメール認証フロー (`ninsho-qa@iimc.kyoto-u.ac.jp` から届くOTPメール)
>
> **対応メール:** **Gmail** または **Outlook (Microsoft 365 / 京大メール)** から選択可能。
> 京大メール (`@st.kyoto-u.ac.jp` など) は Microsoft 365 ベースなので Outlook で直接読めます。Gmail 転送は不要。

---

## ⚠ 配布形態と前提

これは **Chrome Web Store には公開していません**。各自で:
1. このリポジトリを clone / ダウンロード
2. **使うメールに応じてOAuthクライアントを作成**
   - Gmail を使う場合 → Google Cloud Console
   - Outlook (京大メール含む) を使う場合 → Microsoft Azure
3. Chrome の「デベロッパーモード」で **未パッケージの拡張機能を読み込む**

…という手順でインストールします。所要時間: 約10〜15分。

なぜ各自で OAuth を作る必要があるのか:
- メール読み取りスコープ (`gmail.readonly` / `Mail.Read`) は制限付きで、公開アプリ化には Google/Microsoft の審査 (数週間 + 年次セキュリティ評価) が必要
- 個人利用 / 友人配布レベルでは「各自が自分の OAuth クライアントを作って自分のメールにだけアクセスする」のが最も健全

---

## 📦 インストール手順

### Step 1: ソースコードを取得

```bash
git clone https://github.com/T-Yamada7/kyoto-u-mfa-autofill.git
cd kyoto-u-mfa-autofill
```

または GitHub の「Code → Download ZIP」で zip ダウンロード → 展開。

### Step 2A: 【Gmailを使う場合】Google Cloud プロジェクトと OAuth クライアントを作成

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

### Step 2B: 【Outlook (京大メール) を使う場合】Microsoft Azure でアプリ登録

1. <https://portal.azure.com/> にアクセス（京大メールアカウントでサインインでOK）
2. 「**Microsoft Entra ID**」(旧 Azure AD) を検索
3. 左メニュー「**アプリの登録**」→「**+ 新規登録**」
   - 名前: 何でもOK (例: `PandA MFA Autofill`)
   - サポートされるアカウントの種類: **「任意の組織ディレクトリ内のアカウント + 個人用Microsoftアカウント」**
   - リダイレクトURI: いったん空欄でOK (Step 3 で設定する)
4. 登録が完了したら、画面上部の「**アプリケーション (クライアント) ID**」をコピーして保管 ← 重要
5. 左メニュー「**APIのアクセス許可**」→「**+ アクセス許可の追加**」→「**Microsoft Graph**」→「**委任されたアクセス許可**」→ `Mail.Read` をチェック → 「アクセス許可の追加」
6. 左メニュー「**認証**」を開く
   - 「**+ プラットフォームを追加**」→「**シングルページ アプリケーション**」を選ぶ
   - リダイレクトURI: **`https://<拡張機能ID>.chromiumapp.org/`** （`<拡張機能ID>` は Step 3 で取得した値）
   - その下の「**暗黙的な許可とハイブリッド フロー**」セクション → 「**アクセス トークン**」にチェック → 「**保存**」

### Step 3: 拡張機能を Chrome に読み込む

1. Chrome で `chrome://extensions` を開く
2. 右上「**デベロッパー モード**」を ON
3. 「**パッケージ化されていない拡張機能を読み込む**」→ clone した `kyoto-u-mfa-autofill` フォルダを選択
4. 表示された **拡張機能 ID** をコピー（例: `abcdefghijklmnop...`）
5. Step 2A を選んだ人 → Google Cloud Console の OAuth クライアントの「**アプリケーション ID**」に貼り付けて保存
6. Step 2B を選んだ人 → Azure ポータルの「認証」→ SPAリダイレクトURIを `https://<拡張機能ID>.chromiumapp.org/` に設定して保存

### Step 4: manifest.json にクライアントIDを設定 (Gmail のみ)

**Gmail を使う場合**のみ、`manifest.json` の `client_id` を書き換える:

```json
"oauth2": {
  "client_id": "YOUR_OAUTH_CLIENT_ID.apps.googleusercontent.com",
  ...
}
```

Outlook を使う場合は manifest.json は触らない。Outlook の Client ID は popup の「詳細設定」で入力する（後述）。

書き換えたら `chrome://extensions` で拡張の **🔄 (更新)** ボタンを押す。

> 💡 編集後に誤って git push してしまわないように、以下を実行しておくと安全:
> ```bash
> git update-index --skip-worktree manifest.json
> ```

### Step 5: 拡張機能で認証

1. 拡張機能アイコン（パズルピース）→ 「京大PandA MFA自動入力」をピン留め
2. ピン留めしたアイコンをクリック → ポップアップが開く
3. 一番上の「**メールプロバイダ**」で **Gmail** か **Outlook** を選択
4. **Outlook を選んだ場合**は「詳細設定」を開いて **Outlook Client ID** に Step 2B-4 でコピーした値を貼り付け → 「保存」
5. 「**サインイン**」をクリック → 認証画面が出るので承認
6. 「Gmail/Outlook 認証済み」と表示されれば完了

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
| メールプロバイダ | Gmail | Gmail / Outlook を切替 |
| Gmail 送信元 | `ninsho-qa@iimc.kyoto-u.ac.jp` | Gmail検索の `from:` |
| Gmail検索クエリ | `subject:(ワンタイムパスワード OR "one time password" OR OTP OR 認証コード) newer_than:1h` | Gmail 検索クエリ |
| Outlook Client ID | - | Azure で取得した値 |
| Outlook 送信元 | `ninsho-qa@iimc.kyoto-u.ac.jp` | Graph API の `$filter` で使う |
| Outlook 検索クエリ | `subject:(ワンタイムパスワード OR ...)` | 件名で絞り込み（簡易KQL） |
| 自動入力を有効にする | ON | 一時的に止めたいときOFF |

---

## 🔐 セキュリティとプライバシー

- 要求するスコープは **`gmail.readonly`** または **`Mail.Read`** のみ（メール閲覧のみ。送信・削除・他人への共有は不可能）
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
| 「サインイン失敗: bad client id」 | (Gmail) manifest.json のClient IDが違う、または拡張機能IDがGCPに未登録 |
| 「サインイン失敗: access_denied」 | (Gmail) OAuth同意画面のテストユーザに自分を追加してない |
| 「OAuth state mismatch」 | (Outlook) 拡張機能IDをAzureのリダイレクトURIに正しく登録できているか確認 |
| 「authorization cancelled」 | (Outlook) ログイン画面でユーザがキャンセル / リダイレクトURI不一致 |
| 「Outlook Client ID が設定されていません」 | popup詳細設定にAzureのClient IDを入れて保存 |
| ログに何も出ない | 拡張機能が当該ページに注入されてない。`chrome://extensions` でリロード |
| 「OTPメールがタイムアウト」 | メールにOTPが届いてない、または検索条件が合ってない。OTPメールの**送信元**を popup「送信元」欄に貼って保存 |
| MFA画面で何も起きない | DevTools Console (F12) で `[kyoto-u-mfa-autofill]` ログを確認 |

---

## 🛠 開発

```
kyoto-u-mfa-autofill/
├── manifest.json        # Manifest V3
├── background.js        # Service Worker (プロバイダ非依存のコーディネータ)
├── providers/
│   ├── gmail.js         # Gmail API プロバイダ
│   ├── outlook.js       # Microsoft Graph (Outlook/京大メール) プロバイダ
│   └── extract.js       # OTP抽出 (共通)
├── content.js           # MFA画面のDOM操作 (リンククリック / Yes / OTP入力)
├── popup.{html,js,css}  # ポップアップUI (プロバイダ選択含む)
├── icons/               # 拡張機能アイコン
├── LICENSE              # MIT
└── README.md
```

新しいメールプロバイダを追加する場合、`providers/` に `signIn / signOut / isAuthenticated / fetchOTPOnce` を実装するモジュールを追加して `background.js` の `PROVIDERS` に登録するだけ。

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
