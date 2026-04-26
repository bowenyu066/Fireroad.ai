/* global React, FRDATA, Icon, MatchBar, AreaDot, useApp */
const { useState, useEffect, useRef } = React;

// ============== Agent / chat panel (top-right) ==============
const AgentPanel = ({ messages, setMessages, profile, schedule, onAddCourse, onOpenCourse, onApplyUiActions }) => {
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef(null);
  const { activeSem, planningTermLabel, authState, personalCourseMarkdown } = useApp();
  const studentName = String(profile?.name || '').trim()
    || String(authState?.user?.email || '').split('@')[0]
    || '';

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, typing]);

  const updateStreamingMessage = (id, updater) => {
    setMessages((current) => current.map((message) => (
      message.id === id ? { ...message, ...updater(message) } : message
    )));
  };

  const readAgentStream = async (response, handlers) => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const handleBlock = (block) => {
      const lines = block.split(/\r?\n/);
      let event = 'message';
      const dataLines = [];
      lines.forEach((line) => {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      });
      if (!dataLines.length) return;
      const raw = dataLines.join('\n');
      const data = raw ? JSON.parse(raw) : {};
      if (handlers[event]) handlers[event](data);
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      blocks.forEach(handleBlock);
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleBlock(buffer);
  };

  const send = async () => {
    if (!input.trim() || typing) return;
    const userMsg = { role: 'user', text: input.trim() };
    const nextMessages = [...messages, userMsg];
    const agentMessageId = `agent-${Date.now()}`;
    const clientRequestId = `chat-${Date.now().toString(36)}`;
    const placeholder = {
      id: agentMessageId,
      role: 'agent',
      text: '',
      status: 'Thinking...',
      suggestions: [],
      streaming: true,
    };
    setMessages([...nextMessages, placeholder]);
    setInput('');
    setTyping(true);

    try {
      console.debug('[agent stream] start', {
        clientRequestId,
        activeSem,
        schedule,
        messageCount: nextMessages.length,
        latestUserText: userMsg.text,
      });
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages,
          profile,
          personalization: profile?.preferences?.personalization || null,
          personalCourseMarkdown,
          schedule,
          activeSem,
          planningTermLabel,
          studentName,
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.error('[agent stream] http error', { clientRequestId, status: response.status, text });
        throw new Error(`The agent returned HTTP ${response.status}. Check the server logs for this request.`);
      }

      await readAgentStream(response, {
        status: ({ text }) => {
          console.debug('[agent stream] status', { clientRequestId, text });
          updateStreamingMessage(agentMessageId, (message) => ({
            status: message.text ? '' : text,
          }));
        },
        delta: ({ text }) => updateStreamingMessage(agentMessageId, (message) => ({
          text: `${message.text || ''}${text || ''}`,
          status: '',
        })),
        final: (payload) => {
          console.debug('[agent stream] final', {
            clientRequestId,
            textLength: payload?.message?.text?.length || 0,
            suggestions: payload?.message?.suggestions || [],
            uiActions: payload?.uiActions || [],
            debug: payload?.debug,
          });
          if (payload?.message) {
            updateStreamingMessage(agentMessageId, () => ({
              ...payload.message,
              id: agentMessageId,
              streaming: false,
              status: '',
            }));
          }
          if (Array.isArray(payload?.uiActions) && payload.uiActions.length > 0) {
            onApplyUiActions(payload.uiActions);
          }
        },
        error: (payload) => {
          console.error('[agent stream] sse error', { clientRequestId, payload });
          throw new Error(payload?.message?.text || payload?.error || 'The agent is unavailable right now. Manual planning still works.');
        },
      });
    } catch (error) {
      console.error('[agent stream] failed', { clientRequestId, error });
      const failedToFetch = String(error && error.message || '').includes('Failed to fetch');
      updateStreamingMessage(agentMessageId, () => ({
        role: 'agent',
        text: failedToFetch
          ? 'Failed to reach /api/chat/stream. Restart the dev server and check the server terminal logs.'
          : (error.message || 'The agent is unavailable right now. Manual planning still works.'),
        suggestions: [],
        streaming: false,
        status: '',
      }));
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
        {messages.map((m, i) => (
          <MessageBubble
            key={i}
            msg={m}
            schedule={schedule}
            onAddCourse={onAddCourse}
            onOpenCourse={onOpenCourse}
          />
        ))}
        {typing && !messages.some((message) => message.streaming) && <TypingDots />}
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

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const renderInlineMarkdown = (value) => {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return html;
};

const renderMarkdown = (value) => {
  const lines = String(value || '').split('\n');
  const blocks = [];
  let paragraph = [];
  let listItems = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(`<ul>${listItems.map((item) => {
      const detail = item.details.length
        ? `<div class="chat-list-detail">${item.details.map(renderInlineMarkdown).join('<br />')}</div>`
        : '';
      return `<li>${renderInlineMarkdown(item.main)}${detail}</li>`;
    }).join('')}</ul>`);
    listItems = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      return;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(4, heading[1].length);
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      return;
    }

    const bullet = trimmed.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      listItems.push({ main: bullet[1], details: [] });
      return;
    }

    if (/^\s{2,}/.test(line) && listItems.length) {
      listItems[listItems.length - 1].details.push(trimmed);
      return;
    }

    flushList();
    paragraph.push(trimmed);
  });

  flushParagraph();
  flushList();
  return blocks.join('');
};

