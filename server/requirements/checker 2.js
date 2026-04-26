'use strict';

// Evaluate one requirement node from the Fireroad JSON format against a set of taken course IDs.
// Node types:
//   { req: "6.100A" }                          — leaf course
//   { req: "...", "plain-string": true }        — manual/text placeholder
//   { reqs: [...], "connection-type", threshold } — group
function evaluate(node, takenSet) {
  // Text placeholder — requires manual verification
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

  // Threshold: explicit cutoff > connection-type > default all
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
  // Unmet: collect needed courses from unsatisfied children (skip manual)
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

function checkRequirements(reqJson, courses) {
  const takenSet = new Set(courses.map(id => String(id || '').trim().toUpperCase()));

  const groups = (reqJson.reqs || [])
    .filter(r => r.title)
    .map(reqGroup => {
      const result = evaluate(reqGroup, takenSet);

      // Include named sub-groups (direct children with a title and their own reqs)
      const subGroups = (reqGroup.reqs || [])
        .filter(r => r.title && (r.reqs || r['plain-string']))
        .map(sub => {
          const sr = evaluate(sub, takenSet);
          return {
            id: sub.title.toLowerCase().replace(/\W+/g, '_'),
            label: sub.title,
            satisfied: sr.satisfied,
            progress: sr.progress,
            unmet: sr.unmet.slice(0, 3),
            isManual: sr.isManual || false,
          };
        });

      return {
        id: reqGroup.title.toLowerCase().replace(/\W+/g, '_'),
        label: reqGroup.title,
        satisfied: result.satisfied,
        progress: result.progress,
        matched: result.matched,
        unmet: result.unmet.slice(0, 5),
        isManual: result.isManual || false,
        subGroups: subGroups.length > 1 ? subGroups : null,
      };
    });

  return {
    title: reqJson['title-no-degree'] || reqJson['short-title'] || '',
    fullTitle: reqJson.title || '',
    groups,
    satisfiedCount: groups.filter(g => g.satisfied).length,
    totalCount: groups.length,
  };
}

module.exports = { checkRequirements, evaluate };
