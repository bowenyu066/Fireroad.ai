/* global React, ReactDOM, FRDATA, FRAuth, PersonalCourse, AuthGate, Onboarding, ProfilePage, TopBar, SchedulePanel, RequirementsPanel, FourYearPlanPage, AgentPanel, Recommendations, CourseDetail, AppCtx */
const { useState, useEffect, useRef, useCallback } = React;

// ============== Draggable column resizer ==============
// Designed to sit inside a CSS grid column of fixed 8px width — no
// negative margins, no flex-basis tricks. The mousedown handler captures
// drag start; the mousemove listener is attached once and reads the
// latest onDrag from a ref so re-renders don't churn listeners.
const ColumnResizer = ({ onDrag }) => {
  const draggingRef = useRef(false);
  const lastXRef = useRef(0);
  const onDragRef = useRef(onDrag);
  const [active, setActive] = useState(false);
  const [hover, setHover] = useState(false);

  useEffect(() => { onDragRef.current = onDrag; }, [onDrag]);

  useEffect(() => {
    const handleMove = (event) => {
      if (!draggingRef.current) return;
      const delta = event.clientX - lastXRef.current;
      lastXRef.current = event.clientX;
      if (delta !== 0) onDragRef.current(delta);
    };
    const handleUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setActive(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  const handleMouseDown = (event) => {
    event.preventDefault();
    draggingRef.current = true;
    lastXRef.current = event.clientX;
    setActive(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const highlight = active || hover;

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        height: '100%',
        cursor: 'col-resize',
        position: 'relative',
        background: 'transparent',
        zIndex: 5,
      }}
      title="Drag to resize"
    >
      <div style={{
        position: 'absolute', top: 0, bottom: 0, left: '50%',
        transform: `translateX(-50%)`,
        width: highlight ? 2 : 1,
        background: highlight ? 'var(--accent)' : 'var(--border)',
        transition: 'background 120ms, width 120ms',
        pointerEvents: 'none',
      }} />
    </div>
  );
};

// Floating toast for transient feedback
const Toast = ({ notification, onClose }) => {
  useEffect(() => {
    if (!notification) return undefined;
    const timer = setTimeout(onClose, notification.duration || 4500);
    return () => clearTimeout(timer);
  }, [notification, onClose]);

  if (!notification) return null;
  const tone = notification.tone || 'success';
  const palette = {
    success: { bg: 'var(--success)', fg: '#fff' },
    error:   { bg: 'var(--accent)', fg: '#fff' },
    info:    { bg: 'var(--info)', fg: '#fff' },
  }[tone] || { bg: 'var(--surface)', fg: 'var(--text)' };

  return (
    <div style={{
      position: 'fixed', top: 80, right: 24, zIndex: 300,
      maxWidth: 420, padding: '12px 16px', borderRadius: 10,
      background: palette.bg, color: palette.fg,
      boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
      display: 'flex', alignItems: 'flex-start', gap: 12,
      fontSize: 14, lineHeight: 1.45,
    }}>
      <div style={{ flex: 1 }}>
        {notification.title && (
          <div style={{ fontWeight: 600, marginBottom: notification.detail ? 4 : 0 }}>
            {notification.title}
          </div>
        )}
        {notification.detail && <div style={{ opacity: 0.92 }}>{notification.detail}</div>}
      </div>
      <button
        onClick={onClose}
        style={{ color: palette.fg, opacity: 0.8, padding: 2, fontSize: 18, lineHeight: 1 }}
        title="Dismiss"
      >
        ×
      </button>
    </div>
  );
};

// Section panel header, also resizable for requirements column
const SectionHeader = ({ label, right }) => (
  <div style={{
    padding: '16px 20px', borderBottom: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 56, boxSizing: 'border-box', flexShrink: 0,
  }}>
    <div className="eyebrow">{label}</div>
    {right || null}
  </div>
);

const semesterSeason = (semId) => {
  const value = String(semId || '').toUpperCase();
  if (value.startsWith('IAP')) return 'iap';
  if (value.startsWith('SU')) return 'summer';
  if (value.startsWith('F')) return 'fall';
  if (value.startsWith('S')) return 'spring';
  return null;
};

const isOfferedInSemester = (course, semId) => {
  const season = semesterSeason(semId);
  return !season || !course?.offered || course.offered[season] !== false;
};

const Planner = ({ schedule, setSchedule, messages, setMessages, planningTermLabel }) => {
  const { setRoute, profile, setProfile, fourYearPlan, setFourYearPlan, activeSem } = React.useContext(AppCtx);
  const [justAddedId, setJustAddedId] = useState(null);
  const [viewMode, setViewMode] = useState('list');
  const courseCatalogLink = (id) => {
    const courseId = String(id || '').trim().toUpperCase();
    return courseId ? `[${courseId}](catalog/${courseId})` : 'course';
  };

  const onAddCourse = async (id) => {
    const courseId = String(id || '').trim().toUpperCase();
    if (!courseId || schedule.map((course) => String(course).toUpperCase()).includes(courseId)) return;
    const c = await FRDATA.fetchCurrentCourse(courseId);
    if (!c) return;
    if (!isOfferedInSemester(c, activeSem)) {
      setMessages((m) => [...m, {
        role: 'agent',
        text: `${c.id} (${c.name}) is not offered in ${planningTermLabel}, so I did not add it to your plan.`,
      }]);
      return;
    }
    setSchedule((s) => [...s, courseId]);
    setJustAddedId(courseId);
    setTimeout(() => setJustAddedId(null), 800);
    setMessages((m) => [...m, {
      role: 'agent',
      text: `Added ${courseCatalogLink(c.id)} (${c.name}) to ${planningTermLabel}.`,
    }]);
  };

  const onRemoveCourse = async (id) => {
    const courseId = String(id || '').trim().toUpperCase();
    if (!schedule.includes(courseId)) return;
    const c = await FRDATA.fetchCurrentCourse(courseId) || FRDATA.getCourse(courseId) || { id: courseId, name: courseId };
    setSchedule((s) => s.filter((x) => x !== courseId));
    setMessages((m) => [...m, {
      role: 'agent',
      text: `Removed ${courseCatalogLink(c.id)} (${c.name}) from ${planningTermLabel}.`,
    }]);
  };

  const nextScheduleForUiActions = (current, actions, blockedCourseIds = new Set()) => {
    let next = [...current];
    actions.forEach((action) => {
      const courseId = String(action.courseId || '').trim().toUpperCase();
      const removeCourseId = String(action.removeCourseId || '').trim().toUpperCase();
      if (!courseId && action.type !== 'replace_course') return;

      if (action.type === 'add_course' && !blockedCourseIds.has(courseId) && !next.includes(courseId)) {
        next = [...next, courseId];
      }

      if (action.type === 'remove_course') {
        next = next.filter((id) => id !== courseId);
      }

      if (action.type === 'replace_course' && removeCourseId && courseId) {
        if (blockedCourseIds.has(courseId)) return;
        next = next.filter((id) => id !== removeCourseId);
        if (!next.includes(courseId)) next = [...next, courseId];
      }
    });
    return next;
  };

  const undoScheduleForUiActions = (current, actions, previousSchedule) => {
    const before = new Set(previousSchedule.map((id) => String(id).toUpperCase()));
    let next = [...current];

    [...actions].reverse().forEach((action) => {
      const courseId = String(action.courseId || '').trim().toUpperCase();
      const removeCourseId = String(action.removeCourseId || '').trim().toUpperCase();

      if (action.type === 'add_course' && courseId && !before.has(courseId)) {
        next = next.filter((id) => String(id).toUpperCase() !== courseId);
      }

      if (action.type === 'remove_course' && courseId && before.has(courseId) && !next.map((id) => String(id).toUpperCase()).includes(courseId)) {
        next = [...next, courseId];
      }

      if (action.type === 'replace_course' && courseId && removeCourseId) {
        if (!before.has(courseId)) {
          next = next.filter((id) => String(id).toUpperCase() !== courseId);
        }
        if (before.has(removeCourseId) && !next.map((id) => String(id).toUpperCase()).includes(removeCourseId)) {
          next = [...next, removeCourseId];
        }
      }
    });

    return [
      ...previousSchedule.filter((id) => next.map((courseId) => String(courseId).toUpperCase()).includes(String(id).toUpperCase())),
      ...next.filter((id) => !previousSchedule.map((courseId) => String(courseId).toUpperCase()).includes(String(id).toUpperCase())),
    ];
  };

  const applyUiActions = async (actions) => {
    if (!Array.isArray(actions) || actions.length === 0) return null;

    const previousSchedule = [...schedule];
    const previousProfile = profile;
    const previousFourYearPlan = fourYearPlan;
    const addCourseIds = [...new Set(actions
      .filter((action) => action.type === 'add_course' || action.type === 'replace_course')
      .map((action) => String(action.courseId || '').trim().toUpperCase())
      .filter(Boolean))];
    const coursesById = new Map((await Promise.all(addCourseIds.map(async (courseId) => {
      const course = await FRDATA.fetchCurrentCourse(courseId).catch(() => null);
      return [courseId, course];
    }))).filter(([, course]) => course));
    const blockedCourseIds = new Set(addCourseIds.filter((courseId) => !isOfferedInSemester(coursesById.get(courseId), activeSem)));
    const addActions = actions.filter((action) => action.type === 'add_course' || action.type === 'replace_course');
    const lastAdded = addActions.map((action) => String(action.courseId || '').trim().toUpperCase()).filter((courseId) => !blockedCourseIds.has(courseId)).pop() || null;

    setSchedule((current) => nextScheduleForUiActions(current, actions, blockedCourseIds));
    setProfile((currentProfile) => {
      let nextTaken = [...(currentProfile.taken || [])].map((id) => String(id).toUpperCase());
      actions.forEach((action) => {
        const courseId = String(action.courseId || '').trim().toUpperCase();
        if (!courseId) return;
        if ((action.type === 'add_completed_course' || action.type === 'add_historical_course') && !nextTaken.includes(courseId)) {
          nextTaken = [...nextTaken, courseId];
        }
        if (action.type === 'remove_completed_course') {
          nextTaken = nextTaken.filter((id) => id !== courseId);
        }
      });
      return { ...currentProfile, taken: nextTaken };
    });
    setFourYearPlan((currentPlan) => {
      let nextPlan = { ...currentPlan };
      actions.forEach((action) => {
        const type = String(action.type || '');
        const courseId = String(action.courseId || '').trim().toUpperCase();
        const termId = String(action.termId || action.term_id || '').trim().toUpperCase();
        if (!courseId || !termId || termId === activeSem) return;
        const termCourses = Array.isArray(nextPlan[termId]) ? [...nextPlan[termId]] : [];
        if (type === 'add_historical_course' && !termCourses.includes(courseId)) {
          nextPlan = { ...nextPlan, [termId]: [...termCourses, courseId] };
        }
        if (type === 'remove_historical_course') {
          nextPlan = { ...nextPlan, [termId]: termCourses.filter((id) => String(id).toUpperCase() !== courseId) };
        }
      });
      return nextPlan;
    });

    if (lastAdded) {
      setJustAddedId(lastAdded);
      setTimeout(() => setJustAddedId(null), 800);
    }

    if (blockedCourseIds.size) {
      setMessages((m) => [...m, {
        role: 'agent',
        text: `I skipped ${[...blockedCourseIds].join(', ')} because ${blockedCourseIds.size === 1 ? 'it is' : 'they are'} not offered in ${planningTermLabel}.`,
      }]);
    }

    return () => {
      setSchedule((current) => undoScheduleForUiActions(current, actions, previousSchedule));
      setProfile(previousProfile);
      setFourYearPlan(previousFourYearPlan);
      setJustAddedId(null);
    };
  };

  const onOpenCourse = (id) => setRoute({ name: 'course', id });

  const containerRef = useRef(null);
  const STORAGE_KEY = 'fr-planner-pane-pixels-v1';
  const DEFAULTS = { leftPx: 360, middlePx: 380 };
  const MIN_PX = 60;
  const RESIZER_PX = 8;

  const [paneWidths, setPaneWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && typeof saved.leftPx === 'number' && typeof saved.middlePx === 'number') return saved;
    } catch (_) {}
    return DEFAULTS;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(paneWidths));
  }, [paneWidths]);

  // Each boundary only moves its two adjacent panes:
  //   left-middle  → adjusts leftPx and middlePx; right (1fr) is untouched.
  //   middle-right → adjusts middlePx only; right (1fr) absorbs the change.
  const adjustWidth = useCallback((boundary, deltaPx) => {
    setPaneWidths((current) => {
      const total = containerRef.current ? containerRef.current.clientWidth : 1200;
      if (boundary === 'left-middle') {
        const sum = current.leftPx + current.middlePx;
        const newLeft = Math.max(MIN_PX, Math.min(sum - MIN_PX, current.leftPx + deltaPx));
        return { leftPx: newLeft, middlePx: sum - newLeft };
      }
      if (boundary === 'middle-right') {
        const maxMiddle = Math.max(MIN_PX, total - current.leftPx - 2 * RESIZER_PX - MIN_PX);
        const newMiddle = Math.max(MIN_PX, Math.min(maxMiddle, current.middlePx + deltaPx));
        return { leftPx: current.leftPx, middlePx: newMiddle };
      }
      return current;
    });
  }, []);

  const gridTemplate = `${paneWidths.leftPx}px ${RESIZER_PX}px ${paneWidths.middlePx}px ${RESIZER_PX}px minmax(${MIN_PX}px, 1fr)`;

  return (
    <div className="fade-in" style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar planningTermLabel={planningTermLabel} />

      <div
        ref={containerRef}
        style={{
          flex: '1 1 0',
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: gridTemplate,
          gridTemplateRows: 'minmax(0, 1fr)',
          overflow: 'hidden',
        }}
      >
        {/* LEFT — schedule (course cards only) */}
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <SchedulePanel
            schedule={schedule} setSchedule={setSchedule}
            justAddedId={justAddedId} onOpenCourse={onOpenCourse}
            onAddCourse={onAddCourse} onRemoveCourse={onRemoveCourse}
            viewMode={viewMode} setViewMode={setViewMode}
            planningTermLabel={planningTermLabel}
            hideRequirements
          />
        </div>

        <ColumnResizer onDrag={(delta) => adjustWidth('left-middle', delta)} />

        {/* MIDDLE — course requirements */}
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <SectionHeader label="Course requirements" />
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', background: 'var(--bg)' }}>
            <RequirementsPanel schedule={schedule} />
          </div>
        </div>

        <ColumnResizer onDrag={(delta) => adjustWidth('middle-right', delta)} />

        {/* RIGHT — agent */}
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <AgentPanel
            messages={messages} setMessages={setMessages}
            profile={profile} schedule={schedule}
            onAddCourse={onAddCourse} onRemoveCourse={onRemoveCourse} onOpenCourse={onOpenCourse}
            onApplyUiActions={applyUiActions}
          />
        </div>

        {/*
          Recommendations panel hidden per product decision (kept for future use):
          <Recommendations schedule={schedule} onAddCourse={onAddCourse} onRemoveCourse={onRemoveCourse} onOpenCourse={onOpenCourse} />
        */}
      </div>
    </div>
  );
};

