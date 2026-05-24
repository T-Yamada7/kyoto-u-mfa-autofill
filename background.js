// background.js (Service Worker)
// Gmail APIとの通信・OTP抽出・ポーリングを担当

const GMAIL_API_BASE = 'https://www.googleapis.com/gmail/v1/users/me';

// ポーリング設定
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 20; // 1.5s * 20 = 30s

// Gmail検索クエリ（京大IIMC: 件名 "ワンタイムパスワードのお知らせ / Notification of one time password"）
const DEFAULT_GMAIL_QUERY_TEMPLATE =
  'subject:(ワンタイムパスワード OR "one time password" OR OTP OR 認証コード) newer_than:1h';

// 京大IIMC のOTPメール送信元
const DEFAULT_SENDER_FILTER = 'ninsho-qa@iimc.kyoto-u.ac.jp';

// ---------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------
async function getSettings() {
  const defaults = {
    enabled: true,
    gmailQuery: DEFAULT_GMAIL_QUERY_TEMPLATE,
    senderFilter: DEFAULT_SENDER_FILTER,
    lastResult: null,
  };
  const stored = await chrome.storage.local.get(defaults);
  return { ...defaults, ...stored };
}

async function setLastResult(result) {
  const payload = { ...result, timestamp: Date.now() };
  await chrome.storage.local.set({ lastResult: payload });
  return payload;
}

// ---------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------
function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || 'No token returned'));
        return;
      }
      resolve(token);
    });
  });
}

function removeCachedToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

