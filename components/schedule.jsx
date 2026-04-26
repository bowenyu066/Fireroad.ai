/* global React, FRDATA, useApp, Icon, MatchBar, AreaDot */
const { useState, useEffect, useRef } = React;

// ============== ICS export ==============
const exportToICS = (courses) => {
  // Prototype calendar export uses the current demo term dates.
  const SEM_START = new Date(2025, 1, 3); // Feb 3 is a Monday
  const SEM_UNTIL = '20250517T035959Z';   // May 16 23:59 EDT in UTC

  const DAY_OFFSET = { M: 0, T: 1, W: 2, R: 3, F: 4 };
  const DAY_ICS    = { M: 'MO', T: 'TU', W: 'WE', R: 'TH', F: 'FR' };

  const pad = (n) => String(n).padStart(2, '0');
  const toTime = (dec) => { const h = Math.floor(dec); const m = Math.round((dec - h) * 60); return `${pad(h)}${pad(m)}00`; };
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  const fmtDate = (d, t) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${t}`;

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//fireroad.ai//Course Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];

  courses.forEach((c) => {
    if (!c.days || c.days.length === 0) return;
    const firstOffset = Math.min(...c.days.map((d) => DAY_OFFSET[d]));
    const firstDate   = addDays(SEM_START, firstOffset);
    const byDay       = c.days.map((d) => DAY_ICS[d]).join(',');
    const desc        = [`Instructor: ${c.instructor}`, `Units: ${c.units}`, c.satisfies.length ? `Satisfies: ${c.satisfies.join(', ')}` : ''].filter(Boolean).join('\\n');

    lines.push(
      'BEGIN:VEVENT',
      `DTSTART;TZID=America/New_York:${fmtDate(firstDate, toTime(c.time.start))}`,
      `DTEND;TZID=America/New_York:${fmtDate(firstDate, toTime(c.time.end))}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${byDay};UNTIL=${SEM_UNTIL}`,
      `SUMMARY:${c.id} – ${c.name}`,
      `DESCRIPTION:${desc}`,
      'LOCATION:MIT',
      `UID:${c.id}-next-semester@fireroad.ai`,
      'END:VEVENT',
    );
  });

  lines.push('END:VCALENDAR');

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'fireroad-next-semester.ics';
  a.click();
  URL.revokeObjectURL(url);
};

// ============== Schedule course card (left panel) ==============
const ScheduleCard = ({ course, match, onRemove, onOpen, justAdded }) => {
  const [removing, setRemoving] = useState(false);
  const lastClick = useRef(0);
  const removingRef = useRef(false);

  const requestRemove = () => {
    if (removingRef.current) return;
    removingRef.current = true;
    setRemoving(true);
    setTimeout(() => onRemove(course.id), 280);
  };

  const handleClick = (e) => {
    const now = Date.now();
    if (now - lastClick.current < 350) {
      requestRemove();
    } else {
      lastClick.current = now;
    }
  };

  return (
    <div
      onClick={handleClick}
      onDoubleClick={requestRemove}
      className={justAdded ? 'slide-up' : ''}
      style={{
        position: 'relative', background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
        padding: '14px 16px 14px 18px', cursor: 'pointer',
        opacity: removing ? 0 : 1,
        transform: removing ? 'translateX(-8px) scale(0.98)' : 'translateX(0) scale(1)',
        transition: 'opacity 260ms, transform 260ms, border-color 160ms, background 160ms',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-strong)';
        e.currentTarget.style.background = 'var(--surface-2)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.background = 'var(--surface)';
      }}
    >
      {/* Left accent stripe */}
      <span style={{
        position: 'absolute', left: 0, top: 10, bottom: 10, width: 3,
        background: `var(--course-${course.area})`, borderRadius: '0 3px 3px 0',
      }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{course.id}</span>
            <span style={{ fontSize: 14, color: 'var(--text)' }}>{course.name}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <span className="mono">{course.schedule}</span>
            <span>·</span>
            <span>{course.units} units</span>
            {course.satisfies.length > 0 && <>
              <span>·</span>
              <span>Satisfies <span style={{ color: 'var(--text)' }}>{course.satisfies.join(', ')}</span></span>
            </>}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(course.id); }}
          className="btn-ghost"
          style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '4px 8px', borderRadius: 6 }}
          title="Open detail"
        >
          Details →
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
        <MatchBar score={match.total} width={140} compact />
        <span>·</span>
        <span>Est. workload <span className="mono" style={{ color: 'var(--text)' }}>~{course.hydrant.toFixed(1)}h/wk</span></span>
      </div>

      <div style={{ position: 'absolute', bottom: 6, right: 12, fontSize: 10, color: 'var(--text-tertiary)', opacity: 0.6 }}>
        double-click to remove
      </div>
    </div>
  );
};

// ============== Calendar mini-view ==============
const CAL_PALETTE = ['#4A8FE8','#E8704A','#7C4AE8','#E84A7A','#14B8A6','#F59E0B','#34D399','#E05252'];

const CalendarView = ({ courses }) => {
  const days = ['M', 'T', 'W', 'R', 'F'];
  const dayLabels = { M: 'Mon', T: 'Tue', W: 'Wed', R: 'Thu', F: 'Fri' };
  const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  const colorOf = {};
  courses.forEach((c, i) => { colorOf[c.id] = CAL_PALETTE[i % CAL_PALETTE.length]; });

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
      padding: 12, display: 'grid', gridTemplateColumns: '32px repeat(5, 1fr)', gap: 0,
      fontSize: 11, fontFamily: 'var(--font-mono)',
    }}>
      <div />
      {days.map((d) => <div key={d} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>{dayLabels[d]}</div>)}

      {hours.map((h) => (
        <React.Fragment key={h}>
          <div style={{ textAlign: 'right', paddingRight: 6, color: 'var(--text-tertiary)', fontSize: 10, borderTop: '1px dotted var(--border)', height: 28 }}>
            {h > 12 ? h - 12 : h}{h >= 12 ? 'p' : 'a'}
          </div>
          {days.map((d) => (
            <div key={d + h} style={{ borderTop: '1px dotted var(--border)', height: 28, position: 'relative' }}>
              {courses.filter((c) => c.days.includes(d) && c.time.start < h + 1 && c.time.end > h).map((c) => {
                const isStart = c.time.start >= h && c.time.start < h + 1;
                if (!isStart) return null;
                const offsetTop = (c.time.start - h) * 28;
                const height = (c.time.end - c.time.start) * 28 - 2;
                return (
                  <div key={c.id} style={{
                    position: 'absolute', top: offsetTop, left: 2, right: 2, height,
                    background: colorOf[c.id], opacity: 0.9,
                    borderRadius: 4, padding: '3px 5px', color: '#fff',
                    fontSize: 10, lineHeight: 1.2, overflow: 'hidden',
                  }}>
                    {c.id}
                  </div>
                );
              })}
            </div>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
};

const courseWorkloadLabel = (course) => {
  const parts = [];
  if (Number(course.units)) parts.push(`${course.units} units`);
  if (Number(course.hydrant)) parts.push(`~${Number(course.hydrant).toFixed(1)}h/wk`);
  return parts.join(' · ') || 'Units TBD';
};

const ManualCourseSearch = ({ schedule, onAddCourse, onOpenCourse, onCoursesLoaded }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const requestId = useRef(0);

  useEffect(() => {
    const id = requestId.current + 1;
    requestId.current = id;
    const searchText = query.trim();
    setStatus('loading');
    setError('');

    const timer = setTimeout(() => {
      FRDATA.fetchCurrentSearch(searchText, searchText ? 50 : 80)
        .then((courses) => {
          if (requestId.current !== id) return;
          const list = courses.filter(Boolean);
          setResults(list);
          onCoursesLoaded(list);
          setStatus('ready');
        })
        .catch((err) => {
          if (requestId.current !== id) return;
          setResults([]);
          setError(err && err.message ? err.message : 'Search failed');
          setStatus('error');
        });
    }, 220);

    return () => clearTimeout(timer);
  }, [query]);

  const scheduled = new Set(schedule.map((id) => String(id).toUpperCase()));
  const visibleResults = results.filter((course) => course && course.id);

  return (
    <div style={{
      marginTop: 8, border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
      background: 'var(--surface)', overflow: 'hidden',
    }}>
      <div style={{ padding: 10, borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 10px', borderRadius: 8,
          background: 'var(--surface)', border: '1px solid var(--border)',
        }}>
          <Icon name="search" size={14} style={{ color: 'var(--text-tertiary)' }} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by course number, title, requirement, or keyword"
            style={{ flex: 1, fontSize: 13, minWidth: 0 }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="btn-ghost"
              title="Clear search"
              style={{
                width: 22, height: 22, borderRadius: 6, padding: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-tertiary)',
              }}
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
      </div>

      <div style={{ maxHeight: 330, overflowY: 'auto' }}>
        {status === 'loading' && (
          <div style={{ padding: 16, fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center' }}>
            Searching current catalog...
          </div>
        )}

        {status === 'error' && (
          <div style={{ padding: 16, fontSize: 13, color: 'var(--accent)', textAlign: 'center' }}>
            {error}
          </div>
        )}

        {status === 'ready' && visibleResults.length === 0 && (
          <div style={{ padding: 16, fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center' }}>
            No current courses found
          </div>
        )}

        {status === 'ready' && visibleResults.map((course) => {
          const isAdded = scheduled.has(course.id);
          const tags = Array.isArray(course.satisfies) ? course.satisfies.slice(0, 3) : [];
          return (
            <div
              key={course.id}
              style={{
                padding: '11px 12px', borderBottom: '1px solid var(--border)',
                display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12,
                alignItems: 'center',
              }}
              onMouseEnter={(event) => { event.currentTarget.style.background = 'var(--surface-2)'; }}
              onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, minWidth: 0 }}>
                  <AreaDot area={course.area} />
                  <span className="mono" style={{ fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{course.id}</span>
                  <span style={{
                    color: 'var(--text)', fontSize: 13,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {course.name}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{courseWorkloadLabel(course)}</span>
                  {tags.map((tag) => (
                    <span key={tag} className="mono" style={{
                      fontSize: 10, padding: '2px 6px', borderRadius: 999,
                      background: 'var(--surface-2)', border: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                    }}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  onClick={() => onOpenCourse(course.id)}
                  className="btn-ghost"
                  style={{
                    fontSize: 11, padding: '6px 8px', borderRadius: 6,
                    border: '1px solid var(--border)', color: 'var(--text-secondary)',
                  }}
                >
                  Detail
                </button>
                <button
                  onClick={() => onAddCourse(course.id)}
                  disabled={isAdded}
                  style={{
                    fontSize: 11, padding: '6px 9px', borderRadius: 6,
                    background: isAdded ? 'var(--surface-2)' : 'var(--accent)',
                    color: isAdded ? 'var(--text-tertiary)' : '#fff',
                    opacity: isAdded ? 0.65 : 1,
                    cursor: isAdded ? 'default' : 'pointer',
                  }}
                >
                  {isAdded ? 'Added' : 'Add'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============== Schedule panel (left) ==============
const SchedulePanel = ({ schedule, setSchedule, justAddedId, onOpenCourse, onAddCourse, onRemoveCourse, viewMode, setViewMode, planningTermLabel = 'Next Semester' }) => {
  const [showCoursePicker, setShowCoursePicker] = useState(false);
  const [courseMap, setCourseMap] = useState(() => Object.fromEntries(FRDATA.catalog.map((course) => [course.id, course])));

  useEffect(() => {
    let cancelled = false;
    FRDATA.fetchCurrentSearch('', 80).then((courses) => {
      if (cancelled) return;
      setCourseMap((current) => ({
        ...current,
        ...Object.fromEntries(courses.map((course) => [course.id, course])),
      }));
    }).catch((error) => {
      if (!cancelled) console.warn('[schedule] current catalog preload failed', error);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all(schedule.map((id) => FRDATA.fetchCurrentCourse(id))).then((courses) => {
      if (cancelled) return;
      setCourseMap((current) => ({
        ...current,
        ...Object.fromEntries(courses.filter(Boolean).map((course) => [course.id, course])),
      }));
    });
    return () => { cancelled = true; };
  }, [schedule.join('|')]);

  const courses = schedule.map((id) => courseMap[id] || FRDATA.getCourse(id)).filter(Boolean);
  const totalUnits = courses.reduce((s, c) => s + c.units, 0);
  const reqsCovered = new Set();
  courses.forEach((c) => (c.requirements || c.satisfies || []).forEach((r) => reqsCovered.add(r)));

  const mergeLoadedCourses = (coursesToMerge) => {
    setCourseMap((current) => ({
      ...current,
      ...Object.fromEntries(coursesToMerge.filter(Boolean).map((course) => [course.id, course])),
    }));
  };

  const removeCourse = (id) => {
    if (onRemoveCourse) onRemoveCourse(id);
    else setSchedule(s => s.filter(x => x !== id));
  };

  const addCourseToSem = (id) => {
    const courseId = String(id || '').trim().toUpperCase();
    if (schedule.map((item) => String(item).toUpperCase()).includes(courseId)) { setShowCoursePicker(false); return; }
    if (onAddCourse) onAddCourse(courseId);
    else setSchedule(s => [...s, courseId]);
    setShowCoursePicker(false);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div>
            <div className="display" style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)' }}>
              {planningTermLabel}
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>
              Active semester plan
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {courses.length > 0 && (
              <button
                onClick={() => exportToICS(courses)}
                className="btn-ghost"
                title="Export to .ics"
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 12, padding: '4px 10px', borderRadius: 6,
                  border: '1px solid var(--border)', color: 'var(--text-secondary)',
                }}
              >
                <Icon name="download" size={13} />
                Export .ics
              </button>
            )}
            <div style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
              {[['list', 'list'], ['cal', 'grid']].map(([k, ic]) => (
                <button key={k} onClick={() => setViewMode(k)} title={k === 'list' ? 'List' : 'Calendar'}
                  style={{
                    width: 26, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 6, background: viewMode === k ? 'var(--bg)' : 'transparent',
                    color: viewMode === k ? 'var(--text)' : 'var(--text-tertiary)',
                    border: viewMode === k ? '1px solid var(--border)' : '1px solid transparent',
                  }}
                >
                  <Icon name={ic} size={13} />
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="eyebrow" style={{ marginTop: 6 }}>Your schedule · {courses.length} {courses.length === 1 ? 'course' : 'courses'}</div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {courses.length === 0 ? (
          <div style={{
            border: '1.5px dashed var(--border-strong)', borderRadius: 'var(--r-md)',
            padding: '40px 20px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>Your schedule is empty</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.6 }}>
              Add courses from the recommendations panel,<br/>or chat with the agent to get started.
            </div>
          </div>
        ) : viewMode === 'list' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {courses.map((c) => (
              <ScheduleCard
                key={c.id}
                course={c}
                match={FRDATA.getMatch(c.id)}
                onRemove={removeCourse}
                onOpen={onOpenCourse}
                justAdded={justAddedId === c.id}
              />
            ))}
          </div>
        ) : (
          <CalendarView courses={courses} />
        )}

        <button
          className="btn"
          onClick={() => { setShowCoursePicker(v => !v); }}
          style={{
            width: '100%', marginTop: 14, padding: '12px',
            border: '1px dashed var(--border-strong)', background: 'transparent',
            color: 'var(--text-secondary)', fontSize: 13,
          }}
        >
          <Icon name="plus" size={14} /> Add course manually
        </button>
        {showCoursePicker && (
          <ManualCourseSearch
            schedule={schedule}
            onAddCourse={addCourseToSem}
            onOpenCourse={onOpenCourse}
            onCoursesLoaded={mergeLoadedCourses}
          />
        )}
      </div>

      {/* Footer summary */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '14px 20px', background: 'var(--bg)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span className="eyebrow">This semester</span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--text)' }}>{totalUnits}</span> units
          </span>
        </div>
        <RequirementsPanel schedule={schedule} />
      </div>
    </div>
  );
};

// ============== Requirements panel ==============
const ReqRow = ({ group, depth = 0, expanded, toggle }) => {
  const isOpen = !!expanded[depth + ':' + group.id];
  const hasChildren = group.subGroups && group.subGroups.length > 0;
  const statusColor = group.satisfied ? 'var(--success)' : group.isManual ? 'var(--warning)' : 'var(--border-strong)';
  const indent = depth * 14;
  const fontSize = depth === 0 ? 12 : depth === 1 ? 11 : 10;
  const boxSize = depth === 0 ? 14 : 12;

  return (
    <div>
      <button
        onClick={() => toggle(depth + ':' + group.id)}
        style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 7, padding: `${depth === 0 ? 5 : 3}px 0`, paddingLeft: indent, fontSize }}
      >
        <span style={{
          width: boxSize, height: boxSize, borderRadius: 3, flexShrink: 0,
          background: group.satisfied ? 'var(--success)' : 'transparent',
          border: `1.5px solid ${statusColor}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: boxSize - 5, fontWeight: 700,
        }}>
          {group.satisfied ? '✓' : ''}
        </span>
        <span style={{ flex: 1, color: group.satisfied ? 'var(--text)' : depth === 0 ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>
          {group.label}
        </span>
        {group.progress && !group.satisfied && (
          <span className="mono" style={{ fontSize: fontSize - 1, color: 'var(--text-tertiary)' }}>{group.progress}</span>
        )}
        {(hasChildren || (!group.satisfied && !hasChildren)) && (
          <Icon name={isOpen ? 'chevronUp' : 'chevronDown'} size={10} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
        )}
      </button>

      {isOpen && hasChildren && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {group.subGroups.map(sub => (
            <ReqRow key={sub.id} group={sub} depth={depth + 1} expanded={expanded} toggle={toggle} />
          ))}
        </div>
      )}

      {isOpen && !hasChildren && !group.satisfied && (
        <div style={{ paddingLeft: indent + 21, paddingBottom: 5, fontSize: fontSize - 1, color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
          {group.isManual
            ? <span style={{ color: 'var(--warning)' }}>Requires advisor verification</span>
            : group.unmet.length > 0
              ? <>Still needed: {group.unmet.map((id, i) => (
                  <span key={id} className="mono" style={{ color: 'var(--text-secondary)' }}>
                    {i > 0 ? ', ' : ''}{id}
                  </span>
                ))}</>
              : null}
        </div>
      )}
    </div>
  );
};

function useReqCheck(majorKey, courses) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef(0);
  const cacheKey = majorKey + '|' + [...courses].sort().join(',');

  useEffect(() => {
    if (!majorKey) return;
    const id = ++ref.current;
    setLoading(true);
    fetch('/api/requirements/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ majorKey, courses }),
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => { if (ref.current === id) setResult(data); })
      .catch(() => {})
      .finally(() => { if (ref.current === id) setLoading(false); });
  }, [cacheKey]);

  return { result, loading };
}

