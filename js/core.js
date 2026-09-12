// ---------- Theme & Color Palette Controller ----------
const THEME_KEY = 'ih_theme';
const PALETTE_KEY = 'ih_palette';
const themeToggle = document.getElementById('themeToggle');
const storedTheme = localStorage.getItem(THEME_KEY);
const storedPalette = localStorage.getItem(PALETTE_KEY) || 'default';
const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;

let currentTheme = storedTheme || (prefersLight ? 'light' : 'dark');
let currentPalette = storedPalette;

applyTheme(currentTheme, currentPalette);

function applyTheme(theme, palette){
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-palette', palette);
  
  themeToggle.innerHTML = theme === 'dark'
    ? '<i class="bi bi-moon-stars-fill"></i> Dark Mode'
    : '<i class="bi bi-sun-fill"></i> Light Mode';

  // Highlight the active swatch inside the menu
  document.querySelectorAll('.palette-swatch').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === palette);
  });

  // Repaint active charts with the new CSS variable colors
  try{
    if (currentNavData && currentNavData.length){
      setTimeout(() => drawChart(getChartDataForRange(currentChartRange)), 50);
    }
    if (compareFunds && compareFunds.length && comparePanel.classList.contains('active')){
      setTimeout(() => drawCompareChart(), 50);
    }
  } catch(e){}
}

// Swatch click events
document.querySelectorAll('.palette-swatch').forEach(btn => {
  btn.addEventListener('click', () => {
    currentPalette = btn.dataset.color;
    applyTheme(currentTheme, currentPalette);
    localStorage.setItem(PALETTE_KEY, currentPalette);
  });
});

themeToggle.addEventListener('click', () => {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(currentTheme, currentPalette);
  localStorage.setItem(THEME_KEY, currentTheme);
});

// ---------- Top menu ----------
const menuToggleBtn = document.getElementById('menuToggleBtn');
const menuDropdown = document.getElementById('menuDropdown');
const menuWrap = document.getElementById('menuWrap');

function openMenu(){
  menuDropdown.classList.add('show');
  menuToggleBtn.classList.add('open');
  menuToggleBtn.setAttribute('aria-expanded', 'true');
}
function closeMenu(){
  menuDropdown.classList.remove('show');
  menuToggleBtn.classList.remove('open');
  menuToggleBtn.setAttribute('aria-expanded', 'false');
}
menuToggleBtn.addEventListener('click', () => {
  if (menuDropdown.classList.contains('show')) closeMenu(); else openMenu();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#menuWrap')) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu();
});
// Close dropdown when navigation items are clicked (ignore clicks on swatches)
menuDropdown.querySelectorAll('.menu-item').forEach(item => {
  item.addEventListener('click', closeMenu);
});

// ---------- Tabs ----------
const searchTabBtn = document.getElementById('searchTabBtn');
const recentTabBtn = document.getElementById('recentTabBtn');
const compareTabBtn = document.getElementById('compareTabBtn');
const searchPanel = document.getElementById('searchPanel');
const recentPanel = document.getElementById('recentPanel');
const comparePanel = document.getElementById('comparePanel');

searchTabBtn.addEventListener('click', () => switchTab('search'));
recentTabBtn.addEventListener('click', () => switchTab('recent'));
compareTabBtn.addEventListener('click', () => switchTab('compare'));

function switchTab(tab){
  searchTabBtn.classList.toggle('active', tab === 'search');
  recentTabBtn.classList.toggle('active', tab === 'recent');
  compareTabBtn.classList.toggle('active', tab === 'compare');
  searchPanel.classList.toggle('active', tab === 'search');
  recentPanel.classList.toggle('active', tab === 'recent');
  comparePanel.classList.toggle('active', tab === 'compare');
  if (tab === 'recent') renderRecentList();
  if (tab === 'compare'){
    // renderCompareUI() itself waits two animation frames before
    // drawing so the panel has finished becoming visible first —
    // this is what fixes the "sometimes the chart doesn't show up"
    // issue when jumping straight to Compare.
    renderCompareUI();
    if (typeof compareChartInstance !== 'undefined' && compareChartInstance){
      requestAnimationFrame(() => {
        try{ compareChartInstance.resize(); }catch(e){}
      });
    }
  }
}

// ---------- Recent searches ----------
const RECENT_KEY = 'ih_recent_searches';
const MAX_RECENT = 12;

function getRecent(){
  try{
    return JSON.parse(localStorage.getItem(RECENT_KEY)) || [];
  }catch(e){ return []; }
}

function saveRecent(entry){
  let list = getRecent().filter(r => r.schemeCode !== entry.schemeCode);
  list.unshift(entry);
  list = list.slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

function renderRecentList(){
  const list = getRecent();
  const container = document.getElementById('recentList');
  if (!list.length){
    container.innerHTML = `
      <div class="empty-state">
        <i class="bi bi-inbox"></i>
        <p>No recent searches yet. Funds you look up will show up here.</p>
      </div>`;
    return;
  }
  container.innerHTML = list.map(item => {
    const domain = resolveAmcDomain(item.fundHouse);
    const iconInner = domain
      ? `<img data-amc-domain="${domain}" alt="" referrerpolicy="no-referrer">`
      : `<i class="bi bi-piggy-bank"></i>`;
    return `
    <div class="recent-item" data-code="${item.schemeCode}">
      <div class="recent-icon${domain ? ' has-logo' : ''}">${iconInner}</div>
      <div class="recent-info">
        <div class="recent-name">${escapeHtml(item.schemeName)}</div>
        <div class="recent-meta">
          <span><i class="bi bi-hash"></i>${escapeHtml(String(item.schemeCode))}</span>
          <span><i class="bi bi-clock"></i>${escapeHtml(item.when)}</span>
        </div>
      </div>
      <i class="bi bi-chevron-right recent-arrow"></i>
    </div>
  `;
  }).join('');

  container.querySelectorAll('.recent-icon img[data-amc-domain]').forEach(img => {
    const domain = img.getAttribute('data-amc-domain');
    const fallback = () => {
      const wrap = img.parentElement;
      wrap.classList.remove('has-logo');
      wrap.innerHTML = '<i class="bi bi-piggy-bank"></i>';
    };
    if (typeof attachAmcLogoFallback === 'function' && typeof amcLogoUrl === 'function'){
      img.src = amcLogoUrl(domain, 0);
      attachAmcLogoFallback(img, domain, fallback);
    } else {
      img.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
      img.addEventListener('error', fallback);
    }
  });

  container.querySelectorAll('.recent-item').forEach(el => {
    el.addEventListener('click', () => {
      const code = el.getAttribute('data-code');
      const entry = getRecent().find(r => String(r.schemeCode) === String(code));
      if (entry){
        switchTab('search');
        searchInput.value = entry.schemeName;
        loadFundByCode(entry.schemeCode);
      }
    });
  });
}

document.getElementById('clearRecentBtn').addEventListener('click', () => {
  localStorage.removeItem(RECENT_KEY);
  renderRecentList();
});

