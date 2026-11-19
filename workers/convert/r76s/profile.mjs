const providerName = 'R76SNodes';
const templateUrl = 'https://raw.githubusercontent.com/felix2027/my_tools/main/config/proxy_config_next.ini';
const regions = ['TW', 'SG', 'JP', 'US', 'HK'];
const builtins = ['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'PASS-RULE', 'COMPATIBLE', 'GLOBAL', 'DNS'];
const requiredGroups = new Map([
  ['Proxies', 'select'], ['Direct', 'select'], ['Final', 'select'], ['Manual', 'select'],
  ['Auto', 'url-test'], ['LoadBalance', 'load-balance'], ['Fallback', 'fallback'],
  ['TW_HK_Fallback', 'fallback'], ...regions.map(name => [name, 'url-test']),
]);

function requireConfig(condition) {
  if (!condition) throw new Error('Unsupported or incomplete next configuration');
}

// Match the converter's restored names literally. Mihomo uses a backtick between
// ordered filter expressions, including when the backtick occurs inside a name.
function memberFilter(names) {
  if (!names.length) return '';
  const literals = names.map(name => name
    .replace(/[.*+?^$(){}|[\]\\]/g, '\\$&')
    .replaceAll(String.fromCharCode(96), '\\x60'));
  return '^(?:' + literals.join('|') + ')$';
}

export function toR76sConfig(config) {
  const nodes = config?.proxies;
  const groups = config?.['proxy-groups'];
  requireConfig(Array.isArray(nodes) && nodes.length && Array.isArray(groups)
    && Array.isArray(config.rules) && config.rules.length
    && !Object.keys(config['proxy-providers'] ?? {}).length);

  const byName = new Map(groups.map(group => [group.name, group]));
  const nodeNames = new Set(nodes.map(node => node.name));
  const groupTargets = new Set([...builtins, ...byName.keys()]);
  requireConfig(byName.size === groups.length && nodeNames.size === nodes.length
    && !groupTargets.has(providerName) && builtins.every(name => !byName.has(name)));
  for (const node of nodes) {
    requireConfig(typeof node.name === 'string' && node.name.length && !/[\x00-\x1f]/.test(node.name)
      && typeof node.type === 'string' && node.name !== providerName && !groupTargets.has(node.name)
      && !nodeNames.has(node['dialer-proxy']));
  }
  for (const [name, type] of requiredGroups) requireConfig(byName.get(name)?.type === type);

  // Provider nodes are no longer top-level outbounds. Validate policy references
  // before publishing the original, unmodified rule lists.
  const subRules = config['sub-rules'] ?? {};
  for (const rules of [config.rules, ...Object.values(subRules)]) {
    requireConfig(Array.isArray(rules));
    for (const rule of rules) {
      requireConfig(typeof rule === 'string');
      const fields = rule.split(',');
      let target = fields.pop()?.trim();
      while (target === 'no-resolve' || target === 'src') target = fields.pop()?.trim();
      requireConfig(fields[0] === 'SUB-RULE' ? Object.hasOwn(subRules, target) : groupTargets.has(target));
    }
  }

  const filters = new Map();
  for (const region of regions) {
    const members = byName.get(region).proxies;
    // A conversion batch with no regional matches may contribute a DIRECT placeholder.
    requireConfig(Array.isArray(members) && members.every(n => n === 'DIRECT' || nodeNames.has(n)));
    filters.set(region, memberFilter([...new Set(members.filter(name => nodeNames.has(name)))]));
  }

  function convertGroup(group) {
    const name = group.name;
    requireConfig(!group.use?.length && !group['include-all'] && !group['include-all-proxies']
      && !group['include-all-providers']);
    let filter;
    if (filters.has(name)) {
      filter = filters.get(name);
    } else if (name === 'Fallback') {
      filter = [...filters.values(), '.*'].filter(Boolean).join(String.fromCharCode(96));
    } else if (name === 'TW_HK_Fallback') {
      filter = ['TW', 'HK'].map(region => filters.get(region)).filter(Boolean).join(String.fromCharCode(96));
    } else if (!['Auto', 'LoadBalance', 'Manual'].includes(name)) {
      requireConfig(group.type === 'select' && !group.interval && Array.isArray(group.proxies)
        && group.proxies.every(target => groupTargets.has(target)));
      return group;
    }

    // Older cores may use a direct-compatible outbound when a filter is empty.
    // A later subscription refresh will rebuild this group if the region returns.
    if (filter === '') return { name, type: 'select', proxies: ['REJECT'] };
    const shared = { ...group, use: [providerName] };
    for (const key of ['proxies', 'url', 'interval', 'lazy', 'timeout', 'expected-status',
      'filter', 'exclude-filter', 'exclude-type']) delete shared[key];
    if (filter) shared.filter = filter;
    if (name === 'Manual') shared.proxies = ['REJECT'];
    if (name === 'TW_HK_Fallback') shared['empty-fallback'] = 'REJECT';
    return shared;
  }

  const result = { ...config };
  delete result.proxies;
  result['proxy-providers'] = {
    [providerName]: {
      type: 'inline',
      payload: nodes,
      'health-check': {
        enable: true, url: 'https://www.gstatic.com/generate_204',
        interval: 150, timeout: 5000, lazy: false, 'expected-status': '204',
      },
    },
  };
  result['proxy-groups'] = groups.map(convertGroup);
  return result;
}

// The normal Worker handles every other route and mode. Only the opted-in
// request enters here; errors must not return a partial YAML or subscription details.
async function serveR76s(url, env, getRestoredConfig, dumpYaml) {
  const params = url.searchParams;
  const headers = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
  const fail = (message, status) => Response.json({ message }, { status, headers });
  const single = name => params.getAll(name).length <= 1;
  if (!['profile', 'target', 'url', 'config', 'list', 'new_name'].every(single)
    || params.get('target') !== 'clash' || !params.get('url')
    || (params.has('config') && params.get('config') !== templateUrl)
    || (params.has('list') && params.get('list') !== 'false')
    || (params.has('new_name') && params.get('new_name') !== 'true')) {
    return fail('R76S requires a complete Clash subscription using proxy_config_next.ini', 400);
  }
  params.delete('profile');
  params.set('config', templateUrl);
  params.set('new_name', 'true');
  try {
    const config = await getRestoredConfig(new Request(url), env);
    return new Response(dumpYaml(toR76sConfig(config)), {
      headers: { ...headers, 'Content-Type': 'text/yaml; charset=UTF-8' },
    });
  } catch {
    return fail('Could not build a complete R76S subscription from the converter response', 502);
  }
}

export function withR76s(upstream, getRestoredConfig, dumpYaml) {
  return {
    fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (request.method !== 'GET' || url.pathname !== '/sub' || !url.searchParams.getAll('profile').includes('r76s')) {
        return upstream.fetch(request, env, ctx);
      }
      return serveR76s(url, env, getRestoredConfig, dumpYaml);
    },
  };
}
