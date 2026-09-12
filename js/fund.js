// ---------- IndexedDB cache layer ----------
const IDB_NAME = 'sipTrackerCache';
const IDB_VERSION = 1;

let idbPromise = null;
function openIdb(){
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve) => {
    if (!('indexedDB' in window)){ resolve(null); return; }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('fundList')) db.createObjectStore('fundList', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('navCache')) db.createObjectStore('navCache', { keyPath: 'code' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return idbPromise;
}

async function idbGet(storeName, key){
  const db = await openIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try{
      const req = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch(e){ resolve(null); }
  });
}

async function idbSet(storeName, value){
  const db = await openIdb();
  if (!db) return;
  return new Promise((resolve) => {
    try{
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch(e){ resolve(); }
  });
}

// ---------- Search ----------
const searchInput = document.getElementById('searchInput');
const manualSearchBtn = document.getElementById('manualSearchBtn');
const suggestionsBox = document.getElementById('suggestions');
const statusEl = document.getElementById('status');
const statusSpinner = document.getElementById('statusSpinner');
const statusText = document.getElementById('statusText');
const card = document.getElementById('card');

let debounceTimer = null;
let activeIndex = -1;
let currentItems = [];
let currentNavData = [];
let currentSchemeName = 'fund';
let currentFundMeta = null;
let currentChartRange = 'max';

function setStatus(msg, isError=false, isLoading=false){
  statusText.textContent = msg;
  statusEl.className = 'status' + (isError ? ' error' : '');
  statusSpinner.classList.toggle('show', isLoading);
}

function friendlyMessage(err, kind){
  const isAbort = err && err.name === 'AbortError';
  const msg = (err && err.message || '').toLowerCase();

  if (isAbort){
    return "That's taking longer than it should. Please try again.";
  }
  if (msg.includes('server responded') || msg.includes('http')){
    return "The fund data service seems to be having trouble right now. Please try again in a moment.";
  }
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed')){
    return "Couldn't connect. Please check your internet connection and try again.";
  }
  if (msg.includes('no nav history') || msg.includes('empty fund list')){
    return kind === 'list'
      ? "We couldn't find any fund data right now. Please try again."
      : "We couldn't find details for this fund. Please try again or pick another one.";
  }
  return "Something went wrong. Please try again.";
}

// ---------- Notifications (SweetAlert2, with a plain-alert fallback) ----------
function notifyToast(message, icon='warning'){
  if (typeof Swal === 'undefined'){ alert(message); return; }
  Swal.fire({
    toast: true,
    position: 'top',
    icon,
    title: message,
    showConfirmButton: false,
    timer: 3200,
    timerProgressBar: true,
    customClass: { popup: 'ih-swal-toast' }
  });
}

function notifyError(message){
  if (typeof Swal === 'undefined'){ alert(message); return; }
  Swal.fire({
    icon: 'error',
    title: 'Something went wrong',
    text: message,
    confirmButtonText: 'Got it',
    customClass: { popup: 'ih-swal', container: 'ih-swal-backdrop' }
  });
}

/*
  Search downloads the full mfapi scheme list (~40k entries) once, caches
  it in IndexedDB, and matches locally: each typed word just needs to
  appear somewhere in a scheme name (any order, no need to be adjacent).
  This is what correctly surfaces every Direct/Regular/Growth/IDCW variant
  even when the fund's underlying AMFI name doesn't read the way the fund
  is commonly known (e.g. "Motilal Oswal Midcap Fund" is actually stored
  as "Motilal Oswal MOSt Focused Midcap 30 Fund").
*/
const FUND_LIST_TTL_MS = 24 * 60 * 60 * 1000;
const firstLoadLoader = document.getElementById('firstLoadLoader');

let allFunds = [];
let fundsLoaded = false;
let fundsLoading = false;
let searchIndex = [];
let prefixIndex = new Map();

function buildSearchIndex(){
  const n = allFunds.length;
  searchIndex = new Array(n);
  prefixIndex = new Map();
  for (let i = 0; i < n; i++){
    const lname = (allFunds[i].schemeName || '').toLowerCase();
    searchIndex[i] = lname;
    const tokens = lname.split(/[^a-z0-9]+/);
    const seenPrefixes = new Set();
    for (let t = 0; t < tokens.length; t++){
      const tok = tokens[t];
      if (tok.length < 3) continue;
      const prefix = tok.slice(0, 3);
      if (seenPrefixes.has(prefix)) continue;
      seenPrefixes.add(prefix);
      let bucket = prefixIndex.get(prefix);
      if (!bucket){ bucket = []; prefixIndex.set(prefix, bucket); }
      bucket.push(i);
    }
  }
}

async function loadFundList(attempt=1){
  if (fundsLoaded || fundsLoading) return;
  fundsLoading = true;

  if (attempt === 1){
    const cached = await idbGet('fundList', 'all');
    if (cached && Array.isArray(cached.data) && cached.data.length){
      allFunds = cached.data;
      fundsLoaded = true;
      fundsLoading = false;
      buildSearchIndex();
      setStatus('');
      searchInput.disabled = false;
      if (firstLoadLoader) firstLoadLoader.classList.remove('show');
      if (Date.now() - (cached.ts || 0) > FUND_LIST_TTL_MS){
        refreshFundListInBackground();
      }
      return;
    }
  }

  searchInput.disabled = true;
  if (firstLoadLoader) firstLoadLoader.classList.add('show');
  const MAX_ATTEMPTS = 3;
  try{
    const res = await fetchWithTimeout('https://api.mfapi.in/mf', 20000);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) throw new Error('Empty fund list returned');
    allFunds = data;
    fundsLoaded = true;
    buildSearchIndex();
    idbSet('fundList', { key: 'all', data, ts: Date.now() });
    setStatus('');
  } catch(err){
    fundsLoading = false;
    if (attempt < MAX_ATTEMPTS){
      if (firstLoadLoader) firstLoadLoader.classList.remove('show');
      searchInput.disabled = false;
      await new Promise(r => setTimeout(r, attempt * 700));
      return loadFundList(attempt + 1);
    }
    showRetryListError(friendlyMessage(err, 'list'));
  } finally{
    fundsLoading = false;
    searchInput.disabled = false;
    if (firstLoadLoader) firstLoadLoader.classList.remove('show');
  }
}

async function refreshFundListInBackground(){
  try{
    const res = await fetchWithTimeout('https://api.mfapi.in/mf', 20000);
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return;
    allFunds = data;
    buildSearchIndex();
    idbSet('fundList', { key: 'all', data, ts: Date.now() });
  } catch(e){}
}

function showRetryListError(message){
  statusEl.className = 'status error';
  statusSpinner.classList.remove('show');
  statusText.innerHTML = `${escapeHtml(message)} <button type="button" id="statusRetryListBtn" class="status-retry-btn">Retry</button>`;
  const btn = document.getElementById('statusRetryListBtn');
  if (btn){
    btn.addEventListener('click', () => loadFundList());
  }
}

loadFundList();

const SEARCH_RESULT_LIMIT = 30;

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  clearTimeout(debounceTimer);
  activeIndex = -1;

  if (q.length < 3){
    suggestionsBox.classList.remove('show');
    suggestionsBox.innerHTML = '';
    setStatus('');
    return;
  }

  setStatus('Searching...', false, true);
  debounceTimer = setTimeout(() => runSearch(q), 120);
});

// Each call gets an id; if a newer search starts before an older one's
// network response comes back, the older response is discarded instead
// of overwriting the list with stale results (this used to be able to
// show the wrong — or no — match for whatever was actually typed).
let searchRequestSeq = 0;

async function runSearch(query){
  warmFundAumMap();
  const requestId = ++searchRequestSeq;

  if (!fundsLoaded){
    setStatus('Fund database still loading, one moment...', false, true);
    await loadFundList();
    if (requestId !== searchRequestSeq) return;
    if (!fundsLoaded) return;
  }

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length){
    currentItems = [];
    renderSuggestions(currentItems);
    setStatus('');
    return;
  }

  const firstPrefix = words[0].length >= 3 ? words[0].slice(0, 3) : null;
  const candidates = (firstPrefix && prefixIndex.has(firstPrefix)) ? prefixIndex.get(firstPrefix) : null;
  const scanLength = candidates ? candidates.length : searchIndex.length;
  const matches = [];
  let matchCount = 0;

  for (let k = 0; k < scanLength; k++){
    const i = candidates ? candidates[k] : k;
    const lname = searchIndex[i];
    let ok = true;
    for (let w = 0; w < words.length; w++){
      if (lname.indexOf(words[w]) === -1){ ok = false; break; }
    }
    if (ok){
      matchCount++;
      if (matches.length < SEARCH_RESULT_LIMIT) matches.push(allFunds[i]);
    }
  }

  currentItems = matches;
  renderSuggestions(currentItems);
  setStatus(
    matchCount
      ? `${matchCount} result${matchCount === 1 ? '' : 's'}${matchCount > SEARCH_RESULT_LIMIT ? ` (showing first ${SEARCH_RESULT_LIMIT})` : ''}`
      : 'No matching funds found',
    !matchCount,
    false
  );
}

manualSearchBtn.addEventListener('click', async () => {
  const q = searchInput.value.trim();
  if (q.length < 3){
    setStatus('Type at least 3 characters to search.', true);
    searchInput.focus();
    return;
  }
  clearTimeout(debounceTimer);
  setStatus('Searching...', false, true);
  await runSearch(q);
});

searchInput.addEventListener('keydown', (e) => {
  const items = suggestionsBox.querySelectorAll('.suggestion-item');
  if (!items.length) return;

  if (e.key === 'ArrowDown'){
    e.preventDefault();
    activeIndex = Math.min(activeIndex + 1, items.length - 1);
    updateActive(items);
  } else if (e.key === 'ArrowUp'){
    e.preventDefault();
    activeIndex = Math.max(activeIndex - 1, 0);
    updateActive(items);
  } else if (e.key === 'Enter'){
    if (activeIndex >= 0 && currentItems[activeIndex]){
      selectFund(currentItems[activeIndex]);
    }
  } else if (e.key === 'Escape'){
    suggestionsBox.classList.remove('show');
  }
});

function updateActive(items){
  items.forEach(i => i.classList.remove('active'));
  if (activeIndex >= 0){
    items[activeIndex].classList.add('active');
    items[activeIndex].scrollIntoView({block:'nearest'});
  }
}

