// providers/extract.js
// OTP抽出ロジック (プロバイダ非依存)

// 京大IIMC のOTPメールは8桁数字。表記揺れに耐えるためフォールバック多段。
export function extractOTP(text) {
  if (!text) return null;
  // ①「ワンタイムパスワード / one-time password / OTP / 認証コード」近傍の数字列を最優先
  const keywordRe = /(?:ワンタイムパスワード|one[\s-]*time[\s-]*password|OTP|認証コード|パスコード|passcode)[^\d]{0,30}(\d{4,10})/i;
  const km = text.match(keywordRe);
  if (km) return km[1];
  // ② 8桁の数字（京大IIMC現行フォーマット）
  const m8 = text.match(/(?<!\d)(\d{8})(?!\d)/);
  if (m8) return m8[1];
  // ③ 6桁の数字（フォールバック）
  const m6 = text.match(/(?<!\d)(\d{6})(?!\d)/);
  if (m6) return m6[1];
  return null;
}

// base64url(Gmail) のデコード
export function base64UrlDecode(str) {
  if (!str) return '';
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 ? padded + '='.repeat(4 - (padded.length % 4)) : padded;
  try {
    const binary = atob(pad);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) {
    return '';
  }
}

export function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
