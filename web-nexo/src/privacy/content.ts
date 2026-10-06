import notices from '../data/privacy-notice.json';
import type { Language } from '../i18n/language';
export function privacyContent(language: Language) { return notices[language]; }
/** Render this trusted Markdown snapshot with DOM nodes, without HTML injection or remote assets. */
export function renderPrivacy(doc: Document, root: HTMLElement, language: Language) {
  root.replaceChildren();
  const lines = privacyContent(language).split('\n');
  function inline(element: HTMLElement, text: string) {
    for (const part of text.split(/(\*\*[^*]+\*\*)/g)) {
      if (part.startsWith('**')) { const strong = doc.createElement('strong'); strong.textContent = part.slice(2, -2); element.append(strong); }
      else element.append(doc.createTextNode(part));
    }
  }
  let list: HTMLUListElement | null = null;
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { list = null; index++; continue; }
    if (line.startsWith('|')) {
      const wrap = doc.createElement('div'); wrap.className = 'privacy-table'; wrap.tabIndex = 0;
      const table = doc.createElement('table'), head = doc.createElement('thead'), body = doc.createElement('tbody');
      let first = true;
      while (lines[index]?.startsWith('|')) {
        const cells = lines[index++].split('|').slice(1, -1).map(cell => cell.trim());
        if (cells.every(cell => /^[-:]+$/.test(cell))) continue;
        const row = doc.createElement('tr');
        for (const value of cells) { const cell = doc.createElement(first ? 'th' : 'td'); if (first) cell.setAttribute('scope', 'col'); inline(cell, value); row.append(cell); }
        (first ? head : body).append(row); first = false;
      }
      table.append(head, body); wrap.append(table); root.append(wrap); continue;
    }
    const heading = /^(#{1,2}) (.+)$/.exec(line);
    if (heading) { const element = doc.createElement(heading[1].length === 1 ? 'h1' : 'h2'); inline(element, heading[2]); root.append(element); index++; continue; }
    const item = line.startsWith('- ');
    let text = item ? line.slice(2) : line; index++;
    while (index < lines.length && lines[index].trim() && !/^(#|\||- )/.test(lines[index])) text += ' ' + lines[index++].trim();
    const element = doc.createElement(item ? 'li' : 'p'); inline(element, text);
    if (item) { if (!list) { list = doc.createElement('ul'); root.append(list); } list.append(element); }
    else { list = null; root.append(element); }
  }
}