function renderSuggestions(items){
  if (!items.length){
    suggestionsBox.classList.remove('show');
    suggestionsBox.innerHTML = '';
    return;
  }
  suggestionsBox.innerHTML = items.map((item, idx) => {
    const domain = resolveAmcDomain(item.schemeName);
    const iconInner = domain
      ? `<img data-amc-domain="${escapeHtml(domain)}" alt="" referrerpolicy="no-referrer">`
      : `<i class="bi bi-piggy-bank"></i>`;
    const aumText = getFundAumText(item.schemeName);
    return `
    <div class="suggestion-item" data-idx="${idx}">
      <span class="suggestion-icon${domain ? ' has-logo' : ''}">${iconInner}</span>
      <span class="suggestion-info">
        <span class="suggestion-name">${escapeHtml(item.schemeName)}</span>
        <span class="suggestion-code">Scheme Code: ${item.schemeCode}</span>
      </span>
      ${aumText ? `<span class="suggestion-aum">${escapeHtml(aumText)}<small>AUM</small></span>` : ''}
      <i class="bi bi-chevron-right suggestion-arrow"></i>
    </div>
  `;
  }).join('');
  suggestionsBox.classList.add('show');

  attachSuggestionLogos(suggestionsBox);

  suggestionsBox.querySelectorAll('.suggestion-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.getAttribute('data-idx'));
      selectFund(currentItems[idx]);
    });
  });
}

// Shared helper: wires up the AMC logo <img> tags rendered inside any
// suggestion list (main search + compare search) to the fallback chain.
function attachSuggestionLogos(container){
  container.querySelectorAll('img[data-amc-domain]').forEach(img => {
    const domain = img.getAttribute('data-amc-domain');
    const fallback = () => {
      const wrap = img.parentElement;
      wrap.classList.remove('has-logo');
      wrap.innerHTML = '<i class="bi bi-piggy-bank"></i>';
    };
    img.src = amcLogoUrl(domain, 0);
    attachAmcLogoFallback(img, domain, fallback);
  });
}

/*
  Charts (single fund, and especially the 4-way compare chart) were
  rendering the full unfiltered NAV history — for older funds that's
  several thousand daily points, times up to 4 funds when comparing.
  Chart.js's 'index' hover mode has to scan every dataset on every
  mouse move, so that volume of points is what made the compare chart
  feel sluggish. We cap the number of points actually handed to
  Chart.js to a fixed budget, spread evenly across the series, while
  keeping the underlying full-resolution data intact for anything
  that needs exact values (CAGR, tooltips reference the same reduced
  set they were drawn from, so there's no mismatch).
*/
const CHART_POINT_BUDGET = 400;

function pickDecimationIndices(length, maxPoints){
  const idx = [];
  if (length <= maxPoints){
    for (let i = 0; i < length; i++) idx.push(i);
    return idx;
  }
  const step = (length - 1) / (maxPoints - 1);
  let last = -1;
  for (let i = 0; i < maxPoints; i++){
    const pos = Math.round(i * step);
    if (pos !== last){ idx.push(pos); last = pos; }
  }
  return idx;
}

/*
  AUM lookup for search results: discovery.js fetches and caches
  fund-level AUM data (for the homepage "Top funds" list) and exposes
  it as a normalized-name lookup map via window.getFundAumMap(). We
  keep a local copy once it resolves so suggestion rendering can stay
  synchronous; before it resolves, suggestions simply render without
  an AUM figure and pick it up on the next render.
*/
let fundAumMap = null;
function warmFundAumMap(){
  if (fundAumMap || typeof window.getFundAumMap !== 'function') return;
  window.getFundAumMap().then(map => { fundAumMap = map; }).catch(() => {});
}

