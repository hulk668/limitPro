/**
 * 验证码提取器单元测试（无需测试框架，直接 node 运行）
 * 运行：npm run test:extractor
 * 依赖 Node 的类型剥离能力（Node >= 22.6）。
 */
import assert from 'node:assert/strict';
import { extractVerificationCodes, htmlToText, pickBestCode } from '../src/lib/mail/codeExtractor.ts';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${error.message}`);
  }
}

console.log('\n[codeExtractor] 验证码提取器测试\n');

test('中文「验证码」关键字 + 6 位数字', () => {
  const result = extractVerificationCodes({
    subject: '【示例站点】您的验证码',
    text: '您正在注册示例站点，验证码为 482913，5 分钟内有效。',
  });
  assert.equal(result[0].code, '482913');
  assert.ok(result[0].confidence > 0.7, `置信度应大于 0.7，实际 ${result[0].confidence}`);
});

test('英文 verification code', () => {
  const result = extractVerificationCodes({
    subject: 'Your verification code',
    text: 'Use verification code 9931 to sign in. It expires in 10 minutes.',
  });
  assert.equal(result[0].code, '9931');
});

test('数字被空格分隔应能合并（123 456 -> 123456）', () => {
  const result = extractVerificationCodes({
    subject: '验证码',
    text: '您的验证码是 123 456，请勿泄露。',
  });
  assert.equal(result[0].code, '123456');
});

test('数字被连字符分隔应能合并（12-34-56 -> 123456）', () => {
  const result = extractVerificationCodes({
    subject: '验证码',
    text: '验证码：12-34-56',
  });
  assert.equal(result[0].code, '123456');
});

test('年份不应被当作验证码', () => {
  const result = extractVerificationCodes({
    subject: '验证码',
    text: '验证码 531024，版权 2024 示例公司',
  });
  assert.equal(result[0].code, '531024');
});

test('订单号上下文应被降权', () => {
  const result = extractVerificationCodes({
    subject: '您的验证码',
    text: '订单号 88123456 已发货。验证码 7391，请在 5 分钟内使用。',
  });
  assert.equal(result[0].code, '7391');
});

test('金额上下文应被降权', () => {
  const result = extractVerificationCodes({
    subject: '验证码通知',
    text: '本次消费 ¥1234.56 元。验证码为 608224。',
  });
  assert.equal(result[0].code, '608224');
});

test('HTML 邮件应能正确解析', () => {
  const html = '<html><body><p>您的验证码是</p><h2>504172</h2><style>.x{color:red}</style></body></html>';
  const result = extractVerificationCodes({ subject: '验证码', html });
  assert.equal(result[0].code, '504172');
});

test('无关键字时走兜底逻辑，且置信度较低', () => {
  const result = extractVerificationCodes({
    subject: '系统通知',
    text: '本次流水号 772314，请留存。流水号 772314。',
  });
  assert.equal(result[0].code, '772314');
  assert.ok(result[0].confidence <= 0.42, `兜底置信度应 <= 0.42，实际 ${result[0].confidence}`);
  assert.ok(/兜底/.test(result[0].reason), '判定依据应说明是兜底结果');
});

test('主题中出现的验证码应获得额外权重', () => {
  const inSubject = extractVerificationCodes({
    subject: '验证码 331277',
    text: '您的验证码 331277 已生成',
  });
  assert.equal(inSubject[0].code, '331277');
  assert.ok(/主题/.test(inSubject[0].reason), '判定依据应提到主题命中');
});

test('pickBestCode 返回置信度最高的候选', () => {
  const result = extractVerificationCodes({
    subject: '验证码',
    text: '验证码为 445566。订单号 99887766。',
  });
  const best = pickBestCode(result);
  assert.ok(best);
  assert.equal(best.code, '445566');
});

test('htmlToText 能还原实体并去除脚本', () => {
  const text = htmlToText('<div>验证码&nbsp;<b>112233</b><script>var a=1;</script></div>');
  assert.ok(text.includes('112233'), `应包含 112233，实际: ${text}`);
  assert.ok(!text.includes('var a'), `不应包含脚本内容，实际: ${text}`);
});

test('空输入应返回空数组', () => {
  assert.deepEqual(extractVerificationCodes({}), []);
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
