/* ============================================================
   chart.js — Performance Trend Chart
   SI 338 Final Project

   Week 1 deliverables:
     1. Decision: Canvas API chosen over SVG (see note below)
     2. DOM data extraction — reads race times/dates from HTML
     3. Time string parsing — "16:43.8" → numeric seconds
     4. Basic chart structure — canvas, axes, grid lines, labels
   ============================================================

   WHY CANVAS OVER SVG:
   - Canvas draws everything as pixels via a 2D context API,
     making it straightforward to animate lines with
     requestAnimationFrame.
   - SVG creates DOM nodes for every data point (26 points × 3
     lines = many nodes), which is harder to animate smoothly.
   - Canvas redraws the whole frame each tick — ideal for the
     draw-on animation planned.
   - Accessibility is handled separately via an aria-label on
     the <canvas> and a visually-hidden <table> fallback.
============================================================ */

(function () {
  'use strict';

  /* ============================================================
     STEP 1 — READ RACE DATA FROM THE DOM
     Each race card has:
       data-year="2025"
       <time datetime="2025-11-08">
       <dd> containing the time string e.g. "16:44.5"
     We extract all three and build a structured array.
  ============================================================ */

  /**
   * parseTimeToSeconds
   * Converts a time string in "mm:ss.s" or "mm:ss" format
   * into a total number of seconds (float).
   *
   * Examples:
   *   "16:43.8"  →  1003.8
   *   "21:04.9"  →  1264.9
   *   "19:22"    →  1162.0
   *
   * Returns null if the string cannot be parsed (e.g. "N/A").
   */
  function parseTimeToSeconds(str) {
    // Strip any badge text like "PR" or "SR" — grab only the
    // first token that matches mm:ss or mm:ss.s
    var match = str.trim().match(/^(\d{1,2}):(\d{2})(\.\d+)?/);
    if (!match) return null;

    var minutes = parseInt(match[1], 10);
    var seconds = parseInt(match[2], 10);
    var fraction = match[3] ? parseFloat(match[3]) : 0;

    return minutes * 60 + seconds + fraction;
  }

  /**
   * formatSeconds
   * Converts total seconds back to "mm:ss.s" display string.
   * Used for Y-axis labels and tooltip display.
   */
  function formatSeconds(totalSeconds) {
    var mins = Math.floor(totalSeconds / 60);
    var secs = totalSeconds % 60;
    // Pad seconds to always show two digits before decimal
    var secStr = secs < 10
      ? '0' + secs.toFixed(1)
      : secs.toFixed(1);
    return mins + ':' + secStr;
  }

  /**
   * extractRaceData
   * Walks every .race-card in the DOM and returns a sorted
   * array of data objects ready for charting.
   *
   * Each object:
   * {
   *   name:    "MITCA Michigan Meet of Champions …",
   *   date:    "2025-11-08",          ← from <time datetime>
   *   dateObj: Date object,
   *   year:    "2025",                ← from data-year
   *   timeStr: "16:44.5",             ← raw string from <dd>
   *   timeSec: 1004.5                 ← parsed seconds
   * }
   *
   * Cards where the time cannot be parsed are skipped.
   */
  function extractRaceData() {
    var cards = Array.from(document.querySelectorAll('.race-card'));
    var data  = [];

    cards.forEach(function (card) {
      var year     = card.dataset.year || '';
      var timeEl   = card.querySelector('.race-dl dd:last-of-type');
      var timeNode = card.querySelector('.race-dl');
      var nameEl   = card.querySelector('.race-name');
      var dateEl   = card.querySelector('time[datetime]');

      if (!timeEl || !dateEl || !nameEl) return;

      // The time <dd> may contain a badge span — get only text
      // content that belongs to the dd itself, not child spans
      var rawText  = timeEl.textContent.trim();
      var timeSec  = parseTimeToSeconds(rawText);
      if (timeSec === null) return;

      // Extract the clean time string (before any badge text)
      var timeStr  = rawText.match(/^[\d:\.]+/) ?
                     rawText.match(/^[\d:\.]+/)[0].trim() :
                     rawText;

      var dateStr  = dateEl.getAttribute('datetime'); // "2025-11-08"
      var dateObj  = new Date(dateStr + 'T00:00:00'); // avoid TZ shift

      data.push({
        name:    nameEl.textContent.trim(),
        date:    dateStr,
        dateObj: dateObj,
        year:    year,
        timeStr: timeStr,
        timeSec: timeSec
      });
    });

    // Sort chronologically (oldest first) for left-to-right plot
    data.sort(function (a, b) { return a.dateObj - b.dateObj; });
    return data;
  }

  /* ============================================================
     STEP 2 — BUILD ACCESSIBLE FALLBACK TABLE
     Populates the visually-hidden <table> so screen readers
     can access the same data the chart visualises.
  ============================================================ */
  function buildFallbackTable(data) {
    var tbody = document.getElementById('chart-table-body');
    if (!tbody) return;

    data.forEach(function (d) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + d.name    + '</td>' +
        '<td>' + d.date    + '</td>' +
        '<td>' + d.timeStr + '</td>' +
        '<td>' + d.year    + '</td>';
      tbody.appendChild(tr);
    });
  }

  /* ============================================================
     STEP 3 — CANVAS CHART
     Draws:
       • Background fill
       • Horizontal grid lines
       • Y-axis labels (time values)
       • X-axis labels (year markers)
       • Data points and connecting lines per season
  ============================================================ */

  // Season colours — match site palette
  var SEASON_COLORS = {
    '2023': '#b04500',   // orange  (badge-sr colour)
    '2024': '#1a7a40',   // green   (badge-pr colour)
    '2025': '#003d8f'    // navy    (accent colour)
  };

  // Chart layout constants (in logical px, scaled by devicePixelRatio)
  var PAD_TOP    = 24;
  var PAD_RIGHT  = 24;
  var PAD_BOTTOM = 48;  // room for X-axis labels
  var PAD_LEFT   = 72;  // room for Y-axis labels

  var canvas, ctx;
  var allData    = [];
  var hitTargets = []; // used in Week 2 for tooltip hit-testing

  /**
   * getCSSVar — reads a CSS custom property from :root
   */
  function getCSSVar(name) {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(name).trim();
  }

  /**
   * setupCanvas
   * Sets the canvas pixel dimensions accounting for
   * devicePixelRatio so it looks sharp on retina screens.
   */
  function setupCanvas() {
    var dpr    = window.devicePixelRatio || 1;
    var rect   = canvas.parentElement.getBoundingClientRect();
    var width  = Math.floor(rect.width);
    var height = Math.max(260, Math.floor(width * 0.42)); // ~42% aspect

    canvas.width          = width  * dpr;
    canvas.height         = height * dpr;
    canvas.style.width    = width  + 'px';
    canvas.style.height   = height + 'px';
    ctx.scale(dpr, dpr);

    return { width: width, height: height };
  }

  /**
   * computeScale
   * Works out the min/max seconds from the data and returns
   * helper functions to map seconds → canvas Y coordinate
   * and date → canvas X coordinate.
   */
  function computeScale(data, dims) {
    var plotW = dims.width  - PAD_LEFT - PAD_RIGHT;
    var plotH = dims.height - PAD_TOP  - PAD_BOTTOM;

    // Y range: add a small buffer above fastest and below slowest
    var times   = data.map(function (d) { return d.timeSec; });
    var minTime = Math.min.apply(null, times) - 15;  // 15s buffer
    var maxTime = Math.max.apply(null, times) + 30;  // 30s buffer

    // X range: first and last date in dataset
    var dates   = data.map(function (d) { return d.dateObj.getTime(); });
    var minDate = Math.min.apply(null, dates);
    var maxDate = Math.max.apply(null, dates);
    // Add 2-week padding left and right
    var datePad = 14 * 24 * 60 * 60 * 1000;
    minDate -= datePad;
    maxDate += datePad;

    function toX(dateObj) {
      var ratio = (dateObj.getTime() - minDate) / (maxDate - minDate);
      return PAD_LEFT + ratio * plotW;
    }

    function toY(sec) {
      // Note: higher seconds = lower on chart (slower time)
      // So maxTime maps to PAD_TOP (top of plot area)
      var ratio = (sec - minTime) / (maxTime - minTime);
      return PAD_TOP + plotH - ratio * plotH;
    }

    return {
      toX: toX, toY: toY,
      minTime: minTime, maxTime: maxTime,
      minDate: minDate, maxDate: maxDate,
      plotW: plotW, plotH: plotH
    };
  }

  /**
   * drawGrid
   * Draws horizontal grid lines and Y-axis time labels.
   * Grid lines are spaced every 60 seconds (1 minute).
   */
  function drawGrid(scale, dims) {
    var surfaceAlt = getCSSVar('--surface-alt') || '#ccd6e8';
    var mutedColor = getCSSVar('--muted')       || '#2e3e52';
    var textColor  = getCSSVar('--text')        || '#080d1c';

    ctx.font      = '11px Arial, sans-serif';
    ctx.textAlign = 'right';

    // Round minTime down to nearest 60s for clean grid start
    var gridStart = Math.floor(scale.minTime / 60) * 60;
    var gridEnd   = Math.ceil(scale.maxTime  / 60) * 60;

    for (var s = gridStart; s <= gridEnd; s += 60) {
      if (s < scale.minTime || s > scale.maxTime) continue;
      var y = scale.toY(s);

      // Grid line
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(dims.width - PAD_RIGHT, y);
      ctx.strokeStyle = surfaceAlt;
      ctx.lineWidth   = 1;
      ctx.stroke();

      // Y-axis label (time format)
      ctx.fillStyle = mutedColor;
      ctx.fillText(formatSeconds(s), PAD_LEFT - 8, y + 4);
    }

    // Y-axis title (rotated)
    ctx.save();
    ctx.translate(14, dims.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign  = 'center';
    ctx.font       = '11px Arial, sans-serif';
    ctx.fillStyle  = mutedColor;
    ctx.fillText('Race time', 0, 0);
    ctx.restore();
  }

  /**
   * drawXAxisLabels
   * Places year labels centered under the first race of each year.
   */
  function drawXAxisLabels(data, scale, dims) {
    var mutedColor = getCSSVar('--muted') || '#2e3e52';
    ctx.font      = '11px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = mutedColor;

    // Find the first data point per year and label its X position
    var labeled = {};
    data.forEach(function (d) {
      if (!labeled[d.year]) {
        labeled[d.year] = true;
        var x = scale.toX(d.dateObj);
        ctx.fillText(d.year, x, dims.height - PAD_BOTTOM + 18);
      }
    });
  }

  /**
   * drawAxes
   * Draws the left (Y) and bottom (X) axis lines.
   */
  function drawAxes(scale, dims) {
    var borderColor = getCSSVar('--border') || '#7a96b4';
    ctx.strokeStyle = borderColor;
    ctx.lineWidth   = 1.5;

    // Y axis
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, PAD_TOP);
    ctx.lineTo(PAD_LEFT, dims.height - PAD_BOTTOM);
    ctx.stroke();

    // X axis
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, dims.height - PAD_BOTTOM);
    ctx.lineTo(dims.width - PAD_RIGHT, dims.height - PAD_BOTTOM);
    ctx.stroke();
  }

  /**
   * drawSeriesLines
   * Draws a line connecting all data points for each season year,
   * then draws filled circles at each data point.
   * Stores hit targets for tooltip use in Week 2.
   */
  function drawSeriesLines(data, scale) {
    hitTargets = []; // reset

    var years = ['2023', '2024', '2025'];

    years.forEach(function (year) {
      var series = data.filter(function (d) { return d.year === year; });
      if (series.length === 0) return;

      var color = SEASON_COLORS[year] || '#666';

      // Draw connecting line
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2.5;
      ctx.lineJoin    = 'round';

      series.forEach(function (d, i) {
        var x = scale.toX(d.dateObj);
        var y = scale.toY(d.timeSec);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();

      // Draw data point circles
      series.forEach(function (d) {
        var x = scale.toX(d.dateObj);
        var y = scale.toY(d.timeSec);
        var r = 5;

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle   = color;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 1.5;
        ctx.stroke();

        // Store hit target for tooltip (Week 2)
        hitTargets.push({
          x:       x,
          y:       y,
          r:       r + 6, // slightly larger hit area
          name:    d.name,
          timeStr: d.timeStr,
          date:    d.date,
          year:    d.year,
          color:   color
        });
      });
    });
  }

  /**
   * drawChart
   * Master draw function — clears and redraws everything.
   * Called on init and on every resize.
   */
  function drawChart() {
    if (!canvas || !ctx || allData.length === 0) return;

    var surfaceColor = getCSSVar('--surface') || '#ffffff';
    var dims         = setupCanvas();
    var scale        = computeScale(allData, dims);

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    ctx.fillStyle = surfaceColor;
    ctx.fillRect(0, 0, dims.width, dims.height);

    // Draw layers in order
    drawGrid(scale, dims);
    drawAxes(scale, dims);
    drawXAxisLabels(allData, scale, dims);
    drawSeriesLines(allData, scale);
  }

  /* ============================================================
     STEP 4 — TOOLTIP (basic version, full version in Week 2)
     Shows race name, time, and date on hover/touch.
  ============================================================ */
  var tooltip     = document.getElementById('chart-tooltip');
  var tooltipName = document.getElementById('tooltip-name');
  var tooltipTime = document.getElementById('tooltip-time');
  var tooltipDate = document.getElementById('tooltip-date');

  function getCanvasPos(e) {
    var rect = canvas.getBoundingClientRect();
    var clientX = e.touches ? e.touches[0].clientX : e.clientX;
    var clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
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
    tooltipName.textContent = hit.name;
    tooltipTime.textContent = hit.timeStr;
    tooltipDate.textContent = hit.date;
    tooltip.hidden = false;
    tooltip.style.left = pos.x + 'px';
    tooltip.style.top  = pos.y + 'px';
  }

  function hideTooltip() {
    tooltip.hidden = true;
  }

  if (canvas) {
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

    // Touch support
    canvas.addEventListener('touchstart', function (e) {
      e.preventDefault();
      var pos = getCanvasPos(e);
      var hit = findHit(pos);
      if (hit) showTooltip(hit, pos);
    }, { passive: false });

    canvas.addEventListener('touchend', function () {
      setTimeout(hideTooltip, 1800);
    });
  }

  /* ============================================================
     STEP 5 — RESPONSIVE REDRAW
     Uses ResizeObserver to redraw the chart whenever the
     chart container changes width (e.g. sidebar opens,
     window resized). Falls back to window resize event.
  ============================================================ */
  function initResize() {
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function () { drawChart(); });
      ro.observe(canvas.parentElement);
    } else {
      window.addEventListener('resize', drawChart);
    }
  }

  /* ============================================================
     INIT — runs after DOM is ready
  ============================================================ */
  function init() {
    canvas = document.getElementById('trend-chart');
    if (!canvas) return;

    ctx     = canvas.getContext('2d');
    allData = extractRaceData();

    if (allData.length === 0) {
      // No data found — hide the chart section gracefully
      var section = canvas.closest('section');
      if (section) section.hidden = true;
      return;
    }

    buildFallbackTable(allData);
    drawChart();
    initResize();
  }

  // Run after the full DOM including scripts has parsed
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