function getFundAumText(schemeName){
  if (!fundAumMap) return null;
  const key = (typeof window.normalizeFundName === 'function'
    ? window.normalizeFundName(schemeName)
    : schemeName).toLowerCase();
  const aum = fundAumMap.get(key);
  if (!aum) return null;
  return (typeof window.formatAUM === 'function') ? window.formatAUM(aum) : null;
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function selectFund(item){
  searchInput.value = item.schemeName;
  suggestionsBox.classList.remove('show');
  await loadFundByCode(item.schemeCode);
}

let lastAttemptedSchemeCode = null;

async function fetchWithTimeout(url, ms){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try{
    return await fetch(url, { signal: controller.signal, cache: 'no-store' });
  } finally{
    clearTimeout(timer);
  }
}

async function loadFundByCode(schemeCode, attempt=1){
  const code = String(schemeCode).trim();
  lastAttemptedSchemeCode = code;
  const isFirstLoad = !card.classList.contains('show');

  let usedCache = false;
  if (attempt === 1){
    const cached = await idbGet('navCache', code);
    if (cached && cached.data){
      displayFund(cached.data, code);
      setStatus('');
      usedCache = true;
    }
  }

  if (!usedCache){
    setStatus(`Loading data for scheme code ${code}${attempt > 1 ? ` (retry ${attempt - 1})` : ''}...`, false, true);
    if (!isFirstLoad) card.classList.add('loading');
  }

  const MAX_ATTEMPTS = 3;
  try{
    const res = await fetchWithTimeout(`https://api.mfapi.in/mf/${encodeURIComponent(code)}`, 12000);
    if (!res.ok) throw new Error(`Server responded with ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.data) || !data.data.length){
      throw new Error('No NAV history returned for this scheme');
    }

    const freshLatest = data.data[0] || {};
    const cachedLatest = usedCache ? (currentNavData[0] || {}) : null;
    const isNewData = !usedCache
      || currentNavData.length !== data.data.length
      || cachedLatest.date !== freshLatest.date
      || cachedLatest.nav !== freshLatest.nav;
    if (isNewData){
      displayFund(data, code);
    }
    idbSet('navCache', { code, data, ts: Date.now() });
    setStatus('');
  } catch(err){
    if (usedCache) return;

    const isAbort = err.name === 'AbortError';
    if (attempt < MAX_ATTEMPTS && (isAbort || (err.message || '').startsWith('Server responded') || (err.message || '').includes('fetch'))){
      await new Promise(r => setTimeout(r, attempt * 500));
      card.classList.remove('loading');
      return loadFundByCode(code, attempt + 1);
    }

    showRetryableError(friendlyMessage(err, 'detail'));
  } finally{
    card.classList.remove('loading');
  }
}

function showRetryableError(message){
  statusEl.className = 'status error';
  statusSpinner.classList.remove('show');
  statusText.innerHTML = `${escapeHtml(message)} <button type="button" id="statusRetryBtn" class="status-retry-btn">Retry</button>`;
  const btn = document.getElementById('statusRetryBtn');
  if (btn){
    btn.addEventListener('click', () => {
      if (lastAttemptedSchemeCode) loadFundByCode(lastAttemptedSchemeCode);
    });
  }
}

const AMC_DOMAINS = {
  'sbi': 'sbimf.com',
  'hdfc': 'hdfcfund.com',
  'icici': 'icicipruamc.com',
  'aditya birla': 'mutualfund.adityabirlacapital.com',
  'birla sun life': 'mutualfund.adityabirlacapital.com',
  'axis': 'axismf.com',
  'kotak': 'kotakmf.com',
  'nippon': 'mf.nipponindiaim.com',
  'uti': 'utimf.com',
  'tata': 'tatamutualfund.com',
  'dsp': 'dspim.com',
  'franklin': 'franklintempletonindia.com',
  'invesco': 'invescomutualfund.com',
  'mirae': 'miraeassetmf.co.in',
  'motilal': 'motilaloswalmf.com',
  'pgim': 'pgimindiamf.com',
  'quantum': 'quantumamc.com',
  'quant': 'quantmutual.com',
  'edelweiss': 'edelweissmf.com',
  'canara': 'canararobeco.com',
  'bandhan': 'bandhanmutual.com',
  'idfc': 'bandhanmutual.com',
  'lic mutual': 'licmf.com',
  'lic mf': 'licmf.com',
  'baroda': 'barodabnpparibasmf.in',
  'sundaram': 'sundarammutual.com',
  'hsbc': 'assetmanagement.hsbc.co.in',
  'union': 'unionmf.com',
  'navi': 'navi.com',
  'whiteoak': 'whiteoakamc.com',
  'bank of india': 'boiaxamc.com',
  'jm financial': 'jmfinancialmf.com',
  'mahindra': 'mahindramanulife.com',
  '360 one': '360.one',
  'groww': 'groww.in',
  'samco': 'samco.in',
  'trust': 'trustmf.com',
  'iti mutual': 'itimf.com',
  'shriram': 'shriramamc.com',
  'nj mutual': 'njmutualfund.com',
  'old bridge': 'oldbridgemf.com',
  'parag parikh': 'ppfas.com',
  'taurus': 'taurusmutualfund.com',
  'pnb mutual': 'pnbamc.com',
  'indiabulls': 'groww.in',
  'helios': 'heliosmf.com',
  'zerodha': 'coin.zerodha.com',
  'unifi': 'unifimf.com'
};
const AMC_DOMAIN_KEYS = Object.keys(AMC_DOMAINS).sort((a, b) => b.length - a.length);

function resolveAmcDomain(fundHouseName){
  if (!fundHouseName) return null;
  const lower = fundHouseName.toLowerCase();
  const key = AMC_DOMAIN_KEYS.find(k => lower.includes(k));
  return key ? AMC_DOMAINS[key] : null;
}

/*
  Fund house logos: no single free logo service covers every AMC, so
  each domain gets several tries in order before giving up and
  showing the piggy-bank fallback icon. Google's favicons endpoint
  goes first since it's fast and reliable for most domains, but it
  doesn't have everything (small/newer AMCs especially), so we chain
  through a few more sources that each have different coverage before
  falling back.
*/
function amcLogoUrl(domain, stage){
  switch (stage){
    case 0: return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
    case 1: return `https://icons.duckduckgo.com/ip3/${domain}.ico`;
    case 2: return `https://logo.clearbit.com/${domain}?size=256`;
    default: return `https://${domain}/favicon.ico`;
  }
}
const AMC_LOGO_STAGE_COUNT = 4;

function attachAmcLogoFallback(img, domain, onFail){
  let stage = 0;
  img.addEventListener('error', function handler(){
    stage++;
    if (stage < AMC_LOGO_STAGE_COUNT){
      img.src = amcLogoUrl(domain, stage);
    } else {
      img.removeEventListener('error', handler);
      if (typeof onFail === 'function') onFail();
    }
  });
}

function setFundAvatar(fundHouseName, schemeName){
  const avatar = document.getElementById('fundAvatar');
  const initials = (schemeName.trim().charAt(0) || 'F').toUpperCase();
  const domain = resolveAmcDomain(fundHouseName);
  avatar.innerHTML = '';
  if (!domain){
    avatar.textContent = initials;
    return;
  }
  const img = document.createElement('img');
  img.className = 'fund-avatar-img';
  img.alt = fundHouseName + ' logo';
  img.referrerPolicy = 'no-referrer';
  img.src = amcLogoUrl(domain, 0);
  attachAmcLogoFallback(img, domain, () => {
    avatar.innerHTML = '';
    avatar.textContent = initials;
  });
  avatar.appendChild(img);
}

function displayFund(data, schemeCode){
  const meta = data.meta || {};
  const navData = data.data || [];
  const latest = navData[0] || {};

  currentNavData = navData;
  currentSchemeName = meta.scheme_name || ('scheme-' + schemeCode);
  currentFundMeta = {
    // Normalized to a string here, once, at the single point every code
    // path funnels through (typed search, Fund Explorer's data-* attrs,
    // recent searches, the compare modal) — those disagree on whether a
    // scheme code is a number or a string, which used to let the same
    // fund get double-stored (or fail to delete) in the compare list's
    // IndexedDB store, since it keys strictly by type-and-value.
    schemeCode: String(schemeCode),
    schemeName: currentSchemeName,
    fundHouse: meta.fund_house || '',
    schemeType: meta.scheme_type || '',
    schemeCategory: meta.scheme_category || '',
    latestNav: latest.nav || '',
    asOn: latest.date || ''
  };

  setFundAvatar(meta.fund_house || '', currentSchemeName);
  document.getElementById('fundName').textContent = meta.scheme_name || '—';
  document.getElementById('fundHouse').innerHTML = meta.fund_house ? `<i class="bi bi-bank"></i> ${escapeHtml(meta.fund_house)}` : '';
  document.getElementById('schemeCodeBadge').textContent = `Scheme Code: ${schemeCode}`;
  document.getElementById('latestNav').textContent = latest.nav ? `₹${latest.nav}` : '—';
  document.getElementById('navDate').textContent = latest.date || '—';
  document.getElementById('schemeType').textContent = meta.scheme_type || '—';
  document.getElementById('schemeCategory').textContent = meta.scheme_category || '—';

  currentChartRange = 'max';
  applyChartRange('max');

  renderHistoryTable(navData);
  updateAddToCompareBtn();
  card.classList.add('show');
  if (navChartInstance){
    requestAnimationFrame(() => navChartInstance.resize());
  }

  saveRecent({
    schemeCode: String(schemeCode),
    schemeName: currentSchemeName,
    fundHouse: meta.fund_house || '',
    when: new Date().toLocaleDateString(undefined, { day:'2-digit', month:'short', year:'numeric' })
  });
}

function parseHistDate(str){
  const parts = (str || '').split('-');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y) return null;
  const dt = new Date(y, m - 1, d);
  return isNaN(dt.getTime()) ? null : dt;
}

const HISTORY_PAGE_SIZE = 50;
let historyFullData = [];
let historyShownCount = 0;

function historyRowHtml(row, idx, fullData){
  const nav = parseFloat(row.nav);
  const prevRow = fullData[idx + 1];
  let changeHtml = '';
  if (prevRow){
    const prevNav = parseFloat(prevRow.nav);
    if (!isNaN(nav) && !isNaN(prevNav) && prevNav !== 0){
      const pct = ((nav - prevNav) / prevNav) * 100;
      const dir = pct > 0.0005 ? 'up' : pct < -0.0005 ? 'down' : 'flat';
      const icon = dir === 'up' ? 'bi-caret-up-fill' : dir === 'down' ? 'bi-caret-down-fill' : 'bi-dash-lg';
      changeHtml = `<span class="nav-change ${dir}"><i class="bi ${icon}"></i>${Math.abs(pct).toFixed(2)}%</span>`;
    }
  }
  const dt = parseHistDate(row.date);
  const weekday = dt ? dt.toLocaleDateString(undefined, { weekday: 'short' }) : '';
  return `
    <tr>
      <td>
        <div class="hist-date">
          ${weekday ? `<span class="hist-day">${escapeHtml(weekday)}</span>` : ''}
          <span>${escapeHtml(row.date)}</span>
        </div>
      </td>
      <td>
        <div class="hist-nav-wrap">
          ${changeHtml}
          <span class="hist-nav">₹${escapeHtml(row.nav)}</span>
        </div>
      </td>
    </tr>`;
}

function updateLoadMoreButton(){
  const btn = document.getElementById('loadMoreHistoryBtn');
  if (!btn) return;
  const remaining = historyFullData.length - historyShownCount;
  if (remaining > 0){
    btn.style.display = 'inline-flex';
    btn.innerHTML = `<i class="bi bi-chevron-down"></i> Load ${Math.min(HISTORY_PAGE_SIZE, remaining)} more (${remaining} left)`;
  } else {
    btn.style.display = 'none';
  }
}

function renderHistoryTable(navData, isFiltered=false, totalCount=null){
  const body = document.getElementById('historyBody');

  historyFullData = navData;
  historyShownCount = 0;

  if (!navData.length){
    body.innerHTML = `<tr><td colspan="2" class="no-date-match"><i class="bi bi-calendar-x"></i> ${isFiltered ? 'No entries match that date' : 'No history available'}</td></tr>`;
    updateLoadMoreButton();
    return;
  }

  const firstPage = navData.slice(0, HISTORY_PAGE_SIZE);
  body.innerHTML = firstPage.map((row, idx) => historyRowHtml(row, idx, navData)).join('');
  historyShownCount = firstPage.length;
  updateLoadMoreButton();
}

function loadMoreHistoryRows(){
  const body = document.getElementById('historyBody');
  const nextBatch = historyFullData.slice(historyShownCount, historyShownCount + HISTORY_PAGE_SIZE);
  if (!nextBatch.length) { updateLoadMoreButton(); return; }
  body.insertAdjacentHTML('beforeend', nextBatch.map((row, i) => historyRowHtml(row, historyShownCount + i, historyFullData)).join(''));
  historyShownCount += nextBatch.length;
  updateLoadMoreButton();
}

document.getElementById('loadMoreHistoryBtn').addEventListener('click', loadMoreHistoryRows);

// ---------- Download ----------
document.getElementById('downloadBtn').addEventListener('click', () => {
  if (!currentNavData.length || !currentFundMeta){
    setStatus('Nothing to download yet — pick a fund first.', true);
    return;
  }
  const payload = {
    fund: {
      schemeCode: currentFundMeta.schemeCode,
      schemeName: currentFundMeta.schemeName,
      fundHouse: currentFundMeta.fundHouse,
      schemeType: currentFundMeta.schemeType,
      schemeCategory: currentFundMeta.schemeCategory,
      latestNav: currentFundMeta.latestNav,
      asOn: currentFundMeta.asOn
    },
    navHistory: currentNavData.map(row => ({ date: row.date, nav: row.nav })),
    meta: {
      source: 'live-fund-data-feed',
      generatedBy: 'Invisible House · Microintel',
      downloadedAt: new Date().toISOString()
    }
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const houseSlug = (currentFundMeta.fundHouse || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const nameSlug = currentSchemeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const safeName = [houseSlug, nameSlug, currentFundMeta.schemeCode].filter(Boolean).join('-');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName || 'nav-history'}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

let navChartInstance = null;

// ---------- Two-point NAV comparison ----------
let currentChartRows = [];
let chartSelection = [];
let twoPointPluginRegistered = false;
let redrawFallbackMarkers = null;

const twoPointSelectionPlugin = {
  id: 'twoPointSelection',
  afterDatasetsDraw(chart){
    if (!chartSelection.length) return;
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data) return;
    const ctx = chart.ctx;
    const colors = ['#4fd1c5', '#d1a54c'];

    if (chartSelection.length === 2){
      const elA = meta.data[chartSelection[0].index];
      const elB = meta.data[chartSelection[1].index];
      if (elA && elB){
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.moveTo(elA.x, elA.y);
        ctx.lineTo(elB.x, elB.y);
        ctx.stroke();
        ctx.restore();
      }
    }

    chartSelection.forEach((sel, i) => {
      const el = meta.data[sel.index];
      if (!el) return;
      ctx.save();
      ctx.beginPath();
      ctx.arc(el.x, el.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = colors[i] || colors[0];
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.restore();
    });
  }
};

function resetChartSelection(){
  chartSelection = [];
  renderChartCompare();
  if (navChartInstance) navChartInstance.update('none');
  else if (typeof redrawFallbackMarkers === 'function') redrawFallbackMarkers();
}

function handleChartPointPick(idx){
  if (!currentChartRows[idx]) return;
  if (chartSelection.length >= 2) chartSelection = [];
  if (chartSelection.length === 1 && chartSelection[0].index === idx) return;

  chartSelection.push({ index: idx, date: currentChartRows[idx].date, nav: currentChartRows[idx].nav });
  if (chartSelection.length === 2){
    chartSelection.sort((a, b) => a.index - b.index);
  }

  renderChartCompare();
  if (navChartInstance) navChartInstance.update('none');
  else if (typeof redrawFallbackMarkers === 'function') redrawFallbackMarkers();
}

function renderChartCompare(){
  const el = document.getElementById('chartCompare');
  if (!el) return;

  if (!chartSelection.length){
    el.classList.remove('show');
    el.innerHTML = '';
    return;
  }

  if (chartSelection.length === 1){
    el.classList.add('show');
    el.innerHTML = `<div class="chart-compare-hint"><span class="dot a" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent-2);"></span> ${escapeHtml(chartSelection[0].date)} selected — tap a second point to compare</div>`;
    return;
  }

  const [a, b] = chartSelection;
  const navA = parseFloat(a.nav);
  const navB = parseFloat(b.nav);
  const pct = navA !== 0 ? ((navB - navA) / navA) * 100 : 0;
  const absChange = navB - navA;
  const dir = pct > 0.0005 ? 'up' : pct < -0.0005 ? 'down' : '';
  const icon = dir === 'up' ? 'bi-caret-up-fill' : dir === 'down' ? 'bi-caret-down-fill' : 'bi-dash-lg';

  el.classList.add('show');
  el.innerHTML = `
    <div class="chart-compare-row">
      <div class="chart-compare-dates">
        <span><span class="dot a"></span> ${escapeHtml(a.date)} · ₹${escapeHtml(String(a.nav))}</span>
        <i class="bi bi-arrow-right"></i>
        <span><span class="dot b"></span> ${escapeHtml(b.date)} · ₹${escapeHtml(String(b.nav))}</span>
      </div>
      <button type="button" class="chart-compare-clear" id="chartCompareClear">Clear</button>
    </div>
    <div class="chart-compare-figures" style="margin-top:8px;">
      <span class="pct ${dir}"><i class="bi ${icon}"></i> ${Math.abs(pct).toFixed(2)}%</span>
      <span class="abs">${absChange >= 0 ? '+' : ''}₹${absChange.toFixed(4)} change</span>
    </div>
  `;

  const clearBtn = document.getElementById('chartCompareClear');
  if (clearBtn) clearBtn.addEventListener('click', resetChartSelection);
}

// ---------- Compare Funds ----------
const COMPARE_COLORS = ['#4fd1c5', '#d1a54c', '#e5737e', '#7c9eff'];
const COMPARE_LIMIT = 4;
let compareFunds = [];
let compareChartInstance = null;
let compareChartRowsByFund = [];
let compareChartLabels = [];
let compareChartRange = 'max';
let compareViewMode = 'nav';
let compareSelection = [];
let compareTwoPointPluginRegistered = false;

const COMPARE_DB_NAME = 'ih_compare_db';
const COMPARE_DB_VERSION = 1;
const COMPARE_STORE = 'funds';
let compareDbPromise = null;

function openCompareDB(){
  if (compareDbPromise) return compareDbPromise;
  compareDbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB){ reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(COMPARE_DB_NAME, COMPARE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(COMPARE_STORE)){
        db.createObjectStore(COMPARE_STORE, { keyPath: 'schemeCode' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return compareDbPromise;
}

async function idbPutCompareFund(fund){
  try{
    // Belt-and-suspenders: always write with a string key, no matter what
    // type the caller happened to pass in, so put() can never create a
    // second row for a fund that's already stored under the other type.
    const normalized = { ...fund, schemeCode: String(fund.schemeCode) };
    const db = await openCompareDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(COMPARE_STORE, 'readwrite');
      tx.objectStore(COMPARE_STORE).put(normalized);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch(e){}
}

async function idbDeleteCompareFund(schemeCode){
  try{
    const db = await openCompareDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(COMPARE_STORE, 'readwrite');
      tx.objectStore(COMPARE_STORE).delete(String(schemeCode));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch(e){}
}

async function idbClearCompareFunds(){
  try{
    const db = await openCompareDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(COMPARE_STORE, 'readwrite');
      tx.objectStore(COMPARE_STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch(e){}
}

async function idbGetAllCompareFunds(){
  try{
    const db = await openCompareDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(COMPARE_STORE, 'readonly');
      const req = tx.objectStore(COMPARE_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch(e){ return []; }
}

async function loadCompareFundsFromDB(){
  const stored = await idbGetAllCompareFunds();
  if (!stored.length) return;

  // Self-heal: older builds (and mixed entry points — typed search vs.
  // Fund Explorer vs. the compare modal) could write the same fund's
  // scheme code as a number in one place and a string in another.
  // IndexedDB treats those as two different keys, so the same fund
  // could get stored twice, and removing it under one type could leave
  // the other type's row behind as a "zombie" that reappears on the
  // next reload. De-duplicate by the normalized (string) code once
  // here — keeping whichever copy of each fund was added most
  // recently — and persist the cleaned-up list back to the store so
  // this doesn't keep resurfacing.
  const byCode = new Map();
  let hadNonStringCode = false;
  stored.forEach(f => {
    if (typeof f.schemeCode !== 'string') hadNonStringCode = true;
    const code = String(f.schemeCode);
    const existing = byCode.get(code);
    if (!existing || (f.order || 0) >= (existing.order || 0)){
      byCode.set(code, { ...f, schemeCode: code });
    }
  });

  let deduped = Array.from(byCode.values()).sort((a, b) => (a.order || 0) - (b.order || 0));
  const hadDuplicates = deduped.length !== stored.length;
  if (deduped.length > COMPARE_LIMIT){
    deduped = deduped.slice(deduped.length - COMPARE_LIMIT); // keep the most recently added
  }

  compareFunds = deduped;
  updateAddToCompareBtn();
  updateCompareCountBadge();
  if (comparePanel.classList.contains('active')) renderCompareUI();

  if (hadDuplicates || hadNonStringCode || deduped.length !== stored.length){
    await idbClearCompareFunds();
    for (const f of deduped){ await idbPutCompareFund(f); }
    if (hadDuplicates){
      notifyToast('Cleaned up a few duplicate funds in your comparison.', 'info');
    }
  }
}
loadCompareFundsFromDB();

function nextCompareColor(){
  const used = new Set(compareFunds.map(f => f.color));
  return COMPARE_COLORS.find(c => !used.has(c)) || COMPARE_COLORS[compareFunds.length % COMPARE_COLORS.length];
}

function isFundInCompare(schemeCode){
  return compareFunds.some(f => String(f.schemeCode) === String(schemeCode));
}

function updateAddToCompareBtn(){
  const btn = document.getElementById('addToCompareBtn');
  if (!btn || !currentFundMeta) return;
  const inCompare = isFundInCompare(currentFundMeta.schemeCode);
  btn.classList.toggle('added', inCompare);
  btn.classList.toggle('full', !inCompare && compareFunds.length >= COMPARE_LIMIT);
  btn.innerHTML = inCompare
    ? '<i class="bi bi-check-circle-fill"></i> Added to Compare'
    : (compareFunds.length >= COMPARE_LIMIT
        ? '<i class="bi bi-bar-chart-line"></i> Compare full (4/4)'
        : '<i class="bi bi-bar-chart-line"></i> Add to Compare');
}

function updateCompareCountBadge(){
  const badge = document.getElementById('compareCountBadge');
  if (!badge) return;
  if (compareFunds.length){
    badge.textContent = String(compareFunds.length);
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

document.getElementById('addToCompareBtn').addEventListener('click', () => {
  if (!currentFundMeta || !currentNavData.length){
    setStatus('Pick a fund first before adding it to compare.', true);
    return;
  }
  if (isFundInCompare(currentFundMeta.schemeCode)){
    removeFromCompare(currentFundMeta.schemeCode);
    return;
  }
  if (compareFunds.length >= COMPARE_LIMIT){
    setStatus('You can compare up to 4 funds at a time. Remove one first.', true);
    return;
  }
  const ascending = [...currentNavData].reverse()
    .map(r => ({ date: r.date, nav: parseFloat(r.nav) }))
    .filter(r => !isNaN(r.nav));
  const newFund = {
    schemeCode: String(currentFundMeta.schemeCode),
    schemeName: currentFundMeta.schemeName,
    fundHouse: currentFundMeta.fundHouse,
    navData: ascending,
    color: nextCompareColor(),
    order: Date.now()
  };
  compareFunds.push(newFund);
  updateAddToCompareBtn();
  updateCompareCountBadge();
  renderCompareUI();
  idbPutCompareFund(newFund);
});

// "Open Compare" on the fund detail page — jumps straight to the
// Compare tab (and its chart) instead of making the user find the tab
// themselves after adding a fund.
const openCompareBtn = document.getElementById('openCompareBtn');
if (openCompareBtn){
  openCompareBtn.addEventListener('click', () => {
    switchTab('compare');
  });
}

// Persistent "Show Graph" control inside the Compare tab itself — always
// available (not just as an error fallback) so the user can force a
// redraw any time the chart looks stuck or empty.
const compareShowGraphBtn = document.getElementById('compareShowGraphBtn');
if (compareShowGraphBtn){
  compareShowGraphBtn.addEventListener('click', () => {
    if (!compareFunds.length){
      setStatus('Add at least one fund to compare first.', true);
      return;
    }
    scheduleCompareChartRender();
  });
}

function removeFromCompare(schemeCode){
  compareFunds = compareFunds.filter(f => String(f.schemeCode) !== String(schemeCode));
  compareSelection = [];
  updateAddToCompareBtn();
  updateCompareCountBadge();
  renderCompareUI();
  idbDeleteCompareFund(schemeCode);
}

document.getElementById('clearCompareBtn').addEventListener('click', () => {
  compareFunds = [];
  compareSelection = [];
  updateAddToCompareBtn();
  updateCompareCountBadge();
  renderCompareUI();
  idbClearCompareFunds();
});

function renderCompareUI(){
  const card = document.getElementById('compareCard');
  if (!card) return;

  renderCompareSlots();

  if (!compareFunds.length){
    // Nothing to compare yet — hide the chart, range tabs and mode
    // toggle entirely rather than showing an empty graph.
    card.classList.remove('show');
    if (compareChartInstance){ compareChartInstance.destroy(); compareChartInstance = null; }
    return;
  }

  card.classList.add('show');

  if (comparePanel.classList.contains('active')){
    scheduleCompareChartRender();
  }
}

// A fixed "wait two frames, then draw" used to be the guard here, but
// the compare panel's layout (flex columns, min-height:0 chains, AMC
// logos loading in and nudging row heights) doesn't always settle
// within two frames — that's why the chart would sometimes stay blank
// until the user left the tab and came back, which just gave layout
// more time to catch up. Instead, actively watch the canvas wrapper's
// real size with a ResizeObserver and draw the instant it's non-zero;
// if it still hasn't resolved after a couple of seconds (e.g. no
// ResizeObserver support, or something genuinely stuck), surface a
// manual "Show comparison chart" button rather than leaving a
// silent blank space.
let compareChartResizeObserver = null;
let compareChartRenderTimeout = null;

function getCompareChartWrap(){
  return document.querySelector('#compareCard .chart-canvas-wrap');
}

function scheduleCompareChartRender(){
  if (compareChartResizeObserver){ compareChartResizeObserver.disconnect(); compareChartResizeObserver = null; }
  if (compareChartRenderTimeout){ clearTimeout(compareChartRenderTimeout); compareChartRenderTimeout = null; }
  hideCompareChartFallback();

  const wrap = getCompareChartWrap();
  if (!wrap || !compareFunds.length) return;

  const tryDraw = () => {
    if (wrap.offsetWidth > 0 && wrap.offsetHeight > 0){
      if (compareChartResizeObserver){ compareChartResizeObserver.disconnect(); compareChartResizeObserver = null; }
      if (compareChartRenderTimeout){ clearTimeout(compareChartRenderTimeout); compareChartRenderTimeout = null; }
      drawCompareChart();
      return true;
    }
    return false;
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (tryDraw()) return;
      if (window.ResizeObserver){
        compareChartResizeObserver = new ResizeObserver(() => tryDraw());
        compareChartResizeObserver.observe(wrap);
      }
      // Belt-and-suspenders: if the size genuinely never resolves
      // (observer unsupported, or something else keeps it collapsed),
      // don't leave the user staring at an empty box forever.
      compareChartRenderTimeout = setTimeout(() => {
        if (!compareChartInstance) showCompareChartFallback();
      }, 1800);
    });
  });
}

function showCompareChartFallback(){
  const wrap = getCompareChartWrap();
  if (!wrap || wrap.querySelector('.compare-chart-fallback-btn')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'compare-chart-fallback-btn';
  btn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Show comparison chart';
  btn.addEventListener('click', () => {
    btn.remove();
    scheduleCompareChartRender();
  });
  wrap.appendChild(btn);
}

function hideCompareChartFallback(){
  const wrap = getCompareChartWrap();
  const btn = wrap && wrap.querySelector('.compare-chart-fallback-btn');
  if (btn) btn.remove();
}

function renderCompareSlots(){
  const wrap = document.getElementById('compareSlots');
  if (!wrap) return;

  const filledTiles = compareFunds.map(f => {
    const filtered = filterNavDataByRange(f.navData, compareChartRange);
    const result = computeCAGR(filtered);
    let cagrHtml = '';
    if (result){
      const dir = result.pct > 0.0005 ? 'up' : result.pct < -0.0005 ? 'down' : 'flat';
      cagrHtml = `<span class="compare-slot-cagr ${dir}">${result.pct >= 0 ? '+' : ''}${result.pct.toFixed(1)}%</span>`;
    }
    const domain = resolveAmcDomain(f.fundHouse || f.schemeName);
    const iconInner = domain
      ? `<img data-amc-domain="${escapeHtml(domain)}" alt="" referrerpolicy="no-referrer">`
      : `<i class="bi bi-piggy-bank"></i>`;
    return `
    <div class="compare-slot filled" style="--slot-color:${f.color};">
      <button type="button" class="compare-slot-remove" data-code="${escapeHtml(String(f.schemeCode))}" title="Remove"><i class="bi bi-x-lg"></i></button>
      <span class="compare-slot-icon${domain ? ' has-logo' : ''}">${iconInner}</span>
      <span class="compare-slot-name" title="${escapeHtml(f.schemeName)}">${escapeHtml(f.schemeName)}</span>
      ${cagrHtml}
    </div>`;
  }).join('');

  const emptyCount = Math.max(0, COMPARE_LIMIT - compareFunds.length);
  const emptyTiles = Array.from({ length: emptyCount }).map(() => `
    <button type="button" class="compare-slot empty" data-add-compare-slot>
      <i class="bi bi-plus-lg"></i>
      <span>Add fund</span>
    </button>`).join('');

  wrap.innerHTML = filledTiles + emptyTiles;

  attachSuggestionLogos(wrap);

  wrap.querySelectorAll('.compare-slot-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromCompare(btn.dataset.code);
    });
  });

  wrap.querySelectorAll('[data-add-compare-slot]').forEach(btn => {
    btn.addEventListener('click', openCompareSearchModal);
  });
}

// ---------- Add-fund-to-compare popup ----------
const compareSearchModal = document.getElementById('compareSearchModal');
const compareSearchModalBackdrop = document.getElementById('compareSearchModalBackdrop');
const compareSearchModalClose = document.getElementById('compareSearchModalClose');

function openCompareSearchModal(){
  if (!compareSearchModal) return;
  if (compareFunds.length >= COMPARE_LIMIT) return;
  compareSearchModal.hidden = false;
  requestAnimationFrame(() => {
    compareSearchModal.classList.add('show');
    const input = document.getElementById('compareSearchInput');
    if (input) input.focus();
  });
}

function closeCompareSearchModal(){
  if (!compareSearchModal) return;
  compareSearchModal.classList.remove('show');
  const suggestionsBox = document.getElementById('compareSuggestions');
  if (suggestionsBox){ suggestionsBox.classList.remove('show'); suggestionsBox.innerHTML = ''; }
  const input = document.getElementById('compareSearchInput');
  if (input) input.value = '';
  resetCompareFilters();
  setTimeout(() => { compareSearchModal.hidden = true; }, 180);
}

if (compareSearchModalClose) compareSearchModalClose.addEventListener('click', closeCompareSearchModal);
// Intentionally no backdrop-click-to-close: the compare picker should only
// close via the close button or once a fund is successfully added — an
// accidental tap outside it (easy to do on a small screen) used to lose
// whatever the user had typed or filtered.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && compareSearchModal && compareSearchModal.classList.contains('show')){
    closeCompareSearchModal();
  }
});

function buildCompareDataset(range){
  let latestDate = null;
  compareFunds.forEach(f => {
    const last = f.navData[f.navData.length - 1];
    const dt = last ? parseHistDate(last.date) : null;
    if (dt && (!latestDate || dt > latestDate)) latestDate = dt;
  });
  const cutoff = (range !== 'max' && latestDate) ? getRangeCutoffDate(latestDate, range) : null;

  const filteredFunds = compareFunds.map(f => {
    if (!cutoff) return f;
    const rows = f.navData.filter(r => {
      const dt = parseHistDate(r.date);
      return dt && dt >= cutoff;
    });
    return { ...f, navData: rows.length ? rows : f.navData };
  });

  const dateSet = new Set();
  filteredFunds.forEach(f => f.navData.forEach(r => dateSet.add(r.date)));
  let allDates = Array.from(dateSet).sort((a, b) => (parseHistDate(a) || 0) - (parseHistDate(b) || 0));

  let rowsByFund = filteredFunds.map(f => {
    const map = new Map(f.navData.map(r => [r.date, r.nav]));
    return allDates.map(d => (map.has(d) ? map.get(d) : null));
  });

  // Keep the chart snappy: draw at most CHART_POINT_BUDGET points total,
  // spread evenly across the range, instead of every daily NAV entry.
  if (allDates.length > CHART_POINT_BUDGET){
    const idx = pickDecimationIndices(allDates.length, CHART_POINT_BUDGET);
    allDates = idx.map(i => allDates[i]);
    rowsByFund = rowsByFund.map(rows => idx.map(i => rows[i]));
  }

  compareChartRowsByFund = rowsByFund;
  compareChartLabels = allDates;

  return { labels: allDates, rowsByFund: compareChartRowsByFund };
}

const compareTwoPointPlugin = {
  id: 'compareTwoPointSelection',
  afterDatasetsDraw(chart){
    if (!compareSelection.length) return;
    const ctx = chart.ctx;
    const chartArea = chart.chartArea;

    compareSelection.forEach(sel => {
      const xPixel = chart.scales.x.getPixelForValue(sel.index);
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.5;
      ctx.moveTo(xPixel, chartArea.top);
      ctx.lineTo(xPixel, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    });

    chart.data.datasets.forEach((ds, dsIndex) => {
      const meta = chart.getDatasetMeta(dsIndex);
      if (!meta || !meta.data) return;
      compareSelection.forEach(sel => {
        const val = ds.data[sel.index];
        if (val === null || val === undefined) return;
        const el = meta.data[sel.index];
        if (!el) return;
        ctx.save();
        ctx.beginPath();
        ctx.arc(el.x, el.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = ds.borderColor;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.restore();
      });
    });
  }
};

function handleComparePointPick(idx){
  if (!compareChartLabels[idx]) return;
  if (compareSelection.length >= 2) compareSelection = [];
  if (compareSelection.length === 1 && compareSelection[0].index === idx) return;

  compareSelection.push({ index: idx, date: compareChartLabels[idx] });
  if (compareSelection.length === 2){
    compareSelection.sort((a, b) => a.index - b.index);
  }
  renderCompareChartCompare();
  if (compareChartInstance) compareChartInstance.update('none');
}

function resetCompareSelection(){
  compareSelection = [];
  renderCompareChartCompare();
  if (compareChartInstance) compareChartInstance.update('none');
}

function renderCompareChartCompare(){
  const el = document.getElementById('compareChartCompare');
  if (!el) return;

  if (!compareSelection.length){
    el.classList.remove('show');
    el.innerHTML = '';
    return;
  }

  if (compareSelection.length === 1){
    el.classList.add('show');
    el.innerHTML = `<div class="chart-compare-hint"><span class="dot a" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent-2);"></span> ${escapeHtml(compareSelection[0].date)} selected — tap a second point to compare</div>`;
    return;
  }

  const [a, b] = compareSelection;
  const rows = compareFunds.map((f, i) => {
    const navA = compareChartRowsByFund[i][a.index];
    const navB = compareChartRowsByFund[i][b.index];
    if (navA === null || navA === undefined || navB === null || navB === undefined){
      return { fund: f, noData: true };
    }
    const pct = navA !== 0 ? ((navB - navA) / navA) * 100 : 0;
    const dir = pct > 0.0005 ? 'up' : pct < -0.0005 ? 'down' : '';
    const icon = dir === 'up' ? 'bi-caret-up-fill' : dir === 'down' ? 'bi-caret-down-fill' : 'bi-dash-lg';
    return { fund: f, navA, navB, pct, dir, icon };
  });

  el.classList.add('show');
  el.innerHTML = `
    <div class="chart-compare-row">
      <div class="chart-compare-dates">
        <span><span class="dot a"></span> ${escapeHtml(a.date)}</span>
        <i class="bi bi-arrow-right"></i>
        <span><span class="dot b"></span> ${escapeHtml(b.date)}</span>
      </div>
      <button type="button" class="chart-compare-clear" id="compareChartCompareClear">Clear</button>
    </div>
    <div style="margin-top:10px;">
      ${rows.map(r => `
        <div class="compare-point-row">
          <div class="compare-point-fund">
            <span class="compare-legend-dot" style="background:${r.fund.color};"></span>
            <span title="${escapeHtml(r.fund.schemeName)}">${escapeHtml(r.fund.schemeName)}</span>
          </div>
          ${r.noData
            ? '<span style="color:var(--muted);">No data</span>'
            : `<div class="chart-compare-figures" style="gap:0;"><span class="pct ${r.dir}" style="font-size:13px;"><i class="bi ${r.icon}"></i> ${Math.abs(r.pct).toFixed(2)}%</span></div>`
          }
        </div>
      `).join('')}
    </div>
  `;

  const clearBtn = document.getElementById('compareChartCompareClear');
  if (clearBtn) clearBtn.addEventListener('click', resetCompareSelection);
}

function drawCompareChart(){
  const canvas = document.getElementById('compareChart');
  const resetBtn = document.getElementById('compareChartResetZoom');
  if (!canvas || typeof Chart === 'undefined' || !compareFunds.length) return;

  hideCompareChartFallback();

  if (compareChartInstance){ compareChartInstance.destroy(); compareChartInstance = null; }

  compareSelection = [];
  renderCompareChartCompare();

  const { labels } = buildCompareDataset(compareChartRange);
  const labelEl = document.getElementById('compareChartLabel');
  const modeLabel = compareViewMode === 'growth' ? 'Growth/Loss trend' : 'NAV trend';
  if (labelEl) labelEl.textContent = `${modeLabel} · ${CHART_RANGE_LABELS[compareChartRange] || 'full history'} (${labels.length} points)`;

  const styles = getComputedStyle(document.documentElement);
  const textColor = styles.getPropertyValue('--text').trim() || '#e7eaef';
  const mutedColor = styles.getPropertyValue('--muted').trim() || '#7d8794';
  const panelColor = styles.getPropertyValue('--panel').trim() || '#12161d';
  const borderColor = styles.getPropertyValue('--border').trim() || '#242b37';

  const displayRowsByFund = compareChartRowsByFund.map(rows => {
    if (compareViewMode !== 'growth') return rows;
    const baseVal = rows.find(v => v !== null && v !== undefined);
    if (baseVal === undefined || baseVal === 0) return rows.map(() => null);
    return rows.map(v => (v === null || v === undefined) ? null : ((v - baseVal) / baseVal) * 100);
  });

  const datasets = compareFunds.map((f, i) => ({
    label: f.schemeName,
    data: displayRowsByFund[i],
    borderColor: f.color,
    backgroundColor: 'transparent',
    pointRadius: 0,
    pointHoverRadius: 5,
    pointHoverBackgroundColor: f.color,
    pointHoverBorderColor: panelColor,
    pointHoverBorderWidth: 2,
    borderWidth: 2,
    fill: false,
    tension: 0.15,
    spanGaps: true
  }));

  const allVals = datasets.flatMap(ds => ds.data.filter(v => v !== null && v !== undefined));
  const min = allVals.length ? Math.min(...allVals) : 0;
  const max = allVals.length ? Math.max(...allVals) : 1;
  const padY = (max - min) * 0.08 || max * 0.02 || 1;

  const config = {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { top: 24, right: 16, bottom: 12, left: 12 }
      },
      animation: labels.length > 150 ? false : { duration: 300 },
      interaction: { mode: 'index', intersect: false, axis: 'x' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: panelColor,
          titleColor: mutedColor,
          bodyColor: textColor,
          borderColor: borderColor,
          borderWidth: 1,
          padding: 10,
          titleFont: { size: 11, family: 'JetBrains Mono, monospace' },
          bodyFont: { size: 12, weight: '700', family: 'JetBrains Mono, monospace' },
          displayColors: true,
          callbacks: {
            title: (items) => items[0] ? `📅 ${items[0].label}` : '',
            label: (item) => {
              if (item.parsed.y === null || item.parsed.y === undefined) return `${item.dataset.label}: —`;
              return compareViewMode === 'growth'
                ? `${item.dataset.label}: ${item.parsed.y >= 0 ? '+' : ''}${item.parsed.y.toFixed(2)}%`
                : `${item.dataset.label}: ₹${item.parsed.y.toFixed(4)}`;
            }
          }
        },
        zoom: {
          zoom: {
            wheel: { enabled: true, speed: 0.08 },
            pinch: { enabled: true },
            drag: { enabled: false },
            mode: 'x',
          },
          pan: { enabled: true, mode: 'x' },
          limits: { x: { min: 'original', max: 'original', minRange: 10 } }
        }
      },
      scales: {
        x: { display: false },
        y: {
          min: min - padY,
          max: max + padY,
          grid: { color: color_mix_fallback(mutedColor, 0.08) },
          ticks: {
            color: mutedColor,
            font: { size: 10 },
            maxTicksLimit: 5,
            callback: (v) => compareViewMode === 'growth'
              ? `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`
              : '₹' + Number(v).toFixed(1)
          }
        }
      }
    }
  };

  if (!compareTwoPointPluginRegistered){
    Chart.register(compareTwoPointPlugin);
    compareTwoPointPluginRegistered = true;
  }

  compareChartInstance = new Chart(canvas.getContext('2d'), config);

  if (resetBtn){
    resetBtn.classList.remove('show');
    resetBtn.onclick = () => {
      if (compareChartInstance){
        compareChartInstance.resetZoom();
        resetBtn.classList.remove('show');
      }
    };
    canvas.onwheel = () => resetBtn.classList.add('show');
    canvas.parentElement.addEventListener('pointerdown', () => resetBtn.classList.add('show'));
  }

  canvas.onclick = (evt) => {
    if (!compareChartInstance) return;
    const els = compareChartInstance.getElementsAtEventForMode(evt, 'index', { intersect: false, axis: 'x' }, true);
    if (!els.length) return;
    handleComparePointPick(els[0].index);
  };
}

function getRangeCutoffDate(latestDate, range){
  const d = new Date(latestDate.getTime());
  switch(range){
    case '1w': d.setDate(d.getDate() - 7); break;
    case '1m': d.setMonth(d.getMonth() - 1); break;
    case '6m': d.setMonth(d.getMonth() - 6); break;
    case '1y': d.setFullYear(d.getFullYear() - 1); break;
    case '3y': d.setFullYear(d.getFullYear() - 3); break;
    case '5y': d.setFullYear(d.getFullYear() - 5); break;
    default: return null;
  }
  return d;
}

function getChartDataForRange(range){
  if (!currentNavData || !currentNavData.length) return [];
  const ascending = [...currentNavData].reverse();
  if (range === 'max') return ascending;
  const latestDate = parseHistDate(currentNavData[0].date);
  const cutoff = latestDate ? getRangeCutoffDate(latestDate, range) : null;
  if (!cutoff) return ascending;
  const filtered = ascending.filter(row => {
    const dt = parseHistDate(row.date);
    return dt && dt >= cutoff;
  });
  return filtered.length ? filtered : ascending;
}

const CHART_RANGE_LABELS = {
  max: 'full history', '5y': 'last 5 years', '3y': 'last 3 years',
  '1y': 'last 1 year', '6m': 'last 6 months', '1m': 'last 1 month', '1w': 'last 1 week'
};

const CAGR_RANGE_TAGS = {
  max: 'MAX', '5y': '5Y', '3y': '3Y', '1y': '1Y', '6m': '6M', '1m': '1M', '1w': '1W'
};

// Generic helper: filter an ascending-order NAV series down to a given range.
// Works for both the single-fund series and any compare-tab fund series.
function filterNavDataByRange(rowsAscending, range){
  if (!rowsAscending || !rowsAscending.length || range === 'max') return rowsAscending;
  const latestDate = parseHistDate(rowsAscending[rowsAscending.length - 1].date);
  const cutoff = latestDate ? getRangeCutoffDate(latestDate, range) : null;
  if (!cutoff) return rowsAscending;
  const filtered = rowsAscending.filter(r => {
    const dt = parseHistDate(r.date);
    return dt && dt >= cutoff;
  });
  return filtered.length ? filtered : rowsAscending;
}

// Computes CAGR (annualized) for periods >= 1 year, and a simple absolute
// return for shorter periods (annualizing sub-1-year windows is misleading).
function computeCAGR(rowsAscending){
  if (!rowsAscending || rowsAscending.length < 2) return null;
  const first = rowsAscending[0];
  const last = rowsAscending[rowsAscending.length - 1];
  const startNav = parseFloat(first.nav);
  const endNav = parseFloat(last.nav);
  if (isNaN(startNav) || isNaN(endNav) || startNav <= 0) return null;
  const d1 = parseHistDate(first.date);
  const d2 = parseHistDate(last.date);
  if (!d1 || !d2) return null;
  const days = (d2 - d1) / 86400000;
  if (days <= 0) return null;
  const years = days / 365.25;
  let pct, annualized;
  if (years < 1){
    pct = ((endNav - startNav) / startNav) * 100;
    annualized = false;
  } else {
    pct = (Math.pow(endNav / startNav, 1 / years) - 1) * 100;
    annualized = true;
  }
  return { pct, annualized, years, days };
}

function updateCagrDisplay(filteredRowsAscending, range){
  const labelEl = document.getElementById('cagrLabel');
  const valueEl = document.getElementById('cagrValue');
  if (!labelEl || !valueEl) return;
  const result = computeCAGR(filteredRowsAscending);
  const rangeTag = CAGR_RANGE_TAGS[range] || String(range).toUpperCase();
  if (!result){
    labelEl.innerHTML = `<i class="bi bi-percent"></i> CAGR`;
    valueEl.textContent = '—';
    valueEl.className = 'stat-value';
    return;
  }
  const dir = result.pct > 0.0005 ? 'up' : result.pct < -0.0005 ? 'down' : 'flat';
  labelEl.innerHTML = `<i class="bi bi-percent"></i> ${result.annualized ? 'CAGR' : 'Return'} · ${rangeTag}`;
  valueEl.textContent = `${result.pct >= 0 ? '+' : ''}${result.pct.toFixed(1)}%`;
  valueEl.className = `stat-value ${dir === 'up' ? 'cagr-up' : dir === 'down' ? 'cagr-down' : 'cagr-flat'}`;
}

function applyChartRange(range){
  currentChartRange = range;
  document.querySelectorAll('.range-btn').forEach(b => b.classList.toggle('active', b.dataset.range === range));
  const filtered = getChartDataForRange(range);
  drawChart(filtered);
  document.getElementById('chartLabel').textContent = `NAV trend · ${CHART_RANGE_LABELS[range] || 'full history'} (${filtered.length} points)`;
  updateCagrDisplay(filtered, range);
}

document.querySelectorAll('.range-btn').forEach(btn => {
  btn.addEventListener('click', () => applyChartRange(btn.dataset.range));
});

function applyCompareChartRange(range){
  compareChartRange = range;
  document.querySelectorAll('.compare-range-btn').forEach(b => b.classList.toggle('active', b.dataset.range === range));
  drawCompareChart();
  renderCompareSlots();
}

document.querySelectorAll('.compare-range-btn').forEach(btn => {
  btn.addEventListener('click', () => applyCompareChartRange(btn.dataset.range));
});

function applyCompareViewMode(mode){
  compareViewMode = mode;
  document.querySelectorAll('.compare-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  drawCompareChart();
}

document.querySelectorAll('.compare-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => applyCompareViewMode(btn.dataset.mode));
});

function drawChart(points){
  const canvas = document.getElementById('navChart');
  const resetBtn = document.getElementById('chartResetZoom');
  const hintEl = document.querySelector('.chart-hint');

  chartSelection = [];
  renderChartCompare();

  if (!points.length){
    if (navChartInstance){ navChartInstance.destroy(); navChartInstance = null; }
    currentChartRows = [];
    return;
  }

  let rows = points
    .map(p => ({ date: p.date, nav: parseFloat(p.nav) }))
    .filter(r => !isNaN(r.nav));
  if (!rows.length) return;
  if (rows.length > CHART_POINT_BUDGET){
    const idx = pickDecimationIndices(rows.length, CHART_POINT_BUDGET);
    rows = idx.map(i => rows[i]);
  }
  currentChartRows = rows;

  if (typeof Chart === 'undefined'){
    if (resetBtn) resetBtn.classList.remove('show');
    if (hintEl) hintEl.innerHTML = '<i class="bi bi-exclamation-triangle"></i> Interactive chart library unavailable — showing basic chart';
    drawPlainFallbackChart(canvas, rows);
    return;
  }
  if (hintEl) hintEl.innerHTML = '<i class="bi bi-mouse"></i> Scroll or pinch to zoom · drag to pan · hover for values · tap two points to compare';

  const styles = getComputedStyle(document.documentElement);
  const accentColor = styles.getPropertyValue('--accent').trim() || '#d1a54c';
  const accent2Color = styles.getPropertyValue('--accent-2').trim() || '#4fd1c5';
  const textColor = styles.getPropertyValue('--text').trim() || '#e7eaef';
  const mutedColor = styles.getPropertyValue('--muted').trim() || '#7d8794';
  const panelColor = styles.getPropertyValue('--panel').trim() || '#12161d';
  const borderColor = styles.getPropertyValue('--border').trim() || '#242b37';

  const navs = rows.map(r => r.nav);
  const min = Math.min(...navs);
  const max = Math.max(...navs);
  const padY = (max - min) * 0.08 || max * 0.02 || 1;

  const gradient = canvas.getContext('2d').createLinearGradient(0, 0, 0, canvas.clientHeight || 220);
  gradient.addColorStop(0, color_mix_fallback(accentColor, 0.28));
  gradient.addColorStop(1, color_mix_fallback(accentColor, 0));

  const chartData = {
    labels: rows.map(r => r.date),
    datasets: [{
      label: 'NAV',
      data: navs,
      borderColor: accentColor,
      backgroundColor: gradient,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: accent2Color,
      pointHoverBorderColor: panelColor,
      pointHoverBorderWidth: 2,
      borderWidth: 2,
      fill: true,
      tension: 0.15,
      spanGaps: true
    }]
  };

  const config = {
    type: 'line',
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { top: 24, right: 16, bottom: 12, left: 12 }
      },
      animation: rows.length > 150 ? false : { duration: 300 },
      interaction: { mode: 'index', intersect: false, axis: 'x' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: panelColor,
          titleColor: mutedColor,
          bodyColor: textColor,
          borderColor: borderColor,
          borderWidth: 1,
          padding: 10,
          titleFont: { size: 11, family: 'JetBrains Mono, monospace' },
          bodyFont: { size: 13, weight: '700', family: 'JetBrains Mono, monospace' },
          displayColors: false,
          callbacks: {
            title: (items) => items[0] ? `📅 ${items[0].label}` : '',
            label: (item) => `NAV ₹${item.parsed.y.toFixed(4)}`
          }
        },
        zoom: {
          zoom: {
            wheel: { enabled: true, speed: 0.08 },
            pinch: { enabled: true },
            drag: { enabled: false },
            mode: 'x',
          },
          pan: { enabled: true, mode: 'x' },
          limits: { x: { min: 'original', max: 'original', minRange: 10 } }
        }
      },
      scales: {
        x: {
          display: false
        },
        y: {
          min: min - padY,
          max: max + padY,
          grid: { color: color_mix_fallback(mutedColor, 0.08) },
          ticks: {
            color: mutedColor,
            font: { size: 10 },
            maxTicksLimit: 5,
            callback: (v) => '₹' + Number(v).toFixed(1)
          }
        }
      }
    }
  };

  if (navChartInstance){
    navChartInstance.data = chartData;
    navChartInstance.options = config.options;
    navChartInstance.update();
  } else {
    navChartInstance = new Chart(canvas.getContext('2d'), config);
  }

  resetBtn.classList.add('show');
  resetBtn.onclick = () => {
    if (navChartInstance){
      navChartInstance.resetZoom();
      resetBtn.classList.remove('show');
    }
  };
  canvas.onwheel = () => resetBtn.classList.add('show');
  canvas.parentElement.addEventListener('pointerdown', () => resetBtn.classList.add('show'));

  if (!twoPointPluginRegistered){
    Chart.register(twoPointSelectionPlugin);
    twoPointPluginRegistered = true;
  }
  canvas.onclick = (evt) => {
    if (!navChartInstance) return;
    const els = navChartInstance.getElementsAtEventForMode(evt, 'nearest', { intersect: false, axis: 'x' }, true);
    if (!els.length) return;
    handleChartPointPick(els[0].index);
  };
}

function drawPlainFallbackChart(canvas, rows){
  if (navChartInstance){ navChartInstance.destroy(); navChartInstance = null; }
  currentChartRows = rows;
  const dpr = window.devicePixelRatio || 1;
  const wrap = canvas.parentElement;
  const w = wrap.clientWidth || 300;
  const h = wrap.clientHeight || 220;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const navs = rows.map(r => r.nav);
  const min = Math.min(...navs);
  const max = Math.max(...navs);
  const range = max - min || 1;
  const padding = 14;
  const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d1a54c';
  const panelColor = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() || '#12161d';
  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#e7eaef';

  function pointAt(i){
    const x = padding + (i / (navs.length - 1 || 1)) * (w - padding * 2);
    const y = h - padding - ((navs[i] - min) / range) * (h - padding * 2);
    return { x, y };
  }

  function render(hoverIdx){
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    navs.forEach((nav, i) => {
      const { x, y } = pointAt(i);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const last = pointAt(navs.length - 1);
    ctx.beginPath();
    ctx.fillStyle = accentColor;
    ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
    ctx.fill();

    if (hoverIdx != null && rows[hoverIdx]){
      const { x, y } = pointAt(hoverIdx);
      ctx.beginPath();
      ctx.strokeStyle = accentColor;
      ctx.setLineDash([3, 3]);
      ctx.moveTo(x, padding * 0.4);
      ctx.lineTo(x, h - padding * 0.4);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.fillStyle = accentColor;
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();

      const label = `${rows[hoverIdx].date} · ₹${rows[hoverIdx].nav.toFixed(4)}`;
      ctx.font = '11px "JetBrains Mono", monospace';
      const textW = ctx.measureText(label).width;
      const boxX = Math.min(Math.max(x - textW / 2 - 8, 4), w - textW - 12);
      const boxY = y > h / 2 ? y - 32 : y + 12;
      ctx.fillStyle = panelColor;
      ctx.fillRect(boxX, boxY, textW + 16, 20);
      ctx.fillStyle = textColor;
      ctx.fillText(label, boxX + 8, boxY + 14);
    }

    if (chartSelection.length){
      if (chartSelection.length === 2 && rows[chartSelection[0].index] && rows[chartSelection[1].index]){
        const pA = pointAt(chartSelection[0].index);
        const pB = pointAt(chartSelection[1].index);
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = textColor;
        ctx.lineWidth = 2;
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.stroke();
        ctx.restore();
      }
      const colors = ['#4fd1c5', '#d1a54c'];
      chartSelection.forEach((sel, i) => {
        if (!rows[sel.index]) return;
        const { x, y } = pointAt(sel.index);
        ctx.beginPath();
        ctx.fillStyle = colors[i] || colors[0];
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      });
    }
  }

  render(null);

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let closest = 0, closestDist = Infinity;
    navs.forEach((_, i) => {
      const { x } = pointAt(i);
      const d = Math.abs(x - mx);
      if (d < closestDist){ closestDist = d; closest = i; }
    });
    render(closest);
  };
  canvas.onmouseleave = () => render(null);
  canvas.onclick = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let closest = 0, closestDist = Infinity;
    navs.forEach((_, i) => {
      const { x } = pointAt(i);
      const d = Math.abs(x - mx);
      if (d < closestDist){ closestDist = d; closest = i; }
    });
    handleChartPointPick(closest);
  };
  redrawFallbackMarkers = () => render(null);
}

function color_mix_fallback(hexOrColor, alpha){
  const probe = document.createElement('div');
  probe.style.color = hexOrColor;
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  const match = rgb.match(/\d+(\.\d+)?/g);
  if (!match) return `rgba(209,165,76,${alpha})`;
  const [r, g, b] = match;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-box')){
    suggestionsBox.classList.remove('show');
  }
});

// --- Compare Section Search JavaScript ---
const compareSearchInput = document.getElementById('compareSearchInput');
const compareSuggestionsBox = document.getElementById('compareSuggestions');
const compareManualSearchBtn = document.getElementById('compareManualSearchBtn');
let compareDebounceTimer = null;
let compareSearchRequestSeq = 0;

// ---------- Compare modal: category/plan/option filters ----------
// Mirrors the Fund Explorer's filter chips and hits the same filtered
// search service, so "Add fund to compare" can be narrowed down the
// same way the main Explore Funds panel can.
const COMPARE_EXPLORER_API = 'https://api.tigzig.com/mf/v1/search';
const compareFilterState = { category: '', plan: '', option: '' };

function compareHasActiveFilter(){
  return !!(compareFilterState.category || compareFilterState.plan || compareFilterState.option);
}

function bindCompareFilterGroup(containerId, key){
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      compareFilterState[key] = btn.dataset[key] || '';
      runCompareSearch(compareSearchInput.value.trim());
    });
  });
}
bindCompareFilterGroup('compareCategoryFilters', 'category');
bindCompareFilterGroup('comparePlanFilters', 'plan');
bindCompareFilterGroup('compareOptionFilters', 'option');

