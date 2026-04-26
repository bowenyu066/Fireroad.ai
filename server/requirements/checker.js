'use strict';

// Evaluate one requirement node from the Fireroad JSON format against a set of taken course IDs.
// Node types:
//   { req: "6.100A" }                          — leaf course
//   { req: "...", "plain-string": true }        — manual/text placeholder
//   { reqs: [...], "connection-type", threshold } — group
function evaluate(node, takenSet) {
  // Text placeholder — requires manual verification by advisor
  if (node['plain-string']) {
    return { satisfied: false, matched: [], unmet: [], isManual: true, progress: null };
  }

  // Leaf course
  if (node.req && !node.reqs) {
    const id = String(node.req).toUpperCase();
    const sat = takenSet.has(id);
    return { satisfied: sat, matched: sat ? [id] : [], unmet: sat ? [] : [id], progress: null };
  }

  // Group
  const children = node.reqs || [];
  const results = children.map(child => evaluate(child, takenSet));

  // Threshold: explicit cutoff takes precedence over connection-type shorthand
  let threshold;
  if (node.threshold && node.threshold.type === 'GTE') {
    threshold = node.threshold.cutoff;
  } else if (node['connection-type'] === 'any') {
    threshold = 1;
  } else {
    threshold = results.length; // 'all' or unspecified
  }

  const satisfiedCount = results.filter(r => r.satisfied).length;
  const satisfied = satisfiedCount >= threshold;
  const matched = [...new Set(results.flatMap(r => r.matched))];
  const unmet = results
    .filter(r => !r.satisfied && !r.isManual)
    .flatMap(r => r.unmet)
    .slice(0, 5);
  const isManual = results.some(r => r.isManual) && !satisfied;

  return {
    satisfied,
    matched,
    unmet,
    isManual,
    progress: `${satisfiedCount}/${threshold}`,
  };
}

// Recursively build a display node with its own threshold/progress and named children.
function buildGroupInfo(node, takenSet) {
  const result = evaluate(node, takenSet);

  // Only surface named children (ones that can be labeled in the UI)
  const namedChildren = (node.reqs || [])
    .filter(child => child.title && (child.reqs || child['plain-string']))
    .map(child => buildGroupInfo(child, takenSet));

  return {
    id: String(node.title || '').toLowerCase().replace(/\W+/g, '_') || '_unnamed',
    label: node.title || '',
    thresholdDesc: node['threshold-desc'] || null,
    satisfied: result.satisfied,
    progress: result.progress,
    matched: result.matched,
    unmet: result.unmet.slice(0, 5),
    isManual: result.isManual || false,
    subGroups: namedChildren.length > 0 ? namedChildren : null,
  };
}

function checkRequirements(reqJson, courses) {
  const takenSet = new Set(courses.map(id => String(id || '').trim().toUpperCase()));

  const groups = (reqJson.reqs || [])
    .filter(r => r.title)
    .map(reqGroup => buildGroupInfo(reqGroup, takenSet));

  return {
    title: reqJson['title-no-degree'] || reqJson['short-title'] || '',
    fullTitle: reqJson.title || '',
    groups,
    satisfiedCount: groups.filter(g => g.satisfied).length,
    totalCount: groups.length,
  };
}

module.exports = { checkRequirements, evaluate };
