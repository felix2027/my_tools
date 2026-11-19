import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildWorker } from '../r76s/build.mjs';
import { toR76sConfig } from '../r76s/profile.mjs';

const template = 'https://raw.githubusercontent.com/felix2027/my_tools/main/config/proxy_config_next.ini';
const regions = ['TW', 'SG', 'JP', 'US', 'HK'];
const base = 'http://www.gstatic.com/generate_204';
const providerName = 'R76SNodes';
const japaneseSpecial = 'JP-fast.+[X]`one';
const inputNames = ['ZZ-other', 'HK-1', 'JP-1', 'SG-1', 'US-1', 'TW-1', japaneseSpecial];

function node(name) {
  return { name, type: 'trojan', server: 'fixture.invalid', port: 443, password: 'fixture' };
}

function nextConfig(nodes = inputNames.map(node)) {
  const names = nodes.map(({ name }) => name);
  function select(name, proxies) {
    return { name, type: 'select', proxies };
  }
  function automatic(name, type, proxies, options = {}) {
    return { name, type, proxies, url: base, interval: 600, ...options };
  }
  const main = ['Proxies', 'Manual', 'Auto', ...regions, 'DIRECT'];
  return {
    mode: 'rule',
    proxies: nodes,
    'proxy-groups': [
      select('Proxies', ['Fallback', 'LoadBalance', 'Manual', ...regions, 'Auto', 'DIRECT']),
      select('Manual', ['REJECT', ...names]),
      automatic('Auto', 'url-test', names, { tolerance: 200 }),
      automatic('LoadBalance', 'load-balance', names, { strategy: 'consistent-hashing' }),
      automatic('Fallback', 'fallback', ['Manual', ...regions, 'Auto'], { interval: 150 }),
      select('Direct', ['DIRECT', 'Proxies', 'Auto']),
      select('Ai', main), select('Apple', main), select('Game', main), select('Microsoft', main),
      select('Bahamut', ['TW_HK_Fallback', 'Proxies', 'DIRECT']),
      select('Bilibili', ['Direct', 'TW_HK_Fallback', 'Proxies']),
      select('AdBlock', ['REJECT', 'Proxies', 'DIRECT']),
      select('Final', ['Proxies', 'Manual', 'DIRECT']),
      automatic('TW_HK_Fallback', 'fallback', ['TW', 'HK', 'Direct'], {
        url: 'http://api.bilibili.com/x/web-interface/nav', interval: 180,
      }),
      ...regions.map(region => {
        const matches = names.filter(name => name.startsWith(region + '-'));
        // Subconverter emits DIRECT if a single conversion batch has no matching region.
        return automatic(region, 'url-test', matches.length ? matches : ['DIRECT'], { tolerance: 150 });
      }),
    ],
    rules: ['DOMAIN-SUFFIX,cdn.invalid,Final', 'DOMAIN,ads.invalid,AdBlock', 'MATCH,Final'],
  };
}

function filteredNames(group, names) {
  const ordered = new Set();
  for (const expression of group.filter.split('`')) {
    const regex = new RegExp(expression.replace(/^\(\?i\)/, ''), expression.startsWith('(?i)') ? 'i' : '');
    for (const name of names) {
      if (regex.test(name)) ordered.add(name);
    }
  }
  return [...ordered];
}

