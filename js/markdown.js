const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const safeUrl = (value) => {
  const url = String(value).trim();
  if (/^(https?:\/\/|mailto:|#|\/|\.{1,2}\/)/i.test(url)) return url;
  if (/^[A-Za-z0-9][A-Za-z0-9._~\/-]*$/.test(url)) return url;
  return '#';
};

const renderInline = (value) => {
  const code = [];
  let text = escapeHtml(value);
  text = text.replace(/`([^`]+)`/g, (_, content) => {
    code.push(content);
    return `\u0001${code.length - 1}\u0001`;
  });
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const href = safeUrl(url);
    const external = /^https?:\/\//i.test(href);
    return `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  text = text.replace(/\u0001(\d+)\u0001/g, (_, index) => `<code>${escapeHtml(code[Number(index)])}</code>`);
  return text;
};

const isTableSeparator = (line) => {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')));
};

const splitTableRow = (line) => {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
};

const isBlockStart = (line, nextLine) => {
  const trimmed = line.trim();
  return (
    /^#{1,6}\s+/.test(trimmed) ||
    /^```/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^([-*+]|\d+\.)\s+/.test(trimmed) ||
    /^---+$/.test(trimmed) ||
    (trimmed.startsWith('|') && nextLine && isTableSeparator(nextLine))
  );
};

const listMatch = (line) => {
  const match = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
  if (!match) return null;
  return {
    indent: match[1].replace(/\t/g, '    ').length,
    ordered: /^\d+\./.test(match[2]),
    text: match[3]
  };
};

const renderList = (items) => {
  if (!items.length) return '';
  const tag = items[0].ordered ? 'ol' : 'ul';
  return `<${tag}>${items
    .map((item) => {
      const children = item.children.length ? renderList(item.children) : '';
      return `<li>${renderInline(item.text)}${children}</li>`;
    })
    .join('')}</${tag}>`;
};

const parseList = (lines, start, indent) => {
  const items = [];
  let index = start;
  while (index < lines.length) {
    const item = listMatch(lines[index]);
    if (!item) break;
    if (item.indent < indent) break;
    if (item.indent > indent) {
      if (items.length) {
        const nested = parseList(lines, index, item.indent);
        items[items.length - 1].children.push(...nested.items);
        index = nested.index;
        continue;
      }
      break;
    }
    items.push({ ordered: item.ordered, text: item.text, children: [] });
    index++;
  }
  return { items, index };
};

export function renderMarkdown(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index++;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim();
      const code = [];
      index++;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        code.push(lines[index]);
        index++;
      }
      if (index < lines.length) index++;
      output.push(`<pre class="help-code"><code${language ? ` class="language-${escapeHtml(language)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index++;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      output.push('<hr />');
      index++;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quote = [];
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quote.push(lines[index].trim().replace(/^>\s?/, ''));
        index++;
      }
      output.push(`<blockquote>${renderInline(quote.join(' '))}</blockquote>`);
      continue;
    }

    const nextLine = lines[index + 1];
    if (trimmed.startsWith('|') && nextLine && isTableSeparator(nextLine)) {
      const headers = splitTableRow(trimmed);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(splitTableRow(lines[index]));
        index++;
      }
      output.push(
        `<table class="help-table"><thead><tr>${headers
          .map((cell) => `<th>${renderInline(cell)}</th>`)
          .join('')}</tr></thead><tbody>${rows
          .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`
      );
      continue;
    }

    const item = listMatch(line);
    if (item) {
      const parsed = parseList(lines, index, item.indent);
      output.push(renderList(parsed.items));
      index = parsed.index;
      continue;
    }

    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isBlockStart(lines[index], lines[index + 1])
    ) {
      paragraph.push(lines[index].trim());
      index++;
    }
    if (paragraph.length === 0) {
      paragraph.push(trimmed);
      index++;
    }
    output.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
  }

  return output.join('\n');
}
