/* =========================================================
   S&S · DSP 复习本 · gen.js
   按标签一键生成图表：纯本地、纯确定性，不联网、不使用任何 API。

   设计三层（全部与 DOM 无关，可在 Node 下单测）
   ----------
   1) 规则层  RULES        科目 → 标签 → 生成项（图 plots / 表 tables / 所需参数 need）
   2) 抽取层  extractParams(text)   从题面 LaTeX 里确定性抽取表达式、系数、采样参数
   3) 表格层  buildTable(kind, params)  用系数算出表格数值（调用 plot.js 的求根/DFT）
   入口：plan(subject, {tags, text}) → 生成清单（含就绪/缺失判定与可直接落地的绘图字段）

   依赖：plot.js（MQP）与 transforms.js（MQT），浏览器里需先加载这两个脚本；
        Node 下内部按需 require。本文件顶层不接触 canvas / DOM。
   ========================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MQG = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const isNode = (typeof module !== 'undefined' && !!module.exports);
  const g = (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : {});
  const MQP = () => isNode ? require('./plot.js') : g.MQP;
  const MQT = () => isNode ? require('./transforms.js') : g.MQT;

  /* =========================================================
     一、规则层：标签 → 生成项
     R(plots, tables, need)
       plots 图型id  ct 时域波形 / dt 离散杆图 / spectrum 频谱 / bode 幅频相频
                    polezero 零极图 / conv 卷积图解
       tables 表型id values 关键值 / spectrum 频谱关键点 / pairs 命中变换对 /
                    poles 极点稳定性 / conv 卷积逐项 / sampling 抽样混叠 /
                    freqs 频率响应关键点 / coeffs 系数特征根
       need  需要的参数：ct 连续信号 / dt 离散序列 / tf 系统函数 / diff 差分微分方程 /
                    samp 采样参数 / pair 卷积两路信号 / signal 任一信号
     ========================================================= */
  const PLOT_LABEL = {
    ct: '时域波形', dt: '离散杆图', spectrum: '频谱', bode: '幅频/相频',
    polezero: '零极点图', conv: '卷积图解',
  };
  const TABLE_LABEL = {
    values: '关键值表', spectrum: '频谱关键点', pairs: '命中的变换对',
    poles: '极点与稳定性', conv: '卷积逐项表', sampling: '抽样与混叠判定',
    freqs: '频率响应关键点', coeffs: '系数与特征根',
  };
  const PLOT_NEED = { ct: ['ct'], dt: ['dt'], spectrum: ['dt'], bode: ['tf'], polezero: ['tf'], conv: ['pair'] };
  const TABLE_NEED = {
    values: ['signal'], spectrum: ['dt'], pairs: ['signal'], poles: ['tf'],
    conv: ['pair'], sampling: ['samp'], freqs: ['tf'], coeffs: ['diff'],
  };
  const R = (plots, tables, need) => ({ plots: plots || [], tables: tables || [], need: need || [] });

  const RULES = {
    ss: {
      '单位冲激': R(['ct'], ['values'], ['ct']),
      '单位阶跃': R(['ct'], ['values'], ['ct']),
      '冲激偶': R(['ct'], ['values'], ['ct']),
      '复指数信号': R(['ct'], ['values'], ['ct']),
      'Sa 函数': R(['ct'], ['values'], ['ct']),
      '矩形脉冲': R(['ct'], ['values'], ['ct']),
      '三角脉冲': R(['ct'], ['values'], ['ct']),
      '符号函数': R(['ct'], ['values'], ['ct']),
      '傅里叶级数': R(['spectrum'], ['spectrum', 'pairs'], ['ct']),
      '傅里叶变换': R(['spectrum'], ['spectrum', 'pairs'], ['ct']),
      '频谱': R(['spectrum'], ['spectrum'], ['ct']),
      '幅度谱': R(['spectrum'], ['spectrum'], ['ct']),
      '相位谱': R(['spectrum'], ['spectrum'], ['ct']),
      '拉普拉斯变换': R(['polezero'], ['poles'], ['tf']),
      '收敛域': R(['polezero'], ['poles'], ['tf']),
      '变换性质': R([], ['pairs'], []),
      '线性时不变': R([], [], []),
      '因果': R([], ['poles'], ['tf']),
      '稳定': R([], ['poles'], ['tf']),
      '卷积': R(['conv'], ['conv'], ['pair']),
      '冲激响应': R(['ct', 'conv'], ['values'], ['pair']),
      '阶跃响应': R(['ct'], ['values'], ['ct']),
      '系统函数': R(['polezero', 'bode'], ['poles', 'freqs'], ['tf']),
      '零极点': R(['polezero'], ['poles'], ['tf']),
      '频率响应': R(['bode'], ['freqs'], ['tf']),
      '全通': R(['polezero', 'bode'], ['poles'], ['tf']),
      '无失真传输': R(['bode'], ['freqs'], ['tf']),
      '抽样定理': R(['spectrum'], ['sampling'], ['samp']),
      '频谱混叠': R(['spectrum'], ['sampling'], ['samp']),
      '调制': R(['spectrum'], ['spectrum'], ['ct']),
      '滤波器': R(['bode'], ['freqs'], ['tf']),
      '微分方程': R(['polezero'], ['coeffs'], ['diff']),
      '状态方程': R([], ['coeffs'], ['diff']),
      '信号分解': R(['ct'], ['values'], ['ct']),
    },
    dsp: {
      '单位脉冲序列': R(['dt'], ['values'], ['dt']),
      '单位阶跃序列': R(['dt'], ['values'], ['dt']),
      '指数序列': R(['dt'], ['values'], ['dt']),
      '复指数序列': R(['dt'], ['values'], ['dt']),
      '周期序列': R(['dt'], ['values'], ['dt']),
      '序列运算': R(['dt'], ['values'], ['dt']),
      'DTFT': R(['spectrum'], ['spectrum'], ['dt']),
      'DFT': R(['spectrum'], ['spectrum'], ['dt']),
      'FFT': R(['spectrum'], ['spectrum'], ['dt']),
      'Z变换': R(['dt', 'polezero'], ['values', 'poles'], ['dt', 'tf']),
      '循环卷积': R(['conv'], ['conv'], ['pair']),
      '线性卷积': R(['conv'], ['conv'], ['pair']),
      '频谱泄漏': R(['spectrum'], ['spectrum'], ['dt']),
      '频率分辨率': R([], ['sampling'], ['samp']),
      '线性移不变': R([], [], []),
      '因果稳定': R([], ['poles'], ['tf']),
      '差分方程': R(['polezero'], ['coeffs'], ['diff']),
      '系统函数': R(['polezero', 'bode'], ['poles', 'freqs'], ['tf']),
      '零极点': R(['polezero'], ['poles'], ['tf']),
      '频率响应': R(['bode'], ['freqs'], ['tf']),
      '全通': R(['polezero', 'bode'], ['poles'], ['tf']),
      '最小相位': R(['polezero'], ['poles'], ['tf']),
      'IIR': R(['bode'], ['coeffs', 'freqs'], ['diff']),
      'FIR': R(['bode'], ['coeffs', 'freqs'], ['diff']),
      '采样': R(['spectrum'], ['sampling'], ['samp']),
      '抽取': R([], ['sampling'], ['samp']),
      '内插': R([], ['sampling'], ['samp']),
      '多速率': R([], ['sampling'], ['samp']),
      '窗函数': R(['ct', 'spectrum'], ['values'], ['ct']),
      'DFT 对称性': R([], ['spectrum'], ['dt']),
      'FFT 算法': R([], ['spectrum'], ['dt']),
    },
  };

  const tagKey = t => String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
  function tagRule(subject, tag) {
    const m = RULES[subject];
    if (!m) return null;
    const k = tagKey(tag);
    if (m[k]) return m[k];
    const flat = k.replace(/\s+/g, '');
    const hit = Object.keys(m).find(x => x.replace(/\s+/g, '') === flat);
    return hit ? m[hit] : null;
  }
  function drivableTags(subject) {
    const m = RULES[subject] || {};
    return Object.keys(m).filter(k => m[k].plots.length || m[k].tables.length);
  }

  /* =========================================================
     二、LaTeX 子集 → 纯文本表达式（供 plot.js compileExpr 使用）
     ========================================================= */
  function normalizeTex(s) {
    return String(s == null ? '' : s)
      .replace(/\\left|\\right|\\!|\\,|\\;|\\:/g, '')
      .replace(/\\(?:mathrm|operatorname|text)\{([^{}]*)\}/g, '$1')
      .replace(/\\cdot|\\times/g, '*')
      .replace(/\\pi/g, ' pi ')
      .replace(/\\omega/g, ' w ')
      .replace(/\\Omega/g, ' W ')
      .replace(/\\delta/g, 'delta')
      .replace(/\\(sin|cos|tan|arctan|arcsin|arccos|sinh|cosh|tanh|exp|ln|log|log10|sqrt|abs|sign)/g, '$1')
      .trim();
  }

  // 最内层 \frac{a}{b} → ((a)/(b))，循环直到没有
  function fracToExpr(s) {
    let out = String(s);
    for (let guard = 0; guard < 40; guard++) {
      const m = /\\(?:d|t)?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/.exec(out);
      if (!m) break;
      out = out.slice(0, m.index) + '((' + m[1] + ')/(' + m[2] + '))' + out.slice(m.index + m[0].length);
    }
    return out;
  }

  // 顶层分子/分母分离：优先 \frac{..}{..}，否则看顶层 /
  function splitNumDen(s) {
    const str = String(s);
    const fi = str.search(/\\(?:d|t)?frac/);
    if (fi >= 0) {
      const p0 = str.indexOf('{', fi);
      const read = start => {
        let d = 0, j = start;
        for (; j < str.length; j++) {
          if (str[j] === '{') d++;
          else if (str[j] === '}') { d--; if (!d) break; }
        }
        if (d !== 0) throw new Error('花括号不匹配');
        return { text: str.slice(start + 1, j), end: j };
      };
      const a = read(p0);
      const p1 = str.indexOf('{', a.end + 1);
      if (p1 < 0) throw new Error('分式缺少分母');
      const b = read(p1);
      return { num: str.slice(0, fi) + a.text, den: b.text };
    }
    let depth = 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === '/' && depth === 0) return { num: str.slice(0, i), den: str.slice(i + 1) };
    }
    return { num: str, den: '1' };
  }

  const FUNC_NAMES = new Set([
    'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'arcsin', 'arccos', 'arctan',
    'sinh', 'cosh', 'tanh', 'exp', 'ln', 'log', 'log10', 'sqrt', 'abs', 'sign',
    'floor', 'ceil', 'round', 'u', 'rect', 'tri', 'sinc', 'delta',
  ]);
  const lastIdent = out => {
    const m = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(out);
    return m ? m[1] : '';
  };
  // 隐式乘法：按相邻原子补 *；函数名与 ( 之间不补
  function insertMul(src) {
    const s = String(src);
    let out = '';
    let i = 0;
    let prev = 'none';   // none | num | id | close | open | op
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if ('+-*/^,'.indexOf(c) >= 0) { out += c; prev = 'op'; i++; continue; }
      if (c === '(') {
        if (prev === 'num' || prev === 'close') out += '*';
        else if (prev === 'id' && !FUNC_NAMES.has(lastIdent(out))) out += '*';
        out += '('; prev = 'open'; i++; continue;
      }
      if (c === ')') { out += ')'; prev = 'close'; i++; continue; }
      if (/[0-9.]/.test(c)) {
        const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(s.slice(i));
        if (!m) { out += c; prev = 'none'; i++; continue; }
        if (prev === 'id' || prev === 'close' || prev === 'num') out += '*';
        out += m[0]; prev = 'num'; i += m[0].length; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
        if (prev === 'num' || prev === 'close' || prev === 'id') out += '*';
        out += m[0]; prev = 'id'; i += m[0].length; continue;
      }
      if (c === '_' || c === '{' || c === '}') { i++; continue; }
      out += c; prev = 'none'; i++;
    }
    return out;
  }

  /* 一段 LaTeX 信号表达式 → plot.js 可编译的纯文本；失败返回 {ok:false} */
  function latexToExpr(src) {
    const raw = String(src == null ? '' : src).trim().replace(/^\$+|\$+$/g, '').replace(/^=+/, '');
    if (!raw) return { ok: false, error: '空表达式' };
    if (/[^A-Za-z]j(?![A-Za-z])|\bj\b/.test(raw)) return { ok: false, error: '含虚数 j，暂不支持' };
    try {
      let s = normalizeTex(raw);
      s = fracToExpr(s);
      s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)');
      s = s.replace(/e\s*\^\s*\{([^{}]*)\}/g, 'exp($1)');
      s = s.replace(/\^\s*\{([^{}]*)\}/g, '^($1)');
      s = s.replace(/\{([^{}]*)\}/g, '($1)');
      s = s.replace(/\\[a-zA-Z]+/g, '');
      s = s.replace(/\[/g, '(').replace(/\]/g, ')');   // 离散序列写法 x[n] / u[n] → x(n) / u(n)
      s = insertMul(s);
      if (!s.trim()) return { ok: false, error: '无法转换' };
      const t = MQP().tryCompileExpr(s);
      if (!t.ok) return { ok: false, error: t.error };
      return { ok: true, expr: s };
    } catch (e) {
      return { ok: false, error: (e && e.message) || '转换失败' };
    }
  }

  /* =========================================================
     三、多项式（s / z）解析：LaTeX 子集 → 降幂系数数组
     内部用 Map<指数,系数>，天然支持 z^{-1} 这类负幂
     ========================================================= */
  const pmul = (a, b) => {
    const o = new Map();
    a.forEach((ca, ea) => b.forEach((cb, eb) => {
      const k = ea + eb;
      o.set(k, (o.get(k) || 0) + ca * cb);
    }));
    return o;
  };
  const padd = (a, b) => {
    const o = new Map(a);
    b.forEach((cb, eb) => o.set(eb, (o.get(eb) || 0) + cb));
    return o;
  };
  const ppow = (base, n) => {
    let r = new Map([[0, 1]]);
    for (let i = 0; i < n; i++) r = pmul(r, base);
    return r;
  };

  function splitTop(s) {
    const out = [];
    let cur = '', depth = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      // 圆括号与方括号都视为一层：避免把 y[n-1] 里的 '-' 误判成项符号
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      if (depth === 0 && (ch === '+' || ch === '-')) {
        const prev = cur.trim();
        if (ch === '-' && (prev === '' || /[+\-*/^(]$/.test(prev))) { cur += ch; continue; }
        if (prev !== '') out.push(cur);
        cur = ch === '-' ? '-' : '';
        continue;
      }
      cur += ch;
    }
    if (cur.trim() !== '') out.push(cur);
    return out;
  }

  function termPoly(term, v) {
    let s = term.trim().replace(/\s+/g, '');
    if (!s) throw new Error('空项');
    let sign = 1;
    if (s[0] === '-') { sign = -1; s = s.slice(1); }
    else if (s[0] === '+') s = s.slice(1);
    let acc = new Map([[0, 1]]);
    let i = 0;
    const isVar = j => s.slice(j, j + v.length) === v
      && !/[A-Za-z0-9_]/.test(s[j + v.length] || '')
      && (j === 0 || !/[A-Za-z0-9_]/.test(s[j - 1] || ''));
    while (i < s.length) {
      const c = s[i];
      if (c === '*') { i++; continue; }
      if (c === '(') {
        let d = 1, j = i + 1;
        for (; j < s.length; j++) {
          if (s[j] === '(') d++;
          else if (s[j] === ')') { d--; if (!d) break; }
        }
        if (d !== 0) throw new Error('括号不匹配');
        const inner = polyInVar(s.slice(i + 1, j), v);
        let pow = 1;
        j++;
        if (s[j] === '^') {
          const m = /^\^(-?\d+)/.exec(s.slice(j));
          if (!m) throw new Error('括号幂次无法解析');
          pow = Number(m[1]); j += m[0].length;
        }
        if (pow < 0) throw new Error('括号的负幂次无法解析');
        acc = pmul(acc, ppow(inner, pow));
        i = j; continue;
      }
      if ((c >= '0' && c <= '9') || c === '.') {
        const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(s.slice(i));
        if (!m) throw new Error('数字格式错误');
        acc = pmul(acc, new Map([[0, Number(m[0])]]));
        i += m[0].length; continue;
      }
      if (isVar(i)) {
        i += v.length;
        let n = 1;
        if (s[i] === '^') {
          const m = /^\^(-?\d+)/.exec(s.slice(i));
          if (!m) throw new Error('幂次无法解析');
          n = Number(m[1]); i += m[0].length;
        }
        acc = pmul(acc, new Map([[n, 1]]));
        continue;
      }
      throw new Error('无法解析的片段：' + c);
    }
    return sign < 0 ? new Map([...acc].map(([e, c]) => [e, -c])) : acc;
  }

  function polyInVar(src, v) {
    let s = String(src).replace(/\s+/g, '').replace(/[{}\\]/g, '');
    if (!s) throw new Error('空多项式');
    s = insertMul(s);   // 支持 LaTeX 常见的隐式乘法：0.9z^{-1} → 0.9*z^-1
    const terms = splitTop(s);
    if (!terms.length) throw new Error('空多项式');
    let sum = new Map();
    for (const t of terms) sum = padd(sum, termPoly(t, v));
    return sum;
  }

  function trimZeros(a) {
    let i = 0;
    while (i < a.length - 1 && Math.abs(a[i]) < 1e-12) i++;
    return a.slice(i);
  }

  // Map（可含负幂）→ 降幂系数数组；shift = 乘了多少次 v 以消掉负幂
  function mapToCoeffs(m) {
    const clean = new Map();
    m.forEach((c, e) => { if (Math.abs(c) > 1e-12) clean.set(e, c); });
    if (!clean.size) return { coeffs: [0], shift: 0 };
    let minE = Infinity, maxE = -Infinity;
    clean.forEach((c, e) => { if (e < minE) minE = e; if (e > maxE) maxE = e; });
    const shift = minE < 0 ? -minE : 0;
    const out = new Array(maxE + shift + 1).fill(0);
    clean.forEach((c, e) => { out[e + shift] += c; });
    return { coeffs: trimZeros(out.slice().reverse()), shift };
  }

  /* 有理式 → {num, den}：分子分母同乘 z^shift，保证都是正幂多项式。
     \frac{1}{1-0.9z^{-1}} → num [1,0]（即 z）、den [1,-0.9]（即 z-0.9） */
  function rationalCoeffs(src, v) {
    const f = splitNumDen(normalizeTex(src));
    const numM = polyInVar(f.num, v);
    const denM = polyInVar(f.den, v);
    let minE = 0;
    numM.forEach((c, e) => { if (Math.abs(c) > 1e-12 && e < minE) minE = e; });
    denM.forEach((c, e) => { if (Math.abs(c) > 1e-12 && e < minE) minE = e; });
    const shift = -minE;
    const toDesc = m => {
      let maxE = -Infinity;
      m.forEach((c, e) => { if (Math.abs(c) > 1e-12 && e + shift > maxE) maxE = e + shift; });
      if (maxE === -Infinity) return [0];
      const out = new Array(maxE + 1).fill(0);
      m.forEach((c, e) => { out[e + shift] += c; });
      return trimZeros(out.slice().reverse());
    };
    return { num: toDesc(numM), den: toDesc(denM) };
  }

  /* =========================================================
     四、抽取层：题面 → 参数
     ========================================================= */
  function plain(t) { return String(t).replace(/[${}\\]/g, ' '); }

  // LaTeX 间距命令 \, \; \! \: \(空格) 内含标点（如逗号），会干扰按标点的字段切分，先统一换成空格
  function stripSpacing(s) { return String(s == null ? '' : s).replace(/\\([ ,;:!])/g, ' '); }

  function extractSignals(text) {
    text = stripSpacing(text);
    const ct = [], dt = [];
    const re = /([A-Za-z][A-Za-z0-9_]*)\s*\(\s*(t|n)\s*\)\s*=\s*([^$，,;；\n]+)/g;
    let m;
    while ((m = re.exec(text))) {
      const cv = latexToExpr(m[3]);
      if (!cv.ok) continue;
      const rec = { name: m[1] + '(' + m[2] + ')', expr: cv.expr, raw: m[3].trim() };
      const list = m[2] === 't' ? ct : dt;
      if (!list.some(x => x.name === rec.name)) list.push(rec);
    }
    // 离散序列常见写法用方括号：x[n] = 0.8^n u[n]
    const reBr = /([A-Za-z][A-Za-z0-9_]*)\s*\[\s*(n)\s*\]\s*=\s*([^$，,;；\n]+)/g;
    while ((m = reBr.exec(text))) {
      const cv = latexToExpr(m[3]);
      if (!cv.ok) continue;
      const rec = { name: m[1] + '[' + m[2] + ']', expr: cv.expr, raw: m[3].trim() };
      if (!dt.some(x => x.name === rec.name)) dt.push(rec);
    }
    // 有限长序列的列举写法：x[n] = \{1,1,1,1,0,0,0,0\}
    // 用冲激串等价表达 x[n] = Σ a_k δ(n−k)，plot.js 的 delta() 恰好只在该点取 1
    const reList = /([A-Za-z][A-Za-z0-9_]*)\s*\[\s*n\s*\]\s*=\s*\\?\{([^{}\\]+)\\?\}/g;
    while ((m = reList.exec(text))) {
      const vals = m[2].split(/[,，;；\s]+/).map(x => x.trim()).filter(Boolean).map(Number);
      if (!vals.length || vals.some(x => !isFinite(x))) continue;
      const terms = vals.map((v, k) => (k === 0 ? v + '*delta(n)' : v + '*delta(n-' + k + ')')).join('+');
      const rec = { name: m[1] + '[n]', expr: terms, raw: '\\{' + m[2].trim() + '\\}', seq: vals.slice() };
      if (!dt.some(x => x.name === rec.name)) dt.push(rec);
    }
    return { ct, dt };
  }

  function extractTF(text) {
    text = stripSpacing(text);
    const cands = [];
    let m;
    const reSZ = /([A-Za-z][A-Za-z0-9_]*)\s*\(\s*(s|z)\s*\)\s*=\s*([^$，,;；\n]+)/g;
    while ((m = reSZ.exec(text))) cands.push({ name: m[1], v: m[2], rhs: m[3] });
    const reW = /([A-Za-z][A-Za-z0-9_]*)\s*\(\s*j\s*\\?omega\s*\)\s*=\s*([^$，,;；\n]+)/g;
    while ((m = reW.exec(text))) cands.push({ name: m[1], v: 's', rhs: m[2] });
    const reEW = /([A-Za-z][A-Za-z0-9_]*)\s*\(\s*e\s*\^\s*\{?\s*j\s*\\?omega\s*\}?\s*\)\s*=\s*([^$，,;；\n]+)/g;
    while ((m = reEW.exec(text))) cands.push({ name: m[1], v: 'z', rhs: m[2] });
    for (const c of cands) {
      try {
        let rhs = c.rhs;
        if (c.v === 's') rhs = rhs.replace(/j\s*\\?omega/g, 's').replace(/\\?jw/g, 's');
        if (c.v === 'z') rhs = rhs.replace(/e\s*\^\s*\{?\s*j\s*\\?omega\s*\}?/g, 'z');
        const rc = rationalCoeffs(rhs, c.v);
        if (rc.den.length >= 1 && rc.num.length >= 1 && rc.den.length + rc.num.length > 2) {
          return { name: c.name, domain: c.v === 'z' ? 'z' : 's', num: rc.num, den: rc.den, raw: c.rhs.trim() };
        }
      } catch (e) { /* 换下一个候选 */ }
    }
    return null;
  }

  function parseDelaySide(side, sym) {
    const terms = splitTop(String(side).replace(/\s+/g, ''));
    const map = new Map();
    for (const t of terms) {
      const mm = /^([+-]?)(\d*\.?\d*)\*?([A-Za-z])\[\s*n\s*(?:-\s*(\d+))?\s*\]$/.exec(t);
      if (!mm || mm[3] !== sym) return null;
      const sign = mm[1] === '-' ? -1 : 1;
      const coef = (mm[2] === '' || mm[2] === '.' || mm[2] == null) ? 1 : Number(mm[2]);
      const k = mm[4] ? Number(mm[4]) : 0;
      map.set(k, (map.get(k) || 0) + sign * coef);
    }
    return map;
  }
  function finishDiff(aMap, bMap) {
    const aK = [...aMap.keys()], bK = [...bMap.keys()];
    const M = Math.max(0, ...aK, ...bK);
    const a = new Array(M + 1).fill(0), b = new Array(M + 1).fill(0);
    aMap.forEach((c, k) => { a[k] = c; });
    bMap.forEach((c, k) => { b[k] = c; });
    // H(z)=B(z)/A(z)。数组 a[k] 为 y[n−k] 的系数（按 z 的负幂升序）。
    // 乘 z^M 转成 z 正幂多项式后，最高次项对应的恰是 k=0 的系数，
    // 因此「降幂系数数组」就是原数组本身（不能反转）。
    const zText = arr => {
      let out = '';
      arr.forEach((c, k) => {
        if (Math.abs(c) < 1e-12) return;
        const sign = c < 0 ? ' − ' : (out ? ' + ' : '');
        const mag = Math.abs(c);
        const zp = k === 0 ? '' : (k === 1 ? 'z^-1' : 'z^-' + k);
        out += sign + ((mag === 1 && k > 0) ? '' : f3(mag)) + zp;
      });
      return out || '0';
    };
    return {
      domain: 'z', order: M, a: trimZeros(a), b: trimZeros(b),
      num: trimZeros(b.slice()), den: trimZeros(a.slice()),
      raw: 'H(z) = (' + zText(b) + ') / (' + zText(a) + ')',
    };
  }
  function extractDiffEq(text) {
    text = stripSpacing(text);
    const m1 = /y\s*\[\s*n\s*\]([^$=]*)=\s*([^$，,;；\n]+)/.exec(text);
    if (m1) {
      const lhs = parseDelaySide('y[n]' + m1[1], 'y');
      const rhs = parseDelaySide(m1[2], 'x');
      if (lhs && rhs) return finishDiff(lhs, rhs);
    }
    const m2 = /y\s*\[\s*n\s*\]\s*=\s*([^$，,;；\n]+)/.exec(text);
    if (m2) {
      const rhs = parseDelaySide(m2[1], 'x');
      if (rhs) return finishDiff(new Map([[0, 1]]), rhs);
    }
    return null;
  }

  function extractSampling(text) {
    const p = plain(text);
    const num = re => { const m = re.exec(p); return m ? Number(m[1]) : null; };
    let fs = num(/f\s*_?\s*s\s*=\s*([0-9.]+)/);
    const fm = num(/f\s*_?\s*m\s*=\s*([0-9.]+)/);
    const wm = num(/w\s*_?\s*m\s*=\s*([0-9.]+)/);
    const Ts = num(/T\s*_?\s*s\s*=\s*([0-9.]+)/);
    const f0 = num(/f\s*_?\s*0\s*=\s*([0-9.]+)/);
    const N = num(/N\s*=\s*([0-9]+)/);
    const kmax = num(/k\s*_?\s*max\s*=\s*([0-9]+)/);
    if (fs == null && Ts) fs = 1 / Ts;
    let fmb = fm;
    if (fmb == null && wm != null) fmb = wm / (2 * Math.PI);
    if (fs == null && fmb == null && N == null && kmax == null) return null;
    return { fs, fm: fmb, f0, N, kMax: kmax };
  }

  function extractParams(text) {
    const t = String(text == null ? '' : text);
    const sig = extractSignals(t);
    const tf = extractTF(t);
    const diff = extractDiffEq(t);
    const samp = extractSampling(t);
    const notes = [];
    if (tf && /\^\{?-\s*1/.test(tf.raw)) notes.push('系统函数含 z⁻¹，已归一化为 z 的正幂系数');
    return { ct: sig.ct, dt: sig.dt, tf, diff, samp, notes };
  }

  /* =========================================================
     五、表格层：参数 → 表格数据
     返回 { title, head:[], rows:[[]], note:'', tex?:true } 或 null
     ========================================================= */
  const f3 = x => {
    if (!isFinite(x)) return '—';
    const r = Math.abs(x) < 1e-12 ? 0 : x;
    return (Math.round(r * 1000) / 1000).toString();
  };
  const cplx = p => (Math.abs(p.im) < 1e-9 ? f3(p.re) : f3(p.re) + (p.im > 0 ? ' + j' : ' − j') + f3(Math.abs(p.im)));

  function hAt(coeffs, w) {
    const nv = MQP().evalPoly(coeffs, { re: 0, im: w });
    return { re: nv.re, im: nv.im };
  }
  function respAt(num, den, w) {
    const nv = hAt(num, w), dv = hAt(den, w);
    const dd = dv.re * dv.re + dv.im * dv.im;
    if (!dd) return { mag: Infinity, ph: 0 };
    const re = (nv.re * dv.re + nv.im * dv.im) / dd;
    const im = (nv.im * dv.re - nv.re * dv.im) / dd;
    return { mag: Math.hypot(re, im), ph: Math.atan2(im, re) * 180 / Math.PI };
  }

  function polesTable(params) {
    const tf = params.tf || params.diff;
    if (!tf) return null;
    const p = MQP().polyRoots(tf.den);
    const z = MQP().polyRoots(tf.num);
    const isZ = tf.domain === 'z';
    const rows = [];
    p.forEach((r, i) => {
      const mag = Math.hypot(r.re, r.im);
      const stable = isZ ? mag < 1 - 1e-9 : r.re < -1e-9;
      const edge = isZ ? Math.abs(mag - 1) < 1e-9 : Math.abs(r.re) < 1e-9;
      rows.push(['极点 ' + (i + 1), cplx(r), isZ ? f3(mag) : f3(r.re), edge ? '临界' : (stable ? '稳定' : '不稳定')]);
    });
    z.forEach((r, i) => rows.push(['零点 ' + (i + 1), cplx(r), isZ ? f3(Math.hypot(r.re, r.im)) : f3(r.re), '零点']));
    if (!rows.length) rows.push(['—', '—', '—', '分母为常数，无极点']);
    return {
      title: '极点与稳定性',
      head: ['#', '位置', isZ ? '模 |z|' : '实部', '判定'],
      rows,
      note: (isZ ? '因果系统：全部极点 |z|<1 才稳定' : '连续系统：全部极点 Re<0 才稳定')
        + '（' + (tf.domain === 'z' ? 'H(z)' : 'H(s)') + ' = ' + tf.raw + '）',
    };
  }

  function freqsTable(params) {
    const tf = params.tf || params.diff;
    if (!tf) return null;
    const wMax = tf.domain === 'z' ? Math.PI : 10;
    const n = 400;
    let pk = { w: 0, mag: -1 };
    for (let i = 1; i <= n; i++) {
      const w = i / n * wMax;
      const m = respAt(tf.num, tf.den, w).mag;
      if (m > pk.mag) pk = { w, mag: m };
    }
    const pick = [0, pk.w, 1, wMax];
    const seen = new Set();
    const rows = pick.filter(w => {
      const k = f3(w);
      if (seen.has(k)) return false;
      seen.add(k); return true;
    }).map(w => {
      const r = respAt(tf.num, tf.den, w);
      const label = w === 0 ? '0（直流）' : (w === pk.w ? f3(w) + '（峰值）' : f3(w));
      return [label, f3(r.mag), f3(r.ph)];
    });
    return {
      title: '频率响应关键点',
      head: ['频率 ω', '|H|', '相位 (°)'],
      rows,
      note: '按 400 点扫描取峰值；' + (tf.domain === 'z' ? 'z 域 ω∈[0,π]' : 's 域 ω∈[0,10]'),
    };
  }

  function valuesTable(params) {
    const sig = params.dt[0] || params.ct[0];
    if (!sig) return null;
    const isDt = !!params.dt[0];
    const t = MQP().tryCompileExpr(sig.expr);
    if (!t.ok) return null;
    const xs = isDt ? [0, 1, 2, 3, 4, 5] : [-1, 0, 1, 2, 3, 4];
    const rows = xs.map(x => {
      let y;
      try { y = t.fn({ t: x, n: x, w: x }); } catch (e) { y = NaN; }
      return [String(x), f3(y)];
    });
    return {
      title: '关键值表：' + sig.name,
      head: [isDt ? 'n' : 't', sig.name],
      rows,
      note: '由题面表达式 ' + sig.expr + ' 代入求得',
    };
  }

  function spectrumTable(params) {
    const sig = params.dt[0];
    if (!sig) return null;
    const t = MQP().tryCompileExpr(sig.expr);
    if (!t.ok) return null;
    const N = Math.max(4, Math.min(16, params.samp && params.samp.kMax != null ? params.samp.kMax + 1 : 8));
    const seq = [];
    for (let i = 0; i < N; i++) {
      let y;
      try { y = t.fn({ n: i, t: i, w: i }); } catch (e) { y = 0; }
      seq.push(y);
    }
    const D = MQP().dft(seq, N - 1);
    return {
      title: 'DFT 频谱关键点（' + N + ' 点）',
      head: ['k', '|X[k]|', '∠X[k] (°)'],
      rows: D.map(d => [String(d.k), f3(d.mag), f3(d.phase * 180 / Math.PI)]),
      note: '对 n=0…' + (N - 1) + ' 的 ' + sig.name + ' 做 N=' + N + ' 点 DFT',
    };
  }

  function convTable(params) {
    const pair = pairOf(params);
    if (!pair) return null;
    const a = MQP().tryCompileExpr(pair.a.expr), b = MQP().tryCompileExpr(pair.b.expr);
    if (!a.ok || !b.ok) return null;
    if (pair.mode === 'discrete') {
      const nMax = 6, rows = [];
      for (let n = 0; n <= nMax; n++) {
        let s = 0;
        for (let k = 0; k <= n; k++) {
          let xv, hv;
          try { xv = a.fn({ n: k, t: k, w: k }); } catch (e) { xv = 0; }
          try { hv = b.fn({ n: n - k, t: n - k, w: n - k }); } catch (e) { hv = 0; }
          s += (xv || 0) * (hv || 0);
        }
        rows.push([String(n), f3(s)]);
      }
      return {
        title: '卷积和逐项结果 y[n]=Σ x[k]h[n−k]',
        head: ['n', 'y[n]'], rows,
        note: '取 n=0…' + nMax + '：y[n] = Σ_0^n x[k]·h[n−k]',
      };
    }
    const rows = [];
    [-1, 0, 0.5, 1, 1.5, 2, 3].forEach(tv => {
      const M = 200, span = 6;
      let s = 0;
      for (let i = 0; i <= M; i++) {
        const tau = -span + (2 * span) * i / M;
        let xv, hv;
        try { xv = a.fn({ t: tau, n: tau, w: tau }); } catch (e) { xv = 0; }
        try { hv = b.fn({ t: tv - tau, n: tv - tau, w: tv - tau }); } catch (e) { hv = 0; }
        s += (xv || 0) * (hv || 0);
      }
      rows.push([f3(tv), f3(s * (2 * span) / M)]);
    });
    return {
      title: '卷积积分数值采样 y(t)=∫x(τ)h(t−τ)dτ',
      head: ['t', 'y(t)（近似）'], rows,
      note: 'τ∈[−6,6] 共 200 点求和（数值近似，非解析值）',
    };
  }

  function samplingTable(params) {
    const s = params.samp;
    if (!s) return null;
    const rows = [];
    if (s.fm != null) rows.push(['信号最高频率 f_m', f3(s.fm)]);
    if (s.fs != null) rows.push(['抽样频率 f_s', f3(s.fs)]);
    if (s.fm != null) {
      rows.push(['奈奎斯特率 2f_m', f3(2 * s.fm)]);
      if (s.fs != null) {
        const ok = s.fs > 2 * s.fm;
        rows.push(['眉量 f_s − 2f_m', f3(s.fs - 2 * s.fm)]);
        rows.push(['是否满足抽样定理', ok ? '满足，不混叠' : '不满足，将混叠']);
        if (s.f0 != null && !ok) {
          rows.push(['f₀=' + f3(s.f0) + ' 的混叠频率', f3(Math.abs(s.f0 - s.fs * Math.round(s.f0 / s.fs)))]);
        }
      }
    }
    if (s.N != null) rows.push(['点数 N', String(s.N)]);
    if (s.fs != null && s.N != null) rows.push(['频率分辨率 Δf = f_s/N', f3(Math.abs(s.fs / s.N))]);
    if (!rows.length) return null;
    return { title: '抽样与混叠判定', head: ['参数', '值'], rows, note: '判定依据 f_s > 2f_m；未给出的量不列出' };
  }

  function coeffsTable(params) {
    const d = params.diff;
    if (!d) return null;
    const rows = [];
    d.a.forEach((c, k) => rows.push([k ? 'a' + k + '（y[n−' + k + ']）' : 'a0（y[n]）', f3(c)]));
    d.b.forEach((c, k) => rows.push([k ? 'b' + k + '（x[n−' + k + ']）' : 'b0（x[n]）', f3(c)]));
    MQP().polyRoots(d.den).forEach((r, i) => {
      rows.push(['极点 ' + (i + 1), cplx(r) + '（' + (Math.hypot(r.re, r.im) < 1 - 1e-9 ? '稳定' : '不稳定') + '）']);
    });
    return {
      title: '差分方程系数与特征根',
      head: ['项', '系数 / 根'],
      rows,
      note: '按 y[n]−Σ a_k y[n−k] = Σ b_k x[n−k] 约定；稳定性看极点是否在单位圆内',
    };
  }

  function pairsTable(params) {
    const T = MQT();
    if (!T || !T.PAIRS) return null;
    const hay = [];
    params.ct.forEach(x => { hay.push(x.raw); hay.push(x.expr); });
    params.dt.forEach(x => { hay.push(x.raw); hay.push(x.expr); });
    const norm = s => String(s).replace(/\s+/g, '').replace(/^\$|\$$/g, '');
    const hits = T.PAIRS.filter(p => hay.some(h => {
      const H = norm(h);
      return H && (norm(p.time) === H || H.indexOf(norm(p.time)) >= 0);
    }));
    if (!hits.length) return null;
    return {
      title: '命中的常用变换对（共 ' + hits.length + ' 条）',
      head: ['名称', '时域', '变换域', '说明'],
      rows: hits.map(p => [p.name, '$' + p.time + '$', '$' + p.transform + '$', p.note || '']),
      tex: true,
      note: '按题面表达式与速查表逐条比对（确定性字符串匹配）',
    };
  }

  const TABLE_BUILDERS = {
    values: valuesTable, spectrum: spectrumTable, pairs: pairsTable, poles: polesTable,
    conv: convTable, sampling: samplingTable, freqs: freqsTable, coeffs: coeffsTable,
  };
  function buildTable(kind, params) {
    const fn = TABLE_BUILDERS[kind];
    if (!fn) return null;
    try { return fn(params); } catch (e) { return null; }
  }

  /* =========================================================
     六、入口：plan(subject, {tags, text})
     ========================================================= */
  function pairOf(params) {
    if (params.dt.length >= 2) return { mode: 'discrete', a: params.dt[0], b: params.dt[1] };
    if (params.ct.length >= 2) return { mode: 'continuous', a: params.ct[0], b: params.ct[1] };
    return null;
  }
  function readyFor(need, params) {
    switch (need) {
      case 'ct': return params.ct.length >= 1;
      case 'dt': return params.dt.length >= 1;
      case 'tf': return !!params.tf || !!params.diff;
      case 'diff': return !!params.diff;
      case 'samp': return !!params.samp;
      case 'pair': return !!pairOf(params);
      case 'signal': return params.ct.length >= 1 || params.dt.length >= 1;
      default: return true;
    }
  }
  const NEED_TEXT = {
    ct: '连续信号表达式（如 $x(t)=e^{-2t}u(t)$）',
    dt: '离散序列表达式（如 $x[n]=0.8^nu[n]$）',
    tf: '系统函数（如 $H(s)=\\frac{1}{s+1}$ 或 $H(z)=\\frac{1}{1-0.9z^{-1}}$）',
    diff: '差分/微分方程（如 $y[n]-0.9y[n-1]=x[n]$）',
    samp: '抽样参数（$f_s$、$f_m$ 或 $N$）',
    pair: '两路信号（卷积需要 x 与 h 两个表达式）',
    signal: '至少一个信号表达式',
  };

  function plotFields(kind, params) {
    const tf = params.tf || params.diff;
    if (kind === 'ct') return { expr: params.ct[0].expr, tMin: '-1', tMax: '5', samples: '800', label: params.ct[0].name };
    if (kind === 'dt') return { expr: params.dt[0].expr, nMin: '-1', nMax: '15', label: params.dt[0].name };
    if (kind === 'spectrum') {
      const s = params.dt[0];
      const k = params.samp && params.samp.kMax != null ? params.samp.kMax : 7;
      return { from: 'time', mode: 'mag', expr: s.expr, nMin: '0', nMax: String(k), kMax: String(k), label: s.name + ' 的 DFT' };
    }
    if (kind === 'bode' || kind === 'polezero') {
      if (!tf) return null;
      const dom = tf.domain === 'z' ? 'z' : 's';
      return {
        num: '[' + tf.num.join(', ') + ']', den: '[' + tf.den.join(', ') + ']', domain: dom,
        label: (params.tf ? params.tf.name : 'H') + '(' + dom + ')',
      };
    }
    if (kind === 'conv') {
      const p = pairOf(params);
      if (!p) return null;
      if (p.mode === 'discrete') return { mode: 'discrete', exprA: p.a.expr, exprB: p.b.expr, varMin: '-1', varMax: '8', samples: '40' };
      return { mode: 'continuous', exprA: p.a.expr, exprB: p.b.expr, varMin: '-1', varMax: '3', samples: '400' };
    }
    return null;
  }

  function plan(subject, item) {
    const tags = (item && item.tags) || [];
    const text = [item && item.title, item && item.content, item && item.stem, item && item.analysis, item && item.knowledge]
      .filter(Boolean).join('\n');
    const params = extractParams(text);
    const hits = [];
    const plots = new Map(), tables = new Map();
    tags.forEach(t => {
      const r = tagRule(subject, t);
      if (!r) return;
      hits.push({ tag: t, plots: r.plots.slice(), tables: r.tables.slice() });
      r.plots.forEach(k => { if (!plots.has(k)) plots.set(k, []); plots.get(k).push(t); });
      r.tables.forEach(k => { if (!tables.has(k)) tables.set(k, []); tables.get(k).push(t); });
    });
    const items = [];
    plots.forEach((from, kind) => {
      const missing = (PLOT_NEED[kind] || []).filter(n => !readyFor(n, params));
      const fields = missing.length ? null : plotFields(kind, params);
      items.push({
        type: 'plot', kind, label: PLOT_LABEL[kind] || kind, from,
        ready: !!fields, fields,
        missing: fields ? [] : missing,
        hint: fields ? '' : missing.map(n => NEED_TEXT[n]).filter(Boolean).join('；'),
      });
    });
    tables.forEach((from, kind) => {
      const missing = (TABLE_NEED[kind] || []).filter(n => !readyFor(n, params));
      const data = missing.length ? null : buildTable(kind, params);
      items.push({
        type: 'table', kind, label: TABLE_LABEL[kind] || kind, from,
        ready: !!data, data,
        missing: data ? [] : missing,
        hint: data ? '' : (missing.length ? missing.map(n => NEED_TEXT[n]).filter(Boolean).join('；') : '表数据需补全参数后才能生成'),
      });
    });
    return { subject, tags, hits, items, params };
  }

  return {
    RULES, PLOT_LABEL, TABLE_LABEL, PLOT_NEED, TABLE_NEED,
    tagRule, drivableTags,
    latexToExpr, normalizeTex, fracToExpr, splitNumDen, insertMul,
    rationalCoeffs, polyInVar, mapToCoeffs,
    extractParams, extractSignals, extractTF, extractDiffEq, extractSampling,
    buildTable, plan, pairOf,
  };
});
