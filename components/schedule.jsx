/* global React, FRDATA, Icon, MatchBar, AreaDot, useApp */
const { useState, useEffect, useRef, useMemo } = React;

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
const CalendarView = ({ courses }) => {
  const days = ['M', 'T', 'W', 'R', 'F'];
  const dayLabels = { M: 'Mon', T: 'Tue', W: 'Wed', R: 'Thu', F: 'Fri' };
  const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

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
              {courses.filter((c) => c.days.includes(d) && c.time.start <= h && c.time.end > h).map((c) => {
                const isStart = c.time.start === h || (c.time.start > h && c.time.start < h + 1);
                if (!isStart) return null;
                const offsetTop = (c.time.start - h) * 28;
                const height = (c.time.end - c.time.start) * 28 - 2;
                return (
                  <div key={c.id} style={{
                    position: 'absolute', top: offsetTop, left: 2, right: 2, height,
                    background: `var(--course-${c.area})`, opacity: 0.85,
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
  const courses = schedule.map((id) => FRDATA.getCourse(id)).filter(Boolean);
  const totalUnits = courses.reduce((s, c) => s + c.units, 0);
  const reqsCovered = new Set();
  courses.forEach((c) => c.satisfies.forEach((r) => reqsCovered.add(r)));
  const remaining = FRDATA.profile.remainingReqs.filter((r) => !reqsCovered.has(r));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div className="display" style={{ fontSize: 22, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            Spring 2025
            <Icon name="chevronDown" size={14} style={{ color: 'var(--text-secondary)' }} />
          </div>
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
                onRemove={(id) => setSchedule((s) => s.filter((x) => x !== id))}
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
          style={{
            width: '100%', marginTop: 14, padding: '12px',
            border: '1px dashed var(--border-strong)', background: 'transparent',
            color: 'var(--text-secondary)', fontSize: 13,
          }}
        >
          <Icon name="plus" size={14} /> Add course manually
        </button>
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
const FourYearPlan = ({ schedule, setSchedule, fourYearPlan }) => {
  // Spring 2025 == 'S25', and current schedule populates S25
  const semCourses = (sem) => {
    if (sem === 'S25') return schedule.map((id) => FRDATA.getCourse(id)).filter(Boolean);
    return (fourYearPlan[sem] || []).map((id) => FRDATA.getCourse(id)).filter(Boolean);
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
                    padding: '8px 10px', borderRadius: 6,
                    background: 'var(--surface-2)',
                    borderLeft: `3px solid var(--course-${c.area})`,
                    cursor: 'grab',
                  }}>
                    <div className="mono" style={{ fontSize: 11, fontWeight: 600 }}>{c.id}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.name}
                    </div>
                  </div>
                ))}
                {courses.length === 0 && (
                  <div style={{
                    flex: 1, border: '1px dashed var(--border)', borderRadius: 6,
                    minHeight: 60, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--text-tertiary)', fontSize: 11,
                  }}>
                    +
                  </div>
                )}
              </div>

              <div style={{
                marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)',
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
