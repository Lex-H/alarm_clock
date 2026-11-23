/*
 * app.js — UI, state, persistence, alarm clock and ringing.
 * Depends on core.js (window.TimerCore) and audio.js (window.TimerAudio).
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const { pad, WEEKDAYS, store, formatRemaining, hhmm, fmtWhen, computeAlarmTime, buildIntentUrl,
    uid, sanitizeAlarm, nextOccurrence, repeatText,
    swEmpty, swElapsed, sanitizeStopwatch, formatStopwatch, lapRows } = window.TimerCore;
  const Sound = window.TimerAudio;

  const BASE_TITLE = '時間';

  /* ---------------- Device detection & mode ---------------- */
  const DEVICE_NAMES = { android: 'Android 裝置', ios: 'iOS／iPadOS 裝置', mobile: '行動裝置', desktop: '電腦' };
  const device = window.TimerCore.detectDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);

  let modePref = store.get('cd_mode', 'auto');
  if (!['auto', 'web', 'android'].includes(modePref)) modePref = 'auto';
  const effectiveMode = () => (modePref === 'auto' ? (device === 'android' ? 'android' : 'web') : modePref);
  function modeName(m) {
    if (m === 'android') return 'Android 系統鬧鐘模式';
    return device === 'desktop' ? '電腦版網頁計時模式' : '行動裝置網頁計時模式';
  }

  /* ---------------- Themes ---------------- */
  // brand text is intentionally the same across all 5 styles (just the page title, "時間");
  // only the per-style wording below (quick/start/ring) is meant to vary with the art style.
  const THEMES = {
    flip:   { quick: (m) => `${m} 分鐘`,   start: '開始',               ring: "TIME'S UP",    color: '#efe6d6' },
    neon:   { quick: (m) => `${m} MIN`,    start: '▶ 啟動倒數',          ring: '// 時間到 //', color: '#0b0221' },
    washi:  { quick: (m) => `${m} 分`,     start: '開始',               ring: '時間到',       color: '#efe6d2' },
    glass:  { quick: (m) => `${m} 分鐘`,   start: '開始',               ring: '時間到了',     color: '#7a5cff' },
    arcade: { quick: (m) => `LEVEL ${m}`,  start: 'INSERT COIN ▶ START', ring: 'GAME OVER',   color: '#05010f' },
  };
  let theme = store.get('cd_theme', 'neon');
  if (!THEMES[theme]) theme = 'neon';

  /* ---------------- Android intent ---------------- */
  // intent: URLs only have a handler on Android. Launching one elsewhere just logs
  // "the scheme does not have a registered handler", so never try it off-Android.
  const canIntent = device === 'android';
  const ANDROID_HINT = '若沒有自動跳轉，請點上方按鈕。跳轉後若出現確認畫面，請手動按「確認／儲存」。系統鬧鐘建立後，關閉此頁倒數不會刪除系統鬧鐘。';
  // A browser that reports Android but has no handler (e.g. DevTools device emulation on a
  // PC, or Chrome refusing the clock app) logs "scheme does not have a registered handler"
  // and simply stays on the page. That log comes from the browser and can't be caught, so
  // we detect the failure instead: if the page never lost focus / visibility within 1.5 s,
  // the system clock did not open and onFail() runs the web fallback.
  function openIntent(url, onFail) {
    if (!canIntent) {
      console.info('[SET_ALARM Intent skipped: not an Android device]', url);
      if (onFail) onFail();
      return;
    }
    let left = false;
    const mark = () => { left = true; };
    window.addEventListener('blur', mark);
    document.addEventListener('visibilitychange', mark);
    try { window.location.href = url; } catch (e) { /* treated as failure below */ }
    setTimeout(() => {
      window.removeEventListener('blur', mark);
      document.removeEventListener('visibilitychange', mark);
      if (!left && onFail) onFail();
    }, 1500);
  }

  /* ---------------- Wake lock (mobile web mode) ---------------- */
  let wakeLock = null;
  async function requestWakeLock() {
    try { if ('wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen'); }
    catch (e) { wakeLock = null; }
    if (wakeLock) wakeLock.addEventListener('release', () => { wakeLock = null; });
  }
  function releaseWakeLock() {
    try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ }
    wakeLock = null;
  }

  /* ---------------- DOM ---------------- */
  const el = {
    html: document.documentElement,
    brandText: $('brandText'), modeBadge: $('modeBadge'), settingsBtn: $('settingsBtn'),
    sheet: $('settingsSheet'), sheetBackdrop: $('sheetBackdrop'), sheetClose: $('sheetClose'),
    styleGrid: $('styleGrid'), modeOpts: $('modeOpts'), deviceInfo: $('deviceInfo'), lockHint: $('lockHint'),
    notifySection: $('notifySection'), notifyBtn: $('notifyBtn'),
    tipDesktop: $('tipDesktop'), warnMobile: $('warnMobile'), noteAndroid: $('noteAndroid'),
    notAndroidHint: $('notAndroidHint'),
    missedNote: $('missedNote'), missedShort: $('missedShort'), missedText: $('missedText'), missedClose: $('missedClose'),
    soundNote: $('soundNote'),
    idleView: $('idleView'), nowDigits: $('nowDigits'), nowDate: $('nowDate'), nextAlarmLine: $('nextAlarmLine'),
    sideInfo: $('sideInfo'), siLabel: $('siLabel'), siStart: $('siStart'), siLen: $('siLen'), siMode: $('siMode'),
    tabs: $('tabs'), alarmCount: $('alarmCount'),
    alarmPanel: $('alarmPanel'), addAlarmBtn: $('addAlarmBtn'), alarmList: $('alarmList'), alarmEmpty: $('alarmEmpty'), alarmMsg: $('alarmMsg'), androidHint: $('androidHint'),
    alarmEditor: $('alarmEditor'), editorTitle: $('editorTitle'), alHour: $('alHour'), alMin: $('alMin'), alLabel: $('alLabel'),
    swStage: $('swStage'), swBig: $('swBig'), swBigLap: $('swBigLap'),
    swPanel: $('swPanel'), swDigits: $('swDigits'), swLapNow: $('swLapNow'),
    swLapBtn: $('swLapBtn'), swStartBtn: $('swStartBtn'), swLaps: $('swLaps'), swEmpty: $('swEmpty'),
    alPresets: $('alPresets'), alDays: $('alDays'), alMsg: $('alMsg'), alCancel: $('alCancel'), alSysNote: $('alSysNote'),
    setupPanel: $('setupPanel'), quick: $('quick'), minutesInput: $('minutesInput'), labelInput: $('labelInput'),
    backupRow: $('backupRow'), backupChk: $('backupChk'), startBtn: $('startBtn'), setupMsg: $('setupMsg'),
    runPanel: $('runPanel'), runLabel: $('runLabel'), digits: $('digits'), ringProg: $('ringProg'),
    barFill: $('barFill'), targetLabel: $('targetLabel'), targetTime: $('targetTime'),
    androidBox: $('androidBox'), intentLink: $('intentLink'), pauseBtn: $('pauseBtn'), cancelBtn: $('cancelBtn'),
    ringOverlay: $('ringOverlay'), ringTitle: $('ringTitle'), ringLabel: $('ringLabel'), stamp: $('stamp'), stopBtn: $('stopBtn'),
    metaTheme: document.querySelector('meta[name="theme-color"]'),
  };

  /* ---------------- State ---------------- */
  const S = {
    status: 'idle', // countdown: idle | running | paused | ringing
    mode: 'web', endTime: 0, total: 0, remaining: 0, label: '', backup: false, lastShown: null,
    targetText: '', startedAt: 0, intentUrl: '',
  };
  const cdSound = Sound.makeSound(() => theme); // countdown
  const alSound = Sound.makeSound(() => theme); // next alarm-clock alarm
  let tickTimer = null, ringTimer = null, titleTimer = null;
  let ringItems = []; // what is ringing right now: [{kind:'countdown'|'alarm', label, time}]
  let alarms = [];
  const missed = [];
  const VIEWS = ['timer', 'stopwatch', 'alarm'];
  let view = store.get('cd_view', 'timer');
  if (!VIEWS.includes(view)) view = 'timer';

  /* ---------------- Rendering ---------------- */
  // animate:false skips the flip animation (the stopwatch changes every 10 ms).
  // Characters after "." (hundredths) get the extra class "cs".
  function setDigits(str, box = el.digits, { animate = true } = {}) {
    if (box.children.length !== str.length) {
      box.textContent = '';
      let frac = false;
      for (const ch of str) {
        const sp = document.createElement('span');
        if (ch === '.') { frac = true; sp.className = 'dot'; }
        else sp.className = (ch === ':' ? 'colon' : 'digit') + (frac ? ' cs' : '');
        sp.textContent = ch;
        box.appendChild(sp);
      }
      return;
    }
    for (let i = 0; i < str.length; i++) {
      const sp = box.children[i], ch = str[i];
      if (sp.textContent === ch) continue;
      sp.textContent = ch;
      if (!animate) continue;
      sp.classList.remove('flip');
      void sp.offsetWidth; // restart animation
      sp.classList.add('flip');
    }
  }

  function render(remMs) {
    const secs = Math.max(0, Math.ceil(remMs / 1000));
    if (secs !== S.lastShown) {
      S.lastShown = secs;
      const str = formatRemaining(secs);
      setDigits(str);
      el.digits.classList.toggle('danger', secs <= 10 && S.status === 'running');
      if (!ringItems.length) document.title = `${S.status === 'paused' ? '⏸' : '⏳'} ${str} · ${S.label}`;
    }
    const frac = S.total > 0 ? Math.min(1, Math.max(0, remMs / S.total)) : 0;
    el.ringProg.style.strokeDashoffset = String(100 * (1 - frac));
    el.barFill.style.transform = `scaleX(${frac})`;
  }

  function updateModeUI() {
    const m = effectiveMode();
    const busy = S.status !== 'idle';
    const manual = modePref !== 'auto' ? '（手動）' : '';
    el.modeBadge.textContent = `${m === 'android' ? '📱' : (device === 'desktop' ? '💻' : '⏱')} ${modeName(m)}${manual}`;
    el.modeBadge.title = `偵測到：${DEVICE_NAMES[device]}｜點此開啟設定`;
    el.deviceInfo.textContent = `偵測到：${DEVICE_NAMES[device]}。目前使用「${modeName(m)}」${manual}。`;
    el.modeOpts.querySelectorAll('[data-mode]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.mode === modePref));
      b.disabled = busy;
    });
    el.lockHint.hidden = !busy;
    el.tipDesktop.hidden = !(m === 'web' && device === 'desktop');
    el.warnMobile.hidden = !(m === 'web' && device !== 'desktop');
    el.noteAndroid.hidden = m !== 'android';
    el.notAndroidHint.textContent = (m === 'android' && device !== 'android')
      ? ' （目前裝置不是 Android，Intent 連結可能無法運作。）' : '';
    el.backupRow.hidden = m !== 'android';
    el.alSysNote.hidden = m !== 'android';
    el.notifySection.hidden = device !== 'desktop' || !('Notification' in window) || Notification.permission !== 'default';
  }

  /* ---------------- Layout, view tabs & settings sheet ---------------- */
  function updateLayout() {
    // Two columns need room; narrower desktop windows use the single-screen app layout.
    el.html.classList.toggle('app-layout', device !== 'desktop' || window.innerWidth <= 900);
    updateNow();
    if (view === 'stopwatch') renderSwTime();
  }

  function setView(v) {
    view = VIEWS.includes(v) ? v : 'timer';
    store.set('cd_view', view);
    el.html.classList.toggle('view-alarm', view === 'alarm');
    el.html.classList.toggle('view-stopwatch', view === 'stopwatch');
    el.alarmPanel.hidden = view !== 'alarm';
    el.swPanel.hidden = view !== 'stopwatch';
    el.swStage.hidden = view !== 'stopwatch';
    if (view === 'stopwatch') { renderSw(); swKick(); }
    el.tabs.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === view)));
    collapseNotices();
  }

  // Desktop idle stage: live wall clock + next alarm.
  function updateNow() {
    if (el.html.classList.contains('app-layout') || el.idleView.hidden) return;
    const d = new Date();
    setDigits(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`, el.nowDigits);
    el.nowDate.textContent = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日・星期${WEEKDAYS[d.getDay()]}`;
  }

  let sheetCloseTimer = null;
  function openSettings() {
    clearTimeout(sheetCloseTimer);
    collapseNotices();
    updateModeUI();
    el.sheet.hidden = false;
    el.sheetBackdrop.hidden = false;
    void el.sheet.offsetWidth; // let the hidden→visible change apply before animating
    el.sheet.classList.add('open');
    el.sheetBackdrop.classList.add('open');
    el.settingsBtn.setAttribute('aria-expanded', 'true');
    el.sheetClose.focus({ preventScroll: true });
  }
  function closeSettings() {
    if (el.sheet.hidden) return;
    el.sheet.classList.remove('open');
    el.sheetBackdrop.classList.remove('open');
    el.settingsBtn.setAttribute('aria-expanded', 'false');
    sheetCloseTimer = setTimeout(() => { el.sheet.hidden = true; el.sheetBackdrop.hidden = true; }, 300);
    el.settingsBtn.focus({ preventScroll: true });
  }
  const isSheetOpen = () => !el.sheet.hidden && el.sheet.classList.contains('open');

  const notices = () => [el.missedNote, el.soundNote, el.tipDesktop, el.warnMobile, el.noteAndroid];
  function collapseNotices(except) {
    notices().forEach((n) => { if (n !== except) n.classList.remove('expanded'); });
  }

  function applyTheme(name, preview) {
    theme = THEMES[name] ? name : 'neon';
    const t = THEMES[theme];
    el.html.dataset.theme = theme;
    store.set('cd_theme', theme);
    el.styleGrid.querySelectorAll('[data-theme-name]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeName === theme)));
    el.quick.querySelectorAll('[data-min]').forEach((b) => { b.textContent = t.quick(b.dataset.min); });
    el.startBtn.textContent = t.start;
    el.brandText.textContent = BASE_TITLE;
    el.ringTitle.textContent = t.ring;
    el.ringTitle.dataset.text = t.ring;
    if (el.metaTheme) el.metaTheme.content = t.color;

    // Re-schedule pending / playing sounds with the new timbre.
    const kinds = new Set(ringItems.map((i) => i.kind));
    if (kinds.has('countdown')) cdSound.arm(0);
    else if (S.status === 'running' && cdSound.s) cdSound.arm((S.endTime - Date.now()) / 1000);
    if (kinds.has('alarm')) alSound.arm(0);
    else armNextAlarm();
    if (ringItems.length) restartStamp();
    else if (preview) Sound.preview(theme);
  }

  function restartStamp() {
    el.stamp.style.animation = 'none';
    void el.stamp.offsetWidth;
    el.stamp.style.animation = '';
  }

  function setMsg(text, isError) {
    el.setupMsg.textContent = text || '';
    if (isError) {
      el.minutesInput.classList.remove('shake');
      void el.minutesInput.offsetWidth;
      el.minutesInput.classList.add('shake');
    }
  }

  function showRunPanel() {
    el.setupPanel.hidden = true;
    el.runPanel.hidden = false;
    el.runLabel.textContent = S.label;
    el.targetTime.textContent = S.targetText;
    el.targetLabel.textContent = S.mode === 'android' ? '系統鬧鐘時間' : '目標響鈴時間';
    el.androidBox.hidden = S.mode !== 'android';
    el.androidHint.textContent = ANDROID_HINT;
    el.pauseBtn.hidden = S.mode === 'android';
    el.pauseBtn.textContent = '暫停';
    el.cancelBtn.textContent = S.mode === 'android' ? '關閉倒數' : '取消';
    el.runPanel.classList.toggle('is-android', S.mode === 'android');
    el.idleView.hidden = true;
    el.sideInfo.hidden = false;
    el.siLabel.textContent = S.label;
    el.siStart.textContent = hhmm(S.startedAt);
    el.siLen.textContent = S.total >= 60000 ? `${+(S.total / 60000).toFixed(1)} 分鐘` : `${Math.round(S.total / 1000)} 秒`;
    el.siMode.textContent = S.mode === 'android' ? 'Android 系統鬧鐘' : '網頁計時';
    collapseNotices();
    if (!el.html.classList.contains('app-layout')) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- Missed list & sound-unlock notices ---------------- */
  function addMissed(text) {
    missed.push(text);
    el.missedShort.textContent = `⏰ 網頁關閉期間錯過 ${missed.length} 項・點此查看`;
    el.missedText.textContent = `⏰ 網頁關閉期間已錯過：${missed.join('、')}。`;
    el.missedNote.hidden = false;
  }
  function clearMissed() {
    missed.length = 0;
    el.missedNote.hidden = true;
    el.missedNote.classList.remove('expanded');
  }

  const audioReady = () => Sound.isReady();
  function needsSound() {
    const cd = (S.status === 'running') && (S.mode === 'web' || S.backup);
    return cd || alarms.some((a) => a.enabled);
  }
  function updateSoundNote() {
    el.soundNote.hidden = audioReady() || !needsSound();
  }
  // Browsers block audio until the user interacts with the page. After the page is
  // reopened, the first tap/click/key unlocks audio and re-arms pending sounds.
  function unlockOnGesture() {
    if (audioReady()) return;
    if (!Sound.ensure()) return;
    if (S.status === 'running' && (S.mode === 'web' || S.backup) && !cdSound.s) {
      cdSound.arm((S.endTime - Date.now()) / 1000);
    }
    armNextAlarm();
    // state may become "running" asynchronously
    setTimeout(updateSoundNote, 50);
  }

  /* ---------------- Countdown persistence ---------------- */
  const TIMER_KEY = 'cd_timer';
  function saveTimer() {
    if (S.status !== 'running' && S.status !== 'paused') return;
    store.set(TIMER_KEY, JSON.stringify({
      status: S.status, mode: S.mode, endTime: S.endTime, total: S.total, remaining: S.remaining,
      label: S.label, backup: S.backup, startedAt: S.startedAt, targetText: S.targetText, intentUrl: S.intentUrl,
    }));
  }
  const clearTimer = () => store.del(TIMER_KEY);

  function restoreTimer() {
    const d = store.json(TIMER_KEY, null);
    if (!d || typeof d !== 'object' || !['running', 'paused'].includes(d.status) || !(d.total > 0)) { clearTimer(); return; }
    S.mode = d.mode === 'android' ? 'android' : 'web';
    S.label = String(d.label || '倒數計時').slice(0, 40);
    S.backup = !!d.backup;
    S.total = +d.total;
    S.startedAt = +d.startedAt || Date.now();
    S.targetText = String(d.targetText || '');
    S.intentUrl = typeof d.intentUrl === 'string' && d.intentUrl.startsWith('intent:') ? d.intentUrl : '';
    S.lastShown = null;
    if (d.status === 'running') {
      if (!(+d.endTime > Date.now())) {
        clearTimer();
        addMissed(S.mode === 'android'
          ? `倒數「${S.label}」（${S.targetText}，已交給系統鬧鐘）`
          : `倒數「${S.label}」（${fmtWhen(+d.endTime)}）`);
        return;
      }
      S.endTime = +d.endTime;
      S.status = 'running';
    } else {
      S.remaining = Math.max(0, +d.remaining || 0);
      if (!S.remaining) { clearTimer(); return; }
      S.endTime = Date.now() + S.remaining;
      S.status = 'paused';
    }
    if (S.intentUrl) el.intentLink.href = S.intentUrl;
    showRunPanel();
    if (S.status === 'paused') {
      el.pauseBtn.textContent = '繼續';
      el.targetTime.textContent = '暫停中';
      render(S.remaining);
    } else {
      if (S.mode === 'web' && device !== 'desktop') requestWakeLock();
      startTicker();
    }
  }

  /* ---------------- Timer core ---------------- */
  function startTicker() {
    stopTicker();
    tickTimer = setInterval(tick, 200);
    tick();
  }
  function stopTicker() { if (tickTimer) clearInterval(tickTimer); tickTimer = null; }

  function tick() {
    if (S.status !== 'running') return;
    const rem = S.endTime - Date.now(); // always derived from the target timestamp
    if (rem <= 0) { finish(); return; }
    render(rem);
  }

  function start(minutes) {
    if (S.status !== 'idle') return;
    const mode = effectiveMode();
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) {
      setMsg('請輸入 0.1 到 1440 之間的分鐘數', true);
      return;
    }
    if (mode === 'android') minutes = Math.max(1, Math.round(minutes)); // system alarm needs whole minutes
    setMsg('');

    S.mode = mode;
    S.label = el.labelInput.value.trim() || '倒數計時';
    S.lastShown = null;
    S.intentUrl = '';
    const now = Date.now();

    if (mode === 'android') {
      const nowDate = new Date(now);
      const { h, m } = computeAlarmTime(nowDate, minutes);
      const base = new Date(now); base.setSeconds(0, 0);
      S.endTime = base.getTime() + minutes * 60000; // the moment the system alarm will ring
      S.targetText = `${pad(h)}:${pad(m)}`;
      S.backup = el.backupChk.checked;
      S.intentUrl = buildIntentUrl(h, m, S.label);
      el.intentLink.href = S.intentUrl;
      console.log('[SET_ALARM Intent]', S.intentUrl);
      Sound.ensure(); // unlock now (inside the click) in case we must fall back to web ringing
    } else {
      Sound.ensure(); // unlock audio inside the click gesture
      S.backup = false;
      S.endTime = now + Math.round(minutes * 60000);
      S.targetText = hhmm(S.endTime);
    }
    S.total = S.endTime - now;
    S.startedAt = now;
    S.status = 'running';
    saveTimer();

    if (mode === 'web' || S.backup) cdSound.arm((S.endTime - Date.now()) / 1000);
    if (mode === 'web' && device !== 'desktop') requestWakeLock();

    showRunPanel();
    updateModeUI();
    updateSoundNote();
    startTicker();

    if (S.intentUrl) openIntent(S.intentUrl, countdownIntentFailed);
  }

  // The system clock didn't open → keep this countdown ringing from the web page instead.
  function countdownIntentFailed() {
    if (S.status !== 'running' || S.mode !== 'android') return;
    if (!S.backup) {
      S.backup = true;
      cdSound.arm((S.endTime - Date.now()) / 1000);
      saveTimer();
      updateSoundNote();
    }
    el.androidHint.textContent = canIntent
      ? '⚠️ 無法開啟系統鬧鐘（此瀏覽器沒有可處理的時鐘 App，例如電腦上的手機模擬）。已自動改用網頁響鈴，請保持此頁開啟。'
      : '⚠️ 目前裝置不是 Android，無法開啟系統鬧鐘。已自動改用網頁響鈴，請保持此頁開啟。';
  }

  function togglePause() {
    if (S.mode !== 'web') return;
    if (S.status === 'running') {
      S.remaining = Math.max(0, S.endTime - Date.now());
      S.status = 'paused';
      cdSound.disarm();
      stopTicker();
      el.pauseBtn.textContent = '繼續';
      el.targetTime.textContent = '暫停中';
      el.digits.classList.remove('danger');
      S.lastShown = null;
      render(S.remaining);
    } else if (S.status === 'paused') {
      Sound.ensure();
      S.endTime = Date.now() + S.remaining;
      S.targetText = hhmm(S.endTime);
      S.status = 'running';
      cdSound.arm(S.remaining / 1000);
      el.pauseBtn.textContent = '暫停';
      el.targetTime.textContent = S.targetText;
      startTicker();
    }
    saveTimer();
    updateSoundNote();
  }

  function finish() {
    stopTicker();
    render(0);
    clearTimer();
    if (S.mode === 'android' && !S.backup) {
      resetToIdle();
      setMsg('⏰ 倒數結束，系統鬧鐘應該已經響起。');
      return;
    }
    S.status = 'ringing';
    el.digits.classList.remove('danger');
    startRinging({ kind: 'countdown', label: S.label, time: S.targetText });
  }

  /* ---------------- Ringing (shared by countdown & alarms) ---------------- */
  function ringText(i) {
    return i.kind === 'alarm' ? `⏰ 鬧鐘 ${i.time}・${i.label}` : `⏳ ${i.label}（${i.time}）`;
  }

  function startRinging(item) {
    ringItems.push(item);
    closeSettings();
    collapseNotices();
    el.ringLabel.textContent = ringItems.map(ringText).join('\n');
    const snd = item.kind === 'alarm' ? alSound : cdSound;
    if (!snd.s && Sound.ensure()) snd.arm(0);
    snd.keep();

    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try { new Notification(item.kind === 'alarm' ? `⏰ 鬧鐘 ${item.time}` : '⏰ 時間到！', { body: item.label, requireInteraction: true }); } catch (e) { /* ignore */ }
    }
    if (ringItems.length > 1) return; // already ringing: just add to the list

    let n = 0;
    ringTimer = setInterval(() => {
      cdSound.keep();
      alSound.keep();
      if (navigator.vibrate && (n++ % 6 === 0)) navigator.vibrate([500, 250, 500]);
    }, 250);

    let flash = false;
    const first = () => ringItems[0] ? ringItems[0].label : '';
    titleTimer = setInterval(() => {
      flash = !flash;
      document.title = flash ? `⏰ 時間到！${first()}` : `🔔🔔🔔 ${first()}`;
    }, 700);
    document.title = `⏰ 時間到！${first()}`;

    el.html.classList.add('alarming');
    el.ringOverlay.hidden = false;
    restartStamp();
    el.stopBtn.focus();
  }

  function stopRinging() {
    if (!ringItems.length) return;
    if (ringTimer) clearInterval(ringTimer);
    if (titleTimer) clearInterval(titleTimer);
    ringTimer = titleTimer = null;
    if (navigator.vibrate) navigator.vibrate(0);
    el.ringOverlay.hidden = true;
    el.html.classList.remove('alarming');
    const items = ringItems;
    ringItems = [];
    if (items.some((i) => i.kind === 'alarm')) alSound.disarm();
    if (items.some((i) => i.kind === 'countdown')) resetToIdle();
    else document.title = S.status === 'idle' ? BASE_TITLE : document.title;
    S.lastShown = null;
    tick();
    armNextAlarm();
    updateSoundNote();
  }

  function resetToIdle() {
    el.idleView.hidden = false;
    el.sideInfo.hidden = true;
    stopTicker();
    cdSound.disarm();
    releaseWakeLock();
    clearTimer();
    S.status = 'idle';
    S.lastShown = null;
    el.digits.textContent = '';
    el.digits.classList.remove('danger');
    el.runPanel.hidden = true;
    el.setupPanel.hidden = false;
    if (!ringItems.length) document.title = BASE_TITLE;
    updateNow();
    updateModeUI();
    updateSoundNote();
  }

  /* ---------------- Alarm clock (multiple alarms, stored locally) ---------------- */
  const ALARMS_KEY = 'cd_alarms';

  function loadAlarms() {
    const raw = store.json(ALARMS_KEY, []);
    alarms = (Array.isArray(raw) ? raw : []).map(sanitizeAlarm).filter(Boolean);
    sortAlarms();
  }
  function saveAlarms() { store.set(ALARMS_KEY, JSON.stringify(alarms)); }
  function sortAlarms() { alarms.sort((a, b) => (a.h * 60 + a.m) - (b.h * 60 + b.m)); }

  function nextAlarm() {
    let best = null;
    for (const a of alarms) {
      if (!a.enabled || !a.nextAt) continue;
      if (!best || a.nextAt < best.nextAt) best = a;
    }
    return best;
  }

  let alArmedAt = 0;
  function armNextAlarm() {
    if (ringItems.some((i) => i.kind === 'alarm')) return; // don't cut off a ringing alarm
    const a = nextAlarm();
    if (!a || !Sound.hasContext()) { alSound.disarm(); return; }
    alSound.arm((a.nextAt - Date.now()) / 1000);
    alArmedAt = Date.now();
  }

  function fireAlarm(a) {
    startRinging({ kind: 'alarm', label: a.label || '鬧鐘', time: `${pad(a.h)}:${pad(a.m)}` });
  }

  // isLoad: page just opened → anything already due was missed while the page was closed.
  // Every enabled alarm rings from the page — "system" only means it was ALSO sent to the
  // phone's clock app (that hand-off can silently fail, so it must never replace web ringing).
  function checkAlarms(isLoad) {
    const now = Date.now();
    let changed = false;
    for (const a of alarms) {
      if (!a.enabled) continue;
      if (!a.nextAt) { a.nextAt = nextOccurrence(a, now); changed = true; continue; }
      if (now < a.nextAt) {
        // stored time must match the alarm's h:m; otherwise recompute
        const d = new Date(a.nextAt);
        if (isLoad && (d.getHours() !== a.h || d.getMinutes() !== a.m)) { a.nextAt = nextOccurrence(a, now); changed = true; }
        continue;
      }
      if (isLoad) addMissed(`鬧鐘「${a.label || '鬧鐘'}」（${fmtWhen(a.nextAt)}）`);
      else fireAlarm(a);
      if (a.days.length) a.nextAt = nextOccurrence(a, now);
      else a.enabled = false;
      changed = true;
    }
    if (changed) {
      saveAlarms();
      renderAlarms();
      armNextAlarm();
      updateSoundNote();
    }
  }

  function renderNextAlarmLine() {
    const a = nextAlarm();
    el.nextAlarmLine.textContent = a ? `⏰ 下一個鬧鐘：${fmtWhen(a.nextAt)}・${a.label || '鬧鐘'}` : '';
  }

  function renderAlarms() {
    const list = el.alarmList;
    list.textContent = '';
    for (const a of alarms) {
      const row = document.createElement('div');
      row.className = 'alarm-item' + (a.enabled ? '' : ' off');
      row.dataset.id = a.id;

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'al-main';
      main.dataset.act = 'edit';
      main.title = '編輯鬧鐘';
      const time = document.createElement('span');
      time.className = 'al-time';
      time.textContent = `${pad(a.h)}:${pad(a.m)}`;
      const meta = document.createElement('span');
      meta.className = 'al-meta';
      const name = document.createElement('b');
      name.textContent = a.label || '鬧鐘';
      const info = document.createElement('small');
      info.textContent = `${repeatText(a.days)}・${a.enabled && a.nextAt ? '下次 ' + fmtWhen(a.nextAt) : '已關閉'}`
        + (a.system ? '・📱 也已加到手機時鐘' : '');
      meta.append(name, info);
      main.append(time, meta);
      row.appendChild(main);

      if (a.system && canIntent) {
        const sys = document.createElement('button');
        sys.type = 'button';
        sys.className = 'al-icon';
        sys.dataset.act = 'intent';
        sys.title = '再次加到手機時鐘';
        sys.setAttribute('aria-label', '再次加到手機時鐘');
        sys.textContent = '📱';
        row.appendChild(sys);
      }

      const sw = document.createElement('label');
      sw.className = 'switch';
      sw.title = a.enabled ? '關閉鬧鐘' : '開啟鬧鐘';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = a.enabled;
      cb.dataset.act = 'toggle';
      cb.setAttribute('aria-label', `${pad(a.h)}:${pad(a.m)} ${a.label || '鬧鐘'} 開關`);
      const knob = document.createElement('span');
      sw.append(cb, knob);
      row.appendChild(sw);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'al-icon al-del';
      del.dataset.act = 'del';
      del.title = '刪除';
      del.setAttribute('aria-label', '刪除鬧鐘');
      del.textContent = '✕';
      row.appendChild(del);

      list.appendChild(row);
    }
    el.alarmEmpty.hidden = alarms.length > 0 || !el.alarmEditor.hidden;
    const on = alarms.filter((a) => a.enabled).length;
    el.alarmCount.textContent = on ? String(on) : '';
    el.alarmCount.hidden = !on;
    renderNextAlarmLine();
  }

  // ----- editor -----
  let editingId = null;
  let editorDays = [];
  function renderEditorDays() {
    el.alDays.querySelectorAll('[data-day]').forEach((b) => b.setAttribute('aria-pressed', String(editorDays.includes(+b.dataset.day))));
    const key = editorDays.join();
    const preset = !editorDays.length ? 'once' : editorDays.length === 7 ? 'daily' : key === '1,2,3,4,5' ? 'weekdays' : key === '0,6' ? 'weekend' : '';
    el.alPresets.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === preset)));
  }
  function openEditor(a) {
    editingId = a ? a.id : null;
    el.editorTitle.textContent = a ? '編輯鬧鐘' : '新增鬧鐘';
    if (a) {
      el.alHour.value = String(a.h);
      el.alMin.value = String(a.m);
      el.alLabel.value = a.label;
      editorDays = [...a.days];
    } else {
      const d = new Date(Date.now() + 60 * 60000);
      el.alHour.value = String(d.getHours());
      el.alMin.value = String(d.getMinutes());
      el.alLabel.value = '';
      editorDays = [];
    }
    el.alMsg.textContent = '';
    renderEditorDays();
    el.alarmEditor.hidden = false;
    el.alarmPanel.classList.add('editing');
    el.alarmList.hidden = true;
    el.alarmEmpty.hidden = true;
    el.addAlarmBtn.hidden = true;
    el.alHour.focus({ preventScroll: true });
  }
  function closeEditor() {
    editingId = null;
    el.alarmEditor.hidden = true;
    el.alarmPanel.classList.remove('editing');
    el.alarmList.hidden = false;
    el.addAlarmBtn.hidden = false;
    renderAlarms();
  }
  function saveEditor(e) {
    e.preventDefault();
    const h = Number(el.alHour.value), m = Number(el.alMin.value);
    if (!(h >= 0 && h <= 23 && m >= 0 && m <= 59)) { el.alMsg.textContent = '請選擇鬧鐘時間'; return; }
    const label = el.alLabel.value.trim() || '鬧鐘';
    // Hand the alarm to the system clock only where intents actually work.
    const androidMode = effectiveMode() === 'android';
    const system = androidMode && canIntent; // also try adding it to the phone's clock app
    let a = editingId ? alarms.find((x) => x.id === editingId) : null;
    if (!a) { a = { id: uid() }; alarms.push(a); }
    Object.assign(a, { h, m, label, days: [...editorDays].sort((x, y) => x - y), enabled: true, system });
    const now = Date.now();
    a.nextAt = nextOccurrence(a, now);
    sortAlarms();
    saveAlarms();
    closeEditor();
    armNextAlarm();
    updateSoundNote();
    setAlarmMsg(savedText(a, now));
    if (system) openIntent(buildIntentUrl(h, m, label), () => alarmIntentFailed(a.id));
  }

  // Confirmation after saving. A one-time alarm whose time is the current minute or
  // already passed today goes to TOMORROW — say so, or it looks like it "didn't work".
  function savedText(a, now) {
    const today = new Date(now);
    const passedToday = a.h * 60 + a.m <= today.getHours() * 60 + today.getMinutes();
    const when = fmtWhen(a.nextAt, now);
    const warn = !a.days.length && passedToday ? `（今天的 ${pad(a.h)}:${pad(a.m)} 已經過了）` : '';
    return `✅ 已設定「${a.label}」：將在 ${when} 響鈴${warn}。請保持此頁開啟。`;
  }

  // The phone's clock app didn't open. The alarm still rings from this page.
  function alarmIntentFailed(id) {
    const a = alarms.find((x) => x.id === id);
    if (!a || !a.system) return;
    a.system = false;
    saveAlarms();
    if (el.alarmEditor.hidden) renderAlarms();
    setAlarmMsg(`${savedText(a, Date.now())}（無法加到手機時鐘 App，例如電腦上的手機模擬，所以只由此網頁響鈴。）`);
  }
  function setAlarmMsg(text) { el.alarmMsg.textContent = text; el.alarmMsg.hidden = !text; }

  /* ---------------- Stopwatch ---------------- */
  const SW_KEY = 'cd_sw';
  let sw = swEmpty();
  let swRaf = 0;

  function loadSw() { sw = sanitizeStopwatch(store.json(SW_KEY, null), Date.now()); }
  function saveSw() {
    if (!sw.running && !sw.accumulated && !sw.laps.length) store.del(SW_KEY);
    else store.set(SW_KEY, JSON.stringify(sw));
  }

  function swToggle() {
    const now = Date.now();
    if (sw.running) { sw.accumulated = swElapsed(sw, now); sw.running = false; sw.startAt = 0; }
    else { sw.running = true; sw.startAt = now; }
    saveSw(); renderSw(); swKick();
  }
  function swLap() {
    if (!sw.running) return;
    sw.laps.push(swElapsed(sw, Date.now()));
    if (sw.laps.length > 999) sw.laps.shift();
    saveSw(); renderSw();
  }
  function swReset() {
    if (sw.running) return;
    sw = swEmpty();
    saveSw(); renderSw();
  }

  // Digits only: runs every animation frame while the stopwatch is running and visible.
  function renderSwTime() {
    const ms = swElapsed(sw, Date.now());
    const str = formatStopwatch(ms);
    const long = str.length > 8; // H:MM:SS.cc
    for (const box of [el.swBig, el.swDigits]) {
      setDigits(str, box, { animate: false });
      box.classList.toggle('has-hours', long);
    }
    const n = sw.laps.length;
    const lapText = n ? `第 ${n + 1} 圈 ${formatStopwatch(ms - sw.laps[n - 1])}` : '';
    if (el.swLapNow.textContent !== lapText) { el.swLapNow.textContent = lapText; el.swBigLap.textContent = lapText; }
  }

  // Buttons, lap list and digits.
  function renderSw() {
    const elapsed = swElapsed(sw, Date.now());
    el.swStartBtn.textContent = sw.running ? '暫停' : (elapsed > 0 ? '繼續' : '開始');
    el.swStartBtn.classList.toggle('danger', sw.running);
    el.swStartBtn.classList.toggle('primary', !sw.running);
    const showReset = !sw.running && elapsed > 0;
    el.swLapBtn.textContent = showReset ? '重設' : '計圈';
    el.swLapBtn.dataset.act = showReset ? 'reset' : 'lap';
    el.swLapBtn.disabled = !sw.running && !showReset;

    const list = el.swLaps;
    list.textContent = '';
    const rows = lapRows(sw.laps);
    for (let i = rows.length - 1; i >= 0; i--) { // newest first
      const r = rows[i];
      const li = document.createElement('li');
      li.className = 'lap' + (r.best ? ' best' : '') + (r.worst ? ' worst' : '');
      if (r.best) li.title = '最快的一圈';
      if (r.worst) li.title = '最慢的一圈';
      const n = document.createElement('span');
      n.className = 'lap-n';
      n.textContent = `第 ${r.n} 圈`;
      li.append(n, lapCell('lap-split', '單圈', r.split), lapCell('lap-total', '總計', r.total));
      list.appendChild(li);
    }
    list.hidden = !rows.length;
    el.swEmpty.hidden = rows.length > 0;
    renderSwTime();
  }
  function lapCell(cls, name, ms) {
    const c = document.createElement('span');
    c.className = cls;
    const sm = document.createElement('small');
    sm.textContent = name;
    c.append(sm, ' ', formatStopwatch(ms));
    return c;
  }

  function swFrame() {
    swRaf = 0;
    renderSwTime();
    swKick();
  }
  // Draw hundredths only while it matters: running, on the stopwatch tab, page visible.
  function swKick() {
    if (swRaf || !sw.running || view !== 'stopwatch' || document.hidden) return;
    swRaf = requestAnimationFrame(swFrame);
  }

  const isTyping = (t) => t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]');
  let swSpaceHandled = false;
  // Stopwatch tab shortcuts: Space = start/pause, L = lap, R = reset (when paused).
  function swKeydown(e) {
    if (view !== 'stopwatch' || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || isSheetOpen()) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === ' ') { e.preventDefault(); swSpaceHandled = true; if (!e.repeat) swToggle(); return; }
    if (e.repeat) return;
    if (k === 'l') { e.preventDefault(); swLap(); }
    else if (k === 'r') { e.preventDefault(); swReset(); }
  }

  /* ---------------- Events ---------------- */
  el.quick.addEventListener('click', (e) => {
    const b = e.target.closest('[data-min]');
    if (!b) return;
    el.minutesInput.value = b.dataset.min;
    start(Number(b.dataset.min));
  });
  el.startBtn.addEventListener('click', () => start(parseFloat(el.minutesInput.value)));
  [el.minutesInput, el.labelInput].forEach((inp) => inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); start(parseFloat(el.minutesInput.value)); }
  }));
  el.pauseBtn.addEventListener('click', togglePause);
  el.cancelBtn.addEventListener('click', () => { const m = S.mode; resetToIdle(); setMsg(m === 'android' ? '已關閉倒數（系統鬧鐘需到時鐘 App 刪除）' : '已取消'); });
  el.stopBtn.addEventListener('click', stopRinging);
  document.addEventListener('keydown', (e) => {
    // Ringing takes priority over closing the settings sheet.
    if (ringItems.length && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); stopRinging(); return; }
    if (e.key === 'Escape' && isSheetOpen()) { e.preventDefault(); closeSettings(); return; }
    swKeydown(e);
  });
  // A focused button would also "click" on Space keyup: cancel that when the shortcut used Space.
  document.addEventListener('keyup', (e) => {
    if (e.key === ' ' && swSpaceHandled) { e.preventDefault(); swSpaceHandled = false; }
  });
  el.swStartBtn.addEventListener('click', swToggle);
  el.swLapBtn.addEventListener('click', () => { if (el.swLapBtn.dataset.act === 'reset') swReset(); else swLap(); });

  el.settingsBtn.addEventListener('click', openSettings);
  el.modeBadge.addEventListener('click', openSettings);
  el.sheetClose.addEventListener('click', closeSettings);
  el.sheetBackdrop.addEventListener('click', closeSettings);

  el.modeOpts.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b || S.status !== 'idle') return;
    modePref = b.dataset.mode;
    store.set('cd_mode', modePref);
    setMsg('');
    updateModeUI();
  });
  el.styleGrid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-name]');
    if (b) applyTheme(b.dataset.themeName, true);
  });
  el.notifyBtn.addEventListener('click', () => {
    if ('Notification' in window) Notification.requestPermission().then(updateModeUI);
  });

  // view tabs
  el.tabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b) setView(b.dataset.view);
  });

  // The fallback "open system alarm" link must not fire an intent off-Android either.
  el.intentLink.addEventListener('click', (e) => {
    e.preventDefault();
    if (S.intentUrl) openIntent(S.intentUrl, countdownIntentFailed);
  });

  // alarm list actions
  el.addAlarmBtn.addEventListener('click', () => { setAlarmMsg(''); openEditor(null); });
  el.alCancel.addEventListener('click', closeEditor);
  el.alarmEditor.addEventListener('submit', saveEditor);
  el.alarmList.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const row = t.closest('.alarm-item');
    const a = row && alarms.find((x) => x.id === row.dataset.id);
    if (!a) return;
    const act = t.dataset.act;
    if (act === 'edit') openEditor(a);
    else if (act === 'intent') { setAlarmMsg(''); openIntent(buildIntentUrl(a.h, a.m, a.label || '鬧鐘'), () => alarmIntentFailed(a.id)); }
    else if (act === 'del') {
      alarms = alarms.filter((x) => x.id !== a.id);
      saveAlarms(); renderAlarms(); armNextAlarm(); updateSoundNote();
    }
  });
  el.alarmList.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-act="toggle"]');
    if (!cb) return;
    const a = alarms.find((x) => x.id === cb.closest('.alarm-item').dataset.id);
    if (!a) return;
    a.enabled = cb.checked;
    if (a.enabled) a.nextAt = nextOccurrence(a, Date.now());
    saveAlarms(); renderAlarms(); armNextAlarm(); updateSoundNote();
  });
  el.alPresets.addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    editorDays = { once: [], daily: [0, 1, 2, 3, 4, 5, 6], weekdays: [1, 2, 3, 4, 5], weekend: [0, 6] }[b.dataset.preset] || [];
    renderEditorDays();
  });
  el.alDays.addEventListener('click', (e) => {
    const b = e.target.closest('[data-day]');
    if (!b) return;
    const d = +b.dataset.day;
    editorDays = editorDays.includes(d) ? editorDays.filter((x) => x !== d) : [...editorDays, d].sort((x, y) => x - y);
    renderEditorDays();
  });

  // notices
  el.missedClose.addEventListener('click', (e) => { e.stopPropagation(); clearMissed(); });
  notices().forEach((n) => n.addEventListener('click', () => {
    if (!el.html.classList.contains('app-layout')) return;
    collapseNotices(n);
    n.classList.toggle('expanded');
  }));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.notice')) collapseNotices();
  });
  ['pointerdown', 'touchend', 'keydown', 'click'].forEach((t) => document.addEventListener(t, unlockOnGesture, true));
  window.addEventListener('resize', updateLayout);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    Sound.resume();
    tick();
    checkAlarms(false);
    if (S.status === 'running' && S.mode === 'web' && device !== 'desktop') requestWakeLock();
    if (view === 'stopwatch') { renderSwTime(); swKick(); }
  });

  // Another tab changed the alarm list → reload it.
  window.addEventListener('storage', (e) => {
    if (e.key === SW_KEY) { loadSw(); renderSw(); swKick(); return; }
    if (e.key !== ALARMS_KEY) return;
    loadAlarms();
    if (el.alarmEditor.hidden) renderAlarms();
    armNextAlarm();
    updateSoundNote();
  });

  /* ---------------- Init ---------------- */
  for (let i = 0; i < 60; i++) { // 24-hour pickers
    if (i < 24) el.alHour.add(new Option(pad(i), String(i)));
    el.alMin.add(new Option(pad(i), String(i)));
  }
  loadAlarms();
  loadSw();
  updateLayout();
  applyTheme(theme, false);
  setView(view);
  restoreTimer();
  checkAlarms(true);
  renderAlarms();
  updateModeUI();
  updateNow();
  updateSoundNote();

  let lastMinute = new Date().getMinutes();
  setInterval(() => {
    updateNow();
    checkAlarms(false);
    const mi = new Date().getMinutes();
    if (mi !== lastMinute) { // keep "今天/明天" texts fresh
      lastMinute = mi;
      if (el.alarmEditor.hidden) renderAlarms();
    }
    if (alSound.s && Date.now() - alArmedAt > 30 * 60000) armNextAlarm(); // limit audio-clock drift
    updateSoundNote();
  }, 1000);

  // Exposed for manual testing in DevTools.
  window.__countdown = { core: window.TimerCore, state: S, stopwatch: () => sw };
})();
