const db = require('../config/db');

exports.getMyStatus = async (req,res,next)=>{
  try{
    const [[user]] = await db.query(
      `SELECT id,role,dosen_verification_status,dosen_verification_reject_reason,dosen_verification_verified_at,dosen_verification_verified_by
       FROM users WHERE id=?`,
      [req.user.id]
    );
    if(!user) return res.status(404).json({message:'User tidak ditemukan'});

    const [[profile]] = await db.query(
      `SELECT employee_status,sk_file,tmt_sk_dosen,functional_title,functional_title_file
       FROM profiles WHERE user_id=?`,
      [req.user.id]
    );

    res.json({
      dosen_verification_status: user.dosen_verification_status || 'unverified',
      dosen_verification_reject_reason: user.dosen_verification_reject_reason || null,
      dosen_verification_verified_at: user.dosen_verification_verified_at || null,
      submission: profile || null
    });
  }catch(err){next(err);}
};

exports.submit = async (req,res,next)=>{
  try{
    if(req.user.role!=='DOSEN') return res.status(403).json({message:'Akses ditolak'});

    const { employee_status, tmt_sk_dosen, functional_title } = req.body;
    const skFile = req.files?.sk_file?.[0] ? `/uploads/${req.files.sk_file[0].filename}` : (req.body.sk_file || null);
    const functionalTitleFile = req.files?.functional_title_file?.[0] ? `/uploads/${req.files.functional_title_file[0].filename}` : (req.body.functional_title_file || null);

    if(!employee_status || !['PNS','PPPK','NON_PNS'].includes(employee_status)) return res.status(400).json({message:'Status pegawai wajib dipilih'});
    if(!tmt_sk_dosen) return res.status(400).json({message:'TMT SK Dosen wajib diisi'});
    if(!functional_title || !['ASISTEN_AHLI','LEKTOR','LEKTOR_KEPALA'].includes(functional_title)) return res.status(400).json({message:'Jabatan fungsional wajib dipilih'});
    if(!skFile) return res.status(400).json({message:'Upload SK Dosen wajib diisi'});
    if(!functionalTitleFile) return res.status(400).json({message:'Upload SK Jabatan Fungsional wajib diisi'});

    await db.query(
      `INSERT INTO profiles (user_id,employee_status,sk_file,tmt_sk_dosen,functional_title,functional_title_file)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE employee_status=VALUES(employee_status),sk_file=VALUES(sk_file),tmt_sk_dosen=VALUES(tmt_sk_dosen),functional_title=VALUES(functional_title),functional_title_file=VALUES(functional_title_file)`,
      [req.user.id,employee_status,skFile,tmt_sk_dosen,functional_title,functionalTitleFile]
    );

    await db.query(
      `INSERT INTO dosen_verification_submissions (user_id,period_id,employee_status,sk_file,tmt_sk_dosen,functional_title,functional_title_file,status)
       VALUES (?,?,?,?,?,?,?,'pending')`,
      [req.user.id,req.user.period_id||null,employee_status,skFile,tmt_sk_dosen,functional_title,functionalTitleFile]
    );

    await db.query(
      `UPDATE users
       SET dosen_verification_status='pending', dosen_verification_reject_reason=NULL, dosen_verification_verified_at=NULL, dosen_verification_verified_by=NULL
       WHERE id=?`,
      [req.user.id]
    );

    res.status(201).json({message:'Verifikasi dosen tahap 1 berhasil dikirim dan menunggu verifikasi admin'});
  }catch(err){next(err);}
};

