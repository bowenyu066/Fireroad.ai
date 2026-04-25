# Fireroad.ai — Claude Design Brief

## What We're Building
An AI-powered MIT course planner called **Fireroad.ai**. Students describe their goals and preferences in natural language, upload their transcript, and the AI agent recommends a personalized active-semester course schedule. The current product focus is active-semester planning: `fourYearPlan[activeSem]` is the editable surface for recommendations, workload tradeoffs, requirement checks, and schedule changes. The app persists the full `fourYearPlan` object so term-aware state survives future work, but there is no cross-semester drag/drop workflow in the main product path. A legacy read-only long-range display interface may remain in code for future work, but it is not part of the active UI. The app also scores every course on a 0–100 match scale so students can compare options at a glance.

Target users: MIT undergraduates and MEng students.

---

## Aesthetic Direction
- **Tone**: Clean, academic, intelligent. Think Linear meets MIT aesthetics — precise, dark-mode-first, with subtle MIT-red accents. Not playful, not corporate. It should feel like a tool a serious student would trust.
- **Color palette**:
  - Background: `#0D0F12` (near-black)
  - Surface: `#161A20`
  - Border: `#252A32`
  - Accent: `#A31F34` (MIT red)
  - Text primary: `#F0F2F5`
  - Text secondary: `#8A8F9A`
  - Success/match green: `#22C55E`
  - Warning amber: `#F59E0B`
- **Typography**: Use a refined sans-serif like `DM Sans` or `Sora` for body; a geometric display font like `Space Grotesk` or `Outfit` for headings. Never Inter or Arial.
- **Motion**: Subtle fade-ins on page load, smooth panel transitions, hover states on course cards. Nothing flashy.

---

## Page 1 — Onboarding (Intro Page)

This is the first page users see. It should feel welcoming but efficient — not a long form, but a smart conversation.

### Layout
Full-screen centered layout. Progress indicator at top (3 steps: Profile → Transcript → Preferences).

### Step 1: Basic Profile
```
Fields:
- Name (text input)
- MIT major/program (dropdown: Course 6-2, Course 6-3, Course 6-7, Course 18, etc.)
- Current year (dropdown: Freshman, Sophomore, Junior, Senior, MEng)
- Goal this semester (radio):
    ○ Fulfill graduation requirements
    ○ Explore new areas
    ○ Both
```

### Step 2: Transcript Upload (Interactive Agent Step)
```
A drag-and-drop upload zone for unofficial PDF transcript.
Below it: "Or manually enter courses you've taken"

After upload, show a loading state: "Agent is reading your transcript..."
Then display extracted courses as editable chips:
  [6.006 ×]  [18.06 ×]  [6.009 ×]  [+ Add course]

User can remove incorrect ones or add missing ones.
```

### Step 3: Preferences (4 Questions)
```
Q1: What's your goal with ML/AI courses?
  ○ I want to do ML research
  ○ I want to apply ML to another field  
  ○ I want to work in ML engineering
  ○ Just curious / exploring

Q2: Learning style:
  ○ I like theory and proofs (psets, derivations)
  ○ I like building things (projects, implementations)
  ○ Mix of both

Q3: Math background strength:
  ○ Very strong (did math olympiad / took real analysis)
  ○ Solid (18.06 felt manageable)
  ○ Needs work

Q4: Workload calibration — pick a course you've taken and how it felt:
  Course: [dropdown of their taken courses]
  How hard was it?  ○ Easy  ○ Normal  ○ Very hard
```

**CTA button**: "Build My Plan →" (MIT red, full width, bottom of step 3)

---

## Page 2 — Main Planner (Core Experience)

This is the main app view. **Two-panel layout**: left panel for the schedule, right panel for the agent chatbot.

### Top Bar
```
Logo "fireroad.ai" (top left)
Current context pill (top center): [Next Semester planner]
User avatar + name (top right)
```

### Left Panel — Schedule View

```
Header: "Next Semester"
Below: a vertical list of added courses

Each course card shows:
┌─────────────────────────────────────────────┐
│  6.3900  Introduction to Machine Learning   │
│  MWF 11am–12pm  •  12 units                │
│  Match score: ████████░░  82/100            │
│  Satisfies: CI-M, REST                      │
│  Est. workload: ~10h/week for you           │
│  [double-click to remove]                   │
└─────────────────────────────────────────────┘

At bottom of list:
  Total units: 48
  Requirement progress: CI-M ✓  REST ✓  2 remaining

[+ Add course manually] button
Toggle: [Manual mode] [Agent mode]  ← toggle switch
```

### Right Panel — Agent + Recommendations

