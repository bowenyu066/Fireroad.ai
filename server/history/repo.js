const { getDb } = require('./db');
const { normalizeCourseId, normalizeDocType, normalizeTerm } = require('./normalize');

function mapCourse(row) {
  if (!row) return null;
  return {
    id: row.id,
    currentTitle: row.current_title,
    department: row.department,
    area: row.area,
    currentUnits: row.current_units,
    currentDesc: row.current_desc,
  };
}

function mapAlias(row) {
  if (!row) return null;
  return {
    aliasId: row.alias_id,
    courseId: row.course_id,
    validFromTerm: row.valid_from_term,
    validToTerm: row.valid_to_term,
    source: row.source,
  };
}

function mapOffering(row) {
  if (!row) return null;
  return {
    id: row.id,
    courseId: row.course_id,
    term: row.term,
    titleSnapshot: row.title_snapshot,
    unitsSnapshot: row.units_snapshot,
    instructorText: row.instructor_text,
    hasHomepage: row.has_homepage === null ? null : Boolean(row.has_homepage),
    homepageUrl: row.homepage_url,
    syllabusUrl: row.syllabus_url,
    ocwUrl: row.ocw_url,
    notes: row.notes,
  };
}

function mapDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    offeringId: row.offering_id,
    docType: row.doc_type,
    url: row.url,
    archivedUrl: row.archived_url,
    fetchedAt: row.fetched_at,
    contentType: row.content_type,
    checksum: row.checksum,
    rawHtml: row.raw_html,
    rawText: row.raw_text,
  };
}

function mapAttendancePolicy(row) {
  if (!row) return null;
  return {
    id: row.id,
    offeringId: row.offering_id,
    attendanceRequired: row.attendance_required,
    attendanceCountsTowardGrade: row.attendance_counts_toward_grade,
    attendanceNotes: row.attendance_notes,
    evidenceDocumentId: row.evidence_document_id,
    evidenceText: row.evidence_text,
    confidence: row.confidence,
    reviewStatus: row.review_status,
  };
}

function mapGradingPolicy(row) {
  if (!row) return null;
  return {
    id: row.id,
    offeringId: row.offering_id,
    letterGrade: row.letter_grade,
    hasParticipationComponent: row.has_participation_component,
    participationWeight: row.participation_weight,
    homeworkWeight: row.homework_weight,
    projectWeight: row.project_weight,
    labWeight: row.lab_weight,
    quizWeight: row.quiz_weight,
    midtermWeight: row.midterm_weight,
    finalWeight: row.final_weight,
    dropLowestRuleText: row.drop_lowest_rule_text,
    latePolicyText: row.late_policy_text,
    collaborationPolicyText: row.collaboration_policy_text,
    gradingNotes: row.grading_notes,
    evidenceDocumentId: row.evidence_document_id,
    evidenceText: row.evidence_text,
    confidence: row.confidence,
    reviewStatus: row.review_status,
  };
}

