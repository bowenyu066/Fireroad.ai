/* global React, FRDATA, Icon, AreaDot */
const { useEffect, useState } = React;

const CourseDetail = (props) => <CourseDetailShell {...props} />;

const CourseDetailShell = ({ courseId, onBack, onAdd, onRemove, inSchedule }) => {
  const [tab, setTab] = useState('overview');
  const [currentCourse, setCurrentCourse] = useState(null);
  const [currentError, setCurrentError] = useState('');
  const [loadingCurrent, setLoadingCurrent] = useState(true);
  const [historyState, setHistoryState] = useState({ loading: true, payload: null, error: '' });

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

  useEffect(() => {
    let cancelled = false;
    setHistoryState({ loading: true, payload: null, error: '' });
    fetch(`/api/history/course/${encodeURIComponent(courseId)}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(response.status === 404 ? 'No past offering records yet.' : `Past offerings unavailable (${response.status})`)))
      .then((payload) => {
        if (!cancelled) setHistoryState({ loading: false, payload, error: '' });
      })
      .catch((error) => {
        if (!cancelled) setHistoryState({ loading: false, payload: null, error: error.message });
      });
    return () => { cancelled = true; };
  }, [courseId]);

  const history = historyState.payload;
  const course = currentCourse || currentFromHistory(history?.course, courseId) || { id: courseId, name: courseId };
  const summary = history?.summary || {};
  const offerings = history?.offerings || [];

  return (
    <div className="fade-in" style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <CourseHero
        course={course}
        summary={summary}
        tab={tab}
        setTab={setTab}
        onBack={onBack}
        onAdd={onAdd}
        onRemove={onRemove}
        inSchedule={inSchedule}
      />

      {tab === 'overview' ? (
        <OverviewView
          course={course}
          loadingCurrent={loadingCurrent}
          currentError={currentError}
          historyState={historyState}
          offerings={offerings}
          inSchedule={inSchedule}
          onShowPastOfferings={() => setTab('offerings')}
        />
      ) : (
        <PastOfferingsView historyState={historyState} />
      )}
    </div>
  );
};

const CourseHero = ({ course, summary, tab, setTab, onBack, onAdd, onRemove, inSchedule }) => {
  const offeringCount = summary.offeringCount || 0;
  const enrollment = course.enrollmentNumber ? Math.round(course.enrollmentNumber) : null;
  const canAct = inSchedule ? Boolean(onRemove) : Boolean(onAdd);
  const buttonLabel = inSchedule ? '- Remove from schedule' : '+ Add to schedule';
  return (
    <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div style={{ maxWidth: 1220, margin: '0 auto', padding: '18px 32px 30px' }}>
        <button className="btn btn-ghost" onClick={onBack} style={{ padding: '6px 10px', fontSize: 12, marginBottom: 24 }}>
          <Icon name="arrowLeft" size={13} /> Back to planner
        </button>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, alignItems: 'start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <AreaDot area={course.area} size={10} />
              <span className="eyebrow">{areaLabel(course.area)}</span>
            </div>
            <h1 className="display" style={{ margin: 0, fontSize: 46, fontWeight: 650, lineHeight: 1.05, maxWidth: 820 }}>
              <span className="mono" style={{ color: 'var(--text-secondary)', fontWeight: 500, marginRight: 14 }}>{course.id}</span>
              {course.name || course.currentTitle || course.id}
            </h1>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
              <HeroChip label="Availability" value={availabilityLabel(course)} strong />
              <HeroChip label="Units" value={course.units || course.currentUnits || 'TBD'} />
              <HeroChip label="Instructor" value={course.instructorText || 'TBD'} />
              {enrollment && <HeroChip label="Enrollment" value={enrollment} />}
              {course.catalogUrl && <HeroLinkChip label="Catalog" href={course.catalogUrl} value="Open" />}
              {offeringCount > 0 && <HeroChip label="Past offerings" value={String(offeringCount)} />}
            </div>
          </div>
          <button
            onClick={() => inSchedule ? onRemove(course.id) : onAdd(course.id)}
            disabled={!canAct}
            className={inSchedule ? 'btn' : 'btn btn-primary'}
            style={{
              minWidth: 220,
              padding: '14px 18px',
              fontSize: 14,
              borderColor: inSchedule ? 'var(--accent)' : undefined,
              color: inSchedule ? 'var(--accent)' : undefined,
            }}
          >
            {buttonLabel}
          </button>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          padding: 6,
          marginTop: 28,
          maxWidth: 620,
          borderRadius: 14,
          border: '1px solid rgba(37, 99, 235, 0.28)',
          background: 'rgba(37, 99, 235, 0.08)',
          boxShadow: '0 16px 40px rgba(37, 99, 235, 0.08)',
        }}>
          <PrimaryTabButton
            active={tab === 'overview'}
            onClick={() => setTab('overview')}
            label="Overview"
            description="Current facts and decision signals"
          />
          <PrimaryTabButton
            active={tab === 'offerings'}
            onClick={() => setTab('offerings')}
            label="Past Offerings"
            description={offeringCount ? `${offeringCount} offerings found` : 'Teaching history'}
          />
        </div>
      </div>
    </div>
  );
};

const PrimaryTabButton = ({ active, onClick, label, description }) => (
  <button
    onClick={onClick}
    style={{
      border: active ? '1px solid #2563eb' : '1px solid transparent',
      background: active ? '#2563eb' : 'transparent',
      color: active ? '#fff' : 'var(--text)',
      borderRadius: 10,
      padding: '13px 16px',
      textAlign: 'left',
      cursor: 'pointer',
      boxShadow: active ? '0 10px 24px rgba(37, 99, 235, 0.22)' : 'none',
    }}
  >
    <div style={{ fontWeight: 700, fontSize: 16 }}>{label}</div>
    <div style={{ marginTop: 3, fontSize: 12, color: active ? 'rgba(255,255,255,0.78)' : 'var(--text-secondary)' }}>
      {description}
    </div>
  </button>
);

const OverviewView = ({ course, loadingCurrent, currentError, historyState, offerings, inSchedule, onShowPastOfferings }) => {
  if (loadingCurrent && !course?.name) return <DetailLoading label="Loading course overview..." />;

  const summary = historyState.payload?.summary || {};
  const recentOfferings = offerings.slice(0, 3);
  const rating = normalizeRating(course.rating);

  return (
    <div style={{
      maxWidth: 1220,
      margin: '0 auto',
      padding: '34px 32px 56px',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) 330px',
      gap: 34,
      alignItems: 'start',
    }}>
      <main>
        {currentError && (
          <Notice tone="warning">
            Current service fell back to local mock data. Source-backed history is still shown when available.
          </Notice>
        )}

        <SectionBlock eyebrow="Schedule" title="Current meeting pattern">
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
            <FactCard label="Schedule" value={course.scheduleDisplay || 'Schedule TBD'} mono />
          </div>
        </SectionBlock>

        <SectionBlock eyebrow="Description" title="What this course covers">
          <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: 15 }}>
            {course.desc || course.currentDesc || 'No current catalog description available yet.'}
          </p>
        </SectionBlock>

        <SectionBlock eyebrow="Plan fit" title="Requirements and prerequisites">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Requirements</div>
              {course.requirements?.length ? (
                <TagRow items={course.requirements} tone="success" />
              ) : <Muted>None listed in the current snapshot.</Muted>}
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Prerequisites</div>
              {course.prerequisitesRaw ? (
                <div style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
                  <span className="mono" style={{ fontSize: 13 }}>{course.prerequisitesRaw}</span>
                </div>
              ) : <Muted>None listed.</Muted>}
            </div>
          </div>
        </SectionBlock>

        <SectionBlock eyebrow="Historical signals" title="What past offerings suggest" strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            <SignalCard
              label="Historical rating"
              value={rating ? `${rating.value.toFixed(1)} / ${rating.scale}` : 'Unavailable'}
              detail={rating ? `${rating.source || 'Fireroad'} snapshot` : 'No source-backed aggregate yet'}
            />
            <SignalCard
              label="Average workload"
              value={formatHours(course.totalHours)}
              detail={course.totalHours ? 'Fireroad workload snapshot' : 'No workload aggregate yet'}
            />
            <SignalCard
              label="Offerings found"
              value={summary.offeringCount || 0}
              detail={termRange(summary)}
            />
            <SignalCard
              label="Attendance trend"
              value={policyTrend(summary, offerings, 'attendance')}
              detail={policyCoverage(summary, 'attendance')}
            />
            <SignalCard
              label="Grading trend"
              value={policyTrend(summary, offerings, 'grading')}
              detail={policyCoverage(summary, 'grading')}
            />
            <SignalCard
              label="Source coverage"
              value={sourceCoverage(summary)}
              detail={`Coverage ${summary.coverageLevel || 'unknown'}`}
            />
          </div>
          {summary.topSummaryText && (
            <p style={{ margin: '16px 0 0', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {summary.topSummaryText}
            </p>
          )}
          {historyState.error && <Notice>{historyState.error} Add a manifest to collect past offering records.</Notice>}
        </SectionBlock>

        <SectionBlock eyebrow="Past offerings preview" title="Recent offerings">
          {!recentOfferings.length ? (
            <EmptyBox>No past offerings have been collected for this course yet.</EmptyBox>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {recentOfferings.map((offering) => <OfferingPreview key={offering.id} offering={offering} />)}
            </div>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onShowPastOfferings}
            style={{ marginTop: 14, padding: '9px 12px', fontSize: 13 }}
          >
            View all past offerings
          </button>
        </SectionBlock>
      </main>

      <aside style={{ position: 'sticky', top: 18 }}>
        <InfoPanel title="Action">
          <p style={{ margin: '0 0 14px', color: 'var(--text-secondary)', lineHeight: 1.5, fontSize: 13 }}>
            Add this course from the header. Past offerings are read-only decision context.
          </p>
        </InfoPanel>

        <InfoPanel title="Fit for your plan">
          <SideRow k="Requirements" v={course.requirements?.length ? course.requirements.join(', ') : 'None listed'} />
          <SideRow k="Already planned" v={inSchedule ? 'Yes' : 'No'} />
          <SideRow k="Past records" v={summary.offeringCount ? `${summary.offeringCount} offerings` : 'Not collected'} />
        </InfoPanel>
      </aside>
    </div>
  );
};

const PastOfferingsView = ({ historyState }) => {
  if (historyState.loading) return <DetailLoading label="Loading past offerings..." />;
  if (historyState.error) {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '56px 32px' }}>
        <SectionBlock eyebrow="Past offerings" title="No collected history yet">
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {historyState.error} Past offerings are collected from course history manifests and remain read-only.
          </p>
        </SectionBlock>
      </div>
    );
  }

  const { course, offerings = [] } = historyState.payload || {};
  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: '34px 32px 56px' }}>
      <SectionBlock eyebrow="Past offerings" title={`${course?.id || 'Course'} teaching history`}>
        {!offerings.length ? (
          <EmptyBox>No past offerings have been seeded for this course yet.</EmptyBox>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {offerings.map((offering) => <OfferingCard key={offering.id} offering={offering} />)}
          </div>
        )}
      </SectionBlock>
    </div>
  );
};

const OfferingPreview = ({ offering }) => (
  <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, background: 'var(--surface)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'start' }}>
      <div>
        <div className="mono" style={{ color: 'var(--text)', fontWeight: 650 }}>{termLabel(offering.term)}</div>
        <div style={{ color: 'var(--text-tertiary)', fontSize: 12, marginTop: 5 }}>
          {offering.instructorText || 'Instructor unknown'}
        </div>
      </div>
      <SourceBadgeRow sourceTypes={offering.sourceTypes} />
    </div>
    <p style={{ margin: '10px 0 0', color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.55 }}>
      {offeringDescription(offering)}
    </p>
  </div>
);

const OfferingCard = ({ offering }) => {
  const markdown = offeringMarkdownForDisplay(offering);
  const linkItems = sourceLinksForOffering(offering);

  return (
    <article style={{
      display: 'grid',
      gridTemplateColumns: '150px minmax(0, 1fr)',
      gap: 18,
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '18px 20px',
    }}>
      <div>
        <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
          {termLabel(offering.term)}
        </div>
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.45 }}>
          {offering.instructorText || 'Instructor unknown'}
          {offering.titleSnapshot ? ` · ${offering.titleSnapshot}` : ''}
        </div>

        <OfferingMarkdown markdown={markdown} />

        {linkItems.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 14 }}>
            {linkItems.slice(0, 3).map((item, index) => (
              <HistoryLink key={`${item.href}-${index}`} href={item.href}>{item.label}</HistoryLink>
            ))}
          </div>
        )}
      </div>
    </article>
  );
};

const OfferingMarkdown = ({ markdown }) => {
  const paragraphs = String(markdown || '').split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (!paragraphs.length) {
    return (
      <p style={{ margin: '14px 0 0', color: 'var(--text-tertiary)', fontSize: 15, lineHeight: 1.5 }}>
        Past offering details unavailable.
      </p>
    );
  }

  return (
  <div style={{ marginTop: 14, maxWidth: 900 }}>
    {paragraphs.map((paragraph, index) => (
      <p key={`${paragraph.slice(0, 32)}-${index}`} style={{ margin: index ? '8px 0 0' : 0, color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.5 }}>
        {renderMarkdownParts(paragraph)}
      </p>
    ))}
  </div>
  );
};

const SectionBlock = ({ eyebrow, title, children, strong }) => (
  <section style={{
    marginTop: 0,
    marginBottom: 22,
    padding: strong ? 22 : 0,
    border: strong ? '1px solid rgba(37, 99, 235, 0.22)' : 'none',
    borderRadius: strong ? 14 : 0,
    background: strong ? 'rgba(37, 99, 235, 0.045)' : 'transparent',
  }}>
    <div className="eyebrow" style={{ marginBottom: 8, color: strong ? '#2563eb' : 'var(--text-tertiary)' }}>{eyebrow}</div>
    <h2 className="display" style={{ margin: '0 0 14px', fontSize: 24, lineHeight: 1.2, fontWeight: 650 }}>{title}</h2>
    {children}
  </section>
);

const FactCard = ({ label, value, mono }) => (
  <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, background: 'var(--surface)' }}>
    <div className="eyebrow" style={{ marginBottom: 7 }}>{label}</div>
    <div className={mono ? 'mono' : ''} style={{ color: 'var(--text)', fontSize: 14, lineHeight: 1.45 }}>{value}</div>
  </div>
);

const SignalCard = ({ label, value, detail }) => (
  <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 15, background: 'var(--surface)' }}>
    <div className="eyebrow" style={{ marginBottom: 10 }}>{label}</div>
    <div className="display" style={{ color: 'var(--text)', fontSize: 24, lineHeight: 1, fontWeight: 650 }}>{value}</div>
    <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 9, lineHeight: 1.4 }}>{detail}</div>
  </div>
);

const InfoPanel = ({ title, children }) => (
  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 14 }}>
    <div className="eyebrow" style={{ marginBottom: 12 }}>{title}</div>
    {children}
  </div>
);

const SideRow = ({ k, v }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '8px 0', borderTop: '1px solid var(--border)', fontSize: 13 }}>
    <span style={{ color: 'var(--text-secondary)' }}>{k}</span>
    <span className="mono" style={{ color: 'var(--text)', textAlign: 'right' }}>{v}</span>
  </div>
);

const HeroChip = ({ label, value, strong }) => (
  <span style={{
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '7px 10px',
    borderRadius: 999,
    background: strong ? 'rgba(37, 99, 235, 0.1)' : 'var(--bg)',
    border: strong ? '1px solid rgba(37, 99, 235, 0.28)' : '1px solid var(--border)',
    color: strong ? '#2563eb' : 'var(--text-secondary)',
    fontSize: 12,
  }}>
    <span className="eyebrow" style={{ color: 'inherit' }}>{label}</span>
    <span className="mono" style={{ color: strong ? '#2563eb' : 'var(--text)' }}>{value}</span>
  </span>
);

const HeroLinkChip = ({ label, value, href }) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 7,
      padding: '7px 10px',
      borderRadius: 999,
      background: 'var(--bg)',
      border: '1px solid var(--border)',
      color: 'var(--text-secondary)',
      fontSize: 12,
    }}
  >
    <span className="eyebrow" style={{ color: 'inherit' }}>{label}</span>
    <span className="mono" style={{ color: 'var(--text)' }}>{value}</span>
  </a>
);

const TagRow = ({ items, tone }) => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    {items.map((item) => (
      <span key={item} className="mono" style={{
        fontSize: 12,
        padding: '5px 10px',
        borderRadius: 7,
        background: tone === 'success' ? 'rgba(34, 197, 94, 0.1)' : 'var(--surface)',
        color: tone === 'success' ? 'var(--success)' : 'var(--text-secondary)',
        border: `1px solid ${tone === 'success' ? 'var(--success)' : 'var(--border)'}`,
      }}>
        {item}
      </span>
    ))}
  </div>
);

const SourceBadgeRow = ({ sourceTypes }) => (
  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
    {(sourceTypes || []).length ? sourceTypes.map((type) => (
      <SourceBadge key={type}>{sourceLabel(type)}</SourceBadge>
    )) : <SourceBadge>No sources</SourceBadge>}
  </div>
);

const SourceBadge = ({ children }) => (
  <span className="mono" style={{
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 24,
    fontSize: 11,
    padding: '3px 7px',
    borderRadius: 7,
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    background: 'var(--bg)',
    whiteSpace: 'nowrap',
  }}>
    {children}
  </span>
);

const HistoryLink = ({ href, children }) => (
  <a href={href} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ padding: '5px 9px', fontSize: 12 }}>
    {children}
  </a>
);

const Notice = ({ children, tone }) => (
  <div style={{
    border: `1px solid ${tone === 'warning' ? 'var(--warning)' : 'var(--border)'}`,
    color: tone === 'warning' ? 'var(--warning)' : 'var(--text-secondary)',
    background: tone === 'warning' ? 'rgba(245, 158, 11, 0.08)' : 'var(--surface)',
    borderRadius: 10,
    padding: '10px 12px',
    fontSize: 12,
    marginBottom: 18,
  }}>
    {children}
  </div>
);

const EmptyBox = ({ children }) => (
  <div style={{ border: '1px dashed var(--border-strong)', borderRadius: 12, padding: 24, color: 'var(--text-secondary)', background: 'var(--surface)' }}>
    {children}
  </div>
);

const DetailLoading = ({ label }) => (
  <div style={{ padding: 56, color: 'var(--text-secondary)' }}>{label}</div>
);

const Muted = ({ children }) => <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{children}</span>;

function normalizeRating(rating) {
  if (!rating) return null;
  if (rating.source === 'mock') return null;
  if (typeof rating.value === 'number') return { ...rating, scale: rating.scale || 7 };
  if (typeof rating.overall === 'number') return { value: rating.overall, scale: rating.scale || 7, source: rating.source || 'Fireroad' };
  if (typeof rating === 'number') return { value: rating, scale: 7, source: 'Fireroad' };
  return null;
}

function formatHours(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)} h/wk` : 'Unavailable';
}

function availabilityLabel(course) {
  const offered = course?.offered || {};
  const terms = [
    offered.fall ? 'Fall' : null,
    offered.iap ? 'IAP' : null,
    offered.spring ? 'Spring' : null,
    offered.summer ? 'Summer' : null,
  ].filter(Boolean);
  if (terms.length) return terms.join(' / ');
  return course?.scheduleDisplay && course.scheduleDisplay !== 'Schedule TBD' ? 'Scheduled' : 'Schedule TBD';
}

function areaLabel(area) {
  if (area === 'cs') return 'Course 6';
  if (area === 'math') return 'Course 18';
  if (area === 'hass') return 'HASS';
  if (area === 'physics') return 'Course 8';
  return 'Current catalog';
}

function termLabel(term) {
  const raw = String(term || '').toUpperCase();
  if (raw === 'UNKNOWN') return 'Term unknown';
  const match = raw.match(/^(\d{4})(FA|SP|SU|IAP)$/);
  if (!match) return term || 'Unknown term';
  const names = { FA: 'Fall', SP: 'Spring', SU: 'Summer', IAP: 'IAP' };
  return `${names[match[2]] || match[2]} ${match[1]}`;
}

function termRange(summary) {
  if (!summary.earliestTerm && !summary.latestTerm) return 'No term range yet';
  if (summary.earliestTerm === summary.latestTerm) return termLabel(summary.latestTerm);
  return `${termLabel(summary.earliestTerm)} to ${termLabel(summary.latestTerm)}`;
}

function sourceCoverage(summary) {
  const parts = [
    summary.syllabusCount ? `${summary.syllabusCount} syllabus` : null,
    summary.homepageCount ? `${summary.homepageCount} homepage` : null,
    summary.archiveCount ? `${summary.archiveCount} archive` : null,
    summary.ocwCount ? `${summary.ocwCount} OCW` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No sources yet';
}

function policyCoverage(summary, kind) {
  const count = kind === 'attendance' ? summary.attendancePolicyCount : summary.gradingPolicyCount;
  const total = summary.offeringCount || 0;
  if (!total) return 'No offerings collected yet';
  if (!count) return `0/${total} offerings extracted`;
  return `${count}/${total} offerings extracted`;
}

function policyTrend(summary, offerings, kind) {
  const count = kind === 'attendance' ? summary.attendancePolicyCount : summary.gradingPolicyCount;
  if (!summary.offeringCount) return 'Unavailable';
  if (!count) return 'No explicit policy';
  const needle = kind === 'attendance' ? 'attendance unknown' : 'participation unknown';
  const unknown = offerings.filter((offering) => String(offering.offeringSummaryText || '').toLowerCase().includes(needle)).length;
  if (unknown >= count) return 'Unknown trend';
  return 'Evidence available';
}

function sourceLinksForOffering(offering) {
  const fromApi = (offering.sourceLinks || []).map((link) => ({
    href: link.url || link.href || link.archivedUrl,
    label: link.label || link.name || link.title || sourceLabel(link.docType || link.type),
    docType: link.docType || link.type || 'source',
  }));
  const fallback = [
    offering.homepageUrl && { href: offering.homepageUrl, label: 'Homepage', docType: 'homepage' },
    offering.syllabusUrl && { href: offering.syllabusUrl, label: 'Syllabus', docType: 'syllabus' },
    offering.ocwUrl && { href: offering.ocwUrl, label: 'OCW', docType: 'ocw' },
  ].filter(Boolean);

  const seen = new Set();
  return [...fromApi, ...fallback].filter((item) => {
    const key = String(item.href || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function offeringDescription(offering) {
  return plainTextFromOfferingMarkdown(offeringMarkdownForDisplay(offering), 190)
    || offering.offeringSummaryText
    || 'Past offering details unavailable.';
}

function offeringMarkdownForDisplay(offering) {
  return String(offering.offeringMarkdownText || offering.notes || offering.offeringSummaryText || '').trim();
}

function plainTextFromOfferingMarkdown(markdown, maxLength = 220) {
  const value = String(markdown || '')
    .replace(/\*\*/g, '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) return '';
  return value.length > maxLength ? `${value.slice(0, maxLength - 3).trim()}...` : value;
}

function renderMarkdownParts(text) {
  return String(text || '').split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} style={{ color: 'var(--text)' }}>{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function sourceLabel(type) {
  const raw = String(type || '').toLowerCase();
  const labels = {
    archive: 'Archive',
    catalog: 'Catalog',
    homepage: 'Homepage',
    html: 'HTML',
    open_learning: 'Open Learning',
    ocw: 'OCW',
    pdf: 'PDF',
    syllabus: 'Syllabus',
    text: 'Text',
  };
  return labels[raw] || raw || 'Source';
}

function currentFromHistory(course, courseId) {
  if (!course) return null;
  return {
    id: course.id || courseId,
    name: course.currentTitle || course.id || courseId,
    desc: course.currentDesc,
    units: course.currentUnits,
    area: course.area,
  };
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
