import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseFile = new URL('../worker.js', import.meta.url);
const profileFile = new URL('./profile.mjs', import.meta.url);
// The upstream bundle has no public post-merge hook. Bind its converter (ka),
// name restoration (Na) and YAML writer (Ki) only for the verified bundle.
const baseHash = '4c05494f7f6d89b22abd81b76fea5a7f9dd09a744c36b76281dbdf8b91e57efa';
const entry = 'export{Va as default};';

export function buildWorker(baseBundle, profileSource) {
  const upstream = baseBundle.replaceAll('\r\n', '\n');
  if (createHash('sha256').update(upstream).digest('hex') !== baseHash
      || !upstream.trimEnd().endsWith(entry)) {
    throw new Error('Upstream worker.js changed. Review the conversion hook before rebuilding.');
  }
  const profile = profileSource.replaceAll('\r\n', '\n').replace(/^export (?=(?:async )?function )/gm, '');
  return `${upstream.slice(0, upstream.lastIndexOf(entry))}
export default (() => {
${profile}
  return withR76s(Va, async (request, env) => {
    const converter = new ka(env);
    await converter.setSubUrls(request);
    const config = await new Na(converter).getClashConfig();
    // The upstream merger can skip an empty batch. Do not publish a shortened
    // R76S pool when the backend returned fewer nodes than it was sent.
    if (config.proxies?.length !== converter.vpsStore.size) throw new Error('Incomplete node set');
    return config;
  }, config => Ki(config, { indent: 2, lineWidth: 200 }));
})();
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2];
  if (!output || process.argv.length !== 3) throw new Error('Usage: node r76s/build.mjs OUTPUT.mjs');
  const sources = [baseFile, profileFile, new URL(import.meta.url)];
  if (sources.some(source => relative(fileURLToPath(source), resolve(output)) === '')) {
    throw new Error('Choose a separate output file.');
  }
  const [base, profile] = await Promise.all([baseFile, profileFile].map(file => readFile(file, 'utf8')));
  await writeFile(output, buildWorker(base, profile));
}