function resetCompareFilters(){
  compareFilterState.category = '';
  compareFilterState.plan = '';
  compareFilterState.option = '';
  ['compareCategoryFilters', 'comparePlanFilters', 'compareOptionFilters'].forEach(id => {
    const box = document.getElementById(id);
    if (!box) return;
    box.querySelectorAll('.filter-chip').forEach(b => {
      b.classList.toggle('active', !b.dataset.category && !b.dataset.plan && !b.dataset.option);
    });
  });
}

const compareClearFiltersBtn = document.getElementById('compareClearFilters');
if (compareClearFiltersBtn){
  compareClearFiltersBtn.addEventListener('click', () => {
    resetCompareFilters();
    const q = compareSearchInput.value.trim();
    if (q.length >= 3){
      runCompareSearch(q);
    } else {
      compareSuggestionsBox.classList.remove('show');
      compareSuggestionsBox.innerHTML = '';
    }
  });
}

// Skeleton rows shown the moment a search is triggered (typing, filter
// chip tap, or manual search) so the popup never looks frozen while the
// local match or the filtered-search API call is in flight.
function renderCompareSuggestionsSkeleton(){
  const row = () => `
    <div class="skeleton-row explorer-skeleton-row compare-suggestion-skeleton-row">
      <span class="skeleton skeleton-circle" style="width:38px;height:38px;"></span>
      <span class="skeleton-col">
        <span class="skeleton skeleton-line" style="width:${55 + Math.floor(Math.random()*20)}%;height:13px;"></span>
        <span class="skeleton skeleton-line" style="width:${30 + Math.floor(Math.random()*20)}%;height:11px;"></span>
      </span>
    </div>`;
  compareSuggestionsBox.innerHTML = row() + row() + row() + row();
  compareSuggestionsBox.classList.add('show');
}

