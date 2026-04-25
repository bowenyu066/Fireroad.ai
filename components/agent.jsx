/* global React, FRDATA, Icon, MatchBar, AreaDot, useApp */
const { useState, useEffect, useRef } = React;

// ============== Agent / chat panel (top-right) ==============
const AgentPanel = ({ messages, setMessages, profile, schedule, onAddCourse, onOpenCourse, onApplyUiActions }) => {
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef(null);
  const { activeSem, planningTermLabel, authState } = useApp();
  const studentName = String(profile?.name || '').trim()
    || String(authState?.user?.email || '').split('@')[0]
    || '';

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, typing]);

  const send = async () => {
    if (!input.trim() || typing) return;
    const userMsg = { role: 'user', text: input.trim() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setTyping(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages,
          profile,
          schedule,
          activeSem,
          planningTermLabel,
          studentName,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const text = payload?.message?.text || payload?.error || 'The agent is unavailable right now. Manual planning still works.';
        throw new Error(text);
      }

      if (payload?.message) {
        setMessages((m) => [...m, payload.message]);
      }

      if (Array.isArray(payload?.uiActions) && payload.uiActions.length > 0) {
        onApplyUiActions(payload.uiActions);
      }
    } catch (error) {
      setMessages((m) => [...m, {
        role: 'agent',
        text: error.message || 'The agent is unavailable right now. Manual planning still works.',
        suggestions: [],
      }]);
    } finally {
      setTyping(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '14px 18px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 22, height: 22, borderRadius: 6,
            background: 'var(--accent-soft)',
            border: '1px solid var(--accent)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--accent)',
          }}>
            <Icon name="sparkle" size={12} />
          </span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Agent</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} />
              Online · Calibrated to you
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {messages.map((m, i) => <MessageBubble key={i} msg={m} onAddCourse={onAddCourse} onOpenCourse={onOpenCourse} />)}
        {typing && <TypingDots />}
      </div>

      {/* Input */}
      <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 6px 6px 12px', borderRadius: 'var(--r-md)',
          background: 'var(--surface)', border: '1px solid var(--border)',
        }}>
          <button className="btn-ghost" style={{ color: 'var(--text-tertiary)', padding: 4 }} title="Attach">
            <Icon name="paperclip" size={15} />
          </button>
          <input
            placeholder="Ask the agent…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
            style={{ flex: 1, fontSize: 13, padding: '6px 0' }}
          />
          <button onClick={send} className="btn-primary" style={{
            width: 28, height: 28, borderRadius: 7, padding: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            opacity: input.trim() ? 1 : 0.5,
          }}>
            <Icon name="send" size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};

const MessageBubble = ({ msg, onAddCourse, onOpenCourse }) => {
  const isUser = msg.role === 'user';
  const [suggestedCourses, setSuggestedCourses] = useState([]);
  const suggestionsKey = (msg.suggestions || []).join('|');

  useEffect(() => {
    let cancelled = false;
    Promise.all((msg.suggestions || []).map((id) => FRDATA.fetchCurrentCourse(id))).then((courses) => {
      if (!cancelled) setSuggestedCourses(courses.filter(Boolean));
    });
    return () => { cancelled = true; };
  }, [suggestionsKey]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start',
    }}>
      <div style={{
        maxWidth: '88%',
        padding: '10px 14px', borderRadius: 'var(--r-md)',
        background: isUser ? 'var(--accent)' : 'var(--surface)',
        color: isUser ? '#fff' : 'var(--text)',
        border: isUser ? 'none' : '1px solid var(--border)',
        fontSize: 13, lineHeight: 1.55,
      }}>
        {msg.text}
      </div>

      {suggestedCourses.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {suggestedCourses.map((c) => {
            return (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 6px 6px 10px', borderRadius: 999,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                fontSize: 12,
              }}>
                <button onClick={() => onOpenCourse(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AreaDot area={c.area} size={6} />
                  <span className="mono">{c.id}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{c.name}</span>
                </button>
                <button
                  onClick={() => onAddCourse(c.id)}
                  style={{
                    padding: '3px 9px', borderRadius: 999,
                    background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 500,
                  }}
                >
                  Add
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const TypingDots = () => (
  <div style={{
    alignSelf: 'flex-start', padding: '10px 14px',
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 'var(--r-md)', display: 'inline-flex', gap: 4,
  }}>
    {[0, 1, 2].map((i) => (
      <span key={i} style={{
        width: 6, height: 6, borderRadius: '50%', background: 'var(--text-tertiary)',
        animation: `pulse 1s infinite ${i * 0.15}s`,
      }} />
    ))}
  </div>
);

// ============== Recommendations panel (bottom-right) ==============
const Recommendations = ({ schedule, onAddCourse, onOpenCourse }) => {
  const [sort, setSort] = useState('match'); // match | workload | units
  const [recs, setRecs] = useState(() => FRDATA.catalog.filter((c) => !schedule.includes(c.id) && !c._stub));

  useEffect(() => {
    let cancelled = false;
    FRDATA.fetchCurrentSearch('', 40).then((courses) => {
      if (!cancelled) setRecs(courses.filter((c) => !schedule.includes(c.id)));
    });
    return () => { cancelled = true; };
  }, [schedule.join('|')]);

  const sorted = [...recs].sort((a, b) => {
    if (sort === 'match') return FRDATA.getMatch(b.id).total - FRDATA.getMatch(a.id).total;
    if (sort === 'workload') return a.hydrant - b.hydrant;
    return b.units - a.units;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '14px 18px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div className="eyebrow">Recommended for you</div>
        <div style={{ display: 'flex', gap: 4, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
          {[['match', 'Match'], ['workload', 'Workload'], ['units', 'Units']].map(([k, l]) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              style={{
                padding: '3px 8px', borderRadius: 999,
                background: sort === k ? 'var(--surface-2)' : 'transparent',
                color: sort === k ? 'var(--text)' : 'var(--text-tertiary)',
                border: '1px solid ' + (sort === k ? 'var(--border)' : 'transparent'),
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sorted.map((c) => {
          const m = FRDATA.getMatch(c.id);
          return (
            <div
              key={c.id}
              onClick={() => onOpenCourse(c.id)}
              style={{
                padding: '12px 18px', borderBottom: '1px solid var(--border)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14,
                transition: 'background 140ms',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <AreaDot area={c.area} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{c.id}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.name}
                  </span>
                </div>
                <div style={{ marginTop: 4 }}>
                  <MatchBar score={m.total} width={120} compact animated={false} />
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onAddCourse(c.id); }}
                style={{
                  padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  color: 'var(--text)',
                }}
              >
                + Add
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

window.AgentPanel = AgentPanel;
window.Recommendations = Recommendations;
