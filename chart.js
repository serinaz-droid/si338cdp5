/* ============================================================
   chart.js — Performance Trend Chart
   SI 338 Final Project — Serina Zou

   Week 1:
     1. Canvas API chosen over SVG
     2. DOM data extraction
     3. Time string parsing ("16:43.8" → seconds)
     4. Basic chart: canvas, axes, grid lines, labels

   Week 2:
     5. Season tab UI (replaces date-based X axis bunching)
     6. Index-based X axis so each season fills the full width
     7. Draw-on animation with requestAnimationFrame
     8. prefers-reduced-motion support
     9. Tooltip positioned near the hovered point (not fixed)
    10. Delta vs previous race in tooltip
    11. Cross-year delta: first race of season vs prior year avg
    12. Regression (trend) line per season
    13. ResizeObserver for responsive redraws
    14. Click data point → scroll to race card + highlight
    15. Dark mode awareness via matchMedia
============================================================ */

(function () {
  'use strict';

  /* ============================================================
     STEP 1 — TIME PARSING UTILITIES
  ============================================================ */

  function parseTimeToSeconds(str) {
    var match = str.trim().match(/^(\d{1,2}):(\d{2})(\.\d+)?/);
    if (!match) return null;
    var minutes  = parseInt(match[1], 10);
    var seconds  = parseInt(match[2], 10);
    var fraction = match[3] ? parseFloat(match[3]) : 0;
    return minutes * 60 + seconds + fraction;
  }

  function formatSeconds(totalSeconds) {
    var mins   = Math.floor(totalSeconds / 60);
    var secs   = totalSeconds % 60;
    var secStr = secs < 10 ? '0' + secs.toFixed(1) : secs.toFixed(1);
    return mins + ':' + secStr;
  }

  function formatDelta(deltaSec) {
    var sign   = deltaSec < 0 ? '-' : '+';
    var abs    = Math.abs(deltaSec);
    var mins   = Math.floor(abs / 60);
    var secs   = abs % 60;
    var secStr = secs < 10 ? '0' + secs.toFixed(1) : secs.toFixed(1);
    return sign + mins + ':' + secStr;
  }

  /* ============================================================
     STEP 2 — DOM DATA EXTRACTION
  ============================================================ */

  function extractRaceData() {
    var cards = Array.from(document.querySelectorAll('.race-card'));
    var data  = [];

    cards.forEach(function (card) {
      var year   = card.dataset.year || '';
      var nameEl = card.querySelector('.race-name');
      var dateEl = card.querySelector('time[datetime]');

      // Find <dd> whose <dt> sibling says "Time"
      var timeEl = null;
      card.querySelectorAll('.race-dl div').forEach(function (div) {
        var dt = div.querySelector('dt');
        if (dt && dt.textContent.trim().toLowerCase() === 'time') {
          timeEl = div.querySelector('dd');
        }
      });

      if (!nameEl || !dateEl || !timeEl) return;

      var rawText = timeEl.textContent.trim();
      var timeSec = parseTimeToSeconds(rawText);
      if (timeSec === null) return;

      var timeStr = rawText.match(/^[\d:.]+/)
        ? rawText.match(/^[\d:.]+/)[0].trim()
        : rawText;

      var dateStr = dateEl.getAttribute('datetime');
      var dateObj = new Date(dateStr + 'T00:00:00');
      var cardId  = card.getAttribute('aria-labelledby') || '';

      data.push({
        name:     nameEl.textContent.trim(),
        date:     dateStr,
        dateObj:  dateObj,
        year:     year,
        timeStr:  timeStr,
        timeSec:  timeSec,
        delta:    null,   // vs previous race in same season
        deltaStr: '',
        crossDelta:    null,  // first race only: vs prior year avg
        crossDeltaStr: '',
        cardId:   cardId
      });
    });

    // Sort chronologically
    data.sort(function (a, b) { return a.dateObj - b.dateObj; });

    // Group by year
    var byYear = {};
    data.forEach(function (d) {
      if (!byYear[d.year]) byYear[d.year] = [];
      byYear[d.year].push(d);
    });

    // Compute within-season delta (vs previous race in same season)
    Object.keys(byYear).forEach(function (yr) {
      byYear[yr].forEach(function (d, i) {
        if (i === 0) return;
        var prev  = byYear[yr][i - 1];
        d.delta    = d.timeSec - prev.timeSec;
        d.deltaStr = formatDelta(d.delta);
      });
    });

    // Compute cross-year delta for first race of each season
    // vs the average time of the previous season
    var years = Object.keys(byYear).sort();
    years.forEach(function (yr, yi) {
      if (yi === 0) return; // no previous year for first season
      var prevYear   = years[yi - 1];
      var prevTimes  = byYear[prevYear].map(function (d) { return d.timeSec; });
      var prevAvg    = prevTimes.reduce(function (s, v) { return s + v; }, 0) / prevTimes.length;
      var first      = byYear[yr][0];
      first.crossDelta    = first.timeSec - prevAvg;
      first.crossDeltaStr = formatDelta(first.crossDelta);
    });

    return data;
  }

  /* ============================================================
     STEP 3 — ACCESSIBLE FALLBACK TABLE
  ============================================================ */
  function buildFallbackTable(data) {
    var tbody = document.getElementById('chart-table-body');
    if (!tbody) return;

    var thead = document.querySelector('#chart-table thead tr');
    if (thead && !thead.querySelector('.delta-col')) {
      var th = document.createElement('th');
      th.scope = 'col'; th.className = 'delta-col';
      th.textContent = 'vs Previous';
      thead.appendChild(th);
    }

    data.forEach(function (d) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + d.name                       + '</td>' +
        '<td>' + d.date                       + '</td>' +
        '<td>' + d.timeStr                    + '</td>' +
        '<td>' + d.year                       + '</td>' +
        '<td>' + (d.deltaStr || 'First race') + '</td>';
      tbody.appendChild(tr);
    });
  }

  /* ============================================================
     CHART STATE
  ============================================================ */
  var SEASON_COLORS = {
    '2023': '#e05a00',   // vivid orange
    '2024': '#1a7a40',   // green
    '2025': '#1a6fff'    // blue
  };

  var PAD_TOP    = 30;
  var PAD_RIGHT  = 20;
  var PAD_BOTTOM = 56;
  var PAD_LEFT   = 68;

  var canvas, ctx;
  var allData    = [];
  var hitTargets = [];
  var activeYear = '2025'; // default tab shown

  // Animation state
  var ANIM_DURATION = 1200;
  var animStartTime = null;
  var animFrameId   = null;
  var reducedMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  function getCSSVar(name) {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(name).trim();
  }

  /* ============================================================
     STEP 4 — CANVAS SETUP (devicePixelRatio aware)
  ============================================================ */
  function setupCanvas() {
    var dpr    = window.devicePixelRatio || 1;
    var parent = canvas.parentElement;
    var width  = Math.floor(parent.getBoundingClientRect().width || parent.offsetWidth || 600);
    var height = Math.max(240, Math.floor(width * 0.42));

    canvas.width        = width  * dpr;
    canvas.height       = height * dpr;
    canvas.style.width  = width  + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(dpr, dpr);

    return { width: width, height: height };
  }

  /* ============================================================
     SCALE — index-based X axis
     X position is derived from the race's index within the
     season (0, 1, 2 …) NOT from the calendar date.
     This spreads races evenly across the full chart width
     regardless of how close together the dates are.
  ============================================================ */
  function computeScale(series, dims) {
    var plotW = dims.width  - PAD_LEFT - PAD_RIGHT;
    var plotH = dims.height - PAD_TOP  - PAD_BOTTOM;

    var times   = series.map(function (d) { return d.timeSec; });
    var minTime = Math.min.apply(null, times) - 20;
    var maxTime = Math.max.apply(null, times) + 30;

    var n = series.length;

    // toX: evenly space n points across plotW
    function toX(i) {
      if (n === 1) return PAD_LEFT + plotW / 2;
      return PAD_LEFT + (i / (n - 1)) * plotW;
    }

    function toY(sec) {
      var ratio = (sec - minTime) / (maxTime - minTime);
      return PAD_TOP + plotH - ratio * plotH;
    }

    return { toX: toX, toY: toY,
             minTime: minTime, maxTime: maxTime,
             plotW: plotW, plotH: plotH, n: n };
  }

  /* ============================================================
     DRAW HELPERS
  ============================================================ */

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

    // Rotated Y-axis label
    ctx.save();
    ctx.translate(12, dims.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.font      = '11px Arial, sans-serif';
    ctx.fillStyle = mutedColor;
    ctx.fillText('Race time (lower = faster)', 0, 0);
    ctx.restore();
  }

  function drawAxes(dims) {
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

  function drawXLabels(series, scale, dims) {
    var mutedColor = getCSSVar('--muted') || '#2e3e52';
    ctx.font      = '10px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = mutedColor;

    series.forEach(function (d, i) {
      var x = scale.toX(i);
      // Show shortened race label: "Race N"
      ctx.fillText('Race ' + (i + 1), x, dims.height - PAD_BOTTOM + 16);
    });

    // Season label centred under all points
    var color = SEASON_COLORS[activeYear] || '#666';
    ctx.font      = '12px Arial, sans-serif';
    ctx.fontWeight = 'bold';
    ctx.fillStyle = color;
    var midX = PAD_LEFT + scale.plotW / 2;
    ctx.fillText(activeYear + ' Season', midX, dims.height - PAD_BOTTOM + 34);
  }

  /* ============================================================
     STEP 12 — REGRESSION LINE
     Uses least-squares linear regression over race index vs timeSec.
     Draws a dashed line showing the trend across the season.
     Slope < 0 means improving; slope > 0 means getting slower.
  ============================================================ */
  function drawRegressionLine(series, scale, color) {
    var n = series.length;
    if (n < 2) return;

    // Compute least-squares slope and intercept
    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    series.forEach(function (d, i) {
      sumX  += i;
      sumY  += d.timeSec;
      sumXY += i * d.timeSec;
      sumX2 += i * i;
    });
    var slope     = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    var intercept = (sumY - slope * sumX) / n;

    var x0 = scale.toX(0);
    var y0 = scale.toY(intercept);
    var x1 = scale.toX(n - 1);
    var y1 = scale.toY(slope * (n - 1) + intercept);

    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([6, 4]);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.5;
    ctx.globalAlpha = 0.6;
    ctx.stroke();
    ctx.restore();

    // Label the regression line at the right end
    var mutedColor = getCSSVar('--muted') || '#2e3e52';
    var improving  = slope < 0;
    ctx.font      = '10px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = improving ? '#1a7a40' : '#b04500';
    ctx.globalAlpha = 0.85;
    ctx.fillText(improving ? '↓ Improving' : '↑ Slowing', x1 + 4, y1 + 4);
    ctx.globalAlpha = 1;
  }

  /* ============================================================
     MAIN SERIES DRAW — with animation progress clip
  ============================================================ */
  function drawSeries(series, scale, color, progress) {
    hitTargets = [];
    var n      = series.length;

    // Clip to progress width (animation)
    var clipRight = PAD_LEFT + scale.plotW * progress;
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD_LEFT, 0, clipRight - PAD_LEFT, scale.plotH + PAD_TOP + 20);
    ctx.clip();

    // Connecting line
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2.5;
    ctx.lineJoin    = 'round';
    series.forEach(function (d, i) {
      var x = scale.toX(i);
      var y = scale.toY(d.timeSec);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Data point circles
    series.forEach(function (d, i) {
      var x = scale.toX(i);
      if (x > clipRight) return;

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
        x:             x,
        y:             y,
        r:             r + 8,  // generous hit area
        name:          d.name,
        timeStr:       d.timeStr,
        date:          d.date,
        year:          d.year,
        color:         color,
        delta:         d.delta,
        deltaStr:      d.deltaStr,
        crossDelta:    d.crossDelta,
        crossDeltaStr: d.crossDeltaStr,
        cardId:        d.cardId,
        isFirst:       (i === 0)
      });
    });

    ctx.restore();
  }

  /* ============================================================
     MASTER REDRAW
  ============================================================ */
  function redrawAt(progress) {
    if (!canvas || !ctx) return;

    var series = allData.filter(function (d) { return d.year === activeYear; });
    if (series.length === 0) return;

    var color        = SEASON_COLORS[activeYear] || '#003d8f';
    var surfaceColor = getCSSVar('--surface') || '#ffffff';
    var dims         = setupCanvas();
    var scale        = computeScale(series, dims);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = surfaceColor;
    ctx.fillRect(0, 0, dims.width, dims.height);

    drawGrid(scale, dims);
    drawAxes(dims);
    drawXLabels(series, scale, dims);
    drawRegressionLine(series, scale, color);
    drawSeries(series, scale, color, progress);
  }

  function drawChart() { redrawAt(1); }

  /* ============================================================
     ANIMATION LOOP
  ============================================================ */
  function drawFrame(timestamp) {
    if (!animStartTime) animStartTime = timestamp;
    var elapsed  = timestamp - animStartTime;
    var progress = Math.min(elapsed / ANIM_DURATION, 1);
    // Ease-out cubic
    var eased    = 1 - Math.pow(1 - progress, 3);
    redrawAt(eased);
    if (progress < 1) {
      animFrameId = requestAnimationFrame(drawFrame);
    }
  }

  function startAnimation() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    animStartTime = null;
    if (reducedMotion) {
      drawChart();
    } else {
      animFrameId = requestAnimationFrame(drawFrame);
    }
  }

  /* ============================================================
     STEP 5 — SEASON TAB UI
     Builds clickable tab buttons inside .chart-tabs container.
     Clicking a tab switches activeYear and replays the animation.
  ============================================================ */
  function buildSeasonTabs() {
    var container = document.getElementById('chart-tabs');
    if (!container) return;

    var years = ['2023', '2024', '2025'];

    years.forEach(function (yr) {
      var btn = document.createElement('button');
      btn.textContent    = yr;
      btn.className      = 'chart-tab';
      btn.dataset.year   = yr;
      btn.setAttribute('type', 'button');
      btn.setAttribute('aria-pressed', yr === activeYear ? 'true' : 'false');

      if (yr === activeYear) btn.classList.add('chart-tab--active');

      btn.addEventListener('click', function () {
        if (activeYear === yr) return;
        activeYear = yr;

        // Update all tab states
        container.querySelectorAll('.chart-tab').forEach(function (b) {
          var active = b.dataset.year === yr;
          b.classList.toggle('chart-tab--active', active);
          b.setAttribute('aria-pressed', active ? 'true' : 'false');
        });

        startAnimation();
      });

      container.appendChild(btn);
    });
  }

  /* ============================================================
     STEP 9 — TOOLTIP POSITIONED NEAR THE DATA POINT
     Tooltip appears above the hovered point and flips sides
     if it would overflow the right or top edge.
  ============================================================ */
  var tooltip      = document.getElementById('chart-tooltip');
  var tooltipName  = document.getElementById('tooltip-name');
  var tooltipTime  = document.getElementById('tooltip-time');
  var tooltipDate  = document.getElementById('tooltip-date');
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

  function showTooltip(hit) {
    if (!tooltip) return;

    tooltipName.textContent = hit.name;
    tooltipTime.textContent = hit.timeStr;
    tooltipDate.textContent = hit.date;

    if (tooltipDelta) {
      // First race of a season: show cross-year delta vs prior season avg
      if (hit.isFirst && hit.crossDelta !== null) {
        var faster = hit.crossDelta < 0;
        var prevYear = String(parseInt(hit.year, 10) - 1);
        tooltipDelta.textContent =
          hit.crossDeltaStr +
          (faster ? ' faster' : ' slower') +
          ' than ' + prevYear + ' avg';
        tooltipDelta.style.color = faster ? '#4ade80' : '#f87171';
      } else if (hit.delta !== null) {
        var fasterRace = hit.delta < 0;
        tooltipDelta.textContent =
          hit.deltaStr + (fasterRace ? ' vs prev race' : ' vs prev race');
        tooltipDelta.style.color = fasterRace ? '#4ade80' : '#f87171';
      } else {
        tooltipDelta.textContent = 'Season opener';
        tooltipDelta.style.color = 'rgba(255,255,255,0.55)';
      }
    }

    // Position tooltip near the data point
    // Default: above and centred on the point
    var canvasRect   = canvas.getBoundingClientRect();
    var wrapRect     = canvas.parentElement.getBoundingClientRect();
    var pointX       = canvasRect.left - wrapRect.left + hit.x;
    var pointY       = canvasRect.top  - wrapRect.top  + hit.y;

    tooltip.hidden = false;

    // Measure tooltip size after making it visible
    var tw = tooltip.offsetWidth  || 200;
    var th = tooltip.offsetHeight || 90;

    // Centre horizontally on the point, clamp to container edges
    var left = pointX - tw / 2;
    left = Math.max(4, Math.min(left, wrapRect.width - tw - 4));

    // Default: above the point with 14px gap
    var top = pointY - th - 14;
    // If it would go off the top, flip below the point
    if (top < 4) top = pointY + 14;

    tooltip.style.left = left + 'px';
    tooltip.style.top  = top  + 'px';
  }

  function hideTooltip() {
    if (tooltip) tooltip.hidden = true;
  }

  /* ============================================================
     STEP 14 — CLICK TO SCROLL + HIGHLIGHT CARD
  ============================================================ */
  function scrollToCard(hit) {
    if (!hit.cardId) return;
    var heading = document.getElementById(hit.cardId);
    if (!heading) return;
    var card = heading.closest('.race-card');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('chart-highlight');
    setTimeout(function () { card.classList.remove('chart-highlight'); }, 1800);
  }

  /* ============================================================
     WIRE CANVAS EVENTS
  ============================================================ */
  function wireCanvasEvents() {
    canvas.addEventListener('mousemove', function (e) {
      var pos = getCanvasPos(e);
      var hit = findHit(pos);
      if (hit) {
        showTooltip(hit);
        canvas.style.cursor = 'pointer';
      } else {
        hideTooltip();
        canvas.style.cursor = 'crosshair';
      }
    });

    canvas.addEventListener('mouseleave', hideTooltip);

    canvas.addEventListener('click', function (e) {
      var pos = getCanvasPos(e);
      var hit = findHit(pos);
      if (hit) scrollToCard(hit);
    });

    canvas.addEventListener('touchstart', function (e) {
      e.preventDefault();
      var pos = getCanvasPos(e);
      var hit = findHit(pos);
      if (hit) { showTooltip(hit); scrollToCard(hit); }
    }, { passive: false });

    canvas.addEventListener('touchend', function () {
      setTimeout(hideTooltip, 2000);
    });
  }

  /* ============================================================
     STEP 13 — RESPONSIVE REDRAW
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
     STEP 15 — DARK MODE LISTENER
  ============================================================ */
  function initDarkModeWatch() {
    if (!window.matchMedia) return;
    window.matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', drawChart);
  }

  /* ============================================================
     INIT
  ============================================================ */
  function init() {
    canvas = document.getElementById('trend-chart');
    if (!canvas) {
      console.warn('chart.js: #trend-chart canvas not found');
      return;
    }

    ctx     = canvas.getContext('2d');
    allData = extractRaceData();

    console.log('chart.js: extracted', allData.length, 'races');

    if (allData.length === 0) {
      var section = canvas.closest('section');
      if (section) section.hidden = true;
      return;
    }

    buildFallbackTable(allData);
    buildSeasonTabs();
    wireCanvasEvents();
    initResize();
    initDarkModeWatch();
    startAnimation();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
