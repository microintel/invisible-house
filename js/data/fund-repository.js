/* ============================================================
   DATA LAYER · Fund repository
   ------------------------------------------------------------
   Live search against mfapi.in. The ~40k-scheme list is NOT
   downloaded or cached any more: every search is a fresh API
   request, so nothing heavy is stored on the user's device.
   Knows nothing about the DOM or rendering.
   ============================================================ */
(function (global) {
  'use strict';

  const SEARCH_URL = 'https://api.mfapi.in/mf/search';
  const TIMEOUT_MS = 12000;

  /**
   * GET json with a timeout, also cancellable through an outer signal.
   * A timeout surfaces as an AbortError (same as before, so the existing
   * friendlyMessage() wording applies); an outer cancel does too, and the
   * caller discards it via its request-id check.
   */
  async function fetchJson(url, signal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const onOuterAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onOuterAbort, { once: true });
    }
    try {
      const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onOuterAbort);
    }
  }

  const FundRepository = {
    /**
     * Searches mfapi.in live.
     * The API is queried with the longest typed word (keeps the response
     * small), then every typed word must appear in the scheme name (any
     * order) and the matches are ranked — same rules as before.
     * @returns {Promise<{items:Array,total:number}>}
     */
    async search(query, opts) {
      const limit = (opts && opts.limit) || 30;
      const signal = opts && opts.signal;
      const words = Array.from(new Set(
        String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
      ));
      if (!words.length) return { items: [], total: 0 };

      const term = words.reduce((a, b) => (b.length > a.length ? b : a));
      const data = await fetchJson(SEARCH_URL + '?q=' + encodeURIComponent(term), signal);
      if (!Array.isArray(data)) throw new Error('HTTP bad response');

      // Rank only this (small) result set with the existing ranking service.
      const index = new global.FundSearchIndex();
      index.build(data);
      return index.search(query, { limit });
    },

    /** Frees the old cached 40k-scheme list left on devices by earlier versions. */
    purgeLegacyCache() {
      try { return idbDelete('fundList', 'all'); } catch (e) { return Promise.resolve(); }
    }
  };

  global.FundRepository = FundRepository;
  FundRepository.purgeLegacyCache();
})(window);