compareSearchInput.addEventListener('input', () => {
  const q = compareSearchInput.value.trim();
  clearTimeout(compareDebounceTimer);
  if (q.length < 3 && !compareHasActiveFilter()){
    compareSuggestionsBox.classList.remove('show');
    compareSuggestionsBox.innerHTML = '';
    return;
  }
  renderCompareSuggestionsSkeleton();
  compareDebounceTimer = setTimeout(() => runCompareSearch(q), 220);
});

// With a category/plan/option filter active, results come from the same
// filtered search service the Explore Funds panel uses (so "Large / Direct
// / Growth" etc. actually narrows things down); with no filter active this
// falls back to the fast local name match against the cached fund list.
async function runCompareSearch(query){
  warmFundAumMap();
  const requestId = ++compareSearchRequestSeq;
  const hasFilter = compareHasActiveFilter();

  if (!query && !hasFilter){
    compareSuggestionsBox.classList.remove('show');
    compareSuggestionsBox.innerHTML = '';
    return;
  }

  renderCompareSuggestionsSkeleton();

  if (!hasFilter){
    return runLocalCompareSearch(query, requestId);
  }

  try{
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (compareFilterState.category) params.set('category', compareFilterState.category);
    if (compareFilterState.plan) params.set('plan', compareFilterState.plan);
    if (compareFilterState.option) params.set('option', compareFilterState.option);
    params.set('group', 'equity');
    params.set('exclude', 'index');
    params.set('limit', '20');
    params.set('offset', '0');

    const res = await fetchWithTimeout(`${COMPARE_EXPLORER_API}?${params.toString()}`, 10000);
    if (requestId !== compareSearchRequestSeq) return;
    if (!res.ok) throw new Error(`Server responded with ${res.status}`);
    const data = await res.json();
    const results = Array.isArray(data.results) ? data.results : [];
    const mapped = results.map(f => ({
      schemeCode: f.scheme_code,
      schemeName: f.scheme_name || f.name || ''
    })).filter(f => f.schemeCode && f.schemeName);
    renderCompareSuggestions(mapped);
  } catch(err){
    if (requestId !== compareSearchRequestSeq) return;
    // Filtered service unreachable — fall back to a plain name match so
    // typing still works, even though the filters won't apply to it.
    if (query.length >= 3){
      await runLocalCompareSearch(query, requestId);
    } else {
      compareSuggestionsBox.classList.remove('show');
      compareSuggestionsBox.innerHTML = '';
    }
  }
}

