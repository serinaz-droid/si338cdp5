/* ============================================================
   chart.js — Performance Trend Chart
   SI 338 Final Project — Serina Zou

   Week 1:
     1. Canvas API chosen over SVG
     2. DOM data extraction
     3. Time string parsing ("16:43.8" → seconds)
     4. Basic chart: canvas, axes, grid lines, labels

   Week 2:
     5. Performance delta (faster/slower vs previous race)
     6. Draw-on animation with requestAnimationFrame
     7. prefers-reduced-motion support
     8. Enhanced tooltip: race name, date, time, delta
     9. Touch support for mobile tooltip
    10. ResizeObserver for responsive redraws
    11. Filter pill sync (year pills highlight chart season)
    12. Click data point → scroll to race card + highlight
    13. Dark mode awareness via matchMedia
============================================================ */

(function () {
  'use strict';

  /* ============================================================
     WEEK 1 — STEP 1
     TIME PARSING UTILITIES
  ============================================================ */

  /**
   * parseTimeToSeconds
   * "16:43.8" → 1003.8 seconds
   * Returns null if the string cannot be parsed.
   */
  function parseTimeToSeconds(str) {
    var match = str.trim().match(/^(\d{1,2}):(\d{2})(\.\d+)?/);
    if (!match) return null;
    var minutes  = parseInt(match[1], 10);
    var seconds  = parseInt(match[2], 10);
    var fraction = match[3] ? parseFloat(match[3]) : 0;
    return minutes * 60 + seconds + fraction;
  }

  /**
   * formatSeconds
   * 1003.8 → "16:43.8"
   * Used for axis labels and tooltip display.
   */
  function formatSeconds(totalSeconds) {
    var mins   = Math.floor(totalSeconds / 60);
    var secs   = totalSeconds % 60;
    var secStr = secs < 10
      ? '0' + secs.toFixed(1)
      : secs.toFixed(1);
    return mins + ':' + secStr;
  }

  /**
   * formatDelta
   * Converts a delta in seconds to a signed display string.
   * Negative = faster (improvement), positive = slower.
   * e.g. -16.7 → "-0:16.7"  |  +12.3 → "+0:12.3"
   */
  function formatDelta(deltaSec) {
    var sign   = deltaSec < 0 ? '-' : '+';
    var abs    = Math.abs(deltaSec);
    var mins   = Math.floor(abs / 60);
    var secs   = abs % 60;
    var secStr = secs < 10
      ? '0' + secs.toFixed(1)
      : secs.toFixed(1);
    return sign + mins + ':' + secStr;
  }

  /* ============================================================
     WEEK 1 — STEP 2
     DOM DATA EXTRACTION
     Reads race data directly from existing HTML race cards.
  ============================================================ */

  /**
   * extractRaceData
   * Returns a chronologically sorted array of race objects:
   * {
   *   name, date, dateObj, year,
   *   timeStr, timeSec,
   *   delta,      ← seconds vs previous race (null for first)
   *   deltaStr,   ← formatted delta string e.g. "-0:16.7"
   *   cardId      ← aria-labelledby value for scroll targeting
   * }
   */
  function extractRaceData() {
    var cards = Array.from(document.querySelectorAll('.race-card'));
    var data  = [];

    cards.forEach(function (card) {
      var year   = card.dataset.year || '';
      var nameEl = card.querySelector('.race-name');
      var dateEl = card.querySelector('time[datetime]');
      var timeEl = card.querySelector('.race-dl dd:last-of-type');

      if (!nameEl || !dateEl || !timeEl) return;

      // .textContent includes badge text ("PR"/"SR") — regex strips it
      var rawText = timeEl.textContent.trim();
      var timeSec = parseTimeToSeconds(rawText);
      if (timeSec === null) return;

      var timeStr = rawText.match(/^[\d:.]+/)
        ? rawText.match(/^[\d:.]+/)[0].trim()
        : rawText;

      var dateStr = dateEl.getAttribute('datetime');
      var dateObj = new Date(dateStr + 'T00:00:00');

      // card's aria-labelledby points to the h3 id (e.g. "r1")
      var cardId = card.getAttribute('aria-labelledby') || '';

      data.push({
        name:     nameEl.textContent.trim(),
        date:     dateStr,
        dateObj:  dateObj,
        year:     year,
        timeStr:  timeStr,
        timeSec:  timeSec,
        delta:    null,
        deltaStr: '',
        cardId:   cardId
      });
    });

    // Sort chronologically oldest → newest
    data.sort(function (a, b) { return a.dateObj - b.dateObj; });

    /* ============================================================
       WEEK 2 — STEP 5
       PERFORMANCE DELTA COMPUTATION
       For each race, compute how many seconds faster or slower
       it was compared to the immediately preceding race.
       Negative delta = improvement (faster).
       Positive delta = regression (slower).
    ============================================================ */
    data.forEach(function (d, i) {
      if (i === 0) return; // first race has no previous
      var prev     = data[i - 1];
      var deltaSec = d.timeSec - prev.timeSec;
      d.delta    = deltaSec;
      d.deltaStr = formatDelta(deltaSec);
    });

    return data;
  }

  /* ============================================================
     WEEK 1 — STEP 3
     ACCESSIBLE FALLBACK TABLE
     Populates the visually-hidden <table> with all race data
     including the delta column so screen readers get everything.
  ============================================================ */
  function buildFallbackTable(data) {
    var tbody = document.getElementById('chart-table-body');
    if (!tbody) return;

    // Add delta column header
    var thead = document.querySelector('#chart-table thead tr');
    if (thead && !thead.querySelector('.delta-col')) {
      var th = document.createElement('th');
      th.scope       = 'col';
      th.className   = 'delta-col';
      th.textContent = 'vs Previous';
      thead.appendChild(th);
    }

    data.forEach(function (d) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + d.name                        + '</td>' +
        '<td>' + d.date                        + '</td>' +
        '<td>' + d.timeStr                     + '</td>' +
        '<td>' + d.year                        + '</td>' +
        '<td>' + (d.deltaStr || 'First race')  + '</td>';
      tbody.appendChild(tr);
    });
  }

  /* ============================================================
     CHART CONSTANTS AND STATE
  ============================================================ */
  var SEASON_COLORS = {
    '2023': '#b04500',
    '2024': '#1a7a40',
    '2025': '#003d8f'
  };

  var PAD_TOP    = 24;
  var PAD_RIGHT  = 24;
  var PAD_BOTTOM = 48;
  var PAD_LEFT   = 72;

  var canvas, ctx;
  var allData      = [];
  var hitTargets   = [];
  var activeYear   = 'all'; // tracks current filter pill selection

  /* ============================================================
     WEEK 2 — STEP 13
     DARK MODE AWARENESS
     Reads CSS custom properties at draw time so colors are
     always correct in both light and dark mode.
     Also sets up a matchMedia listener to redraw when the
     system color scheme changes.
  ============================================================ */
  function getCSSVar(name) {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(name).trim();
  }

  /* ============================================================
     WEEK 1 — STEP 4
     CANVAS SETUP
     devicePixelRatio scaling for sharp retina rendering.
  ============================================================ */
  function setupCanvas() {
    var dpr    = window.devicePixelRatio || 1;
    var rect   = canvas.parentElement.getBoundingClientRect();
    var width  = Math.floor(rect.width);
    var height = Math.max(260, Math.floor(width * 0.44));

    canvas.width        = width  * dpr;
    canvas.height       = height * dpr;
    canvas.style.width  = width  + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(dpr, dpr);

    return { width: width, height: height };
  }

  /**
   * computeScale
   * Maps timeSec values to canvas Y coordinates and
   * dateObj values to canvas X coordinates.
   */
  function computeScale(data, dims) {
    var plotW = dims.width  - PAD_LEFT - PAD_RIGHT;
    var plotH = dims.height - PAD_TOP  - PAD_BOTTOM;

    var times   = data.map(function (d) { return d.timeSec; });
    var minTime = Math.min.apply(null, times) - 15;
    var maxTime = Math.max.apply(null, times) + 30;

    var dates   = data.map(function (d) { return d.dateObj.getTime(); });
    var minDate = Math.min.apply(null, dates);
    var maxDate = Math.max.apply(null, dates);
    var datePad = 14 * 24 * 60 * 60 * 1000;
    minDate -= datePad;
    maxDate += datePad;

    function toX(dateObj) {
      var ratio = (dateObj.getTime() - minDate) / (maxDate - minDate);
      return PAD_LEFT + ratio * plotW;
    }

    function toY(sec) {
      var ratio = (sec - minTime) / (maxTime - minTime);
      return PAD_TOP + plotH - ratio * plotH;
    }

    return { toX: toX, toY: toY,
             minTime: minTime, maxTime: maxTime,
             plotW: plotW, plotH: plotH };
  }

  /* ---- draw helpers ---- */

  function drawGrid(scale, dims) {
    var surfaceAlt = getCSSVar('--surface-alt') || '#ccd6e8';
    var mutedColor = getCSSVar('--muted')       || '#2e3e52';

    ctx.font      = '11px Arial, sans-serif';
    ctx.textAlign = 'right';

    var gridStart = Math.floor(scale.minTime / 60) * 60;
    var gridEnd   = Math.ceil(scale.maxTime  / 60) * 60;

    for (var s = gridStart; s <= gridEnd; s += 60) {
      if (s < scale.minTime || s > scale.maxTime) continue;
      var y = scale.toY(s);

      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(dims.width - PAD_RIGHT, y);
      ctx.strokeStyle = surfaceAlt;
      ctx.lineWidth   = 1;
      ctx.stroke();

      ctx.fillStyle = mutedColor;
      ctx.fillText(formatSeconds(s), PAD_LEFT - 8, y + 4);
    }

    // Rotated Y-axis title
    ctx.save();
    ctx.translate(14, dims.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.font      = '11px Arial, sans-serif';
    ctx.fillStyle = mutedColor;
    ctx.fillText('Race time', 0, 0);
    ctx.restore();
  }

  function drawAxes(scale, dims) {
    var borderColor = getCSSVar('--border') || '#7a96b4';
    ctx.strokeStyle = borderColor;
    ctx.lineWidth   = 1.5;

    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, PAD_TOP);
    ctx.lineTo(PAD_LEFT, dims.height - PAD_BOTTOM);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, dims.height - PAD_BOTTOM);
    ctx.lineTo(dims.width - PAD_RIGHT, dims.height - PAD_BOTTOM);
    ctx.stroke();
  }

  function drawXAxisLabels(data, scale, dims) {
    var mutedColor = getCSSVar('--muted') || '#2e3e52';
    ctx.font      = '11px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = mutedColor;

    var labeled = {};
    data.forEach(function (d) {
      if (!labeled[d.year]) {
        labeled[d.year] = true;
        var x = scale.toX(d.dateObj);
        ctx.fillText(d.year, x, dims.height - PAD_BOTTOM + 18);
      }
    });
  }

  /* ============================================================
     WEEK 2 — STEP 6
     DRAW-ON ANIMATION with requestAnimationFrame
     The lines draw themselves left to right on page load.
     `progress` goes from 0 → 1 over ANIM_DURATION ms.
     Each frame we clip the canvas to the left portion that
     corresponds to the current progress, then draw normally.
  ============================================================ */
  var ANIM_DURATION  = 1400; // ms for full draw
  var animStartTime  = null;
  var animFrameId    = null;
  var animComplete   = false;

  /* ============================================================
     WEEK 2 — STEP 7
     prefers-reduced-motion CHECK
     If the user has reduced motion enabled, skip the animation
     entirely and draw the chart fully on the first frame.
  ============================================================ */
  var reducedMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  /**
   * drawSeriesLines
   * Draws season lines and circles.
   * progress (0–1): how far across the chart to draw.
   * Dimmed series are drawn at low opacity when a year filter
   * is active (Week 2 — Step 11).
   */
  function drawSeriesLines(data, scale, progress) {
    hitTargets = [];
    var years  = ['2023', '2024', '2025'];
    var plotW  = scale.plotW;

    years.forEach(function (year) {
      var series = data.filter(function (d) { return d.year === year; });
      if (series.length === 0) return;

      var color   = SEASON_COLORS[year] || '#666';
      // Dim seasons not matching the active filter
      var dimmed  = (activeYear !== 'all' && activeYear !== year);
      ctx.globalAlpha = dimmed ? 0.18 : 1;

      // Clip drawing to the animated progress width
      var clipRight = PAD_LEFT + plotW * progress;

      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD_LEFT, 0, clipRight - PAD_LEFT, scale.plotH + PAD_TOP + 10);
      ctx.clip();

      // Connecting line
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2.5;
      ctx.lineJoin    = 'round';

      series.forEach(function (d, i) {
        var x = scale.toX(d.dateObj);
        var y = scale.toY(d.timeSec);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Data point circles
      series.forEach(function (d) {
        var x = scale.toX(d.dateObj);
        if (x > clipRight) return; // not yet revealed

        var y = scale.toY(d.timeSec);
        var r = 5;

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle   = color;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 1.5;
        ctx.stroke();

        hitTargets.push({
          x:        x,
          y:        y,
          r:        r + 6,
          name:     d.name,
          timeStr:  d.timeStr,
          date:     d.date,
          year:     d.year,
          color:    color,
          delta:    d.delta,
          deltaStr: d.deltaStr,
          cardId:   d.cardId
        });
      });

      ctx.restore();
      ctx.globalAlpha = 1;
    });
  }

  /**
   * drawFrame
   * Called by requestAnimationFrame. Computes progress (0–1)
   * based on elapsed time and redraws the chart at that progress.
   */
  function drawFrame(timestamp) {
    if (!animStartTime) animStartTime = timestamp;
    var elapsed  = timestamp - animStartTime;
    var progress = Math.min(elapsed / ANIM_DURATION, 1);

    // Easing: ease-out cubic
    var eased = 1 - Math.pow(1 - progress, 3);

    redrawAt(eased);

    if (progress < 1) {
      animFrameId = requestAnimationFrame(drawFrame);
    } else {
      animComplete = true;
    }
  }

  /**
   * redrawAt
   * Redraws the entire chart at a given progress (0–1).
   * Used by both the animation loop and static redraws.
   */
  function redrawAt(progress) {
    if (!canvas || !ctx || allData.length === 0) return;

    var surfaceColor = getCSSVar('--surface') || '#ffffff';
    var dims         = setupCanvas();
    var scale        = computeScale(allData, dims);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = surfaceColor;
    ctx.fillRect(0, 0, dims.width, dims.height);

    drawGrid(scale, dims);
    drawAxes(scale, dims);
    drawXAxisLabels(allData, scale, dims);
    drawSeriesLines(allData, scale, progress);
  }

  /**
   * drawChart
   * Entry point for a full static draw (no animation).
   * Used on resize and filter change after animation is done.
   */
  function drawChart() {
    redrawAt(1);
  }

  /* ============================================================
     WEEK 2 — STEP 8 & 9
     ENHANCED TOOLTIP
     Shows: race name, date, time, delta vs previous race.
     Works on both mousemove (desktop) and touchstart (mobile).
  ============================================================ */
  var tooltip     = document.getElementById('chart-tooltip');
  var tooltipName = document.getElementById('tooltip-name');
  var tooltipTime = document.getElementById('tooltip-time');
  var tooltipDate = document.getElementById('tooltip-date');

  // Delta element — added to tooltip HTML in index.html (see below)
  var tooltipDelta = document.getElementById('tooltip-delta');

  function getCanvasPos(e) {
    var rect    = canvas.getBoundingClientRect();
    var clientX = e.touches ? e.touches[0].clientX : e.clientX;
    var clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function findHit(pos) {
    for (var i = hitTargets.length - 1; i >= 0; i--) {
      var t  = hitTargets[i];
      var dx = pos.x - t.x;
      var dy = pos.y - t.y;
      if (Math.sqrt(dx * dx + dy * dy) <= t.r) return t;
    }
    return null;
  }

  function showTooltip(hit, pos) {
    if (!tooltip) return;

    tooltipName.textContent = hit.name;
    tooltipTime.textContent = hit.timeStr;
    tooltipDate.textContent = hit.date;

    // Delta display with color coding
    if (tooltipDelta) {
      if (hit.delta === null) {
        tooltipDelta.textContent  = 'Season opener';
        tooltipDelta.style.color  = 'rgba(255,255,255,0.55)';
      } else {
        var faster = hit.delta < 0;
        tooltipDelta.textContent = hit.deltaStr + (faster ? ' faster' : ' slower');
        tooltipDelta.style.color = faster ? '#4ade80' : '#f87171';
      }
    }

    tooltip.hidden     = false;
    tooltip.style.left = pos.x + 'px';
    tooltip.style.top  = pos.y + 'px';
  }

  function hideTooltip() {
    if (tooltip) tooltip.hidden = true;
  }

  /* ============================================================
     WEEK 2 — STEP 12
     CLICK DATA POINT → SCROLL TO RACE CARD + HIGHLIGHT
     Clicking a data point finds the matching race card by its
     aria-labelledby id, scrolls it into view, and briefly
     adds a highlight class that pulses then fades.
  ============================================================ */
  function scrollToCard(hit) {
    if (!hit.cardId) return;

    // The h3 has id="r1" etc; the article is its parent's parent
    var heading = document.getElementById(hit.cardId);
    if (!heading) return;

    var card = heading.closest('.race-card');
    if (!card) return;

    card.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Add highlight class and remove it after animation
    card.classList.add('chart-highlight');
    setTimeout(function () {
      card.classList.remove('chart-highlight');
    }, 1800);
  }

  /* ============================================================
     WIRE UP CANVAS EVENTS
  ============================================================ */
  function wireCanvasEvents() {
    canvas.addEventListener('mousemove', function (e) {
      var pos = getCanvasPos(e);
      var hit = findHit(pos);
      if (hit) {
        showTooltip(hit, pos);
        canvas.style.cursor = 'pointer';
      } else {
        hideTooltip();
        canvas.style.cursor = 'crosshair';
      }
    });

    canvas.addEventListener('mouseleave', hideTooltip);

    // Click: scroll to card
    canvas.addEventListener('click', function (e) {
      var pos = getCanvasPos(e);
      var hit = findHit(pos);
      if (hit) scrollToCard(hit);
    });

    // Touch: show tooltip, auto-hide after 1.8s
    canvas.addEventListener('touchstart', function (e) {
      e.preventDefault();
      var pos = getCanvasPos(e);
      var hit = findHit(pos);
      if (hit) {
        showTooltip(hit, pos);
        scrollToCard(hit);
      }
    }, { passive: false });

    canvas.addEventListener('touchend', function () {
      setTimeout(hideTooltip, 1800);
    });
  }

  /* ============================================================
     WEEK 2 — STEP 11
     FILTER PILL SYNC
     When the user clicks a year pill, the chart dims the
     other two seasons so the selected year stands out.
     Reads the same radio buttons used by the race card filter.
  ============================================================ */
  function wireFilterSync() {
    document.querySelectorAll('input[name="season"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        activeYear = radio.value;
        drawChart();
      });
    });
  }

  /* ============================================================
     WEEK 2 — STEP 10
     RESPONSIVE REDRAW with ResizeObserver
  ============================================================ */
  function initResize() {
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function () {
        if (animFrameId) cancelAnimationFrame(animFrameId);
        animFrameId = null;
        drawChart();
      });
      ro.observe(canvas.parentElement);
    } else {
      window.addEventListener('resize', drawChart);
    }
  }

  /* ============================================================
     WEEK 2 — STEP 13
     DARK MODE LISTENER
     Redraws the chart when the system switches color scheme
     so all canvas colors update immediately.
  ============================================================ */
  function initDarkModeWatch() {
    if (!window.matchMedia) return;
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', function () { drawChart(); });
  }

  /* ============================================================
     INIT
  ============================================================ */
  function init() {
    canvas = document.getElementById('trend-chart');
    if (!canvas) return;

    ctx     = canvas.getContext('2d');
    allData = extractRaceData();

    if (allData.length === 0) {
      var section = canvas.closest('section');
      if (section) section.hidden = true;
      return;
    }

    buildFallbackTable(allData);
    wireCanvasEvents();
    wireFilterSync();
    initResize();
    initDarkModeWatch();

    // Start animation or draw static immediately
    if (reducedMotion) {
      // prefers-reduced-motion: draw fully, no animation
      drawChart();
    } else {
      animStartTime = null;
      animFrameId   = requestAnimationFrame(drawFrame);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
