/* global React, FRDATA, Icon, MatchBar, AreaDot, useApp */
const { useState } = React;

const CourseDetail = ({ courseId, onBack, onAdd, inSchedule }) => {
  const c = FRDATA.getCourse(courseId);
  const m = FRDATA.getMatch(courseId);
  if (!c) return <div style={{ padding: 40 }}>Course not found</div>;

  const taken = FRDATA.profile.taken;
  const prereqStatus = c.prereqs.map((p) => ({ id: p, taken: taken.includes(p) }));

  const yourEstimate = (c.hydrant * (1 - (1 - FRDATA.profile.calibration) / 2)).toFixed(1);

  return (
    <div className="fade-in" style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* sub-nav */}
      <div style={{
        padding: '14px 32px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button className="btn btn-ghost" onClick={onBack} style={{ padding: '6px 10px', fontSize: 12 }}>
          <Icon name="arrowLeft" size={13} /> Back to planner
        </button>
        <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>/</span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.id}</span>
      </div>

      <div style={{
        maxWidth: 1200, margin: '0 auto', padding: '40px 32px',
        display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 48,
      }}>
        {/* LEFT */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <AreaDot area={c.area} size={10} />
            <span className="eyebrow">
              {c.area === 'cs' ? 'Course 6 · Computer Science'
              : c.area === 'math' ? 'Course 18 · Mathematics'
              : c.area === 'hass' ? 'HASS'
              : c.area === 'physics' ? 'Course 8 · Physics'
              : 'Course'}
            </span>
          </div>

          <h1 className="display" style={{ margin: 0, fontSize: 38, fontWeight: 600, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
            <span className="mono" style={{ color: 'var(--text-secondary)', fontWeight: 500, fontSize: 30, marginRight: 14 }}>{c.id}</span>
            {c.name}
          </h1>

          <p style={{ marginTop: 22, fontSize: 15, lineHeight: 1.65, color: 'var(--text-secondary)', maxWidth: 620 }}>
            {c.desc}
          </p>

          {/* meta row */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 24,
            marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)',
          }}>
            <Meta label="Schedule" value={c.schedule} mono />
            <Meta label="Units" value={c.units} mono />
            <Meta label="Instructor" value={c.instructor} />
          </div>

          {/* requirements satisfied */}
          <Section title="Requirements Satisfied">
            {c.satisfies.length === 0 ? (
              <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>None</span>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {c.satisfies.map((r) => (
                  <span key={r} className="mono" style={{
                    fontSize: 12, padding: '5px 10px', borderRadius: 6,
                    background: 'rgba(34, 197, 94, 0.1)', color: 'var(--success)',
                    border: '1px solid var(--success)',
                  }}>
                    ✓ {r}
                  </span>
                ))}
              </div>
            )}
          </Section>

          {/* Prerequisites */}
          <Section title="Prerequisites">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {prereqStatus.length === 0 ? <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>None</span> :
                prereqStatus.map((p) => (
                  <div key={p.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: p.taken ? 'rgba(34, 197, 94, 0.06)' : 'rgba(245, 158, 11, 0.06)',
                  }}>
                    <span style={{
                      width: 16, height: 16, borderRadius: 4,
                      background: p.taken ? 'var(--success)' : 'var(--warning)',
                      color: '#fff',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Icon name={p.taken ? 'check' : 'x'} size={10} />
                    </span>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{p.id}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {p.taken ? 'You\'ve taken this' : 'Not in your transcript'}
                    </span>
                  </div>
                ))}
            </div>
          </Section>

          {/* Syllabus */}
          {c.topics.length > 0 && (
            <Section title="Syllabus Topics">
              <div style={{
                border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
                background: 'var(--surface)', overflow: 'hidden',
              }}>
                {c.topics.map((t, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: 16, padding: '12px 16px',
                    borderBottom: i < c.topics.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 60 }}>
                      Week {t.weeks}
                    </span>
                    <span style={{ fontSize: 13 }}>{t.title}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>

        {/* RIGHT */}
        <div>
          {/* Match score card */}
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)', padding: 24, marginBottom: 16,
          }}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>Match Score</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="display mono" style={{ fontSize: 56, fontWeight: 600, lineHeight: 1, color: 'var(--accent)' }}>
                {m.total}
              </span>
              <span className="mono" style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>/100</span>
            </div>
            <div style={{ marginTop: 16 }}>
              <MatchBar score={m.total} width="100%" showNumber={false} />
            </div>

            <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <ScoreLine label="Interest fit" value={m.interest} max={40} />
              <ScoreLine label="Workload fit" value={m.workload} max={30} />
              <ScoreLine label="Requirement value" value={m.reqValue} max={30} />
            </div>
          </div>

          {/* Workload */}
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)', padding: 20, marginBottom: 16,
          }}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>Workload</div>
            <Row k="Hydrant average" v={`${c.hydrant.toFixed(1)} h/wk`} />
            <Row k="Your estimate" v={`~${yourEstimate} h/wk`} accent />
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 10, lineHeight: 1.5 }}>
              Calibrated against {FRDATA.profile.taken[0]} which you flagged as {FRDATA.profile.calibration > 0.9 ? 'easy' : 'normal'}.
            </div>
          </div>

          {/* Ratings */}
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)', padding: 20, marginBottom: 16,
          }}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>Student Ratings <span style={{ color: 'var(--text-tertiary)', textTransform: 'none', letterSpacing: 0 }}>· n={c.rating.n}</span></div>
            <RatingRow label="Overall" value={c.rating.overall} />
            <RatingRow label="Lectures" value={c.rating.lectures} />
            <RatingRow label="Difficulty" value={c.rating.difficulty} />

            <div style={{
              marginTop: 18, padding: '12px 14px',
              borderLeft: '2px solid var(--accent)',
              background: 'var(--accent-soft)',
              borderRadius: '0 6px 6px 0',
              fontSize: 13, color: 'var(--text)',
              lineHeight: 1.55, fontStyle: 'italic',
            }}>
              "{c.quote}"
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8, fontStyle: 'normal' }}>— Student review</div>
            </div>
          </div>

          {/* CTA */}
          <button
            onClick={() => { onAdd(c.id); onBack(); }}
            disabled={inSchedule}
            className="btn btn-primary"
            style={{
              width: '100%', padding: '14px', fontSize: 14, opacity: inSchedule ? 0.55 : 1,
            }}
          >
            {inSchedule ? '✓ In your schedule' : <>+ Add to schedule</>}
          </button>
        </div>
      </div>
    </div>
  );
};

