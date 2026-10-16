/* =========================================================
   code.js 纯函数单元测试（Node 内置 test runner）
   运行：node --test test/code.test.js
   ========================================================= */
const test = require('node:test');
const assert = require('node:assert/strict');
const MQC = require('../code.js');

const { LANGS, LANG_LABEL, highlight, detectLang, codeBlockHTML } = MQC;

// 去掉所有 <span...>/<\/span> 标签，用于校验字符不变式
const stripSpans = h => h.replace(/<span[^>]*>|<\/span>/g, '');
// 与 code.js 约定一致的转义（& < > "）
const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ===================== 导出常量 ===================== */
test('导出 LANGS 与 LANG_LABEL', () => {
  assert.deepEqual(LANGS, ['matlab', 'python']);
  assert.equal(LANG_LABEL.matlab, 'MATLAB');
  assert.equal(LANG_LABEL.python, 'Python');
});

/* ===================== 安全 / HTML 转义 ===================== */
test('HTML 转义：注释里的 <script> 不会生成未转义标签', () => {
  const code = 'x = 1  # <script>&"q"';
  const h = highlight(code, 'python');
  assert.ok(!/<script>/.test(h));                    // 绝不出现未转义 <script>
  assert.ok(h.includes('&lt;script&gt;'));           // 关键断言
  assert.ok(h.includes('&amp;'));
  assert.ok(h.includes('&quot;q&quot;'));
  assert.equal(stripSpans(h), esc(code));            // 字符不变式
});

test('非法 lang 回退为纯文本高亮，仍然转义', () => {
  const code = '<script>alert(1)</script> & "x"';
  const h = highlight(code, 'javascript');
  assert.ok(!/<script>/.test(h));
  assert.ok(h.includes('&lt;script&gt;'));
  assert.equal(h, esc(code));
});

/* ===================== 注释 / 字符串不被误判 ===================== */
test('Python：字符串与注释内容不会被当作关键字', () => {
  const h = highlight('s = "if end"\nreturn s\n# for while\n', 'python');
  assert.ok(h.includes('<span class="tok-str">&quot;if end&quot;</span>'));
  assert.ok(h.includes('<span class="tok-kw">return</span>'));
  assert.ok(!/<span class="tok-kw">if<\/span>/.test(h));
  assert.ok(h.includes('<span class="tok-com"># for while</span>'));
  assert.ok(!/<span class="tok-kw">for<\/span>/.test(h));
});

test('MATLAB：注释里的关键字不加 tok-kw', () => {
  const h = highlight('% end if\nx = 2;', 'matlab');
  assert.ok(h.includes('<span class="tok-com">% end if</span>'));
  assert.ok(!h.includes('<span class="tok-kw">end</span>'));
});

test("MATLAB：落单 ' 是运算符，成对 '...' 是字符串", () => {
  const h = highlight("b = a';\nc = 'hello';", 'matlab');
  assert.ok(h.includes("<span class=\"tok-op\">'</span>"));        // 转置
  assert.ok(h.includes("<span class=\"tok-str\">'hello'</span>"));  // 字符串
});

/* ===================== 数字 ===================== */
test('数字：小数 / 科学计数法 / 复数后缀', () => {
  const h = highlight('y = 1.5e-3 + 1i;', 'matlab');
  assert.ok(h.includes('<span class="tok-num">1.5e-3</span>'));
  assert.ok(h.includes('<span class="tok-num">1i</span>'));
  const h2 = highlight('z = 2j + 0.5;', 'matlab');
  assert.ok(h2.includes('<span class="tok-num">2j</span>'));
  assert.ok(h2.includes('<span class="tok-num">0.5</span>'));
});

/* ===================== 运算符 ===================== */
test('运算符被包裹为 tok-op（含 == / ** / .* . / .^）', () => {
  const h = highlight('a = b == c', 'python');
  const eq = h.match(/<span class="tok-op">=<\/span>/g) || [];
  assert.equal(eq.length, 3);                       // = 与 == 里的两个 = 都被包裹
  assert.ok(highlight('a ** b', 'python').includes('<span class="tok-op">**</span>'));
  const m = highlight('c = a .* b ./ 2 .^ 3;', 'matlab');
  assert.ok(m.includes('<span class="tok-op">.*</span>'));
  assert.ok(m.includes('<span class="tok-op">./</span>'));
  assert.ok(m.includes('<span class="tok-op">.^</span>'));
});

/* ===================== 关键不变式：字符一一保留 ===================== */
test('字符不变式：去掉 span 后与转义原文完全一致', () => {
  const samples = [
    ['matlab', "function y = f(x)\n  % 求卷积\n  y = conv(x, [1 2 3]);\nend"],
    ['python', "def f(x):\n    # 注释\n    return x ** 2 + 1j\n"],
    ['matlab', "A = [1 2; 3 4]'; % 转置\n"],
    ['python', "s = 'it\\'s'\n"],                        // 单引号内转义
    ['python', 's = "she said \\"hi\\""\n'],            // 双引号内转义
    ['matlab', 'x = 1; % 中文注释与 emoji 🚀 <&>"'],
    ['python', ''],
    ['matlab', ''],
  ];
  for (const [lang, code] of samples) {
    assert.equal(stripSpans(highlight(code, lang)), esc(code), 'lang=' + lang + ' code=' + code);
  }
});

/* ===================== 健壮性 ===================== */
test('空输入 / null / 非法字符不崩', () => {
  assert.equal(highlight('', 'matlab'), '');
  assert.equal(highlight(null, 'python'), '');
  assert.equal(highlight(undefined, 'python'), '');
  assert.ok(highlight('print(中文) 🚀', 'python').length > 0);
  assert.equal(typeof highlight('<>&"', 'python'), 'string');
});

/* ===================== 语言猜测 ===================== */
test('detectLang 猜测特征', () => {
  assert.equal(detectLang('def f(x):\n    return x\n'), 'python');
  assert.equal(detectLang('a = np.array([1,2])\nprint(a)'), 'python');
  assert.equal(detectLang('import numpy as np\n'), 'python');
  assert.equal(detectLang('function y = f(x)\n  y = x;\nend'), 'matlab');
  assert.equal(detectLang('% 注释\nx = 1;'), 'matlab');
  assert.equal(detectLang('x = 1'), 'matlab');       // 无法判断 → 默认 matlab
  assert.equal(detectLang(''), 'matlab');
  assert.equal(detectLang(null), 'matlab');
});

/* ===================== 完整代码块 ===================== */
test('codeBlockHTML 结构 / 无内联事件 / 复制按钮', () => {
  const h = codeBlockHTML('x = 1;', 'matlab');
  assert.ok(h.startsWith('<div class="codewrap">'));
  assert.ok(h.includes('<span class="code-lang">MATLAB</span>'));
  assert.ok(h.includes('<button class="code-copy" data-copy>复制</button>'));
  assert.ok(h.includes('<pre class="code"><code>'));
  assert.ok(h.includes('</code></pre>'));
  assert.ok(!/onclick=/i.test(h));                    // 禁止内联事件
});

test('codeBlockHTML 空/非法 lang 用 detectLang 猜测', () => {
  const py = codeBlockHTML('def f():\n    return 1', '');
  assert.ok(py.includes('Python'));
  const mt = codeBlockHTML('function y = f()\nend', 'whatever');
  assert.ok(mt.includes('MATLAB'));
  assert.ok(codeBlockHTML('', null).includes('codewrap'));
});