test('one inline provider supplies the next groups and keeps all node definitions and routing rules', () => {
  const original = nextConfig();
  const result = toR76sConfig(structuredClone(original));
  assert.deepEqual(Object.keys(result['proxy-providers']), [providerName]);
  const provider = result['proxy-providers'][providerName];
  assert.equal(provider.type, 'inline');
  assert.deepEqual(provider.payload, original.proxies);
  const health = provider['health-check'];
  assert.equal(health.enable, true);
  assert.equal(health.lazy, false);
  assert.equal(health.interval, 150);
  assert.match(health.url, /^https:\/\//);
  assert.equal(String(health['expected-status']), '204');
  assert.deepEqual(result.proxies ?? [], []);
  assert.deepEqual(result.rules, original.rules);
  assert.deepEqual(result['proxy-groups'].map(g => g.name), original['proxy-groups'].map(g => g.name));

  const groups = new Map(result['proxy-groups'].map(g => [g.name, g]));
  const converted = ['Auto', 'LoadBalance', 'Manual', 'Fallback', 'TW_HK_Fallback', ...regions];
  for (const name of converted) {
    const group = groups.get(name);
    assert.deepEqual(group.use, [providerName], name);
    assert.deepEqual(group.proxies ?? [], name === 'Manual' ? ['REJECT'] : [], name);
    for (const key of ['url', 'interval', 'lazy', 'expected-status']) assert.ok(!(key in group), name + ': ' + key);
  }
  for (const group of original['proxy-groups'].filter(g => !converted.includes(g.name))) {
    assert.deepEqual(groups.get(group.name), group);
  }
  assert.equal(groups.get('LoadBalance').strategy, 'consistent-hashing');
  for (const region of regions) {
    assert.deepEqual(filteredNames(groups.get(region), inputNames), inputNames.filter(n => n.startsWith(region)));
  }
  assert.deepEqual(filteredNames(groups.get('Fallback'), inputNames),
    ['TW-1', 'SG-1', 'JP-1', japaneseSpecial, 'US-1', 'HK-1', 'ZZ-other']);
  assert.deepEqual(filteredNames(groups.get('JP'), [japaneseSpecial, 'JP-fastZAAAAX`one', 'JP-new']), [japaneseSpecial]);
  assert.deepEqual(filteredNames(groups.get('TW_HK_Fallback'), inputNames), ['TW-1', 'HK-1']);
});

test('missing regions explicitly reject until the next subscription adds matching nodes', () => {
  const result = toR76sConfig(nextConfig([node('JP-only')]));
  const groups = new Map(result['proxy-groups'].map(g => [g.name, g]));
  for (const name of ['TW', 'HK', 'SG', 'US', 'TW_HK_Fallback']) {
    assert.equal(groups.get(name).type, 'select');
    assert.deepEqual(groups.get(name).proxies, ['REJECT']);
    assert.ok(!groups.get(name).use);
    assert.ok(!groups.get(name).url);
  }
  assert.deepEqual(filteredNames(groups.get('Fallback'), ['JP-only']), ['JP-only']);
});

test('dual WAN marks only provider nodes and returns literal private destinations to system routing', () => {
  const original = nextConfig();
  const result = toR76sConfig(structuredClone(original), 1186);
  const ordinary = toR76sConfig(structuredClone(original));
  const provider = result['proxy-providers'][providerName];
  assert.deepEqual(provider.override, { 'routing-mark': 1186 });
  assert.deepEqual(provider.payload, original.proxies);
  assert.deepEqual(provider['health-check'], ordinary['proxy-providers'][providerName]['health-check']);
  assert.deepEqual(result['proxy-groups'], ordinary['proxy-groups']);
  assert.ok(!('routing-mark' in result) && !('interface-name' in result));
  assert.deepEqual(result.rules, [
    'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
    'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
    'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
    ...original.rules,
  ]);
  assert.ok(!('override' in ordinary['proxy-providers'][providerName]));
  assert.deepEqual(ordinary.rules, original.rules);
});

test('dual WAN refuses conflicting global, group and upstream node egress settings', () => {
  for (const entry of [cfg => cfg, cfg => cfg['proxy-groups'][0], cfg => cfg.proxies[0]]) {
    for (const [key, value] of [['routing-mark', 8], ['interface-name', 'eth0'], ['dialer-proxy', 'Direct']]) {
      const input = nextConfig();
      entry(input)[key] = value;
      assert.throws(() => toR76sConfig(input, 1186));
    }
  }
  const input = nextConfig();
  input.proxies[0].type = 'direct';
  assert.throws(() => toR76sConfig(input, 1186));
});

test('malformed or ambiguous configurations fail instead of returning an incomplete profile', () => {
  const duplicate = nextConfig([node('JP-repeat'), node('JP-repeat')]);
  assert.throws(() => toR76sConfig(duplicate));
  const missingGroup = nextConfig();
  missingGroup['proxy-groups'] = missingGroup['proxy-groups'].filter(g => g.name !== 'Fallback');
  assert.throws(() => toR76sConfig(missingGroup));
  const staleRule = nextConfig();
  staleRule.rules.unshift('IP-CIDR,192.0.2.0/24,JP-1,no-resolve');
  assert.throws(() => toR76sConfig(staleRule));
  assert.throws(() => toR76sConfig({ proxies: [], 'proxy-groups': [], rules: [] }));
});

const builtWorker = Promise.all([
  readFile(new URL('../worker.js', import.meta.url), 'utf8'),
  readFile(new URL('../r76s/profile.mjs', import.meta.url), 'utf8'),
]).then(async ([bundle, source]) => {
  const output = buildWorker(bundle, source);
  return (await import('data:text/javascript;base64,' + Buffer.from(output).toString('base64'))).default;
});

function request(parameters) {
  const url = new URL('https://frontend.invalid/sub');
  url.search = new URLSearchParams({
    url: 'trojan://fixture@fixture.invalid:443#TW-primary|trojan://fixture@fixture.invalid:443#JP-backup',
    target: 'clash', ...parameters,
  });
  return new Request(url);
}

function mockBackend(t, makeResponse = nextConfig) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.origin, 'https://backend.invalid');
    assert.equal(url.pathname, '/sub');
    calls.push(url.searchParams);
    const nodes = url.searchParams.get('url').split('|').map(link => {
      const raw = new URL(link);
      return { ...node(decodeURIComponent(raw.hash.slice(1))), server: raw.hostname, password: raw.username };
    });
    return new Response(JSON.stringify(makeResponse(nodes)));
  });
  return calls;
}

