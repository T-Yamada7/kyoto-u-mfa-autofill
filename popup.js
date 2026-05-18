// popup.js

const $ = (id) => document.getElementById(id);

const els = {
  providerInputs: document.querySelectorAll('input[name="provider"]'),
  authStatus: $('authStatus'),
  lastResult: $('lastResult'),
  enabledToggle: $('enabledToggle'),
  signInBtn: $('signInBtn'),
  signOutBtn: $('signOutBtn'),
  manualBtn: $('manualBtn'),
  saveConfigBtn: $('saveConfigBtn'),
  outlookConfig: $('outlookConfig'),
  gmailConfig: $('gmailConfig'),
  outlookClientId: $('outlookClientId'),
  outlookSenderFilter: $('outlookSenderFilter'),
  outlookQuery: $('outlookQuery'),
  gmailSenderFilter: $('gmailSenderFilter'),
  gmailQuery: $('gmailQuery'),
  redirectHint: $('redirectHint'),
  logArea: $('logArea'),
};

function appendLog(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  els.logArea.textContent = `${line}\n${els.logArea.textContent}`.slice(0, 2000);
}

async function send(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (e) {
    appendLog(`送信失敗: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

function fmtResult(r) {
  if (!r) return '-';
  const ts = r.timestamp ? new Date(r.timestamp).toLocaleString() : '';
  const prov = r.provider ? `[${r.provider}]` : '';
  if (r.status === 'success') return `成功 ${prov} ${r.otp ?? ''} (${ts})`;
  if (r.status === 'timeout') return `タイムアウト ${prov} (${ts})`;
  if (r.status === 'error') return `エラー ${prov}: ${r.message} (${ts})`;
  return JSON.stringify(r);
}

function applyProviderUI(provider) {
  els.providerInputs.forEach((r) => { r.checked = r.value === provider; });
  els.outlookConfig.hidden = provider !== 'outlook';
  els.gmailConfig.hidden = provider !== 'gmail';
}

async function refresh() {
  const [authRes, stateRes] = await Promise.all([
    send({ type: 'CHECK_AUTH' }),
    send({ type: 'GET_STATE' }),
  ]);

  if (stateRes?.ok) {
    const s = stateRes.settings;
    applyProviderUI(s.provider);
    els.enabledToggle.checked = Boolean(s.enabled);
    els.outlookClientId.value = s.outlookClientId || '';
    els.outlookSenderFilter.value = s.outlookSenderFilter || '';
    els.outlookQuery.value = s.outlookQuery || '';
    els.gmailSenderFilter.value = s.gmailSenderFilter || '';
    els.gmailQuery.value = s.gmailQuery || '';
    els.lastResult.textContent = fmtResult(s.lastResult);

    const provLabel = s.provider === 'outlook' ? 'Outlook' : 'Gmail';
    if (authRes?.ok && authRes.authenticated) {
      els.authStatus.textContent = `${provLabel} 認証済み`;
      els.authStatus.className = 'value ok';
    } else {
      els.authStatus.textContent = `${provLabel} 未認証`;
      els.authStatus.className = 'value err';
    }
  }

  // Outlook用: リダイレクトURI を表示してAzure側登録の参考に
  try {
    const redirect = chrome.identity.getRedirectURL();
    els.redirectHint.textContent = `Azureに登録するリダイレクトURI: ${redirect}`;
  } catch (e) {
    els.redirectHint.textContent = '';
  }
}

async function onProviderChange(ev) {
  const provider = ev.target.value;
  applyProviderUI(provider);
  await send({ type: 'SET_CONFIG', provider });
  appendLog(`プロバイダを ${provider} に切り替えました`);
  refresh();
}

async function onSignIn() {
  els.signInBtn.disabled = true;
  appendLog('サインインを開始します…');
  const r = await send({ type: 'SIGN_IN' });
  els.signInBtn.disabled = false;
  appendLog(r.ok ? 'サインインしました' : `サインイン失敗: ${r.error}`);
  refresh();
}

async function onSignOut() {
  await send({ type: 'SIGN_OUT' });
  appendLog('サインアウトしました');
  refresh();
}

async function onManual() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    appendLog('アクティブタブが取得できません');
    return;
  }
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'MANUAL_TRIGGER' });
    appendLog(r?.ok ? '手動実行を開始しました' : '手動実行失敗（content script未注入の可能性）');
  } catch (e) {
    appendLog(`手動実行エラー: ${e.message}`);
  }
}

async function onToggle() {
  await send({ type: 'SET_ENABLED', enabled: els.enabledToggle.checked });
  appendLog(`自動入力を${els.enabledToggle.checked ? '有効化' : '無効化'}しました`);
}

async function onSaveConfig() {
  await send({
    type: 'SET_CONFIG',
    outlookClientId: els.outlookClientId.value.trim(),
    outlookSenderFilter: els.outlookSenderFilter.value.trim(),
    outlookQuery: els.outlookQuery.value.trim(),
    gmailSenderFilter: els.gmailSenderFilter.value.trim(),
    gmailQuery: els.gmailQuery.value.trim(),
  });
  appendLog('設定を保存しました');
}

els.providerInputs.forEach((r) => r.addEventListener('change', onProviderChange));
els.signInBtn.addEventListener('click', onSignIn);
els.signOutBtn.addEventListener('click', onSignOut);
els.manualBtn.addEventListener('click', onManual);
els.enabledToggle.addEventListener('change', onToggle);
els.saveConfigBtn.addEventListener('click', onSaveConfig);

refresh();
