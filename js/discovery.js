/* ============================================================
   TOP FUNDS BY AUM — homepage highlights widget
   ============================================================ */
(() => {
  const AUM_DATA_URL =
    'https://api.tigzig.com/mf/v1/download?format=latest';

  const AUM_CACHE_KEY = 'ih_top_aum_v1';
  const AUM_CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours

  let aumHomeSection = null;

  /* ------------------------------------------------------------
     Small CSV parser
     Handles quoted fields and commas inside quotes.
     ------------------------------------------------------------ */
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let value = '';
    let quoted = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const next = text[i + 1];

      if (char === '"') {
        if (quoted && next === '"') {
          value += '"';
          i++;
        } else {
          quoted = !quoted;
        }
        continue;
      }

      if (char === ',' && !quoted) {
        row.push(value);
        value = '';
        continue;
      }

      if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && next === '\n') i++;

        row.push(value);
        value = '';

        if (row.some(v => String(v).trim() !== '')) {
          rows.push(row);
        }

        row = [];
        continue;
      }

      value += char;
    }

    if (value.length || row.length) {
      row.push(value);

      if (row.some(v => String(v).trim() !== '')) {
        rows.push(row);
      }
    }

    if (!rows.length) return [];

    const headers = rows[0].map(h =>
      String(h).trim().replace(/^\uFEFF/, '')
    );

    return rows.slice(1).map(row => {
      const obj = {};

      headers.forEach((header, index) => {
        obj[header] = row[index] ?? '';
      });

      return obj;
    });
  }

  /* ------------------------------------------------------------
     Convert different plan/option names into the same fund family.

     Example:

     HDFC Flexi Cap Fund - Direct Plan - Growth
     HDFC Flexi Cap Fund - Regular Plan - Growth
     HDFC Flexi Cap Fund - Direct Plan - IDCW

     -> HDFC Flexi Cap Fund
     ------------------------------------------------------------ */
  function normalizeFundName(name) {
    let result = String(name || '').trim();

    // Remove common bracketed option/plan descriptions
    result = result
      .replace(/\s*\([^)]*\)\s*$/i, '')
      .replace(/\s*-\s*(direct|regular)\s*plan\b/gi, '')
      .replace(/\s*-\s*(direct|regular)\b/gi, '');

    // Remove common option names
    result = result
      .replace(/\s*-\s*growth\s*(option)?\s*$/i, '')
      .replace(/\s*-\s*idcw\s*(option)?\s*$/i, '')
      .replace(/\s*-\s*dividend\s*(option)?\s*$/i, '')
      .replace(/\s*-\s*bonus\s*(option)?\s*$/i, '')
      .replace(/\s*-\s*payout\s*$/i, '')
      .replace(/\s*-\s*reinvestment\s*$/i, '');

    // Handle names where options aren't separated by "-"
    result = result
      .replace(/\s+(direct|regular)\s+plan\b/gi, '')
      .replace(/\s+(growth|idcw|dividend|bonus)\s+option\b/gi, '');

    // Clean repeated separators/spaces
    result = result
      .replace(/\s*-\s*$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return result;
  }

  /* ------------------------------------------------------------
     Format ₹ crore values
     ------------------------------------------------------------ */
  function formatAUM(value) {
    const crore = Number(value);

    if (!Number.isFinite(crore)) return '—';

    if (crore >= 100000) {
      return '₹' + (crore / 100000).toFixed(2) + ' L Cr';
    }

    if (crore >= 1000) {
      return '₹' + (crore / 1000).toFixed(2) + 'K Cr';
    }

    return '₹' + Math.round(crore).toLocaleString('en-IN') + ' Cr';
  }

  /* ------------------------------------------------------------
     Fetch + calculate fund-level AUM
     ------------------------------------------------------------ */
  let allFundsAumPromise = null;
  async function getAllFundsAum(){
    if (allFundsAumPromise) return allFundsAumPromise;
    allFundsAumPromise = fetchAllFundsAum().catch(err => {
      allFundsAumPromise = null;
      throw err;
    });
    return allFundsAumPromise;
  }

  async function fetchAllFundsAum() {
    const cached = localStorage.getItem(AUM_CACHE_KEY);

    if (cached) {
      try {
        const parsed = JSON.parse(cached);

        if (
          parsed &&
          Array.isArray(parsed.data) &&
          Date.now() - parsed.timestamp < AUM_CACHE_TTL
        ) {
          return parsed.data;
        }
      } catch (e) {
        localStorage.removeItem(AUM_CACHE_KEY);
      }
    }

    const response = await fetch(AUM_DATA_URL, {
      method: 'GET',
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`Fund data service returned HTTP ${response.status}`);
    }

    const csvText = await response.text();

    const rows = parseCSV(csvText);

    if (!rows.length) {
      throw new Error('Fund data service returned an empty dataset');
    }

    /*
      Group by:

      AMC + normalized fund name

      This prevents:

      Direct Growth
      Regular Growth
      Direct IDCW
      Regular IDCW

      from appearing as four different "funds".
    */
    const fundMap = new Map();

    for (const row of rows) {
      const isActive =
        String(row.is_active).toLowerCase() === 'true';

      if (!isActive) continue;

      const rawAUM = Number(row.aaum_cr_quarterly_avg);

      if (!Number.isFinite(rawAUM) || rawAUM <= 0) {
        continue;
      }

      const amc = String(row.amc || '').trim();
      const schemeName = String(row.scheme_name || '').trim();

      if (!schemeName) continue;

      const fundName = normalizeFundName(schemeName);

      if (!fundName) continue;

      const key =
        amc.toLowerCase() +
        '|' +
        fundName.toLowerCase();

      if (!fundMap.has(key)) {
        fundMap.set(key, {
          name: fundName,
          amc: amc,
          aum: 0
        });
      }

      fundMap.get(key).aum += rawAUM;
    }

    // Cache every fund, not just the homepage's top 10 — the search
    // results also want AUM figures, for any fund the person types in.
    const all = Array.from(fundMap.values())
      .sort((a, b) => b.aum - a.aum);

    localStorage.setItem(
      AUM_CACHE_KEY,
      JSON.stringify({
        timestamp: Date.now(),
        data: all
      })
    );

    return all;
  }

  async function getTopAUMFunds() {
    const all = await getAllFundsAum();
    return all.slice(0, 10);
  }

  /*
    Lookup table so any part of the app (search suggestions, compare
    search) can show a fund's AUM without re-fetching or re-parsing
    the CSV. Keyed by normalized fund name only, since search results
    only have the raw scheme name (with plan/option suffixes) and no
    reliable AMC field to pair it with.
  */
  let fundAumMapPromise = null;
  function getFundAumMap() {
    if (!fundAumMapPromise) {
      fundAumMapPromise = getAllFundsAum()
        .then(all => {
          const map = new Map();
          all.forEach(f => {
            const key = f.name.toLowerCase();
            map.set(key, (map.get(key) || 0) + f.aum);
          });
          return map;
        })
        .catch(() => new Map());
    }
    return fundAumMapPromise;
  }

  window.getFundAumMap = getFundAumMap;
  window.normalizeFundName = normalizeFundName;
  window.formatAUM = formatAUM;

  // Warm the cache in the background so search results have AUM
  // figures ready by the time the person starts typing, without
  // making search itself wait on this network call.
  getFundAumMap();



  /* ------------------------------------------------------------
     Build homepage UI
     ------------------------------------------------------------ */
  function createAUMSection() {
    if (aumHomeSection) return aumHomeSection;

    aumHomeSection = document.createElement('section');

    aumHomeSection.id = 'topAUMSection';

    aumHomeSection.innerHTML = `
      <div class="top-aum-header">
        <div>
          <div class="top-aum-title">
            <i class="bi bi-trophy"></i>
            Largest Funds by AUM
          </div>

          <div class="top-aum-subtitle">
            Real fund-level data · Quarterly average AUM
          </div>
        </div>

        <span class="top-aum-badge">
          AMFI DATA
        </span>
      </div>

      <div id="topAUMList" class="top-aum-list">
        <div class="skeleton-aum-list">
          ${Array.from({ length: 5 }).map(() => `
            <div class="skeleton-row skeleton-aum-row">
              <span class="skeleton skeleton-circle" style="width:32px;height:32px;"></span>
              <span class="skeleton skeleton-line" style="width:22px;height:14px;"></span>
              <span class="skeleton-col">
                <span class="skeleton skeleton-line" style="width:62%;height:13px;"></span>
                <span class="skeleton skeleton-line" style="width:38%;height:11px;"></span>
              </span>
              <span class="skeleton skeleton-line" style="width:48px;height:13px;"></span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="top-aum-footnote">
        Based on the latest available quarterly average AUM.
      </div>
    `;

    // Insert directly below the Fund Explorer section (which now
    // comes first), rather than right after the search box.
    const explorerSection = document.getElementById('fundExplorer');
    const searchBox = document.querySelector(
      '#searchPanel .search-box'
    );

    if (explorerSection) {
      explorerSection.insertAdjacentElement(
        'afterend',
        aumHomeSection
      );
    } else if (searchBox) {
      searchBox.insertAdjacentElement(
        'afterend',
        aumHomeSection
      );
    }

    return aumHomeSection;
  }

  /* ------------------------------------------------------------
     Render top 10
     ------------------------------------------------------------ */
  function renderTopAUMFunds(funds) {
    const section = createAUMSection();

    const list = section.querySelector('#topAUMList');

    if (!list) return;

    if (!funds.length) {
      list.innerHTML = `
        <div class="top-aum-empty">
          No AUM data available right now.
        </div>
      `;
      return;
    }

    list.innerHTML = funds.map((fund, index) => {
      const domain = (typeof resolveAmcDomain === 'function') ? resolveAmcDomain(fund.amc) : null;
      const iconInner = domain
        ? `<img data-amc-domain="${escapeHtml(domain)}" alt="" referrerpolicy="no-referrer">`
        : `<i class="bi bi-piggy-bank-fill"></i>`;

      return `
      <button
        type="button"
        class="top-aum-item"
        data-fund-name="${escapeHtml(fund.name)}"
      >
        <span class="top-aum-icon${domain ? ' has-logo' : ''}">${iconInner}</span>

        <span class="top-aum-rank">
          ${String(index + 1).padStart(2, '0')}
        </span>

        <span class="top-aum-info">
          <span class="top-aum-fund-name">
            ${escapeHtml(fund.name)}
          </span>

          <span class="top-aum-amc">
            ${escapeHtml(fund.amc)}
          </span>
        </span>

        <span class="top-aum-value">
          ${formatAUM(fund.aum)}
        </span>

        <i class="bi bi-chevron-right top-aum-arrow"></i>
      </button>
    `;
    }).join('');

    // Load each fund house logo with the shared multi-source fallback
    // chain (clearbit -> google favicons -> piggy-bank icon), instead
    // of a single low-res source that leaves some AMCs blank.
    list.querySelectorAll('.top-aum-icon img[data-amc-domain]').forEach(img => {
      const domain = img.getAttribute('data-amc-domain');
      const fallback = () => {
        const wrap = img.parentElement;
        wrap.classList.remove('has-logo');
        wrap.innerHTML = '<i class="bi bi-piggy-bank-fill"></i>';
      };
      if (typeof attachAmcLogoFallback === 'function' && typeof amcLogoUrl === 'function'){
        img.src = amcLogoUrl(domain, 0);
        attachAmcLogoFallback(img, domain, fallback);
      } else {
        img.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
        img.addEventListener('error', fallback);
      }
    });

    /*
      Clicking a fund loads it using the existing NAV lookup.

      We don't replace your existing search logic.
    */
    list.querySelectorAll('.top-aum-item').forEach(button => {
      button.addEventListener('click', () => {
        const fundName =
          button.getAttribute('data-fund-name');

        if (!fundName) return;

        searchInput.value = fundName;

        // Trigger your existing search input flow.
        searchInput.dispatchEvent(
          new Event('input', { bubbles: true })
        );

        // Move focus to the existing search box.
        searchInput.focus();

        // Hide homepage content.
        hideAUMSection();
      });
    });
  }

  /* ------------------------------------------------------------
     Hide/show homepage section
     ------------------------------------------------------------ */
  function hideAUMSection() {
    if (aumHomeSection) {
      aumHomeSection.classList.add('top-aum-hidden');
    }
  }

  function showAUMSection() {
    /*
      Don't show the section while a fund result is visible.
    */
    if (card && card.classList.contains('show')) {
      return;
    }

    if (aumHomeSection) {
      aumHomeSection.classList.remove('top-aum-hidden');
    }
  }

  /* ------------------------------------------------------------
     Initial load
     ------------------------------------------------------------ */
  async function initTopAUM() {
    try {
      createAUMSection();

      const funds = await getTopAUMFunds();

      renderTopAUMFunds(funds);

    } catch (error) {
      console.error(
        'Invisible House Top AUM error:',
        error
      );

      if (aumHomeSection) {
        const list =
          aumHomeSection.querySelector('#topAUMList');

        if (list) {
          list.innerHTML = `
            <div class="top-aum-error">
              <i class="bi bi-wifi-off"></i>
              Unable to load AUM data.
              <button
                type="button"
                id="retryTopAUM"
                class="top-aum-retry"
              >
                Retry
              </button>
            </div>
          `;

          const retry =
            document.getElementById('retryTopAUM');

          if (retry) {
            retry.addEventListener(
              'click',
              initTopAUM
            );
          }
        }
      }
    }
  }

  /*
    Watch the existing search input.

    When user starts searching:
      Top AUM disappears.

    When search is cleared:
      Top AUM returns, as long as no result card is open.
  */
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();

    if (query.length >= 3) {
      hideAUMSection();
    } else if (query.length === 0) {
      showAUMSection();
    }
  });

  /*
    If an existing search button is clicked,
    hide the homepage section immediately.
  */
  if (manualSearchBtn) {
    manualSearchBtn.addEventListener(
      'click',
      hideAUMSection
    );
  }

  // Start after the existing page script has initialized.
  initTopAUM();

})();


/* ============================================================
   FUND EXPLORER
   ============================================================ */

(() => {

  const API_BASE =
    'https://api.tigzig.com/mf/v1/search';

  const explorerResults =
    document.getElementById('explorerResults');

  const explorerResultList =
    document.getElementById('explorerResultList');

  const explorerResultCount =
    document.getElementById('explorerResultCount');

  const explorerLoading =
    document.getElementById('explorerLoading');

  const explorerLoadMore =
    document.getElementById('explorerLoadMore');

  const clearFundFilters =
    document.getElementById('clearFundFilters');

  const explorerNameInput =
    document.getElementById('explorerNameInput');

  if (!explorerResults) return;

  /* ----------------------------------------------------------
     Collapsible explorer header
     The filter tool is secondary to search, so it starts
     collapsed and expands on demand.
     ---------------------------------------------------------- */
  const explorerToggle = document.getElementById('explorerToggle');
  const explorerBody = document.getElementById('explorerBody');
  const explorerSection = document.getElementById('fundExplorer');

  if (explorerToggle && explorerBody && explorerSection) {
    explorerToggle.addEventListener('click', () => {
      const collapsed = explorerSection.classList.toggle('collapsed');
      explorerBody.hidden = collapsed;
      explorerToggle.setAttribute('aria-expanded', String(!collapsed));
    });
  }

  const explorerState = {
    q: '',
    category: '',
    plan: '',
    option: '',
    amc: '',
    group: 'equity',
    exclude: 'index',

    limit: 20,
    offset: 0,
    total: 0
  };

  /* ----------------------------------------------------------
     Build fund explorer request URL
     ---------------------------------------------------------- */

  function buildExplorerURL() {

    const params = new URLSearchParams();

    if (explorerState.q) {
      params.set(
        'q',
        explorerState.q
      );
    }

    if (explorerState.category) {
      params.set(
        'category',
        explorerState.category
      );
    }

    if (explorerState.plan) {
      params.set(
        'plan',
        explorerState.plan
      );
    }

    if (explorerState.option) {
      params.set(
        'option',
        explorerState.option
      );
    }

    if (explorerState.amc) {
      params.set(
        'amc',
        explorerState.amc
      );
    }

    if (explorerState.group) {
      params.set(
        'group',
        explorerState.group
      );
    }

    if (explorerState.exclude) {
      params.set(
        'exclude',
        explorerState.exclude
      );
    }

    params.set(
      'limit',
      explorerState.limit
    );

    params.set(
      'offset',
      explorerState.offset
    );

    return `${API_BASE}?${params.toString()}`;
  }

  /* ----------------------------------------------------------
     Fetch
     ---------------------------------------------------------- */

  async function fetchExplorerFunds(
    append = false
  ) {

    explorerLoading.hidden = false;

    if (!append) {
      explorerResults.hidden = false;
      explorerResultList.innerHTML = '';
    }

    try {

      const response = await fetch(
        buildExplorerURL(),
        {
          method:'GET',
          cache:'no-store'
        }
      );

      if (!response.ok) {
        throw new Error(
          `Fund explorer service returned HTTP ${response.status}`
        );
      }

      const data = await response.json();

      /*
        Response shape:
          total_matches
          results
      */

      const results =
        Array.isArray(data.results)
          ? data.results
          : [];

      explorerState.total =
        Number(
          data.total_matches ??
          data.count ??
          results.length
        );

      if (!append) {
        explorerResultList.innerHTML = '';
      }

      renderExplorerResults(results);

      updateExplorerCount();

    } catch(error) {

      console.error(
        'Fund explorer error:',
        error
      );

      explorerResultList.innerHTML = `
        <div class="explorer-loading">
          <i class="bi bi-exclamation-circle"></i>
          Unable to load funds. Please try again.
        </div>
      `;

    } finally {

      explorerLoading.hidden = true;

    }
  }

  /* ----------------------------------------------------------
     Render results
     ---------------------------------------------------------- */

  function renderExplorerResults(results) {

    if (!results.length && explorerState.offset === 0) {

      explorerResultList.innerHTML = `
        <div class="explorer-loading">
          No funds found for these filters.
        </div>
      `;

      return;
    }

    const html = results.map(fund => {

      const name =
        fund.scheme_name ||
        fund.name ||
        'Unknown Fund';

      const amc =
        fund.amc ||
        fund.fund_house ||
        '';

      const category =
        fund.category_sub ||
        fund.category ||
        '';

      const code =
        fund.scheme_code ||
        '';

      const domain = (typeof resolveAmcDomain === 'function') ? resolveAmcDomain(amc || name) : null;
      const iconInner = domain
        ? `<img data-amc-domain="${escapeHtml(domain)}" alt="" referrerpolicy="no-referrer">`
        : `<i class="bi bi-piggy-bank"></i>`;

      return `
        <button
          type="button"
          class="explorer-result-item"
          data-scheme-code="${escapeHtml(String(code))}"
          data-scheme-name="${escapeHtml(name)}"
        >

          <span class="explorer-result-icon${domain ? ' has-logo' : ''}">${iconInner}</span>

          <span class="explorer-result-info">

            <span class="explorer-result-name">
              ${escapeHtml(name)}
            </span>

            <span class="explorer-result-meta">
              ${escapeHtml(amc)}
              ${category ? ` · ${escapeHtml(category)}` : ''}
            </span>

          </span>

          <i class="bi bi-chevron-right explorer-result-arrow"></i>

        </button>
      `;

    }).join('');

    explorerResultList.insertAdjacentHTML(
      'beforeend',
      html
    );

    // Load each fund house logo with the same shared multi-source
    // fallback chain used by search suggestions and the Top AUM list,
    // instead of a single generic icon for every result.
    if (typeof attachSuggestionLogos === 'function') {
      attachSuggestionLogos(explorerResultList);
    }

    /*
      Use the existing fund result system when
      the user selects a scheme from the explorer.
    */

    explorerResultList
      .querySelectorAll(
        '.explorer-result-item'
      )
      .forEach(button => {

        button.addEventListener(
          'click',
          () => {

            const schemeCode =
              button.dataset.schemeCode;

            const schemeName =
              button.dataset.schemeName;

            if (!schemeCode) {

              /*
                Fallback to your existing search.
              */
              searchInput.value = schemeName;

              searchInput.dispatchEvent(
                new Event(
                  'input',
                  { bubbles:true }
                )
              );

              return;
            }

            /*
              Your existing function already
              loads NAV history from the fund data service.
            */
            selectFundFromExplorer(
              schemeCode,
              schemeName
            );

          }
        );

      });
  }

  /* ----------------------------------------------------------
     Select fund
     ---------------------------------------------------------- */

  async function selectFundFromExplorer(
    schemeCode,
    schemeName
  ) {

    searchInput.value = schemeName;

    /*
      Hide explorer after selecting.
    */
    explorerResults.hidden = true;

    /*
      Use the existing NAV-loading function.
      Nothing about the existing NAV/result system
      needs to be rewritten.
    */
    await loadFundByCode(
      schemeCode
    );
  }

  /* ----------------------------------------------------------
     Update count
     ---------------------------------------------------------- */

  function updateExplorerCount() {

    const shown =
      explorerResultList.querySelectorAll(
        '.explorer-result-item'
      ).length;

    explorerResultCount.textContent =
      `${explorerState.total || shown} funds`;

    const loadedMore =
      explorerState.offset +
      explorerState.limit <
      explorerState.total;

    explorerLoadMore.hidden =
      !loadedMore;
  }

  /* ----------------------------------------------------------
     Fund name input
     Debounced, and combines with whatever category/plan/option
     chips are already active — the API ANDs q together with
     the other filters rather than replacing them.
     ---------------------------------------------------------- */

  let explorerNameDebounce = null;

  if (explorerNameInput) {
    explorerNameInput.addEventListener('input', () => {
      clearTimeout(explorerNameDebounce);
      explorerNameDebounce = setTimeout(() => {
        explorerState.q = explorerNameInput.value.trim();
        runNewExplorerSearch();
      }, 300);
    });

    explorerNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(explorerNameDebounce);
        explorerState.q = explorerNameInput.value.trim();
        runNewExplorerSearch();
      }
    });
  }

  /* ----------------------------------------------------------
     Filter buttons
     (scoped to explorerBody so these never bind to the
     look-alike category/plan/option chips inside the
     add-fund-to-compare modal, which have their own handlers)
     ---------------------------------------------------------- */

  explorerBody
    .querySelectorAll(
      '[data-category]'
    )
    .forEach(button => {

      button.addEventListener(
        'click',
        () => {

          explorerBody
            .querySelectorAll(
              '[data-category]'
            )
            .forEach(btn =>
              btn.classList.remove('active')
            );

          button.classList.add('active');

          explorerState.category =
            button.dataset.category || '';

          runNewExplorerSearch();

        }
      );

    });

  explorerBody
    .querySelectorAll(
      '[data-plan]'
    )
    .forEach(button => {

      button.addEventListener(
        'click',
        () => {

          explorerBody
            .querySelectorAll(
              '[data-plan]'
            )
            .forEach(btn =>
              btn.classList.remove('active')
            );

          button.classList.add('active');

          explorerState.plan =
            button.dataset.plan || '';

          runNewExplorerSearch();

        }
      );

    });

  explorerBody
    .querySelectorAll(
      '[data-option]'
    )
    .forEach(button => {

      button.addEventListener(
        'click',
        () => {

          explorerBody
            .querySelectorAll(
              '[data-option]'
            )
            .forEach(btn =>
              btn.classList.remove('active')
            );

          button.classList.add('active');

          explorerState.option =
            button.dataset.option || '';

          runNewExplorerSearch();

        }
      );

    });

  /* ----------------------------------------------------------
     New search
     ---------------------------------------------------------- */

  function runNewExplorerSearch() {

    explorerState.offset = 0;

    fetchExplorerFunds(false);

  }

  /* ----------------------------------------------------------
     Load more
     ---------------------------------------------------------- */

  explorerLoadMore.addEventListener(
    'click',
    () => {

      explorerState.offset +=
        explorerState.limit;

      fetchExplorerFunds(true);

    }
  );

  /* ----------------------------------------------------------
     Clear
     ---------------------------------------------------------- */

  clearFundFilters.addEventListener(
    'click',
    () => {

      explorerState.q = '';
      explorerState.category = '';
      explorerState.plan = '';
      explorerState.option = '';

      if (explorerNameInput) {
        explorerNameInput.value = '';
      }

      explorerBody
        .querySelectorAll(
          '.filter-chip'
        )
        .forEach(button => {

          button.classList.toggle(
            'active',
            !button.dataset.category &&
            !button.dataset.plan &&
            !button.dataset.option
          );

        });

      explorerResults.hidden = true;
      explorerResultList.innerHTML = '';

    }
  );

  /*
    Initially don't fetch.
    This keeps your initial homepage clean.
    Fetch only when the user chooses a filter.
  */

})();
