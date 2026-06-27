const db = require('../config/db');

const COMPONENT_TITLE_KEYWORDS = {
  OJC_RPS_INSTRUMEN: ['rps'],
  OJC_VIDEO_PEMBELAJARAN_PRAKTIK: ['video'],
  OJC_ARTIKEL_ILMIAH: ['artikel'],
  OJC_KONTEN_MODERASI: ['moderasi'],
  ISC2_VIDEO_PRAKTIK: ['video'],
  ISC2_ARTIKEL_SUBMITTED: ['artikel']
};
const REMEDIAL_PASSING_SCORE = 60;
const REMEDIAL_STATUSES = ['remedial_open','remedial_submitted','remedial_reviewed','remedial_approved'];
const ALL_STATUSES = ['submitted','reviewed','revision','approved',...REMEDIAL_STATUSES];

const ensureGradeTimelineSchema = async () => {
  const [cols] = await db.query(`SHOW COLUMNS FROM grades WHERE Field IN ('initial_graded_at','remedial_graded_at')`);
  const existing = new Set(cols.map(c => c.Field));
  if (!existing.has('initial_graded_at')) await db.query(`ALTER TABLE grades ADD COLUMN initial_graded_at DATETIME NULL AFTER is_draft`);
  if (!existing.has('remedial_graded_at')) await db.query(`ALTER TABLE grades ADD COLUMN remedial_graded_at DATETIME NULL AFTER initial_graded_at`);
  await db.query(`
    UPDATE grades
    SET initial_graded_at = COALESCE(initial_graded_at, updated_at)
    WHERE is_draft = 0 AND initial_graded_at IS NULL
  `);
};

// Auto-create tabel revision_threads jika belum ada
const ensureThreadsTable = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS revision_threads (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      submission_id INT NOT NULL,
      user_id       INT NOT NULL,
      role          ENUM('DOSEN','NARASUMBER','ADMIN') NOT NULL,
      message       TEXT NOT NULL,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)       REFERENCES users(id) ON DELETE CASCADE
    )
  `);
};

const ensureUploadHistoryTable = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS submission_upload_history (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      submission_id INT NOT NULL,
      file_path     VARCHAR(500) NULL,
      link_url      VARCHAR(1000) NULL,
      status        VARCHAR(30) NULL,
      uploaded_at   TIMESTAMP NULL,
      archived_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
    )
  `);
};