const GirPanel = ({ allCourses }) => {
  const [expanded, setExpanded] = useState({});
  const { result, loading } = useReqCheck('girs', allCourses);
  const toggle = (id) => setExpanded(e => ({ ...e, [id]: !e[id] }));

  if (loading) return (
    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '4px 0' }}>Checking GIRs…</div>
  );
  if (!result) return null;

  const pct = result.totalCount > 0 ? Math.round(result.satisfiedCount / result.totalCount * 100) : 0;
  const barCls = pct === 100 ? 'green' : pct >= 50 ? 'orange' : 'red';

  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span className="eyebrow">GIRs</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {result.satisfiedCount}/{result.totalCount}
        </span>
      </div>
      <div className={`match-bar ${barCls}`} style={{ height: 4, marginBottom: 10 }}>
        <span style={{ width: `${pct}%`, transition: 'width 600ms cubic-bezier(0.2,0.8,0.2,1)' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {result.groups.map(group => (
          <ReqRow key={group.id} group={group} depth={0} expanded={expanded} toggle={toggle} />
        ))}
      </div>
    </div>
  );
};

const RequirementsPanel = ({ schedule }) => {
  const { profile } = useApp();
  const [expanded, setExpanded] = useState({});

  const major = profile && profile.major;
  const taken = (profile && profile.taken) || [];
  const allCourses = [...new Set([...taken, ...schedule])];

  const majorKey = major
    ? major.replace(/^course\s+/i, '').trim().toLowerCase().replace(/[:\s].*/, '')
    : null;

  const { result, loading } = useReqCheck(majorKey, allCourses);
  const toggle = (id) => setExpanded(e => ({ ...e, [id]: !e[id] }));

  if (loading && !result) return (
    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '8px 0' }}>Checking requirements…</div>
  );
  if (!result && !major) return null;

  const pct = result && result.totalCount > 0 ? Math.round(result.satisfiedCount / result.totalCount * 100) : 0;
  const barCls = pct === 100 ? 'green' : pct >= 60 ? 'orange' : 'yellow';

  return (
    <div>
      {result && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span className="eyebrow">{result.title || 'Requirements'}</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              {result.satisfiedCount}/{result.totalCount}
            </span>
          </div>
          <div className={`match-bar ${barCls}`} style={{ height: 4, marginBottom: 12 }}>
            <span style={{ width: `${pct}%`, transition: 'width 600ms cubic-bezier(0.2,0.8,0.2,1)' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {result.groups.map(group => (
              <ReqRow key={group.id} group={group} depth={0} expanded={expanded} toggle={toggle} />
            ))}
          </div>
        </>
      )}
      <GirPanel allCourses={allCourses} />
    </div>
  );
};

