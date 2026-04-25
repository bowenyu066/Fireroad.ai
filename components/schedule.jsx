/* global React, FRDATA, Icon, MatchBar, AreaDot */
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
  const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
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
  courses.forEach((c) => c.satisfies.forEach((r) => reqsCovered.add(r)));

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span className="eyebrow">Summary</span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--text)' }}>{totalUnits}</span> units
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {FRDATA.profile.remainingReqs.map((r) => {
            const covered = reqsCovered.has(r);
            return (
              <span key={r} className="mono" style={{
                fontSize: 11, padding: '3px 8px', borderRadius: 999,
                background: covered ? 'rgba(34, 197, 94, 0.1)' : 'var(--surface-2)',
                color: covered ? 'var(--success)' : 'var(--text-secondary)',
                border: '1px solid ' + (covered ? 'var(--success)' : 'var(--border)'),
              }}>
                {covered ? '✓ ' : ''}{r}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};

window.SchedulePanel = SchedulePanel;

// Legacy display-only interface kept for future long-range visualization.
// It is intentionally not mounted from the main planner and has no edit/drop/move behavior.
const FourYearPlan = ({ plan = FRDATA.fourYearPlan, onOpenCourse = () => {} }) => (
  <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
    <div style={{ marginBottom: 18 }}>
      <h2 className="display" style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Long-Range Display</h2>
      <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
        Read-only interface reserved for future roadmap display.
      </div>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
      {FRDATA.semesterOrder.map((sem) => {
        const courses = (plan[sem] || []).map((id) => FRDATA.getCourse(id)).filter(Boolean);
        return (
          <div key={sem} style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)', padding: 12, minHeight: 150,
          }}>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10 }}>
              {FRDATA.semesterLabels[sem] || sem}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {courses.map((course) => (
                <button
                  key={course.id}
                  onClick={() => onOpenCourse(course.id)}
                  style={{
                    textAlign: 'left', padding: '7px 8px', borderRadius: 6,
                    background: 'var(--surface-2)', display: 'flex', alignItems: 'center', gap: 8,
                  }}
                >
                  <AreaDot area={course.area} />
                  <span className="mono" style={{ fontSize: 11 }}>{course.id}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{course.name}</span>
                </button>
              ))}
              {!courses.length && <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>No display items</span>}
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

window.FourYearPlan = FourYearPlan;
