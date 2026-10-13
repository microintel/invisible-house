/* ============================================================
   SERVICE LAYER · Fund search
   ------------------------------------------------------------
   In-memory index over the ~40k scheme names.

   • Every typed word must appear in the name (any order), the
     same rule as before — but matched as a true substring, so
     "cap" now also finds "SmallCap" / "MidCap".
   • Results are ranked (name starts with the query > word-start
     matches > mid-word matches > shorter names) instead of just
     list order; ties keep original order.
   • Top-K selection while scanning: no sorting of thousands of
     matches, memory stays O(K).
   • Incremental narrowing: when the user keeps typing
     ("sbi" → "sbi bl" → "sbi blue") only the previous matches
     are re-checked, so each keystroke touches far fewer names.
   ============================================================ */
(function (global) {
  'use strict';

  const WORD_CHAR = /[a-z0-9]/;

  class FundSearchIndex {
    constructor() { this.reset(); }

    reset() {
      this.funds = [];
      this.lower = [];
      this._lastQuery = null;
      this._lastCandidates = null;
    }

    build(funds) {
      const n = funds.length;
      const lower = new Array(n);
      for (let i = 0; i < n; i++) lower[i] = String(funds[i].schemeName || '').toLowerCase();
      this.funds = funds;
      this.lower = lower;
      this._lastQuery = null;
      this._lastCandidates = null;
    }

    get size() { return this.funds.length; }

    /**
     * @returns {{items:Array,total:number}}  items = best `limit` matches
     */
    search(query, opts) {
      const limit = (opts && opts.limit) || 30;
      const words = Array.from(new Set(
        String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
      ));
      if (!words.length) return { items: [], total: 0 };

      const phrase = words.join(' ');
      const lower = this.lower;
      const first = words[0];
      const wCount = words.length;

      // Narrow from the previous keystroke's matches when this query extends it.
      let source = null;
      if (this._lastQuery && phrase.length >= this._lastQuery.length &&
          phrase.indexOf(this._lastQuery) === 0 && this._lastCandidates) {
        source = this._lastCandidates;
      }
      const scanLength = source ? source.length : lower.length;

      const matched = [];            // every matching index (for next-keystroke narrowing)
      const top = [];                // [{s, i}] best-first, length <= limit

      for (let k = 0; k < scanLength; k++) {
        const i = source ? source[k] : k;
        const name = lower[i];

        let ok = true;
        let score = 0;
        for (let w = 0; w < wCount; w++) {
          const pos = name.indexOf(words[w]);
          if (pos === -1) { ok = false; break; }
          if (pos === 0 || !WORD_CHAR.test(name.charAt(pos - 1))) score += 40;
        }
        if (!ok) continue;

        matched.push(i);

        if (name.indexOf(phrase) === 0) score += 1000;
        else if (name.indexOf(first) === 0) score += 400;
        if (wCount > 1 && name.indexOf(phrase) !== -1) score += 200;
        score -= name.length * 0.01;

        if (top.length < limit || score > top[top.length - 1].s) {
          let p = top.length;
          while (p > 0 && top[p - 1].s < score) p--;   // strict < keeps original order on ties
          top.splice(p, 0, { s: score, i });
          if (top.length > limit) top.pop();
        }
      }

      this._lastQuery = phrase;
      this._lastCandidates = matched;

      const funds = this.funds;
      return { items: top.map(t => funds[t.i]), total: matched.length };
    }
  }

  global.FundSearchIndex = FundSearchIndex;
  global.FundSearch = new FundSearchIndex();
})(window);