const env = { BACKEND: 'https://backend.invalid', CHUNK_COUNT: '1' };

test('Worker applies the opt-in after chunk merge and node restoration', async t => {
  const calls = mockBackend(t);
  const worker = await builtWorker;
  const response = await worker.fetch(request({ profile: 'r76s' }), env, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /yaml/i);
  const text = await response.text();
  assert.equal(calls.length, 2);
  assert.ok(calls.every(query => !query.has('profile') && query.get('config') === template));
  assert.match(text, /^proxy-providers:/m);
  assert.doesNotMatch(text, /^proxies:/m);
  assert.match(text, /name: TW-primary/);
  assert.match(text, /name: JP-backup/);
  assert.match(text, /server: fixture\.invalid/);
  assert.match(text, /MATCH,Final/);
});

test('ordinary subscribers still receive the original flat config', async t => {
  const calls = mockBackend(t);
  const worker = await builtWorker;
  const response = await worker.fetch(request({ config: template }), { ...env, R76S_PROXY_ROUTING_MARK: '1186' }, {});
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.equal(calls.length, 2);
  assert.match(text, /^proxies:/m);
  assert.doesNotMatch(text, /^proxy-providers:/m);
});

test('Worker uses its configured proxy mark and refuses invalid or reserved marks before conversion', async t => {
  const calls = mockBackend(t);
  const worker = await builtWorker;
  for (const mark of ['', '0', '-1', '1.5', '1e3', 'abc', '4294967296', '0x162', '354']) {
    const response = await worker.fetch(request({ profile: 'r76s' }), { ...env, R76S_PROXY_ROUTING_MARK: mark }, {});
    assert.equal(response.status, 500, mark);
  }
  assert.equal(calls.length, 0);
  const response = await worker.fetch(request({ profile: 'r76s' }), { ...env, R76S_PROXY_ROUTING_MARK: '0x4a2' }, {});
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /routing-mark: 1186/);
  assert.match(body, /IP-CIDR,172\.16\.0\.0\/12,DIRECT,no-resolve/);
  assert.equal(calls.length, 2);
});

test('Worker can reduce metered probe frequency without starting additional group timers', async t => {
  const calls = mockBackend(t);
  const worker = await builtWorker;
  for (const interval of ['0', '-5', '', '1.5', '2147483648']) {
    const res = await worker.fetch(request({ profile: 'r76s' }), { ...env, R76S_PROBE_INTERVAL_SECONDS: interval }, {});
    assert.equal(res.status, 500);
  }
  assert.equal(calls.length, 0);
  const options = { ...env, R76S_PROBE_INTERVAL_SECONDS: '600', R76S_PROXY_ROUTING_MARK: '1186' };
  const res = await worker.fetch(request({ profile: 'r76s' }), options, {});
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.deepEqual(text.match(/^\s+interval: \d+$/gm)?.map(line => line.trim()), ['interval: 600']);
  assert.match(text, /routing-mark: 1186/);
});

test('R76S rejects a different template, target or node-list output before any backend request', async t => {
  const calls = mockBackend(t);
  const worker = await builtWorker;
  for (const extra of [{ target: 'singbox' }, { list: 'true' }, { config: 'https://example.invalid/other.ini' }]) {
    const response = await worker.fetch(request({ profile: 'r76s', ...extra }), env, {});
    assert.ok(response.status >= 400 && response.status < 500, JSON.stringify(extra));
  }
  assert.equal(calls.length, 0);
});

test('an invalid backend response yields an error with no subscription or upstream details', async t => {
  const upstreamMarker = 'sensitive-upstream-fixture';
  const sourceMarker = 'private-source-fixture';
  t.mock.method(globalThis, 'fetch', async () => new Response('proxies: [\n' + upstreamMarker));
  const worker = await builtWorker;
  const response = await worker.fetch(request({
    profile: 'r76s',
    url: 'trojan://' + sourceMarker + '@fixture.invalid:443#JP-test',
  }), env, {});
  assert.equal(response.status, 502);
  assert.match(response.headers.get('Content-Type'), /json/i);
  const body = await response.text();
  for (const sensitive of [upstreamMarker, sourceMarker, 'trojan://', 'fixture.invalid']) {
    assert.ok(!body.includes(sensitive));
  }
});

test('one empty but valid batch cannot silently drop part of a subscription', async t => {
  const calls = mockBackend(t, nodes => nodes[0].name.startsWith('TW-primary') ? nextConfig(nodes) : {});
  const worker = await builtWorker;
  const response = await worker.fetch(request({ profile: 'r76s' }), env, {});
  assert.equal(calls.length, 2);
  assert.equal(response.status, 502);
  assert.match(response.headers.get('Content-Type'), /json/i);
});
