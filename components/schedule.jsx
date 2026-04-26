/* global React, FRDATA, PersonalCourse, useApp, Icon, MatchBar, AreaDot */
const { useState, useEffect, useRef } = React;

// ============== ICS export ==============
const exportToICS = (courses) => {
  const SEM_START = new Date(2025, 1, 3); // Feb 3 Monday
  const SEM_UNTIL = '20250517T035959Z';   // May 16 23:59 EDT → UTC

  const DAY_OFFSET = { M: 0, T: 1, W: 2, R: 3, F: 4 };
  const DAY_ICS    = { M: 'MO', T: 'TU', W: 'WE', R: 'TH', F: 'FR' };

  const pad     = (n) => String(n).padStart(2, '0');
  const toTime  = (dec) => { const h = Math.floor(dec); const m = Math.round((dec - h) * 60); return `${pad(h)}${pad(m)}00`; };
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  const fmtDate = (d, t) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${t}`;
  const icsEscape = (s) => String(s || '').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//fireroad.ai//Course Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];

  courses.forEach((c) => {
    // Parse all meeting segments (lecture, recitation, lab…) from scheduleRaw
    const segments = c.scheduleRaw ? parseAllMeetings(c.scheduleRaw) : [];

    // Fallback: use pre-parsed days/time as a single unlabeled meeting
    const meetings = segments.length > 0 ? segments : (
      c.days && c.days.length && c.time && c.time.end > c.time.start
        ? [{ shortType: '', room: '', days: c.days, start: c.time.start, end: c.time.end }]
        : []
    );

    const reqs = (c.requirements || c.satisfies || []);
    const baseDesc = [
      c.instructorText ? `Instructor: ${c.instructorText}` : (c.instructor ? `Instructor: ${c.instructor}` : ''),
      c.units ? `Units: ${c.units}` : '',
      reqs.length ? `Satisfies: ${reqs.join(', ')}` : '',
    ].filter(Boolean).join('\\n');

    meetings.forEach((m, mi) => {
      if (!m.days.length) return;
      const typeLabel = m.shortType ? ` (${m.shortType.charAt(0).toUpperCase() + m.shortType.slice(1)})` : '';
      const summary   = `${c.id}${typeLabel} – ${c.name}`;
      const location  = m.room ? `${m.room}, MIT` : 'MIT';
      const desc      = m.shortType ? `Type: ${m.shortType}\\n${m.room ? `Room: ${m.room}\\n` : ''}${baseDesc}` : baseDesc;
      const byDay     = m.days.map((d) => DAY_ICS[d]).join(',');
      const firstDate = addDays(SEM_START, Math.min(...m.days.map((d) => DAY_OFFSET[d])));

      lines.push(
        'BEGIN:VEVENT',
        `DTSTART;TZID=America/New_York:${fmtDate(firstDate, toTime(m.start))}`,
        `DTEND;TZID=America/New_York:${fmtDate(firstDate, toTime(m.end))}`,
        `RRULE:FREQ=WEEKLY;BYDAY=${byDay};UNTIL=${SEM_UNTIL}`,
        `SUMMARY:${icsEscape(summary)}`,
        `DESCRIPTION:${icsEscape(desc)}`,
        `LOCATION:${icsEscape(location)}`,
        `UID:${c.id}-${m.shortType || 'main'}-${mi}@fireroad.ai`,
        'END:VEVENT',
      );
    });
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
const ScheduleCard = ({ course, onRemove, onOpen, justAdded, notOffered }) => {
  const [removing, setRemoving] = useState(false);
  const [hover, setHover] = useState(false);
  const removingRef = useRef(false);

  const requestRemove = () => {
    if (removingRef.current) return;
    removingRef.current = true;
    setRemoving(true);
    setTimeout(() => onRemove(course.id), 240);
  };

  return (
    <div
      onClick={() => onOpen(course.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={justAdded ? 'slide-up' : ''}
      style={{
        position: 'relative', background: hover ? 'var(--surface-2)' : 'var(--surface)',
        border: `1px solid ${hover ? 'var(--border-strong)' : 'var(--border)'}`,
        borderRadius: 10,
        padding: '12px 14px 12px 14px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 12,
        opacity: removing ? 0 : 1,
        transform: removing ? 'translateX(-8px)' : 'translateX(0)',
        transition: 'opacity 220ms, transform 220ms, border-color 140ms, background 140ms',
      }}
      title={course.name}
    >
      <span style={{
        width: 4, height: 26, flexShrink: 0,
        background: `var(--course-${course.area || 'other'})`,
        borderRadius: 2,
      }} />
      <span className="mono" style={{ fontSize: 14, fontWeight: 600, flexShrink: 0 }}>{course.id}</span>
      <span style={{
        flex: 1, minWidth: 0, fontSize: 14, color: 'var(--text)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {course.name}
      </span>
      {notOffered && (
        <span title="Not offered this semester" style={{ fontSize: 13, color: '#e6a817', flexShrink: 0, lineHeight: 1 }}>⚠</span>
      )}
      <span className="mono" style={{ fontSize: 12, color: 'var(--text-tertiary)', flexShrink: 0 }}>
        {course.units}u
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); requestRemove(); }}
        title="Remove from schedule"
        style={{
          width: 26, height: 26, padding: 0, borderRadius: 7,
          background: 'transparent', color: 'var(--text-tertiary)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          opacity: hover ? 1 : 0,
          transition: 'opacity 140ms, color 140ms',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
      >
        <Icon name="x" size={15} />
      </button>
    </div>
  );
};

// ============== Calendar mini-view ==============
const CAL_PALETTE = ['#4A8FE8','#E8704A','#7C4AE8','#E84A7A','#14B8A6','#F59E0B','#34D399','#E05252'];

const CAL_START = 8;   // 8 AM
const CAL_END   = 21;  // 9 PM
const CAL_PX    = 42;  // pixels per hour — 13h × 42px = 546px, fits without inner scroll

function parseAllMeetings(raw) {
  const toH24 = (h, m) => {
    const hour = parseInt(h, 10);
    const min  = m ? parseInt(m, 10) : 0;
    return (hour > 0 && hour < 8 ? hour + 12 : hour) + min / 60;
  };
  const parseTime = (s) => {
    // "2.30-4" or "10-11" → {start, end}
    const range = s.match(/^(\d+)(?:\.(\d+))?-(\d+)(?:\.(\d+))?$/);
    if (range) return { start: toH24(range[1], range[2]), end: toH24(range[3], range[4]) };
    // "10" → 10:00–11:00 (single-hour meeting)
    const single = s.match(/^(\d+)(?:\.(\d+))?$/);
    if (single) { const s2 = toH24(single[1], single[2]); return { start: s2, end: s2 + 1 }; }
    return null;
  };

  const results = [];
  const seen = new Set(); // deduplicate recitation sections with identical time/days

  String(raw || '').split(';').filter(Boolean).forEach((block) => {
    const parts = block.trim().split(',');
    if (parts.length < 2) return;
    const typeFull = parts[0].trim().toLowerCase();
    const shortType = typeFull.startsWith('lec') ? 'lec'
      : typeFull.startsWith('rec') ? 'rec'
      : typeFull.startsWith('lab') ? 'lab'
      : typeFull.slice(0, 3);

    parts.slice(1).forEach((seg) => {
      const segs = seg.trim().split('/');
      if (segs.length < 4) return;
      const room = segs[0].trim();
      const days = [...segs[1].trim()].filter((ch) => 'MTWRF'.includes(ch));
      if (!days.length) return;
      const t = parseTime(segs[3].trim());
      if (!t || t.end <= t.start) return;
      // Deduplicate per (type, days): students are in ONE section per day-group,
      // so show only the first recitation/lab section encountered for each day combination.
      const key = `${shortType}|${[...days].sort().join('')}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push({ shortType, room, days, start: t.start, end: t.end });
    });
  });
  return results;
}