const ToolStatusRow = ({ text }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 6,
    marginTop: 8, color: 'var(--text-tertiary)', fontSize: 11,
    fontFamily: 'var(--font-mono)',
  }}>
    <span style={{
      width: 5, height: 5, borderRadius: '50%',
      background: 'var(--accent)', flexShrink: 0,
      animation: 'pulse 1s infinite',
    }} />
    {text}
  </div>
);

const MessageBubble = ({ msg, schedule, onAddCourse, onOpenCourse }) => {
  const isUser = msg.role === 'user';
  const [suggestedCourses, setSuggestedCourses] = useState([]);
  const [locallyAdded, setLocallyAdded] = useState([]);
  const suggestionsKey = (msg.suggestions || []).join('|');
  const scheduled = new Set((schedule || []).map((id) => String(id).toUpperCase()));
  const displayText = msg.text || (msg.streaming ? msg.status || 'Thinking...' : '');
  const messageHtml = renderMarkdown(displayText);

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
        color: isUser ? '#fff' : (msg.streaming && !msg.text ? 'var(--text-secondary)' : 'var(--text)'),
        border: isUser ? 'none' : '1px solid var(--border)',
        fontSize: 13, lineHeight: 1.55,
      }}>
        {isUser ? displayText : (
          <>
            <div className="chat-markdown" dangerouslySetInnerHTML={{ __html: messageHtml }} />
            {msg.streaming && msg.status && msg.text && <ToolStatusRow text={msg.status} />}
          </>
        )}
      </div>

      {suggestedCourses.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {suggestedCourses.map((c) => {
            const courseId = String(c.id || '').toUpperCase();
            const isAdded = scheduled.has(courseId) || locallyAdded.includes(courseId);
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
                  onClick={() => {
                    setLocallyAdded((current) => current.includes(courseId) ? current : [...current, courseId]);
                    onAddCourse(c.id);
                  }}
                  disabled={isAdded}
                  style={{
                    padding: '3px 9px', borderRadius: 999,
                    background: isAdded ? 'var(--surface)' : 'var(--accent)',
                    color: isAdded ? 'var(--text-tertiary)' : '#fff',
                    border: isAdded ? '1px solid var(--border)' : '1px solid var(--accent)',
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: isAdded ? 'default' : 'pointer',
                  }}
                >
                  {isAdded ? 'Added' : 'Add'}
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

// ============== Further personalization ==============
const PERSONALIZATION_TOTAL_GROUPS = 6;
const TOPIC_FIELDS = [
  ['coding', 'Coding'],
  ['proofs', 'Proofs'],
  ['algorithms', 'Algorithms'],
  ['probability', 'Probability'],
  ['linearAlgebra', 'Linear algebra'],
  ['machineLearning', 'Machine learning'],
  ['systems', 'Systems'],
];
const FORMAT_FIELDS = [
  ['psets', 'Psets'],
  ['codingLabs', 'Coding labs'],
  ['exams', 'Exams'],
  ['labs', 'Labs'],
  ['finalProjects', 'Final projects'],
  ['paperReading', 'Paper reading'],
  ['teamProjects', 'Team projects'],
  ['presentations', 'Presentations'],
];
const DIRECTION_FIELDS = [
  ['machineLearning', 'Machine learning'],
  ['theory', 'Theory'],
  ['systems', 'Systems'],
  ['math', 'Math'],
  ['hass', 'HASS'],
];

const DEFAULT_GUIDED_QUESTIONS = {
  workload: {
    title: 'What should this semester leave room for?',
    body: 'Tell us roughly how much course time is realistic and what else is competing for your week.',
  },
  evaluation: {
    title: 'What course policies would make or break a class for you?',
    body: 'This helps us avoid classes that look good on paper but feel wrong day to day.',
  },
  interests: {
    title: 'Which areas feel exciting right now?',
    body: 'Use 0 for “please avoid” and 10 for “I want more of this.”',
  },
  skills: {
    title: 'Where do you feel prepared?',
    body: 'This is not a grade. It only helps us estimate ramp-up risk.',
  },
  formats: {
    title: 'What kind of work do you want more or less of?',
    body: 'Use 0 for “avoid if possible” and 10 for “I like this format.”',
  },
  notes: {
    title: 'Anything else we should know?',
    body: 'Short, messy notes are fine. The recommender can use them later.',
  },
};

const blankPersonalization = () => ({
  version: 1,
  ratingScale: '0-10',
  updatedAtClient: '',
  progress: { completedGroups: [], totalGroups: PERSONALIZATION_TOTAL_GROUPS },
  workload: {
    weeklyCourseHoursBudget: '',
    challengePreference: '',
    attendanceImportance: '',
    gradingImportance: '',
  },
  commitments: {
    urop: false,
    recruiting: false,
    ta: false,
    clubs: false,
    details: '',
    other: '',
  },
  topicRatings: {},
  formatPreferences: {},
  gradingPreferences: {
    preferLenientGrading: null,
    avoidHarshCurves: null,
    preferClearRubrics: null,
  },
  desiredCoursesPerDirection: {},
  agentFollowUps: [],
  freeformNotes: '',
});

const clonePersonalization = (value) => {
  const base = blankPersonalization();
  const incoming = value && typeof value === 'object' ? value : {};
  return {
    ...base,
    ...incoming,
    progress: { ...base.progress, ...(incoming.progress || {}) },
    workload: { ...base.workload, ...(incoming.workload || {}) },
    commitments: { ...base.commitments, ...(incoming.commitments || {}) },
    topicRatings: { ...(incoming.topicRatings || {}) },
    formatPreferences: { ...(incoming.formatPreferences || {}) },
    gradingPreferences: { ...base.gradingPreferences, ...(incoming.gradingPreferences || {}) },
    desiredCoursesPerDirection: { ...(incoming.desiredCoursesPerDirection || {}) },
    agentFollowUps: Array.isArray(incoming.agentFollowUps) ? incoming.agentFollowUps : [],
    freeformNotes: incoming.freeformNotes || '',
  };
};

const hasValue = (value) => value !== null && value !== undefined && value !== '';

const completedPersonalizationGroups = (draft) => {
  const completed = [];
  if (
    hasValue(draft.workload.weeklyCourseHoursBudget)
    || hasValue(draft.workload.challengePreference)
    || Object.entries(draft.commitments || {}).some(([key, value]) => key !== 'other' && (value === true || (typeof value === 'string' && value.trim())))
    || String(draft.commitments?.other || '').trim()
  ) completed.push('workload');
  if (
    hasValue(draft.workload.attendanceImportance)
    || hasValue(draft.workload.gradingImportance)
    || Object.values(draft.gradingPreferences || {}).some((value) => value !== null && value !== undefined)
  ) completed.push('evaluation');
  if (Object.values(draft.topicRatings || {}).some((ratings) => ratings && (hasValue(ratings.skill) || hasValue(ratings.interest)))) {
    completed.push('skillsInterests');
  }
  if (Object.values(draft.formatPreferences || {}).some(hasValue)) completed.push('formats');
  if (Object.values(draft.desiredCoursesPerDirection || {}).some(hasValue)) completed.push('directions');
  if (String(draft.freeformNotes || '').trim()) completed.push('notes');
  return completed;
};

const normalizePersonalization = (draft) => {
  const completedGroups = completedPersonalizationGroups(draft);
  return {
    ...draft,
    version: 1,
    ratingScale: '0-10',
    updatedAtClient: new Date().toISOString(),
    progress: { completedGroups, totalGroups: PERSONALIZATION_TOTAL_GROUPS },
  };
};

const PersonalizationProgressButton = ({ personalization, onClick }) => {
  const draft = clonePersonalization(personalization);
  const completed = draft.progress?.completedGroups?.length || completedPersonalizationGroups(draft).length;
  const total = draft.progress?.totalGroups || PERSONALIZATION_TOTAL_GROUPS;
  const angle = Math.round((completed / total) * 360);
  return (
    <button
      onClick={onClick}
      title="Further personalization"
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 9px', borderRadius: 8,
        border: '1px solid var(--border)', background: 'var(--surface)',
        color: 'var(--text-secondary)', fontSize: 11,
      }}
    >
      <span style={{
        width: 24, height: 24, borderRadius: '50%',
        background: `conic-gradient(var(--accent) ${angle}deg, var(--surface-3) ${angle}deg)`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ width: 15, height: 15, borderRadius: '50%', background: 'var(--bg)' }} />
      </span>
      <span className="mono">Personalization {completed}/{total}</span>
    </button>
  );
};

const SmallSelect = ({ value, onChange, options }) => (
  <select value={value || ''} onChange={(event) => onChange(event.target.value)} style={{
    width: '100%', padding: '8px 10px', borderRadius: 8,
    border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12,
  }}>
    <option value="">No preference</option>
    {options.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}
  </select>
);

const TogglePill = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      padding: '7px 10px', borderRadius: 999,
      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      background: active ? 'var(--accent-soft)' : 'var(--surface)',
      color: active ? 'var(--accent)' : 'var(--text-secondary)',
      fontSize: 12,
    }}
  >
    {children}
  </button>
);

