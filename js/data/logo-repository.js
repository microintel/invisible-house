/* ============================================================
   DATA LAYER · Logo repository  (MicroIntel MF Logos)
   ------------------------------------------------------------
   Source of truth:
     service.json  https://raw.githubusercontent.com/microintel/mf-logos/main/service.json
     mf-logos.json https://raw.githubusercontent.com/microintel/mf-logos/main/mf-logos.json
   The two published manifests are not always identical (each has
   a few funds the other lacks), so both are fetched and merged by
   image file name.

   Load order, so logos are available synchronously on first paint:
     1. built-in seed (works offline / if GitHub raw is down)
     2. localStorage cache (stale-while-revalidate, 7 day TTL)
     3. network refresh in the background
   Subscribers are notified whenever the list changes.
   ============================================================ */
(function (global) {
  'use strict';

  const BASE = 'https://raw.githubusercontent.com/microintel/mf-logos/main/';
  const SERVICE_URL = BASE + 'service.json';
  const ARRAY_URL = BASE + 'mf-logos.json';
  const IMG_BASE = BASE + 'images/';
  const CACHE_KEY = 'ih_mf_logos_v1';
  const TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 6000;

  // [display name, image file]  (file null → slug of the name + ".png")
  const SEED = [
    ['360 ONE Mutual Fund'], ['Abakkus Mutual Fund'], ['Aditya Birla Sun Life Mutual Fund'],
    ['Alphagrep Mutual Fund'], ['Angel One Mutual Fund'], ['Ask Mutual Fund'], ['Axis Mutual Fund'],
    ['Bajaj Finserv Mutual Fund'], ['Bandhan Idfc Mutual Fund', 'bandhan-mutual-fund-idfc.png'],
    ['Bandhan Mutual Fund'], ['Bank Of India Mutual Fund'], ['Baroda Bnp Paribas Mutual Fund'],
    ['Canara Robeco Mutual Fund'], ['Capitalmind Mutual Fund'], ['Choice Mutual Fund'],
    ['DSP Mutual Fund'], ['Edelweiss Mutual Fund'], ['Franklin Templeton Mutual Fund'],
    ['Groww Mutual Fund'], ['HDFC Mutual Fund'], ['Helios Mutual Fund'], ['HSBC Mutual Fund'],
    ['ICICI Prudential Mutual Fund'], ['Invesco Mutual Fund'], ['ITI Mutual Fund'],
    ['Jio BlackRock Mutual Fund'], ['Jm Financial Mutual Fund'], ['Kotak Mahindra Mutual Fund'],
    ['LIC Mutual Fund'], ['Mahindra Manulife Mutual Fund'], ['Mirae Asset Mutual Fund'],
    ['Monarch Mutual Fund'], ['Motilal Oswal Mutual Fund'], ['Navi Mutual Fund'],
    ['Nippon India Mutual Fund'], ['NJ Mutual Fund'], ['Old Bridge Mutual Fund'],
    ['Peerless Mutual Fund'], ['PGIM India Mutual Fund'], ['PPFAS Mutual Fund'],
    ['Quant Mutual Fund'], ['Quantum Mutual Fund'], ['Samco Mutual Fund'], ['SBI Mutual Fund'],
    ['Shriram Mutual Fund'], ['Sundaram Mutual Fund'], ['Tata Mutual Fund'], ['Taurus Mutual Fund'],
    ['The Wealth Company Mutual Fund'], ['Trust Mutual Fund'], ['Unifi Mutual Fund'],
    ['Union Mutual Fund'], ['UTI Mutual Fund'], ['Whiteoak Capital Mutual Fund'],
    ['Zerodha Mutual Fund']
  ];

  function slugify(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function slugFromUrl(url) {
    const file = String(url).split('?')[0].split('#')[0].split('/').pop() || '';
    return file.replace(/\.[a-z0-9]+$/i, '').toLowerCase();
  }

  /** Validates untrusted JSON → [{name,url,slug}] (https only, deduped by slug). */
  function sanitize(list) {
    const out = [];
    const seen = new Set();
    (Array.isArray(list) ? list : []).forEach(item => {
      if (!item || typeof item.name !== 'string' || typeof item.url !== 'string') return;
      if (!/^https:\/\//i.test(item.url)) return;
      const slug = slugFromUrl(item.url);
      if (!slug || seen.has(slug)) return;
      seen.add(slug);
      out.push({ name: item.name.trim(), url: item.url, slug });
    });
    return out;
  }

  function merge(...lists) {
    const out = [];
    const seen = new Set();
    lists.forEach(list => list.forEach(e => {
      if (seen.has(e.slug)) return;
      seen.add(e.slug);
      out.push(e);
    }));
    return out;
  }

  const seedEntries = sanitize(SEED.map(([name, file]) => ({
    name,
    url: IMG_BASE + (file || (slugify(name) + '.png'))
  })));

  let entries = seedEntries;
  let started = false;
  const listeners = new Set();

  function emit() {
    listeners.forEach(cb => { try { cb(entries); } catch (e) {} });
  }

  function readCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (raw && Array.isArray(raw.funds) && raw.funds.length) {
        return { ts: raw.ts || 0, funds: sanitize(raw.funds) };
      }
    } catch (e) {}
    return null;
  }

  function writeCache(funds) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        ts: Date.now(),
        funds: funds.map(f => ({ name: f.name, url: f.url }))
      }));
    } catch (e) {}
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function refresh() {
    const [svc, arr] = await Promise.allSettled([fetchJson(SERVICE_URL), fetchJson(ARRAY_URL)]);
    const fromService = svc.status === 'fulfilled' ? sanitize(svc.value && svc.value.funds) : [];
    const fromArray = arr.status === 'fulfilled' ? sanitize(arr.value) : [];
    const merged = merge(fromService, fromArray);
    if (!merged.length) return false;
    writeCache(merged);
    // Seed stays underneath: a truncated/partial manifest must never make
    // a known logo disappear (a removed image just falls through to favicons).
    entries = merge(merged, seedEntries);
    emit();
    return true;
  }

  const LogoRepository = {
    /** Current merged logo list: [{name,url,slug}] */
    getAll() { return entries; },

    getBySlug(slug) { return entries.find(e => e.slug === slug) || null; },

    /** Subscribe to list changes (cache hydrate / network refresh). */
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },

    /** Idempotent. Seed is already in place; this layers cache + network on top. */
    init() {
      if (started) return;
      started = true;
      const cached = readCache();
      if (cached) {
        entries = merge(cached.funds, seedEntries);
        emit();
      }
      if (!cached || Date.now() - cached.ts > TTL_MS) {
        refresh().catch(() => {});
      }
    },

    refresh
  };

  global.LogoRepository = LogoRepository;
})(window);
