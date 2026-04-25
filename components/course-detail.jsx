/* global React, FRDATA, Icon, MatchBar, AreaDot */
const { useEffect, useState } = React;

const CourseDetail = (props) => <CourseDetailShell {...props} />;

const CourseDetailShell = ({ courseId, onBack, onAdd, inSchedule }) => {
  const [tab, setTab] = useState('current');
  const [currentCourse, setCurrentCourse] = useState(null);
  const [currentError, setCurrentError] = useState('');
  const [loadingCurrent, setLoadingCurrent] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingCurrent(true);
    setCurrentError('');
    fetch(`/api/current/course/${encodeURIComponent(courseId)}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`Current course unavailable (${response.status})`)))
      .then((payload) => {
        if (!cancelled) setCurrentCourse(payload.course);
      })
      .catch(async (error) => {
        const fallback = await FRDATA.fetchCurrentCourse(courseId);
        if (!cancelled) {
          setCurrentCourse(fallback?.current || currentFromFallback(fallback));
          setCurrentError(error.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingCurrent(false);
      });
    return () => { cancelled = true; };
  }, [courseId]);

  const displayId = currentCourse?.id || courseId;

  return (
    <div className="fade-in" style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{
        padding: '14px 32px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button className="btn btn-ghost" onClick={onBack} style={{ padding: '6px 10px', fontSize: 12 }}>
          <Icon name="arrowLeft" size={13} /> Back to planner
        </button>
        <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>/</span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{displayId}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, padding: 3, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          {['current', 'historical'].map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                padding: '6px 14px', fontSize: 13, fontWeight: 500, borderRadius: 7,
                background: tab === id ? 'var(--bg)' : 'transparent',
                color: tab === id ? 'var(--text)' : 'var(--text-secondary)',
                border: tab === id ? '1px solid var(--border)' : '1px solid transparent',
              }}
            >
              {id === 'current' ? 'Current' : 'Historical'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'current' ? (
        <CurrentCourseView
          course={currentCourse}
          loading={loadingCurrent}
          error={currentError}
          onAdd={onAdd}
          onBack={onBack}
          inSchedule={inSchedule}
        />
      ) : (
        <HistoricalCourseView courseId={displayId} />
      )}
    </div>
  );
};

const CurrentCourseView = ({ course, loading, error, onAdd, onBack, inSchedule }) => {
  if (loading) return <DetailLoading label="Loading current catalog data..." />;
  if (!course) return <div style={{ padding: 40 }}>Course not found</div>;

  const match = FRDATA.getMatch(course.id);
  const rating = normalizeRating(course.rating);
  const yourEstimate = course.totalHours
    ? (course.totalHours * (1 - (1 - FRDATA.profile.calibration) / 2)).toFixed(1)
    : null;
  const prereqs = course.prerequisitesRaw ? [course.prerequisitesRaw] : [];

  return (
    <div style={{
      maxWidth: 1200, margin: '0 auto', padding: '40px 32px',
      display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 48,
    }}>
      <div>
        {error && (
          <div style={{
            border: '1px solid var(--warning)', color: 'var(--warning)',
            background: 'rgba(245, 158, 11, 0.08)', borderRadius: 'var(--r-md)',
            padding: '10px 12px', fontSize: 12, marginBottom: 18,
          }}>
            Current service fell back to local mock data.
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <AreaDot area={course.area} size={10} />
          <span className="eyebrow">{areaLabel(course.area)}</span>
        </div>

        <h1 className="display" style={{ margin: 0, fontSize: 38, fontWeight: 600, lineHeight: 1.1 }}>
          <span className="mono" style={{ color: 'var(--text-secondary)', fontWeight: 500, fontSize: 30, marginRight: 14 }}>{course.id}</span>
          {course.name}
        </h1>

        <p style={{ marginTop: 22, fontSize: 15, lineHeight: 1.65, color: 'var(--text-secondary)', maxWidth: 680 }}>
          {course.desc || 'No current catalog description available yet.'}
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
          <Meta label="Schedule" value={course.scheduleDisplay || 'Schedule TBD'} mono />
          <Meta label="Units" value={course.units || 'TBD'} mono />
          <Meta label="Instructor" value={course.instructorText || 'TBD'} />
          {course.enrollmentNumber && <Meta label="Enrollment" value={Math.round(course.enrollmentNumber)} mono />}
        </div>

        <Section title="Requirements">
          {course.requirements?.length ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {course.requirements.map((r) => (
                <span key={r} className="mono" style={{
                  fontSize: 12, padding: '5px 10px', borderRadius: 6,
                  background: 'rgba(34, 197, 94, 0.1)', color: 'var(--success)',
                  border: '1px solid var(--success)',
                }}>
                  {r}
                </span>
              ))}
            </div>
          ) : <Muted>None listed in current snapshot.</Muted>}
        </Section>

        <Section title="Prerequisites">
          {prereqs.length ? prereqs.map((raw) => (
            <div key={raw} style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)' }}>
              <span className="mono" style={{ fontSize: 13 }}>{raw}</span>
            </div>
          )) : <Muted>None listed.</Muted>}
        </Section>

        <Section title="Related Subjects">
          {course.relatedSubjects?.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {course.relatedSubjects.map((id) => <span key={id} className="mono" style={{ fontSize: 12, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6 }}>{id}</span>)}
            </div>
          ) : <Muted>No related subjects listed.</Muted>}
        </Section>
      </div>

      <div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 24, marginBottom: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Personal Fit</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="display mono" style={{ fontSize: 56, fontWeight: 600, lineHeight: 1, color: 'var(--accent)' }}>{match.total}</span>
            <span className="mono" style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>/100</span>
          </div>
          <div style={{ marginTop: 16 }}><MatchBar score={match.total} width="100%" showNumber={false} /></div>
          <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <ScoreLine label="Interest fit" value={match.interest} max={40} />
            <ScoreLine label="Workload fit" value={match.workload} max={30} />
            <ScoreLine label="Requirement value" value={match.reqValue} max={30} />
          </div>
        </div>

        <InfoCard title="Workload">
          <Row k="In class" v={formatHours(course.inClassHours)} />
          <Row k="Out of class" v={formatHours(course.outOfClassHours)} />
          <Row k="Total" v={formatHours(course.totalHours)} accent />
          {yourEstimate && <Row k="Your estimate" v={`~${yourEstimate} h/wk`} accent />}
        </InfoCard>

        <InfoCard title="Current Rating">
          {rating ? (
            <>
              <Row k="Rating" v={`${rating.value.toFixed(1)} / ${rating.scale}`} accent />
              <Row k="Source" v={rating.source || 'current'} />
            </>
          ) : <Muted>No current rating available.</Muted>}
        </InfoCard>

        {course.catalogUrl && (
          <a href={course.catalogUrl} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', marginBottom: 12 }}>
            Current catalog
          </a>
        )}

        <button
          onClick={() => { onAdd(course.id); onBack(); }}
          disabled={inSchedule}
          className="btn btn-primary"
          style={{ width: '100%', padding: '14px', fontSize: 14, opacity: inSchedule ? 0.55 : 1 }}
        >
          {inSchedule ? 'In your next-semester plan' : '+ Add to next semester'}
        </button>
      </div>
    </div>
  );
};

const HistoricalCourseView = ({ courseId }) => {
  const [state, setState] = useState({ loading: true, payload: null, error: '' });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, payload: null, error: '' });
    fetch(`/api/history/course/${encodeURIComponent(courseId)}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(response.status === 404 ? 'No history record yet.' : `History unavailable (${response.status})`)))
      .then((payload) => {
        if (!cancelled) setState({ loading: false, payload, error: '' });
      })
      .catch((error) => {
        if (!cancelled) setState({ loading: false, payload: null, error: error.message });
      });
    return () => { cancelled = true; };
  }, [courseId]);

  if (state.loading) return <DetailLoading label="Loading historical offerings..." />;
  if (state.error) {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '56px 32px' }}>
        <h1 className="display" style={{ fontSize: 28, margin: 0 }}>Historical</h1>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {state.error} Historical information is read-only reference and does not affect the next-semester plan.
        </p>
      </div>
    );
  }

  const { course, stats, offerings = [] } = state.payload;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Read-only history</div>
          <h1 className="display" style={{ fontSize: 32, margin: 0 }}>{course.id} Historical Context</h1>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 680 }}>
            Past offerings, syllabi, attendance, and grading evidence are reference signals only. They do not create future-semester planning actions.
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10, marginBottom: 26 }}>
        <Stat label="Offerings" value={stats.offeringCount} />
        <Stat label="Homepages" value={stats.homepageCount} />
        <Stat label="Syllabi" value={stats.syllabusCount} />
        <Stat label="Attendance" value={stats.attendancePolicyCount} />
        <Stat label="Grading" value={stats.gradingPolicyCount} />
      </div>

      <Section title="Offerings">
        {!offerings.length ? (
          <div style={{ border: '1px dashed var(--border-strong)', borderRadius: 'var(--r-md)', padding: 26, color: 'var(--text-secondary)' }}>
            No historical offerings have been seeded for this course yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {offerings.map((offering) => <OfferingCard key={offering.id} offering={offering} />)}
          </div>
        )}
      </Section>
    </div>
  );
};

