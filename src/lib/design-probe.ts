/**
 * The probe in the app's page: on {type: 'design'} it measures the page and draws it into an image (the DOM and the
 * page's CSS rendered through an SVG foreignObject; pictures from other sites stay blank), then posts both back.
 */
export const DESIGN_PROBE = `(function () {
  var rgba = function (s) { var m = /rgba?\\(([^)]+)\\)/.exec(s || ''); if (!m) return null; var p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  var blend = function (top, under) { var a = top[3]; return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1]; };
  var lum = function (c) { var f = function (v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  var hex = function (c) { return '#' + [0, 1, 2].map(function (i) { var h = Math.round(c[i]).toString(16); return h.length < 2 ? '0' + h : h; }).join(''); };
  var background = function (el) {
    var layers = [];
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) { var b = rgba(getComputedStyle(e).backgroundColor); if (b && b[3] > 0) { layers.push(b); if (b[3] >= 1) break; } }
    var out = [255, 255, 255, 1];
    for (var i = layers.length - 1; i >= 0; i--) out = blend(layers[i], out);
    return out;
  };
  var ownText = function (el) { var t = ''; for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) t += n.nodeValue; return t.replace(/\\s+/g, ' ').trim(); };
  var labelOf = function (el) { var c = (el.getAttribute('class') || '').split(/\\s+/)[0]; return el.tagName.toLowerCase() + (el.id ? '#' + el.id : c ? '.' + c : ''); };
  var srcOf = function (el) { var s = el.closest && el.closest('[data-nano-src]'); return s ? s.getAttribute('data-nano-src') : null; };
  // How tall the page's content is (the root element is never shorter than the frame)
  var contentHeight = function () { var b = document.body; return b ? Math.ceil(Math.max(b.scrollHeight, b.getBoundingClientRect().bottom)) : innerHeight; };
  var measure = function () {
    var sizes = {}, spacing = {}, contrast = [], empty = [], seen = {}, n = 0;
    var props = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'rowGap', 'columnGap'];
    var all = document.body ? document.body.querySelectorAll('*') : [];
    for (var i = 0; i < all.length && n < 4000; i++) {
      var el = all[i];
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|svg|path)$/.test(el.tagName)) continue;
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      n++;
      props.forEach(function (p) { var v = parseFloat(cs[p]); if (v > 0) { var k = String(Math.round(v * 2) / 2); spacing[k] = (spacing[k] || 0) + 1; } });
      if (/^(UL|OL|TBODY)$/.test(el.tagName) && !el.children.length) empty.push(labelOf(el) + (srcOf(el) ? ' (' + srcOf(el) + ')' : ''));
      var text = ownText(el);
      if (!text) continue;
      var fs = parseFloat(cs.fontSize), k2 = String(Math.round(fs * 2) / 2);
      sizes[k2] = (sizes[k2] || 0) + 1;
      var fg = rgba(cs.color); if (!fg) continue;
      var bg = background(el), fgc = blend(fg, bg);
      var l1 = lum(fgc), l2 = lum(bg), ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      var large = fs >= 24 || (fs >= 18.66 && +cs.fontWeight >= 700);
      if (ratio < (large ? 3 : 4.5)) {
        var key = hex(fgc) + hex(bg) + srcOf(el);
        if (seen[key]) continue; seen[key] = 1;
        contrast.push({ text: text.slice(0, 60), label: labelOf(el), src: srcOf(el), fg: hex(fgc), bg: hex(bg), ratio: Math.round(ratio * 100) / 100, large: large });
      }
    }
    contrast.sort(function (a, b) { return a.ratio - b.ratio; });
    return { fontSizes: sizes, spacing: spacing, contrast: contrast.slice(0, 40), empty: empty.slice(0, 20), width: innerWidth, height: contentHeight(), elements: n };
  };
  var capture = function (done) {
    try {
      var w = document.documentElement.clientWidth || innerWidth, h = Math.max(120, Math.min(contentHeight(), 2400));
      var css = '';
      for (var s = 0; s < document.styleSheets.length; s++) { try { var rules = document.styleSheets[s].cssRules; for (var j = 0; j < rules.length; j++) css += rules[j].cssText + '\\n'; } catch (e) {} }
      var clone = document.documentElement.cloneNode(true);
      Array.prototype.forEach.call(clone.querySelectorAll('script,style,link,iframe,video,canvas'), function (e) { e.remove(); });
      var style = document.createElement('style'); style.textContent = css; (clone.querySelector('head') || clone).appendChild(style);
      clone.setAttribute('style', (clone.getAttribute('style') || '') + ';width:' + w + 'px;height:' + h + 'px;overflow:hidden;background:' + (getComputedStyle(document.body).backgroundColor || '#fff'));
      var xml = new XMLSerializer().serializeToString(clone);
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><foreignObject width="100%" height="100%">' + xml + '</foreignObject></svg>';
      var img = new Image();
      var timer = setTimeout(function () { done(null); }, 5000);
      img.onload = function () {
        clearTimeout(timer);
        try {
          var scale = Math.min(1, 800 / w), c = document.createElement('canvas');
          c.width = Math.round(w * scale); c.height = Math.round(h * scale);
          var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          done(c.toDataURL('image/jpeg', 0.72));
        } catch (e) { done(null); }
      };
      img.onerror = function () { clearTimeout(timer); done(null); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    } catch (e) { done(null); }
  };
  addEventListener('message', function (e) {
    if (e.source !== parent || !e.data || e.data.source !== 'aha-preview' || e.data.type !== 'design') return;
    // Measure what the page shows once it has rendered: after load and a moment for the framework. Timers, not
    // animation frames: a frame kept off screen (the proposal's after) gets no animation frames
    var run = function () {
      var report = measure();
      capture(function (image) { parent.postMessage({ source: 'aha-app', type: 'design', report: report, image: image }, '*'); });
    };
    if (document.readyState === 'complete') setTimeout(run, 300); else addEventListener('load', function () { setTimeout(run, 300); });
  });
})();`;
