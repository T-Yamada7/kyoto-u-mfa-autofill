// background.js (Service Worker)
// プロバイダ非依存のコーディネータ。実際のメール取得は providers/ に委譲。

import { GmailProvider } from './providers/gmail.js';
import { OutlookProvider } from './providers/outlook.js';

const PROVIDERS = {
  gmail: GmailProvider,
  outlook: OutlookProvider,
};

// ポーリング設定
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 15; // 2s * 15 = 30s

// ---------------------------------------------------------------
// Settings
// ---------------------------------------------------------------
async function getSettings() {
  const defaults = {
    enabled: true,
    provider: 'gmail', // 'gmail' | 'outlook'
    // gmail
    gmailSenderFilter: GmailProvider.defaults.senderFilter,
    gmailQuery: GmailProvider.defaults.searchQuery,
    // outlook
    outlookClientId: '',
    outlookSenderFilter: OutlookProvider.defaults.senderFilter,
    outlookQuery: OutlookProvider.defaults.searchQuery,
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

function maskOTP(otp) {
  if (!otp || otp.length < 4) return '****';
  return `${otp.slice(0, 2)}**${otp.slice(-2)}`;
}

function getProviderConfig(settings) {
  if (settings.provider === 'outlook') {
    return {
      provider: OutlookProvider,
      senderFilter: settings.outlookSenderFilter,
      searchQuery: settings.outlookQuery,
      extra: { clientId: settings.outlookClientId },
    };
  }
  return {
    provider: GmailProvider,
    senderFilter: settings.gmailSenderFilter,
    searchQuery: settings.gmailQuery,
    extra: {},
  };
}

// ---------------------------------------------------------------
// OTP取得 (ポーリング)
// ---------------------------------------------------------------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollForOTP() {
  const settings = await getSettings();
  if (!settings.enabled) throw new Error('拡張機能が無効になっています。');

  const cfg = getProviderConfig(settings);

  // OTP発行リクエスト時刻 (content.jsが記録)
  const stored = await chrome.storage.local.get(['otpRequestedAt']);
  const triggerMs = stored.otpRequestedAt && Date.now() - stored.otpRequestedAt < 10 * 60 * 1000
    ? stored.otpRequestedAt
    : Date.now() - 60_000;

  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    try {
      const result = await cfg.provider.fetchOTPOnce({
        triggerMs,
        senderFilter: cfg.senderFilter,
        searchQuery: cfg.searchQuery,
        ...cfg.extra,
      });
      if (result) {
        await setLastResult({
          status: 'success',
          provider: cfg.provider.id,
          otp: maskOTP(result.otp),
          attempts: attempt,
        });
        await chrome.storage.local.remove('otpRequestedAt');
        return result;
      }
    } catch (e) {
      await setLastResult({ status: 'error', provider: cfg.provider.id, message: e.message });
      throw e;
    }
    if (attempt < POLL_MAX_ATTEMPTS) await sleep(POLL_INTERVAL_MS);
  }
  await setLastResult({ status: 'timeout', provider: cfg.provider.id, attempts: POLL_MAX_ATTEMPTS });
  throw new Error('OTPメールがタイムアウト時間内に見つかりませんでした。');
}

// ---------------------------------------------------------------
// メッセージング
// ---------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case 'FETCH_OTP': {
          const result = await pollForOTP();
          sendResponse({ ok: true, otp: result.otp });
          return;
        }
        case 'CHECK_AUTH': {
          const settings = await getSettings();
          const cfg = getProviderConfig(settings);
          const authed = await cfg.provider.isAuthenticated(cfg.extra);
          sendResponse({ ok: true, authenticated: authed, provider: cfg.provider.id });
          return;
        }
        case 'SIGN_IN': {
          const settings = await getSettings();
          const cfg = getProviderConfig(settings);
          await cfg.provider.signIn(cfg.extra);
          sendResponse({ ok: true });
          return;
        }
        case 'SIGN_OUT': {
          const settings = await getSettings();
          const cfg = getProviderConfig(settings);
          await cfg.provider.signOut(cfg.extra);
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
          const allowedKeys = [
            'provider',
            'gmailSenderFilter', 'gmailQuery',
            'outlookClientId', 'outlookSenderFilter', 'outlookQuery',
          ];
          const patch = {};
          for (const k of allowedKeys) {
            if (typeof msg[k] === 'string') patch[k] = msg[k];
          }
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
  return true;
});

console.log('[kyoto-u-mfa-autofill] background service worker loaded');
