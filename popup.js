// popup.js
// ポップアップUIのロジック

const $ = (id) => document.getElementById(id);

const els = {
  authStatus: $('authStatus'),
  lastResult: $('lastResult'),
  enabledToggle: $('enabledToggle'),
  signInBtn: $('signInBtn'),
  signOutBtn: $('signOutBtn'),
  manualBtn: $('manualBtn'),
  senderFilter: $('senderFilter'),
  gmailQuery: $('gmailQuery'),
  saveConfigBtn: $('saveConfigBtn'),
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
  if (r.status === 'success') return `成功 ${r.otp ?? ''} (${ts})`;
  if (r.status === 'timeout') return `タイムアウト (${ts})`;
  if (r.status === 'error') return `エラー: ${r.message} (${ts})`;
  return JSON.stringify(r);
}

async function refresh() {
  const [authRes, stateRes] = await Promise.all([
    send({ type: 'CHECK_AUTH' }),
    send({ type: 'GET_STATE' }),
  ]);

  if (authRes?.ok && authRes.authenticated) {
    els.authStatus.textContent = '認証済み';
    els.authStatus.className = 'value ok';
  } else {
    els.authStatus.textContent = '未認証';
    els.authStatus.className = 'value err';
  }

  if (stateRes?.ok) {
    els.enabledToggle.checked = Boolean(stateRes.settings.enabled);
    els.senderFilter.value = stateRes.settings.senderFilter || '';
    els.gmailQuery.value = stateRes.settings.gmailQuery || '';
    els.lastResult.textContent = fmtResult(stateRes.settings.lastResult);
  }
}

async function onSignIn() {
  els.signInBtn.disabled = true;
  const r = await send({ type: 'SIGN_IN' });
  els.signInBtn.disabled = false;
  appendLog(r.ok ? 'Gmailにサインインしました' : `サインイン失敗: ${r.error}`);
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
    appendLog(r?.ok ? '手動実行を開始しました' : '手動実行に失敗（content scriptがロードされていない可能性）');
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
    senderFilter: els.senderFilter.value.trim(),
    gmailQuery: els.gmailQuery.value.trim(),
  });
  appendLog('設定を保存しました');
}

els.signInBtn.addEventListener('click', onSignIn);
els.signOutBtn.addEventListener('click', onSignOut);
els.manualBtn.addEventListener('click', onManual);
els.enabledToggle.addEventListener('change', onToggle);
els.saveConfigBtn.addEventListener('click', onSaveConfig);

refresh();
