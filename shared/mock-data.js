// Shared Fireroad demo data for both the browser prototype and Node backend.
(function (root, factory) {
  const data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  root.FRMOCKDATA = data;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const COURSE_AREA = (id) => {
    if (id.startsWith('6.')) return 'cs';
    if (id.startsWith('18.')) return 'math';
    if (id.startsWith('8.')) return 'physics';
    if (id.startsWith('7.')) return 'bio';
    if (id.startsWith('21') || id.startsWith('24') || id.startsWith('17') || id.startsWith('14') || id.startsWith('15')) return 'hass';
    return 'other';
  };

  const profile = {
    name: 'Alex Chen',
    kerberos: 'alexc',
    major: 'Course 6-3',
    majorLabel: 'Computer Science & Engineering',
    year: 'Sophomore',
    gradYear: 2027,
    taken: ['6.006', '18.06', '6.009', '8.02', '18.02', '6.100A', '21H.001'],
    calibration: 0.85,
    preferences: {
      goal: 'research',
      style: 'theory',
      math: 'strong',
    },
    remainingReqs: ['CI-M', 'REST', 'AUS', 'HASS-A', 'HASS-S'],
  };

  const catalog = [
    {
      id: '6.3900',
      name: 'Introduction to Machine Learning',
      units: 12,
      schedule: 'MWF 11-12',
      days: ['M', 'W', 'F'],
      time: { start: 11, end: 12 },
      instructor: 'Tommi Jaakkola, Regina Barzilay',
      satisfies: ['CI-M', 'REST'],
      prereqs: ['18.06', '6.3800'],
      hydrant: 11.2,
      rating: { overall: 4.2, lectures: 4.0, difficulty: 3.8, n: 412 },
      desc: 'Introduces principles, algorithms and applications of machine learning. Topics include linear models, neural networks, optimization, regularization, and probabilistic methods. Strong emphasis on both theory and implementation through projects and problem sets.',
      topics: [
        { weeks: '1-3', title: 'Linear regression, gradient descent, regularization' },
        { weeks: '4-6', title: 'Classification, logistic regression, SVMs' },
        { weeks: '7-9', title: 'Neural networks and backpropagation' },
        { weeks: '10-12', title: 'Probabilistic models, EM, Bayesian inference' },
        { weeks: '13-14', title: 'Reinforcement learning, project presentations' },
      ],
      quote: 'Great balance of theory and implementation. Psets are hard but very worth it.',
    },
    {
      id: '6.7900',
      name: 'Machine Learning',
      units: 12,
      schedule: 'TR 1-2:30',
      days: ['T', 'R'],
      time: { start: 13, end: 14.5 },
      instructor: 'Caroline Uhler',
      satisfies: ['REST'],
      prereqs: ['18.06', '6.3700'],
      hydrant: 14.2,
      rating: { overall: 4.0, lectures: 4.1, difficulty: 4.4, n: 286 },
      desc: 'Graduate-level machine learning. Probabilistic and statistical foundations, generalization theory, kernel methods, deep learning theory, and modern topics in representation learning.',
      topics: [
        { weeks: '1-3', title: 'PAC learning, VC dimension' },
        { weeks: '4-6', title: 'Kernel methods, SVMs' },
        { weeks: '7-9', title: 'Neural networks, optimization theory' },
        { weeks: '10-14', title: 'Generative models, representation learning' },
      ],
      quote: 'Rigorous and theory-heavy. Expect long psets - the math is no joke.',
    },
    {
      id: '6.1010',
      name: 'Fundamentals of Programming',
      units: 12,
      schedule: 'MWF 1-2',
      days: ['M', 'W', 'F'],
      time: { start: 13, end: 14 },
      instructor: 'Adam Hartz, Ana Bell',
      satisfies: [],
      prereqs: ['6.100A'],
      hydrant: 11.0,
      rating: { overall: 4.4, lectures: 4.3, difficulty: 3.4, n: 521 },
      desc: 'Continuation of 6.100A. Covers procedural and data abstraction, recursion, OOP, and program design. Emphasizes Python and software engineering practices.',
      topics: [],
      quote: 'Solid intro CS. Good preparation for 6.1020 and other CS classes.',
    },
    {
      id: '6.3800',
      name: 'Introduction to Inference',
      units: 12,
      schedule: 'TR 9:30-11',
      days: ['T', 'R'],
      time: { start: 9.5, end: 11 },
      instructor: 'Polina Golland',
      satisfies: ['REST'],
      prereqs: ['18.06', '6.3700'],
      hydrant: 12.5,
      rating: { overall: 4.1, lectures: 3.9, difficulty: 4.0, n: 198 },
      desc: 'Foundations of statistical inference and probabilistic modeling. Bayesian and frequentist methods, hypothesis testing, MLE, and an introduction to graphical models.',
      topics: [],
      quote: 'Heavy on probability theory but very rewarding for ML-bound students.',
    },
    {
      id: '6.S898',
      name: 'Deep Learning',
      units: 12,
      schedule: 'TR 2:30-4',
      days: ['T', 'R'],
      time: { start: 14.5, end: 16 },
      instructor: 'Phillip Isola',
      satisfies: [],
      prereqs: ['6.3900'],
      hydrant: 13.8,
      rating: { overall: 4.6, lectures: 4.7, difficulty: 4.2, n: 142 },
      desc: 'Modern deep learning: CNNs, transformers, generative models, self-supervised learning, and recent research directions.',
      topics: [],
      quote: 'Best class I took at MIT. Cutting-edge content and great projects.',
    },
    {
      id: '18.404',
      name: 'Theory of Computation',
      units: 12,
      schedule: 'MWF 2-3',
      days: ['M', 'W', 'F'],
      time: { start: 14, end: 15 },
      instructor: 'Michael Sipser',
      satisfies: ['REST'],
      prereqs: ['18.200'],
      hydrant: 10.5,
      rating: { overall: 4.5, lectures: 4.8, difficulty: 3.6, n: 178 },
      desc: 'Automata, computability, and complexity theory. A foundational class for theoretical CS.',
      topics: [],
      quote: 'Sipser is a legend. Beautiful proofs, well-paced.',
    },
    {
      id: '21M.301',
      name: 'Harmony and Counterpoint I',
      units: 12,
      schedule: 'TR 2-3:30',
      days: ['T', 'R'],
      time: { start: 14, end: 15.5 },
      instructor: 'Charles Shadle',
      satisfies: ['HASS-A'],
      prereqs: [],
      hydrant: 8.0,
      rating: { overall: 4.7, lectures: 4.5, difficulty: 3.0, n: 64 },
      desc: 'Foundational tonal harmony, voice leading, and counterpoint. Good for HASS-A.',
      topics: [],
      quote: 'Lovely break from the firehose - actually relaxing.',
    },
    {
      id: '14.01',
      name: 'Principles of Microeconomics',
      units: 12,
      schedule: 'MW 9:30-11',
      days: ['M', 'W'],
      time: { start: 9.5, end: 11 },
      instructor: 'Frank Schilbach',
      satisfies: ['HASS-S'],
      prereqs: [],
      hydrant: 9.5,
      rating: { overall: 4.3, lectures: 4.4, difficulty: 3.2, n: 312 },
      desc: 'Introductory microeconomics: supply and demand, consumer theory, firm behavior, market structure, and welfare economics.',
      topics: [],
      quote: 'Great intro. Lectures are well-organized and engaging.',
    },
  ];

  const takenStubs = [
    { id: '6.100A', name: 'Intro to CS Programming in Python', units: 6 },
    { id: '6.006', name: 'Intro to Algorithms', units: 12 },
    { id: '6.009', name: 'Fundamentals of Programming', units: 12 },
    { id: '18.02', name: 'Multivariable Calculus', units: 12 },
    { id: '18.06', name: 'Linear Algebra', units: 12 },
    { id: '8.02', name: 'Physics II', units: 12 },
    { id: '21H.001', name: 'How to Stage a Revolution', units: 12 },
  ];

  takenStubs.forEach((s) => {
    if (!catalog.find((c) => c.id === s.id)) {
      catalog.push({
        ...s,
        schedule: '-',
        days: [],
        time: { start: 0, end: 0 },
        instructor: '-',
        satisfies: [],
        prereqs: [],
        hydrant: 0,
        rating: { overall: 0, lectures: 0, difficulty: 0, n: 0 },
        desc: '',
        topics: [],
        quote: '',
        _stub: true,
      });
    }
  });

  catalog.forEach((c) => {
    c.area = COURSE_AREA(c.id);
  });

  const matchScores = {
    '6.3900': { total: 95, interest: 40, workload: 28, reqValue: 27 },
    '6.7900': { total: 78, interest: 38, workload: 18, reqValue: 22 },
    '6.1010': { total: 82, interest: 30, workload: 26, reqValue: 26 },
    '6.3800': { total: 88, interest: 36, workload: 24, reqValue: 28 },
    '6.S898': { total: 91, interest: 40, workload: 22, reqValue: 29 },
    '18.404': { total: 84, interest: 36, workload: 26, reqValue: 22 },
    '21M.301': { total: 71, interest: 26, workload: 27, reqValue: 18 },
    '14.01': { total: 76, interest: 28, workload: 26, reqValue: 22 },
  };

  const fourYearPlan = {
    F23: ['6.100A', '18.02', '8.02', '21H.001'],
    S24: ['6.006', '18.06', '6.009'],
    F24: [],
    S25: [],
    F25: [],
    S26: [],
    F26: [],
    S27: [],
  };

  const semesterLabels = {
    F23: 'Fall 2023',
    S24: 'Spring 2024',
    F24: 'Fall 2024',
    S25: 'Spring 2025',
    F25: 'Fall 2025',
    S26: 'Spring 2026',
    F26: 'Fall 2026',
    S27: 'Spring 2027',
  };
  const semesterOrder = ['F23', 'S24', 'F24', 'S25', 'F25', 'S26', 'F26', 'S27'];

  const agentMessages = [
    {
      role: 'agent',
      text: "Hi Alex - I read your transcript and preferences. Based on your strong math background and ML research goals, I'd start with 6.3900 (Intro to ML) for next semester. It's project-based with solid theory, and your calibration suggests ~9.5 hrs/week - well within your bandwidth. Want me to add it?",
      suggestions: ['6.3900'],
    },
  ];

  const allReqs = [
    { id: 'GIR-Calc', label: 'Calculus I/II', done: true },
    { id: 'GIR-Phys', label: 'Physics I/II', done: true },
    { id: 'GIR-Chem', label: 'Chemistry', done: false },
    { id: 'GIR-Bio', label: 'Biology', done: false },
    { id: 'CI-H', label: 'Communication-Intensive HASS', done: true },
    { id: 'CI-M', label: 'Communication-Intensive Major', done: false },
    { id: 'REST', label: 'REST elective', done: false },
    { id: 'LAB', label: 'Laboratory', done: false },
    { id: 'HASS-A', label: 'HASS Arts', done: false },
    { id: 'HASS-S', label: 'HASS Social Sciences', done: false },
    { id: 'HASS-H', label: 'HASS Humanities', done: true },
    { id: '6-3-Core', label: '6-3 Core', done: false, sub: '5/9 done' },
    { id: '6-3-AAGS', label: '6-3 AAGS', done: false, sub: '0/2 done' },
    { id: 'AUS', label: 'Advanced Undergrad Subject', done: false },
  ];

  return {
    profile,
    catalog,
    matchScores,
    fourYearPlan,
    semesterLabels,
    semesterOrder,
    agentMessages,
    allReqs,
  };
});