window.SchedulePanel = SchedulePanel;

// ============== 4-Year Plan page ==============
const FourYearPlanPage = () => {
  const { fourYearPlan, activeSem, setActiveSem, setRoute, profile } = useApp();
  const semOrder  = FRDATA.semesterOrder || [];
  const semLabels = FRDATA.semesterLabels || {};

  const totalCourses = Object.values(fourYearPlan).flat().length;

  const goPlanning = (sem) => { setActiveSem(sem); setRoute({ name: 'planner' }); };
  const openCourse = (id) => setRoute({ name: 'course', id });

  // Build year rows: each row is { fall: 'F26', iap: 'IAP27', spring: 'S27' }
  const falls = semOrder.filter((s) => s.startsWith('F')).slice(0, 4);
  const yearRows = falls.map((fall) => {
    const yy = parseInt(fall.slice(1), 10);
    const nextYY = String((yy + 1) % 100).padStart(2, '0');
    return { fall, iap: `IAP${nextYY}`, spring: `S${nextYY}` };
  });

  const SemCol = ({ sem, isIAP = false }) => {
    const courseIds = fourYearPlan[sem] || [];
    const courses   = courseIds.map((id) => FRDATA.getCourse(id)).filter(Boolean);
    const units     = courses.reduce((s, c) => s + (c.units || 0), 0);
    const isActive  = sem === activeSem;

    return (
      <div style={{
        background: 'var(--surface)',
        border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 'var(--r-md)', padding: isIAP ? '12px 10px' : 16,
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div>
            <div className="mono" style={{ fontSize: isIAP ? 10 : 11, fontWeight: isActive ? 600 : 400, color: isActive ? 'var(--accent)' : 'var(--text-secondary)' }}>
              {semLabels[sem] || sem}
            </div>
            {isActive && (
              <div style={{ fontSize: 9, color: 'var(--accent)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>
                Planning
              </div>
            )}
          </div>
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{units}u</span>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minHeight: isIAP ? 60 : 80 }}>
          {courses.map((c) => (
            <button key={c.id} onClick={() => openCourse(c.id)} style={{
              textAlign: 'left', padding: isIAP ? '4px 8px' : '6px 10px', borderRadius: 6,
              background: 'var(--surface-2)',
              borderLeft: `3px solid var(--course-${c.area || 'other'})`,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-3)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; }}
            >
              <span className="mono" style={{ fontSize: 10, fontWeight: 600, flexShrink: 0 }}>{c.id}</span>
              {!isIAP && <span style={{ fontSize: 10, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>}
            </button>
          ))}
          {!courses.length && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 11 }}>
              —
            </div>
          )}
        </div>

        <button
          onClick={() => goPlanning(sem)}
          style={{
            marginTop: 10, padding: '5px 0', width: '100%', fontSize: 10, borderRadius: 6,
            background: isActive ? 'var(--accent-soft)' : 'transparent',
            color: isActive ? 'var(--accent)' : 'var(--text-tertiary)',
            border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
            transition: 'all 140ms',
          }}
        >
          {isActive ? 'Currently planning' : 'Plan →'}
        </button>
      </div>
    );
  };

  return (
    <div className="fade-in" style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <TopBar showTabs={false} />

      <div style={{ padding: '32px 32px 64px', maxWidth: 1400, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <h1 className="display" style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>4-Year Plan</h1>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
              {profile?.name ? `${profile.name} · ` : ''}{totalCourses} courses across all semesters
            </div>
          </div>
          <button className="btn" onClick={() => setRoute({ name: 'planner' })} style={{ fontSize: 13, padding: '8px 16px' }}>
            ← Back to planner
          </button>
        </div>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '4fr 2fr 4fr', gap: 12, marginBottom: 8 }}>
          {['Fall', 'IAP', 'Spring'].map((label) => (
            <div key={label} className="mono" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', textAlign: 'center' }}>
              {label}
            </div>
          ))}
        </div>

        {/* Year rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {yearRows.map(({ fall, iap, spring }) => (
            <div key={fall} style={{ display: 'grid', gridTemplateColumns: '4fr 2fr 4fr', gap: 12 }}>
              <SemCol sem={fall} />
              <SemCol sem={iap} isIAP />
              <SemCol sem={spring} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

window.FourYearPlanPage = FourYearPlanPage;