**Top half: Chatbot**
```
Chat history area (scrollable)
Example messages:
  User: "I want to take an ML course but nothing too heavy on psets"
  Agent: "Based on your profile, I recommend 6.3900 over 6.7900.
          6.3900 is more project-based and given your calibration,
          should take ~9hrs/week. Want me to add it?"

Input area at bottom:
  [📎 Attach file] [Type a message...] [Send →]
```

**Bottom half: Recommended Courses (sorted by match score)**
```
Compact list, sorted by match score descending:

  6.3900  Intro to ML           ██████████  95/100  [+ Add]
  6.1010  Fundamentals of Prog  ████████░░  82/100  [+ Add]
  6.3800  Introduction to Inf.  ███████░░░  74/100  [+ Add]
  ...

Each row is clickable → opens Course Detail Page
Sort controls: [Match Score ▾] [Workload] [Units]
```

---

## Page 3 — Course Detail Page

Opens when user clicks a course. Can be a modal overlay or a new page.

Course Detail has two tabs:
- `Current`: current catalog/Fireroad snapshot plus personalized fit for the next-semester plan.
- `Historical`: read-only historical offerings, documents, attendance, grading, evidence, confidence, and review status.

### Layout: Two columns

**Left column (60%)**
```
Course number + name (large heading)
  6.3900 — Introduction to Machine Learning

Short description (2-3 sentences from catalog)

Requirements satisfied:
  ✓ CI-M     ✓ REST     — AUS

Prerequisites:
  Required: 18.06, 6.3800
  Your status: ✓ 18.06 taken  ✗ 6.3800 not taken  ← warn if missing

Syllabus topics (expandable list):
  Week 1-3: Linear regression, gradient descent
  Week 4-6: Neural networks
  ...

Instructor: Prof. Tommi Jaakkola
  [Link to faculty page]
```

**Right column (40%)**
```
Match Score Card:
  ┌─────────────────────────┐
  │      82 / 100           │
  │  ████████░░  Match      │
  │                         │
  │  Interest fit:    40/40 │
  │  Workload fit:    22/30 │
  │  Req value:       20/30 │
  └─────────────────────────┘

Workload estimate:
  Hydrant avg:    11.2 hrs/week
  Your estimate:  ~9.5 hrs/week
  (based on your calibration)

Student ratings (from Hydrant/evaluations):
  Overall:     4.2 / 5.0  ★★★★☆
  Lectures:    4.0 / 5.0  ★★★★☆
  Difficulty:  3.8 / 5.0

Student quote:
  "Great balance of theory and implementation. 
   Psets are hard but very worth it." — Student review

[+ Add to Schedule]  [← Back]
```

---

## Interactions & Micro-interactions

- Course cards on main page: hover lifts slightly (box-shadow), cursor changes to pointer
- Double-clicking a course card on the schedule removes it with a fade-out animation
- Match score bars animate in on page load (left to right fill)
- Agent chat: typing indicator (three dots) while LLM is thinking
- Transcript upload: drag-over state changes border color to MIT red
- When agent adds a course to the schedule, the card slides in from the right panel to the left panel

---

## Mock Data to Use for Demo

### User Profile
```json
{
  "name": "Alex Chen",
  "major": "Course 6-3",
  "year": "Sophomore",
  "taken_courses": ["6.006", "18.06", "6.009", "8.02"],
  "calibration_coefficient": 0.85,
  "preferences": {
    "goal": "ML research",
    "style": "theory",
    "math_strength": "strong"
  },
  "remaining_reqs": ["CI-M", "REST", "AUS", "2x HASS"]
}
```

### Sample Recommended Courses
```json
[
  {
    "id": "6.3900",
    "name": "Introduction to Machine Learning",
    "units": 12,
    "schedule": "MWF 11am-12pm",
    "match_score": 95,
    "estimated_hours": 9.5,
    "satisfies": ["CI-M", "REST"],
    "prereqs_met": true
  },
  {
    "id": "6.7900",
    "name": "Machine Learning",
    "units": 12,
    "schedule": "TR 1-2:30pm",
    "match_score": 78,
    "estimated_hours": 14.2,
    "satisfies": ["REST"],
    "prereqs_met": true
  },
  {
    "id": "6.1010",
    "name": "Fundamentals of Programming",
    "units": 12,
    "schedule": "MWF 1-2pm",
    "match_score": 82,
    "estimated_hours": 11.0,
    "satisfies": [],
    "prereqs_met": true
  }
]
```

---

## Technical Notes for Implementation
- Framework: React + TypeScript preferred
- The left and right panels should be resizable (draggable divider)
- All LLM calls go to `POST /api/chat` and `POST /api/score-courses` — use mock responses for now
- State: selected courses live in global state (Zustand or Context)
- The match score bars should animate on mount using CSS transitions
- Export syllabus button generates a PDF with the current semester's courses
- Mobile responsiveness is NOT required for the hackathon demo