// Parse all sections grouped by meeting type — returns { lec: [...], rec: [...] }
// Each entry is one section option; students pick ONE from each type.
function parseAllSectionsGrouped(raw) {
  const toH24 = (h, m) => {
    const hour = parseInt(h, 10), min = m ? parseInt(m, 10) : 0;
    return (hour > 0 && hour < 8 ? hour + 12 : hour) + min / 60;
  };
  const parseTime = (s) => {
    const r = s.match(/^(\d+)(?:\.(\d+))?-(\d+)(?:\.(\d+))?$/);
    if (r) return { start: toH24(r[1], r[2]), end: toH24(r[3], r[4]) };
    const m = s.match(/^(\d+)(?:\.(\d+))?$/);
    if (m) { const s2 = toH24(m[1], m[2]); return { start: s2, end: s2 + 1 }; }
    return null;
  };
  const grouped = {};
  String(raw || '').split(';').filter(Boolean).forEach((block) => {
    const parts = block.trim().split(',');
    if (parts.length < 2) return;
    const tf = parts[0].trim().toLowerCase();
    const type = tf.startsWith('lec') ? 'lec' : tf.startsWith('rec') ? 'rec' : tf.startsWith('lab') ? 'lab' : tf.slice(0, 3);
    if (!grouped[type]) grouped[type] = [];
    parts.slice(1).forEach((seg) => {
      const segs = seg.trim().split('/');
      if (segs.length < 4) return;
      const room = segs[0].trim();
      const days = [...segs[1].trim()].filter((ch) => 'MTWRF'.includes(ch));
      if (!days.length) return;
      const t = parseTime(segs[3].trim());
      if (!t || t.end <= t.start) return;
      grouped[type].push({ room, days, start: t.start, end: t.end });
    });
  });
  return grouped;
}

function timesOverlap(a, b) {
  return a.days.some((d) => b.days.includes(d)) && a.start < b.end - 0.01 && a.end > b.start + 0.01;
}

