// content.js
// 京大IIMCのMFA画面 (https://auth.iimc.kyoto-u.ac.jp/pub/otplogin.cgi) を自動化する。
//
// 実フロー:
//   ① デフォルトはアプリ認証画面 (タイトル「多要素認証：アプリ」)
//      → 「『多要素認証：メール』ログインはこちら」リンクをクリック
//   ② 確認ダイアログ (確認 / Confirm) が出る
//      → Yes ボタンをクリック (OTPメールが送信される)
//   ③ メール認証用OTP入力画面に遷移
//      → Gmail から OTP を取得して入力欄に流し込み
//      → 「ログイン / Login」ボタンをクリック

(() => {
  if (window.__kyotoUMfaAutofillInstalled) return;
  window.__kyotoUMfaAutofillInstalled = true;

  const LOG_PREFIX = '[kyoto-u-mfa-autofill]';
  const log = (...args) => console.log(LOG_PREFIX, ...args);

  // ページロードを跨ぐ可能性があるので、状態は最小限。
  // 各 step は「現在のページにそのトリガーが出ているか」で判定する。
  const acted = {
    clickedEmailLink: false,
    clickedYes: false,
    filledOTP: false,
    clickedLogin: false,
  };

  // ----------------------------------------------------------------
  // 汎用ユーティリティ
  // ----------------------------------------------------------------
  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function textOf(el) {
    return (el.innerText || el.textContent || el.value || '').trim();
  }

  function findVisible(selector, predicate) {
    const els = Array.from(document.querySelectorAll(selector));
    return els.find((el) => isVisible(el) && predicate(textOf(el), el));
  }

  function setNativeInputValue(input, value) {
    const proto = input instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }

  // ----------------------------------------------------------------
  // 要素探索
  // ----------------------------------------------------------------

  // ①「『多要素認証：メール』ログインはこちら」リンク
  // 厳密一致だと表記揺れに弱いので、「メール」と「ログイン」「こちら」のキーワードで判定。
  function findEmailMFALink() {
    return findVisible('a, button', (t) =>
      (t.includes('メール') && (t.includes('ログイン') || t.includes('こちら'))) ||
      t.toLowerCase().includes('email') && t.toLowerCase().includes('login')
    );
  }

  // ② 確認ダイアログの Yes ボタン
  // 「Yes」というテキストの可視ボタンを探す。
  function findYesButton() {
    return findVisible('button, input[type="button"], input[type="submit"], a', (t) => {
      const lower = t.toLowerCase();
      return lower === 'yes' || t === 'はい';
    });
  }

  // ③ OTP入力欄 (One-Time Password)
  function findOTPInput() {
    // label の「ワンタイムパスワード / One-Time Password」と紐付くinputが本命
    // フォールバックとして属性ベースの判定もする
    const inputs = Array.from(document.querySelectorAll('input'));
    return inputs.find((el) => {
      if (!isVisible(el)) return false;
      const t = (el.type || '').toLowerCase();
      if (!['text', 'tel', 'number', 'password', ''].includes(t)) return false;
      const haystack = [
        el.name, el.id, el.placeholder,
        el.getAttribute('aria-label'),
        el.autocomplete,
      ].filter(Boolean).join(' ').toLowerCase();
      if (/otp|onetime|one-?time|passcode|ワンタイム|認証コード|パスコード/.test(haystack)) return true;
      // ラベルテキスト経由
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label && /ワンタイム|One-?Time|OTP|認証コード/i.test(textOf(label))) return true;
      }
      // 親近傍の見出し / テキスト
      const parentText = (el.closest('form, div, tr')?.innerText || '').toLowerCase();
      if (/ワンタイム|one-?time password|otp/.test(parentText)) {
        const maxlen = parseInt(el.getAttribute('maxlength') || '0', 10);
        if (maxlen === 0 || maxlen >= 4) return true;
      }
      return false;
    });
  }

  // ④ ログインボタン
  function findLoginButton() {
    return findVisible('button, input[type="submit"], input[type="button"]', (t) => {
      const lower = t.toLowerCase();
      return t.includes('ログイン') || lower === 'login' || lower === 'sign in';
    });
  }

  // ----------------------------------------------------------------
  // フロー判定
  // ----------------------------------------------------------------
  function isOnAuthHost() {
    return location.hostname === 'auth.iimc.kyoto-u.ac.jp';
  }

  function isMFAPage() {
    if (!isOnAuthHost()) return false;
    if (location.pathname.includes('otplogin')) return true;
    const text = document.body?.innerText || '';
    return /多要素認証|Multi-?Factor|ワンタイムパスワード|One-?Time Password/i.test(text);
  }

  // ページタイトルから「メール認証画面か」を判定（より厳密にしたい時用）
  function isEmailMFAPage() {
    const text = document.body?.innerText || '';
    // 「多要素認証：メール」のように『メール』がタイトル行に明示されているか
    return /多要素認証[\s：:]*メール|Multi-?Factor[^.]{0,20}Email/i.test(text);
  }

  function isAppMFAPage() {
    const text = document.body?.innerText || '';
    return /多要素認証[\s：:]*アプリ|Multi-?Factor[^.]{0,20}App/i.test(text);
  }

  // ----------------------------------------------------------------
  // メインフロー
  // ----------------------------------------------------------------
  let running = false;

  async function tick() {
    if (running) return;
    if (!isMFAPage()) return;
    running = true;

    try {
      const stateResp = await chrome.runtime.sendMessage({ type: 'GET_STATE' }).catch(() => null);
      if (!stateResp?.settings?.enabled) return;

      // STEP 1: アプリ認証画面ならメール認証へ切り替えるリンクをクリック
      if (!acted.clickedEmailLink) {
        const link = findEmailMFALink();
        if (link && (isAppMFAPage() || !isEmailMFAPage())) {
          log('「メール認証」リンクをクリックします:', textOf(link));
          // この時点で「新しいOTP発行フローを開始した」と記録。
          // background.jsがGmail検索結果から古いOTPメールを除外するのに使う。
          chrome.storage.local.set({ otpRequestedAt: Date.now() }).catch(() => {});
          link.click();
          acted.clickedEmailLink = true;
          // ダイアログ表示を待つ
          await sleep(300);
        }
      }

      // STEP 2: 確認ダイアログのYesボタンをクリック
      if (!acted.clickedYes) {
        const yes = findYesButton();
        if (yes) {
          log('確認ダイアログの Yes をクリックします');
          // Yes時点でもタイムスタンプを更新 (実際のOTP発行はYes押下時点)。
          chrome.storage.local.set({ otpRequestedAt: Date.now() }).catch(() => {});
          yes.click();
          acted.clickedYes = true;
          // メール送信&画面遷移を待つ。OTPは2-10秒で届く前提
          await sleep(800);
        }
      }

      // STEP 3: OTP入力欄が出てきたら Gmail からOTPを取得して入力
      if (!acted.filledOTP) {
        const input = findOTPInput();
        if (input && !input.value) {
          // メール認証フローに乗っていることを軽く確認
          // (アプリ認証の入力欄に間違って入れないように)
          if (!acted.clickedYes && !isEmailMFAPage()) {
            // ユーザが手動でメール認証へ遷移した可能性もあるので、
            // 入力欄が出ていれば一旦進める（厳密化しすぎると逆に動かない）
          }
          log('Gmailから OTP を取得します');
          let resp;
          try {
            resp = await chrome.runtime.sendMessage({ type: 'FETCH_OTP', interactive: false });
          } catch (e) {
            log('OTP取得メッセージング失敗:', e);
            return;
          }
          if (!resp?.ok) {
            log('OTP取得失敗:', resp?.error);
            return;
          }
          // 入力欄が変わっている可能性があるので再取得
          const target = findOTPInput() || input;
          setNativeInputValue(target, resp.otp);
          acted.filledOTP = true;
          log('OTPを入力しました');

          // STEP 4: ログインボタンをクリック
          setTimeout(() => {
            if (acted.clickedLogin) return;
            const btn = findLoginButton();
            if (btn) {
              log('ログインボタンをクリックします');
              btn.click();
              acted.clickedLogin = true;
            }
          }, 500);
        }
      }
    } finally {
      running = false;
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // 初回実行 + DOM変化監視
  tick();

  const observer = new MutationObserver(() => {
    // tickはguard付きなので連続呼び出しOK
    tick();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // popupからの手動トリガー
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'MANUAL_TRIGGER') {
      acted.clickedEmailLink = false;
      acted.clickedYes = false;
      acted.filledOTP = false;
      acted.clickedLogin = false;
      tick().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg?.type === 'DETECT_MFA') {
      sendResponse({ ok: true, isMFA: isMFAPage(), host: location.host });
      return false;
    }
    return false;
  });

  log('content script loaded on', location.href);
})();
