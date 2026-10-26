(function () {
  'use strict';

  var FEATURED_IDS = ['11', '4', '14', '6'];
  var SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter', 'unseasoned'];
  var SEASON_FALLBACK = { spring: '春', summer: '夏', autumn: '秋', winter: '冬', unseasoned: '未归季' };
  var THEME_ORDER = ['nature', 'romance', 'fantasy', 'scifi', 'suspense', 'urban', 'war', 'animation', 'family'];
  var THEME_FALLBACK = {
    nature: '自然', romance: '爱情', fantasy: '奇幻', scifi: '科幻', suspense: '悬疑',
    urban: '都市', war: '战争', animation: '动画', family: '家庭'
  };
  var MAX_COMPARE = 3;
  var LOW_CHROMA = 5;

  var raw = window.CINEMA_ATLAS;
  var data = raw && typeof raw === 'object' ? raw : null;
  var refs = data && Array.isArray(data.references) ? data.references : [];
  var films = data && Array.isArray(data.films) ? data.films.filter(function (f) { return f && f.id != null; }) : [];
  var seasons = data && Array.isArray(data.seasons) ? data.seasons : [];
  var themes = data && Array.isArray(data.themes) ? data.themes : [];

  var state = { season: 'all', themes: [], query: '', compare: [] };
  var cards = {};
  var lastTrigger = null;

  function $(id) { return document.getElementById(id); }

  // Safe DOM builder: text is always inserted via textContent.
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'text') node.textContent = String(v);
        else if (k === 'class') node.className = v;
        else if (k === 'style') Object.keys(v).forEach(function (p) { node.style.setProperty(p, v[p]); });
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    (children || []).forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function safeHex(hex) {
    return typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : null;
  }

  // Allow http(s) and project-relative URLs only.
  function safeUrl(url) {
    if (typeof url !== 'string' || !url.trim()) return null;
    var u = url.trim();
    if (/^https?:\/\//i.test(u)) return u;
    if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.slice(0, 2) === '//') return null;
    return u;
  }

  function num(v) { return typeof v === 'number' && isFinite(v); }
  function fmt(v, d, unit) { return num(v) ? v.toFixed(d) + (unit || '') : '—'; }
  function str(v, fallback) { return v == null || v === '' ? (fallback || '未注明') : String(v); }

  function refById(id) {
    for (var i = 0; i < refs.length; i++) if (String(refs[i].id) === String(id)) return refs[i];
    return null;
  }

  function seasonLabel(id) {
    for (var i = 0; i < seasons.length; i++) if (seasons[i].id === id) return seasons[i].label || SEASON_FALLBACK[id] || id;
    return SEASON_FALLBACK[id] || String(id);
  }

  function seasonDesc(id) {
    for (var i = 0; i < seasons.length; i++) if (seasons[i].id === id) return seasons[i].description || '';
    return '';
  }

  function themeLabel(id) {
    for (var i = 0; i < themes.length; i++) if (themes[i].id === id) return themes[i].label || THEME_FALLBACK[id] || id;
    return THEME_FALLBACK[id] || String(id);
  }

  function filmSeason(f) { return f.season ? String(f.season) : 'unseasoned'; }
  function filmThemes(f) { return Array.isArray(f.themes) ? f.themes.map(String) : []; }
  function filmSamples(f) { return Array.isArray(f.samples) ? f.samples : []; }
  function filmById(id) {
    for (var i = 0; i < films.length; i++) if (String(films[i].id) === String(id)) return films[i];
    return null;
  }

  function hueUnreliable(s) { return !num(s.h) || (num(s.c) && s.c < LOW_CHROMA); }

  /* ---------- Intro stats ---------- */

  function renderStats() {
    var stats = $('stats');
    if (!data) {
      stats.textContent = '数据文件未能载入，暂时无法显示影片。';
      return;
    }
    var sampleCount = films.reduce(function (n, f) { return n + filmSamples(f).length; }, 0);
    if (!films.length) {
      stats.textContent = '影片数据尚在整理中，目前收录 0 部影片。';
    } else {
      stats.textContent = '目前收录 ' + films.length + ' 部影片、' + sampleCount + ' 个取样区域，覆盖' +
        '四季与跨季节主题；参考色 ' + refs.length + ' 个。';
    }
    if (data.updated) $('updated').textContent = ' 更新于 ' + String(data.updated) + '。';
  }

  /* ---------- References ---------- */

  function refItem(r, featured) {
    var hex = safeHex(r.hex);
    return el('li', { class: 'ref' + (featured ? ' ref--featured' : '') }, [
      el('span', { class: 'swatch', 'aria-hidden': 'true', style: hex ? { 'background-color': hex } : null }),
      el('span', { class: 'ref-text' }, [
        el('strong', { text: '#' + str(r.id, '?') + ' ' + str(r.name, '') }),
        el('span', { class: 'mono', text: (hex || '—') }),
        el('span', { class: 'mono muted', text: 'H ' + fmt(r.h, 0, '°') + ' · C* ' + fmt(r.c, 1) + ' · L* ' + fmt(r.l, 1) })
      ])
    ]);
  }

  function renderRefs() {
    var featured = $('refs-featured');
    var all = $('refs-all');
    var found = FEATURED_IDS.map(refById).filter(Boolean);
    if (!found.length) {
      featured.appendChild(el('li', { class: 'empty-inline', text: '参考色数据尚未载入。' }));
    } else {
      found.forEach(function (r) { featured.appendChild(refItem(r, true)); });
    }
    if (refs.length) {
      refs.forEach(function (r) { all.appendChild(refItem(r, FEATURED_IDS.indexOf(String(r.id)) !== -1)); });
      $('refs-all-wrap').querySelector('summary').textContent = '展开全部 ' + refs.length + ' 个参考色';
    } else {
      $('refs-all-wrap').hidden = true;
    }
  }

  /* ---------- Filters ---------- */

  var seasonChips = {};
  var themeChips = {};

  function chip(label, onClick) {
    return el('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: onClick }, [label]);
  }

  // Chips are built once so keyboard focus survives filter changes.
  function syncChips() {
    Object.keys(seasonChips).forEach(function (id) {
      seasonChips[id].setAttribute('aria-pressed', state.season === id ? 'true' : 'false');
    });
    Object.keys(themeChips).forEach(function (id) {
      themeChips[id].setAttribute('aria-pressed', state.themes.indexOf(id) !== -1 ? 'true' : 'false');
    });
  }

  function renderChips() {
    var sc = $('season-chips');
    var tc = $('theme-chips');

    var seasonIds = ['all'].concat(SEASON_ORDER);
    films.forEach(function (f) {
      var s = filmSeason(f);
      if (seasonIds.indexOf(s) === -1) seasonIds.push(s);
    });
    seasonIds.forEach(function (id) {
      var n = id === 'all' ? films.length : films.filter(function (f) { return filmSeason(f) === id; }).length;
      var label = (id === 'all' ? '全部' : seasonLabel(id)) + ' ' + n;
      seasonChips[id] = sc.appendChild(chip(label, function () {
        state.season = id;
        update();
      }));
    });

    var themeIds = themes.length ? themes.map(function (t) { return String(t.id); }) : THEME_ORDER.slice();
    themeIds.forEach(function (id) {
      var n = films.filter(function (f) { return filmThemes(f).indexOf(id) !== -1; }).length;
      themeChips[id] = tc.appendChild(chip(themeLabel(id) + ' ' + n, function () {
        var i = state.themes.indexOf(id);
        if (i === -1) state.themes.push(id); else state.themes.splice(i, 1);
        update();
      }));
    });
  }

  function matches(f) {
    if (state.season !== 'all' && filmSeason(f) !== state.season) return false;
    var ft = filmThemes(f);
    for (var i = 0; i < state.themes.length; i++) if (ft.indexOf(state.themes[i]) === -1) return false;
    if (state.query) {
      var hay = (str(f.title, '') + ' ' + str(f.originalTitle, '')).toLowerCase();
      if (hay.indexOf(state.query) === -1) return false;
    }
    return true;
  }

  /* ---------- Cards ---------- */

  function frameView(f, withOverlays) {
    var w = num(f.width) && f.width > 0 ? f.width : null;
    var h = num(f.height) && f.height > 0 ? f.height : null;
    var src = safeUrl(f.image);
    var style = {};
    if (w) style['max-width'] = w + 'px';
    if (w && h) style['aspect-ratio'] = w + ' / ' + h;
    var frame = el('span', { class: 'frame', style: style });
    if (src) {
      var img = el('img', {
        src: src, alt: str(f.title, '影片') + ' 画面' + (f.frameLabel ? '：' + f.frameLabel : ''),
        width: w, height: h, loading: 'lazy', decoding: 'async'
      });
      img.addEventListener('error', function () {
        frame.classList.add('frame--missing');
        frame.appendChild(el('span', { class: 'frame-missing', text: '图像暂缺' }));
      });
      frame.appendChild(img);
    } else {
      frame.classList.add('frame--missing');
      frame.appendChild(el('span', { class: 'frame-missing', text: '图像暂缺' }));
    }
    if (withOverlays && w && h) {
      filmSamples(f).slice(0, 3).forEach(function (s, i) {
        var r = Array.isArray(s.rect) ? s.rect : null;
        if (!r || r.length !== 4 || !r.every(num)) return;
        frame.appendChild(el('span', {
          class: 'roi', 'aria-hidden': 'true',
          style: {
            left: (r[0] / w * 100) + '%', top: (r[1] / h * 100) + '%',
            width: (r[2] / w * 100) + '%', height: (r[3] / h * 100) + '%'
          }
        }, [el('span', { class: 'roi-num', text: String(i + 1) })]));
      });
    }
    return frame;
  }

  function bar(label, value, refValue, max, unit, digits, note) {
    function pos(v) { return Math.max(0, Math.min(100, v / max * 100)) + '%'; }
    var track = el('span', { class: 'bar-track', 'aria-hidden': 'true' });
    if (num(value)) track.appendChild(el('span', { class: 'bar-mark bar-mark--sample', style: { left: pos(value) } }));
    if (num(refValue)) track.appendChild(el('span', { class: 'bar-mark bar-mark--ref', style: { left: pos(refValue) } }));
    return el('div', { class: 'bar' }, [
      el('span', { class: 'bar-label', text: label }),
      track,
      el('span', { class: 'bar-val mono', text: '样本 ' + fmt(value, digits, unit) + ' / 参考 ' + fmt(refValue, digits, unit) + (note ? ' ' + note : '') })
    ]);
  }

  function sampleItem(s, i) {
    var hex = safeHex(s.hex);
    var ref = s.nearestId != null ? refById(s.nearestId) : null;
    var refHex = ref ? safeHex(ref.hex) : null;
    var unreliable = hueUnreliable(s);
    var hText = num(s.h) ? fmt(s.h, 0, '°') : '无（近灰）';

    var metrics = el('dl', { class: 'metrics' }, [
      el('div', null, [el('dt', { text: 'HEX' }), el('dd', { class: 'mono', text: hex || '—' })]),
      el('div', null, [el('dt', { text: 'HSL H' }), el('dd', { class: 'mono' }, [hText, unreliable ? el('span', { class: 'flag', text: ' 色相不可靠' }) : null])]),
      el('div', null, [el('dt', { text: 'Lab C*' }), el('dd', { class: 'mono', text: fmt(s.c, 1) })]),
      el('div', null, [el('dt', { text: 'Lab L*' }), el('dd', { class: 'mono', text: fmt(s.l, 1) })]),
      el('div', null, [el('dt', { text: '最近参考绿' }), el('dd', null, [
        refHex ? el('span', { class: 'swatch swatch--xs', 'aria-hidden': 'true', style: { 'background-color': refHex } }) : null,
        ref ? '#' + str(ref.id, '?') + ' ' + str(ref.name, '') : (s.nearestId != null ? '#' + s.nearestId : '—')
      ])]),
      el('div', null, [el('dt', { text: 'ΔE00' }), el('dd', { class: 'mono', text: fmt(s.deltaE, 1) })])
    ]);

    var bars = el('details', { class: 'disclosure disclosure--small' }, [
      el('summary', { text: '与参考绿比较' }),
      el('div', { class: 'bars' }, [
        el('div', { class: 'swatch-pair', 'aria-hidden': 'true' }, [
          el('span', { class: 'swatch swatch--md', style: hex ? { 'background-color': hex } : null }),
          el('span', { class: 'swatch swatch--md', style: refHex ? { 'background-color': refHex } : null })
        ]),
        bar('H', s.h, ref ? ref.h : null, 360, '°', 0, unreliable ? '（C* 低，色相不可靠）' : ''),
        bar('C*', s.c, ref ? ref.c : null, 100, '', 1),
        bar('L*', s.l, ref ? ref.l : null, 100, '', 1),
        el('p', { class: 'note', text: '实心标记为样本，空心标记为参考。“最近”只表示四种参考绿中距离最小；ΔE00 越大差异越明显，数值较大时并不意味着颜色接近。' })
      ])
    ]);

    return el('li', { class: 'sample' }, [
      el('span', { class: 'sample-num', 'aria-hidden': 'true', text: String(i + 1) }),
      el('span', { class: 'swatch swatch--lg', role: 'img', 'aria-label': '样本 ' + (i + 1) + ' 中位色 ' + (hex || '未知'), style: hex ? { 'background-color': hex } : null }),
      el('div', { class: 'sample-body' }, [
        el('p', { class: 'sample-label' }, [el('span', { class: 'sr-only', text: '样本 ' + (i + 1) + '：' }), str(s.label, '样本 ' + (i + 1))]),
        metrics,
        bars
      ])
    ]);
  }

  function provRow(k, v) {
    return el('div', null, [el('dt', { text: k }), el('dd', null, [v])]);
  }

  function linkOrText(url) {
    var u = safeUrl(url);
    return u ? el('a', { href: u, target: '_blank', rel: 'noopener', class: 'break', text: u }) : el('span', { text: '未注明' });
  }

  function provenance(f) {
    var w = num(f.width) ? f.width : '?';
    var h = num(f.height) ? f.height : '?';
    var dl = el('dl', { class: 'prov' }, [
      provRow('分辨率', el('span', { class: 'mono', text: w + ' × ' + h + ' px' })),
      provRow('来源', el('span', { text: str(f.sourceName) + (f.sourceKind ? '（' + f.sourceKind + '）' : '') })),
      provRow('原图地址', linkOrText(f.sourceImage)),
      provRow('来源页面', linkOrText(f.sourcePage)),
      provRow('画面位置', el('span', { text: str(f.frameLabel) })),
      provRow('版本', el('span', { text: f.versionNote ? String(f.versionNote) : '发行版本未知' })),
      provRow('使用说明', el('span', { text: str(f.rightsNote) })),
      provRow('色彩配置假设', el('span', { text: str(f.colorProfile) })),
      provRow('SHA-256', el('span', { class: 'mono break', text: str(f.sha256) }))
    ]);
    (f.seasonSources || []).forEach(function (source) {
      var url = safeUrl(source.url);
      if (url) dl.appendChild(provRow('季节依据', el('a', { href: url, target: '_blank', rel: 'noopener', text: source.title })));
    });
    var rows = filmSamples(f).map(function (s, i) {
      var r = Array.isArray(s.rect) ? s.rect.join(', ') : '—';
      var iqr = Array.isArray(s.iqr) ? s.iqr.join(' / ') : '—';
      return el('tr', null, [
        el('th', { scope: 'row', text: String(i + 1) }),
        el('td', { class: 'mono', text: '[' + r + ']' }),
        el('td', { class: 'mono', text: num(s.pixels) ? String(s.pixels) : '—' }),
        el('td', { class: 'mono', text: iqr })
      ]);
    });
    var table = el('div', { class: 'table-wrap' }, [el('table', null, [
      el('caption', { text: '取样区域（原图像素 x, y, 宽, 高）' }),
      el('thead', null, [el('tr', null, [
        el('th', { scope: 'col', text: '#' }), el('th', { scope: 'col', text: 'ROI' }),
        el('th', { scope: 'col', text: '像素数' }), el('th', { scope: 'col', text: 'IQR R/G/B' })
      ])]),
      el('tbody', null, rows)
    ])]);
    return el('details', { class: 'disclosure' }, [el('summary', { text: '来源与取样细节' }), dl, table]);
  }

  function buildCard(f) {
    var id = String(f.id);
    var titleId = 'film-' + id.replace(/[^a-z0-9_-]/gi, '_');
    var meta = [f.originalTitle, f.year, f.director].filter(function (x) { return x != null && x !== ''; }).join(' · ');

    var open = el('button', { type: 'button', class: 'frame-btn', 'aria-label': '查看完整画面：' + str(f.title, '影片') }, [frameView(f, true)]);
    open.addEventListener('click', function () { openViewer(f, open); });

    var check = el('input', { type: 'checkbox', class: 'compare-check' });
    check.addEventListener('change', function () { toggleCompare(id, check.checked); });

    var tags = el('ul', { class: 'tags', 'aria-label': '主题' }, filmThemes(f).map(function (t) { return el('li', { text: themeLabel(t) }); }));

    var card = el('article', { class: 'card', 'aria-labelledby': titleId }, [
      open,
      el('div', { class: 'card-body' }, [
        el('h4', { id: titleId, class: 'card-title', text: str(f.title, '未命名影片') }),
        meta ? el('p', { class: 'card-meta muted', text: meta }) : null,
        el('p', { class: 'season-note' }, [
          el('strong', { text: str(f.seasonLabel, seasonLabel(filmSeason(f))) }),
          f.seasonEvidence ? ' — ' + String(f.seasonEvidence) : ''
        ]),
        tags,
        f.caption ? el('p', { class: 'caption', text: String(f.caption) }) : null,
        f.analysis ? el('p', { class: 'analysis', text: String(f.analysis) }) : null,
        el('ol', { class: 'samples', 'aria-label': '取样色' }, filmSamples(f).slice(0, 3).map(sampleItem)),
        provenance(f),
        el('div', { class: 'card-actions' }, [
          el('label', { class: 'toggle compare-toggle' }, [check, el('span', { text: '加入并排对比' })]),
          el('a', { href: '#compare', class: 'note', text: '查看对比 ↑' })
        ])
      ])
    ]);
    cards[id] = { node: card, check: check };
    return card;
  }

  /* ---------- Gallery ---------- */

  function update() {
    syncChips();
    var gallery = $('gallery');
    gallery.textContent = '';
    var visible = films.filter(matches);
    var order = SEASON_ORDER.slice();
    visible.forEach(function (f) { var s = filmSeason(f); if (order.indexOf(s) === -1) order.push(s); });

    order.forEach(function (sid) {
      var list = visible.filter(function (f) { return filmSeason(f) === sid; });
      if (!list.length) return;
      var hid = 'season-' + sid.replace(/[^a-z0-9_-]/gi, '_');
      var desc = seasonDesc(sid);
      var grid = el('div', { class: 'card-grid' });
      list.forEach(function (f) { grid.appendChild(cards[String(f.id)].node); });
      gallery.appendChild(el('section', { class: 'season-group', 'aria-labelledby': hid }, [
        el('h3', { id: hid, class: 'season-title' }, [seasonLabel(sid), el('span', { class: 'muted', text: ' ' + list.length + ' 部' })]),
        desc ? el('p', { class: 'note', text: desc }) : null,
        grid
      ]));
    });

    var empty = $('empty');
    if (!data) {
      empty.hidden = false;
      empty.textContent = '数据文件 data/atlas.js 未能载入。';
    } else if (!films.length) {
      empty.hidden = false;
      empty.textContent = '影片数据尚未发布，敬请稍后再来。';
    } else if (!visible.length) {
      empty.hidden = false;
      empty.textContent = '没有符合当前筛选条件的影片。可以减少主题条件或点击“重置筛选”。';
    } else {
      empty.hidden = true;
    }
    $('count').textContent = '显示 ' + visible.length + ' / ' + films.length + ' 部影片';
  }

  /* ---------- Comparison ---------- */

  function toggleCompare(id, on) {
    var i = state.compare.indexOf(id);
    if (on && i === -1 && state.compare.length < MAX_COMPARE) state.compare.push(id);
    if (!on && i !== -1) state.compare.splice(i, 1);
    renderCompare();
  }

  function renderCompare() {
    var grid = $('compare-grid');
    grid.textContent = '';
    var full = state.compare.length >= MAX_COMPARE;
    Object.keys(cards).forEach(function (id) {
      var c = cards[id];
      var on = state.compare.indexOf(id) !== -1;
      c.check.checked = on;
      c.check.disabled = full && !on;
    });
    state.compare.forEach(function (id) {
      var f = filmById(id);
      if (!f) return;
      var remove = el('button', { type: 'button', class: 'btn btn--small', text: '移除', 'aria-label': '从对比中移除 ' + str(f.title, '影片') });
      remove.addEventListener('click', function () { toggleCompare(id, false); $('compare-title').focus(); });
      var sw = el('ul', { class: 'compare-swatches' }, filmSamples(f).slice(0, 3).map(function (s, i) {
        var hex = safeHex(s.hex);
        return el('li', null, [
          el('span', { class: 'swatch swatch--md', 'aria-hidden': 'true', style: hex ? { 'background-color': hex } : null }),
          el('span', { class: 'mono', text: (i + 1) + ' ' + (hex || '—') + ' · ΔE00 ' + fmt(s.deltaE, 1) })
        ]);
      }));
      grid.appendChild(el('article', { class: 'compare-item' }, [
        el('div', { class: 'compare-item-head' }, [el('h3', { text: str(f.title, '未命名影片') }), remove]),
        frameView(f, false),
        sw
      ]));
    });
    var n = state.compare.length;
    $('compare-clear').disabled = n === 0;
    $('compare').classList.toggle('compare--active', n > 0);
    $('compare-hint').textContent = n === 0
      ? '在影片卡片上勾选“加入并排对比”，可选择 2–3 部影片并排查看。对比区不受筛选影响。'
      : n === 1 ? '已选 1 部，再选择至少 1 部即可对比（最多 3 部）。'
      : '已选 ' + n + ' 部' + (full ? '（已达上限 3 部）' : '，最多可选 3 部') + '。';
  }

  /* ---------- Viewer dialog ---------- */

  var viewer = $('viewer');
  var viewerImg = $('viewer-img');
  var modeBtn = $('viewer-mode');

  function setNative(on) {
    viewer.classList.toggle('viewer--native', on);
    modeBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    modeBtn.textContent = on ? '适应窗口' : '原始像素尺寸';
  }

  function openViewer(f, trigger) {
    lastTrigger = trigger;
    var src = safeUrl(f.image);
    $('viewer-title').textContent = str(f.title, '影片') + (f.frameLabel ? ' · ' + f.frameLabel : '');
    $('viewer-meta').textContent = (num(f.width) && num(f.height) ? f.width + ' × ' + f.height + ' px · ' : '') +
      (f.versionNote ? String(f.versionNote) : '发行版本未知') + ' · ' + str(f.sourceName);
    viewerImg.removeAttribute('src');
    if (src) viewerImg.src = src;
    viewerImg.alt = str(f.title, '影片') + ' 完整画面';
    if (num(f.width)) viewerImg.style.setProperty('--native-w', f.width + 'px'); else viewerImg.style.removeProperty('--native-w');
    var page = safeUrl(f.sourcePage) || safeUrl(f.sourceImage);
    var link = $('viewer-source');
    if (page) { link.href = page; link.hidden = false; } else { link.removeAttribute('href'); link.hidden = true; }
    var fileLink = $('viewer-file');
    if (src) { fileLink.href = src; fileLink.hidden = false; } else { fileLink.removeAttribute('href'); fileLink.hidden = true; }
    setNative(false);
    if (typeof viewer.showModal === 'function') {
      viewer.showModal();
      $('viewer-close').focus();
    } else if (src) {
      window.open(src, '_blank', 'noopener');
    }
  }

  modeBtn.addEventListener('click', function () {
    setNative(modeBtn.getAttribute('aria-pressed') !== 'true');
  });
  $('viewer-close').addEventListener('click', function () { viewer.close(); });
  viewer.addEventListener('click', function (e) { if (e.target === viewer) viewer.close(); });
  viewer.addEventListener('close', function () {
    if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
    lastTrigger = null;
  });

  /* ---------- Controls ---------- */

  var q = $('q');
  q.addEventListener('input', function () {
    state.query = q.value.trim().toLowerCase();
    update();
  });

  $('reset').addEventListener('click', function () {
    state.season = 'all';
    state.themes = [];
    state.query = '';
    q.value = '';
    update();
  });

  var roi = $('roi-toggle');
  roi.checked = false;
  roi.addEventListener('change', function () {
    document.body.classList.toggle('show-roi', roi.checked);
  });

  $('compare-clear').addEventListener('click', function () {
    state.compare = [];
    renderCompare();
  });

  document.querySelectorAll('.season-strip a').forEach(function (link) {
    link.addEventListener('click', function () {
      state.season = 'all';
      state.themes = [];
      state.query = '';
      q.value = '';
      update();
    });
  });

  /* ---------- Init ---------- */

  renderStats();
  renderRefs();
  renderChips();
  films.forEach(buildCard);
  update();
  renderCompare();
})();