const OfferingCard = ({ offering }) => {
  const attendance = offering.attendancePolicy;
  const grading = offering.gradingPolicy;
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 12 }}>
        <div>
          <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{offering.term}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>{offering.titleSnapshot || offering.courseId}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {offering.homepageUrl && <HistoryLink href={offering.homepageUrl}>Homepage</HistoryLink>}
          {offering.syllabusUrl && <HistoryLink href={offering.syllabusUrl}>Syllabus</HistoryLink>}
          {offering.ocwUrl && <HistoryLink href={offering.ocwUrl}>OCW</HistoryLink>}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <PolicyBlock
          title="Attendance"
          primary={attendance ? `Required: ${attendance.attendanceRequired || 'unknown'}` : 'Unknown'}
          secondary={attendance?.attendanceNotes || attendance?.attendanceCountsTowardGrade || ''}
          evidence={attendance?.evidenceText}
          confidence={attendance?.confidence}
          reviewStatus={attendance?.reviewStatus}
        />
        <PolicyBlock
          title="Grading"
          primary={grading ? participationText(grading) : 'Unknown'}
          secondary={grading?.gradingNotes || grading?.latePolicyText || grading?.collaborationPolicyText || ''}
          evidence={grading?.evidenceText}
          confidence={grading?.confidence}
          reviewStatus={grading?.reviewStatus}
        />
      </div>
      <div style={{ marginTop: 12, color: 'var(--text-secondary)', fontSize: 12 }}>
        Instructor: {offering.instructorText || 'unknown'}
      </div>
    </div>
  );
};

