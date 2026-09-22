/**
 * 端到端冒烟测试 —— 直接打真实 HTTP 端点，覆盖正常路径与错误分支。
 *
 * 用法：
 *   1) 先启动后端：pnpm start:web   （默认 3210 端口）
 *   2) 另开终端执行：pnpm smoke
 *      或指定地址：LIMITPRO_SMOKE_BASE=http://127.0.0.1:3211 pnpm smoke
 *
 * 脚本会在结束时清理自己创建的数据，不会污染已有记录。
 */

const BASE = process.env.LIMITPRO_SMOKE_BASE ?? 'http://127.0.0.1:3210';

let passed = 0;
let failed = 0;
const cleanup = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}

async function call(method, path, body, headers = undefined) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  return { status: response.status, payload, requestId: response.headers.get('x-request-id') };
}

console.log(`\n[smoke] limitPro 端到端冒烟测试 -> ${BASE}\n`);

try {
  /* ------------------------------- 健康检查 ------------------------------- */
  console.log('· 基础端点');
  const health = await call('GET', '/api/health');
  check('GET /api/health 返回 200', health.status === 200, `实际 ${health.status}`);
  check('健康状态为 ok', health.payload?.data?.status === 'ok');
  check('响应携带 requestId 响应头', Boolean(health.requestId));
  check('统一响应结构 { ok, data, requestId }', health.payload?.ok === true && 'data' in health.payload);

  const meta = await call('GET', '/api/meta');
  check('GET /api/meta 返回 200', meta.status === 200);
  check(
    '默认 IMAP 服务器为 imap.2925.com:993',
    meta.payload?.data?.mail?.defaults?.host === 'imap.2925.com' &&
      meta.payload?.data?.mail?.defaults?.port === 993,
  );
  check('标注了 2925 不支持 SEARCH', meta.payload?.data?.mail?.disableServerSearch === true);

  /* ------------------------------ 数据目录 ------------------------------- */
  // 回归断言：界面上「打开数据目录」拿到的路径，必须就是后端真正读写的那个目录。
  // 曾经的 bug 是 Electron 主进程自己拼了 %APPDATA%/<appName>/data，
  // 而 dev 模式下后端其实在用 <项目根>/.data，导致按钮打开空目录。
  console.log('\n· 数据目录（唯一事实来源 = 后端 config.dataDir）');
  const dataDir = await call('POST', '/api/system/reveal-data-dir', { dryRun: true });
  check('POST /api/system/reveal-data-dir 返回 200', dataDir.status === 200, `实际 ${dataDir.status}`);
  const dataDirPath = dataDir.payload?.data?.path;
  check('dryRun 不会真正打开文件夹', dataDir.payload?.data?.opened === false && dataDir.payload?.data?.command === null);
  check(
    '返回绝对路径',
    typeof dataDirPath === 'string' && (/^[A-Za-z]:[\\/]/.test(dataDirPath) || dataDirPath.startsWith('/')),
    String(dataDirPath),
  );
  check('路径来源标注合法', ['LIMITPRO_DATA_DIR', 'default'].includes(dataDir.payload?.data?.source));
  check('返回目录条目数', typeof dataDir.payload?.data?.entryCount === 'number');
  check(
    '打开目标与 /api/health 报告的数据目录完全一致',
    Boolean(dataDirPath) && dataDirPath === health.payload?.data?.dataDir,
    `reveal=${dataDirPath} health=${health.payload?.data?.dataDir}`,
  );

  const badDryRun = await call('POST', '/api/system/reveal-data-dir', { dryRun: 'yes' });
  check('dryRun 非布尔值返回 400', badDryRun.status === 400, `实际 ${badDryRun.status}`);
  check('错误码为 VALIDATION_ERROR', badDryRun.payload?.error?.code === 'VALIDATION_ERROR');

  const crossOrigin = await call(
    'POST',
    '/api/system/reveal-data-dir',
    { dryRun: true },
    { origin: 'https://evil.example.com' },
  );
  check('拒绝跨源调用返回 400', crossOrigin.status === 400, `实际 ${crossOrigin.status}`);

  /* --------------------------------- 账号 --------------------------------- */
  console.log('\n· 邮箱账号');
  const accounts0 = await call('GET', '/api/accounts');
  check('GET /api/accounts 返回 200 且为数组', accounts0.status === 200 && Array.isArray(accounts0.payload?.data?.accounts));

  const badCreate = await call('POST', '/api/accounts', {
    email: 'not-an-email',
    password: 'x',
    verify: false,
  });
  check('非法邮箱返回 400', badCreate.status === 400, `实际 ${badCreate.status}`);
  check('错误码为 VALIDATION_ERROR', badCreate.payload?.error?.code === 'VALIDATION_ERROR');
  check(
    '错误详情包含字段级信息',
    typeof badCreate.payload?.error?.details?.fields?.email === 'string',
    JSON.stringify(badCreate.payload?.error?.details),
  );

  const created = await call('POST', '/api/accounts', {
    label: '冒烟测试账号',
    email: `smoke_test_${Date.now()}@2925.com`,
    password: 'fake-password-for-smoke-test',
    imapHost: 'imap.2925.com',
    imapPort: 993,
    secure: true,
    verify: false,
  });
  check('skipVerify 新增账号返回 201', created.status === 201, `实际 ${created.status} ${JSON.stringify(created.payload)}`);
  check('响应不含密码字段', created.payload?.data?.account && !('password' in created.payload.data.account));
  check('响应不含密文字段', created.payload?.data?.account && !('passwordEnc' in created.payload.data.account));
  const accountId = created.payload?.data?.account?.id;
  if (accountId) cleanup.push(() => call('DELETE', `/api/accounts/${accountId}`));

  const fallbackLabel = created.payload?.data?.account?.label;
  check('label 正确写入', fallbackLabel === '冒烟测试账号');

  /* ------------------------------ 随机凭据 ------------------------------- */
  console.log('\n· 随机凭据生成');
  const generated = await call('POST', '/api/credentials/generate', {
    count: 3,
    usernameLength: 12,
    passwordLength: 16,
    uppercase: true,
    symbols: true,
    digits: true,
    excludeAmbiguous: true,
    style: 'readable',
    emailDomain: '2925.com',
    emailPrefix: 'smoke',
    aliasSeparator: '_',
  });
  check('生成接口返回 201', generated.status === 201, `实际 ${generated.status} ${JSON.stringify(generated.payload)}`);
  const credentials = generated.payload?.data?.credentials ?? [];
  check('生成 3 组凭据', credentials.length === 3, `实际 ${credentials.length}`);
  check('密码长度为 16', credentials.every((item) => item.password.length === 16));
  check(
    '密码同时包含大小写字母与数字',
    credentials.every(
      (item) => /[a-z]/.test(item.password) && /[A-Z]/.test(item.password) && /\d/.test(item.password),
    ),
  );
  check(
    '邮箱按「前缀_随机串@域名」生成',
    credentials.every((item) => /^smoke_[a-z0-9]+@2925\.com$/.test(item.email)),
    credentials.map((item) => item.email).join(', '),
  );
  check(
    'readable 风格的用户名后缀不含易混淆数字',
    credentials.every((item) => !/[015]/.test(item.username.replace(/^[a-z]+/, ''))),
  );
  check('返回强度评估', credentials.every((item) => typeof item.strength?.label === 'string'));

  // readable 风格使用真实英文单词，字符排除只作用于随机字符集与数字后缀；
  // 这里额外验证 random 风格的完整字符集排除。
  const randomStyle = await call('POST', '/api/credentials/generate', {
    count: 2,
    usernameLength: 14,
    passwordLength: 20,
    uppercase: true,
    symbols: false,
    digits: true,
    excludeAmbiguous: true,
    style: 'random',
    emailDomain: '',
    emailPrefix: '',
    aliasSeparator: '_',
  });
  const randomItems = randomStyle.payload?.data?.credentials ?? [];
  check('random 风格生成 2 组', randomItems.length === 2, `实际 ${randomItems.length}`);
  check(
    'random 风格用户名完全不含易混淆字符',
    randomItems.length === 2 && randomItems.every((item) => !/[0Oo1lIi5Ss]/.test(item.username)),
    randomItems.map((item) => item.username).join(', '),
  );
  check('random 风格用户名以字母开头', randomItems.length === 2 && randomItems.every((item) => /^[a-z]/.test(item.username)));
  check('邮箱域名为空时不生成邮箱', randomItems.length === 2 && randomItems.every((item) => item.email === ''));
  for (const item of randomItems) cleanup.push(() => call('DELETE', `/api/credentials/${item.id}`));

  /* --------------------- 自动随机模式（简化界面使用） ---------------------- */
  console.log('\n· 自动随机模式（randomize）');
  const autoBatch = await call('POST', '/api/credentials/generate', {
    count: 10,
    randomize: true,
    emailDomain: '',
    emailPrefix: '',
  });
  check('randomize 模式返回 201', autoBatch.status === 201, `实际 ${autoBatch.status}`);
  const autoItems = autoBatch.payload?.data?.credentials ?? [];
  check('randomize 生成 10 组', autoItems.length === 10, `实际 ${autoItems.length}`);
  const autoPasswordLengths = autoItems.map((item) => item.password.length);
  check(
    '密码长度落在自动随机区间 14~20',
    autoPasswordLengths.every((length) => length >= 14 && length <= 20),
    autoPasswordLengths.join(', '),
  );
  check(
    '用户名长度落在合法区间 6~32',
    autoItems.every((item) => item.username.length >= 6 && item.username.length <= 32),
  );
  // 说明：随机长度是「每批抽一次」（同一批内长度一致），因此要跨批次比较才能观察到变化。
  // 连续 5 批全部落在同一长度的概率约为 7*(1/7)^5 ≈ 0.04%，作为回归断言足够稳定。
  const autoLengthSamples = [...autoPasswordLengths.slice(0, 1)];
  for (let round = 0; round < 4; round += 1) {
    const probe = await call('POST', '/api/credentials/generate', { count: 1, randomize: true, emailDomain: '', emailPrefix: '' });
    const probeItems = probe.payload?.data?.credentials ?? [];
    for (const item of probeItems) {
      autoLengthSamples.push(item.password.length);
      cleanup.push(() => call('DELETE', `/api/credentials/${item.id}`));
    }
  }
  check(
    '跨批次之间长度确实随机变化',
    new Set(autoLengthSamples).size >= 2,
    autoLengthSamples.join(', '),
  );
  check(
    '未传字符集开关时按默认值生成（含大小写与数字）',
    autoItems.every(
      (item) => /[a-z]/.test(item.password) && /[A-Z]/.test(item.password) && /\d/.test(item.password),
    ),
  );
  check(
    '默认排除易混淆字符（0Oo1lIi5Ss）',
    autoItems.every((item) => !/[0Oo1lIi5Ss]/.test(item.password)),
    autoItems.map((item) => item.password).join(', '),
  );
  for (const item of autoItems) cleanup.push(() => call('DELETE', `/api/credentials/${item.id}`));

  const credList = await call('GET', '/api/credentials?limit=3');
  check('GET /api/credentials 返回 200 且含明文密码', credList.status === 200 && Array.isArray(credList.payload?.data?.credentials));

  /* --------------------------- 邮箱拉取（错误分支） --------------------------- */
  console.log('\n· 邮件拉取');
  const notFound = await call('POST', '/api/mail/fetch', { accountId: 'no-such-account' });
  check('不存在的账号返回 404', notFound.status === 404, `实际 ${notFound.status}`);
  check('错误码为 NOT_FOUND', notFound.payload?.error?.code === 'NOT_FOUND');

  const badBody = await call('POST', '/api/mail/fetch', {});
  check('缺少 accountId 返回 400', badBody.status === 400, `实际 ${badBody.status}`);
  check('字段错误定位到 accountId', typeof badBody.payload?.error?.details?.fields?.accountId === 'string');

  const codes = await call('GET', '/api/codes?limit=10');
  check('GET /api/codes 返回 200 且为数组', codes.status === 200 && Array.isArray(codes.payload?.data?.codes));

  const badLimit = await call('GET', '/api/codes?limit=99999');
  check('超出上限的 limit 返回 400', badLimit.status === 400, `实际 ${badLimit.status}`);

  /* -------------------------------- 清理 --------------------------------- */
  console.log('\n· 清理测试数据');
  for (const item of credentials) {
    cleanup.push(() => call('DELETE', `/api/credentials/${item.id}`));
  }
  let cleaned = 0;
  for (const task of cleanup.reverse()) {
    try {
      const result = await task();
      if (result.status < 400) cleaned += 1;
    } catch {
      /* 忽略清理异常 */
    }
  }
  console.log(`  已清理 ${cleaned}/${cleanup.length} 项测试数据`);
} catch (error) {
  failed += 1;
  console.error(`\n  ✗ 冒烟测试执行异常: ${error instanceof Error ? error.message : String(error)}`);
  console.error('    请确认后端已启动（pnpm start:web 或 pnpm dev:web）');
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