const ensureRemedialSchema = async () => {
  await db.query(`ALTER TABLE submissions MODIFY status ENUM('submitted','reviewed','revision','approved','remedial_open','remedial_submitted','remedial_reviewed','remedial_approved') NOT NULL DEFAULT 'submitted'`);
  const [cols] = await db.query(`SHOW COLUMNS FROM submissions WHERE Field IN ('remedial_enabled','remedial_opened_by','remedial_opened_at','remedial_attempt_no','initial_final_score','remedial_final_score')`);
  const existing = new Set(cols.map(c => c.Field));
  if (!existing.has('remedial_enabled')) await db.query(`ALTER TABLE submissions ADD COLUMN remedial_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER status`);
  if (!existing.has('remedial_opened_by')) await db.query(`ALTER TABLE submissions ADD COLUMN remedial_opened_by INT NULL AFTER remedial_enabled`);
  if (!existing.has('remedial_opened_at')) await db.query(`ALTER TABLE submissions ADD COLUMN remedial_opened_at DATETIME NULL AFTER remedial_opened_by`);
  if (!existing.has('remedial_attempt_no')) await db.query(`ALTER TABLE submissions ADD COLUMN remedial_attempt_no INT NOT NULL DEFAULT 0 AFTER remedial_opened_at`);
  if (!existing.has('initial_final_score')) await db.query(`ALTER TABLE submissions ADD COLUMN initial_final_score DECIMAL(6,2) NULL AFTER remedial_attempt_no`);
  if (!existing.has('remedial_final_score')) await db.query(`ALTER TABLE submissions ADD COLUMN remedial_final_score DECIMAL(6,2) NULL AFTER initial_final_score`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS submission_mcq_attempts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      submission_id INT NOT NULL,
      user_id INT NOT NULL,
      task_id INT NOT NULL,
      attempt_no INT NOT NULL DEFAULT 1,
      is_remedial TINYINT(1) NOT NULL DEFAULT 0,
      score DECIMAL(6,2) NOT NULL DEFAULT 0,
      correct_count INT NOT NULL DEFAULT 0,
      total_count INT NOT NULL DEFAULT 0,
      answers_json JSON NULL,
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      UNIQUE KEY uq_submission_mcq_attempt (submission_id, attempt_no)
    )
  `);
};

// -------------------------------------------------------
// GET /api/submissions
// -------------------------------------------------------
exports.getAll = async (req, res, next) => {
  try {
    await ensureRemedialSchema();
    await ensureGradeTimelineSchema();
    const { task_id, status, phase, class_id } = req.query;

    if (req.user.role === 'NARASUMBER') {
      let q = `
        SELECT s.id, u.id AS user_id, t.id AS task_id,
               COALESCE(s.period_id, t.period_id, c.period_id) AS period_id,
               s.file_path, s.link_url,
               COALESCE(s.status, 'not_submitted') AS status,
               s.remedial_enabled, s.remedial_opened_by, s.remedial_opened_at,
               s.remedial_attempt_no, s.initial_final_score, s.remedial_final_score,
               s.submitted_at, s.updated_at,
               u.name AS dosen_name,
               u.email AS dosen_email,
               t.title AS task_title,
               t.phase, t.task_type, t.assessment_component,
               t.class_id AS task_class_id,
               c.id AS class_id_val,
               co.id AS cohort_id,
               co.cohort_no,
               COALESCE(c.name, 'Semua Kelas') AS class_name,
               g.final_score, g.total_score, g.is_draft,
               CASE
                 WHEN (
                   COALESCE(s.remedial_enabled, 0) = 1
                   OR COALESCE(s.remedial_attempt_no, 0) > 0
                   OR s.remedial_final_score IS NOT NULL
                   OR s.status IN ('remedial_open','remedial_submitted','remedial_reviewed','remedial_approved')
                 ) THEN
                   CASE
                     WHEN s.initial_final_score IS NOT NULL AND s.remedial_final_score IS NOT NULL THEN GREATEST(s.initial_final_score, s.remedial_final_score)
                     ELSE COALESCE(s.remedial_final_score, s.initial_final_score, g.final_score)
                   END
                 ELSE g.final_score
               END AS effective_final_score
        FROM tasks t
        JOIN classes c ON c.id = t.class_id
        JOIN class_members cm ON cm.class_id = t.class_id
        JOIN users u ON u.id = cm.user_id AND u.role = 'DOSEN'
        LEFT JOIN submissions s ON s.task_id = t.id AND s.user_id = u.id
        LEFT JOIN cohorts co ON co.id = c.cohort_id
        LEFT JOIN grades g ON g.submission_id = s.id
        WHERE t.phase IN ('OJC','ISC2')
          AND t.class_id IS NOT NULL
          AND t.period_id = ?
          AND EXISTS (
            SELECT 1
            FROM class_narasumber cn
            WHERE cn.narasumber_id = ?
              AND cn.class_id = t.class_id
              AND (
                cn.material_id IS NULL
                OR cn.material_id = t.id
                OR (t.material_id IS NOT NULL AND cn.material_id = t.material_id)
                OR cn.material_id IN (
                  SELECT tx.id
                  FROM tasks tx
                  WHERE tx.class_id = t.class_id
                    AND tx.phase = t.phase
                    AND tx.assessment_component = t.assessment_component
                )
              )
          )`;
      const params = [req.user.period_id, req.user.id];

      if (task_id)  { q += ' AND t.id = ?'; params.push(task_id); }
      if (status)   { q += " AND COALESCE(s.status, 'not_submitted') = ?"; params.push(status); }
      if (phase)    { q += ' AND t.phase = ?'; params.push(phase); }
      if (class_id) { q += ' AND t.class_id = ?'; params.push(class_id); }

      q += ` ORDER BY
        co.cohort_no IS NULL,
        co.cohort_no ASC,
        c.name ASC,
        u.name ASC,
        t.phase ASC,
        t.title ASC,
        s.submitted_at DESC`;

      const [rows] = await db.query(q, params);
      return res.json(rows);
    }

    let q = `
      SELECT s.id, s.user_id, s.task_id, s.period_id,
             s.file_path, s.link_url, s.status,
             s.remedial_enabled, s.remedial_opened_by, s.remedial_opened_at,
             s.remedial_attempt_no, s.initial_final_score, s.remedial_final_score,
             s.submitted_at, s.updated_at,
             u.name  AS dosen_name,
             u.email AS dosen_email,
             t.title AS task_title,
             t.phase, t.task_type, t.assessment_component,
             t.class_id AS task_class_id,
             c.id    AS class_id_val,
             co.id   AS cohort_id,
             co.cohort_no,
             COALESCE(c.name, 'Semua Kelas') AS class_name,
             g.final_score, g.total_score, g.is_draft,
             CASE
               WHEN (
                 COALESCE(s.remedial_enabled, 0) = 1
                 OR COALESCE(s.remedial_attempt_no, 0) > 0
                 OR s.remedial_final_score IS NOT NULL
                 OR s.status IN ('remedial_open','remedial_submitted','remedial_reviewed','remedial_approved')
               ) THEN
                 CASE
                   WHEN s.initial_final_score IS NOT NULL AND s.remedial_final_score IS NOT NULL THEN GREATEST(s.initial_final_score, s.remedial_final_score)
                   ELSE COALESCE(s.remedial_final_score, s.initial_final_score, g.final_score)
                 END
               ELSE g.final_score
             END AS effective_final_score
      FROM submissions s
      JOIN  users   u ON u.id  = s.user_id
      JOIN  tasks   t ON t.id  = s.task_id
      LEFT JOIN classes c ON c.id = t.class_id
      LEFT JOIN cohorts co ON co.id = c.cohort_id
      LEFT JOIN grades  g ON g.submission_id = s.id
      WHERE 1=1`;
    const params = [];

    if (req.user.role === 'DOSEN') {
      q += `
        AND s.user_id = ?
        AND t.period_id = ?
        AND (
          (
            t.class_id IS NOT NULL
            AND t.class_id IN (
              SELECT cm.class_id FROM class_members cm
              JOIN classes c ON c.id = cm.class_id
              WHERE cm.user_id = ? AND c.period_id = t.period_id
            )
          )
          OR
          t.class_id IS NULL
        )`;
      params.push(req.user.id, req.user.period_id, req.user.id);
    }

    if (task_id)  { q += ' AND s.task_id  = ?'; params.push(task_id); }
    if (status)   { q += ' AND s.status   = ?'; params.push(status); }
    if (phase)    { q += ' AND t.phase    = ?'; params.push(phase); }
    if (class_id) { q += ' AND t.class_id = ?'; params.push(class_id); }

    q += ' ORDER BY s.submitted_at DESC';

    const [rows] = await db.query(q, params);
    res.json(rows);
  } catch (e) { next(e); }
};

// -------------------------------------------------------
// GET /api/submissions/:id
// -------------------------------------------------------
exports.getOne = async (req, res, next) => {
  try {
    await ensureThreadsTable();
    await ensureUploadHistoryTable();
    await ensureRemedialSchema();
    await ensureGradeTimelineSchema();

    const [[sub]] = await db.query(`
      SELECT s.*,
             COALESCE(s.period_id,t.period_id,c.period_id) AS period_id,
             u.name  AS dosen_name,
             u.email AS dosen_email,
             t.title AS task_title,
             t.phase, t.task_type, t.assessment_component,
             t.class_id AS task_class_id,
             c.id   AS class_id_val,
             c.name AS class_name,
             COALESCE(
               (SELECT un.name FROM class_narasumber cn JOIN users un ON un.id = cn.narasumber_id
                WHERE cn.class_id = t.class_id AND (cn.material_id = t.id OR cn.material_id = t.material_id)
                ORDER BY cn.id ASC LIMIT 1),
               (SELECT un.name FROM class_narasumber cn JOIN users un ON un.id = cn.narasumber_id
                WHERE cn.class_id = t.class_id AND cn.material_id IS NULL
                ORDER BY cn.id ASC LIMIT 1)
             ) AS narasumber_name
      FROM submissions s
      JOIN  users   u ON u.id = s.user_id
      JOIN  tasks   t ON t.id = s.task_id
      LEFT JOIN classes c ON c.id = t.class_id
      WHERE s.id = ?`, [req.params.id]);

    if (!sub) return res.status(404).json({ message: 'Pengumpulan tidak ditemukan' });

    // --- Validasi akses ---
    if (req.user.role === 'DOSEN' && sub.user_id !== req.user.id)
      return res.status(403).json({ message: 'Akses ditolak' });

    if (req.user.role === 'NARASUMBER') {
      if (!['OJC','ISC2'].includes(sub.phase) || !sub.task_class_id || sub.period_id !== req.user.period_id) {
        return res.status(403).json({ message: 'Akses ditolak' });
      }
      const [[check]] = await db.query(`
        SELECT 1 AS ok
        FROM class_narasumber cn
        WHERE cn.narasumber_id = ?
          AND cn.class_id = ?
          AND (
            cn.material_id IS NULL
            OR cn.material_id = ?
            OR cn.material_id IN (
              SELECT tx.id
              FROM tasks tx
              WHERE tx.class_id = ?
                AND tx.phase = ?
                AND tx.assessment_component = ?
            )
          )
        LIMIT 1`,
        [req.user.id, sub.task_class_id, sub.task_id, sub.task_class_id, sub.phase, sub.assessment_component]
      );
      if (!check)
        return res.status(403).json({ message: 'Akses ditolak: bukan kelas Anda' });
    }

    // --- Chat / Revisi thread ---
    const [threads] = await db.query(`
      SELECT rt.*, u.name AS sender_name, u.role AS sender_role
      FROM   revision_threads rt
      JOIN   users u ON u.id = rt.user_id
      WHERE  rt.submission_id = ?
      ORDER  BY rt.created_at ASC`, [req.params.id]);

    // Backward compat: revisi lama dari tabel revisions
    const [oldRevisions] = await db.query(`
      SELECT r.id, r.submission_id,
             r.created_by AS user_id,
             r.comment    AS message,
             'NARASUMBER' AS role,
             r.created_at,
             u.name       AS sender_name,
             'NARASUMBER' AS sender_role
      FROM revisions r
      JOIN users u ON u.id = r.created_by
      WHERE r.submission_id = ?
      ORDER BY r.created_at ASC`, [req.params.id]);

    const revision_threads = [...oldRevisions, ...threads]
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    // --- Grade ---
    const [[grade]] = await db.query(`
      SELECT g.*,
             i.title     AS instrument_title,
             i.max_score AS instrument_max,
             un.name     AS narasumber_name
      FROM   grades g
      LEFT JOIN instruments i  ON i.id  = g.instrument_id
      LEFT JOIN users       un ON un.id = g.narasumber_id
      WHERE  g.submission_id = ?`, [req.params.id]);

    let grade_aspects = [];
    if (grade) {
      const [ga] = await db.query(`
        SELECT ga.*,
               ia.aspect_name, ia.order_no,
               ia.score_3, ia.score_2, ia.score_1
        FROM   grade_aspects ga
        JOIN   instrument_aspects ia ON ia.id = ga.aspect_id
        WHERE  ga.grade_id = ?
        ORDER  BY ia.order_no`, [grade.id]);
      grade_aspects = ga;
    }

    // --- Instrumen tersedia (untuk narasumber pilih saat akan nilai) ---
    let available_instruments = [];
    if ((sub.phase === 'OJC' || sub.phase === 'ISC2') && !grade) {
      // Prioritas: instrumen yang ditautkan ke tugas
      const [linked] = await db.query(`
        SELECT i.*, COUNT(ia.id) AS aspect_count
        FROM   task_instruments ti
        JOIN   instruments i ON i.id = ti.instrument_id
        LEFT   JOIN instrument_aspects ia ON ia.instrument_id = i.id
        WHERE  ti.task_id = ?
        GROUP  BY i.id`, [sub.task_id]);

      if (linked.length > 0) {
        available_instruments = linked;
      } else {
        const [all] = await db.query(`
          SELECT i.*, COUNT(ia.id) AS aspect_count
          FROM   instruments i
          LEFT   JOIN instrument_aspects ia ON ia.instrument_id = i.id
          WHERE  i.phase = ?
          GROUP  BY i.id
          ORDER  BY i.created_at DESC`, [sub.phase]);
        available_instruments = all;
      }

      if (sub.assessment_component) {
        const keywords = COMPONENT_TITLE_KEYWORDS[sub.assessment_component] || [];
        if (keywords.length > 0) {
          const filtered = available_instruments.filter(ins => {
            const title = String(ins.title || '').toLowerCase();
            return keywords.some(k => title.includes(k));
          });
          if (filtered.length > 0) available_instruments = filtered;
        }
      }
    }

    const [uploadHistory] = await db.query(`
      SELECT id, file_path, link_url, status, uploaded_at, archived_at
      FROM submission_upload_history
      WHERE submission_id = ?
      ORDER BY archived_at DESC, id DESC`, [req.params.id]);

    const [mcqAttempts] = await db.query(`
      SELECT id, attempt_no, is_remedial, score, correct_count, total_count, submitted_at
      FROM submission_mcq_attempts
      WHERE submission_id = ?
      ORDER BY attempt_no ASC`, [req.params.id]);

    const hasRemedialHistory = Boolean(
      sub.remedial_enabled
      || Number(sub.remedial_attempt_no || 0) > 0
      || sub.remedial_final_score != null
      || ['remedial_open','remedial_submitted','remedial_reviewed','remedial_approved'].includes(sub.status)
    );

    const effective_final_score = hasRemedialHistory
      ? (
          sub.initial_final_score != null && sub.remedial_final_score != null
            ? Math.max(Number(sub.initial_final_score), Number(sub.remedial_final_score))
            : (sub.remedial_final_score ?? sub.initial_final_score ?? grade?.final_score ?? null)
        )
      : (grade?.final_score ?? null);

    res.json({
      ...sub,
      effective_final_score,
      revision_threads,
      upload_history: uploadHistory,
      mcq_attempts: mcqAttempts,
      grade:                grade || null,
      grade_aspects,
      available_instruments
    });
  } catch (e) { next(e); }
};

// -------------------------------------------------------
// POST /api/submissions  (Dosen kumpul tugas)
// -------------------------------------------------------
exports.create = async (req, res, next) => {
  try {
    if (req.user.role !== 'DOSEN')
      return res.status(403).json({ message: 'Hanya Dosen yang bisa mengumpulkan tugas' });

    const { task_id, link_url } = req.body;
    if (!task_id) return res.status(400).json({ message: 'task_id wajib' });

    // Check task timing for OJC/ISC2 upload tasks
    const [[task]] = await db.query(
      'SELECT id, phase, task_type, upload_open, upload_close FROM tasks WHERE id = ?',
      [task_id]
    );
    if (!task) return res.status(404).json({ message: 'Tugas tidak ditemukan' });

    // If task has timing settings, check if within allowed period
    if (task.upload_open || task.upload_close) {
      const now = new Date();

      if (task.upload_open && now < new Date(task.upload_open)) {
        return res.status(403).json({
          message: `Pengumpulan belum dibuka. Akan dibuka pada ${new Date(task.upload_open).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' })}`
        });
      }

      if (task.upload_close && now > new Date(task.upload_close)) {
        return res.status(403).json({
          message: `Pengumpulan sudah ditutup pada ${new Date(task.upload_close).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' })}`
        });
      }
    }

    const file_path = req.file ? req.file.filename : null;
    if (!file_path && !link_url)
      return res.status(400).json({ message: 'Upload file PDF atau masukkan link' });

    const period_id = req.user.period_id;
    const [[exist]] = await db.query(
      'SELECT id FROM submissions WHERE user_id = ? AND task_id = ?',
      [req.user.id, task_id]
    );

    if (exist) {
      return res.status(409).json({
        message: 'Tugas sudah pernah dikumpulkan. Gunakan fitur upload ulang dari detail submission.'
      });
    }

    const [r] = await db.query(
      'INSERT INTO submissions (user_id, task_id, period_id, file_path, link_url) VALUES (?,?,?,?,?)',
      [req.user.id, task_id, period_id, file_path, link_url || null]
    );
    res.status(201).json({ message: 'Tugas berhasil dikumpulkan', id: r.insertId });
  } catch (e) { next(e); }
};

