#!/usr/bin/env node
// Aplica un parche de contenido a un archivo portfolio-content*.json sin cambiar ids.
// Uso: node apply-content-patch.mjs <archivo.json> <parche.json> [--dry]
//
// Formato del parche:
//   { "updates": [ { "id": "<id del nodo>", "set": { "ruta": valor }, "delete": ["ruta"] } ] }
// Rutas: segmentos separados por punto; un segmento puede llevar [id] para elegir
// un elemento de una lista por su id. Ejemplo: "architecture.components[java].what".
import fs from 'node:fs';

const [, , target, patchFile, flag] = process.argv;
if (!target || !patchFile) {
  console.error('Uso: node apply-content-patch.mjs <archivo.json> <parche.json> [--dry]');
  process.exit(1);
}
const dry = flag === '--dry';
const doc = JSON.parse(fs.readFileSync(target, 'utf8'));
const patch = JSON.parse(fs.readFileSync(patchFile, 'utf8'));
const byId = new Map(doc.nodes.map(n => [n.id, n]));
let changes = 0;

function step(cur, seg, where) {
  const m = seg.match(/^([^[\]]+)(?:\[([^\]]+)\])?$/);
  if (!m) throw new Error(`${where}: segmento inválido "${seg}"`);
  const [, key, itemId] = m;
  const next = cur?.[key];
  if (next === undefined) throw new Error(`${where}: no existe "${key}"`);
  if (itemId === undefined) return next;
  if (!Array.isArray(next)) throw new Error(`${where}: "${key}" no es una lista`);
  const item = next.find(x => x && x.id === itemId);
  if (!item) throw new Error(`${where}: no hay elemento con id "${itemId}" en "${key}"`);
  return item;
}

function parentOf(node, path, where) {
  const segs = path.split('.');
  let cur = node;
  for (const s of segs.slice(0, -1)) cur = step(cur, s, where);
  return [cur, segs[segs.length - 1]];
}

for (const u of patch.updates) {
  const node = byId.get(u.id);
  if (!node) throw new Error(`Nodo inexistente: ${u.id}`);
  for (const [path, value] of Object.entries(u.set ?? {})) {
    const where = `${u.id} → ${path}`;
    const [parent, key] = parentOf(node, path, where);
    if (/[[\]]/.test(key)) throw new Error(`${where}: el último segmento no admite [id]`);
    parent[key] = value;
    changes++;
    console.log(`set    ${where}`);
  }
  for (const path of u.delete ?? []) {
    const where = `${u.id} → ${path}`;
    const [parent, key] = parentOf(node, path, where);
    if (key in parent) { delete parent[key]; changes++; console.log(`delete ${where}`); }
    else console.log(`(ya no existía) ${where}`);
  }
}
if (!dry) fs.writeFileSync(target, JSON.stringify(doc, null, 2) + '\n');
console.log(`${dry ? '[simulación] ' : ''}${changes} cambios en ${target}`);
