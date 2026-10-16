/* =========================================================
   transforms.js 数据模块单元测试（Node 内置 test runner）
   运行：node --test test/transforms.test.js
   ========================================================= */
const test = require('node:test');
const assert = require('node:assert/strict');
const MQT = require('../transforms.js');

const {
  PAIRS, PROPS, CONTRAST, TAGS, searchTransforms,
} = MQT;

/* 各 group 的条目数下限（写死期望，防止数据被删改） */
const GROUP_MIN = { ctft: 8, laplace: 6, z: 6, dft: 4 };
const PROP_MIN = 10;
const CONTRAST_MIN = 8;

/* 收集一组 LaTeX 字符串及其来源标签 */
function allLatex() {
  const out = [];
  PAIRS.forEach(p => {
    out.push(['pair:' + p.id + ':time', p.time]);
    out.push(['pair:' + p.id + ':transform', p.transform]);
  });
  PROPS.forEach(p => {
    ['ctft', 'laplace', 'z'].forEach(k => {
      if (p[k]) out.push(['prop:' + p.id + ':' + k, p[k]]);
    });
  });
  CONTRAST.forEach(c => {
    out.push(['contrast:' + c.id + ':cont', c.cont]);
    out.push(['contrast:' + c.id + ':disc', c.disc]);
  });
  return out;
}

/* ===================== PAIRS ===================== */
test('PAIRS 覆盖四个 group 且条目数达到下限', () => {
  const valid = Object.keys(GROUP_MIN);
  const counts = { ctft: 0, laplace: 0, z: 0, dft: 0 };
  PAIRS.forEach(p => {
    assert.ok(valid.includes(p.group), '出现非法 group：' + p.group);
    counts[p.group]++;
  });
  valid.forEach(g => {
    assert.ok(counts[g] >= GROUP_MIN[g], g + ' 条目数不足，期望 ≥ ' + GROUP_MIN[g] + '，实际 ' + counts[g]);
  });
});

test('PAIRS 每条含完整字段且 time/transform 为非空 LaTeX', () => {
  PAIRS.forEach(p => {
    assert.ok(p.id && typeof p.id === 'string', 'id 缺失');
    assert.ok(p.name && typeof p.name === 'string', p.id + ' 的 name 缺失');
    assert.equal(typeof p.note, 'string', p.id + ' 的 note 应为字符串');

    assert.ok(typeof p.time === 'string' && p.time.length > 0, p.id + ' 的 time 为空');
    assert.ok(typeof p.transform === 'string' && p.transform.length > 0, p.id + ' 的 transform 为空');
    assert.ok(p.time.includes('\\'), p.id + ' 的 time 不是 LaTeX（缺少反斜杠）：' + p.time);
    assert.ok(p.transform.includes('\\'), p.id + ' 的 transform 不是 LaTeX（缺少反斜杠）：' + p.transform);
  });
});

test('PAIRS 收录了各 group 要求的标准条目', () => {
  const ids = new Set(PAIRS.map(p => p.id));
  [
    'ctft-impulse', 'ctft-step', 'ctft-exp-decay', 'ctft-rect', 'ctft-sinc',
    'ctft-impulse-shift', 'ctft-cos', 'ctft-sin',
    'laplace-delta', 'laplace-step', 'laplace-exp', 'laplace-ramp', 'laplace-power', 'laplace-cos',
    'z-delta', 'z-step', 'z-exp', 'z-ramp-exp', 'z-cos', 'z-finite',
    'dft-delta', 'dft-const', 'dft-complex-exp', 'dft-rect',
  ].forEach(id => assert.ok(ids.has(id), '缺少标准条目：' + id));
});

/* ===================== id 唯一性 ===================== */
test('所有 id 全局唯一（PAIRS + PROPS + CONTRAST）', () => {
  const ids = [...PAIRS, ...PROPS, ...CONTRAST].map(x => x.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dup, [], '存在重复 id：' + dup.join(', '));
  assert.equal(new Set(ids).size, ids.length);
});

/* ===================== PROPS ===================== */
test('PROPS 至少 10 条，且每条至少在一个变换下有非空公式', () => {
  assert.ok(PROPS.length >= PROP_MIN, 'PROPS 条目不足，实际 ' + PROPS.length);
  PROPS.forEach(p => {
    assert.ok(p.id && p.name, 'PROPS 条目缺少 id/name');
    ['ctft', 'laplace', 'z'].forEach(k => {
      assert.equal(typeof p[k], 'string', p.id + ' 的 ' + k + ' 应为字符串');
    });
    const nonEmpty = [p.ctft, p.laplace, p.z].filter(s => s.length > 0);
    assert.ok(nonEmpty.length >= 1, p.id + ' 至少在一种变换下应有非空公式');
    assert.equal(typeof p.note, 'string', p.id + ' 的 note 应为字符串');
  });
});