async function runLocalCompareSearch(query, requestId){
  if (!query) return;
  if (!fundsLoaded){
    await loadFundList();
    if (requestId !== compareSearchRequestSeq) return;
    if (!fundsLoaded) return;
  }

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return;

  const firstPrefix = words[0].length >= 3 ? words[0].slice(0, 3) : null;
  const candidates = (firstPrefix && prefixIndex.has(firstPrefix)) ? prefixIndex.get(firstPrefix) : null;
  const scanLength = candidates ? candidates.length : searchIndex.length;
  const matches = [];

  for (let k = 0; k < scanLength; k++){
    const i = candidates ? candidates[k] : k;
    const lname = searchIndex[i];
    let ok = true;
    for (let w = 0; w < words.length; w++){
      if (lname.indexOf(words[w]) === -1){ ok = false; break; }
    }
    if (ok){
      matches.push(allFunds[i]);
      if (matches.length >= 20) break;
    }
  }

  renderCompareSuggestions(matches);
}

compareManualSearchBtn.addEventListener('click', async () => {
  const q = compareSearchInput.value.trim();
  if (q.length >= 3 || compareHasActiveFilter()) await runCompareSearch(q);
});

function renderCompareSuggestions(items){
  if (!items.length){
    compareSuggestionsBox.classList.remove('show');
    compareSuggestionsBox.innerHTML = '';
    return;
  }
  compareSuggestionsBox.innerHTML = items.map(item => {
    const domain = resolveAmcDomain(item.schemeName);
    const iconInner = domain
      ? `<img data-amc-domain="${escapeHtml(domain)}" alt="" referrerpolicy="no-referrer">`
      : `<i class="bi bi-piggy-bank"></i>`;
    const aumText = getFundAumText(item.schemeName);
    return `
    <div class="suggestion-item" data-code="${item.schemeCode}">
      <span class="suggestion-icon${domain ? ' has-logo' : ''}">${iconInner}</span>
      <span class="suggestion-info">
        <span class="suggestion-name">${escapeHtml(item.schemeName)}</span>
        <span class="suggestion-code">Scheme Code: ${item.schemeCode}</span>
      </span>
      ${aumText ? `<span class="suggestion-aum">${escapeHtml(aumText)}<small>AUM</small></span>` : ''}
      <i class="bi bi-chevron-right suggestion-arrow"></i>
    </div>
  `;
  }).join('');
  compareSuggestionsBox.classList.add('show');

  attachSuggestionLogos(compareSuggestionsBox);

  compareSuggestionsBox.querySelectorAll('.suggestion-item').forEach(el => {
    el.addEventListener('click', async () => {
      const code = el.getAttribute('data-code');
      const item = items.find(i => String(i.schemeCode) === String(code));
      compareSuggestionsBox.classList.remove('show');
      compareSearchInput.value = '';
      await addFundToCompareByCode(item);
    });
  });
}