async function gmailFetch(path, token) {
  const url = path.startsWith('http') ? path : `${GMAIL_API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    await removeCachedToken(token);
    const fresh = await getAuthToken(false).catch(() => null);
    if (fresh && fresh !== token) {
      const retry = await fetch(url, { headers: { Authorization: `Bearer ${fresh}` } });
      if (!retry.ok) throw new Error(`Gmail API error: ${retry.status}`);
      return retry.json();
    }
    throw new Error('Gmail認証が切れました。再認証が必要です。');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gmail API error: ${res.status} ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------
// Gmail検索 / メール本文取得 / OTP抽出
// ---------------------------------------------------------------
function buildQuery(settings, afterTimestampSec) {
  const parts = [];
  if (settings.senderFilter) {
    parts.push(`from:${settings.senderFilter}`);
  }
  if (settings.gmailQuery) {
    parts.push(settings.gmailQuery);
  }
  if (afterTimestampSec) {
    parts.push(`after:${afterTimestampSec}`);
  }
  return parts.join(' ');
}

async function listOTPMessages(token, query) {
  const data = await gmailFetch(
    `/messages?q=${encodeURIComponent(query)}&maxResults=5`,
    token
  );
  return data.messages || [];
}

async function getMessage(token, messageId) {
  return gmailFetch(`/messages/${messageId}?format=full`, token);
}

function base64UrlDecode(str) {
  if (!str) return '';
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 ? padded + '='.repeat(4 - (padded.length % 4)) : padded;
  try {
    // バイナリ→UTF-8
    const binary = atob(pad);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) {
    return '';
  }
}

function extractBodyText(payload) {
  if (!payload) return '';
  const buckets = [];

  function walk(part) {
    if (!part) return;
    if (part.body && part.body.data) {
      const text = base64UrlDecode(part.body.data);
      if (text) buckets.push({ mimeType: part.mimeType || '', text });
    }
    if (Array.isArray(part.parts)) {
      part.parts.forEach(walk);
    }
  }
  walk(payload);

  // text/plain優先、無ければtext/html、最後にその他
  const plain = buckets.find((b) => b.mimeType.startsWith('text/plain'));
  if (plain) return plain.text;
  const html = buckets.find((b) => b.mimeType.startsWith('text/html'));
  if (html) return stripHtml(html.text);
  if (buckets.length) return buckets[0].text;
  return '';
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractOTP(text) {
  if (!text) return null;
  // ①「ワンタイムパスワード / one-time password / OTP / 認証コード」等のキーワード近傍にある数字列を最優先
  const keywordRe = /(?:ワンタイムパスワード|one[\s-]*time[\s-]*password|OTP|認証コード|パスコード|passcode)[^\d]{0,30}(\d{4,10})/i;
  const km = text.match(keywordRe);
  if (km) return km[1];
  // ② 8桁の数字（京大IIMCの現行フォーマット）
  const m8 = text.match(/(?<!\d)(\d{8})(?!\d)/);
  if (m8) return m8[1];
  // ③ 6桁の数字（フォールバック）
  const m6 = text.match(/(?<!\d)(\d{6})(?!\d)/);
  if (m6) return m6[1];
  return null;
}

// ---------------------------------------------------------------
// メインのOTP取得フロー
// ---------------------------------------------------------------
async function fetchOTPOnce(token, settings, afterTimestampSec, triggerMs) {
  const query = buildQuery(settings, afterTimestampSec);
  const messages = await listOTPMessages(token, query);
  // 全メールを並列取得してからフィルタ（シリアル取得だと最大5件×~300ms=1.5sのムダ）
  const fulls = await Promise.all(messages.map((m) => getMessage(token, m.id)));
  const candidates = [];
  for (const full of fulls) {
    const internalMs = parseInt(full.internalDate || '0', 10);
    if (triggerMs && internalMs && internalMs < triggerMs) {
      continue;
    }
    candidates.push({ full, internalMs });
  }
  candidates.sort((a, b) => b.internalMs - a.internalMs);
  for (const { full } of candidates) {
    const body = extractBodyText(full.payload);
    const otp = extractOTP(body);
    if (otp) {
      return { otp, messageId: full.id, snippet: full.snippet || '', internalMs: full.internalDate };
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollForOTP({ interactive } = { interactive: true }) {
  const settings = await getSettings();
  if (!settings.enabled) {
    throw new Error('拡張機能が無効になっています。');
  }

  const token = await getAuthToken(interactive);
  // OTP発行リクエスト時刻 (content.jsが「Yes」を押したタイミング) を triggerMs にする。
  // 古いOTPメールを掴まないために、これより前に届いたメールは全て無視する。
  // content.js が記録していない場合は、現在時刻から60秒前を保守的なフォールバックに。
  const stored = await chrome.storage.local.get(['otpRequestedAt']);
  const triggerMs = stored.otpRequestedAt && (Date.now() - stored.otpRequestedAt) < 10 * 60 * 1000
    ? stored.otpRequestedAt
    : Date.now() - 60_000;
  const startedSec = Math.floor(triggerMs / 1000) - 30;

  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    try {
      const result = await fetchOTPOnce(token, settings, startedSec, triggerMs);
      if (result) {
        await setLastResult({ status: 'success', otp: maskOTP(result.otp), attempts: attempt });
        // 成功したら次回への持ち越しを防ぐためにクリア
        await chrome.storage.local.remove('otpRequestedAt');
        return result;
      }
    } catch (e) {
      // ネットワーク等のエラーは即時失敗にする
      await setLastResult({ status: 'error', message: e.message });
      throw e;
    }
    if (attempt < POLL_MAX_ATTEMPTS) {
      await sleep(POLL_INTERVAL_MS);
    }
  }
  await setLastResult({ status: 'timeout', attempts: POLL_MAX_ATTEMPTS });
  throw new Error('OTPメールがタイムアウト時間内に見つかりませんでした。');
}

function maskOTP(otp) {
  if (!otp || otp.length < 4) return '****';
  return `${otp.slice(0, 2)}**${otp.slice(-2)}`;
}

// ---------------------------------------------------------------
// メッセージング: content.js / popup.js からの要求を受ける
// ---------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case 'FETCH_OTP': {
          const result = await pollForOTP({ interactive: msg.interactive ?? false });
          sendResponse({ ok: true, otp: result.otp });
          return;
        }
        case 'CHECK_AUTH': {
          const token = await getAuthToken(false).catch(() => null);
          sendResponse({ ok: true, authenticated: Boolean(token) });
          return;
        }
        case 'SIGN_IN': {
          const token = await getAuthToken(true);
          sendResponse({ ok: true, authenticated: Boolean(token) });
          return;
        }
        case 'SIGN_OUT': {
          const token = await getAuthToken(false).catch(() => null);
          if (token) await removeCachedToken(token);
          sendResponse({ ok: true });
          return;
        }
        case 'GET_STATE': {
          const settings = await getSettings();
          sendResponse({ ok: true, settings });
          return;
        }
        case 'SET_ENABLED': {
          await chrome.storage.local.set({ enabled: Boolean(msg.enabled) });
          sendResponse({ ok: true });
          return;
        }
        case 'SET_CONFIG': {
          const patch = {};
          if (typeof msg.gmailQuery === 'string') patch.gmailQuery = msg.gmailQuery;
          if (typeof msg.senderFilter === 'string') patch.senderFilter = msg.senderFilter;
          await chrome.storage.local.set(patch);
          sendResponse({ ok: true });
          return;
        }
        default:
          sendResponse({ ok: false, error: `unknown message type: ${msg?.type}` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();
  return true; // async response
});

// Service Worker起動ログ（開発時用）
console.log('[kyoto-u-mfa-autofill] background service worker loaded');