test('PROPS 覆盖题目点名的全部性质', () => {
  const ids = new Set(PROPS.map(p => p.id));
  [
    'prop-linear', 'prop-shift', 'prop-freqshift', 'prop-scaling', 'prop-conj',
    'prop-conv', 'prop-mult', 'prop-tdiff', 'prop-tint', 'prop-fdiff',
    'prop-ivfv', 'prop-parseval', 'prop-reversal', 'prop-summ',
  ].forEach(id => assert.ok(ids.has(id), '缺少性质条目：' + id));
});

/* ===================== CONTRAST ===================== */
test('CONTRAST 至少 8 条，且 cont / disc 均非空', () => {
  assert.ok(CONTRAST.length >= CONTRAST_MIN, 'CONTRAST 条目不足，实际 ' + CONTRAST.length);
  CONTRAST.forEach(c => {
    assert.ok(c.id && c.concept, 'CONTRAST 条目缺少 id/concept');
    assert.ok(typeof c.cont === 'string' && c.cont.length > 0, c.id + ' 的 cont 为空');
    assert.ok(typeof c.disc === 'string' && c.disc.length > 0, c.id + ' 的 disc 为空');
    assert.equal(typeof c.note, 'string', c.id + ' 的 note 应为字符串');
  });
});

/* ===================== TAGS ===================== */
test('TAGS 覆盖全部条目且值为非空关键词数组', () => {
  [...PAIRS, ...PROPS, ...CONTRAST].forEach(x => {
    const t = TAGS[x.id];
    assert.ok(Array.isArray(t) && t.length > 0, x.id + ' 缺少搜索关键词');
    t.forEach(k => assert.ok(typeof k === 'string' && k.length > 0, x.id + ' 关键词含空值'));
  });
});

/* ===================== searchTransforms ===================== */
test('searchTransforms：空查询返回全部', () => {
  const r = searchTransforms('');
  assert.equal(r.pairs.length, PAIRS.length);
  assert.equal(r.props.length, PROPS.length);
  assert.equal(r.contrasts.length, CONTRAST.length);

  const r2 = searchTransforms('   ');
  assert.equal(r2.pairs.length, PAIRS.length);
  assert.equal(r2.props.length, PROPS.length);
  assert.equal(r2.contrasts.length, CONTRAST.length);
});

test('searchTransforms：关键词「卷积」命中卷积相关条目', () => {
  const r = searchTransforms('卷积');
  const total = r.pairs.length + r.props.length + r.contrasts.length;
  assert.ok(total > 0, '「卷积」应至少命中一条');
  assert.ok(r.props.some(p => p.id === 'prop-conv'), '应命中卷积定理');
  assert.ok(r.contrasts.some(c => c.id === 'contrast-conv'), '应命中卷积对照');
});

test('searchTransforms：英文记号与 LaTeX 片段可命中', () => {
  assert.ok(searchTransforms('\\delta').pairs.length > 0, 'LaTeX 片段 \\delta 应命中变换对');
  assert.ok(searchTransforms('\\omega').props.length > 0, 'LaTeX 片段 \\omega 应命中性质');
  assert.ok(searchTransforms('laplace').pairs.length > 0, '英文关键词应命中');
});

test('searchTransforms：大小写不敏感', () => {
  const lower = searchTransforms('convolution');
  const upper = searchTransforms('CONVOLUTION');
  assert.ok(lower.props.length > 0 && lower.contrasts.length > 0);
  assert.deepEqual(
    upper.props.map(p => p.id),
    lower.props.map(p => p.id)
  );
});

test('searchTransforms：查询不存在的词返回三个空数组', () => {
  const r = searchTransforms('zzz_this_word_does_not_exist_zzz');
  assert.deepEqual(r.pairs, []);
  assert.deepEqual(r.props, []);
  assert.deepEqual(r.contrasts, []);
});

/* ===================== LaTeX 括号配对 ===================== */
function countChar(s, ch) {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}
// \left / \right 需成对出现；用负向前瞻排除 \leftrightarrow、\rvert 等
function countCmd(s, cmd) {
  const re = new RegExp('\\\\' + cmd + '(?![a-zA-Z])', 'g');
  return (s.match(re) || []).length;
}

test('LaTeX 括号配对检查（圆括号/花括号/方括号/\\left-\\right）', () => {
  allLatex().forEach(([label, s]) => {
    assert.equal(countChar(s, '('), countChar(s, ')'),
      label + ' 圆括号不配对：' + s);
    assert.equal(countChar(s, '{'), countChar(s, '}'),
      label + ' 花括号不配对：' + s);
    assert.equal(countChar(s, '['), countChar(s, ']'),
      label + ' 方括号不配对：' + s);
    assert.equal(countCmd(s, 'left'), countCmd(s, 'right'),
      label + ' \\left / \\right 不成对：' + s);
  });
});