const CommitmentDetailFields = ({ commitments, update }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {[
        ['urop', 'UROP'],
        ['recruiting', 'Recruiting'],
        ['ta', 'TA'],
        ['clubs', 'Clubs'],
      ].map(([key, label]) => (
        <TogglePill key={key} active={commitments[key]} onClick={() => update('commitments', key, !commitments[key])}>{label}</TogglePill>
      ))}
    </div>
    {['urop', 'recruiting', 'ta', 'clubs'].some((key) => commitments[key]) && (
      <textarea
        value={commitments.details || ''}
        onChange={(event) => update('commitments', 'details', event.target.value)}
        placeholder="Briefly describe the UROP, recruiting load, TA role, or clubs."
        rows={3}
        style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', resize: 'vertical', fontSize: 12 }}
      />
    )}
  </div>
);

const PreferenceSlider = ({ label, value, onChange }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '118px 1fr 54px', gap: 10, alignItems: 'center' }}>
    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
    <ScoreButtons value={value} onChange={onChange} compact />
    <button
      type="button"
      onClick={() => onChange('')}
      title="Clear"
      className="mono"
      style={{ fontSize: 11, color: hasValue(value) ? 'var(--text)' : 'var(--text-tertiary)', textAlign: 'right' }}
    >
      {hasValue(value) ? `${value}/10` : 'unset'}
    </button>
  </div>
);