const App = () => {
  const PLAN_DRAFT_KEY = 'fr-fouryear-plan-draft-v1';
  const CHAT_HISTORY_KEY = 'fr-agent-chat-history-v1';
  const MAX_CHAT_HISTORY_MESSAGES = 40;
  const freshProfile = () => ({
    name: '',
    kerberos: '',
    major: '',
    majorLabel: '',
    major2: '',
    major2Label: '',
    year: '',
    gradYear: '',
    taken: [],
    calibration: 1,
    preferences: {},
    remainingReqs: [],
  });
  const personalizeAgentMessages = (nextProfile) => {
    const firstName = String(nextProfile?.name || 'there').trim().split(/\s+/)[0] || 'there';
    return [{
      role: 'agent',
      text: `Hi ${firstName}. I can use your saved course history and preferences to help plan this active semester. Ask me for recommendations, workload checks, or course tradeoffs.`,
      suggestions: [],
    }];
  };
  const emptyFourYearPlan = () => Object.fromEntries((FRDATA.semesterOrder || []).map((id) => [id, []]));
  const mergePlanWithMarkdown = (plan, markdown) => {
    const parsedCourses = PersonalCourse.parseCourseRows(markdown || '');
    const completedPlan = PersonalCourse.planFromCompletedCourses(markdown || '');
    const completedCourseIdsWithKnownTerm = new Set(parsedCourses
      .filter((course) => course.status === 'completed' && PersonalCourse.termIdFromLabel(course.term))
      .map((course) => course.id));
    const priorCreditCourseIds = new Set(parsedCourses
      .filter((course) => course.status === 'prior_credit')
      .map((course) => course.id));
    const next = Object.fromEntries(Object.entries(plan || {}).map(([termId, courseIds]) => [
      termId,
      Array.isArray(courseIds)
        ? courseIds.filter((courseId) => {
          const normalized = PersonalCourse.normalizeCourseId(courseId);
          return !priorCreditCourseIds.has(normalized) && !completedCourseIdsWithKnownTerm.has(normalized);
        })
        : [],
    ]));
    Object.entries(completedPlan).forEach(([termId, courseIds]) => {
      const existing = Array.isArray(next[termId]) ? next[termId] : [];
      next[termId] = [...existing];
      courseIds.forEach((courseId) => {
        if (!next[termId].includes(courseId)) next[termId].push(courseId);
      });
    });
    return next;
  };
  const defaultActiveSem = FRDATA.defaultActiveSem || 'S25';
  const termOptions = FRDATA.termOptions || [{ id: defaultActiveSem, label: FRDATA.semesterLabels?.[defaultActiveSem] || defaultActiveSem }];
  const demoFourYearPlan = JSON.stringify({
    F23: ['6.100A', '18.02', '8.02', '21H.001'],
    S24: ['6.006', '18.06', '6.009'],
    F24: [],
    S25: [],
    F25: [],
    S26: [],
    F26: [],
    S27: [],
  });
  const isDemoFourYearPlan = (plan) => {
    if (!plan || typeof plan !== 'object') return false;
    const demo = JSON.parse(demoFourYearPlan);
    const comparable = {};
    Object.entries(plan).forEach(([term, courses]) => {
      if (!demo[term] && Array.isArray(courses) && courses.length) comparable[term] = courses;
    });
    Object.keys(demo).forEach((term) => {
      comparable[term] = Array.isArray(plan[term]) ? plan[term] : [];
    });
    return JSON.stringify(comparable) === demoFourYearPlan;
  };
  const deriveProfileFromMarkdown = (profile, markdown) => {
    const summary = PersonalCourse.summarize(markdown || '');
    const parsedCourseIds = new Set(summary.courses.map((course) => course.id));
    if (!summary.courses.length) return profile;
    const manualTaken = (profile.taken || []).filter((courseId) => !parsedCourseIds.has(PersonalCourse.normalizeCourseId(courseId)));
    return {
      ...profile,
      taken: [...new Set([...manualTaken, ...summary.completedCourseIds])],
      preferences: {
        ...(profile.preferences || {}),
        courseRatings: {
          ...(profile.preferences?.courseRatings || {}),
          ...summary.coursePreferences,
        },
      },
    };
  };
  const resolveSavedActiveSem = (saved) => {
    const savedActiveSem = saved?.activeSem;
    if (!savedActiveSem) return defaultActiveSem;
    const savedSchedule = saved?.fourYearPlan && Array.isArray(saved.fourYearPlan[savedActiveSem])
      ? saved.fourYearPlan[savedActiveSem]
      : [];
    if (savedActiveSem === 'S25' && defaultActiveSem !== 'S25' && savedSchedule.length === 0) {
      return defaultActiveSem;
    }
    return savedActiveSem;
  };
  const normalizeSavedFourYearPlan = (saved, activeSem, markdown = '') => {
    const base = emptyFourYearPlan();
    let plan = base;
    if (saved?.fourYearPlan && typeof saved.fourYearPlan === 'object') {
      plan = isDemoFourYearPlan(saved.fourYearPlan) ? base : { ...base, ...saved.fourYearPlan };
      return mergePlanWithMarkdown(plan, markdown);
    }
    if (Array.isArray(saved?.semesterPlan)) {
      plan = { ...base, [activeSem]: [...saved.semesterPlan] };
      return mergePlanWithMarkdown(plan, markdown);
    }
    return mergePlanWithMarkdown(base, markdown);
  };
  const planDraftUserKey = (user = authState.user) => `${PLAN_DRAFT_KEY}:${user?.uid || user?.email || 'anonymous'}`;
  const writePlanDraft = (plan, sem, user = authState.user) => {
    if (!user || !plan || typeof plan !== 'object') return;
    try {
      localStorage.setItem(planDraftUserKey(user), JSON.stringify({
        fourYearPlan: plan,
        activeSem: sem,
        user: user.email || user.uid || '',
        updatedAtClient: new Date().toISOString(),
      }));
    } catch (error) {
      console.warn('[plan draft] failed to write local backup', error);
    }
  };
  const readPlanDraft = (user = authState.user) => {
    if (!user) return null;
    try {
      const parsed = JSON.parse(localStorage.getItem(planDraftUserKey(user)) || 'null');
      if (!parsed || typeof parsed !== 'object' || !parsed.fourYearPlan || typeof parsed.fourYearPlan !== 'object') return null;
      return parsed;
    } catch (error) {
      console.warn('[plan draft] failed to read local backup', error);
      return null;
    }
  };
  const isDraftNewerThanSaved = (draft, saved) => {
    const draftMs = Date.parse(draft?.updatedAtClient || '');
    const savedMs = Date.parse(saved?.updatedAtClient || '');
    return Number.isFinite(draftMs) && (!Number.isFinite(savedMs) || draftMs > savedMs);
  };
  const chatHistoryUserKey = (user = authState.user) => `${CHAT_HISTORY_KEY}:${user?.uid || user?.email || 'anonymous'}`;
  const sanitizeChatHistory = (items = []) => items
    .filter((message) => message && !message.streaming)
    .map((message) => ({
      id: message.id,
      role: message.role === 'user' ? 'user' : 'agent',
      text: String(message.text || ''),
      suggestions: Array.isArray(message.suggestions) ? message.suggestions.slice(0, 6) : [],
      traceSummary: message.traceSummary || null,
      proposal: message.proposal || null,
      uiActions: Array.isArray(message.uiActions) ? message.uiActions : [],
    }))
    .filter((message) => message.text.trim() || message.suggestions.length || message.proposal)
    .slice(-MAX_CHAT_HISTORY_MESSAGES);
  const readChatHistory = (fallbackProfile, user = authState.user) => {
    if (!user) return personalizeAgentMessages(fallbackProfile);
    try {
      const parsed = JSON.parse(localStorage.getItem(chatHistoryUserKey(user)) || 'null');
      const messages = sanitizeChatHistory(Array.isArray(parsed?.messages) ? parsed.messages : []);
      return messages.length ? messages : personalizeAgentMessages(fallbackProfile);
    } catch (error) {
      console.warn('[chat history] failed to read local history', error);
      return personalizeAgentMessages(fallbackProfile);
    }
  };
  const writeChatHistory = (items, user = authState.user) => {
    if (!user) return;
    try {
      localStorage.setItem(chatHistoryUserKey(user), JSON.stringify({
        messages: sanitizeChatHistory(items),
        updatedAtClient: new Date().toISOString(),
      }));
    } catch (error) {
      console.warn('[chat history] failed to write local history', error);
    }
  };
  const clearChatHistory = (user = authState.user) => {
    if (!user) return;
    try {
      localStorage.removeItem(chatHistoryUserKey(user));
    } catch (error) {
      console.warn('[chat history] failed to clear local history', error);
    }
  };

  const [theme, setTheme] = useState(() => localStorage.getItem('fr-theme') || 'light');
  const [route, setRoute] = useState({ name: 'onboarding' });
  const [profile, setProfile] = useState(freshProfile);
  const [personalCourseMarkdown, setPersonalCourseMarkdown] = useState(() => localStorage.getItem('fr-personalcourse-draft') || '');
  const [fourYearPlan, setFourYearPlan] = useState(emptyFourYearPlan);
  const [activeSem, setActiveSem] = useState(defaultActiveSem);
  const [messages, setMessages] = useState(() => personalizeAgentMessages(freshProfile()));
  const [authState, setAuthState] = useState(() => FRAuth.getState());
  const [dataReady, setDataReady] = useState(false);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [notification, setNotification] = useState(null);
  const [saveState, setSaveState] = useState('idle');
  const [autosaveEnabled, setAutosaveEnabled] = useState(false);
  const saveQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    const unsubscribe = FRAuth.subscribe(setAuthState);
    FRAuth.init();
    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (authState.status !== 'signedIn') {
      setDataReady(false);
      setOnboardingCompleted(false);
      setAutosaveEnabled(false);
      return () => { cancelled = true; };
    }

    setDataReady(false);
    setAutosaveEnabled(false);
    FRAuth.loadUserData()
      .then((saved) => {
        if (cancelled) return;
        const completed = Boolean(saved?.onboardingCompleted);
        const baseProfile = freshProfile();
        const onboardingName = typeof saved?.onboarding?.name === 'string' ? saved.onboarding.name.trim() : '';
        let nextProfile = saved?.profile ? {
          ...baseProfile,
          ...saved.profile,
          name: saved.profile.name === 'Alex Chen'
            ? (onboardingName || authState.user.email.split('@')[0])
            : (saved.profile.name || onboardingName || authState.user.email.split('@')[0]),
          taken: [...(saved.profile.taken || [])],
          preferences: { ...(saved.profile.preferences || {}) },
          remainingReqs: Array.isArray(saved.profile.remainingReqs) ? saved.profile.remainingReqs : [],
        } : {
          ...baseProfile,
          name: authState.user.email.split('@')[0],
        };

        const localDraft = readPlanDraft(authState.user);
        const effectiveSaved = localDraft && isDraftNewerThanSaved(localDraft, saved)
          ? {
            ...(saved || {}),
            fourYearPlan: localDraft.fourYearPlan,
            activeSem: localDraft.activeSem || saved?.activeSem,
            updatedAtClient: localDraft.updatedAtClient,
          }
          : saved;
        const nextActiveSem = resolveSavedActiveSem(effectiveSaved);
        const nextPersonalCourseMarkdown = typeof saved?.personalCourseMarkdown === 'string'
          ? saved.personalCourseMarkdown
          : (saved?.onboarding?.personalCourseMarkdown
            || localStorage.getItem('fr-personalcourse-draft')
            || '');
        nextProfile = deriveProfileFromMarkdown(nextProfile, nextPersonalCourseMarkdown);
        setProfile(nextProfile);
        setPersonalCourseMarkdown(nextPersonalCourseMarkdown);
        if (nextPersonalCourseMarkdown) localStorage.setItem('fr-personalcourse-draft', nextPersonalCourseMarkdown);
        setMessages(readChatHistory(nextProfile, authState.user));
        setActiveSem(nextActiveSem);
        setFourYearPlan(normalizeSavedFourYearPlan(effectiveSaved, nextActiveSem, nextPersonalCourseMarkdown));
        setOnboardingCompleted(completed);
        setRoute({ name: completed ? 'planner' : 'onboarding' });
        setDataReady(true);
        setAutosaveEnabled(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        const localDraft = readPlanDraft(authState.user);
        const nextProfile = { ...freshProfile(), name: authState.user.email.split('@')[0] };
        const nextPersonalCourseMarkdown = localStorage.getItem('fr-personalcourse-draft') || '';
        const nextPlan = localDraft?.fourYearPlan || emptyFourYearPlan();
        const nextActiveSem = localDraft?.activeSem || defaultActiveSem;
        const recoveredLocalPlan = Boolean(localDraft);
        setProfile(deriveProfileFromMarkdown(nextProfile, nextPersonalCourseMarkdown));
        setPersonalCourseMarkdown(nextPersonalCourseMarkdown);
        setMessages(readChatHistory(nextProfile, authState.user));
        setActiveSem(nextActiveSem);
        setFourYearPlan(nextPlan);
        setOnboardingCompleted(recoveredLocalPlan);
        setRoute({ name: recoveredLocalPlan ? 'planner' : 'onboarding' });
        setDataReady(true);
        setAutosaveEnabled(false);
        setNotification({
          tone: 'error',
          title: 'Could not sync saved plan',
          detail: recoveredLocalPlan
            ? 'Restored your local plan backup for this session. Changes will not sync until reload succeeds.'
            : 'Could not load your saved plan. I will not overwrite remote data with an empty plan.',
        });
      });

    return () => { cancelled = true; };
  }, [authState.status, authState.user?.uid]);

  const schedule = fourYearPlan[activeSem] || [];
  const planningTermLabel = FRDATA.semesterLabels?.[activeSem] || FRDATA.planningTermLabel || activeSem;
  const setSchedule = (updater) => setFourYearPlan((currentPlan) => {
    const currentSchedule = currentPlan[activeSem] || [];
    const nextSchedule = typeof updater === 'function' ? updater(currentSchedule) : updater;
    const nextPlan = { ...currentPlan, [activeSem]: nextSchedule };
    writePlanDraft(nextPlan, activeSem);
    return nextPlan;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('fr-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (authState.status !== 'signedIn' || !dataReady || !autosaveEnabled) return undefined;
    const timer = setTimeout(() => {
      setSaveState('saving');
      const payload = {
        onboardingCompleted,
        profile,
        personalCourseMarkdown,
        fourYearPlan,
        activeSem,
      };
      writePlanDraft(fourYearPlan, activeSem);
      saveQueueRef.current = saveQueueRef.current.catch(() => {}).then(() => FRAuth.saveUserData(payload));
      saveQueueRef.current.then(() => {
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 1000);
      }).catch((err) => {
        console.error(err);
        setSaveState('error');
      });
    }, 450);

    return () => clearTimeout(timer);
  }, [authState.status, dataReady, autosaveEnabled, onboardingCompleted, profile, personalCourseMarkdown, fourYearPlan, activeSem]);

  useEffect(() => {
    if (authState.status !== 'signedIn' || !dataReady) return undefined;
    const persistBeforeUnload = () => writePlanDraft(fourYearPlan, activeSem);
    window.addEventListener('pagehide', persistBeforeUnload);
    window.addEventListener('beforeunload', persistBeforeUnload);
    return () => {
      window.removeEventListener('pagehide', persistBeforeUnload);
      window.removeEventListener('beforeunload', persistBeforeUnload);
    };
  }, [authState.status, dataReady, fourYearPlan, activeSem]);

  useEffect(() => {
    if (authState.status !== 'signedIn' || !dataReady) return undefined;
    writeChatHistory(messages);
    return undefined;
  }, [authState.status, dataReady, messages]);


  const addCourse = async (id) => {
    const courseId = String(id || '').trim().toUpperCase();
    if (!courseId || schedule.map((item) => String(item).toUpperCase()).includes(courseId)) return;
    const course = await FRDATA.fetchCurrentCourse(courseId);
    if (!isOfferedInSemester(course, activeSem)) return;
    setSchedule((s) => [...s, courseId]);
  };

  const removeCourse = (id) => {
    const courseId = String(id || '').trim().toUpperCase();
    if (!courseId) return;
    setSchedule((s) => s.filter((item) => String(item).toUpperCase() !== courseId));
  };

  const completeOnboarding = async ({ profile: nextProfile, onboarding, personalCourseMarkdown, recommendedCourseIds = [] }) => {
    const hydratedProfile = deriveProfileFromMarkdown(nextProfile, personalCourseMarkdown);
    let hydratedFourYearPlan = mergePlanWithMarkdown(fourYearPlan, personalCourseMarkdown);
    const recommendedIds = [...new Set((recommendedCourseIds || []).map((id) => String(id || '').trim().toUpperCase()).filter(Boolean))];
    if (recommendedIds.length) {
      const currentPlan = hydratedFourYearPlan[activeSem] || [];
      hydratedFourYearPlan = {
        ...hydratedFourYearPlan,
        [activeSem]: [...new Set([...currentPlan, ...recommendedIds])],
      };
    }
    setOnboardingCompleted(true);
    setProfile(hydratedProfile);
    setPersonalCourseMarkdown(personalCourseMarkdown || '');
    setFourYearPlan(hydratedFourYearPlan);
    writePlanDraft(hydratedFourYearPlan, activeSem);
    if (personalCourseMarkdown) localStorage.setItem('fr-personalcourse-draft', personalCourseMarkdown);
    setMessages(personalizeAgentMessages(hydratedProfile));
    setRoute({ name: 'planner' });
    setSaveState('saving');
    try {
      await FRAuth.saveUserData({
        onboardingCompleted: true,
        profile: hydratedProfile,
        fourYearPlan: hydratedFourYearPlan,
        activeSem,
        onboarding,
        personalCourseMarkdown,
      });
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1000);
    } catch (err) {
      console.error(err);
      setSaveState('error');
    }
  };

  const resetOnboarding = async () => {
    await FRAuth.resetUserData();
    const nextProfile = { ...freshProfile(), name: authState.user?.email?.split('@')[0] || '' };
    setProfile(nextProfile);
    setPersonalCourseMarkdown('');
    localStorage.removeItem('fr-personalcourse-draft');
    clearChatHistory();
    setMessages(personalizeAgentMessages(nextProfile));
    setActiveSem(defaultActiveSem);
    const nextPlan = emptyFourYearPlan();
    setFourYearPlan(nextPlan);
    writePlanDraft(nextPlan, defaultActiveSem);
    setOnboardingCompleted(false);
    setRoute({ name: 'onboarding' });
  };

  const reparseTranscript = async () => {
    const markdown = personalCourseMarkdown || '';
    if (!markdown.trim()) {
      setNotification({
        tone: 'error',
        title: 'No saved transcript markdown',
        detail: 'Re-parse needs an existing personal_course.md. Use Reset to upload a new transcript.',
      });
      return;
    }

    const summary = PersonalCourse.summarize(markdown);
    const nextProfile = deriveProfileFromMarkdown(profile, markdown);
    const nextFourYearPlan = mergePlanWithMarkdown(fourYearPlan, markdown);

    const oldTaken = new Set((profile.taken || []).map(PersonalCourse.normalizeCourseId));
    const newTaken = new Set((nextProfile.taken || []).map(PersonalCourse.normalizeCourseId));
    const addedTaken = [...newTaken].filter((id) => !oldTaken.has(id));
    const removedTaken = [...oldTaken].filter((id) => !newTaken.has(id));

    const flatten = (plan) => Object.values(plan || {}).flat().map(PersonalCourse.normalizeCourseId);
    const oldPlan = new Set(flatten(fourYearPlan));
    const newPlan = new Set(flatten(nextFourYearPlan));
    const addedPlan = [...newPlan].filter((id) => !oldPlan.has(id));
    const removedPlan = [...oldPlan].filter((id) => !newPlan.has(id));

    console.info('[reparse] summary', {
      completed: summary.completedCourses.length,
      priorCredits: summary.priorCreditCourses.length,
      listener: summary.listenerCourses.length,
      dropped: summary.droppedCourses.length,
      addedTaken,
      removedTaken,
      addedPlan,
      removedPlan,
    });

    setProfile(nextProfile);
    setPersonalCourseMarkdown(markdown);
    localStorage.setItem('fr-personalcourse-draft', markdown);
    setFourYearPlan(nextFourYearPlan);
    writePlanDraft(nextFourYearPlan, activeSem);

    try {
      await FRAuth.saveUserData({
        onboardingCompleted,
        profile: nextProfile,
        fourYearPlan: nextFourYearPlan,
        activeSem,
        personalCourseMarkdown: markdown,
      });
    } catch (err) {
      console.error('[reparse] save failed', err);
      setNotification({
        tone: 'error',
        title: 'Re-parse saved locally — sync failed',
        detail: 'Changes applied to this session but did not sync to the server. Try again or check your connection.',
      });
      return;
    }

    const counts = `${summary.completedCourses.length} completed · ${summary.priorCreditCourses.length} prior credits · ${summary.listenerCourses.length} listener · ${summary.droppedCourses.length} dropped`;
    const changeBits = [];
    if (addedTaken.length || removedTaken.length) {
      changeBits.push(`taken: +${addedTaken.length} / −${removedTaken.length}`);
    }
    if (addedPlan.length || removedPlan.length) {
      changeBits.push(`plan: +${addedPlan.length} / −${removedPlan.length}`);
    }
    setNotification({
      tone: 'success',
      title: changeBits.length ? 'Transcript re-synced' : 'Transcript re-synced (no changes)',
      detail: changeBits.length ? `${counts}. ${changeBits.join(' · ')}.` : counts,
    });
  };

  const ctx = {
    theme, setTheme, route, setRoute, profile, setProfile, personalCourseMarkdown, setPersonalCourseMarkdown, fourYearPlan, setFourYearPlan, activeSem, setActiveSem, termOptions, planningTermLabel,
    authState, dataReady, onboardingCompleted, saveState,
    completeOnboarding, resetOnboarding, reparseTranscript, signOut: FRAuth.signOut,
    notification, setNotification,
  };

  return (
    <AppCtx.Provider value={ctx}>
      <AuthGate authState={authState}>
        {!dataReady ? (
          <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--text-secondary)' }}>
            Loading your Fireroad data...
          </div>
        ) : (
          <>
            {route.name === 'onboarding' && <Onboarding />}
            {route.name === 'planner' && (
              <Planner schedule={schedule} setSchedule={setSchedule} messages={messages} setMessages={setMessages} planningTermLabel={planningTermLabel} />
            )}
            {route.name === 'course' && (
              <CourseDetail
                courseId={route.id}
                inSchedule={schedule.map((id) => String(id).toUpperCase()).includes(String(route.id).toUpperCase())}
                onBack={() => setRoute({ name: 'planner' })}
                onAdd={addCourse}
                onRemove={removeCourse}
              />
            )}
            {route.name === 'profile' && <ProfilePage />}
            {route.name === 'fouryear' && <FourYearPlanPage />}
            {route.name === 'priorcredit' && <PriorCreditPage />}
            <Toast notification={notification} onClose={() => setNotification(null)} />
          </>
        )}
      </AuthGate>
    </AppCtx.Provider>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