const Meta = ({ label, value, mono }) => (
  <div>
    <div className="eyebrow" style={{ marginBottom: 4 }}>{label}</div>
    <div className={mono ? 'mono' : ''} style={{ fontSize: 14, color: 'var(--text)' }}>{value}</div>
  </div>
);

const Section = ({ title, children }) => (
  <div style={{ marginTop: 32 }}>
    <div className="eyebrow" style={{ marginBottom: 12 }}>{title}</div>
    {children}
  </div>
);

const Row = ({ k, v, accent }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
    <span style={{ color: 'var(--text-secondary)' }}>{k}</span>
    <span className="mono" style={{ color: accent ? 'var(--accent)' : 'var(--text)', fontWeight: accent ? 600 : 400 }}>{v}</span>
  </div>
);

const ScoreLine = ({ label, value, max }) => (
  <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span className="mono" style={{ color: 'var(--text)' }}>{value}<span style={{ color: 'var(--text-tertiary)' }}>/{max}</span></span>
    </div>
    <div className="match-bar" style={{ height: 4 }}>
      <span style={{ width: `${(value / max) * 100}%` }} />
    </div>
  </div>
);

const RatingRow = ({ label, value }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: 13 }}>
    <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ display: 'flex', gap: 1 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} style={{
            color: i <= Math.round(value) ? 'var(--warning)' : 'var(--border-strong)',
            fontSize: 13,
          }}>★</span>
        ))}
      </div>
      <span className="mono" style={{ fontSize: 12, color: 'var(--text)', minWidth: 28, textAlign: 'right' }}>
        {value.toFixed(1)}
      </span>
    </div>
  </div>
);

window.CourseDetail = CourseDetail;
