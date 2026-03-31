/* ============================================================
   main.js — Garrett Comer Athlete Profile
   Components:
     1. Real-time search filter on race name
     2. Year radio filter (All / 2025 / 2024 / 2023)
     3. Scroll-to-top button
============================================================ */

(function () {
  'use strict';

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
      var article    = li.querySelector('.race-card');
      if (!article) return;

      var name       = (article.dataset.name  || '').toLowerCase();
      var cardYear   = (article.dataset.year  || '');

      var matchSearch = query === '' || name.includes(query);
      var matchYear   = year  === 'all' || cardYear === year;

      var show = matchSearch && matchYear;
      li.hidden = !show;
      if (show) visible++;
    });

    if (noResults)    noResults.hidden = visible > 0;

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
    if (window.scrollY > 300) {
      scrollBtn.classList.add('visible');
    } else {
      scrollBtn.classList.remove('visible');
    }
  }, { passive: true });

  scrollBtn.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

}());