exports.adminList = async (req,res,next)=>{
  try{
    const status = req.query.status || 'pending';
    const allowed = ['unverified','pending','verified','rejected'];
    if(!allowed.includes(status)) return res.status(400).json({message:'Status filter tidak valid'});

    if(status==='unverified'){
      const [rows] = await db.query(
        `SELECT u.id,u.name AS user_name,u.email AS user_email,u.period_id,u.dosen_verification_status,u.dosen_verification_reject_reason,
                u.dosen_verification_verified_at,u.dosen_verification_verified_by,u.created_at,
                p.label AS period_label,
                reviewer.name AS reviewed_by_name,
                pr.employee_status,pr.sk_file,pr.tmt_sk_dosen,pr.functional_title,pr.functional_title_file
         FROM users u
         LEFT JOIN periods p ON p.id=u.period_id
         LEFT JOIN profiles pr ON pr.user_id=u.id
         LEFT JOIN users reviewer ON reviewer.id=u.dosen_verification_verified_by
         WHERE u.role='DOSEN' AND u.dosen_verification_status='unverified'
         ORDER BY u.created_at DESC,u.id DESC`
      );
      return res.json(rows);
    }

    const [rows] = await db.query(
      `SELECT dvs.id,dvs.user_id,dvs.period_id,dvs.employee_status,dvs.sk_file,dvs.tmt_sk_dosen,dvs.functional_title,dvs.functional_title_file,
              dvs.status AS dosen_verification_status,dvs.reject_reason AS dosen_verification_reject_reason,
              dvs.reviewed_at AS dosen_verification_verified_at,dvs.reviewed_by AS dosen_verification_verified_by,dvs.created_at,
              u.name AS user_name,u.email AS user_email,
              p.label AS period_label,
              reviewer.name AS reviewed_by_name
       FROM dosen_verification_submissions dvs
       JOIN users u ON u.id=dvs.user_id
       LEFT JOIN periods p ON p.id=dvs.period_id
       LEFT JOIN users reviewer ON reviewer.id=dvs.reviewed_by
       WHERE dvs.status=?
       ORDER BY COALESCE(dvs.reviewed_at,dvs.created_at) DESC,dvs.id DESC`,
      [status]
    );

    res.json(rows);
  }catch(err){next(err);}
};

exports.adminVerify = async (req,res,next)=>{
  try{
    const id = parseInt(req.params.id,10);
    if(!id) return res.status(400).json({message:'ID user tidak valid'});

    const [[submission]] = await db.query(
      `SELECT dvs.id,dvs.user_id,dvs.status,u.role
       FROM dosen_verification_submissions dvs
       JOIN users u ON u.id=dvs.user_id
       WHERE dvs.id=?`,
      [id]
    );
    if(!submission || submission.role!=='DOSEN') return res.status(404).json({message:'Data dosen tidak ditemukan'});
    if(submission.status!=='pending') return res.status(400).json({message:'Data ini sudah direview'});

    await db.query(
      `UPDATE dosen_verification_submissions
       SET status='verified', reviewed_by=?, reviewed_at=NOW(), reject_reason=NULL
       WHERE id=?`,
      [req.user.id,id]
    );

    await db.query(
      `UPDATE users
       SET dosen_verification_status='verified', dosen_verification_verified_at=NOW(), dosen_verification_verified_by=?, dosen_verification_reject_reason=NULL
       WHERE id=?`,
      [req.user.id,submission.user_id]
    );

    res.json({message:'Verifikasi dosen tahap 1 berhasil disetujui'});
  }catch(err){next(err);}
};

exports.adminReject = async (req,res,next)=>{
  try{
    const id = parseInt(req.params.id,10);
    if(!id) return res.status(400).json({message:'ID user tidak valid'});

    const rejectReason = (req.body.reject_reason || '').trim();
    if(!rejectReason) return res.status(400).json({message:'Catatan revisi wajib diisi'});

    const [[submission]] = await db.query(
      `SELECT dvs.id,dvs.user_id,dvs.status,u.role
       FROM dosen_verification_submissions dvs
       JOIN users u ON u.id=dvs.user_id
       WHERE dvs.id=?`,
      [id]
    );
    if(!submission || submission.role!=='DOSEN') return res.status(404).json({message:'Data dosen tidak ditemukan'});
    if(submission.status!=='pending') return res.status(400).json({message:'Data ini sudah direview'});

    await db.query(
      `UPDATE dosen_verification_submissions
       SET status='rejected', reviewed_by=?, reviewed_at=NOW(), reject_reason=?
       WHERE id=?`,
      [req.user.id,rejectReason,id]
    );

    await db.query(
      `UPDATE users
       SET dosen_verification_status='rejected', dosen_verification_verified_at=NULL, dosen_verification_verified_by=NULL, dosen_verification_reject_reason=?
       WHERE id=?`,
      [rejectReason,submission.user_id]
    );

    res.json({message:'Verifikasi dosen tahap 1 dikembalikan untuk revisi'});
  }catch(err){next(err);}
};

exports.adminDelete = async (req,res,next)=>{
  try{
    const id = parseInt(req.params.id,10);
    if(!id) return res.status(400).json({message:'ID user tidak valid'});

    const [[submission]] = await db.query(
      `SELECT dvs.user_id,u.role,u.name
       FROM dosen_verification_submissions dvs
       JOIN users u ON u.id=dvs.user_id
       WHERE dvs.id=?`,
      [id]
    );
    if(!submission || submission.role!=='DOSEN') return res.status(404).json({message:'Data dosen tidak ditemukan'});

    await db.query('DELETE FROM users WHERE id=?',[submission.user_id]);
    res.json({message:`Akun peserta ${submission.name} berhasil dihapus`});
  }catch(err){next(err);}
};
