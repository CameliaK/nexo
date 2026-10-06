import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const files = ['src/data/portfolio-content.es.json', 'src/data/portfolio-content.en.json', '../docs/portfolio-content.json'];
function idPaths(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => idPaths(item, `${path}[${item && typeof item === 'object' && 'id' in item ? String(item.id) : index}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => key === 'id' ? [`${path}.id=${String(item)}`] : idPaths(item, `${path}.${key}`)).sort();
}

test('ES, EN and docs preserve the same node/component/media IDs; docs matches ES byte for byte', () => {
  const raw = files.map(file => readFileSync(file, 'utf8'));
  const contents = raw.map(text => JSON.parse(text));
  for (const content of contents) {
    assert.equal(new Set(content.nodes.map((node: {id: string}) => node.id)).size, content.nodes.length, 'no duplicate node IDs');
    assert.deepEqual(idPaths(content), idPaths(contents[0]));
  }
  assert.equal(raw[2], raw[0], 'Run npm run sync-content after changing ES.');
  if (existsSync('src/data/portfolio-content.json')) {
    const legacy = readFileSync('src/data/portfolio-content.json', 'utf8');
    assert.equal(legacy, raw[0], 'The legacy Spanish file must receive the same ES patch.');
  }
});

test('Skills validator accepts every reference in the supplied knowledge and rejects unknown node IDs', () => {
  const script = resolve('../scripts/content/validate-skills.mjs');
  const valid = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /referencias válidas/);
  const directory = mkdtempSync(resolve('.content-test-'));
  try {
    const fixture = resolve(directory, 'skills.json');
    writeFileSync(fixture, JSON.stringify({skills:[{id:'example',evidence:[{node:'missing-node'}]}]}));
    const invalid = spawnSync(process.execPath, [script, resolve(files[0]), fixture], { encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /skills\.skills\[0\]\.evidence\[0\]\.node: "missing-node"/);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