async function addFundToCompareByCode(item){
  if (isFundInCompare(item.schemeCode)){
    notifyToast('This fund is already in the comparison chart.', 'warning');
    return;
  }
  if (compareFunds.length >= COMPARE_LIMIT){
    notifyToast('You can compare a maximum of 4 funds at a time.', 'warning');
    return;
  }

  // Give feedback and stop duplicate clicks while the NAV history for
  // this fund is fetched — previously this call had no timeout, so a
  // stalled network request would leave "Compare" looking stuck with
  // no indication anything was happening.
  compareSearchInput.disabled = true;
  compareManualSearchBtn.disabled = true;
  const originalPlaceholder = compareSearchInput.placeholder;
  compareSearchInput.placeholder = `Loading ${item.schemeName}...`;

  try{
    let navData = [];
    const cached = await idbGet('navCache', item.schemeCode);
    if (cached && cached.data){
      navData = cached.data.data || [];
    } else {
      const res = await fetchWithTimeout(`https://api.mfapi.in/mf/${encodeURIComponent(item.schemeCode)}`, 12000);
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      if (!data || !Array.isArray(data.data) || !data.data.length){
        throw new Error('No NAV history returned for this scheme');
      }
      navData = data.data;
      idbSet('navCache', { code: item.schemeCode, data, ts: Date.now() });
    }

    const ascending = [...navData].reverse()
      .map(r => ({ date: r.date, nav: parseFloat(r.nav) }))
      .filter(r => !isNaN(r.nav));

    const newFund = {
      schemeCode: String(item.schemeCode),
      schemeName: item.schemeName,
      fundHouse: '',
      navData: ascending,
      color: nextCompareColor(),
      order: Date.now()
    };

    compareFunds.push(newFund);
    updateAddToCompareBtn();
    updateCompareCountBadge();
    renderCompareUI();
    idbPutCompareFund(newFund);
    closeCompareSearchModal();
  } catch(err){
    notifyError(friendlyMessage(err, 'detail'));
  } finally{
    compareSearchInput.disabled = false;
    compareManualSearchBtn.disabled = false;
    compareSearchInput.placeholder = originalPlaceholder;
  }
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#compareSearchModal .search-box')){
    compareSuggestionsBox.classList.remove('show');
  }
});

renderRecentList();