function createHistoryRepo(database = getDb()) {
  return {
    getCourseById(courseId) {
      const id = normalizeCourseId(courseId);
      return mapCourse(database.prepare('SELECT * FROM courses WHERE id = ?').get(id));
    },

    getCourseAliases(courseId) {
      const id = normalizeCourseId(courseId);
      return database.prepare('SELECT * FROM course_aliases WHERE course_id = ? ORDER BY alias_id').all(id).map(mapAlias);
    },

    listCourseOfferings(courseId) {
      const id = normalizeCourseId(courseId);
      return database.prepare('SELECT * FROM offerings WHERE course_id = ? ORDER BY term DESC, id DESC').all(id).map(mapOffering);
    },

    getOfferingById(offeringId) {
      return mapOffering(database.prepare('SELECT * FROM offerings WHERE id = ?').get(Number(offeringId)));
    },

    listOfferingDocuments(offeringId) {
      return database.prepare('SELECT * FROM documents WHERE offering_id = ? ORDER BY id DESC').all(Number(offeringId)).map(mapDocument);
    },

    getLatestAttendancePolicy(offeringId) {
      return mapAttendancePolicy(database.prepare('SELECT * FROM attendance_policies WHERE offering_id = ? ORDER BY id DESC LIMIT 1').get(Number(offeringId)));
    },

    getLatestGradingPolicy(offeringId) {
      return mapGradingPolicy(database.prepare('SELECT * FROM grading_policies WHERE offering_id = ? ORDER BY id DESC LIMIT 1').get(Number(offeringId)));
    },

    getCoursePolicyStats(courseId) {
      const id = normalizeCourseId(courseId);
      return database.prepare(`
        SELECT
          COUNT(DISTINCT o.id) AS offering_count,
          COUNT(DISTINCT ap.offering_id) AS attendance_policy_count,
          COUNT(DISTINCT gp.offering_id) AS grading_policy_count
        FROM offerings o
        LEFT JOIN attendance_policies ap ON ap.offering_id = o.id
        LEFT JOIN grading_policies gp ON gp.offering_id = o.id
        WHERE o.course_id = ?
      `).get(id);
    },

    getHistoryStats() {
      const one = (sql) => database.prepare(sql).get().count;
      return {
        courses: one('SELECT COUNT(*) AS count FROM courses'),
        aliases: one('SELECT COUNT(*) AS count FROM course_aliases'),
        offerings: one('SELECT COUNT(*) AS count FROM offerings'),
        documents: one('SELECT COUNT(*) AS count FROM documents'),
        attendancePolicies: one('SELECT COUNT(*) AS count FROM attendance_policies'),
        gradingPolicies: one('SELECT COUNT(*) AS count FROM grading_policies'),
        extractionRuns: one('SELECT COUNT(*) AS count FROM extraction_runs'),
      };
    },

    upsertCourse(course) {
      const id = normalizeCourseId(course.id);
      database.prepare(`
        INSERT INTO courses (id, current_title, department, area, current_units, current_desc)
        VALUES (@id, @current_title, @department, @area, @current_units, @current_desc)
        ON CONFLICT(id) DO UPDATE SET
          current_title = excluded.current_title,
          department = excluded.department,
          area = excluded.area,
          current_units = excluded.current_units,
          current_desc = excluded.current_desc
      `).run({
        id,
        current_title: course.currentTitle || course.current_title || null,
        department: course.department || null,
        area: course.area || null,
        current_units: course.currentUnits || course.current_units || null,
        current_desc: course.currentDesc || course.current_desc || null,
      });
      return this.getCourseById(id);
    },

    // Future import_offering_manifest can call this instead of writing SQL in scripts.
    upsertOffering(offering) {
      const courseId = normalizeCourseId(offering.courseId || offering.course_id);
      const term = normalizeTerm(offering.term);
      const existing = database.prepare('SELECT id FROM offerings WHERE course_id = ? AND term = ?').get(courseId, term);
      if (existing) return this.getOfferingById(existing.id);

      const result = database.prepare(`
        INSERT INTO offerings (
          course_id, term, title_snapshot, units_snapshot, instructor_text,
          has_homepage, homepage_url, syllabus_url, ocw_url, notes
        )
        VALUES (
          @course_id, @term, @title_snapshot, @units_snapshot, @instructor_text,
          @has_homepage, @homepage_url, @syllabus_url, @ocw_url, @notes
        )
      `).run({
        course_id: courseId,
        term,
        title_snapshot: offering.titleSnapshot || offering.title_snapshot || null,
        units_snapshot: offering.unitsSnapshot || offering.units_snapshot || null,
        instructor_text: offering.instructorText || offering.instructor_text || null,
        has_homepage: typeof offering.hasHomepage === 'boolean' ? Number(offering.hasHomepage) : offering.has_homepage ?? null,
        homepage_url: offering.homepageUrl || offering.homepage_url || null,
        syllabus_url: offering.syllabusUrl || offering.syllabus_url || null,
        ocw_url: offering.ocwUrl || offering.ocw_url || null,
        notes: offering.notes || null,
      });
      return this.getOfferingById(result.lastInsertRowid);
    },

    // Future fetch_documents can call this after downloading/archiving source docs.
    createDocument(document) {
      const result = database.prepare(`
        INSERT INTO documents (
          offering_id, doc_type, url, archived_url, fetched_at,
          content_type, checksum, raw_html, raw_text
        )
        VALUES (
          @offering_id, @doc_type, @url, @archived_url, @fetched_at,
          @content_type, @checksum, @raw_html, @raw_text
        )
      `).run({
        offering_id: Number(document.offeringId || document.offering_id),
        doc_type: normalizeDocType(document.docType || document.doc_type),
        url: document.url || null,
        archived_url: document.archivedUrl || document.archived_url || null,
        fetched_at: document.fetchedAt || document.fetched_at || new Date().toISOString(),
        content_type: document.contentType || document.content_type || null,
        checksum: document.checksum || null,
        raw_html: document.rawHtml || document.raw_html || null,
        raw_text: document.rawText || document.raw_text || null,
      });
      return mapDocument(database.prepare('SELECT * FROM documents WHERE id = ?').get(result.lastInsertRowid));
    },

    // Future extract_policies should insert extraction_runs and then reviewed policy rows.
  };
}

module.exports = {
  createHistoryRepo,
};
