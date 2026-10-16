/* =========================================================
   信号与系统 / 数字信号处理复习本 · plot.js
   绘图模块：表达式编译、多项式求根、DFT 以及 canvas 绘图。

   设计要点
   ---------
   1) 纯逻辑（表达式解析/编译、polyRoots、evalPoly、polyMul/polyAdd、dft、dtft）
      与 DOM 完全无关，可在 Node 下直接单测；绘图（drawPlot）只在【被调用时】
      接触 canvas，文件顶层不执行任何 canvas 代码。
   2) 浏览器以经典脚本加载：<script src="./plot.js"></script>，命名空间挂到 window.MQP。
      同时兼容 Node：const MQP = require('./plot.js')。
      使用 import/export、任何构建工具或外部库/ CDN 均被禁止。

   —— 入口约定（供 conv.js 复用）——
   MQP.compileExpr(src) 必须【返回一个函数】f(vars)：
     * vars 形如 {t:1.5} / {n:3} / {w:2}，返回 number；
     * 表达式非法时抛 new Error('中文说明')；绝不返回对象，也绝不返回 null/undefined。
   MQP.tryCompileExpr(src) 返回 {ok:true, fn} 或 {ok:false, error:'中文说明'}。
   ========================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MQP = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* =========================================================
     一、表达式解析与编译（纯函数）
     支持：数字（含科学计数法）、+ - * / ^、括号、一元负号；
           常量 pi/PI/e；变量 t/n/w(omega)/f；
           一元函数 sin…round；信号 u/rect/tri/sinc/delta。
     ========================================================= */
  const CONSTS = { pi: Math.PI, PI: Math.PI, e: Math.E };
  // 变量别名：omega 归一到 w
  const VAR_NAMES = { t: 't', n: 'n', w: 'w', omega: 'w', f: 'f' };

  const FUNCS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    exp: Math.exp,
    ln: Math.log, log: Math.log, log10: Math.log10,
    sqrt: Math.sqrt, abs: Math.abs, sign: Math.sign,
    floor: Math.floor, ceil: Math.ceil, round: Math.round,
    // 常用信号：x>0→1，x<0→0，x=0 取 1
    u: function (x) { return x >= 0 ? 1 : 0; },
    // 矩形：|x|<0.5 为 1
    rect: function (x) { return Math.abs(x) < 0.5 ? 1 : 0; },
    // 三角形：|x|<=1 时 1-|x|
    tri: function (x) { return Math.abs(x) <= 1 ? 1 - Math.abs(x) : 0; },
    // 归一化 sinc：sin(pi x)/(pi x)，x=0 取 1
    sinc: function (x) {
      if (x === 0) return 1;
      const p = Math.PI * x;
      return Math.sin(p) / p;
    },
    // 单位冲击：x=0 为 1（绘图时按窄脉冲近似）
    delta: function (x) { return x === 0 ? 1 : 0; },
  };

  // 词法分析
  function tokenize(src) {
    const s = String(src);
    const out = [];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch >= '0' && ch <= '9' || ch === '.') {
        const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));
        if (!m) throw new Error('数字格式错误：' + s.slice(i, i + 8));
        out.push({ type: 'num', value: parseFloat(m[0]) });
        i += m[0].length;
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
        out.push({ type: 'ident', value: m[0] });
        i += m[0].length;
        continue;
      }
      if ('+-*/^(),'.indexOf(ch) >= 0) {
        const type = ch === '(' ? 'lparen' : ch === ')' ? 'rparen' : ch === ',' ? 'comma' : 'op';
        out.push({ type: type, value: ch });
        i++;
        continue;
      }
      throw new Error('无法识别的字符：' + ch);
    }
    return out;
  }

  // 语法分析（递归下降），返回 AST
  function parseTokens(tokens) {
    let pos = 0;
    const peek = () => tokens[pos];

    function parseExpr() {
      let node = parseTerm();
      let t = peek();
      while (t && t.type === 'op' && (t.value === '+' || t.value === '-')) {
        pos++;
        node = { op: t.value, a: node, b: parseTerm() };
        t = peek();
      }
      return node;
    }
    function parseTerm() {
      let node = parseUnary();
      let t = peek();
      while (t && t.type === 'op' && (t.value === '*' || t.value === '/')) {
        pos++;
        node = { op: t.value, a: node, b: parseUnary() };
        t = peek();
      }
      return node;
    }
    function parseUnary() {
      const t = peek();
      if (t && t.type === 'op' && (t.value === '-' || t.value === '+')) {
        pos++;
        const v = parseUnary();
        return t.value === '-' ? { op: 'neg', a: v } : v;
      }
      return parsePower();
    }
    function parsePower() {
      const base = parseAtom();
      const t = peek();
      if (t && t.type === 'op' && t.value === '^') {
        pos++;
        return { op: '^', a: base, b: parseUnary() }; // 右结合，指数允许一元负号
      }
      return base;
    }
    function parseAtom() {
      const t = peek();
      if (!t) throw new Error('表达式不完整（缺少运算数）');
      if (t.type === 'num') { pos++; return { num: t.value }; }
      if (t.type === 'ident') {
        pos++;
        const name = t.value;
        const isCall = peek() && peek().type === 'lparen';
        if (isCall) {
          if (!Object.prototype.hasOwnProperty.call(FUNCS, name)) throw new Error('未知函数：' + name);
          pos++; // 吃掉 '('
          const arg = parseExpr();
          const c = peek();
          if (!c || c.type !== 'rparen') throw new Error('括号不匹配，缺少 “)”');
          pos++;
          return { fn: name, a: arg };
        }
        if (Object.prototype.hasOwnProperty.call(CONSTS, name)) return { num: CONSTS[name] };
        if (Object.prototype.hasOwnProperty.call(VAR_NAMES, name)) return { var: VAR_NAMES[name] };
        if (Object.prototype.hasOwnProperty.call(FUNCS, name)) throw new Error('函数 “' + name + '” 缺少括号');
        throw new Error('未知变量或函数：' + name);
      }
      if (t.type === 'lparen') {
        pos++;
        const node = parseExpr();
        const c = peek();
        if (!c || c.type !== 'rparen') throw new Error('括号不匹配，缺少 “)”');
        pos++;
        return node;
      }
      throw new Error('意外的符号：' + (t.value == null ? '' : t.value));
    }

    const ast = parseExpr();
    if (pos !== tokens.length) throw new Error('表达式存在多余内容：' + tokens[pos].value);
    return ast;
  }

  function evalNode(node, vars) {
    if (node.num !== undefined) return node.num;
    if (node.var !== undefined) {
      const v = vars[node.var];
      return (v === undefined || v === null) ? 0 : Number(v);
    }
    if (node.fn !== undefined) return FUNCS[node.fn](evalNode(node.a, vars));
    const a = evalNode(node.a, vars);
    if (node.op === 'neg') return -a;
    const b = evalNode(node.b, vars);
    switch (node.op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return a / b;
      case '^': return Math.pow(a, b);
      default: return NaN;
    }
  }

  // 编译表达式：成功返回 function f(vars)→number；非法则抛 Error（中文）
  function compileExpr(src) {
    const s = String(src == null ? '' : src);
    if (!s.trim()) throw new Error('表达式不能为空');
    const tokens = tokenize(s);
    if (!tokens.length) throw new Error('表达式不能为空');
    const ast = parseTokens(tokens);
    return function f(vars) {
      return evalNode(ast, vars && typeof vars === 'object' ? vars : {});
    };
  }

  // 供 UI 表单使用：绝不抛异常
  function tryCompileExpr(src) {
    try {
      return { ok: true, fn: compileExpr(src) };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : '表达式非法' };
    }
  }

  /* =========================================================
     二、多项式（按降幂排列的实系数数组，纯函数）
     ========================================================= */
  function toCoeffs(a) { return Array.isArray(a) ? a.map(function (v) { return Number(v); }) : []; }
  function trimLead(a) {
    let i = 0;
    while (i < a.length - 1 && a[i] === 0) i++;
    return a.slice(i);
  }

  // 复系数 Horner 求值；z 可为数字或 {re,im}
  function evalPoly(coeffs, z) {
    const a = toCoeffs(coeffs);
    const isObj = !!(z && typeof z === 'object');
    const zr = isObj ? Number(z.re) : Number(z);
    const zi = isObj ? (z.im == null ? 0 : Number(z.im)) : 0;
    let rr = 0, ri = 0;
    for (let i = 0; i < a.length; i++) {
      const nr = rr * zr - ri * zi + a[i];
      const ni = rr * zi + ri * zr;
      rr = nr; ri = ni;
    }
    if (isObj) return { re: rr, im: ri };
    return rr;
  }

  // 降幂系数多项式相乘
  function polyMul(a, b) {
    const A = toCoeffs(a), B = toCoeffs(b);
    if (!A.length || !B.length) return [0];
    const out = new Array(A.length + B.length - 1).fill(0);
    for (let i = 0; i < A.length; i++) {
      for (let j = 0; j < B.length; j++) out[i + j] += A[i] * B[j];
    }
    return out;
  }

  // 降幂系数多项式相加
  function polyAdd(a, b) {
    const A = toCoeffs(a), B = toCoeffs(b);
    const n = Math.max(A.length, B.length);
    while (A.length < n) A.unshift(0);
    while (B.length < n) B.unshift(0);
    const out = A.map(function (v, i) { return v + B[i]; });
    return out;
  }

  // Durand–Kerner 求全部复根 → [{re, im}, ...]
  function polyRoots(coeffs) {
    let a = trimLead(toCoeffs(coeffs));
    if (a.length < 2) return [];
    const n = a.length - 1;
    const lead = a[0];
    if (!isFinite(lead) || lead === 0) return [];
    const c = a.map(function (v) { return v / lead; }); // 首一化

    function fz(xr, xi) {
      let rr = c[0], ri = 0;
      for (let k = 1; k <= n; k++) {
        const nr = rr * xr - ri * xi + c[k];
        const ni = rr * xi + ri * xr;
        rr = nr; ri = ni;
      }
      return [rr, ri];
    }

    // 初值 z_k = (0.4 + 0.9i)^(k+1)
    const R = new Array(n), I = new Array(n);
    let pr = 0.4, pi = 0.9;
    for (let k = 0; k < n; k++) {
      R[k] = pr; I[k] = pi;
      const tr = pr * 0.4 - pi * 0.9;
      const ti = pr * 0.9 + pi * 0.4;
      pr = tr; pi = ti;
    }

    const tol = 1e-14;
    for (let it = 0; it < 1000; it++) {
      let maxd = 0;
      for (let k = 0; k < n; k++) {
        const f = fz(R[k], I[k]);
        let dr = 1, di = 0;
        for (let j = 0; j < n; j++) {
          if (j === k) continue;
          const ar = R[k] - R[j], ai = I[k] - I[j];
          const tr = dr * ar - di * ai;
          const ti = dr * ai + di * ar;
          dr = tr; di = ti;
        }
        const den = dr * dr + di * di;
        if (den === 0) continue;
        const qr = (f[0] * dr + f[1] * di) / den;
        const qi = (f[1] * dr - f[0] * di) / den;
        R[k] -= qr; I[k] -= qi;
        const m = qr * qr + qi * qi;
        if (m > maxd) maxd = m;
      }
      if (maxd < tol * tol) break;
    }

    const roots = [];
    for (let k = 0; k < n; k++) {
      let re = R[k], im = I[k];
      if (Math.abs(im) < 1e-9) im = 0;
      if (Math.abs(re) < 1e-9) re = 0;
      roots.push({ re: re, im: im });
    }
    roots.sort(function (p, q) { return (p.re - q.re) || (p.im - q.im); });
    return roots;
  }

  /* =========================================================
     三、DFT / DTFT（纯函数）
     ========================================================= */
  // 长度 N 的序列 x（按 n=0..N-1）做 DFT，返回 k=0..kMax 的 {k,re,im,mag,phase}
  function dft(seq, kMax) {
    const x = Array.isArray(seq) ? seq.map(Number) : [];
    const N = x.length;
    if (!N) return [];
    const km = (kMax == null) ? N - 1 : Math.max(0, Math.floor(kMax));
    const out = [];
    for (let k = 0; k <= km; k++) {
      let re = 0, im = 0;
      for (let i = 0; i < N; i++) {
        const ang = -2 * Math.PI * k * i / N;
        re += x[i] * Math.cos(ang);
        im += x[i] * Math.sin(ang);
      }
      out.push({ k: k, re: re, im: im, mag: Math.hypot(re, im), phase: Math.atan2(im, re) });
    }
    return out;
  }

  // 对上升沿系数（x[0..N-1]）在给定 w 处求 DTFT：X(w)=Σ x[n] e^{-jwn}
  function dtft(coeffs, w) {
    const a = toCoeffs(coeffs);
    let re = 0, im = 0;
    for (let n = 0; n < a.length; n++) {
      re += a[n] * Math.cos(w * n);
      im -= a[n] * Math.sin(w * n);
    }
    return { re: re, im: im, mag: Math.hypot(re, im), phase: Math.atan2(im, re) };
  }

  /* =========================================================
     三点五、信号与系统 / DSP 专用纯函数（与 DOM 无关，可在 Node 下单测）
     ========================================================= */
  const GEPS = 1e-9;
  // 数值格式化（去掉多余零）
  function fmtNum(x) {
    if (!isFinite(x)) return '—';
    const r = Math.abs(x) < 1e-12 ? 0 : x;
    return String(Math.round(r * 1000) / 1000);
  }

  // 复频响 H：s 域取 s=jω，z 域取 z=e^{jω}，返回 {re, im, mag, phase}
  function respComplex(num, den, w, domain) {
    const z = (domain === 'z') ? { re: Math.cos(w), im: Math.sin(w) } : { re: 0, im: w };
    const nv = evalPoly(num, z), dv = evalPoly(den, z);
    const d = dv.re * dv.re + dv.im * dv.im;
    if (d === 0) return { re: NaN, im: NaN, mag: Infinity, phase: 0 };
    const re = (nv.re * dv.re + nv.im * dv.im) / d;
    const im = (nv.im * dv.re - nv.re * dv.im) / d;
    return { re: re, im: im, mag: Math.hypot(re, im), phase: Math.atan2(im, re) };
  }

  // 相位解卷绕（弧度）：消除 atan2 的 ±π 跳变，得到连续相位
  function unwrapPhase(ph) {
    if (!ph.length) return [];
    const TAU = 2 * Math.PI;
    const out = [ph[0]];
    let acc = ph[0];
    for (let i = 1; i < ph.length; i++) {
      let d = ph[i] - ph[i - 1];
      d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI; // 折到 (−π, π]
      acc += d;
      out.push(acc);
    }
    return out;
  }

  // 群延迟 τ(ω) = −dφ/dω（数值中心差分）：s 域单位为秒，z 域单位为样本
  function groupDelay(num, den, w, domain, hw) {
    const h = hw || 1e-4;
    const p1 = respComplex(num, den, w + h, domain).phase;
    const p0 = respComplex(num, den, w - h, domain).phase;
    if (!isFinite(p1) || !isFinite(p0)) return NaN;
    let d = p1 - p0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return -d / (2 * h);
  }

  // 极点 → 可能的收敛域（ROC）及对应的因果性 / 稳定性
  //   连续：半平面 / 竖条；离散：圆外 / 圆内 / 环带
  function rocOf(poles, domain) {
    if (!poles || !poles.length) return { empty: true };
    const regions = [];
    if (domain === 'z') {
      const rs = poles.map(function (p) { return Math.hypot(p.re, p.im); });
      const rmin = Math.min.apply(null, rs), rmax = Math.max.apply(null, rs);
      regions.push({ roc: '|z| > ' + fmtNum(rmax), system: '因果（右边序列）', stable: rmax < 1 - GEPS, type: 'causal' });
      if (rmin > GEPS) regions.push({ roc: '|z| < ' + fmtNum(rmin), system: '反因果（左边序列）', stable: rmin > 1 + GEPS, type: 'anticausal' });
      if (rmax - rmin > GEPS) regions.push({ roc: fmtNum(rmin) + ' < |z| < ' + fmtNum(rmax), system: '双边序列', stable: rmin < 1 - GEPS && rmax > 1 + GEPS, type: 'twosided' });
      return { domain: 'z', regions: regions, rmin: rmin, rmax: rmax, causalStable: rmax < 1 - GEPS };
    }
    const re = poles.map(function (p) { return p.re; });
    const smin = Math.min.apply(null, re), smax = Math.max.apply(null, re);
    regions.push({ roc: 'Re(s) > ' + fmtNum(smax), system: '因果（右边信号）', stable: smax < -GEPS, type: 'causal' });
    regions.push({ roc: 'Re(s) < ' + fmtNum(smin), system: '反因果（左边信号）', stable: smin > GEPS, type: 'anticausal' });
    if (smax - smin > GEPS) regions.push({ roc: fmtNum(smin) + ' < Re(s) < ' + fmtNum(smax), system: '双边信号', stable: smin < -GEPS && smax > GEPS, type: 'twosided' });
    return { domain: 's', regions: regions, smin: smin, smax: smax, causalStable: smax < -GEPS };
  }

  // 全通 / 最小相位判定：
  //   全通：零点 = 极点的镜像（连续关于虚轴，离散关于单位圆共轭倒数）
  //   最小相位：零点全在左半平面 / 单位圆内
  function allPassMinPhase(num, den, domain) {
    const poles = polyRoots(den), zeros = polyRoots(num);
    let allpass = poles.length > 0 && zeros.length === poles.length;
    if (allpass) {
      const rem = zeros.slice();
      for (let k = 0; k < poles.length && allpass; k++) {
        const p = poles[k];
        const m2 = p.re * p.re + p.im * p.im;
        const want = (domain === 'z')
          ? { re: p.re / (m2 || 1), im: -p.im / (m2 || 1) }
          : { re: -p.re, im: p.im };
        let idx = -1;
        for (let i = 0; i < rem.length; i++) {
          if (Math.hypot(rem[i].re - want.re, rem[i].im - want.im) < 1e-6) { idx = i; break; }
        }
        if (idx < 0) allpass = false; else rem.splice(idx, 1);
      }
    }
    const minphase = zeros.every(function (z) {
      return (domain === 'z') ? Math.hypot(z.re, z.im) < 1 - GEPS : z.re < -GEPS;
    });
    return { allpass: allpass, minphase: minphase, poles: poles, zeros: zeros };
  }

  // 双线性变换：s=(2/T)(z−1)/(z+1) 代入 H(s)，返回 H(z) 的降幂系数 {num, den}
  function polyScale(a, k) {
    return toCoeffs(a).map(function (v) { return v * k; });
  }
  function polyPow(p, k) {
    let r = [1];
    for (let i = 0; i < k; i++) r = polyMul(r, p);
    return r;
  }
  function bilinearTF(num, den, T) {
    const K = 2 / (T || 1);
    const n = Math.max(0, num.length - 1), m = Math.max(0, den.length - 1), L = Math.max(n, m);
    const zm = [1, -1], zp = [1, 1];
    const build = function (coeffs, deg) {
      let acc = [0];
      for (let i = 0; i < coeffs.length; i++) {
        const p = deg - i;
        acc = polyAdd(acc, polyScale(polyMul(polyPow(zm, p), polyPow(zp, i)), coeffs[i] * Math.pow(K, p)));
      }
      return acc;
    };
    let Np = polyMul(build(num, n), polyPow(zp, L - n));
    let Dp = polyMul(build(den, m), polyPow(zp, L - m));
    return { num: trimLead(Np), den: trimLead(Dp) };
  }

  // 脉冲响应不变：连续极点 s_k → 离散极点 z_k = e^{s_k T}
  function impulseInvariantPoles(poles, T) {
    return poles.map(function (p) {
      const e = Math.exp(p.re * T);
      return { re: e * Math.cos(p.im * T), im: e * Math.sin(p.im * T) };
    });
  }

  // 常用窗函数系数（长度 N，对称）
  function windowCoeffs(type, N) {
    N = Math.max(2, Math.floor(N || 21));
    const t = String(type || 'rect').toLowerCase();
    const w = [];
    for (let n = 0; n < N; n++) {
      const x = 2 * Math.PI * n / (N - 1);
      let v;
      if (t === 'hann' || t === 'hanning') v = 0.5 - 0.5 * Math.cos(x);
      else if (t === 'hamming') v = 0.54 - 0.46 * Math.cos(x);
      else if (t === 'blackman') v = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
      else v = 1;
      w.push(v);
    }
    return w;
  }
  // 窗函数在角频率 w 处的幅度谱
  function windowMag(type, N, w) {
    return dtft(windowCoeffs(type, N), w).mag;
  }
  // 窗函数指标：主瓣宽（bin，零点到零点）与最大旁瓣电平（dB，相对主瓣）
  function windowMetrics(type, N) {
    const N2 = Math.max(2, Math.floor(N || 21));
    const M = 4000;
    let peak = 0;
    const ws = [], ms = [];
    for (let i = 0; i <= M; i++) {
      const w = Math.PI * i / M;
      const m = windowMag(type, N2, w);
      ws.push(w); ms.push(m);
      if (m > peak) peak = m;
    }
    const nrm = ms.map(function (m) { return m / (peak || 1); });
    // 第一个局部极小值 = 主瓣边界（零点到零点）
    let nullIdx = -1;
    for (let i = 1; i < nrm.length - 1; i++) {
      if (nrm[i] < nrm[i - 1] && nrm[i] <= nrm[i + 1] && nrm[i] < 0.5) { nullIdx = i; break; }
    }
    let sl = 0;
    if (nullIdx >= 0) for (let i = nullIdx; i < nrm.length; i++) if (nrm[i] > sl) sl = nrm[i];
    const bins = nullIdx >= 0 ? ws[nullIdx] * N2 / Math.PI : NaN;
    return { N: N2, bins: bins, sidelobeDb: 20 * Math.log10(sl || 1e-9) };
  }

  // 线性卷积（有限长因果序列）
  function linearConv(a, b) {
    const A = toCoeffs(a), B = toCoeffs(b);
    const out = new Array(A.length + B.length - 1).fill(0);
    for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) out[i + j] += A[i] * B[j];
    return out;
  }
  // N 点循环卷积
  function circularConv(a, b, N) {
    const A = toCoeffs(a), B = toCoeffs(b);
    const n = Math.max(1, Math.floor(N || (A.length + B.length - 1)));
    const out = new Array(n).fill(0);
    for (let k = 0; k < n; k++) {
      let s = 0;
      for (let i = 0; i < A.length; i++) {
        const j = ((k - i) % n + n) % n;
        s += A[i] * (B[j] || 0);
      }
      out[k] = s;
    }
    return out;
  }

  /* =========================================================
     四、绘图（仅在 drawPlot 被调用时接触 canvas；Node 下安全降级）
     ========================================================= */
  function getCtx(canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    try { return canvas.getContext('2d'); } catch (e) { return null; }
  }
  function num(v, d) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : d;
  }

  function theme(dark, color) {
    const t = dark
      ? {
        bg: '#0f151c', panel: '#131c26', border: '#26343f', grid: '#1e2b38',
        axis: '#5b6d7f', zero: '#8fa3b6', text: '#c3d0dd', muted: '#7d8fa0',
        curve: '#4ea1f7', stem: '#8be28b', pole: '#ff6b8a', zeroMark: '#4ea1f7',
      }
      : {
        bg: '#ffffff', panel: '#f7f9fc', border: '#d5dee8', grid: '#e6ecf3',
        axis: '#8a99a8', zero: '#5b6d7f', text: '#33404d', muted: '#71828f',
        curve: '#1b7fe0', stem: '#2e9e4f', pole: '#d63b5e', zeroMark: '#1b7fe0',
      };
    if (typeof color === 'string' && color) t.curve = color;
    return t;
  }

  function mapX(box, x, x0, x1) { return box.x + (x - x0) / (x1 - x0) * box.w; }
  function mapY(box, y, y0, y1) { return box.y + box.h - (y - y0) / (y1 - y0) * box.h; }

  function niceStep(target) {
    if (!(target > 0)) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(target)));
    const n = target / mag;
    const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return m * mag;
  }
  function niceTicks(min, max, count) {
    if (!(max > min)) return [min];
    const step = niceStep((max - min) / (count || 5));
    const ticks = [];
    const start = Math.ceil(min / step) * step;
    for (let v = start; v <= max + step * 1e-6; v += step) ticks.push(Math.abs(v) < step * 1e-6 ? 0 : v);
    return ticks;
  }
  function intTicks(min, max, count) {
    const span = max - min;
    let step = Math.max(1, Math.round(niceStep(span / (count || 8))));
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v === 0 ? 0 : v);
    return out;
  }
  function fmtTick(v) {
    if (Math.abs(v) < 1e-9) return '0';
    if (Math.abs(v) >= 10000 || Math.abs(v) < 0.001) return v.toExponential(0);
    return String(Math.round(v * 1000) / 1000);
  }
  function niceRange(lo, hi) {
    if (!(hi > lo)) {
      const c = (hi + lo) / 2 || 0;
      const half = Math.abs(c) > 0 ? Math.abs(c) : 1;
      lo = c - half; hi = c + half;
    }
    const pad = (hi - lo) * 0.12;
    return [lo - pad, hi + pad];
  }

  // 画面板：底、网格、边框、零轴、刻度数字
  function drawAxis(ctx, box, xr, yr, th, xLabel) {
    ctx.fillStyle = th.panel;
    ctx.fillRect(box.x, box.y, box.w, box.h);

    const xt = niceTicks(xr[0], xr[1], 6);
    const yt = niceTicks(yr[0], yr[1], 4);

    ctx.save();
    ctx.strokeStyle = th.grid; ctx.lineWidth = 1; ctx.beginPath();
    xt.forEach(function (v) {
      const px = Math.round(mapX(box, v, xr[0], xr[1])) + 0.5;
      ctx.moveTo(px, box.y); ctx.lineTo(px, box.y + box.h);
    });
    yt.forEach(function (v) {
      const py = Math.round(mapY(box, v, yr[0], yr[1])) + 0.5;
      ctx.moveTo(box.x, py); ctx.lineTo(box.x + box.w, py);
    });
    ctx.stroke();
    ctx.restore();

    // 零轴
    ctx.save();
    ctx.strokeStyle = th.zero; ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (yr[0] < 0 && yr[1] > 0) {
      const py = Math.round(mapY(box, 0, yr[0], yr[1])) + 0.5;
      ctx.moveTo(box.x, py); ctx.lineTo(box.x + box.w, py);
    }
    if (xr[0] < 0 && xr[1] > 0) {
      const px = Math.round(mapX(box, 0, xr[0], xr[1])) + 0.5;
      ctx.moveTo(px, box.y); ctx.lineTo(px, box.y + box.h);
    }
    ctx.stroke();
    ctx.restore();

    // 边框
    ctx.strokeStyle = th.border; ctx.lineWidth = 1;
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);

    // 刻度数字
    ctx.fillStyle = th.muted;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    xt.forEach(function (v) {
      const px = mapX(box, v, xr[0], xr[1]);
      if (px >= box.x - 1 && px <= box.x + box.w + 1) ctx.fillText(fmtTick(v), px, box.y + box.h + 4);
    });
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    yt.forEach(function (v) {
      const py = mapY(box, v, yr[0], yr[1]);
      if (py >= box.y - 1 && py <= box.y + box.h + 1) ctx.fillText(fmtTick(v), box.x - 6, py);
    });

    if (xLabel) {
      ctx.fillStyle = th.muted;
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText(xLabel, box.x + box.w, box.y + box.h + 30);
    }
  }

  function drawLabel(ctx, box, text, th) {
    if (!text) return;
    ctx.fillStyle = th.text;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(String(text), box.x + 8, box.y + 6);
  }

  function notice(ctx, box, msg, th) {
    ctx.fillStyle = th.panel;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.fillStyle = th.pole;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(msg, box.x + box.w / 2, box.y + box.h / 2);
  }

  function clipBox(ctx, box, fn) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    fn();
    ctx.restore();
  }

  function drawCurve(ctx, box, pts, xr, yr, color, lw) {
    clipBox(ctx, box, function () {
      ctx.strokeStyle = color; ctx.lineWidth = lw || 1.6;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (!isFinite(p.y)) { pen = false; continue; }
        const px = mapX(box, p.x, xr[0], xr[1]);
        const py = mapY(box, p.y, yr[0], yr[1]);
        if (!pen) { ctx.moveTo(px, py); pen = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
    });
  }

  function drawStem(ctx, box, pts, xr, yr, color) {
    clipBox(ctx, box, function () {
      const py0 = Math.max(box.y, Math.min(box.y + box.h, mapY(box, 0, yr[0], yr[1])));
      ctx.strokeStyle = color; ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (!isFinite(p.y)) continue;
        const px = mapX(box, p.x, xr[0], xr[1]);
        const py = mapY(box, p.y, yr[0], yr[1]);
        ctx.moveTo(px, py0); ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.fillStyle = color;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (!isFinite(p.y)) continue;
        const px = mapX(box, p.x, xr[0], xr[1]);
        const py = mapY(box, p.y, yr[0], yr[1]);
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  function panelBox(W, H, m) {
    return { x: m.l, y: m.t, w: W - m.l - m.r, h: H - m.t - m.b };
  }

  // 连续时间波形
  function drawCT(ctx, W, H, s, th) {
    const box = panelBox(W, H, { l: 50, r: 16, t: 26, b: 36 });
    const tMin = num(s.tMin, -5), tMax = num(s.tMax, 5);
    const N = Math.max(2, Math.floor(num(s.samples, 800)));
    let f;
    try { f = compileExpr(s.expr); } catch (e) { notice(ctx, box, '表达式错误：' + e.message, th); return; }

    const pts = [];
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < N; i++) {
      const x = tMin + (tMax - tMin) * i / (N - 1);
      let y = Number(f({ t: x }));
      if (!isFinite(y)) y = NaN;
      pts.push({ x: x, y: y });
      if (isFinite(y)) { if (y < lo) lo = y; if (y > hi) hi = y; }
    }
    if (!isFinite(lo) || !isFinite(hi)) { lo = -1; hi = 1; }
    lo = Math.min(lo, 0); hi = Math.max(hi, 0);
    const yr = niceRange(lo, hi);
    const xr = [tMin, tMax];

    drawAxis(ctx, box, xr, yr, th, 't');
    drawCurve(ctx, box, pts, xr, yr, th.curve, 1.8);
    drawLabel(ctx, box, s.label, th);
  }

  // 离散序列杆图
  function drawDT(ctx, W, H, s, th) {
    const box = panelBox(W, H, { l: 50, r: 16, t: 26, b: 36 });
    const nMin = Math.round(num(s.nMin, -10)), nMax = Math.round(num(s.nMax, 10));
    let f;
    try { f = compileExpr(s.expr); } catch (e) { notice(ctx, box, '表达式错误：' + e.message, th); return; }

    const pts = [];
    let lo = Infinity, hi = -Infinity;
    for (let n = nMin; n <= nMax; n++) {
      let y = Number(f({ n: n }));
      if (!isFinite(y)) y = NaN;
      pts.push({ x: n, y: y });
      if (isFinite(y)) { if (y < lo) lo = y; if (y > hi) hi = y; }
    }
    if (!isFinite(lo) || !isFinite(hi)) { lo = -1; hi = 1; }
    lo = Math.min(lo, 0); hi = Math.max(hi, 0);
    const yr = niceRange(lo, hi);
    const xr = [nMin - 0.5, nMax + 0.5];

    drawAxis(ctx, box, xr, yr, th, 'n');
    drawStem(ctx, box, pts, xr, yr, th.stem);
    drawLabel(ctx, box, s.label, th);
  }

  // 频谱：两种输入方式
  function drawSpectrum(ctx, W, H, s, th) {
    const from = s.from === 'time' ? 'time' : 'expr';
    const mode = (s.mode === 'phase' || s.mode === 'both') ? s.mode : 'mag';
    if (from === 'time') drawSpectrumTime(ctx, W, H, s, th, mode);
    else drawSpectrumExpr(ctx, W, H, s, th, mode);
  }

  // a) 由时域离散序列做 DFT
  function drawSpectrumTime(ctx, W, H, s, th, mode) {
    const box = panelBox(W, H, { l: 50, r: 16, t: 26, b: 36 });
    const varName = s.var || 'n';
    let f;
    try { f = compileExpr(s.expr); } catch (e) { notice(ctx, box, '表达式错误：' + e.message, th); return; }
    const nMin = Math.round(num(s.nMin, 0)), nMax = Math.round(num(s.nMax, 7));
    const seq = [];
    for (let n = nMin; n <= nMax; n++) {
      const vars = {}; vars[varName] = n;
      let y = Number(f(vars));
      seq.push(isFinite(y) ? y : 0);
    }
    const N = seq.length;
    if (!N) { notice(ctx, box, '无可用的序列样本', th); return; }
    const kMax = Math.floor(num(s.kMax, N - 1));
    const D = dft(seq, kMax);
    const usePhase = mode === 'phase';
    const pts = D.map(function (d) { return { x: d.k, y: usePhase ? d.phase : d.mag }; });
    const yr = rangeOf(pts, true);
    const xr = [-0.5, kMax + 0.5];

    drawAxis(ctx, box, xr, yr, th, 'k');
    drawStem(ctx, box, pts, xr, yr, usePhase ? th.pole : th.stem);
    drawLabel(ctx, box, (s.label || '序列 DFT') + (usePhase ? '（相位谱）' : '（幅度谱）'), th);
  }

  // b) 由以 w 为变量的表达式直接画幅度 / 相位曲线
  function drawSpectrumExpr(ctx, W, H, s, th, mode) {
    const wMin = num(s.wMin, 0), wMax = num(s.wMax, 10);
    const N = Math.max(2, Math.floor(num(s.samples, 400)));
    let f;
    try { f = compileExpr(s.expr); } catch (e) {
      notice(ctx, panelBox(W, H, { l: 52, r: 16, t: 26, b: 36 }), '表达式错误：' + e.message, th);
      return;
    }
    const pts = [];
    for (let i = 0; i < N; i++) {
      const w = wMin + (wMax - wMin) * i / (N - 1);
      let y = Number(f({ w: w }));
      pts.push({ x: w, y: isFinite(y) ? y : NaN });
    }

    if (mode === 'both') {
      const gap = 30;
      const m = { l: 52, r: 16, t: 24, b: 40 };
      const h = (H - m.t - m.b - gap) / 2;
      const top = { x: m.l, y: m.t, w: W - m.l - m.r, h: h };
      const bot = { x: m.l, y: m.t + h + gap, w: W - m.l - m.r, h: h };
      const magPts = pts.map(function (p) { return { x: p.x, y: isFinite(p.y) ? Math.abs(p.y) : NaN }; });
      const ya = rangeOf(magPts, true);
      drawAxis(ctx, top, [wMin, wMax], ya, th, null);
      drawCurve(ctx, top, magPts, [wMin, wMax], ya, th.curve, 1.8);
      drawLabel(ctx, top, (s.label || '频谱') + '（幅度）', th);
      const yb = [-180, 180];
      drawAxis(ctx, bot, [wMin, wMax], yb, th, 'ω');
      drawCurve(ctx, bot, pts, [wMin, wMax], yb, th.pole, 1.8);
      drawLabel(ctx, bot, '（相位，单位 rad）', th);
    } else {
      const box = panelBox(W, H, { l: 52, r: 16, t: 26, b: 36 });
      const usePhase = mode === 'phase';
      const view = usePhase ? pts : pts.map(function (p) { return { x: p.x, y: isFinite(p.y) ? Math.abs(p.y) : NaN }; });
      const yr = rangeOf(view, true);
      drawAxis(ctx, box, [wMin, wMax], yr, th, 'ω');
      drawCurve(ctx, box, view, [wMin, wMax], yr, th.curve, 1.8);
      drawLabel(ctx, box, (s.label || '频谱') + (usePhase ? '（相位）' : '（幅度）'), th);
    }
  }

  function rangeOf(pts, includeZero) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const y = pts[i].y;
      if (isFinite(y)) { if (y < lo) lo = y; if (y > hi) hi = y; }
    }
    if (!isFinite(lo) || !isFinite(hi)) { lo = -1; hi = 1; }
    if (includeZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    return niceRange(lo, hi);
  }

  function cdiv(a, b) {
    const d = b.re * b.re + b.im * b.im;
    if (d === 0) return { re: NaN, im: NaN };
    return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
  }

  // 波特图：上幅频(dB) + 下相频(°) 两个子图
  function drawBode(ctx, W, H, s, th) {
    const domain = s.domain === 'z' ? 'z' : 's';
    const numC = toCoeffs(s.num), denC = toCoeffs(s.den);
    const wMin = num(s.wMin, domain === 'z' ? 0 : 0.01);
    const wMax = num(s.wMax, domain === 'z' ? Math.PI : 10);
    const N = Math.max(2, Math.floor(num(s.samples, 400)));
    const ws = [], dB = [], ph = [];
    for (let i = 0; i < N; i++) {
      const w = wMin + (wMax - wMin) * i / (N - 1);
      const z = domain === 'z' ? { re: Math.cos(w), im: Math.sin(w) } : { re: 0, im: w };
      const nv = evalPoly(numC, z), dv = evalPoly(denC, z);
      const Hc = cdiv(nv, dv);
      const mag = Math.hypot(Hc.re, Hc.im);
      ws.push(w);
      dB.push(isFinite(mag) && mag > 0 ? 20 * Math.log10(mag) : -160);
      ph.push(isFinite(Hc.re) && isFinite(Hc.im) ? Math.atan2(Hc.im, Hc.re) * 180 / Math.PI : 0);
    }
    const gap = 30;
    const m = { l: 54, r: 16, t: 24, b: 40 };
    const h = (H - m.t - m.b - gap) / 2;
    const top = { x: m.l, y: m.t, w: W - m.l - m.r, h: h };
    const bot = { x: m.l, y: m.t + h + gap, w: W - m.l - m.r, h: h };
    const phU = unwrapPhase(ph).map(function (v) { return v * 180 / Math.PI; });
    const dBpts = ws.map(function (w, i) { return { x: w, y: dB[i] }; });
    const phpts = ws.map(function (w, i) { return { x: w, y: phU[i] }; });
    const ydb = niceRange(Math.min.apply(null, dB), Math.max.apply(null, dB));
    const yph = niceRange(Math.min.apply(null, phU), Math.max.apply(null, phU));

    drawAxis(ctx, top, [wMin, wMax], ydb, th, null);
    drawCurve(ctx, top, dBpts, [wMin, wMax], ydb, th.curve, 1.8);
    drawLabel(ctx, top, (s.label ? s.label + ' ' : '') + '幅频 (dB)', th);

    drawAxis(ctx, bot, [wMin, wMax], yph, th, 'ω');
    drawCurve(ctx, bot, phpts, [wMin, wMax], yph, th.pole, 1.8);
    drawLabel(ctx, bot, '相频 (°，已解卷绕)', th);
  }

  // 零极点图
  function drawPoleZero(ctx, W, H, s, th) {
    const domain = s.domain === 'z' ? 'z' : 's';
    const zeros = polyRoots(toCoeffs(s.num));
    const poles = polyRoots(toCoeffs(s.den));
    let R = 1;
    zeros.concat(poles).forEach(function (r) {
      R = Math.max(R, Math.abs(r.re), Math.abs(r.im));
    });
    R = R * 1.25 + 0.25;
    const size = Math.max(80, Math.min(W - 60, H - 80));
    const box = { x: (W - size) / 2, y: 30, w: size, h: size };
    const xr = [-R, R], yr = [-R, R];

    drawAxis(ctx, box, xr, yr, th, null);

    // z 域画单位圆；s 域的虚轴即竖直零轴（已由 drawAxis 画出）
    if (domain === 'z') {
      const cx = mapX(box, 0, xr[0], xr[1]);
      const cy = mapY(box, 0, yr[0], yr[1]);
      const rad = Math.abs(mapX(box, 1, xr[0], xr[1]) - cx);
      ctx.save();
      ctx.strokeStyle = th.muted; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 收敛域（ROC）阴影：按 spec.roc（默认「因果」）取对应区域，绿=稳定 / 红=不稳定
    const rocInfo = rocOf(poles, domain);
    const rocKind = s.roc || 'causal';
    let rocText = '';
    if (rocKind !== 'none' && rocInfo && !rocInfo.empty) {
      const reg = rocInfo.regions.filter(function (r) { return r.type === rocKind; })[0];
      if (reg) {
        ctx.save();
        ctx.globalAlpha = 0.13;
        ctx.fillStyle = reg.stable ? th.stem : th.pole;
        if (domain === 'z') {
          const cx = mapX(box, 0, xr[0], xr[1]);
          const cy = mapY(box, 0, yr[0], yr[1]);
          const rOut = Math.abs(mapX(box, rocInfo.rmax, xr[0], xr[1]) - cx);
          const rIn = Math.abs(mapX(box, rocInfo.rmin, xr[0], xr[1]) - cx);
          ctx.beginPath();
          if (reg.type === 'causal') {
            ctx.rect(box.x, box.y, box.w, box.h);
            ctx.arc(cx, cy, rOut, 0, Math.PI * 2, true);
            ctx.fill('evenodd');
          } else if (reg.type === 'anticausal') {
            ctx.arc(cx, cy, rIn, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.arc(cx, cy, rOut, 0, Math.PI * 2);
            ctx.arc(cx, cy, rIn, 0, Math.PI * 2, true);
            ctx.fill('evenodd');
          }
        } else {
          const xB = mapX(box, rocInfo.smax, xr[0], xr[1]);
          const xA = mapX(box, rocInfo.smin, xr[0], xr[1]);
          ctx.beginPath();
          if (reg.type === 'causal') ctx.rect(xB, box.y, box.x + box.w - xB, box.h);
          else if (reg.type === 'anticausal') ctx.rect(box.x, box.y, xA - box.x, box.h);
          else ctx.rect(xA, box.y, xB - xA, box.h);
          ctx.fill();
        }
        ctx.restore();
        // ROC 边界（虚线）
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = reg.stable ? th.stem : th.pole; ctx.lineWidth = 1.4;
        if (domain === 'z') {
          const cx = mapX(box, 0, xr[0], xr[1]);
          const cy = mapY(box, 0, yr[0], yr[1]);
          const rB = Math.abs(mapX(box, reg.type === 'anticausal' ? rocInfo.rmin : rocInfo.rmax, xr[0], xr[1]) - cx);
          ctx.beginPath(); ctx.arc(cx, cy, rB, 0, Math.PI * 2); ctx.stroke();
          if (reg.type === 'twosided') {
            const rB2 = Math.abs(mapX(box, rocInfo.rmin, xr[0], xr[1]) - cx);
            ctx.beginPath(); ctx.arc(cx, cy, rB2, 0, Math.PI * 2); ctx.stroke();
          }
        } else {
          const xB = mapX(box, reg.type === 'anticausal' ? rocInfo.smin : rocInfo.smax, xr[0], xr[1]);
          ctx.beginPath(); ctx.moveTo(xB, box.y); ctx.lineTo(xB, box.y + box.h); ctx.stroke();
          if (reg.type === 'twosided') {
            const xA = mapX(box, rocInfo.smin, xr[0], xr[1]);
            ctx.beginPath(); ctx.moveTo(xA, box.y); ctx.lineTo(xA, box.y + box.h); ctx.stroke();
          }
        }
        ctx.restore();
        rocText = '　ROC: ' + reg.roc + (reg.stable ? '（稳定）' : '（不稳定）');
      }
    }

    // 极点 ×
    ctx.strokeStyle = th.pole; ctx.lineWidth = 2;
    poles.forEach(function (p) {
      const px = mapX(box, p.re, xr[0], xr[1]);
      const py = mapY(box, p.im, yr[0], yr[1]);
      const d = 5;
      ctx.beginPath();
      ctx.moveTo(px - d, py - d); ctx.lineTo(px + d, py + d);
      ctx.moveTo(px - d, py + d); ctx.lineTo(px + d, py - d);
      ctx.stroke();
    });
    // 零点 ○
    ctx.strokeStyle = th.zeroMark; ctx.lineWidth = 2;
    zeros.forEach(function (q) {
      const px = mapX(box, q.re, xr[0], xr[1]);
      const py = mapY(box, q.im, yr[0], yr[1]);
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.stroke();
    });

    // 稳定性结论
    let stable;
    if (domain === 's') stable = poles.every(function (p) { return p.re < 1e-9; });
    else stable = poles.every(function (p) { return Math.hypot(p.re, p.im) < 1 - 1e-9; });
    const msg = stable
      ? (domain === 's' ? '稳定：极点全在左半平面' : '稳定：极点全在单位圆内')
      : (domain === 's' ? '不稳定：存在右半平面极点' : '不稳定：存在单位圆外极点');

    drawLabel(ctx, box, (s.label || (domain === 's' ? '连续系统' : '离散系统')) + '　× 极点　○ 零点' + rocText, th);
    ctx.fillStyle = stable ? th.stem : th.pole;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(msg, W / 2, H - 8);
  }

  // 抽样示意：基带频谱 + 以 ω_s 为间隔的周期复制（叠加出混叠）
  function drawSampling(ctx, W, H, s, th) {
    const box = panelBox(W, H, { l: 54, r: 16, t: 26, b: 40 });
    const N = Math.max(2, Math.floor(num(s.samples, 600)));
    const ws = num(s.ws, NaN);
    const wMax = num(s.wMax, isFinite(ws) ? ws * 2.5 : 10);
    let mag;
    const useTF = s.from === 'tf' && Array.isArray(s.num) && s.num.length;
    if (!useTF && s.expr) {
      let f;
      try { f = compileExpr(s.expr); } catch (e) { notice(ctx, box, '表达式错误：' + e.message, th); return; }
      mag = function (w) { const y = Number(f({ w: w })); return isFinite(y) ? Math.abs(y) : NaN; };
    } else if (Array.isArray(s.num) && s.num.length) {
      const numC = toCoeffs(s.num), denC = toCoeffs(s.den);
      const dom = s.domain === 'z' ? 'z' : 's';
      mag = function (w) { const r = respComplex(numC, denC, w, dom); return isFinite(r.mag) ? r.mag : NaN; };
    } else {
      notice(ctx, box, '未提供基带频谱（表达式或系统函数系数）', th);
      return;
    }
    const base = [];
    for (let i = 0; i <= N; i++) {
      const w = wMax * i / N;
      base.push({ x: w, y: mag(w) });
    }
    const yr = rangeOf(base, true);
    drawAxis(ctx, box, [0, wMax], yr, th, 'ω');
    // 周期复制（虚线、淡色）
    if (isFinite(ws) && ws > 0) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = th.muted; ctx.lineWidth = 1.4;
      const ks = [1, -1, 2, -2];
      ks.forEach(function (k) {
        const pts = [];
        for (let i = 0; i <= N; i++) {
          const w = wMax * i / N;
          pts.push({ x: w, y: mag(w - k * ws) });
        }
        drawCurve(ctx, box, pts, [0, wMax], yr, th.muted, 1.2);
      });
      ctx.restore();
      // 混叠带：ω_s < 2ω_m 时，[ω_s−ω_m, ω_m] 区间与原谱复制重叠
      let wm = 0;
      for (let i = 0; i <= N; i++) {
        const w = wMax * i / N, y = mag(w);
        if (isFinite(y) && Math.abs(y) > 1e-6 * (yr[1] - yr[0])) wm = w;
      }
      if (ws < 2 * wm && wm > 0) {
        ctx.save();
        ctx.globalAlpha = 0.18; ctx.fillStyle = th.pole;
        const x1 = mapX(box, Math.max(0, ws - wm), 0, wMax);
        const x2 = mapX(box, Math.min(wMax, wm), 0, wMax);
        ctx.fillRect(x1, box.y, Math.max(0, x2 - x1), box.h);
        ctx.restore();
      }
    }
    drawCurve(ctx, box, base, [0, wMax], yr, th.curve, 1.8);
    drawLabel(ctx, box, (s.label ? s.label + ' ' : '') + '抽样示意', th);
    ctx.fillStyle = th.muted; ctx.font = '12px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(isFinite(ws)
      ? ('ω_s = ' + fmtNum(ws) + '（实线=基带，虚线=±ω_s、±2ω_s 的周期复制）')
      : '（实线=基带频谱；填写 ω_s 后叠加周期复制）', W / 2, H - 8);
  }

  // 窗函数频谱对比：多种窗的 |W(ω)| 归一化 dB 叠加
  function drawWindow(ctx, W, H, s, th) {
    const box = panelBox(W, H, { l: 54, r: 16, t: 26, b: 40 });
    const N = Math.max(2, Math.floor(num(s.n, 21)));
    const types = String(s.types || 'rect,hann,hamming,blackman').split(/[,，\s]+/).map(function (t) { return t.trim(); }).filter(Boolean);
    const wMax = num(s.wMax, Math.PI);
    const M = 600;
    const cols = [th.curve, th.stem, th.pole, th.zeroMark];
    const nameMap = { rect: '矩形', hann: '汉宁', hamming: '汉明', blackman: '布莱克曼' };
    const curves = types.map(function (t, ti) {
      const gsum = windowCoeffs(t, N).reduce(function (a, b) { return a + b; }, 0) || 1;
      const pts = [];
      for (let i = 0; i <= M; i++) {
        const w = wMax * i / M;
        const m = windowMag(t, N, w) / gsum;
        pts.push({ x: w, y: 20 * Math.log10(m || 1e-9) });
      }
      return { t: t, pts: pts, color: cols[ti % cols.length] };
    });
    const yr = [-80, 5];
    drawAxis(ctx, box, [0, wMax], yr, th, 'ω');
    curves.forEach(function (c) { drawCurve(ctx, box, c.pts, [0, wMax], yr, c.color, 1.6); });
    drawLabel(ctx, box, (s.label ? s.label + ' ' : '') + '窗函数频谱 (dB，相对主瓣)', th);
    ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    let y = box.y + 22;
    curves.forEach(function (c) {
      ctx.fillStyle = c.color;
      ctx.fillText((nameMap[c.t] || c.t) + ' (N=' + N + ')', box.x + 10, y);
      y += 14;
    });
  }

  // 群延迟 τ(ω) 曲线
  function drawGroupDelay(ctx, W, H, s, th) {
    const box = panelBox(W, H, { l: 54, r: 16, t: 26, b: 36 });
    const domain = s.domain === 'z' ? 'z' : 's';
    const numC = toCoeffs(s.num), denC = toCoeffs(s.den);
    const wMin = num(s.wMin, domain === 'z' ? 0 : 0.01);
    const wMax = num(s.wMax, domain === 'z' ? Math.PI : 10);
    const N = Math.max(2, Math.floor(num(s.samples, 400)));
    const pts = [];
    for (let i = 0; i < N; i++) {
      const w = wMin + (wMax - wMin) * i / (N - 1);
      let g = groupDelay(numC, denC, w, domain);
      pts.push({ x: w, y: isFinite(g) ? g : NaN });
    }
    const yr = rangeOf(pts, false);
    drawAxis(ctx, box, [wMin, wMax], yr, th, 'ω');
    drawCurve(ctx, box, pts, [wMin, wMax], yr, th.curve, 1.8);
    drawLabel(ctx, box, (s.label ? s.label + ' ' : '') + '群延迟' + (domain === 'z' ? '（样本）' : '（s）'), th);
  }

  // 分派绘制入口；无可用 canvas 时返回 null
  function drawPlot(canvas, spec) {
    const ctx = getCtx(canvas);
    if (!ctx) return null;
    const s = spec && typeof spec === 'object' ? spec : {};
    const W = Math.floor(num(canvas.width, 0));
    const H = Math.floor(num(canvas.height, 0));
    if (!(W > 0) || !(H > 0)) return null;
    const th = theme(!!s.dark, s.color);
    try {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = th.bg;
      ctx.fillRect(0, 0, W, H);
      if (s.kind === 'ct') drawCT(ctx, W, H, s, th);
      else if (s.kind === 'dt') drawDT(ctx, W, H, s, th);
      else if (s.kind === 'spectrum') drawSpectrum(ctx, W, H, s, th);
      else if (s.kind === 'bode') drawBode(ctx, W, H, s, th);
      else if (s.kind === 'polezero') drawPoleZero(ctx, W, H, s, th);
      else if (s.kind === 'sampling') drawSampling(ctx, W, H, s, th);
      else if (s.kind === 'window') drawWindow(ctx, W, H, s, th);
      else if (s.kind === 'groupdelay') drawGroupDelay(ctx, W, H, s, th);
      else {
        const box = panelBox(W, H, { l: 16, r: 16, t: 16, b: 16 });
        notice(ctx, box, '未知图型：' + (s.kind || '(空)'), th);
      }
    } catch (e) {
      ctx.fillStyle = th.pole;
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('绘图失败：' + (e && e.message ? e.message : '未知错误'), W / 2, H / 2);
    }
    return true;
  }

  /* =========================================================
     五、一键载入示例（每种 kind ≥ 2 个，参数完整）
     ========================================================= */
  const PREVIEW = {
    ct: [
      { kind: 'ct', expr: 'sin(2*pi*t)*exp(-2*t)*u(t)', tMin: -1, tMax: 2.5, samples: 800, label: '因果衰减正弦 u(t)·sin(2πt)e^{-2t}' },
      { kind: 'ct', expr: 'rect(t-1)*tri(t-1)', tMin: -0.5, tMax: 2.5, samples: 800, label: '矩形与三角脉冲' },
    ],
    dt: [
      { kind: 'dt', expr: '0.8^n*u(n)', nMin: -2, nMax: 14, label: '因果指数序列 0.8^n u[n]' },
      { kind: 'dt', expr: 'u(n)-u(n-5)', nMin: -2, nMax: 10, label: '矩形序列 u[n]-u[n-5]' },
    ],
    spectrum: [
      { kind: 'spectrum', from: 'time', expr: '0.8^n', var: 'n', nMin: 0, nMax: 7, kMax: 7, mode: 'mag', label: '0.8^n 的 8 点 DFT' },
      { kind: 'spectrum', from: 'expr', expr: '1/sqrt(1+w^2)', mode: 'mag', wMin: 0, wMax: 10, samples: 400, label: '一阶低通幅度 |H(jω)|' },
    ],
    bode: [
      { kind: 'bode', num: [1], den: [1, 1], domain: 's', wMin: 0.01, wMax: 100, samples: 400, label: 'H(s)=1/(s+1)' },
      { kind: 'bode', num: [1], den: [1, -0.5], domain: 'z', wMin: 0, wMax: 3.1416, samples: 400, label: 'H(z)=1/(z-0.5)' },
    ],
    polezero: [
      { kind: 'polezero', num: [1, -0.2], den: [1, -0.9], domain: 'z', roc: 'causal', label: 'H(z)=(z-0.2)/(z-0.9)' },
      { kind: 'polezero', num: [1, 0, 4], den: [1, 2, 5], domain: 's', roc: 'causal', label: 'H(s)=(s²+4)/(s²+2s+5)' },
    ],
    sampling: [
      { kind: 'sampling', expr: '1-abs(w)/6', ws: 12, wMax: 18, samples: 600, label: '理想低通基带谱 + 抽样复制' },
      { kind: 'sampling', expr: 'exp(-w^2/8)', ws: 6, wMax: 15, samples: 600, label: '高斯谱：ω_s 偏小产生混叠' },
    ],
    window: [
      { kind: 'window', n: 21, types: 'rect,hann,hamming,blackman', wMax: 3.1416, label: '四种窗频谱对比（N=21）' },
      { kind: 'window', n: 51, types: 'rect,hamming', wMax: 3.1416, label: 'N=51：矩形窗 vs 汉明窗' },
    ],
    groupdelay: [
      { kind: 'groupdelay', num: [1], den: [1, 1], domain: 's', wMin: 0.01, wMax: 10, samples: 400, label: 'H(s)=1/(s+1) 群延迟' },
      { kind: 'groupdelay', num: [1, -0.5], den: [1, -0.9], domain: 'z', wMin: 0, wMax: 3.1416, samples: 400, label: 'H(z) 群延迟' },
    ],
  };

  return {
    compileExpr: compileExpr,
    tryCompileExpr: tryCompileExpr,
    evalPoly: evalPoly,
    polyMul: polyMul,
    polyAdd: polyAdd,
    polyRoots: polyRoots,
    dft: dft,
    dtft: dtft,
    respComplex: respComplex,
    unwrapPhase: unwrapPhase,
    groupDelay: groupDelay,
    rocOf: rocOf,
    allPassMinPhase: allPassMinPhase,
    bilinearTF: bilinearTF,
    impulseInvariantPoles: impulseInvariantPoles,
    windowCoeffs: windowCoeffs,
    windowMag: windowMag,
    windowMetrics: windowMetrics,
    linearConv: linearConv,
    circularConv: circularConv,
    drawPlot: drawPlot,
    PREVIEW: PREVIEW,
  };
});

