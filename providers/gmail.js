// providers/gmail.js
// Gmail API プロバイダ

import { extractOTP, base64UrlDecode, stripHtml } from './extract.js';

const GMAIL_API_BASE = 'https://www.googleapis.com/gmail/v1/users/me';

export const GmailProvider = {
  id: 'gmail',
  label: 'Gmail',

  defaults: {
    senderFilter: 'ninsho-qa@iimc.kyoto-u.ac.jp',
    searchQuery: 'subject:(ワンタイムパスワード OR "one time password" OR OTP OR 認証コード) newer_than:1h',
  },

  // -------- OAuth --------
  async _getToken(interactive) {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime.lastError || !token) {
          reject(new Error(chrome.runtime.lastError?.message || 'No token returned'));
          return;
        }
        resolve(token);
      });
    });
  },

  async _removeToken(token) {
    return new Promise((resolve) => {
      chrome.identity.removeCachedAuthToken({ token }, () => resolve());
    });
  },

  async signIn() {
    const token = await this._getToken(true);
    return Boolean(token);
  },

  async signOut() {
    const token = await this._getToken(false).catch(() => null);
    if (token) await this._removeToken(token);
  },

  async isAuthenticated() {
    const token = await this._getToken(false).catch(() => null);
    return Boolean(token);
  },

  // -------- Gmail API --------
  async _fetch(path, token) {
    const url = path.startsWith('http') ? path : `${GMAIL_API_BASE}${path}`;
    let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      await this._removeToken(token);
      const fresh = await this._getToken(false).catch(() => null);
      if (fresh && fresh !== token) {
        res = await fetch(url, { headers: { Authorization: `Bearer ${fresh}` } });
        if (!res.ok) throw new Error(`Gmail API error: ${res.status}`);
        return res.json();
      }
      throw new Error('Gmail認証が切れました。再認証が必要です。');
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Gmail API error: ${res.status} ${t}`);
    }
    return res.json();
  },

  _buildQuery(senderFilter, searchQuery, afterSec) {
    const parts = [];
    if (senderFilter) parts.push(`from:${senderFilter}`);
    if (searchQuery) parts.push(searchQuery);
    if (afterSec) parts.push(`after:${afterSec}`);
    return parts.join(' ');
  },

  _extractBodyText(payload) {
    if (!payload) return '';
    const buckets = [];
    function walk(part) {
      if (!part) return;
      if (part.body?.data) {
        const text = base64UrlDecode(part.body.data);
        if (text) buckets.push({ mimeType: part.mimeType || '', text });
      }
      if (Array.isArray(part.parts)) part.parts.forEach(walk);
    }
    walk(payload);
    const plain = buckets.find((b) => b.mimeType.startsWith('text/plain'));
    if (plain) return plain.text;
    const html = buckets.find((b) => b.mimeType.startsWith('text/html'));
    if (html) return stripHtml(html.text);
    if (buckets.length) return buckets[0].text;
    return '';
  },

  // -------- OTP取得 (1回試行) --------
  async fetchOTPOnce({ triggerMs, senderFilter, searchQuery }) {
    const token = await this._getToken(false);
    const afterSec = Math.floor((triggerMs ?? Date.now() - 60_000) / 1000) - 30;
    const query = this._buildQuery(senderFilter, searchQuery, afterSec);

    const list = await this._fetch(
      `/messages?q=${encodeURIComponent(query)}&maxResults=5`,
      token
    );
    const messages = list.messages || [];
    const candidates = [];
    for (const m of messages) {
      const full = await this._fetch(`/messages/${m.id}?format=full`, token);
      const internalMs = parseInt(full.internalDate || '0', 10);
      if (triggerMs && internalMs && internalMs < triggerMs) continue;
      candidates.push({ full, internalMs });
    }
    candidates.sort((a, b) => b.internalMs - a.internalMs);
    for (const { full } of candidates) {
      const body = this._extractBodyText(full.payload);
      const otp = extractOTP(body);
      if (otp) {
        return { otp, messageId: full.id, snippet: full.snippet || '' };
      }
    }
    return null;
  },
};