const ScoreButtons = ({ value, onChange, compact = false }) => (
  <div style={{
    display: 'grid',
    gridTemplateColumns: 'repeat(11, minmax(0, 1fr))',
    gap: compact ? 2 : 4,
  }}>
    {Array.from({ length: 11 }, (_, score) => {
      const selected = hasValue(value) && Number(value) === score;
      return (
        <button
          key={score}
          type="button"
          onClick={() => onChange(score)}
          className="mono"
          title={`${score}/10`}
          style={{
            minWidth: 0,
            height: compact ? 22 : 30,
            borderRadius: compact ? 5 : 7,
            border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
            background: selected ? 'var(--accent-soft)' : 'var(--surface)',
            color: selected ? 'var(--accent)' : 'var(--text-secondary)',
            fontSize: compact ? 10 : 12,
          }}
        >
          {score}
        </button>
      );
    })}
  </div>
);

const FurtherPersonalizationModal = ({ personalization, personalCourseMarkdown, onClose, onSave }) => {
  const { profile } = useApp();
  const [draft, setDraft] = useState(() => clonePersonalization(personalization));
  const initialCompleted = completedPersonalizationGroups(clonePersonalization(personalization));
  const [mode, setMode] = useState(initialCompleted.length ? 'editor' : 'guided');
  const [guidedStep, setGuidedStep] = useState(0);
  const [questionCopy, setQuestionCopy] = useState(DEFAULT_GUIDED_QUESTIONS);
  const [questionSource, setQuestionSource] = useState('loading');
  const [followUpQuestions, setFollowUpQuestions] = useState([]);
  const [followUpStep, setFollowUpStep] = useState(0);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [prefillState, setPrefillState] = useState(() => (
    initialCompleted.length || !personalCourseMarkdown ? 'idle' : 'loading'
  ));
  const completed = completedPersonalizationGroups(draft);
  const guidedKeys = ['workload', 'evaluation', 'interests', 'skills', 'formats', 'notes'];
  const currentKey = guidedKeys[guidedStep];
  const currentQuestion = questionCopy[currentKey] || DEFAULT_GUIDED_QUESTIONS[currentKey];

  useEffect(() => {
    if (initialCompleted.length || !personalCourseMarkdown) return undefined;
    let cancelled = false;
    setPrefillState('loading');
    fetch('/api/onboarding/personalization-prefill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile,
        personalCourseMarkdown,
      }),
    })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (cancelled) return;
        if (payload?.personalization) {
          setDraft((current) => clonePersonalization({
            ...current,
            ...payload.personalization,
            topicRatings: {
              ...(current.topicRatings || {}),
              ...(payload.personalization.topicRatings || {}),
            },
            formatPreferences: {
              ...(current.formatPreferences || {}),
              ...(payload.personalization.formatPreferences || {}),
            },
            desiredCoursesPerDirection: {
              ...(current.desiredCoursesPerDirection || {}),
              ...(payload.personalization.desiredCoursesPerDirection || {}),
            },
            freeformNotes: current.freeformNotes || payload.personalization.freeformNotes || '',
          }));
          setPrefillState(payload.source === 'model' ? 'model' : 'fallback');
        } else {
          setPrefillState('idle');
        }
      })
      .catch(() => {
        if (!cancelled) setPrefillState('idle');
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/onboarding/personalization-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile,
        personalCourseMarkdown,
        personalization: draft,
      }),
    })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (cancelled) return;
        const incoming = payload?.questions || {};
        setQuestionCopy((current) => ({
          ...current,
          ...incoming,
          skills: DEFAULT_GUIDED_QUESTIONS.skills,
        }));
        setQuestionSource(payload?.source === 'model' && payload?.questions ? 'model' : 'fallback');
      })
      .catch(() => {
        if (!cancelled) setQuestionSource('fallback');
      });
    return () => { cancelled = true; };
  }, []);

  const update = (section, key, value) => setDraft((current) => ({
    ...current,
    [section]: { ...(current[section] || {}), [key]: value },
  }));
  const updateTopic = (topic, key, value) => setDraft((current) => ({
    ...current,
    topicRatings: {
      ...current.topicRatings,
      [topic]: { ...(current.topicRatings[topic] || {}), [key]: value },
    },
  }));

  const save = () => {
    onSave(normalizePersonalization(draft), personalCourseMarkdown);
    onClose();
  };

  const goNext = () => {
    if (guidedStep >= guidedKeys.length - 1) setMode('followupIntro');
    else setGuidedStep((step) => step + 1);
  };
  const skipStep = () => {
    if (guidedStep >= guidedKeys.length - 1) setMode('followupIntro');
    else setGuidedStep((step) => step + 1);
  };
  const loadFollowUps = async () => {
    setFollowUpLoading(true);
    try {
      const normalized = normalizePersonalization(draft);
      const response = await fetch('/api/onboarding/personalization-followups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile,
          personalCourseMarkdown,
          personalization: normalized,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      const questions = Array.isArray(payload.questions) && payload.questions.length
        ? payload.questions
        : [
            'Is there a kind of course you liked or disliked in the past that the recommender should understand better?',
            'Are there any constraints this semester that are not captured by workload hours or commitments?',
          ];
      setFollowUpQuestions(questions.slice(0, 3));
      setFollowUpStep(0);
      setMode('followup');
    } catch (error) {
      setFollowUpQuestions([
        'Is there a kind of course you liked or disliked in the past that the recommender should understand better?',
        'Are there any constraints this semester that are not captured by workload hours or commitments?',
      ]);
      setFollowUpStep(0);
      setMode('followup');
    } finally {
      setFollowUpLoading(false);
    }
  };
  const answerFollowUp = (answer) => setDraft((current) => {
    const question = followUpQuestions[followUpStep] || '';
    const next = [...(current.agentFollowUps || [])];
    next[followUpStep] = { question, answer };
    return { ...current, agentFollowUps: next };
  });
  const nextFollowUp = () => {
    if (followUpStep >= followUpQuestions.length - 1) save();
    else setFollowUpStep((step) => step + 1);
  };

  const renderGuidedBody = () => {
    if (currentKey === 'workload') {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>Weekly course hours</div>
            <input
              type="number"
              min="0"
              max="100"
              value={draft.workload.weeklyCourseHoursBudget}
              onChange={(event) => update('workload', 'weeklyCourseHoursBudget', event.target.value)}
              placeholder="About 40?"
              style={{ width: '100%', padding: '15px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 18 }}
            />
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>Outside commitments</div>
            <CommitmentDetailFields commitments={draft.commitments} update={update} />
          </div>
        </div>
      );
    }

    if (currentKey === 'evaluation') {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14 }}>
          <GuidedChoice title="Attendance-heavy classes" value={draft.workload.attendanceImportance} onChange={(value) => update('workload', 'attendanceImportance', value)} options={[
            ['low', 'Avoid them'],
            ['medium', 'Some is fine'],
            ['high', 'Structure helps'],
          ]} />
          <GuidedChoice title="Grading friendliness" value={draft.workload.gradingImportance} onChange={(value) => update('workload', 'gradingImportance', value)} options={[
            ['low', 'Not a big deal'],
            ['medium', 'Matters somewhat'],
            ['high', 'Very important'],
          ]} />
          <GuidedChoice title="Challenge level" value={draft.workload.challengePreference} onChange={(value) => update('workload', 'challengePreference', value)} options={[
            ['low', 'Gentler ramp'],
            ['medium', 'Balanced'],
            ['high', 'Push me'],
          ]} />
          <div style={{ gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {[
              ['preferLenientGrading', 'Prefer lenient grading'],
              ['avoidHarshCurves', 'Avoid harsh curves'],
              ['preferClearRubrics', 'Prefer clear rubrics'],
            ].map(([key, label]) => (
              <TogglePill key={key} active={draft.gradingPreferences[key] === true} onClick={() => update('gradingPreferences', key, draft.gradingPreferences[key] === true ? null : true)}>{label}</TogglePill>
            ))}
          </div>
        </div>
      );
    }

    if (currentKey === 'interests' || currentKey === 'skills') {
      const ratingKey = currentKey === 'interests' ? 'interest' : 'skill';
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
          {TOPIC_FIELDS.map(([key, label]) => (
            <div key={key} style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{label}</div>
              <ScoreButtons value={draft.topicRatings[key]?.[ratingKey]} onChange={(value) => updateTopic(key, ratingKey, value)} />
            </div>
          ))}
        </div>
      );
    }

    if (currentKey === 'formats') {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
          {FORMAT_FIELDS.map(([key, label]) => (
            <div key={key} style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{label}</div>
              <ScoreButtons value={draft.formatPreferences[key]} onChange={(value) => update('formatPreferences', key, value)} />
            </div>
          ))}
        </div>
      );
    }

    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>Desired course mix</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            {DIRECTION_FIELDS.map(([key, label]) => (
              <FieldRow key={key} label={label}>
                <input
                  type="number"
                  min="0"
                  max="8"
                  value={draft.desiredCoursesPerDirection[key] ?? ''}
                  onChange={(event) => update('desiredCoursesPerDirection', key, event.target.value)}
                  placeholder="0"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}
                />
              </FieldRow>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>Notes</div>
          <textarea
            value={draft.freeformNotes}
            onChange={(event) => setDraft((current) => ({ ...current, freeformNotes: event.target.value }))}
            placeholder="For example: I want ML/math, but not an exam-heavy semester."
            rows={8}
            style={{ width: '100%', padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', resize: 'vertical' }}
          />
        </div>
      </div>
    );
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        width: 'min(900px, calc(100vw - 48px))', maxHeight: 'calc(100vh - 48px)',
        background: 'var(--bg)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-lg)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div className="display" style={{ fontSize: 18, fontWeight: 600 }}>
              {mode === 'guided' ? 'Personalization Questions' : mode === 'followupIntro' || mode === 'followup' ? 'Agent Follow-up' : 'Further Personalization'}
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 3 }}>
              Optional signals for better recommendations · {completed.length}/{PERSONALIZATION_TOTAL_GROUPS} groups
            </div>
          </div>
          <button className="btn-ghost" onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8 }}>
            <Icon name="x" size={15} />
          </button>
        </div>

        <div style={{ padding: mode === 'guided' ? 28 : 18, overflowY: 'auto' }}>
          {mode === 'guided' ? (
            <div style={{ minHeight: 470, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div className="mono" style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>
                Question {guidedStep + 1}/{guidedKeys.length}
              </div>
              <div className="mono" style={{ fontSize: 11, color: questionSource === 'model' ? 'var(--accent)' : 'var(--text-tertiary)', marginBottom: 10 }}>
                {prefillState === 'loading'
                  ? 'Reading personal_course.md...'
                  : prefillState === 'model'
                    ? 'Prefilled from your personal_course.md'
                    : questionSource === 'loading'
                      ? 'Tuning question copy...'
                      : questionSource === 'model'
                        ? 'Personalized by agent from your profile'
                        : 'Using default questions'}
              </div>
              <h2 className="display" style={{ fontSize: 34, lineHeight: 1.1, margin: '0 0 10px', letterSpacing: 0 }}>
                {currentQuestion.title}
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: 15, maxWidth: 640, margin: '0 0 26px' }}>
                {currentQuestion.body}
              </p>
              {renderGuidedBody()}
            </div>
          ) : mode === 'followupIntro' ? (
            <div style={{ minHeight: 470, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 720 }}>
              <div className="mono" style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 12 }}>
                Optional next step
              </div>
              <h2 className="display" style={{ fontSize: 34, lineHeight: 1.1, margin: '0 0 10px', letterSpacing: 0 }}>
                The agent can ask a few more tailored questions.
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: 15, margin: '0 0 24px' }}>
                Based on your profile and the answers above, it can generate 1-3 short follow-up questions to capture details that fixed forms usually miss. You can skip this and keep using the planner normally.
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={save} style={{
                  padding: '12px 18px', borderRadius: 9,
                  border: '1px solid var(--accent)', background: 'var(--accent-soft)',
                  color: 'var(--accent)', fontWeight: 600,
                }}>
                  Skip follow-up
                </button>
                <button className="btn btn-primary" onClick={loadFollowUps} disabled={followUpLoading} style={{ padding: '12px 18px', opacity: followUpLoading ? 0.75 : 1 }}>
                  {followUpLoading ? 'Preparing questions...' : 'Ask me'}
                </button>
              </div>
            </div>
          ) : mode === 'followup' ? (
            <div style={{ minHeight: 470, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 760 }}>
              <div className="mono" style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>
                Follow-up {followUpStep + 1}/{Math.max(followUpQuestions.length, 1)}
              </div>
              <h2 className="display" style={{ fontSize: 30, lineHeight: 1.15, margin: '0 0 20px', letterSpacing: 0 }}>
                {followUpQuestions[followUpStep] || 'Anything else the recommender should know?'}
              </h2>
              <textarea
                value={(draft.agentFollowUps || [])[followUpStep]?.answer || ''}
                onChange={(event) => answerFollowUp(event.target.value)}
                placeholder="A short answer is enough."
                rows={7}
                style={{ width: '100%', padding: 14, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', resize: 'vertical', fontSize: 14 }}
              />
            </div>
          ) : (
            <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
            <ModalSection title="Workload & Commitments">
              <FieldRow label="Weekly course hours">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={draft.workload.weeklyCourseHoursBudget}
                  onChange={(event) => update('workload', 'weeklyCourseHoursBudget', event.target.value)}
                  placeholder="45"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}
                />
              </FieldRow>
              <FieldRow label="Challenge">
                <SmallSelect value={draft.workload.challengePreference} onChange={(value) => update('workload', 'challengePreference', value)} options={[
                  ['low', 'Prefer lighter ramp'],
                  ['medium', 'Balanced'],
                  ['high', 'Challenging is good'],
                ]} />
              </FieldRow>
              <CommitmentDetailFields commitments={draft.commitments} update={update} />
              <textarea
                value={draft.commitments.other}
                onChange={(event) => update('commitments', 'other', event.target.value)}
                placeholder="Other commitments"
                rows={2}
                style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', resize: 'vertical' }}
              />
            </ModalSection>

            <ModalSection title="Evaluation Preferences">
              <FieldRow label="Attendance">
                <SmallSelect value={draft.workload.attendanceImportance} onChange={(value) => update('workload', 'attendanceImportance', value)} options={[
                  ['low', 'Avoid attendance-heavy courses'],
                  ['medium', 'Some structure is fine'],
                  ['high', 'Attendance structure helps'],
                ]} />
              </FieldRow>
              <FieldRow label="Grading">
                <SmallSelect value={draft.workload.gradingImportance} onChange={(value) => update('workload', 'gradingImportance', value)} options={[
                  ['low', 'Not important'],
                  ['medium', 'Moderately important'],
                  ['high', 'Very important'],
                ]} />
              </FieldRow>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {[
                  ['preferLenientGrading', 'Lenient grading'],
                  ['avoidHarshCurves', 'Avoid harsh curves'],
                  ['preferClearRubrics', 'Clear rubrics'],
                ].map(([key, label]) => (
                  <TogglePill key={key} active={draft.gradingPreferences[key] === true} onClick={() => update('gradingPreferences', key, draft.gradingPreferences[key] === true ? null : true)}>{label}</TogglePill>
                ))}
              </div>
            </ModalSection>
          </div>

          <ModalSection title="Skill & Interest Matrix">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
              {TOPIC_FIELDS.map(([key, label]) => (
                <div key={key} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>{label}</div>
                  <PreferenceSlider label="Skill" value={draft.topicRatings[key]?.skill} onChange={(value) => updateTopic(key, 'skill', value)} />
                  <PreferenceSlider label="Interest" value={draft.topicRatings[key]?.interest} onChange={(value) => updateTopic(key, 'interest', value)} />
                </div>
              ))}
            </div>
          </ModalSection>

          <ModalSection title="Course Format Preferences">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              {FORMAT_FIELDS.map(([key, label]) => (
                <PreferenceSlider key={key} label={label} value={draft.formatPreferences[key]} onChange={(value) => update('formatPreferences', key, value)} />
              ))}
            </div>
          </ModalSection>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
            <ModalSection title="Direction Distribution">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                {DIRECTION_FIELDS.map(([key, label]) => (
                  <FieldRow key={key} label={label}>
                    <input
                      type="number"
                      min="0"
                      max="8"
                      value={draft.desiredCoursesPerDirection[key] ?? ''}
                      onChange={(event) => update('desiredCoursesPerDirection', key, event.target.value)}
                      placeholder="0"
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}
                    />
                  </FieldRow>
                ))}
              </div>
            </ModalSection>

            <ModalSection title="Freeform Notes">
              <textarea
                value={draft.freeformNotes}
                onChange={(event) => setDraft((current) => ({ ...current, freeformNotes: event.target.value }))}
                placeholder="Anything else the recommender should know"
                rows={7}
                style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', resize: 'vertical' }}
              />
            </ModalSection>
          </div>
          </>
          )}
        </div>

        <div style={{ padding: '13px 18px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            Answers save immediately; markdown personalization syncs quietly in the background.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {mode === 'guided' ? (
              <>
                <button className="btn btn-ghost" onClick={() => setMode('editor')} style={{ padding: '8px 14px' }}>Edit all</button>
                <button className="btn btn-ghost" onClick={guidedStep === 0 ? onClose : () => setGuidedStep((step) => step - 1)} style={{ padding: '8px 14px' }}>
                  {guidedStep === 0 ? 'Close' : 'Back'}
                </button>
                <button onClick={skipStep} style={{
                  padding: '8px 16px', borderRadius: 8,
                  border: '1px solid var(--accent)', background: 'var(--accent-soft)',
                  color: 'var(--accent)', fontWeight: 600,
                }}>
                  Skip
                </button>
                <button className="btn btn-primary" onClick={goNext} style={{ padding: '8px 16px' }}>
                  {guidedStep >= guidedKeys.length - 1 ? 'Save' : 'Next'}
                </button>
              </>
            ) : mode === 'followupIntro' ? (
              <>
                <button className="btn btn-ghost" onClick={() => setMode('guided')} style={{ padding: '8px 14px' }}>Back</button>
                <button onClick={save} style={{
                  padding: '8px 16px', borderRadius: 8,
                  border: '1px solid var(--accent)', background: 'var(--accent-soft)',
                  color: 'var(--accent)', fontWeight: 600,
                }}>
                  Skip
                </button>
                <button className="btn btn-primary" onClick={loadFollowUps} disabled={followUpLoading} style={{ padding: '8px 16px', opacity: followUpLoading ? 0.75 : 1 }}>
                  {followUpLoading ? 'Preparing...' : 'Ask me'}
                </button>
              </>
            ) : mode === 'followup' ? (
              <>
                <button className="btn btn-ghost" onClick={followUpStep === 0 ? () => setMode('followupIntro') : () => setFollowUpStep((step) => step - 1)} style={{ padding: '8px 14px' }}>Back</button>
                <button onClick={save} style={{
                  padding: '8px 16px', borderRadius: 8,
                  border: '1px solid var(--accent)', background: 'var(--accent-soft)',
                  color: 'var(--accent)', fontWeight: 600,
                }}>
                  Skip remaining
                </button>
                <button className="btn btn-primary" onClick={nextFollowUp} style={{ padding: '8px 16px' }}>
                  {followUpStep >= followUpQuestions.length - 1 ? 'Save' : 'Next'}
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-ghost" onClick={onClose} style={{ padding: '8px 14px' }}>Cancel</button>
                <button className="btn btn-primary" onClick={save} style={{ padding: '8px 16px' }}>Save</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const ModalSection = ({ title, children }) => (
  <section style={{ marginBottom: 18 }}>
    <div className="eyebrow" style={{ marginBottom: 10 }}>{title}</div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
  </section>
);

const FieldRow = ({ label, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
    {label}
    {children}
  </label>
);

const GuidedChoice = ({ title, value, onChange, options }) => (
  <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{title}</div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {options.map(([optionValue, label]) => (
        <button
          key={optionValue}
          type="button"
          onClick={() => onChange(optionValue)}
          style={{
            width: '100%', textAlign: 'left',
            padding: '9px 10px', borderRadius: 8,
            border: `1px solid ${value === optionValue ? 'var(--accent)' : 'var(--border)'}`,
            background: value === optionValue ? 'var(--accent-soft)' : 'var(--bg)',
            color: value === optionValue ? 'var(--accent)' : 'var(--text-secondary)',
            fontSize: 12,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  </div>
);

// ============== Recommendations panel (bottom-right) ==============
const Recommendations = ({ schedule, onAddCourse, onOpenCourse }) => {
  const [sort, setSort] = useState('match'); // match | workload | units
  const [recs, setRecs] = useState([]);
  const [recsStatus, setRecsStatus] = useState('loading');
  const [recsError, setRecsError] = useState('');
  const [personalizationOpen, setPersonalizationOpen] = useState(false);
  const { profile, setProfile, personalCourseMarkdown, setPersonalCourseMarkdown } = useApp();
  const personalization = profile?.preferences?.personalization;

  useEffect(() => {
    let cancelled = false;
    setRecsStatus('loading');
    setRecsError('');
    FRDATA.fetchCurrentRecommendations({
      schedule,
      profile,
      personalCourseMarkdown,
      maxResults: 40,
    }).then((courses) => {
      if (cancelled) return;
      setRecs(courses);
      setRecsStatus('ready');
    }).catch((error) => {
      if (cancelled) return;
      console.warn('[recommendations] personalized endpoint failed', error);
      setRecs([]);
      setRecsError(error?.message || 'Recommendations failed.');
      setRecsStatus('error');
    });
    return () => { cancelled = true; };
  }, [schedule.join('|'), JSON.stringify(profile?.taken || []), JSON.stringify(profile?.remainingReqs || []), JSON.stringify(personalization || {}), personalCourseMarkdown]);

  const sorted = [...recs].sort((a, b) => {
    if (sort === 'match') return (b.personalMatch?.total || FRDATA.getMatch(b.id).total) - (a.personalMatch?.total || FRDATA.getMatch(a.id).total);
    if (sort === 'workload') return a.hydrant - b.hydrant;
    return b.units - a.units;
  });

  const savePersonalization = (nextPersonalization) => {
    const nextProfile = {
      ...profile,
      preferences: {
        ...(profile.preferences || {}),
        personalization: nextPersonalization,
      },
    };
    setProfile(nextProfile);

    fetch('/api/onboarding/more-preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalCourseMarkdown: personalCourseMarkdown || localStorage.getItem('fr-personalcourse-draft') || '# personalcourse.md\n',
        questionnaire: nextPersonalization,
        freeformNotes: nextPersonalization.freeformNotes || '',
        normalizedData: nextPersonalization,
      }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) throw new Error(payload.error || 'Markdown personalization failed.');
        if (payload.personalCourseMarkdown) {
          setPersonalCourseMarkdown(payload.personalCourseMarkdown);
          localStorage.setItem('fr-personalcourse-draft', payload.personalCourseMarkdown);
        }
      })
      .catch((error) => {
        console.warn('[personalization] background markdown sync failed', error);
      });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '14px 18px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div className="eyebrow">Recommended for you</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
          <PersonalizationProgressButton personalization={personalization} onClick={() => setPersonalizationOpen(true)} />
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
      {personalizationOpen && (
        <FurtherPersonalizationModal
          personalization={personalization}
          personalCourseMarkdown={personalCourseMarkdown}
          onClose={() => setPersonalizationOpen(false)}
          onSave={savePersonalization}
        />
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {recsStatus === 'loading' && (
          <div style={{ padding: 18, fontSize: 13, color: 'var(--text-tertiary)' }}>
            Building recommendations from your saved course record...
          </div>
        )}
        {recsStatus === 'error' && (
          <div style={{ padding: 18, fontSize: 13, color: 'var(--accent)' }}>
            {recsError}
          </div>
        )}
        {recsStatus === 'ready' && sorted.length === 0 && (
          <div style={{ padding: 18, fontSize: 13, color: 'var(--text-tertiary)' }}>
            No recommendations yet. Add course history in onboarding or search manually from the schedule panel.
          </div>
        )}
        {sorted.map((c) => {
          const m = c.personalMatch || FRDATA.getMatch(c.id);
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
                {Array.isArray(c.recommendationReasons) && c.recommendationReasons.length > 0 && (
                  <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.recommendationReasons.slice(0, 2).join(' · ')}
                  </div>
                )}
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
