import { readFile, writeFile } from 'node:fs/promises';

// The final notice is read-only. Publish its title, date and sections 1–7;
// the short notices remain documentation for the interface, not page content.
const source = await readFile(new URL('../../docs/aviso-de-privacidad.md', import.meta.url), 'utf8');
const languages = source.split(/(?=^# )/m).filter(part => part.startsWith('# '));
if (languages.length !== 2) throw new Error('Expected the Spanish and English privacy notices.');
const snapshot = Object.fromEntries(['es', 'en'].map((language, index) => {
  const section = languages[index].split(/^## (?:Avisos breves|Short notices)\b/m)[0]
    .replace(/\n---\s*$/, '').trim();
  const headings = [...section.matchAll(/^## (\d+)\. /gm)].map(match => Number(match[1]));
  if (headings.join(',') !== '1,2,3,4,5,6,7') throw new Error(`Expected sections 1–7 in ${language}.`);
  if (/\[|\b(?:borrador|draft)\b/i.test(section)) throw new Error(`Unfinished privacy notice in ${language}.`);
  return [language, section];
}));
await writeFile(new URL('../src/data/privacy-notice.json', import.meta.url), JSON.stringify(snapshot, null, 2) + '\n');
console.log('Privacy page snapshot synchronized with the final notice (ES/EN, sections 1–7).');
