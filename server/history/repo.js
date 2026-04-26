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

function mapExtractionRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    documentId: row.document_id,
    model: row.model,
    promptVersion: row.prompt_version,
    rawModelOutput: row.raw_model_output,
    parsedJson: row.parsed_json,
    status: row.status,
    createdAt: row.created_at,
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

    deleteCourseHistory(courseId) {
      const id = normalizeCourseId(courseId);
      database.prepare('DELETE FROM courses WHERE id = ?').run(id);
    },

    listCourseOfferings(courseId) {
      const id = normalizeCourseId(courseId);
      return database.prepare(`
        SELECT * FROM offerings
        WHERE course_id = ?
        ORDER BY
          CASE
            WHEN term GLOB '[0-9][0-9][0-9][0-9]*' THEN substr(term, 1, 4)
            ELSE term
          END DESC,
          CASE
            WHEN term LIKE '%FA' THEN 4
            WHEN term LIKE '%SU' THEN 3
            WHEN term LIKE '%SP' THEN 2
            WHEN term LIKE '%IAP' THEN 1
            ELSE 0
          END DESC,
          id DESC
      `).all(id).map(mapOffering);
    },

    getOfferingById(offeringId) {
      return mapOffering(database.prepare('SELECT * FROM offerings WHERE id = ?').get(Number(offeringId)));
    },

    getOfferingByCourseTerm(courseId, term) {
      return mapOffering(database.prepare('SELECT * FROM offerings WHERE course_id = ? AND term = ?').get(normalizeCourseId(courseId), normalizeTerm(term)));
    },

    listOfferingDocuments(offeringId) {
      return database.prepare('SELECT * FROM documents WHERE offering_id = ? ORDER BY id DESC').all(Number(offeringId)).map(mapDocument);
    },

    getLatestExtractionRun(documentId) {
      return mapExtractionRun(database.prepare('SELECT * FROM extraction_runs WHERE document_id = ? ORDER BY id DESC LIMIT 1').get(Number(documentId)));
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
          COUNT(DISTINCT CASE WHEN o.homepage_url IS NOT NULL AND o.homepage_url != '' THEN o.id END) AS homepage_count,
          COUNT(DISTINCT CASE WHEN o.syllabus_url IS NOT NULL AND o.syllabus_url != '' THEN o.id END) AS syllabus_count,
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

    upsertAlias(alias) {
      const aliasId = normalizeCourseId(alias.aliasId || alias.alias_id || alias.id);
      const courseId = normalizeCourseId(alias.courseId || alias.course_id);
      if (!aliasId || !courseId) return null;

      database.prepare(`
        INSERT INTO course_aliases (alias_id, course_id, valid_from_term, valid_to_term, source)
        VALUES (@alias_id, @course_id, @valid_from_term, @valid_to_term, @source)
        ON CONFLICT(alias_id) DO UPDATE SET
          course_id = excluded.course_id,
          valid_from_term = excluded.valid_from_term,
          valid_to_term = excluded.valid_to_term,
          source = excluded.source
      `).run({
        alias_id: aliasId,
        course_id: courseId,
        valid_from_term: alias.validFromTerm || alias.valid_from_term || null,
        valid_to_term: alias.validToTerm || alias.valid_to_term || null,
        source: alias.source || 'manifest',
      });

      return mapAlias(database.prepare('SELECT * FROM course_aliases WHERE alias_id = ?').get(aliasId));
    },

    // Future import_offering_manifest can call this instead of writing SQL in scripts.
    upsertOffering(offering) {
      const courseId = normalizeCourseId(offering.courseId || offering.course_id);
      const term = normalizeTerm(offering.term);
      const existing = database.prepare('SELECT id FROM offerings WHERE course_id = ? AND term = ?').get(courseId, term);
      const row = {
        course_id: courseId,
        term,
        title_snapshot: offering.titleSnapshot || offering.title_snapshot || null,
        units_snapshot: offering.unitsSnapshot || offering.units_snapshot || null,
        instructor_text: offering.instructorText || offering.instructor_text || null,
        has_homepage: typeof offering.hasHomepage === 'boolean'
          ? Number(offering.hasHomepage)
          : offering.has_homepage ?? (offering.homepageUrl || offering.homepage_url ? 1 : null),
        homepage_url: offering.homepageUrl || offering.homepage_url || null,
        syllabus_url: offering.syllabusUrl || offering.syllabus_url || null,
        ocw_url: offering.ocwUrl || offering.ocw_url || null,
        notes: offering.notes || null,
      };

      if (existing) {
        database.prepare(`
          UPDATE offerings SET
            title_snapshot = @title_snapshot,
            units_snapshot = @units_snapshot,
            instructor_text = @instructor_text,
            has_homepage = @has_homepage,
            homepage_url = @homepage_url,
            syllabus_url = @syllabus_url,
            ocw_url = @ocw_url,
            notes = @notes
          WHERE id = @id
        `).run({ ...row, id: existing.id });
        return this.getOfferingById(existing.id);
      }

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
        ...row,
      });
      return this.getOfferingById(result.lastInsertRowid);
    },

    getDocumentByChecksum(checksum) {
      if (!checksum) return null;
      return mapDocument(database.prepare('SELECT * FROM documents WHERE checksum = ? ORDER BY id DESC LIMIT 1').get(checksum));
    },

    getOfferingDocumentByChecksum(offeringId, checksum) {
      if (!checksum) return null;
      return mapDocument(database.prepare('SELECT * FROM documents WHERE offering_id = ? AND checksum = ? ORDER BY id DESC LIMIT 1').get(Number(offeringId), checksum));
    },

    // Future fetch_documents can call this after downloading/archiving source docs.
    createDocument(document) {
      const checksum = document.checksum || null;
      const existing = checksum ? this.getOfferingDocumentByChecksum(document.offeringId || document.offering_id, checksum) : null;
      if (existing) return existing;

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
        checksum,
        raw_html: document.rawHtml || document.raw_html || null,
        raw_text: document.rawText || document.raw_text || null,
      });
      return mapDocument(database.prepare('SELECT * FROM documents WHERE id = ?').get(result.lastInsertRowid));
    },

    createExtractionRun(run) {
      const result = database.prepare(`
        INSERT INTO extraction_runs (
          document_id, model, prompt_version, raw_model_output,
          parsed_json, status, created_at
        )
        VALUES (
          @document_id, @model, @prompt_version, @raw_model_output,
          @parsed_json, @status, @created_at
        )
      `).run({
        document_id: Number(run.documentId || run.document_id),
        model: run.model || null,
        prompt_version: run.promptVersion || run.prompt_version || null,
        raw_model_output: run.rawModelOutput || run.raw_model_output || null,
        parsed_json: run.parsedJson || run.parsed_json || null,
        status: run.status || 'unknown',
        created_at: run.createdAt || run.created_at || new Date().toISOString(),
      });
      return database.prepare('SELECT * FROM extraction_runs WHERE id = ?').get(result.lastInsertRowid);
    },

    createAttendancePolicy(policy) {
      const result = database.prepare(`
        INSERT INTO attendance_policies (
          offering_id, attendance_required, attendance_counts_toward_grade,
          attendance_notes, evidence_document_id, evidence_text,
          confidence, review_status
        )
        VALUES (
          @offering_id, @attendance_required, @attendance_counts_toward_grade,
          @attendance_notes, @evidence_document_id, @evidence_text,
          @confidence, @review_status
        )
      `).run({
        offering_id: Number(policy.offeringId || policy.offering_id),
        attendance_required: policy.attendanceRequired || policy.attendance_required || 'unknown',
        attendance_counts_toward_grade: policy.attendanceCountsTowardGrade || policy.attendance_counts_toward_grade || 'unknown',
        attendance_notes: policy.attendanceNotes || policy.attendance_notes || null,
        evidence_document_id: policy.evidenceDocumentId || policy.evidence_document_id || null,
        evidence_text: policy.evidenceText || policy.evidence_text || null,
        confidence: policy.confidence ?? null,
        review_status: policy.reviewStatus || policy.review_status || 'auto',
      });
      return mapAttendancePolicy(database.prepare('SELECT * FROM attendance_policies WHERE id = ?').get(result.lastInsertRowid));
    },

    createGradingPolicy(policy) {
      const result = database.prepare(`
        INSERT INTO grading_policies (
          offering_id, letter_grade, has_participation_component,
          participation_weight, homework_weight, project_weight, lab_weight,
          quiz_weight, midterm_weight, final_weight, drop_lowest_rule_text,
          late_policy_text, collaboration_policy_text, grading_notes,
          evidence_document_id, evidence_text, confidence, review_status
        )
        VALUES (
          @offering_id, @letter_grade, @has_participation_component,
          @participation_weight, @homework_weight, @project_weight, @lab_weight,
          @quiz_weight, @midterm_weight, @final_weight, @drop_lowest_rule_text,
          @late_policy_text, @collaboration_policy_text, @grading_notes,
          @evidence_document_id, @evidence_text, @confidence, @review_status
        )
      `).run({
        offering_id: Number(policy.offeringId || policy.offering_id),
        letter_grade: policy.letterGrade || policy.letter_grade || 'unknown',
        has_participation_component: policy.hasParticipationComponent || policy.has_participation_component || 'unknown',
        participation_weight: policy.participationWeight ?? policy.participation_weight ?? null,
        homework_weight: policy.homeworkWeight ?? policy.homework_weight ?? null,
        project_weight: policy.projectWeight ?? policy.project_weight ?? null,
        lab_weight: policy.labWeight ?? policy.lab_weight ?? null,
        quiz_weight: policy.quizWeight ?? policy.quiz_weight ?? null,
        midterm_weight: policy.midtermWeight ?? policy.midterm_weight ?? null,
        final_weight: policy.finalWeight ?? policy.final_weight ?? null,
        drop_lowest_rule_text: policy.dropLowestRuleText || policy.drop_lowest_rule_text || null,
        late_policy_text: policy.latePolicyText || policy.late_policy_text || null,
        collaboration_policy_text: policy.collaborationPolicyText || policy.collaboration_policy_text || null,
        grading_notes: policy.gradingNotes || policy.grading_notes || null,
        evidence_document_id: policy.evidenceDocumentId || policy.evidence_document_id || null,
        evidence_text: policy.evidenceText || policy.evidence_text || null,
        confidence: policy.confidence ?? null,
        review_status: policy.reviewStatus || policy.review_status || 'auto',
      });
      return mapGradingPolicy(database.prepare('SELECT * FROM grading_policies WHERE id = ?').get(result.lastInsertRowid));
    },
  };
}

module.exports = {
  createHistoryRepo,
};
