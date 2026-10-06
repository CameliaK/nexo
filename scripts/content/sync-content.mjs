#!/usr/bin/env node
import { chmodSync, copyFileSync, readFileSync } from 'node:fs';
const source = new URL('../../web-nexo/src/data/portfolio-content.es.json', import.meta.url);
const target = new URL('../../docs/portfolio-content.json', import.meta.url);
// Fail before copying malformed content; preserve identical bytes, including formatting.
const content = JSON.parse(readFileSync(source, 'utf8'));
if (!Array.isArray(content.nodes)) throw new Error('El contenido ES debe incluir una lista de nodos.');
copyFileSync(source, target);
chmodSync(target, 0o644); // JSON content must not inherit the source file’s executable bit.
console.log('Sincronizado: portfolio-content.es.json → docs/portfolio-content.json');
