// ============================================================
// UI STATE CONTROLLER
// ------------------------------------------------------------
// This file does NOT touch search, NAV loading, caching, compare,
// recent searches, filters, or chart logic. It only watches the
// classes/elements that already exist and reflects a high-level
// "home / searching / detail" state onto <body data-app-state>
// so CSS can decide what to show or hide. This is what powers the
// "selected fund becomes the whole screen" behaviour.
// ============================================================
(() => {
  const body = document.body;
  const cardEl = document.getElementById('card');
  const suggestionsEl = document.getElementById('suggestions');
  const searchInputEl = document.getElementById('searchInput');
  const backBtn = document.getElementById('fundBackBtn');

  if (!cardEl || !suggestionsEl || !searchInputEl) return;

  function computeState() {
    if (cardEl.classList.contains('show')) return 'detail';
    if (suggestionsEl.classList.contains('show')) return 'searching';
    if (searchInputEl.value.trim().length > 0) return 'searching';
    return 'home';
  }

  function refresh() {
    body.setAttribute('data-app-state', computeState());
  }

  // Reflect whenever the fund card is opened/closed (existing code
  // toggles the 'show' class; we just listen for it).
  new MutationObserver(refresh).observe(cardEl, {
    attributes: true,
    attributeFilter: ['class']
  });

  // Reflect whenever suggestions open/close (existing code toggles
  // the 'show' class on #suggestions; we just listen for it).
  new MutationObserver(refresh).observe(suggestionsEl, {
    attributes: true,
    attributeFilter: ['class']
  });

  // Typing/clearing the search box also affects state.
  searchInputEl.addEventListener('input', refresh);
  searchInputEl.addEventListener('focus', refresh);
  searchInputEl.addEventListener('blur', () => setTimeout(refresh, 120));

  // "Back to search" — purely additive. Uses the same 'show' class
  // the existing code already keys visibility off, so nothing about
  // loadFundByCode/displayFund needs to change.
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      cardEl.classList.remove('show');
      suggestionsEl.classList.remove('show');
      suggestionsEl.innerHTML = '';
      searchInputEl.value = '';
      if (typeof setStatus === 'function') setStatus('');
      searchInputEl.focus();
      refresh();
    });
  }

  refresh();
})();
