const db = require('../config/db');

exports.getMyStatus = async (req,res,next)=>{
  try{
    const [[user]] = await db.query(
      `SELECT id,role,payment_status,payment_reject_reason,payment_verified_at,payment_verified_by,period_id
       FROM users WHERE id=?`,
      [req.user.id]
    );
    if(!user) return res.status(404).json({message:'User tidak ditemukan'});

    const [[latest]] = await db.query(
      `SELECT ps.id,ps.amount,ps.proof_file,ps.note,ps.status,ps.reviewed_by,ps.reviewed_at,ps.reject_reason,ps.created_at,
              reviewer.name AS reviewed_by_name
       FROM payment_submissions ps
       LEFT JOIN users reviewer ON reviewer.id=ps.reviewed_by
       WHERE ps.user_id=?
       ORDER BY ps.created_at DESC, ps.id DESC
       LIMIT 1`,
      [req.user.id]
    );

    res.json({
      payment_status: user.payment_status || 'unpaid',
      payment_reject_reason: user.payment_reject_reason || null,
      payment_verified_at: user.payment_verified_at || null,
      latest_submission: latest || null
    });
  }catch(err){next(err);}
};

exports.submitPayment = async (req,res,next)=>{
  try{
    if(req.user.role!=='DOSEN') return res.status(403).json({message:'Akses ditolak'});
    const [[user]] = await db.query('SELECT dosen_verification_status FROM users WHERE id=?',[req.user.id]);
    if(!user) return res.status(404).json({message:'User tidak ditemukan'});
    if(user.dosen_verification_status!=='verified') return res.status(403).json({message:'Verifikasi dosen tahap 1 harus disetujui sebelum upload pembayaran'});
    if(!req.file) return res.status(400).json({message:'Bukti pembayaran wajib diunggah'});

    const amountRaw = req.body.amount;
    const note = req.body.note || null;
    const amount = amountRaw === undefined || amountRaw === null || amountRaw === '' ? null : Number(amountRaw);
    if(amount !== null && (!Number.isFinite(amount) || amount < 0)) return res.status(400).json({message:'Nominal tidak valid'});

    const proofFile = `/uploads/${req.file.filename}`;

    await db.query(
      `INSERT INTO payment_submissions (user_id,period_id,amount,proof_file,note,status)
       VALUES (?,?,?,?,?,'pending')`,
      [req.user.id, req.user.period_id || null, amount, proofFile, note]
    );

    await db.query(
      `UPDATE users
       SET payment_status='pending', payment_reject_reason=NULL, payment_verified_at=NULL, payment_verified_by=NULL
       WHERE id=?`,
      [req.user.id]
    );

    res.status(201).json({message:'Bukti pembayaran berhasil dikirim dan menunggu verifikasi admin'});
  }catch(err){next(err);}
};

exports.adminList = async (req,res,next)=>{
  try{
    const status = req.query.status || 'pending';
    const allowed = ['pending','verified','rejected'];
    if(!allowed.includes(status)) return res.status(400).json({message:'Status filter tidak valid'});

    const [rows] = await db.query(
      `SELECT ps.id,ps.user_id,ps.period_id,ps.amount,ps.proof_file,ps.note,ps.status,ps.reviewed_by,ps.reviewed_at,ps.reject_reason,ps.created_at,
              u.name AS user_name,u.email AS user_email,u.payment_status,
              p.label AS period_label,
              reviewer.name AS reviewed_by_name
       FROM payment_submissions ps
       JOIN users u ON u.id=ps.user_id
       LEFT JOIN periods p ON p.id=ps.period_id
       LEFT JOIN users reviewer ON reviewer.id=ps.reviewed_by
       WHERE ps.status=?
       ORDER BY ps.created_at DESC, ps.id DESC`,
      [status]
    );

    res.json(rows);
  }catch(err){next(err);}
};

exports.adminVerify = async (req,res,next)=>{
  try{
    const id = parseInt(req.params.id,10);
    if(!id) return res.status(400).json({message:'ID submission tidak valid'});

    const [[submission]] = await db.query(
      `SELECT id,user_id,status FROM payment_submissions WHERE id=?`,
      [id]
    );
    if(!submission) return res.status(404).json({message:'Data pembayaran tidak ditemukan'});
    if(submission.status!=='pending') return res.status(400).json({message:'Data ini sudah direview'});

    await db.query(
      `UPDATE payment_submissions
       SET status='verified', reviewed_by=?, reviewed_at=NOW(), reject_reason=NULL
       WHERE id=?`,
      [req.user.id, id]
    );

    await db.query(
      `UPDATE users
       SET payment_status='verified', payment_verified_at=NOW(), payment_verified_by=?, payment_reject_reason=NULL
       WHERE id=?`,
      [req.user.id, submission.user_id]
    );

    res.json({message:'Pembayaran berhasil diverifikasi'});
  }catch(err){next(err);}
};

exports.adminReject = async (req,res,next)=>{
  try{
    const id = parseInt(req.params.id,10);
    if(!id) return res.status(400).json({message:'ID submission tidak valid'});

    const rejectReason = (req.body.reject_reason || '').trim();
    if(!rejectReason) return res.status(400).json({message:'Alasan penolakan wajib diisi'});

    const [[submission]] = await db.query(
      `SELECT id,user_id,status FROM payment_submissions WHERE id=?`,
      [id]
    );
    if(!submission) return res.status(404).json({message:'Data pembayaran tidak ditemukan'});
    if(submission.status!=='pending') return res.status(400).json({message:'Data ini sudah direview'});

    await db.query(
      `UPDATE payment_submissions
       SET status='rejected', reviewed_by=?, reviewed_at=NOW(), reject_reason=?
       WHERE id=?`,
      [req.user.id, rejectReason, id]
    );

    await db.query(
      `UPDATE users
       SET payment_status='rejected', payment_verified_at=NULL, payment_verified_by=NULL, payment_reject_reason=?
       WHERE id=?`,
      [rejectReason, submission.user_id]
    );

    res.json({message:'Pembayaran ditolak'});
  }catch(err){next(err);}
};