// -------------------------------------------------------
// POST /api/submissions/mcq  (Dosen jawab soal ISC1)
// -------------------------------------------------------
exports.submitMcq = async (req, res, next) => {
  try {
    await ensureRemedialSchema();
    if (req.user.role !== 'DOSEN')
      return res.status(403).json({ message: 'Akses ditolak' });

    const { task_id, answers, submit_mode, is_remedial } = req.body;
    const mode = submit_mode === 'timeout_auto' ? 'timeout_auto' : 'final';
    if (!task_id)
      return res.status(400).json({ message: 'task_id wajib' });
    if (!Array.isArray(answers))
      return res.status(400).json({ message: 'answers wajib berupa array' });

    // Ambil info task termasuk timing
    const [[task]] = await db.query(
      'SELECT id, phase, task_type, pretest_open, pretest_close, posttest_open, posttest_close FROM tasks WHERE id = ?',
      [task_id]
    );

    if (!task)
      return res.status(404).json({ message: 'Tugas tidak ditemukan' });

    const [[existingSubmission]] = await db.query(
      'SELECT * FROM submissions WHERE user_id = ? AND task_id = ?',
      [req.user.id, task_id]
    );
    const requestedRemedial = is_remedial === true || is_remedial === 'true' || existingSubmission?.status === 'remedial_open';
    if (requestedRemedial) {
      if (task.task_type !== 'POSTTEST') {
        return res.status(400).json({ message: 'Remedial ISC1 hanya untuk Posttest' });
      }
      if (!existingSubmission?.remedial_enabled || existingSubmission.status !== 'remedial_open') {
        return res.status(403).json({ message: 'Remedial belum dibuka atau sudah ditutup oleh admin' });
      }
    }

    // Cek timing hanya untuk attempt normal. Remedial yang sudah dibuka admin bebas waktu.
    const now = new Date();
    let isOpen = requestedRemedial;

    if (!requestedRemedial && task.task_type === 'PRETEST') {
      if (!task.pretest_open || !task.pretest_close)
        return res.status(403).json({ message: 'Pretest belum dijadwalkan oleh admin' });
      if (now < new Date(task.pretest_open))
        return res.status(403).json({ message: `Pretest belum dibuka. Dibuka pada ${new Date(task.pretest_open).toLocaleString('id-ID')}` });
      if (now > new Date(task.pretest_close))
        return res.status(403).json({ message: `Pretest sudah ditutup pada ${new Date(task.pretest_close).toLocaleString('id-ID')}` });
      isOpen = true;
    } else if (!requestedRemedial && task.task_type === 'POSTTEST') {
      if (!task.posttest_open || !task.posttest_close)
        return res.status(403).json({ message: 'Posttest belum dijadwalkan oleh admin' });
      if (now < new Date(task.posttest_open))
        return res.status(403).json({ message: `Posttest belum dibuka. Dibuka pada ${new Date(task.posttest_open).toLocaleString('id-ID')}` });
      if (now > new Date(task.posttest_close))
        return res.status(403).json({ message: `Posttest sudah ditutup pada ${new Date(task.posttest_close).toLocaleString('id-ID')}` });
      isOpen = true;
    }

    if (!isOpen)
      return res.status(403).json({ message: 'Test tidak dalam periode yang diizinkan' });

    const [questions] = await db.query(
      'SELECT id, correct_answer FROM questions WHERE task_id = ?', [task_id]
    );
    if (!questions.length)
      return res.status(400).json({ message: 'Soal belum tersedia pada tugas ini' });

    const validOptions = new Set(['a', 'b', 'c', 'd']);
    const keyMap = {};
    questions.forEach(q => (keyMap[q.id] = q.correct_answer));

    const answerMap = new Map();
    for (const ans of answers) {
      const qid = parseInt(ans?.question_id);
      const av = String(ans?.answer || '').toLowerCase();
      if (!keyMap[qid]) continue;
      if (!validOptions.has(av)) continue;
      answerMap.set(qid, av);
    }

    if (mode === 'final') {
      const missingQuestionIds = questions
        .filter(q => !answerMap.has(q.id))
        .map(q => q.id);
      if (missingQuestionIds.length) {
        return res.status(400).json({
          message: `Masih ada ${missingQuestionIds.length} soal yang wajib dijawab`,
          missing_question_ids: missingQuestionIds
        });
      }
    }

    const upsertSubmission = async (score = null) => {
      const status = requestedRemedial ? 'remedial_submitted' : 'submitted';
      const [[exist]] = await db.query(
        'SELECT id, initial_final_score FROM submissions WHERE user_id = ? AND task_id = ?',
        [req.user.id, task_id]
      );
      if (exist) {
        await db.query(
          "UPDATE submissions SET status = ?, remedial_final_score = COALESCE(?, remedial_final_score), updated_at = NOW() WHERE id = ?",
          [status, requestedRemedial ? score : null, exist.id]
        );
        return exist.id;
      }
      const [r] = await db.query(
        "INSERT INTO submissions (user_id, task_id, period_id, status, initial_final_score, remedial_final_score) VALUES (?,?,?,?,?,?)",
        [req.user.id, task_id, req.user.period_id, status, requestedRemedial ? null : score, requestedRemedial ? score : null]
      );
      return r.insertId;
    };

    if (mode === 'timeout_auto' && answerMap.size === 0) {
      const submissionId = await upsertSubmission(0);
      const [[attemptInfo]] = await db.query('SELECT COALESCE(MAX(attempt_no),0) + 1 AS next_attempt FROM submission_mcq_attempts WHERE submission_id = ?', [submissionId]);
      await db.query(
        `INSERT INTO submission_mcq_attempts (submission_id, user_id, task_id, attempt_no, is_remedial, score, correct_count, total_count, answers_json)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [submissionId, req.user.id, task_id, attemptInfo.next_attempt, requestedRemedial ? 1 : 0, 0, 0, questions.length, JSON.stringify([])]
      );
      return res.json({ message: 'Waktu habis. Belum ada jawaban yang tersimpan', correct: 0, total: questions.length, score: 0 });
    }

    if (mode === 'final' && answerMap.size === 0) {
      return res.status(400).json({ message: 'task_id dan answers wajib' });
    }

    let correct = 0;
    for (const [qid, ans] of answerMap.entries()) {
      const ok = keyMap[qid] === ans ? 1 : 0;
      if (ok) correct++;
      await db.query(
        `INSERT INTO mcq_answers (user_id, task_id, question_id, answer, is_correct)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE answer = VALUES(answer), is_correct = VALUES(is_correct)`,
        [req.user.id, task_id, qid, ans, ok]
      );
    }

    const score = Math.round((correct / questions.length) * 100);
    const submissionId = await upsertSubmission(score);
    const [[attemptInfo]] = await db.query('SELECT COALESCE(MAX(attempt_no),0) + 1 AS next_attempt FROM submission_mcq_attempts WHERE submission_id = ?', [submissionId]);
    const answersJson = questions.map(q => ({
      question_id: q.id,
      answer: answerMap.get(q.id) || null,
      correct_answer: q.correct_answer,
      is_correct: answerMap.get(q.id) === q.correct_answer
    }));
    await db.query(
      `INSERT INTO submission_mcq_attempts (submission_id, user_id, task_id, attempt_no, is_remedial, score, correct_count, total_count, answers_json)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [submissionId, req.user.id, task_id, attemptInfo.next_attempt, requestedRemedial ? 1 : 0, score, correct, questions.length, JSON.stringify(answersJson)]
    );
    if (!requestedRemedial && task.task_type === 'POSTTEST' && score < REMEDIAL_PASSING_SCORE) {
      await db.query('UPDATE submissions SET initial_final_score = COALESCE(initial_final_score, ?) WHERE id = ?', [score, submissionId]);
    }
    const message = mode === 'timeout_auto'
      ? 'Waktu habis. Jawaban yang sudah diisi berhasil disimpan'
      : 'Jawaban tersimpan';
    res.json({ message, correct, total: questions.length, score, remedial_eligible: task.task_type === 'POSTTEST' && score < REMEDIAL_PASSING_SCORE });
  } catch (e) { next(e); }
};

// GET /api/submissions/mcq-result
exports.getMcqResult = async (req, res, next) => {
  try {
    const { task_id, user_id } = req.query;
    const userId = req.user.role === 'DOSEN' ? req.user.id : parseInt(user_id);
    if (!userId || !task_id) return res.status(400).json({ message: 'task_id dan user_id wajib' });
    const [answers] = await db.query(`
      SELECT q.id AS question_id, q.order_no, q.question_text, q.correct_answer,
             q.option_a, q.option_b, q.option_c, q.option_d,
             ma.answer, COALESCE(ma.is_correct,0) AS is_correct
      FROM   questions q
      LEFT JOIN mcq_answers ma ON ma.question_id = q.id AND ma.user_id = ? AND ma.task_id = ?
      WHERE  q.task_id = ?
      ORDER  BY q.order_no`, [userId, task_id, task_id]);
    const correct = answers.filter(a => a.is_correct).length;
    res.json({
      answers, correct,
      total: answers.length,
      score: answers.length ? Math.round((correct / answers.length) * 100) : 0
    });
  } catch (e) { next(e); }
};

// PATCH /api/submissions/:id/status
exports.updateStatus = async (req, res, next) => {
  try {
    await ensureRemedialSchema();
    const { status } = req.body;
    if (!ALL_STATUSES.includes(status))
      return res.status(400).json({ message: 'Status tidak valid' });

    const [[sub]] = await db.query('SELECT id, status, remedial_enabled FROM submissions WHERE id = ?', [req.params.id]);
    if (!sub) return res.status(404).json({ message: 'Pengumpulan tidak ditemukan' });

    const isFinalLocked = ['approved', 'remedial_approved'].includes(sub.status);
    if (isFinalLocked && status !== sub.status) {
      return res.status(403).json({ message: 'Submission sudah final dan tidak bisa dibuka kembali ke status revisi.' });
    }

    const nextIsRemedial = REMEDIAL_STATUSES.includes(status);
    if (nextIsRemedial && !sub.remedial_enabled && status !== 'remedial_approved') {
      return res.status(403).json({ message: 'Status remedial tidak valid karena remedial belum dibuka.' });
    }

    await db.query('UPDATE submissions SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ message: 'Status diperbarui', status });
  } catch (e) { next(e); }
};

// PATCH /api/submissions/:id/remedial/open
exports.openRemedial = async (req, res, next) => {
  try {
    await ensureRemedialSchema();
    const [[sub]] = await db.query(`
      SELECT s.*, t.phase, t.task_type, g.final_score
      FROM submissions s
      JOIN tasks t ON t.id = s.task_id
      LEFT JOIN grades g ON g.submission_id = s.id
      WHERE s.id = ?`, [req.params.id]);

    if (!sub) return res.status(404).json({ message: 'Pengumpulan tidak ditemukan' });
    if (sub.phase === 'ISC1' && sub.task_type !== 'POSTTEST') {
      return res.status(400).json({ message: 'Remedial ISC1 hanya untuk Posttest' });
    }
    if (!['ISC1','OJC','ISC2'].includes(sub.phase)) {
      return res.status(400).json({ message: 'Fase tugas tidak mendukung remedial' });
    }

    const initialScore = sub.initial_final_score ?? sub.final_score ?? null;
    await db.query(
      `UPDATE submissions
       SET remedial_enabled = 1,
           remedial_opened_by = ?,
           remedial_opened_at = NOW(),
           remedial_attempt_no = remedial_attempt_no + 1,
           initial_final_score = COALESCE(initial_final_score, ?),
           status = 'remedial_open',
           updated_at = NOW()
       WHERE id = ?`,
      [req.user.id, initialScore, sub.id]
    );
    res.json({ message: 'Remedial berhasil dibuka' });
  } catch (e) { next(e); }
};

// PATCH /api/submissions/:id/remedial/close
exports.closeRemedial = async (req, res, next) => {
  try {
    await ensureRemedialSchema();
    const [[sub]] = await db.query('SELECT id, status, remedial_enabled FROM submissions WHERE id = ?', [req.params.id]);
    if (!sub) return res.status(404).json({ message: 'Pengumpulan tidak ditemukan' });
    if (!sub.remedial_enabled) return res.status(400).json({ message: 'Remedial belum dibuka' });

    const nextStatus = sub.status === 'remedial_reviewed' ? 'remedial_approved' : sub.status;
    await db.query(
      `UPDATE submissions
       SET remedial_enabled = 0,
           status = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [nextStatus, sub.id]
    );
    res.json({ message: 'Remedial berhasil ditutup', status: nextStatus });
  } catch (e) { next(e); }
};

// PATCH /api/submissions/:id/reupload  (Dosen upload ulang setelah revisi)
exports.reupload = async (req, res, next) => {
  try {
    await ensureRemedialSchema();
    if (req.user.role !== 'DOSEN')
      return res.status(403).json({ message: 'Hanya Dosen yang bisa upload ulang' });

    const [[sub]] = await db.query(
      `SELECT s.*, t.phase, g.final_score
       FROM submissions s
       JOIN tasks t ON t.id = s.task_id
       LEFT JOIN grades g ON g.submission_id = s.id
       WHERE s.id = ?`,
      [req.params.id]
    );

    if (!sub) return res.status(404).json({ message: 'Pengumpulan tidak ditemukan' });
    if (sub.user_id !== req.user.id)
      return res.status(403).json({ message: 'Bukan pengumpulan Anda' });
    const isActiveRemedialUpload = sub.status === 'remedial_open' && !!sub.remedial_enabled;
    const isNormalSelfReplaceAllowed = ['submitted', 'revision'].includes(sub.status);

    if (REMEDIAL_STATUSES.includes(sub.status)) {
      if (!isActiveRemedialUpload) {
        return res.status(403).json({ message: 'Remedial belum dibuka atau sudah ditutup oleh admin' });
      }
    } else if (!isNormalSelfReplaceAllowed) {
      return res.status(403).json({ message: 'Upload ulang hanya tersedia sebelum direview, saat revisi, atau saat remedial dibuka' });
    }

    const file_path = req.file ? req.file.filename : null;
    const { link_url } = req.body;

    if (!file_path && !link_url)
      return res.status(400).json({ message: 'Upload file PDF atau masukkan link' });

    const nextFilePath = file_path || null;
    const nextLinkUrl = file_path ? null : (link_url || null);

    await ensureUploadHistoryTable();
    if (sub.file_path || sub.link_url) {
      await db.query(
        `INSERT INTO submission_upload_history (submission_id, file_path, link_url, status, uploaded_at)
         VALUES (?,?,?,?,?)`,
        [sub.id, sub.file_path, sub.link_url, sub.status, sub.updated_at || sub.submitted_at]
      );
    }

    const nextStatus = isActiveRemedialUpload ? 'remedial_submitted' : 'submitted';
    await db.query(
      `UPDATE submissions
       SET file_path = ?,
           link_url = ?,
           status = ?,
           initial_final_score = COALESCE(initial_final_score, ?),
           updated_at = NOW()
       WHERE id = ?`,
      [nextFilePath, nextLinkUrl, nextStatus, sub.final_score ?? null, req.params.id]
    );
    res.json({ message: 'File berhasil diupload ulang' });
  } catch (e) { next(e); }
};

// DELETE /api/submissions/:id  (Admin)
exports.remove = async (req, res, next) => {
  try {
    await db.query('DELETE FROM submissions WHERE id = ?', [req.params.id]);
    res.json({ message: 'Pengumpulan dihapus' });
  } catch (e) { next(e); }
};
