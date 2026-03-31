

(function () {
  'use strict';

  var PLACEHOLDER_SVG = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">',
      '<rect width="800" height="450" fill="#ccd6e8"/>',
      /* camera body */
      '<rect x="300" y="170" width="200" height="140" rx="14" fill="#7a96b4"/>',
      /* lens outer ring */
      '<circle cx="400" cy="240" r="44" fill="#dce4f0"/>',
      /* lens inner */
      '<circle cx="400" cy="240" r="30" fill="#9aafc4"/>',
      '<circle cx="400" cy="240" r="16" fill="#7a96b4"/>',
      /* viewfinder bump */
      '<rect x="356" y="156" width="56" height="22" rx="7" fill="#7a96b4"/>',
      /* label */
      '<text x="400" y="348" font-family="Arial,sans-serif" font-size="18"',
        ' font-weight="600" fill="#3a4a5c" text-anchor="middle">',
        'No photo available',
      '</text>',
    '</svg>'
  ].join('');

  var PLACEHOLDER_URI = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(PLACEHOLDER_SVG);

  function applyPlaceholder(img) {
    // Prevent infinite loop if the placeholder itself somehow errors
    img.onerror = null;
    img.src     = PLACEHOLDER_URI;
    img.alt     = '';   // decorative — caption is in the card header
  }

  // Apply to every race image on the page
  document.querySelectorAll('img.race-img').forEach(function (img) {
    // If already broken (cached failure) handle immediately
    if (!img.complete || img.naturalWidth === 0) {
      img.addEventListener('error', function () { applyPlaceholder(img); });
    }
    // Also catch images that are already in an error state
    if (img.complete && img.naturalWidth === 0) {
      applyPlaceholder(img);
    }
  });

  /* ── ELEMENTS ───────────────────────────────────────── */
  var searchInput  = document.getElementById('race-search');
  var statusRegion = document.getElementById('race-status');
  var noResults    = document.getElementById('no-results');
  var raceItems    = Array.from(document.querySelectorAll('#race-list li'));

  /* ── 1 & 2. SEARCH + YEAR FILTER ───────────────────── */
  function getActiveYear() {
    var checked = document.querySelector('input[name="season"]:checked');
    return checked ? checked.value : 'all';
  }

  function applyFilters() {
    var query   = searchInput ? searchInput.value.trim().toLowerCase() : '';
    var year    = getActiveYear();
    var visible = 0;

    raceItems.forEach(function (li) {
      var article = li.querySelector('.race-card');
      if (!article) return;

      var name     = (article.dataset.name || '').toLowerCase();
      var cardYear = (article.dataset.year || '');

      var matchSearch = query === '' || name.includes(query);
      var matchYear   = year  === 'all' || cardYear === year;

      var show = matchSearch && matchYear;
      li.hidden = !show;
      if (show) visible++;
    });

    if (noResults) noResults.hidden = visible > 0;

    if (statusRegion) {
      statusRegion.textContent = visible === 0
        ? 'No races match your search.'
        : visible + ' race' + (visible === 1 ? '' : 's') + ' shown.';
    }
  }

  if (searchInput) {
    searchInput.addEventListener('input', applyFilters);
  }

  document.querySelectorAll('input[name="season"]').forEach(function (radio) {
    radio.addEventListener('change', applyFilters);
  });

  /* ── 3. SCROLL-TO-TOP BUTTON ────────────────────────── */
  var scrollBtn = document.createElement('button');
  scrollBtn.className   = 'scroll-top-btn';
  scrollBtn.textContent = '↑';
  scrollBtn.setAttribute('aria-label', 'Scroll back to top');
  document.body.appendChild(scrollBtn);

  window.addEventListener('scroll', function () {
    scrollBtn.classList.toggle('visible', window.scrollY > 300);
  }, { passive: true });

  scrollBtn.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

}());
