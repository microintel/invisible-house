/* ============================================================
   SERVICE LAYER · Fund-house logos
   ------------------------------------------------------------
   Turns any text that starts with / contains a fund-house name
   (a scheme name, "SBI Mutual Fund", ...) into a logo.

   Resolution order for every image:
     1. MicroIntel MF Logos (clean, consistent artwork)
     2. Google favicon -> DuckDuckGo -> Clearbit -> /favicon.ico
        (only when the AMC's website domain is known)
     3. caller's own fallback icon

   Public globals (unchanged signatures, so every existing screen
   keeps working):
     resolveAmcDomain(name)            -> logo key | domain | null
     amcLogoUrl(key, stage)            -> url for that fallback stage
     attachAmcLogoFallback(img,key,cb) -> walks the stages on error
   ============================================================ */

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

(function (global) {
  'use strict';

  // Alternative / older / shorter names → brand as written in the logo list.
  const BRAND_ALIASES = [
    ['idfc', 'bandhan idfc'],
    ['aditya birla', 'aditya birla sun life'],
    ['birla sun life', 'aditya birla sun life'],
    ['absl', 'aditya birla sun life'],
    ['kotak', 'kotak mahindra'],
    ['mirae', 'mirae asset'],
    ['nippon', 'nippon india'],
    ['reliance', 'nippon india'],
    ['icici', 'icici prudential'],
    ['franklin', 'franklin templeton'],
    ['motilal', 'motilal oswal'],
    ['baroda', 'baroda bnp paribas'],
    ['bnp paribas', 'baroda bnp paribas'],
    ['canara', 'canara robeco'],
    ['parag parikh', 'ppfas'],
    ['pgim', 'pgim india'],
    ['boi axa', 'bank of india'],
    ['whiteoak', 'whiteoak capital'],
    ['jio', 'jio blackrock'],
    ['bajaj', 'bajaj finserv'],
    ['wealth company', 'the wealth company'],
    ['mahindra', 'mahindra manulife'],
    ['indiabulls', 'groww']
  ];

  const TRAILING_NOISE = new Set(['mutual', 'fund', 'mf', 'amc']);

  function brandOf(name) {
    const tokens = PhraseMatcher.tokenize(name);
    while (tokens.length > 1 && TRAILING_NOISE.has(tokens[tokens.length - 1])) tokens.pop();
    return tokens;
  }

  // ---------- domain matcher (static) ----------
  const domainMatcher = new PhraseMatcher();
  Object.keys(AMC_DOMAINS).forEach(k => domainMatcher.add(k, AMC_DOMAINS[k]));

  // ---------- logo matcher (rebuilt when the logo list changes) ----------
  let logoMatcher = new PhraseMatcher();
  const keyRegistry = new Map();   // "logo:<slug>" -> { url, domain }
  const resolveCache = new Map();  // text -> key | domain | null
  const RESOLVE_CACHE_MAX = 4000;

  function rebuildLogoIndex(entries) {
    const matcher = new PhraseMatcher();
    const byBrand = new Map();

    entries.forEach(entry => {
      const brand = brandOf(entry.name);
      const brandKey = brand.join(' ');
      byBrand.set(brandKey, entry);
      matcher.add(brand, entry);
    });
    BRAND_ALIASES.forEach(([phrase, target]) => {
      const entry = byBrand.get(target);
      if (entry) matcher.add(phrase, entry);
    });

    logoMatcher = matcher;
    resolveCache.clear();

    entries.forEach(entry => {
      const probe = brandOf(entry.name);
      keyRegistry.set('logo:' + entry.slug, {
        url: entry.url,
        domain: domainMatcher.matchPrefix(probe) || null
      });
    });
  }

  function lookupLogoEntry(tokens) {
    return logoMatcher.matchPrefix(tokens) || logoMatcher.matchAnywhere(tokens, 2, Infinity);
  }

  // ---------- public API ----------
  function resolveAmcDomain(fundHouseName) {
    if (!fundHouseName) return null;
    const text = String(fundHouseName);
    if (resolveCache.has(text)) return resolveCache.get(text);

    const tokens = PhraseMatcher.tokenize(text);
    let result = null;

    const entry = lookupLogoEntry(tokens);
    if (entry) {
      const key = 'logo:' + entry.slug;
      if (!keyRegistry.has(key)) {
        keyRegistry.set(key, { url: entry.url, domain: domainMatcher.matchPrefix(brandOf(entry.name)) || null });
      }
      result = key;
    } else {
      result = domainMatcher.matchPrefix(tokens) || domainMatcher.matchAnywhere(tokens, 2, 5);
    }

    if (resolveCache.size >= RESOLVE_CACHE_MAX) resolveCache.clear();
    resolveCache.set(text, result);
    return result;
  }

  function domainStageUrl(domain, stage) {
    switch (stage) {
      case 0: return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
      case 1: return `https://icons.duckduckgo.com/ip3/${domain}.ico`;
      case 2: return `https://logo.clearbit.com/${domain}?size=256`;
      default: return `https://${domain}/favicon.ico`;
    }
  }
  const DOMAIN_STAGES = 4;

  function amcLogoStageCount(key) {
    const reg = keyRegistry.get(key);
    if (reg) return 1 + (reg.domain ? DOMAIN_STAGES : 0);
    return String(key).indexOf('logo:') === 0 ? 0 : DOMAIN_STAGES;
  }

  function amcLogoUrl(key, stage) {
    const reg = keyRegistry.get(key);
    if (reg) {
      if (stage === 0) return reg.url;
      return reg.domain ? domainStageUrl(reg.domain, stage - 1) : '';
    }
    return domainStageUrl(key, stage);
  }
  const AMC_LOGO_STAGE_COUNT = DOMAIN_STAGES; // kept for backwards compatibility

  function attachAmcLogoFallback(img, key, onFail) {
    const total = amcLogoStageCount(key);
    if (total === 0) {
      if (typeof onFail === 'function') onFail();
      return;
    }
    let stage = 0;
    img.decoding = 'async';
    img.addEventListener('error', function handler() {
      stage++;
      if (stage < total) {
        img.src = amcLogoUrl(key, stage);
      } else {
        img.removeEventListener('error', handler);
        if (typeof onFail === 'function') onFail();
      }
    });
  }

  global.resolveAmcDomain = resolveAmcDomain;
  global.amcLogoUrl = amcLogoUrl;
  global.attachAmcLogoFallback = attachAmcLogoFallback;
  global.AMC_LOGO_STAGE_COUNT = AMC_LOGO_STAGE_COUNT;
  global.LogoService = { resolve: resolveAmcDomain, urlFor: amcLogoUrl };

  // Wire to the data layer: seed is available immediately, cache/network refine it.
  rebuildLogoIndex(LogoRepository.getAll());
  LogoRepository.onChange(rebuildLogoIndex);
  LogoRepository.init();
})(window);
