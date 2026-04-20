/* ============================================================
   chart.js — Performance Trend Chart
   SI 338 Final Project — Serina Zou

   Features:
   - One season displayed at a time (tab switches season)
   - Chart-only filter tabs (independent from race card filter)
   - Index-based X axis (races evenly spaced, no date bunching)
   - Draw-on animation with requestAnimationFrame
   - prefers-reduced-motion respected
   - Tooltip positioned near hovered point, never overflows edges
   - Delta vs previous race in tooltip
   - Cross-year delta on first race (vs prior season avg)
   - Dashed regression line per season
   - Grey horizontal average line per season
   - ResizeObserver for responsive redraws
   - Click point → scroll to race card + highlight
   - Dark mode aware
============================================================ */

(function () {
  'use strict';

  /* ============================================================
     TIME UTILITIES
  ============================================================ */
  function parseTimeToSeconds(str) {
    var match = str.trim().match(/^(\d{1,2}):(\d{2})(\.\d+)?/);
    if (!match) return null;
    return parseInt(match[1], 10) * 60 +
           parseInt(match[2], 10) +
           (match[3] ? parseFloat(match[3]) : 0);
  }

  function formatSeconds(s) {
    var m   = Math.floor(s / 60);
    var rem = s % 60;
    return m + ':' + (rem < 10 ? '0' : '') + rem.toFixed(1);
  }

  function formatDelta(d) {
    var sign = d < 0 ? '-' : '+';
    var abs  = Math.abs(d);
    var m    = Math.floor(abs / 60);
    var rem  = abs % 60;
    return sign + m + ':' + (rem < 10 ? '0' : '') + rem.toFixed(1);
  }

  /* ============================================================
     DOM DATA EXTRACTION
  ============================================================ */
  function extractRaceData() {
    var data = [];

    document.querySelectorAll('.race-card').forEach(function (card) {
      var year   = card.dataset.year || '';
      var nameEl = card.querySelector('.race-name');
      var dateEl = card.querySelector('time[datetime]');
      var timeEl = null;

      card.querySelectorAll('.race-dl div').forEach(function (div) {
        var dt = div.querySelector('dt');
        if (dt && dt.textContent.trim().toLowerCase() === 'time') {
          timeEl = div.querySelector('dd');
        }
      });

      if (!nameEl || !dateEl || !timeEl) return;

      var raw     = timeEl.textContent.trim();
      var timeSec = parseTimeToSeconds(raw);
      if (timeSec === null) return;

      var timeStr = (raw.match(/^[\d:.]+/) || [raw])[0].trim();
      var dateStr = dateEl.getAttribute('datetime');

      data.push({
        name:          nameEl.textContent.trim(),
        date:          dateStr,
        dateObj:       new Date(dateStr + 'T00:00:00'),
        year:          year,
        timeStr:       timeStr,
        timeSec:       timeSec,
        delta:         null,   // vs previous race same season
        deltaStr:      '',
        crossDelta:    null,   // first race: vs prior season avg
        crossDeltaStr: '',
        cardId:        card.getAttribute('aria-labelledby') || ''
      });
    });

    data.sort(function (a, b) { return a.dateObj - b.dateObj; });

    // Group by year
    var byYear = {};
    data.forEach(function (d) {
      if (!byYear[d.year]) byYear[d.year] = [];
      byYear[d.year].push(d);
    });

    // Within-season delta
    Object.keys(byYear).forEach(function (yr) {
      byYear[yr].forEach(function (d, i) {
        if (i === 0) return;
        d.delta    = d.timeSec - byYear[yr][i - 1].timeSec;
        d.deltaStr = formatDelta(d.delta);
      });
    });

    // Cross-year delta: first race of season vs prior season average
    var years = Object.keys(byYear).sort();
    years.forEach(function (yr, yi) {
      if (yi === 0) return;
      var prevTimes = byYear[years[yi - 1]].map(function (d) { return d.timeSec; });
      var prevAvg   = prevTimes.reduce(function (a, b) { return a + b; }, 0) / prevTimes.length;
      var first     = byYear[yr][0];
      first.crossDelta    = first.timeSec - prevAvg;
      first.crossDeltaStr = formatDelta(first.crossDelta);
    });

    return data;
  }

  /* ============================================================
     ACCESSIBLE FALLBACK TABLE
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
        '<td>' + d.year    + '</td>' +
        '<td>' + (d.deltaStr || 'Season opener') + '</td>';
      tbody.appendChild(tr);
    });
  }

  /* ============================================================
     CHART STATE
  ============================================================ */
  var COLORS = { '2023': '#e05a00', '2024': '#1a7a40', '2025': '#1a6fff' };

  var PAD_TOP    = 44;
  var PAD_RIGHT  = 72;
  var PAD_BOTTOM = 58;
  var PAD_LEFT   = 72;

  var canvas, ctx;
  var allData    = [];
  var hitTargets = [];
  var activeYear = '2025';

  var ANIM_DURATION = 1200;
  var animStart     = null;
  var animFrameId   = null;
  var reducedMotion = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function getCSSVar(v) {
    return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  }

  /* ============================================================
     CANVAS SETUP
  ============================================================ */
  function setupCanvas() {
    var dpr    = window.devicePixelRatio || 1;
    var parent = canvas.parentElement;
    var w      = Math.floor(parent.getBoundingClientRect().width || parent.offsetWidth || 600);
    var h      = Math.max(240, Math.floor(w * 0.44));

    canvas.width        = w * dpr;
    canvas.height       = h * dpr;
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);

    return { w: w, h: h };
  }

  /* ============================================================
     SCALE — index-based X, time-based Y
  ============================================================ */
  function computeScale(series, dims) {
    var plotW  = dims.w - PAD_LEFT - PAD_RIGHT;
    var plotH  = dims.h - PAD_TOP  - PAD_BOTTOM;
    var times  = series.map(function (d) { return d.timeSec; });
    var minT   = Math.min.apply(null, times) - 20;
    var maxT   = Math.max.apply(null, times) + 30;
    var n      = series.length;

    // Add horizontal padding so the first and last circles
    // don't sit right on the axis lines — 20px inset each side
    var POINT_PAD = 20;

    return {
      toX: function (i) {
        if (n === 1) return PAD_LEFT + plotW / 2;
        return PAD_LEFT + POINT_PAD + (i / (n - 1)) * (plotW - POINT_PAD * 2);
      },
      toY: function (sec) {
        return PAD_TOP + plotH - ((sec - minT) / (maxT - minT)) * plotH;
      },
      minT: minT, maxT: maxT, plotW: plotW, plotH: plotH, n: n
    };
  }

  /* ============================================================
     DRAW: GRID + AXES + LABELS
  ============================================================ */
  function drawGrid(sc, dims) {
    var surfAlt = getCSSVar('--surface-alt') || '#ccd6e8';
    var muted   = getCSSVar('--muted')       || '#2e3e52';

    ctx.font      = '11px Arial,sans-serif';
    ctx.textAlign = 'right';

    for (var s = Math.floor(sc.minT / 60) * 60; s <= Math.ceil(sc.maxT / 60) * 60; s += 60) {
      if (s < sc.minT || s > sc.maxT) continue;
      var y = sc.toY(s);
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(dims.w - PAD_RIGHT, y);
      ctx.strokeStyle = surfAlt;
      ctx.lineWidth   = 1;
      ctx.stroke();
      ctx.fillStyle = muted;
      ctx.fillText(formatSeconds(s), PAD_LEFT - 8, y + 4);
    }

    ctx.save();
    ctx.translate(13, dims.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.font      = '11px Arial,sans-serif';
    ctx.fillStyle = muted;
    ctx.fillText('Race time (lower = faster)', 0, 0);
    ctx.restore();
  }

  function drawAxes(dims) {
    var border = getCSSVar('--border') || '#7a96b4';
    ctx.strokeStyle = border;
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.moveTo(PAD_LEFT, PAD_TOP);
    ctx.lineTo(PAD_LEFT, dims.h - PAD_BOTTOM); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PAD_LEFT, dims.h - PAD_BOTTOM);
    ctx.lineTo(dims.w - PAD_RIGHT, dims.h - PAD_BOTTOM); ctx.stroke();
  }

  function drawXLabels(series, sc, dims, color) {
    var muted = getCSSVar('--muted') || '#2e3e52';
    ctx.font      = '10px Arial,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = muted;

    // Only show every-other label if too many races to fit
    var step = series.length > 8 ? 2 : 1;
    series.forEach(function (d, i) {
      if (i % step !== 0 && i !== series.length - 1) return;
      ctx.fillText('R' + (i + 1), sc.toX(i), dims.h - PAD_BOTTOM + 16);
    });

    ctx.font      = '12px Arial,sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(activeYear + ' Season (' + series.length + ' races)',
      PAD_LEFT + sc.plotW / 2, dims.h - PAD_BOTTOM + 34);
  }

  /* ============================================================
     DRAW: AVERAGE LINE (grey horizontal)
  ============================================================ */
  function drawAverageLine(series, sc, dims) {
    var sum = series.reduce(function (a, d) { return a + d.timeSec; }, 0);
    var avg = sum / series.length;
    var y   = sc.toY(avg);
    var muted = getCSSVar('--muted') || '#7a96b4';

    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.moveTo(PAD_LEFT, y);
    ctx.lineTo(dims.w - PAD_RIGHT, y);
    ctx.strokeStyle = '#8a9ab0';
    ctx.lineWidth   = 1.5;
    ctx.globalAlpha = 0.7;
    ctx.stroke();
    ctx.restore();

    // Label at the right end, inside the plot area
    ctx.font        = '10px Arial,sans-serif';
    ctx.textAlign   = 'right';
    ctx.fillStyle   = '#8a9ab0';
    ctx.globalAlpha = 0.9;
    ctx.fillText('avg ' + formatSeconds(avg), dims.w - PAD_RIGHT - 4, y - 4);
    ctx.globalAlpha = 1;
  }

  /* ============================================================
     DRAW: REGRESSION LINE (dashed, season color)
  ============================================================ */
  function drawRegressionLine(series, sc, color) {
    var n = series.length;
    if (n < 3) return;

    var sX = 0, sY = 0, sXY = 0, sX2 = 0;
    series.forEach(function (d, i) {
      sX += i; sY += d.timeSec; sXY += i * d.timeSec; sX2 += i * i;
    });
    var slope     = (n * sXY - sX * sY) / (n * sX2 - sX * sX);
    var intercept = (sY - slope * sX) / n;

    var x0 = sc.toX(0);
    var y0 = sc.toY(intercept);
    var x1 = sc.toX(n - 1);
    var y1 = sc.toY(slope * (n - 1) + intercept);

    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([7, 4]);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.5;
    ctx.globalAlpha = 0.45;
    ctx.stroke();
    ctx.restore();

    // Label drawn INSIDE the chart, above the line end point
    var improving = slope < 0;
    var label     = improving ? '↓ Improving' : '↑ Slowing';
    ctx.font      = '10px Arial,sans-serif';
    ctx.textAlign = 'right';   // anchor to the right so it stays inside
    ctx.fillStyle   = improving ? '#4ade80' : '#f87171';
    ctx.globalAlpha = 0.9;
    ctx.fillText(label, x1, y1 - 8);
    ctx.globalAlpha = 1;
  }

  /* ============================================================
     DRAW: DATA POINTS + LINE (animated by progress 0→1)
  ============================================================ */
  function drawSeries(series, sc, color, progress, dims) {
    hitTargets = [];
    var CIRCLE_R  = 5;
    var firstX    = sc.toX(0);
    var lastX     = sc.toX(series.length - 1);
    var clipRight = firstX + (lastX - firstX) * progress + CIRCLE_R;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, clipRight, dims.h);
    ctx.clip();

    // Reset dash and alpha — setLineDash is NOT saved by ctx.save()
    // so avg/regression line dashes leak here without explicit reset
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Line
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2.5;
    ctx.lineJoin    = 'round';
    series.forEach(function (d, i) {
      var x = sc.toX(i), y = sc.toY(d.timeSec);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Circles + hit targets
    series.forEach(function (d, i) {
      var x = sc.toX(i), y = sc.toY(d.timeSec);
      if (x > clipRight + CIRCLE_R) return;

      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle   = color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      hitTargets.push({
        x: x, y: y, r: 13,
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

    var color = COLORS[activeYear] || '#003d8f';
    var dims  = setupCanvas();
    var sc    = computeScale(series, dims);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = getCSSVar('--surface') || '#ffffff';
    ctx.fillRect(0, 0, dims.w, dims.h);

    drawGrid(sc, dims);
    drawAxes(dims);
    drawXLabels(series, sc, dims, color);
    drawAverageLine(series, sc, dims);      // grey avg line
    drawRegressionLine(series, sc, color);  // dashed trend line
    drawSeries(series, sc, color, progress, dims);
  }

  function drawChart() { redrawAt(1); }

  /* ============================================================
     ANIMATION
  ============================================================ */
  function tickFrame(ts) {
    if (!animStart) animStart = ts;
    var p     = Math.min((ts - animStart) / ANIM_DURATION, 1);
    var eased = 1 - Math.pow(1 - p, 3);
    redrawAt(eased);
    if (p < 1) animFrameId = requestAnimationFrame(tickFrame);
  }

  function startAnim() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = null;
    animStart   = null;
    reducedMotion ? drawChart() : (animFrameId = requestAnimationFrame(tickFrame));
  }

  /* ============================================================
     SEASON TABS — independent from race card filter
  ============================================================ */
  function buildSeasonTabs() {
    var container = document.getElementById('chart-tabs');
    if (!container) return;

    ['2023', '2024', '2025'].forEach(function (yr) {
      var btn = document.createElement('button');
      btn.type        = 'button';
      btn.textContent = yr;
      btn.className   = 'chart-tab' + (yr === activeYear ? ' chart-tab--active' : '');
      btn.dataset.year = yr;
      btn.setAttribute('aria-pressed', yr === activeYear ? 'true' : 'false');

      btn.addEventListener('click', function () {
        if (activeYear === yr) return;
        activeYear = yr;
        container.querySelectorAll('.chart-tab').forEach(function (b) {
          var on = b.dataset.year === yr;
          b.classList.toggle('chart-tab--active', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        hideTooltip();
        startAnim();
      });

      container.appendChild(btn);
    });
  }

  /* ============================================================
     TOOLTIP — positioned near point, never overflows
  ============================================================ */
  var tooltip      = document.getElementById('chart-tooltip');
  var ttName       = document.getElementById('tooltip-name');
  var ttTime       = document.getElementById('tooltip-time');
  var ttDate       = document.getElementById('tooltip-date');
  var ttDelta      = document.getElementById('tooltip-delta');

  function getPos(e) {
    var r = canvas.getBoundingClientRect();
    var cx = e.touches ? e.touches[0].clientX : e.clientX;
    var cy = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: cx - r.left, y: cy - r.top };
  }

  function findHit(pos) {
    for (var i = hitTargets.length - 1; i >= 0; i--) {
      var t = hitTargets[i];
      var dx = pos.x - t.x, dy = pos.y - t.y;
      if (Math.sqrt(dx * dx + dy * dy) <= t.r) return t;
    }
    return null;
  }

  function showTooltip(hit) {
    if (!tooltip) return;

    ttName.textContent = hit.name;
    ttTime.textContent = hit.timeStr;
    ttDate.textContent = hit.date;

    // Delta text
    if (ttDelta) {
      if (hit.isFirst && hit.crossDelta !== null) {
        var fy = parseInt(hit.year, 10) - 1;
        var ff = hit.crossDelta < 0;
        ttDelta.textContent = hit.crossDeltaStr + (ff ? ' faster' : ' slower') + ' than ' + fy + ' avg';
        ttDelta.style.color = ff ? '#4ade80' : '#f87171';
      } else if (hit.delta !== null) {
        var fr = hit.delta < 0;
        ttDelta.textContent = hit.deltaStr + (fr ? ' faster' : ' slower') + ' vs prev race';
        ttDelta.style.color = fr ? '#4ade80' : '#f87171';
      } else {
        ttDelta.textContent = 'Season opener';
        ttDelta.style.color = '#8a9ab0';
      }
    }

    // Make visible first to measure its size
    tooltip.hidden = false;

    // Position relative to .chart-wrap
    var wrap   = canvas.parentElement;
    var cRect  = canvas.getBoundingClientRect();
    var wRect  = wrap.getBoundingClientRect();

    // Point position inside wrap
    var px = cRect.left - wRect.left + hit.x;
    var py = cRect.top  - wRect.top  + hit.y;

    var tw = tooltip.offsetWidth  || 210;
    var th = tooltip.offsetHeight || 100;

    // Horizontal: centre on point, clamp within wrap with 8px margin
    var left = px - tw / 2;
    left = Math.max(8, Math.min(left, wRect.width - tw - 8));

    // Vertical: prefer above the point
    var top = py - th - 14;
    if (top < 6) top = py + 16; // flip below if too close to top

    tooltip.style.left = left + 'px';
    tooltip.style.top  = top  + 'px';
  }

  function hideTooltip() { if (tooltip) tooltip.hidden = true; }

  /* ============================================================
     SCROLL TO CARD
  ============================================================ */
  function scrollToCard(hit) {
    var heading = document.getElementById(hit.cardId);
    if (!heading) return;
    var card = heading.closest('.race-card');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('chart-highlight');
    setTimeout(function () { card.classList.remove('chart-highlight'); }, 1800);
  }

  /* ============================================================
     WIRE EVENTS
  ============================================================ */
  function wireEvents() {
    canvas.addEventListener('mousemove', function (e) {
      var hit = findHit(getPos(e));
      if (hit) { showTooltip(hit); canvas.style.cursor = 'pointer'; }
      else     { hideTooltip();    canvas.style.cursor = 'crosshair'; }
    });

    canvas.addEventListener('mouseleave', hideTooltip);

    canvas.addEventListener('click', function (e) {
      var hit = findHit(getPos(e));
      if (hit) scrollToCard(hit);
    });

    canvas.addEventListener('touchstart', function (e) {
      e.preventDefault();
      var hit = findHit(getPos(e));
      if (hit) { showTooltip(hit); scrollToCard(hit); }
    }, { passive: false });

    canvas.addEventListener('touchend', function () {
      setTimeout(hideTooltip, 2200);
    });
  }

  function initResize() {
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(function () { drawChart(); }).observe(canvas.parentElement);
    } else {
      window.addEventListener('resize', drawChart);
    }
  }

  function initDarkMode() {
    if (window.matchMedia)
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawChart);
  }

  /* ============================================================
     INIT
  ============================================================ */
  function init() {
    canvas = document.getElementById('trend-chart');
    if (!canvas) { console.warn('chart.js: canvas not found'); return; }

    ctx     = canvas.getContext('2d');
    allData = extractRaceData();

    console.log('chart.js: extracted', allData.length, 'races');
    if (!allData.length) {
      var s = canvas.closest('section');
      if (s) s.hidden = true;
      return;
    }

    buildFallbackTable(allData);
    buildSeasonTabs();
    wireEvents();
    initResize();
    initDarkMode();
    startAnim();
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();

}());
