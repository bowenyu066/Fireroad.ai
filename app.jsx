/* global React, ReactDOM, FRDATA, Onboarding, ProfilePage, TopBar, SchedulePanel, FourYearPlan, AgentPanel, Recommendations, CourseDetail, AppCtx */
const { useState, useEffect } = React;

const Planner = ({ schedule, setSchedule, messages, setMessages }) => {
  const { setRoute } = React.useContext(AppCtx);
  const [tab, setTab] = useState('semester');
  const [justAddedId, setJustAddedId] = useState(null);
  const [viewMode, setViewMode] = useState('list');

  const onAddCourse = (id) => {
    if (schedule.includes(id)) return;
    const c = FRDATA.getCourse(id);
    const newUnits = schedule.reduce((s, x) => s + FRDATA.getCourse(x).units, 0) + c.units;
    setSchedule((s) => [...s, id]);
    setJustAddedId(id);
    setTimeout(() => setJustAddedId(null), 800);
    setMessages((m) => [...m, {
      role: 'agent',
      text: `Added ${c.id} (${c.name}). You're at ${newUnits} units. Want me to suggest something to balance the workload?`,
    }]);
  };

  const onOpenCourse = (id) => setRoute({ name: 'course', id });

  return (
    <div className="fade-in" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar tab={tab} setTab={setTab} />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 'calc(100vh - 65px)' }}>
        {tab === 'semester' ? (
          <>
            <div style={{ flex: '1.3', borderRight: '1px solid var(--border)', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <SchedulePanel
                schedule={schedule} setSchedule={setSchedule}
                justAddedId={justAddedId} onOpenCourse={onOpenCourse}
                viewMode={viewMode} setViewMode={setViewMode}
              />
            </div>
            <div style={{ flex: '1', minWidth: 380, display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: '1 1 0', minHeight: 0, borderBottom: '1px solid var(--border)' }}>
                <AgentPanel
                  messages={messages} setMessages={setMessages}
                  onAddCourse={onAddCourse} onOpenCourse={onOpenCourse}
                />
              </div>
              <div style={{ flex: '1 1 0', minHeight: 0 }}>
                <Recommendations schedule={schedule} onAddCourse={onAddCourse} onOpenCourse={onOpenCourse} />
              </div>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, minWidth: 0 }}>
            <FourYearPlan />
          </div>
        )}
      </div>
    </div>
  );
};

const App = () => {
  const [theme, setTheme] = useState(() => localStorage.getItem('fr-theme') || 'dark');
  const [route, setRoute] = useState({ name: 'onboarding' });
  const [profile, setProfile] = useState(FRDATA.profile);
  const [fourYearPlan, setFourYearPlan] = useState(FRDATA.fourYearPlan);
  const [activeSem, setActiveSem] = useState('S25');
  const [messages, setMessages] = useState(FRDATA.agentMessages);

  // schedule always reflects the active planning semester
  const schedule = fourYearPlan[activeSem] || [];
  const setSchedule = (updater) => setFourYearPlan(p => {
    const cur = p[activeSem] || [];
    return { ...p, [activeSem]: typeof updater === 'function' ? updater(cur) : updater };
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('fr-theme', theme);
  }, [theme]);

  const addCourse = (id) => {
    if (schedule.includes(id)) return;
    setSchedule((s) => [...s, id]);
  };

  const ctx = { theme, setTheme, route, setRoute, profile, setProfile, fourYearPlan, setFourYearPlan, activeSem, setActiveSem };

  return (
    <AppCtx.Provider value={ctx}>
      {route.name === 'onboarding' && <Onboarding />}
      {route.name === 'planner' && (
        <Planner schedule={schedule} setSchedule={setSchedule} messages={messages} setMessages={setMessages} />
      )}
      {route.name === 'course' && (
        <CourseDetail
          courseId={route.id}
          inSchedule={schedule.includes(route.id)}
          onBack={() => setRoute({ name: 'planner' })}
          onAdd={addCourse}
        />
      )}
      {route.name === 'profile' && <ProfilePage />}
    </AppCtx.Provider>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
