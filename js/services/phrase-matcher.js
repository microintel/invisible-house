/* ============================================================
   SERVICE LAYER · PhraseMatcher
   ------------------------------------------------------------
   Token-trie for matching fund-house names inside free text.
   Matching works on whole words, so "quant" never matches
   "Quantum", and "uti" never matches "institutional".
   Lookup cost depends on the phrase length, not on how many
   fund houses are registered.
   ============================================================ */
(function (global) {
  'use strict';

  const END = Symbol('end');

  function tokenize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  class PhraseMatcher {
    constructor() { this.root = new Map(); }

    /** Registers a phrase (string or token array) → value. First registration wins. */
    add(phrase, value) {
      const tokens = Array.isArray(phrase) ? phrase : tokenize(phrase);
      if (!tokens.length) return;
      let node = this.root;
      for (let i = 0; i < tokens.length; i++) {
        let next = node.get(tokens[i]);
        if (!next) { next = new Map(); node.set(tokens[i], next); }
        node = next;
      }
      if (!node.has(END)) node.set(END, { value, length: tokens.length });
    }

    /** Longest registered phrase starting at token index `start`. */
    _longestAt(tokens, start) {
      let node = this.root;
      let best = null;
      for (let i = start; i < tokens.length; i++) {
        node = node.get(tokens[i]);
        if (!node) break;
        const end = node.get(END);
        if (end) best = end;
      }
      return best;
    }

    /** Best match that begins at the very first word (fund names start with their AMC). */
    matchPrefix(tokens) {
      const hit = this._longestAt(tokens, 0);
      return hit ? hit.value : null;
    }

    /**
     * Match anywhere in the text. Only phrases that are long enough to be
     * unambiguous are accepted: >= minTokens words, or a single word of
     * >= minChars letters.
     */
    matchAnywhere(tokens, minTokens, minChars) {
      for (let i = 0; i < tokens.length; i++) {
        const hit = this._longestAt(tokens, i);
        if (!hit) continue;
        if (hit.length >= minTokens) return hit.value;
        if (hit.length === 1 && tokens[i].length >= minChars) return hit.value;
      }
      return null;
    }
  }

  PhraseMatcher.tokenize = tokenize;
  global.PhraseMatcher = PhraseMatcher;
})(window);
