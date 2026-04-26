'use strict';

const fs = require('fs');
const path = require('path');

const REQL_DIR = path.join(__dirname, '..', '..', 'data', 'requirements');

// Split str by delim at depth 0 (ignores parens)
function splitTopLevel(str, delim) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '(') depth++;
    else if (str[i] === ')') depth--;
    else if (str[i] === delim && depth === 0) {
      parts.push(str.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(str.slice(start));
  return parts;
}

// Strip trailing {>=N} and return [body, threshold|null]
function stripThreshold(str) {
  const m = str.match(/^([\s\S]*?)\{>=(\d+)\}$/);
  return m ? [m[1].trim(), parseInt(m[2], 10)] : [str.trim(), null];
}

// Parse a full expression string into an AST node.
// Grammar (simplified):
//   expr     = and_list ['{>=' N '}']
//   and_list = or_term (',' or_term)*
//   or_term  = atom ('/' atom)*
//   atom     = '(' or_term ')' | '""' text '""' | course_id | block_ref
function parseExpr(str) {
  str = str.trim();
  const [body, threshold] = stripThreshold(str);

  // Text placeholder: ""...""
  if (body.startsWith('""') && body.endsWith('""')) {
    return { type: 'text', text: body.slice(2, -2), threshold };
  }

  // AND list (comma-separated at top level)
  const terms = splitTopLevel(body, ',').map(t => t.trim()).filter(Boolean);
  if (terms.length > 1) {
    const children = terms.map(parseOrTerm);
    return { type: 'and', children, threshold: threshold !== null ? threshold : children.length };
  }

  // Single term — may be OR group
  const node = parseOrTerm(body);
  return threshold !== null ? { ...node, threshold } : node;
}

function parseOrTerm(str) {
  str = str.trim();
  if (str.startsWith('(') && str.endsWith(')')) str = str.slice(1, -1).trim();
  const parts = str.split('/').map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) {
    return { type: 'or', children: parts.map(parseAtom), threshold: 1 };
  }
  return parseAtom(str);
}

function parseAtom(str) {
  str = str.trim();
  if (str.startsWith('(') && str.endsWith(')')) return parseOrTerm(str.slice(1, -1));
  // Course ID: has a dot, or starts with a digit, or is special (UAT, UAR, UR)
  if (str.includes('.') || /^\d/.test(str) || /^[A-Z0-9]+\.[A-Z0-9]+$/.test(str)) {
    return { type: 'course', id: str.toUpperCase() };
  }
  // Block reference (lowercase identifier)
  return { type: 'block', id: str };
}

function parseReql(content) {
  const lines = content.split('\n').map(l => l.trim());

  const header = lines[0].split('#,#');
  const majorId      = (header[0] || '').trim();
  const shortTitle   = (header[1] || '').trim();
  const titleNoDegree = (header[2] || '').trim();
  const fullTitle    = (header[3] || '').trim();

  // Collect top-level block names: lines before the first ':=' that look like identifiers
  const topLevel = [];
  let i = 1;
  while (i < lines.length && !lines[i].includes(':=') && !lines[i].startsWith('%%')) {
    if (lines[i] && /^[a-z_][a-z0-9_]*$/i.test(lines[i])) topLevel.push(lines[i]);
    i++;
  }

  // Parse block definitions: name, "Label" := expr
  const blocks = {};
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith('%%')) continue;
    const m = line.match(/^([a-z_][a-z0-9_]*)\s*,\s*"([^"]+)"\s*:=\s*(.+)$/i);
    if (m) {
      const [, name, label, exprStr] = m;
      try {
        blocks[name] = { name, label, expr: parseExpr(exprStr) };
      } catch (e) {
        blocks[name] = { name, label, expr: { type: 'text', text: exprStr } };
      }
    }
  }

  return { majorId, shortTitle, titleNoDegree, fullTitle, topLevel, blocks };
}

function loadReql(majorKey) {
  const file = path.join(REQL_DIR, `${majorKey}.reql`);
  if (!fs.existsSync(file)) return null;
  try {
    return parseReql(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = { loadReql, parseReql };
