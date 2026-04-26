'use strict';

// Evaluate one requirement node from the Fireroad JSON format against a set of taken course IDs.
// countMap: optional { [GIR_CODE]: number } for count-based leaf thresholds (e.g. HASS needs 8 subjects).
function evaluate(node, takenSet, countMap = {}) {
  if (node['plain-string']) {
    return { satisfied: false, matched: [], unmet: [], isManual: true, progress: null };
  }

  // Leaf with count-based threshold (e.g. { req: "HASS", threshold: { cutoff: 8, type: "GTE" } })
  if (node.req && !node.reqs && node.threshold && node.threshold.type === 'GTE') {
    const id = String(node.req).toUpperCase();
    const count = countMap[id] !== undefined ? countMap[id] : (takenSet.has(id) ? 1 : 0);
    const cutoff = node.threshold.cutoff;
    const sat = count >= cutoff;
    return {
      satisfied: sat,
      matched: count > 0 ? [id] : [],  // resolved to real courses by caller if needed
      unmet: sat ? [] : [id],
      isManual: false,
      progress: `${count}/${cutoff}`,
    };
  }

  // Regular leaf course
  if (node.req && !node.reqs) {
    const id = String(node.req).toUpperCase();
    const sat = takenSet.has(id);
    return { satisfied: sat, matched: sat ? [id] : [], unmet: sat ? [] : [id], isManual: false, progress: null };
  }

  // Group
  const children = node.reqs || [];
  const results = children.map((child) => evaluate(child, takenSet, countMap));

  let threshold;
  if (node.threshold && node.threshold.type === 'GTE') {
    threshold = node.threshold.cutoff;
  } else if (node['connection-type'] === 'any') {
    threshold = 1;
  } else {
    threshold = results.length;
  }

  const satisfiedCount = results.filter((r) => r.satisfied).length;
  const satisfied = satisfiedCount >= threshold;
  const matched = [...new Set(results.flatMap((r) => r.matched))];
  const unmet = results
    .filter((r) => !r.satisfied && !r.isManual)
    .flatMap((r) => r.unmet)
    .slice(0, 5);
  const isManual = results.some((r) => r.isManual) && !satisfied;

  return { satisfied, matched, unmet, isManual, progress: `${satisfiedCount}/${threshold}` };
}

const GENERIC_DESCS = new Set(['select all', 'all of the following', 'all']);

function syntheticLabel(node) {
  if (node.title) return node.title;
  // Leaf node — use the req value as the label
  if (node.req && !node.reqs) return String(node.req).toUpperCase();
  // Group without title
  const leaves = (node.reqs || []).filter((c) => c.req && !c.reqs && !c.threshold);
  const desc = node['threshold-desc'] || '';
  const isGeneric = GENERIC_DESCS.has(desc.toLowerCase().trim());
  // Large pick-lists (> 6 alternatives): don't enumerate all courses as the label.
  // Return '' to suppress surfacing — the parent will show matched courses as pills instead.
  if (leaves.length > 6) return !isGeneric && desc ? desc : '';
  const leafLabel = leaves.map((c) => c.req).join(' / ');
  if (!isGeneric && desc && !leafLabel) return desc;
  if (!isGeneric && desc && leafLabel) return leafLabel;
  return leafLabel || desc;
}

function buildGroupInfo(node, takenSet, countMap = {}) {
  const result = evaluate(node, takenSet, countMap);

  const namedChildren = (node.reqs || [])
    .filter((child) => {
      if (child['plain-string']) return Boolean(child.title);
      // Leaf node: only surface categorical codes (HASS-A, GIR:PHY1, CI-H …),
      // not specific MIT course IDs (6.1010, CC.1803, 21G.594 …).
      // Course IDs always contain a dot separating alphanumeric parts.
      if (child.req && !child.reqs) return !/^[A-Z0-9]+\.[A-Z0-9]/i.test(String(child.req));
      if (!child.reqs) return false;
      return Boolean(syntheticLabel(child));
    })
    .map((child) => buildGroupInfo(child, takenSet, countMap));

  const label = syntheticLabel(node);

  return {
    id: label.toLowerCase().replace(/\W+/g, '_') || '_unnamed',
    label,
    thresholdDesc: node['threshold-desc'] || null,
    satisfied: result.satisfied,
    progress: result.progress,
    matched: result.matched,
    unmet: result.unmet.slice(0, 5),
    isManual: result.isManual || false,
    subGroups: namedChildren.length > 0 ? namedChildren : null,
  };
}

function checkRequirements(reqJson, courses, countMap = {}) {
  const takenSet = new Set(courses.map((id) => String(id || '').trim().toUpperCase()));

  const groups = (reqJson.reqs || [])
    .filter((r) => r.title)
    .map((reqGroup) => buildGroupInfo(reqGroup, takenSet, countMap));

  return {
    title: reqJson['title-no-degree'] || reqJson['short-title'] || '',
    fullTitle: reqJson.title || '',
    groups,
    satisfiedCount: groups.filter((g) => g.satisfied).length,
    totalCount: groups.length,
  };
}

module.exports = { checkRequirements, evaluate };
