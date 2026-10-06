#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const contentFile = process.argv[2] || new URL('../../web-nexo/src/data/portfolio-content.es.json', import.meta.url);
const skillsFile = process.argv[3] || new URL('../../knowledge/skills.json', import.meta.url);
const content = JSON.parse(readFileSync(contentFile, 'utf8'));
const skills = JSON.parse(readFileSync(skillsFile, 'utf8'));
const ids = new Set(content.nodes.map(node => node.id));
let references = 0;
const missing = [];
function visit(value, path = 'skills') {
  if (Array.isArray(value)) { value.forEach((item, index) => visit(item, `${path}[${index}]`)); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'node') {
      references++;
      if (!ids.has(item)) missing.push(`${path}.node: ${JSON.stringify(item)}`);
    } else visit(item, `${path}.${key}`);
  }
}
visit(skills);
if (missing.length) {
  console.error('Referencias a nodos inexistentes:\n' + missing.join('\n'));
  process.exitCode = 1;
} else console.log(`Skills: ${references} referencias válidas a ${ids.size} nodos del contenido.`);
