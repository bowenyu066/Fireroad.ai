/* global React, FRDATA, Icon, MatchBar, AreaDot, useApp */
const { useState, useEffect, useRef, useMemo } = React;

// ============== ICS export ==============
const exportToICS = (courses) => {
  // MIT Spring 2025: Feb 3 – May 16
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
      `UID:${c.id}-spring2025@fireroad.ai`,
      'END:VEVENT',
    );
  });

  lines.push('END:VCALENDAR');

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'fireroad-spring-2025.ics';
  a.click();
  URL.revokeObjectURL(url);
};

// ============== Schedule course card (left panel) ==============
const ScheduleCard = ({ course, match, onRemove, onOpen, justAdded }) => {
  const [removing, setRemoving] = useState(false);
  const lastClick = useRef(0);

  const handleClick = (e) => {
    const now = Date.now();
    if (now - lastClick.current < 350) {
      setRemoving(true);
      setTimeout(() => onRemove(course.id), 280);
    } else {
      lastClick.current = now;
    }
  };

  return (
    <div
      onClick={handleClick}
      onDoubleClick={() => { setRemoving(true); setTimeout(() => onRemove(course.id), 280); }}
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

// ============== Schedule panel (left) ==============
const SchedulePanel = ({ schedule, setSchedule, justAddedId, onOpenCourse, viewMode, setViewMode }) => {
  const { fourYearPlan, setFourYearPlan } = useApp();
  const [activeSem, setActiveSem] = useState('S25');
  const [showSemPicker, setShowSemPicker] = useState(false);
  const [showCoursePicker, setShowCoursePicker] = useState(false);

  const semIds = activeSem === 'S25' ? schedule : (fourYearPlan[activeSem] || []);
  const courses = semIds.map((id) => FRDATA.getCourse(id)).filter(Boolean);
  const totalUnits = courses.reduce((s, c) => s + c.units, 0);
  const reqsCovered = new Set();
  courses.forEach((c) => c.satisfies.forEach((r) => reqsCovered.add(r)));
  const available = FRDATA.catalog.filter(c => !c._stub && !semIds.includes(c.id));

  const removeCourse = (id) => {
    if (activeSem === 'S25') {
      setSchedule(s => s.filter(x => x !== id));
    } else {
      setFourYearPlan(p => ({ ...p, [activeSem]: (p[activeSem] || []).filter(x => x !== id) }));
    }
  };

  const addCourseToSem = (id) => {
    if (semIds.includes(id)) { setShowCoursePicker(false); return; }
    if (activeSem === 'S25') {
      setSchedule(s => [...s, id]);
    } else {
      setFourYearPlan(p => ({ ...p, [activeSem]: [...(p[activeSem] || []), id] }));
    }
    setShowCoursePicker(false);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => { setShowSemPicker(v => !v); setShowCoursePicker(false); }}
              className="display"
              style={{ fontSize: 22, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)' }}
            >
              {FRDATA.semesterLabels[activeSem]}
              <Icon name={showSemPicker ? 'chevronUp' : 'chevronDown'} size={14} style={{ color: 'var(--text-secondary)' }} />
            </button>
            {showSemPicker && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 100,
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)', padding: 4, minWidth: 190,
                boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
              }}>
                {FRDATA.semesterOrder.map((sem) => (
                  <button
                    key={sem}
                    onClick={() => { setActiveSem(sem); setShowSemPicker(false); setShowCoursePicker(false); }}
                    style={{
                      width: '100%', textAlign: 'left', padding: '8px 12px', borderRadius: 6,
                      fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      background: activeSem === sem ? 'var(--accent-soft)' : 'transparent',
                      color: activeSem === sem ? 'var(--accent)' : 'var(--text)',
                    }}
                  >
                    <span>{FRDATA.semesterLabels[sem]}</span>
                    {activeSem === sem && <Icon name="check" size={12} />}
                  </button>
                ))}
              </div>
            )}
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
                justAdded={activeSem === 'S25' && justAddedId === c.id}
              />
            ))}
          </div>
        ) : (
          <CalendarView courses={courses} />
        )}

        <button
          className="btn"
          onClick={() => { setShowCoursePicker(v => !v); setShowSemPicker(false); }}
          style={{
            width: '100%', marginTop: 14, padding: '12px',
            border: '1px dashed var(--border-strong)', background: 'transparent',
            color: 'var(--text-secondary)', fontSize: 13,
          }}
        >
          <Icon name="plus" size={14} /> Add course manually
        </button>
        {showCoursePicker && (
          <div style={{
            marginTop: 8, border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
            background: 'var(--surface)', overflow: 'hidden', maxHeight: 260, overflowY: 'auto',
          }}>
            {available.length === 0
              ? <div style={{ padding: 16, fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center' }}>All courses added</div>
              : available.map(c => (
                <button
                  key={c.id}
                  onClick={() => addCourseToSem(c.id)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '10px 14px',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <AreaDot area={c.area} />
                  <span className="mono" style={{ fontSize: 12, fontWeight: 600, minWidth: 58 }}>{c.id}</span>
                  <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                </button>
              ))
            }
          </div>
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

// ============== 4-Year Plan view ==============
const FourYearPlan = ({ schedule }) => {
  const { fourYearPlan, setFourYearPlan } = useApp();
  const [addingTo, setAddingTo] = useState(null);

  const semCourses = (sem) => {
    if (sem === 'S25') return schedule.map((id) => FRDATA.getCourse(id)).filter(Boolean);
    return (fourYearPlan[sem] || []).map((id) => FRDATA.getCourse(id)).filter(Boolean);
  };

  const removeCourseFrom = (sem, id) =>
    setFourYearPlan(p => ({ ...p, [sem]: (p[sem] || []).filter(x => x !== id) }));

  const addCourseTo = (sem, id) => {
    if (!id) return;
    setFourYearPlan(p => {
      const cur = p[sem] || [];
      return cur.includes(id) ? p : { ...p, [sem]: [...cur, id] };
    });
    setAddingTo(null);
  };

  return (
    <div style={{ padding: '24px 32px', height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 24 }}>
        <div>
          <h2 className="display" style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>4-Year Plan</h2>
          <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
            Drag courses across semesters · Color-coded by department
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
          {[['cs', 'Course 6'], ['math', 'Course 18'], ['hass', 'HASS'], ['physics', 'Course 8']].map(([k, l]) => (
            <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
              <AreaDot area={k} /> {l}
            </span>
          ))}
        </div>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: 10,
        marginBottom: 32,
      }}>
        {FRDATA.semesterOrder.map((sem) => {
          const courses = semCourses(sem);
          const units = courses.reduce((s, c) => s + c.units, 0);
          const isCurrent = sem === 'S25';
          const isPast = ['F23', 'S24'].includes(sem);
          return (
            <div key={sem} style={{
              background: 'var(--surface)',
              border: '1px solid ' + (isCurrent ? 'var(--accent)' : 'var(--border)'),
              borderRadius: 'var(--r-md)', padding: 12, minHeight: 280,
              opacity: isPast ? 0.7 : 1,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {FRDATA.semesterLabels[sem]}
                </span>
                {isCurrent && <span className="mono" style={{ fontSize: 9, color: 'var(--accent)' }}>NOW</span>}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 200 }}>
                {courses.map((c) => (
                  <div key={c.id} style={{
                    padding: '7px 6px 7px 10px', borderRadius: 6,
                    background: 'var(--surface-2)',
                    borderLeft: `3px solid var(--course-${c.area})`,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4,
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="mono" style={{ fontSize: 11, fontWeight: 600 }}>{c.id}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.name}
                      </div>
                    </div>
                    <button
                      onClick={() => removeCourseFrom(sem, c.id)}
                      style={{ color: 'var(--text-tertiary)', flexShrink: 0, padding: 2, marginTop: 1 }}
                    >
                      <Icon name="x" size={10} />
                    </button>
                  </div>
                ))}
                {courses.length === 0 && addingTo !== sem && (
                  <div style={{
                    flex: 1, border: '1px dashed var(--border)', borderRadius: 6,
                    minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--text-tertiary)', fontSize: 11,
                  }}>
                    empty
                  </div>
                )}
              </div>

              {addingTo === sem ? (
                <div style={{ marginTop: 8 }}>
                  <select
                    autoFocus
                    defaultValue=""
                    onChange={(e) => addCourseTo(sem, e.target.value)}
                    style={{
                      width: '100%', padding: '5px 8px', fontSize: 11,
                      borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)',
                    }}
                  >
                    <option value="">Pick a course…</option>
                    {FRDATA.catalog.filter(c => !c._stub && !(sem === 'S25' ? schedule : (fourYearPlan[sem] || [])).includes(c.id)).map(c => (
                      <option key={c.id} value={c.id}>{c.id} — {c.name}</option>
                    ))}
                  </select>
                  <button onClick={() => setAddingTo(null)} style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => setAddingTo(sem)}
                  style={{
                    width: '100%', marginTop: 8, padding: '4px', fontSize: 10, borderRadius: 6,
                    border: '1px dashed var(--border)', color: 'var(--text-tertiary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  }}
                >
                  <Icon name="plus" size={10} /> Add
                </button>
              )}

              <div style={{
                marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)',
                fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)',
                display: 'flex', justifyContent: 'space-between',
              }}>
                <span>{courses.length} {courses.length === 1 ? 'class' : 'classes'}</span>
                <span>{units}u</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Requirements progress */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)', padding: 24,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
          <h3 className="display" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Requirements</h3>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {FRDATA.allReqs.filter((r) => r.done).length} of {FRDATA.allReqs.length} fulfilled
          </span>
        </div>

        {/* Big bar */}
        <div className="match-bar green" style={{ height: 8, marginBottom: 20 }}>
          <span style={{ width: `${(FRDATA.allReqs.filter((r) => r.done).length / FRDATA.allReqs.length) * 100}%` }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {FRDATA.allReqs.map((r) => (
            <div key={r.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
              borderRadius: 6, border: '1px solid var(--border)',
              background: r.done ? 'rgba(34, 197, 94, 0.06)' : 'transparent',
            }}>
              <span style={{
                width: 14, height: 14, borderRadius: 4,
                border: '1px solid ' + (r.done ? 'var(--success)' : 'var(--border-strong)'),
                background: r.done ? 'var(--success)' : 'transparent',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', flexShrink: 0,
              }}>
                {r.done && <Icon name="check" size={10} />}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mono" style={{ fontSize: 12, color: r.done ? 'var(--text)' : 'var(--text-secondary)' }}>{r.id}</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
              </div>
              {r.sub && <span className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{r.sub}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

window.SchedulePanel = SchedulePanel;
window.FourYearPlan = FourYearPlan;
