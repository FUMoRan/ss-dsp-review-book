/* =========================================================
   数学复习本 · transforms.js
   公式与变换速查表数据模块：变换对、变换性质、连续↔离散对照。
   纯数据 + 纯函数，完全不接触 DOM。
   浏览器以经典脚本加载（挂到 window.MQT）；Node 下可作为模块被单测引用。

   说明：
   - time / transform / ctft / laplace / z / cont / disc 均为 LaTeX 字符串，
     交给 KaTeX 渲染，因此反斜杠需在 JS 字符串里双写（如 '\\sin'）。
   - note 为普通说明文本（收敛域 / 适用条件），不要求是 LaTeX。
   - 只收录教材通用标准结论（Oppenheim《信号与系统》《离散时间信号处理》、
     郑君里《信号与系统》），不予收录没有十足把握者。
   符号约定：CTFT 用 X(jω)，拉普拉斯用 X(s)，Z 变换用 X(z)，
   DTFT 用 X(e^{jω})；sinc(x)=sin(πx)/(πx)（Oppenheim 定义）。
   ========================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MQT = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 变换对 ---------- */
  const PAIRS = [
    /* ===== 连续时间傅里叶变换（CTFT） ===== */
    {
      id: 'ctft-impulse', group: 'ctft', name: '单位冲激 δ(t)',
      time: '\\delta(t)',
      transform: '1\\quad(\\forall\\,\\omega)',
      note: '对所有 ω 成立（广义函数意义下）',
    },
    {
      id: 'ctft-impulse-shift', group: 'ctft', name: '时移冲激 δ(t−t₀)',
      time: '\\delta(t-t_0)',
      transform: 'e^{-j\\omega t_0}',
      note: '时移特性：幅度恒为 1，相位为 −ω t₀',
    },
    {
      id: 'ctft-const', group: 'ctft', name: '常量 1（直流信号）',
      time: '1\\quad(\\forall\\,t)',
      transform: '2\\pi\\delta(\\omega)',
      note: '直流分量的频谱为原点处的冲激',
    },
    {
      id: 'ctft-complex-exp', group: 'ctft', name: '复指数 e^{jω₀t}',
      time: 'e^{j\\omega_0 t}',
      transform: '2\\pi\\delta(\\omega-\\omega_0)',
      note: 'ω₀ 为任意实数，频谱为单根冲激',
    },
    {
      id: 'ctft-step', group: 'ctft', name: '单位阶跃 u(t)',
      time: '\\mathrm{u}(t)',
      transform: '\\frac{1}{j\\omega}+\\pi\\delta(\\omega)',
      note: '须在广义函数意义下理解，含 πδ(ω) 直流项',
    },
    {
      id: 'ctft-exp-decay', group: 'ctft', name: '单边指数 e^{−at}u(t)',
      time: 'e^{-at}\\mathrm{u}(t)',
      transform: '\\frac{1}{a+j\\omega}',
      note: '收敛条件 Re{a} > 0',
    },
    {
      id: 'ctft-rect', group: 'ctft', name: '矩形脉冲 rect(t/τ)',
      time: '\\mathrm{rect}\\!\\left(\\frac{t}{\\tau}\\right)',
      transform: '\\tau\\,\\mathrm{sinc}\\!\\left(\\frac{\\omega\\tau}{2\\pi}\\right)',
      note: '脉冲宽度 τ > 0；sinc(x)=sin(πx)/(πx)（Oppenheim 定义）',
    },
    {
      id: 'ctft-sinc', group: 'ctft', name: 'sinc 抽样函数 sinc(t)',
      time: '\\mathrm{sinc}(t)=\\frac{\\sin(\\pi t)}{\\pi t}',
      transform: '\\mathrm{rect}\\!\\left(\\frac{\\omega}{2\\pi}\\right)',
      note: 'Oppenheim 定义；频谱为宽度 2π 的矩形',
    },
    {
      id: 'ctft-cos', group: 'ctft', name: '余弦 cos(ω₀t)',
      time: '\\cos(\\omega_0 t)',
      transform: '\\pi\\left[\\delta(\\omega-\\omega_0)+\\delta(\\omega+\\omega_0)\\right]',
      note: '频谱在 ±ω₀ 处成对冲激',
    },
    {
      id: 'ctft-sin', group: 'ctft', name: '正弦 sin(ω₀t)',
      time: '\\sin(\\omega_0 t)',
      transform: '\\frac{\\pi}{j}\\left[\\delta(\\omega-\\omega_0)-\\delta(\\omega+\\omega_0)\\right]',
      note: '奇函数，频谱为纯虚奇函数',
    },

    /* ===== 拉普拉斯变换 ===== */
    {
      id: 'laplace-delta', group: 'laplace', name: '单位冲激 δ(t)',
      time: '\\delta(t)',
      transform: '1\\quad(\\forall\\,s)',
      note: 'ROC 为整个 s 平面',
    },
    {
      id: 'laplace-step', group: 'laplace', name: '单位阶跃 u(t)',
      time: '\\mathrm{u}(t)',
      transform: '\\frac{1}{s}',
      note: 'ROC：Re{s} > 0',
    },
    {
      id: 'laplace-exp', group: 'laplace', name: '单边指数 e^{−at}u(t)',
      time: 'e^{-at}\\mathrm{u}(t)',
      transform: '\\frac{1}{s+a}',
      note: 'ROC：Re{s} > −a',
    },
    {
      id: 'laplace-ramp', group: 'laplace', name: '斜坡 t·u(t)',
      time: 't\\,\\mathrm{u}(t)',
      transform: '\\frac{1}{s^{2}}',
      note: 'ROC：Re{s} > 0',
    },
    {
      id: 'laplace-power', group: 'laplace', name: '幂函数 tⁿu(t)',
      time: 't^{n}\\mathrm{u}(t)',
      transform: '\\frac{n!}{s^{n+1}}',
      note: 'n 为非负整数；ROC：Re{s} > 0',
    },
    {
      id: 'laplace-cos', group: 'laplace', name: '衰减余弦 e^{−at}cos(ω₀t)u(t)',
      time: 'e^{-at}\\cos(\\omega_0 t)\\,\\mathrm{u}(t)',
      transform: '\\frac{s+a}{(s+a)^{2}+\\omega_0^{2}}',
      note: 'ROC：Re{s} > −a',
    },
    {
      id: 'laplace-sin', group: 'laplace', name: '衰减正弦 e^{−at}sin(ω₀t)u(t)',
      time: 'e^{-at}\\sin(\\omega_0 t)\\,\\mathrm{u}(t)',
      transform: '\\frac{\\omega_0}{(s+a)^{2}+\\omega_0^{2}}',
      note: 'ROC：Re{s} > −a',
    },

    /* ===== Z 变换 ===== */
    {
      id: 'z-delta', group: 'z', name: '单位冲激 δ[n]',
      time: '\\delta[n]',
      transform: '1\\quad(\\forall\\,z)',
      note: 'ROC 为整个 z 平面（含 z=0）',
    },
    {
      id: 'z-step', group: 'z', name: '单位阶跃 u[n]',
      time: '\\mathrm{u}[n]',
      transform: '\\frac{1}{1-z^{-1}}',
      note: 'ROC：|z| > 1',
    },
    {
      id: 'z-exp', group: 'z', name: '指数序列 aⁿu[n]',
      time: 'a^{n}\\mathrm{u}[n]',
      transform: '\\frac{1}{1-az^{-1}}',
      note: 'ROC：|z| > |a|',
    },
    {
      id: 'z-ramp-exp', group: 'z', name: '加权指数序列 n·aⁿu[n]',
      time: 'n\\,a^{n}\\mathrm{u}[n]',
      transform: '\\frac{az^{-1}}{(1-az^{-1})^{2}}',
      note: 'ROC：|z| > |a|',
    },
    {
      id: 'z-cos', group: 'z', name: '余弦序列 cos(ω₀n)u[n]',
      time: '\\cos(\\omega_0 n)\\,\\mathrm{u}[n]',
      transform: '\\frac{1-\\cos\\omega_0\\,z^{-1}}{1-2\\cos\\omega_0\\,z^{-1}+z^{-2}}',
      note: 'ROC：|z| > 1',
    },
    {
      id: 'z-sin', group: 'z', name: '正弦序列 sin(ω₀n)u[n]',
      time: '\\sin(\\omega_0 n)\\,\\mathrm{u}[n]',
      transform: '\\frac{\\sin\\omega_0\\,z^{-1}}{1-2\\cos\\omega_0\\,z^{-1}+z^{-2}}',
      note: 'ROC：|z| > 1',
    },
    {
      id: 'z-finite', group: 'z', name: '有限长序列 x[n]=1 (0≤n≤N−1)',
      time: 'x[n]=1,\\ 0\\le n\\le N-1',
      transform: '\\frac{1-z^{-N}}{1-z^{-1}}',
      note: '有限长序列，ROC：|z| > 0（视情形还可能为除外 z=0 的全平面）',
    },

    /* ===== 离散傅里叶变换 / DTFT ===== */
    {
      id: 'dft-delta', group: 'dft', name: '单位冲激 δ[n]',
      time: '\\delta[n]',
      transform: '1\\quad(\\forall\\,k)',
      note: 'DTFT 与 N 点 DFT 均为常数 1',
    },
    {
      id: 'dft-const', group: 'dft', name: '常量 1（直流序列）',
      time: '1\\quad(\\forall\\,n)',
      transform: '2\\pi\\sum_{k=-\\infty}^{\\infty}\\delta(\\omega-2\\pi k)',
      note: 'DTFT 意义下为以 2π 为周期的冲激串；N 点 DFT 为 X[k]=Nδ[k]',
    },
    {
      id: 'dft-complex-exp', group: 'dft', name: '复指数 e^{jω₀n}',
      time: 'e^{j\\omega_0 n}',
      transform: '2\\pi\\sum_{k=-\\infty}^{\\infty}\\delta(\\omega-\\omega_0-2\\pi k)',
      note: 'DTFT：以 2π 为周期的冲激串',
    },
    {
      id: 'dft-rect', group: 'dft', name: '矩形序列 x[n]=1 (0≤n≤N−1)',
      time: 'x[n]=1,\\ 0\\le n\\le N-1',
      transform: '\\sum_{n=0}^{N-1}e^{-j\\frac{2\\pi k n}{N}}=e^{-j\\frac{\\pi k(N-1)}{N}}\\frac{\\sin(\\pi k)}{\\sin(\\pi k/N)}',
      note: '矩形序列的 N 点 DFT，即 Dirichlet 核；k≠0 整数时为零，k=0 时为 N',
    },
    {
      id: 'dft-geo', group: 'dft', name: '指数序列 aⁿu[n] 的 DTFT',
      time: 'a^{n}\\mathrm{u}[n]\\quad(\\lvert a\\rvert<1)',
      transform: '\\frac{1}{1-ae^{-j\\omega}}',
      note: 'DTFT（Z 变换在单位圆上取值），需 |a| < 1',
    },
  ];

  /* ---------- 变换性质 ---------- */
  const PROPS = [
    {
      id: 'prop-linear', name: '线性',
      ctft: 'a x_1(t)+b x_2(t) \\leftrightarrow a X_1(j\\omega)+b X_2(j\\omega)',
      laplace: 'a x_1(t)+b x_2(t) \\leftrightarrow a X_1(s)+b X_2(s)',
      z: 'a x_1[n]+b x_2[n] \\leftrightarrow a X_1(z)+b X_2(z)',
      note: 'ROC 至少为各分量 ROC 的交集',
    },
    {
      id: 'prop-shift', name: '时移',
      ctft: 'x(t-t_0) \\leftrightarrow e^{-j\\omega t_0}X(j\\omega)',
      laplace: 'x(t-t_0) \\leftrightarrow e^{-s t_0}X(s)',
      z: 'x[n-n_0] \\leftrightarrow z^{-n_0}X(z)',
      note: '离散时移整体平移 ROC，可能新增/移除 z=0 或 z=∞ 处的零点极点',
    },
    {
      id: 'prop-freqshift', name: '频移（调制）',
      ctft: 'e^{j\\omega_0 t}x(t) \\leftrightarrow X\\!\\left(j(\\omega-\\omega_0)\\right)',
      laplace: 'e^{s_0 t}x(t) \\leftrightarrow X(s-s_0)',
      z: 'e^{j\\omega_0 n}x[n] \\leftrightarrow X\\!\\left(e^{-j\\omega_0}z\\right)',
      note: '复指数相乘使频谱平移；Z 域相当于 z 平面上旋转 e^{−jω₀}',
    },
    {
      id: 'prop-scaling', name: '时间尺度变换',
      ctft: 'x(at) \\leftrightarrow \\frac{1}{|a|}X\\!\\left(\\frac{j\\omega}{a}\\right)',
      laplace: 'x(at) \\leftrightarrow \\frac{1}{a}X\\!\\left(\\frac{s}{a}\\right),\\quad a>0',
      z: '',
      note: '离散时间序列不能按 a 压缩/展宽，故 Z 变换无时间尺度特性；连续情形要求 a ≠ 0',
    },
    {
      id: 'prop-conj', name: '共轭对称',
      ctft: 'x^{*}(t) \\leftrightarrow X^{*}(-j\\omega)',
      laplace: 'x^{*}(t) \\leftrightarrow X^{*}(s^{*})',
      z: 'x^{*}[n] \\leftrightarrow X^{*}(z^{*})',
      note: '实信号满足 X(jω)=X*(−jω)（幅度偶对称、相位奇对称）',
    },
    {
      id: 'prop-conv', name: '卷积定理',
      ctft: 'x(t)*h(t) \\leftrightarrow X(j\\omega)H(j\\omega)',
      laplace: 'x(t)*h(t) \\leftrightarrow X(s)H(s)',
      z: 'x[n]*h[n] \\leftrightarrow X(z)H(z)',
      note: 'ROC 至少为两信号 ROC 的交集',
    },
    {
      id: 'prop-mult', name: '乘积定理（频域卷积）',
      ctft: 'x(t)h(t) \\leftrightarrow \\frac{1}{2\\pi}X(j\\omega)*H(j\\omega)',
      laplace: 'x(t)h(t) \\leftrightarrow \\frac{1}{2\\pi j}\\int_{c-j\\infty}^{c+j\\infty}X(v)H(s-v)\\,dv',
      z: '',
      note: '连续为频域卷积（加窗/调制）；离散相乘对应 DTFT 的周期卷积',
    },
    {
      id: 'prop-tdiff', name: '时域微分',
      ctft: '\\frac{d}{dt}x(t) \\leftrightarrow j\\omega X(j\\omega)',
      laplace: '\\frac{d}{dt}x(t) \\leftrightarrow sX(s)-x(0^{-})',
      z: '',
      note: '离散无一阶微分，对应运算为一阶差分 x[n]−x[n−1] ↔ (1−z⁻¹)X(z)',
    },
    {
      id: 'prop-tint', name: '时域积分',
      ctft: '\\int_{-\\infty}^{t}x(\\tau)\\,d\\tau \\leftrightarrow \\frac{1}{j\\omega}X(j\\omega)+\\pi X(0)\\delta(\\omega)',
      laplace: '\\int_{0^{-}}^{t}x(\\tau)\\,d\\tau \\leftrightarrow \\frac{1}{s}X(s)',
      z: '',
      note: '连续积分须附加 πX(0)δ(ω) 项；拉普拉斯积分使 ROC 增加 Re{s} > 0（离散求和见「序列求和」）',
    },
    {
      id: 'prop-fdiff', name: '频域微分',
      ctft: 't x(t) \\leftrightarrow j\\frac{d}{d\\omega}X(j\\omega)',
      laplace: 't x(t) \\leftrightarrow -\\frac{d}{ds}X(s)',
      z: 'n x[n] \\leftrightarrow -z\\frac{d}{dz}X(z)',
      note: '用于求 t·x(t)、n·x[n] 的变换',
    },
    {
      id: 'prop-ivfv', name: '初值与终值定理',
      ctft: '',
      laplace: 'x(0^{+})=\\lim_{s\\to\\infty}sX(s),\\quad \\lim_{t\\to\\infty}x(t)=\\lim_{s\\to 0}sX(s)',
      z: 'x[0]=\\lim_{z\\to\\infty}X(z),\\quad \\lim_{n\\to\\infty}x[n]=\\lim_{z\\to 1}(z-1)X(z)',
      note: '终值定理要求极点位于左半平面（离散：单位圆内）',
    },
    {
      id: 'prop-parseval', name: 'Parseval 能量关系',
      ctft: '\\int_{-\\infty}^{\\infty}|x(t)|^{2}\\,dt=\\frac{1}{2\\pi}\\int_{-\\infty}^{\\infty}|X(j\\omega)|^{2}\\,d\\omega',
      laplace: '',
      z: '\\sum_{n=-\\infty}^{\\infty}|x[n]|^{2}=\\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi}|X(e^{j\\omega})|^{2}\\,d\\omega',
      note: '能量在时域与频域守恒；离散用 DTFT（周期 2π）',
    },
    {
      id: 'prop-reversal', name: '时域反转',
      ctft: 'x(-t) \\leftrightarrow X(-j\\omega)',
      laplace: 'x(-t) \\leftrightarrow X(-s)',
      z: 'x[-n] \\leftrightarrow X(1/z)',
      note: 'Z 变换 ROC 由 |z| 变为 1/|z|；时间反转等价于 z → 1/z',
    },
    {
      id: 'prop-summ', name: 'Z 变换的序列求和（累积）',
      ctft: '',
      laplace: '',
      z: '\\sum_{k=-\\infty}^{n}x[k] \\leftrightarrow \\frac{X(z)}{1-z^{-1}}',
      note: '累积和，ROC 需再加入 |z| > 1',
    },
  ];

  /* ---------- 连续 ↔ 离散 对照 ---------- */
  const CONTRAST = [
    {
      id: 'contrast-conv', concept: '卷积',
      cont: 'y(t)=\\int_{-\\infty}^{\\infty}x(\\tau)h(t-\\tau)\\,d\\tau',
      disc: 'y[n]=\\sum_{k=-\\infty}^{\\infty}x[k]h[n-k]',
      note: '连续为卷积积分，离散为卷积和',
    },
    {
      id: 'contrast-fourier', concept: '傅里叶变换',
      cont: 'X(j\\omega)=\\int_{-\\infty}^{\\infty}x(t)e^{-j\\omega t}\\,dt',
      disc: 'X(e^{j\\omega})=\\sum_{n=-\\infty}^{\\infty}x[n]e^{-j\\omega n}',
      note: 'DTFT 以 2π 为周期；连续频谱一般非周期。有限长序列取 N 点即得 DFT',
    },
    {
      id: 'contrast-sysfunc', concept: '系统函数',
      cont: 'H(s)=\\int_{-\\infty}^{\\infty}h(t)e^{-st}\\,dt',
      disc: 'H(z)=\\sum_{n=-\\infty}^{\\infty}h[n]z^{-n}',
      note: '分别为冲击响应 h(t)、h[n] 的拉普拉斯/Z 变换',
    },
    {
      id: 'contrast-freqresp', concept: '频率响应',
      cont: 's=j\\omega',
      disc: 'z=e^{j\\omega}',
      note: '在虚轴 / 单位圆上取值即得频率响应',
    },
    {
      id: 'contrast-stability', concept: '稳定性判据',
      cont: '\\mathrm{Re}\\{s\\}<0',
      disc: '|z|<1',
      note: '连续系统极点须在 s 左半平面；离散因果系统极点须在单位圆内',
    },
    {
      id: 'contrast-impulse', concept: '单位冲激',
      cont: '\\delta(t)',
      disc: '\\delta[n]',
      note: '连续 δ(t) 为无界冲激、面积归一；离散 δ[0]=1，n≠0 时为 0',
    },
    {
      id: 'contrast-diffeq', concept: '微分与差分方程',
      cont: '\\sum_{k=0}^{N}a_k\\frac{d^{k}y(t)}{dt^{k}}=\\sum_{k=0}^{M}b_k\\frac{d^{k}x(t)}{dt^{k}}',
      disc: '\\sum_{k=0}^{N}a_k y[n-k]=\\sum_{k=0}^{M}b_k x[n-k]',
      note: '连续用导数（微分方程），离散用移位（差分方程）',
    },
    {
      id: 'contrast-sample', concept: '采样与重建（频谱周期延拓）',
      cont: 'X_s(j\\omega)=\\frac{1}{T}\\sum_{k=-\\infty}^{\\infty}X\\!\\left(j(\\omega-k\\omega_s)\\right)',
      disc: 'X(e^{j\\omega})=\\frac{1}{T}\\sum_{k=-\\infty}^{\\infty}X\\!\\left(\\frac{j(\\omega-2\\pi k)}{T}\\right)',
      note: '采样使连续频谱以 ωs=2π/T 周期延拓；离散频谱随之以 2π 为周期',
    },
    {
      id: 'contrast-parseval', concept: 'Parseval 关系',
      cont: '\\int_{-\\infty}^{\\infty}|x(t)|^{2}\\,dt=\\frac{1}{2\\pi}\\int_{-\\infty}^{\\infty}|X(j\\omega)|^{2}\\,d\\omega',
      disc: '\\sum_{n=-\\infty}^{\\infty}|x[n]|^{2}=\\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi}|X(e^{j\\omega})|^{2}\\,d\\omega',
      note: '时域能量 = 频域能量密度积分；离散积分区间为 [−π, π]',
    },
  ];

  /* ---------- 搜索关键词（按 id 维护，供 searchTransforms 使用） ---------- */
  const TAGS = {
    'ctft-impulse': ['冲激', '单位冲激', 'impulse', 'delta', 'δ(t)', '常数1'],
    'ctft-impulse-shift': ['冲激', '时移', '时间平移', 'time shift', 'delta', 'e^{-jωt0}'],
    'ctft-const': ['常数', '直流', 'constant', 'dc', '冲激谱'],
    'ctft-complex-exp': ['复指数', 'complex exponential', '频移', 'ω0', '单频'],
    'ctft-step': ['阶跃', '单位阶跃', 'step', 'u(t)', '1/(jω)'],
    'ctft-exp-decay': ['指数衰减', '单边指数', 'exponential', '1/(a+jω)', '因果指数', '衰减'],
    'ctft-rect': ['矩形脉冲', '矩形', 'rect', '门函数', '脉冲', 'sinc', '抽样'],
    'ctft-sinc': ['sinc', '抽样函数', 'sinc函数', 'rect', '矩形频谱'],
    'ctft-cos': ['余弦', 'cos', 'cosine', '冲激对', '调制', '余弦信号'],
    'ctft-sin': ['正弦', 'sin', 'sine', '冲激对', '调制', '正弦信号'],
    'laplace-delta': ['冲激', 'delta', 'δ(t)', '整个s平面', 'impulse'],
    'laplace-step': ['阶跃', '单位阶跃', 'step', 'u(t)', '1/s'],
    'laplace-exp': ['指数', '单边指数', 'exponential', '1/(s+a)', '衰减指数'],
    'laplace-ramp': ['斜坡', 'ramp', 't u(t)', '1/s^2', '单位斜坡'],
    'laplace-power': ['幂函数', 't^n', 'power', 'n!/s^{n+1}', '多项式'],
    'laplace-cos': ['衰减余弦', 'cos', '余弦', '阻尼余弦', 'damped cosine'],
    'laplace-sin': ['衰减正弦', 'sin', '正弦', '阻尼正弦', 'damped sine'],
    'z-delta': ['冲激', 'delta', 'δ[n]', '整个z平面', 'impulse'],
    'z-step': ['阶跃', '单位阶跃', 'step', 'u[n]', 'z/(z-1)'],
    'z-exp': ['指数序列', '几何序列', 'geometric', 'a^n', 'z/(z-a)'],
    'z-ramp-exp': ['加权指数', 'n a^n', 'ramp', 'az^{-1}'],
    'z-cos': ['余弦序列', 'cos', '余弦', 'cosine'],
    'z-sin': ['正弦序列', 'sin', '正弦', 'sine'],
    'z-finite': ['有限长序列', 'finite', '矩形序列', '有限项和', '1-z^{-N}'],
    'dft-delta': ['冲激', 'delta', 'δ[n]', 'DFT', 'DTFT', '常数'],
    'dft-const': ['常数', '直流', 'constant', 'DFT', 'DTFT', '冲激串', '周期'],
    'dft-complex-exp': ['复指数', 'complex exponential', 'DTFT', '冲激串', '单频'],
    'dft-rect': ['矩形窗', '矩形序列', 'DFT', 'Dirichlet', '狄利克雷核', 'rect', '窗函数'],
    'dft-geo': ['指数序列', 'a^n', 'DTFT', '单位圆', 'geometry'],

    'prop-linear': ['线性', '叠加', 'linear', 'linearity'],
    'prop-shift': ['时移', '时间平移', 'time shift', '移位', '延迟'],
    'prop-freqshift': ['频移', '调制', 'frequency shift', 'modulation', '复指数相乘'],
    'prop-scaling': ['尺度变换', '时域伸缩', 'time scaling', '压缩', '展宽'],
    'prop-conj': ['共轭', '共轭对称', 'conjugate', '对称', '实信号'],
    'prop-conv': ['卷积', '卷积定理', 'convolution', '褶积', '频域相乘'],
    'prop-mult': ['乘积', '频域卷积', '加窗', '调制', 'modulation', 'product'],
    'prop-tdiff': ['微分', '时域微分', 'differentiation', '差分', '导数'],
    'prop-tint': ['积分', '时域积分', 'integration', '累积'],
    'prop-fdiff': ['频域微分', '加权', 'frequency differentiation', '频域求导'],
    'prop-ivfv': ['初值定理', '终值定理', 'initial value', 'final value', '初值', '终值'],
    'prop-parseval': ['Parseval', '能量', '帕塞瓦尔', '能量守恒'],
    'prop-reversal': ['时域反转', '反转', 'time reversal', '时间反褶', '1/z'],
    'prop-summ': ['求和', '序列求和', '累积和', 'summation', '累加'],

    'contrast-conv': ['卷积', '卷积积分', '卷积和', 'convolution'],
    'contrast-fourier': ['傅里叶', '傅里叶变换', 'CTFT', 'DTFT', 'DFT', 'fourier'],
    'contrast-sysfunc': ['系统函数', '传递函数', 'H(s)', 'H(z)', 'system function'],
    'contrast-freqresp': ['频率响应', '虚轴', '单位圆', 's=jω', 'z=e^{jω}', 'frequency response'],
    'contrast-stability': ['稳定性', '极点', '左半平面', '单位圆', 'stable', 'stability'],
    'contrast-impulse': ['冲激', '单位冲激', 'delta', 'δ(t)', 'δ[n]'],
    'contrast-diffeq': ['微分方程', '差分方程', 'difference equation', '递推'],
    'contrast-sample': ['采样', '重建', '抽样', '奈奎斯特', '周期延拓', 'sampling', 'aliasing'],
    'contrast-parseval': ['Parseval', '能量', '帕塞瓦尔', '能量守恒'],
  };

  /* ---------- 纯函数：搜索 ---------- */
  function lower(s) {
    return String(s == null ? '' : s).toLowerCase();
  }
  function joinTags(id) {
    const t = TAGS[id];
    return Array.isArray(t) ? t.join(' ') : '';
  }
  // 把一条内容拼成可搜索的文本（含所属 group 与关键词标签）
  function haystackPair(p) {
    return lower([p.group, p.name, p.time, p.transform, p.note, joinTags(p.id)].join(' '));
  }
  function haystackProp(p) {
    return lower([p.name, p.ctft, p.laplace, p.z, p.note, joinTags(p.id)].join(' '));
  }
  function haystackContrast(c) {
    return lower([c.concept, c.cont, c.disc, c.note, joinTags(c.id)].join(' '));
  }

  // 关键词过滤：中文名、英文记号、LaTeX 片段均可；多个词按 AND；空查询返回全部。
  function searchTransforms(query) {
    const q = lower(query).trim();
    if (!q) {
      return { pairs: PAIRS.slice(), props: PROPS.slice(), contrasts: CONTRAST.slice() };
    }
    const tokens = q.split(/\s+/).filter(Boolean);
    const hit = hay => tokens.every(t => hay.includes(t));
    return {
      pairs: PAIRS.filter(p => hit(haystackPair(p))),
      props: PROPS.filter(p => hit(haystackProp(p))),
      contrasts: CONTRAST.filter(c => hit(haystackContrast(c))),
    };
  }

  return {
    PAIRS, PROPS, CONTRAST, TAGS,
    searchTransforms,
  };
});