// Assign side-by-side column positions to overlapping blocks.
function layoutBlocks(blocks) {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end);
  const result = sorted.map((b) => ({ ...b, col: 0, numCols: 1 }));
  const colEnds = []; // colEnds[i] = end time of block currently occupying column i

  result.forEach((b) => {
    let col = 0;
    while (colEnds[col] !== undefined && colEnds[col] > b.start + 0.01) col++;
    b.col = col;
    colEnds[col] = b.end;
  });

  // numCols = width of the overlap group this block belongs to
  result.forEach((b) => {
    let maxCol = b.col;
    result.forEach((other) => {
      if (other !== b && other.start < b.end - 0.01 && other.end > b.start + 0.01) {
        maxCol = Math.max(maxCol, other.col);
      }
    });
    b.numCols = maxCol + 1;
  });

  return result;
}

function hourLabel(h) {
  if (h === 12) return 'noon';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

function compactTimeLabel(value) {
  const hour24 = Math.floor(value);
  const minutes = Math.round((value - hour24) * 60);
  const suffix = hour24 >= 12 ? 'p' : 'a';
  const hour = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
  return `${hour}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}${suffix}`;
}

function sectionTypeLabel(type) {
  if (type === 'lec') return 'Lecture';
  if (type === 'rec') return 'Recitation';
  if (type === 'lab') return 'Lab';
  return String(type || 'Section').toUpperCase();
}

function offeringBadgeLabel(season) {
  if (season === 'fall') return 'NO FALL';
  if (season === 'spring') return 'NO SPRING';
  if (season === 'iap') return 'NO IAP';
  if (season === 'summer') return 'NO SUMMER';
  return 'NOT OFFERED';
}

function offeringStatusLabel(season) {
  if (season === 'fall') return 'Not offered in Fall';
  if (season === 'spring') return 'Not offered in Spring';
  if (season === 'iap') return 'Not offered in IAP';
  if (season === 'summer') return 'Not offered in Summer';
  return 'Not offered this term';
}

function courseHasCalendarMeetings(course) {
  if (course.scheduleRaw) {
    return Object.values(parseAllSectionsGrouped(course.scheduleRaw)).some((options) => options.length > 0);
  }
  return Boolean(course.days && course.days.length && course.time && course.time.end > course.time.start);
}

const CalendarView = ({ courses, onOpenCourse, onRemoveCourse, activeSeason }) => {
  const days      = ['M', 'T', 'W', 'R', 'F'];
  const dayLabels = { M: 'MON', T: 'TUE', W: 'WED', R: 'THU', F: 'FRI' };
  const hours     = Array.from({ length: CAL_END - CAL_START }, (_, i) => CAL_START + i);
  const totalH    = (CAL_END - CAL_START) * CAL_PX;

  const colorOf = {};
  courses.forEach((c, i) => { colorOf[c.id] = CAL_PALETTE[i % CAL_PALETTE.length]; });

  // sectionMap: { courseId: { lec: idx, rec: idx, lab: idx } }
  const [sectionMap, setSectionMap] = useState({});
  const [selectedCourseId, setSelectedCourseId] = useState(null);

  // Auto-select non-conflicting section when courses change
  useEffect(() => {
    const map = {};
    const confirmed = []; // flat list of confirmed {days, start, end} meetings
    courses.forEach((c) => {
      if (!c.scheduleRaw) return;
      const grouped = parseAllSectionsGrouped(c.scheduleRaw);
      map[c.id] = {};
      Object.entries(grouped).forEach(([type, options]) => {
        const prev = sectionMap[c.id]?.[type];
        // Keep previous selection if course was already in schedule
        if (prev !== undefined && prev < options.length) {
          map[c.id][type] = prev;
        } else {
          // Auto-pick first option that doesn't conflict with confirmed meetings
          const idx = options.findIndex((opt) => !confirmed.some((m) => timesOverlap(opt, m)));
          map[c.id][type] = idx >= 0 ? idx : 0;
        }
        const sel = options[map[c.id][type]];
        if (sel) confirmed.push(sel);
      });
    });
    setSectionMap(map);
  }, [courses.map((c) => c.id).join('|')]);

  useEffect(() => {
    if (selectedCourseId && !courses.some((course) => course.id === selectedCourseId)) {
      setSelectedCourseId(null);
    }
  }, [courses.map((c) => c.id).join('|'), selectedCourseId]);

  const cycleSection = (courseId, type, delta) => {
    setSectionMap((prev) => {
      const grouped = parseAllSectionsGrouped(courses.find((c) => c.id === courseId)?.scheduleRaw || '');
      const options = grouped[type] || [];
      if (!options.length) return prev;
      const cur = (prev[courseId]?.[type] || 0);
      const next = (cur + delta + options.length) % options.length;
      return { ...prev, [courseId]: { ...(prev[courseId] || {}), [type]: next } };
    });
  };

  // Build flat block list using selected sections
  const allBlocks = courses.flatMap((c) => {
    if (c.scheduleRaw) {
      const grouped = parseAllSectionsGrouped(c.scheduleRaw);
      return Object.entries(grouped).flatMap(([type, options]) => {
        const idx = sectionMap[c.id]?.[type] ?? 0;
        const sel = options[idx];
        if (!sel) return [];
        return sel.days.map((d) => ({ ...sel, day: d, courseId: c.id, type, totalSections: options.length, sectionIdx: idx }));
      });
    }
    // Fallback for mock courses
    if (c.days && c.days.length && c.time && c.time.end > c.time.start) {
      return c.days.map((d) => ({ shortType: '', room: '', days: c.days, day: d, start: c.time.start, end: c.time.end, courseId: c.id, type: '', totalSections: 1, sectionIdx: 0 }));
    }
    return [];
  });

  const selectedCourse = courses.find((course) => course.id === selectedCourseId) || null;
  const selectedCourseNoSchedule = selectedCourse ? !courseHasCalendarMeetings(selectedCourse) : false;
  const selectedCourseNotOffered = selectedCourse && activeSeason && selectedCourse.offered && selectedCourse.offered[activeSeason] === false;

  const sectionControls = selectedCourse ? (() => {
    const course = selectedCourse;
    const grouped = course.scheduleRaw ? parseAllSectionsGrouped(course.scheduleRaw) : {};
    return Object.entries(grouped)
      .filter(([, options]) => options.length > 1)
      .map(([type, options]) => {
        const sectionIdx = sectionMap[course.id]?.[type] ?? 0;
        const selected = options[sectionIdx] || options[0];
        return { course, type, options, sectionIdx, selected };
      });
  })() : [];

  const TIME_COL = 52;

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
      overflow: 'hidden', fontFamily: 'var(--font-mono)', fontSize: 11,
      background: 'var(--surface)',
    }}>
      {/* Day header */}
      <div style={{
        display: 'grid', gridTemplateColumns: `${TIME_COL}px repeat(5, 1fr)`,
        borderBottom: '2px solid var(--border)', background: 'var(--bg)',
      }}>
        <div />
        {days.map((d) => (
          <div key={d} style={{
            textAlign: 'center', padding: '10px 0', fontSize: 11,
            fontWeight: 600, letterSpacing: '0.07em', color: 'var(--text-secondary)',
            borderLeft: '1px solid var(--border)',
          }}>
            {dayLabels[d]}
          </div>
        ))}
      </div>

      {/* Grid body — fixed height, no inner scroll */}
      <div style={{
        display: 'grid', gridTemplateColumns: `${TIME_COL}px repeat(5, 1fr)`,
        height: totalH, position: 'relative',
      }}>
          {/* Time label column */}
          <div style={{ position: 'relative', borderRight: '1px solid var(--border)' }}>
            {hours.map((h) => (
              <div key={h} style={{
                position: 'absolute', top: (h - CAL_START) * CAL_PX,
                right: 8, fontSize: 10, color: 'var(--text-tertiary)',
                transform: 'translateY(-50%)', textAlign: 'right', whiteSpace: 'nowrap',
                paddingTop: 1,
              }}>
                {hourLabel(h)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((d) => {
            const dayBlocks = layoutBlocks(allBlocks.filter((b) => b.day === d));
            return (
              <div key={d} style={{ position: 'relative', borderLeft: '1px solid var(--border)' }}>
                {hours.map((h) => (
                  <React.Fragment key={h}>
                    <div style={{ position: 'absolute', top: (h - CAL_START) * CAL_PX, left: 0, right: 0, borderTop: '1px solid var(--border)' }} />
                    <div style={{ position: 'absolute', top: (h - CAL_START + 0.5) * CAL_PX, left: 0, right: 0, borderTop: '1px dotted var(--border)', opacity: 0.5 }} />
                  </React.Fragment>
                ))}

                {dayBlocks.map((b, bi) => {
                  const top    = (b.start - CAL_START) * CAL_PX;
                  const height = (b.end - b.start) * CAL_PX - 2;
                  if (top < 0 || top >= totalH) return null;
                  const GAP = 2, pct = 100 / b.numCols;
                  const blockH = Math.max(14, Math.min(height, totalH - Math.max(0, top) - 2));
                  return (
                    <div key={b.courseId + b.type + bi} style={{
                      position: 'absolute',
                      top: Math.max(0, top) + 1,
                      left: `calc(${b.col * pct}% + ${GAP}px)`,
                      width: `calc(${pct}% - ${GAP * 2}px)`,
                      height: blockH,
                      background: colorOf[b.courseId],
                      borderRadius: 6, padding: '4px 6px',
                      color: '#fff', fontSize: 11, lineHeight: 1.3,
                      overflow: 'hidden', zIndex: 1,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                      display: 'flex', flexDirection: 'column',
                    }}>
                      <div style={{ fontWeight: 600, fontSize: 11 }}>
                        {b.courseId}{b.type ? <span style={{ fontWeight: 400, opacity: 0.85 }}> {b.type}</span> : null}
                      </div>
                      {b.room && <div style={{ opacity: 0.8, fontSize: 10 }}>{b.room}</div>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

      <div style={{
        borderTop: '1px solid var(--border)',
        background: 'var(--bg)',
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {courses.map((course) => {
            const selected = selectedCourseId === course.id;
            const noSchedule = !courseHasCalendarMeetings(course);
            const notOffered = activeSeason && course.offered && course.offered[activeSeason] === false;
            const statusBadges = [
              noSchedule ? 'NO TIME' : null,
              notOffered ? offeringBadgeLabel(activeSeason) : null,
            ].filter(Boolean);
            return (
              <button
                key={course.id}
                onClick={() => setSelectedCourseId((current) => (current === course.id ? null : course.id))}
                title={course.name}
                style={{
                  minWidth: 0,
                  maxWidth: 170,
                  padding: '7px 10px',
                  borderRadius: 7,
                  background: colorOf[course.id],
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 12,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  boxShadow: selected ? `0 0 0 2px var(--surface), 0 0 0 4px ${colorOf[course.id]}` : '0 1px 2px rgba(0,0,0,0.12)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{course.id}</span>
                {statusBadges.map((badge) => (
                  <span
                    key={badge}
                    className="mono"
                    style={{
                      padding: '1px 4px',
                      borderRadius: 5,
                      background: 'rgba(255,255,255,0.24)',
                      fontSize: 8.5,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {badge}
                  </span>
                ))}
              </button>
            );
          })}
        </div>

        {selectedCourse && (
          <div style={{
            border: '1px solid var(--border)',
            borderRadius: 10,
            background: 'var(--surface)',
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: colorOf[selectedCourse.id], flexShrink: 0 }} />
                  <span className="mono" style={{ fontWeight: 800, fontSize: 12 }}>{selectedCourse.id}</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedCourse.name}
                  </span>
                </div>
                {(selectedCourseNoSchedule || selectedCourseNotOffered) && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
                    {selectedCourseNoSchedule && (
                      <span className="mono" style={{ fontSize: 9.5, color: 'var(--warning)' }}>Schedule not published</span>
                    )}
                    {selectedCourseNotOffered && (
                      <span className="mono" style={{ fontSize: 9.5, color: 'var(--warning)' }}>{offeringStatusLabel(activeSeason)}</span>
                    )}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => typeof onOpenCourse === 'function' && onOpenCourse(selectedCourse.id)}
                  style={{ padding: '6px 9px', borderRadius: 7, border: '1px solid var(--border)', fontSize: 11 }}
                >
                  View Details
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => typeof onRemoveCourse === 'function' && onRemoveCourse(selectedCourse.id)}
                  style={{ padding: '6px 9px', borderRadius: 7, border: '1px solid var(--border)', color: 'var(--accent)', fontSize: 11 }}
                >
                  Remove
                </button>
              </div>
            </div>

            {sectionControls.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sectionControls.map(({ course, type, options, sectionIdx, selected }) => (
                  <div
                    key={`${course.id}-${type}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) auto',
                      alignItems: 'center',
                      gap: 8,
                      padding: '7px 8px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 999, background: colorOf[course.id], flexShrink: 0 }} />
                        <span className="mono" style={{ fontWeight: 700, fontSize: 11 }}>{course.id}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {sectionTypeLabel(type)}
                        </span>
                      </div>
                      <div className="mono" style={{ marginTop: 2, color: 'var(--text-tertiary)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {selected.days.join('')} {compactTimeLabel(selected.start)}-{compactTimeLabel(selected.end)}{selected.room ? ` · ${selected.room}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); cycleSection(course.id, type, -1); }}
                        title={`Previous ${sectionTypeLabel(type).toLowerCase()}`}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 7,
                          border: '1px solid var(--border)',
                          background: 'var(--bg)',
                          color: 'var(--text-secondary)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Icon name="arrowLeft" size={12} />
                      </button>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 34, textAlign: 'center' }}>
                        {sectionIdx + 1}/{options.length}
                      </span>
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); cycleSection(course.id, type, 1); }}
                        title={`Next ${sectionTypeLabel(type).toLowerCase()}`}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 7,
                          border: '1px solid var(--border)',
                          background: 'var(--bg)',
                          color: 'var(--text-secondary)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Icon name="arrowRight" size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mono" style={{ padding: '8px 9px', borderRadius: 8, background: 'var(--bg)', color: 'var(--text-tertiary)', fontSize: 10.5 }}>
                No selectable recitation or lab sections.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const courseWorkloadLabel = (course) => {
  const parts = [];
  if (Number(course.units)) parts.push(`${course.units} units`);
  if (Number(course.hydrant)) parts.push(`~${Number(course.hydrant).toFixed(1)}h/wk`);
  return parts.join(' · ') || 'Units TBD';
};

const semSeason = (semId) => {
  if (!semId) return null;
  if (semId.startsWith('IAP')) return 'iap';
  if (semId.startsWith('SU')) return 'summer';
  if (semId.startsWith('F')) return 'fall';
  if (semId.startsWith('S')) return 'spring';
  return null;
};

const ManualCourseSearch = ({ schedule, onAddCourse, onOpenCourse, onCoursesLoaded }) => {
  const { activeSem } = useApp();
  const season = semSeason(activeSem);
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
          const notOffered = season && course.offered && course.offered[season] === false;
          const addDisabled = isAdded || notOffered;
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
                  {notOffered && (
                    <span
                      title={`Not offered in ${activeSem}`}
                      style={{ flexShrink: 0, fontSize: 13, color: '#e6a817', lineHeight: 1 }}
                    >⚠</span>
                  )}
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
                  disabled={addDisabled}
                  title={notOffered ? `Not offered in ${activeSem}` : undefined}
                  style={{
                    fontSize: 11, padding: '6px 9px', borderRadius: 6,
                    background: addDisabled ? 'var(--surface-2)' : 'var(--accent)',
                    color: addDisabled ? 'var(--text-tertiary)' : '#fff',
                    opacity: addDisabled ? 0.65 : 1,
                    cursor: addDisabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isAdded ? 'Added' : (notOffered ? 'Not offered' : 'Add')}
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
const SchedulePanel = ({ schedule, setSchedule, justAddedId, onOpenCourse, onAddCourse, onRemoveCourse, viewMode, setViewMode, planningTermLabel = 'Next Semester', hideRequirements = false, compact = false }) => {
  const { activeSem } = useApp();
  const activeSeason = semSeason(activeSem);
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
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 10, overflow: 'hidden' }}>
            <span className="display" style={{
              fontSize: 18, fontWeight: 600, color: 'var(--text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {planningTermLabel}
            </span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-tertiary)', flexShrink: 0 }}>
              {courses.length} {courses.length === 1 ? 'course' : 'courses'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {courses.length > 0 && (
              <button
                onClick={() => exportToICS(courses)}
                className="btn-ghost"
                title="Export schedule to .ics"
                style={{
                  width: 26, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 6, border: '1px solid var(--border)', color: 'var(--text-secondary)',
                }}
              >
                <Icon name="download" size={13} />
              </button>
            )}
            <div style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
              {[['list', 'list'], ['cal', 'grid']].map(([k, ic]) => (
                <button key={k} onClick={() => setViewMode(k)} title={k === 'list' ? 'List' : 'Calendar'}
                  style={{
                    width: 22, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 5, background: viewMode === k ? 'var(--bg)' : 'transparent',
                    color: viewMode === k ? 'var(--text)' : 'var(--text-tertiary)',
                    border: viewMode === k ? '1px solid var(--border)' : '1px solid transparent',
                  }}
                >
                  <Icon name={ic} size={12} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
        {courses.length === 0 ? (
          <div style={{
            border: '1.5px dashed var(--border-strong)', borderRadius: 'var(--r-md)',
            padding: '32px 16px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Your schedule is empty</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.6 }}>
              Add courses from the agent panel,<br/>or use the manual search below.
            </div>
          </div>
        ) : viewMode === 'list' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {courses.map((c) => (
              <ScheduleCard
                key={c.id}
                course={c}
                onRemove={removeCourse}
                onOpen={onOpenCourse}
                justAdded={justAddedId === c.id}
                notOffered={activeSeason && c.offered && c.offered[activeSeason] === false}
              />
            ))}
          </div>
        ) : (
          <CalendarView courses={courses} onOpenCourse={onOpenCourse} onRemoveCourse={removeCourse} activeSeason={activeSeason} />
        )}

        <button
          className="btn"
          onClick={() => { setShowCoursePicker(v => !v); }}
          style={{
            width: '100%', marginTop: 10, padding: '8px',
            border: '1px dashed var(--border-strong)', background: 'transparent',
            color: 'var(--text-tertiary)', fontSize: 12,
          }}
        >
          <Icon name="plus" size={12} /> Add course
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
      {!hideRequirements ? (
        <div style={{ borderTop: '1px solid var(--border)', padding: '14px 20px', background: 'var(--bg)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span className="eyebrow">This semester</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--text)' }}>{totalUnits}</span> units
            </span>
          </div>
          <RequirementsPanel schedule={schedule} />
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--border)', padding: '8px 16px', background: 'var(--bg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="eyebrow" style={{ fontSize: 10 }}>This semester</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--text)' }}>{totalUnits}</span> units
          </span>
        </div>
      )}
    </div>
  );
};

// ============== Requirements panel ==============
const CourseTag = ({ id, satisfied }) => (
  <span className="mono" style={{
    fontSize: 10, padding: '1px 5px', borderRadius: 4,
    background: satisfied ? 'var(--success-soft, rgba(34,197,94,0.12))' : 'var(--surface-2)',
    color: satisfied ? 'var(--success)' : 'var(--text-secondary)',
    border: `1px solid ${satisfied ? 'var(--success)' : 'var(--border)'}`,
  }}>{id}</span>
);

const ReqRow = ({ group, depth = 0, expanded, toggle }) => {
  const isOpen = !!expanded[depth + ':' + group.id];
  const hasChildren = group.subGroups && group.subGroups.length > 0;
  const hasDetail = group.satisfied
    ? (group.matched && group.matched.length > 0)
    : (!hasChildren);
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
        {(hasChildren || hasDetail) && (
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


      {isOpen && !hasChildren && (
        <div style={{ paddingLeft: indent + 21, paddingBottom: 6, paddingTop: 2, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {group.matched && group.matched.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: fontSize - 1, color: 'var(--text-tertiary)', marginRight: 2 }}>
                {group.satisfied ? 'Satisfied by:' : 'Counts toward:'}
              </span>
              {group.matched.map(id => <CourseTag key={id} id={id} satisfied />)}
            </div>
          )}
          {!group.satisfied && (
            <div style={{ fontSize: fontSize - 1, color: 'var(--text-tertiary)' }}>
              {group.isManual
                ? <span style={{ color: 'var(--warning)' }}>Requires advisor verification</span>
                : group.unmet.length > 0
                  ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                      <span style={{ marginRight: 2 }}>Still needed:</span>
                      {group.unmet.map(id => <CourseTag key={id} id={id} satisfied={false} />)}
                    </div>
                  : null}
            </div>
          )}
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

const toMajorKey = (major) => (major
  ? major.replace(/^course\s+/i, '').trim().toLowerCase().replace(/[:\s].*/, '')
  : null);

const MajorRequirementSection = ({ majorKey, allCourses, expanded, toggle }) => {
  const { result, loading } = useReqCheck(majorKey, allCourses);
  if (loading && !result) {
    return <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '8px 0' }}>Checking requirements…</div>;
  }
  if (!result) return null;
  const pct = result.totalCount > 0 ? Math.round(result.satisfiedCount / result.totalCount * 100) : 0;
  const barCls = pct === 100 ? 'green' : pct >= 60 ? 'orange' : 'yellow';
  const namespace = `${majorKey}:`;
  return (
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
        {result.groups.map((group) => (
          <ReqRow
            key={namespace + group.id}
            group={{ ...group, id: namespace + group.id }}
            depth={0}
            expanded={expanded}
            toggle={toggle}
          />
        ))}
      </div>
    </>
  );
};

const RequirementsPanel = ({ schedule }) => {
  const { profile } = useApp();
  const [expanded, setExpanded] = useState({});

  const taken = (profile && profile.taken) || [];
  const allCourses = [...new Set([...taken, ...schedule])];
  const toggle = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const majorKey = toMajorKey(profile && profile.major);
  const major2Key = toMajorKey(profile && profile.major2);

  if (!majorKey && !major2Key) {
    return <GirPanel allCourses={allCourses} />;
  }

  return (
    <div>
      {majorKey && (
        <MajorRequirementSection
          majorKey={majorKey}
          allCourses={allCourses}
          expanded={expanded}
          toggle={toggle}
        />
      )}
      {major2Key && (
        <div style={{ marginTop: majorKey ? 18 : 0, paddingTop: majorKey ? 14 : 0, borderTop: majorKey ? '1px solid var(--border)' : 'none' }}>
          <MajorRequirementSection
            majorKey={major2Key}
            allCourses={allCourses}
            expanded={expanded}
            toggle={toggle}
          />
        </div>
      )}
      <GirPanel allCourses={allCourses} />
    </div>
  );
};

window.SchedulePanel = SchedulePanel;
window.RequirementsPanel = RequirementsPanel;

// ============== 4-Year Plan page ==============
const FourYearPlanPage = () => {
  const { fourYearPlan, activeSem, setActiveSem, setRoute, profile, personalCourseMarkdown } = useApp();
  const semOrder  = FRDATA.semesterOrder || [];
  const semLabels = FRDATA.semesterLabels || {};
  const personalSummary = PersonalCourse.summarize(personalCourseMarkdown || '');
  const priorCredits = personalSummary.priorCreditCourses || [];
  const excludedCredits = [...(personalSummary.listenerCourses || []), ...(personalSummary.droppedCourses || [])];

  const totalCourses = Object.values(fourYearPlan).flat().length;

  const [courseMap, setCourseMap] = useState(() =>
    Object.fromEntries(FRDATA.catalog.map((c) => [c.id, c]))
  );

  useEffect(() => {
    const allIds = [...new Set(Object.values(fourYearPlan).flat())];
    if (!allIds.length) return;
    Promise.all(allIds.map((id) => FRDATA.fetchCurrentCourse(id))).then((results) => {
      const entries = {};
      results.forEach((c) => { if (c) entries[c.id] = c; });
      if (Object.keys(entries).length) setCourseMap((prev) => ({ ...prev, ...entries }));
    }).catch(() => {});
  }, [fourYearPlan]);

  const goPlanning = (sem) => { setActiveSem(sem); setRoute({ name: 'planner' }); };
  const openCourse = (id) => setRoute({ name: 'course', id });

  // Build year rows anchored to matriculation year when available, otherwise first 4 falls
  const matricYear = profile.matriculationYear ? parseInt(profile.matriculationYear, 10) : null;
  const falls = (() => {
    if (matricYear) {
      return [0, 1, 2, 3].map((n) => `F${String((matricYear + n) % 100).padStart(2, '0')}`);
    }
    return semOrder.filter((s) => s.startsWith('F')).slice(0, 4);
  })();
  const yearRows = falls.map((fall) => {
    const yy = parseInt(fall.slice(1), 10);
    const nextYY = String((yy + 1) % 100).padStart(2, '0');
    return { fall, iap: `IAP${nextYY}`, spring: `S${nextYY}` };
  });

  const SemCol = ({ sem, isIAP = false }) => {
    const courseIds = fourYearPlan[sem] || [];
    const courses   = courseIds.map((id) => courseMap[id] || FRDATA.getCourse(id)).filter(Boolean);
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

        <button
          onClick={() => setRoute({ name: 'priorcredit' })}
          style={{
            width: '100%',
            marginBottom: 18,
            padding: '14px 16px',
            borderRadius: 'var(--r-md)',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            textAlign: 'left',
          }}
        >
          <span>
            <span className="display" style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>Prior Credit</span>
            <span style={{ display: 'block', marginTop: 3, fontSize: 12, color: 'var(--text-secondary)' }}>
              {priorCredits.length} requirement-counting credits outside semester plans
              {excludedCredits.length ? ` · ${excludedCredits.length} listener/dropped entries excluded` : ''}
            </span>
          </span>
          <span className="mono" style={{ color: 'var(--accent)', fontSize: 12 }}>Open →</span>
        </button>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '4fr 2fr 4fr', gap: 12, marginBottom: 8 }}>
          {['Fall', 'January Term', 'Spring'].map((label) => (
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

// ============== Prior Credit page ==============
const PriorCreditPage = () => {
  const { personalCourseMarkdown, setRoute, profile } = useApp();
  const summary = PersonalCourse.summarize(personalCourseMarkdown || '');
  const priorCredits = summary.priorCreditCourses || [];
  const excluded = [...(summary.listenerCourses || []), ...(summary.droppedCourses || [])];

  const CreditTable = ({ title, subtitle, rows, empty }) => (
    <div style={{ marginBottom: 28 }}>
      <div style={{ marginBottom: 12 }}>
        <h2 className="display" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h2>
        <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 3 }}>{subtitle}</div>
      </div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden', background: 'var(--surface)' }}>
        <div className="mono" style={{
          display: 'grid',
          gridTemplateColumns: '1fr 2.2fr 1fr 1.2fr 1.4fr',
          gap: 12,
          padding: '10px 14px',
          background: 'var(--surface-2)',
          color: 'var(--text-tertiary)',
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          <span>Course</span>
          <span>Title</span>
          <span>Grade</span>
          <span>Term</span>
          <span>Status</span>
        </div>
        {rows.length ? rows.map((course) => (
          <div key={`${course.status}-${course.id}-${course.term}-${course.grade}`} style={{
            display: 'grid',
            gridTemplateColumns: '1fr 2.2fr 1fr 1.2fr 1.4fr',
            gap: 12,
            padding: '12px 14px',
            borderTop: '1px solid var(--border)',
            alignItems: 'center',
            fontSize: 13,
          }}>
            <span className="mono" style={{ fontWeight: 600 }}>{course.id}</span>
            <span style={{ color: 'var(--text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{course.name || 'Untitled course'}</span>
            <span className="mono" style={{ color: 'var(--text)' }}>{course.grade || '-'}</span>
            <span style={{ color: 'var(--text-secondary)' }}>{course.term || '-'}</span>
            <span style={{ color: 'var(--text-secondary)' }}>
              {course.status === 'prior_credit' ? 'Prior credit' : course.status === 'listener' ? 'Listener' : 'Dropped'}
            </span>
          </div>
        )) : (
          <div style={{ padding: 22, color: 'var(--text-tertiary)', fontSize: 13 }}>{empty}</div>
        )}
      </div>
    </div>
  );

  return (
    <div className="fade-in" style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <TopBar showTabs={false} />

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '36px 32px 72px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <h1 className="display" style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Prior Credit</h1>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
              {profile?.name ? `${profile.name} · ` : ''}{priorCredits.length} requirement-counting prior credits
            </div>
          </div>
          <button className="btn" onClick={() => setRoute({ name: 'planner' })} style={{ fontSize: 13, padding: '8px 16px' }}>
            ← Back to planner
          </button>
        </div>

        <CreditTable
          title="Requirement-counting prior credit"
          subtitle="Transfer credit marked S and ASE/advanced standing grades ending in & count toward requirements, but do not appear in any semester."
          rows={priorCredits}
          empty="No transfer credit or ASE credit found in personal_course.md."
        />
        <CreditTable
          title="Excluded transcript entries"
          subtitle="Listener (LIS) and dropped (DR) entries are kept visible here, but do not count toward requirements or semester plans."
          rows={excluded}
          empty="No listener or dropped transcript entries found."
        />
      </div>
    </div>
  );
};

window.PriorCreditPage = PriorCreditPage;
