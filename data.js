// Browser adapter around shared/mock-data.js.
window.FRDATA = (function (source) {
  if (!source) {
    throw new Error('shared/mock-data.js must be loaded before data.js');
  }

  const getCourse = (id) => {
    const normalized = String(id || '').trim().toLowerCase();
    return source.catalog.find((c) => c.id.toLowerCase() === normalized);
  };

  const getMatch = (id) => source.matchScores[id] || { total: 0, interest: 0, workload: 0, reqValue: 0 };

  return {
    ...source,
    getCourse,
    getMatch,
  };
})(window.FRMOCKDATA);
