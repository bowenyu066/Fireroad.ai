PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  current_title TEXT,
  department TEXT,
  area TEXT,
  current_units INTEGER,
  current_desc TEXT
);

CREATE TABLE IF NOT EXISTS course_aliases (
  alias_id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  valid_from_term TEXT,
  valid_to_term TEXT,
  source TEXT,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS offerings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id TEXT NOT NULL,
  term TEXT NOT NULL,
  title_snapshot TEXT,
  units_snapshot INTEGER,
  instructor_text TEXT,
  has_homepage INTEGER,
  homepage_url TEXT,
  syllabus_url TEXT,
  ocw_url TEXT,
  notes TEXT,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offering_id INTEGER NOT NULL,
  doc_type TEXT NOT NULL,
  url TEXT,
  archived_url TEXT,
  fetched_at TEXT,
  content_type TEXT,
  checksum TEXT,
  raw_html TEXT,
  raw_text TEXT,
  FOREIGN KEY (offering_id) REFERENCES offerings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attendance_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offering_id INTEGER NOT NULL,
  attendance_required TEXT,
  attendance_counts_toward_grade TEXT,
  attendance_notes TEXT,
  evidence_document_id INTEGER,
  evidence_text TEXT,
  confidence REAL,
  review_status TEXT DEFAULT 'auto',
  FOREIGN KEY (offering_id) REFERENCES offerings(id) ON DELETE CASCADE,
  FOREIGN KEY (evidence_document_id) REFERENCES documents(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS grading_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offering_id INTEGER NOT NULL,
  letter_grade TEXT,
  has_participation_component TEXT,
  participation_weight REAL,
  homework_weight REAL,
  project_weight REAL,
  lab_weight REAL,
  quiz_weight REAL,
  midterm_weight REAL,
  final_weight REAL,
  drop_lowest_rule_text TEXT,
  late_policy_text TEXT,
  collaboration_policy_text TEXT,
  grading_notes TEXT,
  evidence_document_id INTEGER,
  evidence_text TEXT,
  confidence REAL,
  review_status TEXT DEFAULT 'auto',
  FOREIGN KEY (offering_id) REFERENCES offerings(id) ON DELETE CASCADE,
  FOREIGN KEY (evidence_document_id) REFERENCES documents(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS extraction_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  model TEXT,
  prompt_version TEXT,
  raw_model_output TEXT,
  parsed_json TEXT,
  status TEXT,
  created_at TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_course_aliases_course_id ON course_aliases(course_id);
CREATE INDEX IF NOT EXISTS idx_offerings_course_id ON offerings(course_id);
CREATE INDEX IF NOT EXISTS idx_offerings_term ON offerings(term);
CREATE INDEX IF NOT EXISTS idx_documents_offering_id ON documents(offering_id);
CREATE INDEX IF NOT EXISTS idx_attendance_policies_offering_id ON attendance_policies(offering_id);
CREATE INDEX IF NOT EXISTS idx_grading_policies_offering_id ON grading_policies(offering_id);
CREATE INDEX IF NOT EXISTS idx_extraction_runs_document_id ON extraction_runs(document_id);
