const db = require('../config/db');

// Auto-create tabel jika belum ada
const ensureTable = async () => {
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

// GET /api/revisions?submission_id=
exports.getAll = async (req, res, next) => {
  try {
    await ensureTable();
    const { submission_id } = req.query;
    if (!submission_id)
      return res.status(400).json({ message: 'submission_id wajib' });

    const [threads] = await db.query(`
      SELECT rt.*, u.name AS sender_name, u.role AS sender_role
      FROM   revision_threads rt
      JOIN   users u ON u.id = rt.user_id
      WHERE  rt.submission_id = ?
      ORDER  BY rt.created_at ASC`, [submission_id]);

    const [old] = await db.query(`
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
      ORDER BY r.created_at ASC`, [submission_id]);

    const all = [...old, ...threads]
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    res.json(all);
  } catch (e) { next(e); }
};

// POST /api/revisions  — semua role yang terlibat bisa kirim
exports.create = async (req, res, next) => {
  try {
    await ensureTable();
    const { submission_id, message } = req.body;
    if (!submission_id || !message?.trim())
      return res.status(400).json({ message: 'submission_id dan message wajib' });

    const [[sub]] = await db.query(
      'SELECT user_id, task_id, status FROM submissions WHERE id = ?', [submission_id]
    );
    if (!sub) return res.status(404).json({ message: 'Submission tidak ditemukan' });

    // Validasi: dosen hanya boleh ke submissionnya sendiri
    if (req.user.role === 'DOSEN' && sub.user_id !== req.user.id)
      return res.status(403).json({ message: 'Akses ditolak' });

    const [r] = await db.query(
      'INSERT INTO revision_threads (submission_id, user_id, role, message) VALUES (?,?,?,?)',
      [submission_id, req.user.id, req.user.role, message.trim()]
    );

    const isRemedialStatus = ['remedial_open','remedial_submitted','remedial_reviewed','remedial_approved'].includes(sub.status);
    const isFinalLocked = ['approved','remedial_approved'].includes(sub.status);
    // Update status otomatis
    if (!isFinalLocked && !isRemedialStatus && (req.user.role === 'NARASUMBER' || req.user.role === 'ADMIN')) {
      // Narasumber kirim catatan → status revision
      await db.query(
        "UPDATE submissions SET status = 'revision' WHERE id = ?", [submission_id]
      );
    } else if (!isFinalLocked && !isRemedialStatus && req.user.role === 'DOSEN' && sub.status === 'revision') {
      // Dosen balas saat revision → otomatis re-submit
      await db.query(
        "UPDATE submissions SET status = 'submitted' WHERE id = ?", [submission_id]
      );
    }

    res.status(201).json({ message: 'Pesan terkirim', id: r.insertId });
  } catch (e) { next(e); }
};

exports.remove = async (req, res, next) => {
  try {
    await db.query('DELETE FROM revision_threads WHERE id = ?', [req.params.id]);
    res.json({ message: 'Pesan dihapus' });
  } catch (e) { next(e); }
};
