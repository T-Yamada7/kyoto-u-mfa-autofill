// providers/outlook.js
// Microsoft Graph API プロバイダ (Outlook / 京大メール対応)
//
// 認証フロー: OAuth 2.0 Implicit Grant
//   - chrome.identity.launchWebAuthFlow で MS のログイン画面を開く
//   - access_token をURLフラグメントから取得
//   - chrome.storage.local に有効期限付きで保存
//
// 要 Azure 設定:
//   - アプリ登録 → 「シングルページ アプリケーション (SPA)」
//   - リダイレクトURI: https://<extension-id>.chromiumapp.org/
//   - API アクセス許可: Microsoft Graph → Mail.Read (delegated)
//   - 認証 → 「暗黙的な許可とハイブリッド フロー」→ アクセストークン: ON

import { extractOTP, stripHtml } from './extract.js';

const MS_AUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';
const SCOPE = 'https://graph.microsoft.com/Mail.Read';

// トークン格納キー
const TOKEN_KEY = 'outlookToken';
const TOKEN_EXP_KEY = 'outlookTokenExpiresAt';

export const OutlookProvider = {
  id: 'outlook',
  label: 'Outlook (Microsoft 365 / 京大メール)',

  defaults: {
    // Outlookは $filter で送信元と日時を厳密指定するのでクエリ形式が異なる
    senderFilter: 'ninsho-qa@iimc.kyoto-u.ac.jp',
    searchQuery: 'subject:(ワンタイムパスワード OR "one time password" OR OTP)',
  },

  // ----------------------------------------------------------------
  // 認証
  // ----------------------------------------------------------------
  async signIn({ clientId } = {}) {
    if (!clientId) throw new Error('Outlook Client ID が設定されていません (popupの詳細設定で入力してください)');

    const redirectUri = chrome.identity.getRedirectURL();
    const state = Math.random().toString(36).slice(2);
    const nonce = Math.random().toString(36).slice(2);

    const authUrl = new URL(MS_AUTH_BASE);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', SCOPE);
    authUrl.searchParams.set('response_mode', 'fragment');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('nonce', nonce);
    authUrl.searchParams.set('prompt', 'select_account');

    const responseUrl = await new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(
        { url: authUrl.toString(), interactive: true },
        (redirected) => {
          if (chrome.runtime.lastError || !redirected) {
            reject(new Error(chrome.runtime.lastError?.message || 'authorization cancelled'));
          } else {
            resolve(redirected);
          }
        }
      );
    });

    const params = this._parseFragment(responseUrl);
    if (params.error) {
      throw new Error(`Microsoft auth error: ${params.error_description || params.error}`);
    }
    if (params.state !== state) {
      throw new Error('OAuth state mismatch (CSRF防止)');
    }
    if (!params.access_token) {
      throw new Error('access_token が応答に含まれていません');
    }
    const expiresIn = parseInt(params.expires_in || '3600', 10);
    const expiresAt = Date.now() + expiresIn * 1000 - 60_000; // 60秒余裕
    await chrome.storage.local.set({
      [TOKEN_KEY]: params.access_token,
      [TOKEN_EXP_KEY]: expiresAt,
    });
    return true;
  },

  async signOut() {
    await chrome.storage.local.remove([TOKEN_KEY, TOKEN_EXP_KEY]);
  },

  async _getStoredToken() {
    const r = await chrome.storage.local.get([TOKEN_KEY, TOKEN_EXP_KEY]);
    if (!r[TOKEN_KEY]) return null;
    if (r[TOKEN_EXP_KEY] && Date.now() > r[TOKEN_EXP_KEY]) return null;
    return r[TOKEN_KEY];
  },

  async isAuthenticated() {
    const t = await this._getStoredToken();
    return Boolean(t);
  },

  _parseFragment(url) {
    const u = new URL(url);
    const hash = (u.hash || '').replace(/^#/, '');
    const out = {};
    for (const [k, v] of new URLSearchParams(hash)) out[k] = v;
    return out;
  },

  // ----------------------------------------------------------------
  // Microsoft Graph API
  // ----------------------------------------------------------------
  async _fetch(path, token) {
    const url = path.startsWith('http') ? path : `${GRAPH_API_BASE}${path}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (res.status === 401) {
      await this.signOut();
      throw new Error('Outlook認証が切れました。再サインインしてください。');
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Graph API error: ${res.status} ${t}`);
    }
    return res.json();
  },

  _extractBodyText(message) {
    const body = message.body || {};
    if (!body.content) return message.bodyPreview || '';
    if (body.contentType === 'html') return stripHtml(body.content);
    return body.content;
  },

  // ----------------------------------------------------------------
  // OTP取得 (1回試行)
  // ----------------------------------------------------------------
  async fetchOTPOnce({ triggerMs, senderFilter, searchQuery, clientId } = {}) {
    const token = await this._getStoredToken();
    if (!token) throw new Error('Outlook未認証 (popupからサインインしてください)');

    // 検索範囲: triggerMs より少し前から (60秒バッファ)
    const sinceMs = (triggerMs ?? Date.now()) - 60_000;
    const sinceIso = new Date(sinceMs).toISOString();

    // $filter で「送信元」と「受信日時」を絞る。
    // Graphの$filterはOData記法。文字列値はシングルクォート。
    const filters = [`receivedDateTime ge ${sinceIso}`];
    if (senderFilter) {
      filters.push(`from/emailAddress/address eq '${senderFilter.replace(/'/g, "''")}'`);
    }
    const filterParam = filters.join(' and ');

    const qs = new URLSearchParams({
      $filter: filterParam,
      $top: '10',
      $orderby: 'receivedDateTime desc',
      $select: 'id,subject,receivedDateTime,from,bodyPreview,body',
    });

    const list = await this._fetch(`/me/messages?${qs.toString()}`, token);
    const messages = list.value || [];

    // triggerMs より新しいメールに限定 (filterで既に絞ってはいるが二重チェック)
    const candidates = messages
      .map((m) => ({ m, ts: new Date(m.receivedDateTime).getTime() }))
      .filter((x) => !triggerMs || x.ts >= triggerMs)
      .sort((a, b) => b.ts - a.ts);

    for (const { m } of candidates) {
      // 件名フィルタ (searchQueryを簡易的にキーワード判定で適用)
      if (searchQuery && !this._matchesSubject(m.subject || '', searchQuery)) continue;
      const body = this._extractBodyText(m);
      const otp = extractOTP(body);
      if (otp) {
        return { otp, messageId: m.id, snippet: m.bodyPreview || '' };
      }
    }
    return null;
  },

  // searchQueryは "subject:(A OR B)" 形式を簡易パースして件名に含まれるかチェック
  // フル機能のKQLは実装しない (実用上はsenderFilter+receivedDateTimeで十分絞れる)
  _matchesSubject(subject, searchQuery) {
    if (!searchQuery) return true;
    const lower = subject.toLowerCase();
    // subject:(...) の括弧内を抽出
    const m = searchQuery.match(/subject:\s*\(([^)]+)\)/i);
    const inside = m ? m[1] : searchQuery;
    // ORで分割。引用符は除去。
    const terms = inside.split(/\s+OR\s+/i).map((t) => t.replace(/^["']|["']$/g, '').trim().toLowerCase()).filter(Boolean);
    if (!terms.length) return true;
    return terms.some((t) => lower.includes(t));
  },
};
