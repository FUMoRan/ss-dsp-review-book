/* =========================================================
   信号与系统 / 数字信号处理 复习本站 · code.js
   轻量代码高亮（MATLAB / Python），纯函数、无 DOM 依赖、无外部库。
   浏览器以经典脚本加载（挂到 window.MQC）；Node 下可作为模块被单测引用。
   highlight() 先做 HTML 转义再插入 <span>，输出始终是安全 HTML。
   ========================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MQC = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LANGS = ['matlab', 'python'];
  const LANG_LABEL = { matlab: 'MATLAB', python: 'Python' };

  /* ---------- HTML 转义（先于任何标签拼接） ---------- */
  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  // 包裹一个记号：内层文本一定先转义，杜绝用户内容被当作 HTML
  function span(cls, text) {
    return '<span class="' + cls + '">' + escapeHTML(text) + '</span>';
  }

  /* ---------- 关键字 / 内置函数 ---------- */
  const KW = {
    matlab: 'function if else elseif end for while switch case otherwise break continue return try catch global persistent',
    python: 'def if elif else for while in not and or is None True False return import from as class try except finally with lambda yield pass break continue global raise assert del nonlocal async await',
  };
  const FN = {
    matlab: 'sin cos tan exp log log10 sqrt abs angle real imag conj conv fft ifft filter freqz freqs tf zpk roots poly plot stem subplot grid xlabel ylabel title legend size length zeros ones linspace numel sum mean max min round floor ceil mod reshape repmat find disp fprintf sprintf error',
    python: 'print len range enumerate abs sum min max sorted list dict set int float complex type zip numpy scipy matplotlib plt np str bool tuple round map filter open',
  };
  const toSet = s => new Set(s.split(/\s+/).filter(Boolean));

  /* ---------- 语言配置（正则片段） ----------
     NUM: 整数 / 小数 / 科学计数法 / MATLAB 1i·2j 复数后缀
     IDENT: 标识符（再按关键字/内置函数归类）
     ops: 多字符运算符优先，其余单字符各切一个，保证源码字符一一对应 */
  const NUM = '(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?[ij]?(?![A-Za-z0-9_])';
  const IDENT = '[A-Za-z_][A-Za-z0-9_]*';
  const CFG = {
    matlab: {
      lineComment: '%', quotes: '\'"', doubleEscape: true, transpose: true,
      ops: "\\.\\*|\\.\\/|\\.\\^|[+\\-*\\/^=<>~!:;,()\\[\\]{}']",
    },
    python: {
      lineComment: '#', quotes: '\'"', doubleEscape: false, transpose: false,
      ops: "\\*\\*|[+\\-*\\/^=<>~!:;,()\\[\\]{}]",
    },
  };
  const RE = {}, KW_SET = {}, FN_SET = {};
  for (const k of LANGS) {
    RE[k] = new RegExp(NUM + '|' + IDENT + '|' + CFG[k].ops, 'g');
    KW_SET[k] = toSet(KW[k]);
    FN_SET[k] = toSet(FN[k]);
  }

  /* ---------- 字符串配对：不跨行；支持 \' \" \\ 转义 ---------- */
  function matchString(src, i, q, cfg) {
    let k = i + 1;
    while (k < src.length) {
      const c = src[k];
      if (c === '\n') return -1;                 // 不跨行
      if (c === '\\') { k += 2; continue; }      // 反斜杠转义
      if (c === q) {
        if (cfg.doubleEscape && src[k + 1] === q) { k += 2; continue; } // MATLAB '' 双写
        return k + 1;
      }
      k++;
    }
    return -1;
  }

  // MATLAB 的 ' 紧跟在值（标识符/数字/右括号/引号）之后时是转置运算符，不是字符串开头
  function canOpen(src, i, cfg) {
    if (!cfg.transpose || src[i] !== "'") return true;
    return i === 0 || !/[A-Za-z0-9_)\]}'"]/.test(src[i - 1]);
  }

  /* ---------- 切分：注释 / 字符串 / 普通代码 ---------- */
  function split(src, lang) {
    const cfg = CFG[lang], parts = [];
    let i = 0, plain = 0, n = src.length;
    const flush = e => { if (e > plain) parts.push({ t: 'p', s: src.slice(plain, e) }); };
    while (i < n) {
      const c = src[i];
      if (c === cfg.lineComment) {               // 行注释，吃到行尾
        flush(i);
        let j = src.indexOf('\n', i);
        if (j < 0) j = n;
        parts.push({ t: 'c', s: src.slice(i, j) });
        i = j; plain = i; continue;
      }
      if (cfg.quotes.indexOf(c) >= 0 && canOpen(src, i, cfg)) {
        const end = matchString(src, i, c, cfg);
        if (end > 0) {                           // 成对引号 → 字符串
          flush(i);
          parts.push({ t: 's', s: src.slice(i, end) });
          i = end; plain = i; continue;
        }
      }
      i++;                                       // 否则留作运算符/普通字符
    }
    flush(n);
    return parts;
  }

  /* ---------- 普通代码段：逐个记号转义并加 span ---------- */
  function tokenize(text, lang) {
    const re = RE[lang];
    re.lastIndex = 0;
    let out = '', last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out += escapeHTML(text.slice(last, m.index));
      const t = m[0];
      let cls = null;
      if (/^\d|^\.\d/.test(t)) cls = 'tok-num';
      else if (KW_SET[lang].has(t)) cls = 'tok-kw';
      else if (FN_SET[lang].has(t)) cls = 'tok-fn';
      else if (!/^[A-Za-z_]/.test(t)) cls = 'tok-op';
      out += cls ? span(cls, t) : escapeHTML(t);
      last = m.index + t.length;
    }
    return out + escapeHTML(text.slice(last));
  }

  /* ---------- 对外：highlight ---------- */
  function highlight(code, lang) {
    const src = String(code == null ? '' : code);
    const key = LANGS.indexOf(lang) >= 0 ? lang : null;
    if (!key) return escapeHTML(src);            // 非法语言 → 纯文本高亮
    let html = '';
    for (const p of split(src, key)) {
      if (p.t === 'c') html += span('tok-com', p.s);
      else if (p.t === 's') html += span('tok-str', p.s);
      else html += tokenize(p.s, key);
    }
    return html;
  }

  /* ---------- 对外：语言猜测（默认 matlab） ---------- */
  function detectLang(code) {
    const s = String(code == null ? '' : code);
    let py = 0, mt = 0;
    if (/(^|\s)#/.test(s)) py += 2;
    if (/^\s*%/m.test(s)) mt += 2;
    if (/\bdef\s+\w+\s*\(/.test(s)) py += 3;
    if (/\bprint\s*\(/.test(s)) py += 3;
    if (/^\s*(import|from)\s+\w+/m.test(s)) py += 3;
    if (/\b(self|lambda|None|True|False|elif)\b/.test(s)) py += 2;
    if (/\b(function|elseif|end)\b/.test(s)) mt += 3;
    if (/\.\*|\.\/|\.\^/.test(s)) mt += 3;
    if (/\b(disp|fprintf|freqz|zpk|tf)\s*\(/.test(s)) mt += 2;
    return py > mt ? 'python' : 'matlab';
  }

  /* ---------- 对外：完整代码块 HTML 片段 ----------
     事件一律由主程序委托绑定，这里不写 onclick / 不注册监听。 */
  function codeBlockHTML(code, lang) {
    const src = String(code == null ? '' : code);
    let key = LANGS.indexOf(lang) >= 0 ? lang : detectLang(src);
    if (LANGS.indexOf(key) < 0) key = null;      // 兜底：纯文本
    const label = key ? LANG_LABEL[key] : 'Text';
    return '<div class="codewrap">' +
      '<div class="code-head">' +
      '<span class="code-lang">' + escapeHTML(label) + '</span>' +
      '<button class="code-copy" data-copy>复制</button>' +
      '</div>' +
      '<pre class="code"><code>' + highlight(src, key) + '</code></pre>' +
      '</div>';
  }

  return { LANGS, LANG_LABEL, highlight, detectLang, codeBlockHTML };
});
