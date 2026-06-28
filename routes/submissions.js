const r      = require('express').Router();
const c      = require('../controllers/submissionController');
const { authenticate, authorize, ensurePaymentVerified } = require('../middlewares/auth');
const { uploadPdf } = require('../middlewares/upload');
const db     = require('../config/db');

r.use(authenticate);

// DEBUG — cek koneksi narasumber (hapus setelah debugging selesai)
r.get('/debug', async (req, res) => {
  try {
    const uid  = req.user.id;
    const role = req.user.role;

    // 1. Kelas yang diampu narasumber
    const [kelas] = await db.query(`
      SELECT cn.class_id, c.name AS kelas, c.phase, c.period_id,
             p.label AS periode
      FROM   class_narasumber cn
      JOIN   classes c  ON c.id = cn.class_id
      LEFT JOIN periods p ON p.id = c.period_id
      WHERE  cn.narasumber_id = ? AND c.period_id = ?`, [uid, req.user.period_id]);

    // 2. Dosen di kelas tersebut
    const classIds = kelas.map(k => k.class_id);
    let dosen = [];
    if (classIds.length) {
      [dosen] = await db.query(`
        SELECT cm.user_id, cm.class_id, u.name AS dosen_name,
               c.name AS kelas, c.phase
        FROM   class_members cm
        JOIN   users   u ON u.id  = cm.user_id
        JOIN   classes c ON c.id  = cm.class_id
        WHERE  cm.class_id IN (?)`, [classIds]);
    }

    // 3. Tasks di kelas tersebut
    let tasks = [];
    if (classIds.length) {
      [tasks] = await db.query(`
        SELECT id, title, phase, task_type, class_id
        FROM   tasks
        WHERE  class_id IN (?) AND period_id = ?`, [classIds, req.user.period_id]);
    }

    // 4. Submissions dari dosen tersebut
    const dosenIds = [...new Set(dosen.map(d => d.user_id))];
    let submissions = [];
    if (dosenIds.length) {
      [submissions] = await db.query(`
        SELECT s.id, s.user_id, s.task_id, s.status,
               u.name AS dosen_name, t.title AS task_title, t.phase
        FROM   submissions s
        JOIN   users u ON u.id = s.user_id
        JOIN   tasks  t ON t.id = s.task_id
        WHERE  s.user_id IN (?) AND t.period_id = ?`, [dosenIds, req.user.period_id]);
    }

    // 5. Semua submission di DB (cek apakah ada data sama sekali)
    const [allSubs] = await db.query(`
      SELECT s.id, s.task_id, s.status, u.name AS dosen_name,
             t.title AS task_title, t.class_id
      FROM   submissions s
      JOIN   users u ON u.id = s.user_id
      JOIN   tasks  t ON t.id = s.task_id
      LIMIT  20`);

    res.json({
      saya: { id: uid, role },
      step1_kelas_saya: kelas,
      step2_dosen_di_kelas: dosen,
      step3_tasks_di_kelas: tasks,
      step4_submissions_dosen: submissions,
      semua_submission_di_db: allSubs,
      kesimpulan: {
        punya_kelas:       kelas.length > 0,
        ada_dosen:         dosen.length > 0,
        ada_task:          tasks.length > 0,
        ada_submission:    submissions.length > 0,
        masalah:
          kelas.length === 0 ? 'Narasumber belum ditugaskan ke kelas' :
          dosen.length === 0 ? 'Belum ada dosen di kelas Anda' :
          tasks.length === 0 ? 'Belum ada tugas di kelas Anda' :
          submissions.length === 0 ? 'Dosen belum mengumpulkan tugas' :
          'Semua OK - data tersedia'
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r.get('/mcq-result', ensurePaymentVerified, c.getMcqResult);
r.get('/admin/task-recap', authorize('ADMIN'), c.adminTaskRecap);
r.get('/',           ensurePaymentVerified, c.getAll);
r.get('/:id',        ensurePaymentVerified, c.getOne);
r.post('/',          ensurePaymentVerified, uploadPdf.single('file'), c.create);
r.post('/mcq',       ensurePaymentVerified, c.submitMcq);
r.patch('/:id/status', authorize('NARASUMBER','ADMIN'), c.updateStatus);
r.patch('/:id/remedial/open', authorize('ADMIN'), c.openRemedial);
r.patch('/:id/remedial/close', authorize('ADMIN'), c.closeRemedial);
r.patch('/:id/reupload', ensurePaymentVerified, uploadPdf.single('file'), c.reupload);
r.delete('/:id',     authorize('ADMIN'), c.remove);

module.exports = r;
