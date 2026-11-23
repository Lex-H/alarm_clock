/*
 * core.js — pure logic with no DOM access.
 * Shared by app.js through window.TimerCore, and loadable in Node for tests.
 */
(function (root) {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');
  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

  /* ---------- localStorage wrapper (never throws) ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
    json(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } },
  };

  /* ---------- device detection ---------- */
  function detectDevice(ua, platform, maxTouchPoints) {
    ua = ua || '';
    if (/Android/i.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1)) return 'ios';
    if (/Mobi|Tablet|Silk|Kindle|BlackBerry|Opera Mini|IEMobile|webOS/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  /* ---------- time formatting ---------- */
  function formatRemaining(secs) {
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
  const hhmm = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  // "今天 07:30" / "明天 07:30" / "星期三 07:30" / "12/1 07:30"
  function fmtWhen(ts, nowTs) {
    const d = new Date(ts), now = new Date(nowTs || Date.now());
    const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - day0) / 86400000);
    const t = hhmm(ts);
    if (diff === 0) return `今天 ${t}`;
    if (diff === 1) return `明天 ${t}`;
    if (diff === -1) return `昨天 ${t}`;
    if (diff > 1 && diff < 7) return `星期${WEEKDAYS[d.getDay()]} ${t}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${t}`;
  }

  /* ---------- Android SET_ALARM intent ---------- */
  // now + minutes → target hour (0–23) and minute (0–59), with carry and day wrap.
  function computeAlarmTime(nowDate, minutes) {
    const total = nowDate.getHours() * 60 + nowDate.getMinutes() + minutes;
    return { h: Math.floor(total / 60) % 24, m: total % 60 };
  }
  function buildIntentUrl(h, m, msg) {
    return 'intent:#Intent;action=android.intent.action.SET_ALARM;' +
      `i.android.intent.extra.alarm.HOUR=${h};` +
      `i.android.intent.extra.alarm.MINUTES=${m};` +
      `S.android.intent.extra.alarm.MESSAGE=${encodeURIComponent(msg)};` +
      'B.android.intent.extra.alarm.SKIP_UI=true;end';
  }

  /* ---------- alarm clock ---------- */
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // Validate one stored alarm; returns null for anything malformed.
  function sanitizeAlarm(a) {
    if (!a || typeof a !== 'object') return null;
    const h = Number(a.h), m = Number(a.m);
    if (!Number.isInteger(h) || h < 0 || h > 23 || !Number.isInteger(m) || m < 0 || m > 59) return null;
    const days = Array.isArray(a.days)
      ? [...new Set(a.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((x, y) => x - y)
      : [];
    return {
      id: typeof a.id === 'string' && a.id ? a.id.slice(0, 40) : uid(),
      h, m, days,
      label: String(a.label || '').slice(0, 40),
      enabled: !!a.enabled,
      nextAt: Number.isFinite(Number(a.nextAt)) ? Number(a.nextAt) : 0,
      system: !!a.system,
    };
  }

  // Next ring time strictly after `from`. days = [] means "ring once".
  function nextOccurrence(a, from) {
    const d = new Date(from);
    for (let i = 0; i <= 7; i++) {
      const c = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, a.h, a.m, 0, 0);
      if (c.getTime() <= from) continue;
      if (!a.days.length || a.days.includes(c.getDay())) return c.getTime();
    }
    return 0;
  }

  function repeatText(days) {
    if (!days.length) return '只響一次';
    if (days.length === 7) return '每天';
    if (days.join() === '1,2,3,4,5') return '平日';
    if (days.join() === '0,6') return '週末';
    return '每週' + [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d)).map((d) => WEEKDAYS[d]).join('、');
  }

  const TimerCore = {
    pad, WEEKDAYS, store, detectDevice, formatRemaining, hhmm, fmtWhen,
    computeAlarmTime, buildIntentUrl, uid, sanitizeAlarm, nextOccurrence, repeatText,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = TimerCore;
  root.TimerCore = TimerCore;
})(typeof window !== 'undefined' ? window : globalThis);