const PolicyBlock = ({ title, primary, secondary, evidence, confidence, reviewStatus }) => (
  <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: 'var(--bg)' }}>
    <div className="eyebrow" style={{ marginBottom: 8 }}>{title}</div>
    <div style={{ fontSize: 13 }}>{primary}</div>
    {secondary && <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: 6 }}>{secondary}</div>}
    {evidence && <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: 8, borderLeft: '2px solid var(--border-strong)', paddingLeft: 10 }}>{evidence}</div>}
    <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>
      {confidence != null ? `confidence ${confidence}` : 'confidence unknown'} · {reviewStatus || 'unreviewed'}
    </div>
  </div>
);

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

const InfoCard = ({ title, children }) => (
  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 20, marginBottom: 16 }}>
    <div className="eyebrow" style={{ marginBottom: 14 }}>{title}</div>
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
      <span style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
    </div>
  </div>
);

const Stat = ({ label, value }) => (
  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 14 }}>
    <div className="mono" style={{ fontSize: 22, color: 'var(--text)' }}>{value || 0}</div>
    <div className="eyebrow" style={{ marginTop: 6 }}>{label}</div>
  </div>
);

const HistoryLink = ({ href, children }) => (
  <a href={href} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ padding: '5px 9px', fontSize: 12 }}>
    {children}
  </a>
);

const DetailLoading = ({ label }) => (
  <div style={{ padding: 56, color: 'var(--text-secondary)' }}>{label}</div>
);

const Muted = ({ children }) => <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{children}</span>;

function normalizeRating(rating) {
  if (!rating) return null;
  if (typeof rating.value === 'number') return rating;
  if (typeof rating.overall === 'number') return { value: rating.overall, scale: rating.scale || 5, source: rating.source || 'mock' };
  return null;
}

function formatHours(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)} h/wk` : 'unknown';
}

function areaLabel(area) {
  if (area === 'cs') return 'Course 6 · Current catalog';
  if (area === 'math') return 'Course 18 · Current catalog';
  if (area === 'hass') return 'HASS · Current catalog';
  if (area === 'physics') return 'Course 8 · Current catalog';
  return 'Current catalog';
}

function participationText(grading) {
  if (!grading) return 'Unknown';
  if (grading.hasParticipationComponent) return `Participation: ${grading.hasParticipationComponent}`;
  if (grading.letterGrade) return `Letter grade: ${grading.letterGrade}`;
  return 'Grading policy found';
}

function currentFromFallback(course) {
  if (!course) return null;
  return {
    id: course.id,
    name: course.name,
    desc: course.desc,
    units: course.units,
    instructorText: course.instructor,
    prerequisitesRaw: (course.prereqs || []).join(', '),
    requirements: course.satisfies || [],
    scheduleRaw: course.schedule,
    scheduleDisplay: course.schedule,
    relatedSubjects: [],
    rating: course.rating,
    enrollmentNumber: course.rating?.n || null,
    inClassHours: null,
    outOfClassHours: null,
    totalHours: course.hydrant,
    catalogUrl: null,
    area: course.area,
  };
}

window.CourseDetail = CourseDetail;
window.CourseDetailShell = CourseDetailShell;
window.CurrentCourseView = CurrentCourseView;
window.HistoricalCourseView = HistoricalCourseView;
