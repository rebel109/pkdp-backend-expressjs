const bcrypt=require('bcrypt'),jwt=require('jsonwebtoken'),crypto=require('crypto'),nodemailer=require('nodemailer');
const {validationResult}=require('express-validator');
const db=require('../config/db');
const { saveProfileSnapshot } = require('../utils/profileSnapshot');

const upsertUserPeriodRole=(userId,periodId,role,status,sourceType,sourceId=null)=>db.query(
  `INSERT INTO user_period_roles (user_id,period_id,role,status,source_type,source_id)
   VALUES (?,?,?,?,?,?)
   ON DUPLICATE KEY UPDATE status=VALUES(status), source_type=VALUES(source_type), source_id=VALUES(source_id)`,
  [userId,periodId,role,status,sourceType,sourceId]
);

const getRestrictedToCertificates=async user=>{
  if(!['DOSEN','NARASUMBER'].includes(user.role)||!user.period_id) return false;
  const[[period]]=await db.query('SELECT is_active FROM periods WHERE id=?',[user.period_id]);
  if(!period) return false;
  return !period.is_active;
};

const hashResetToken=token=>crypto.createHash('sha256').update(token).digest('hex');

const getFrontendUrl=()=>String(process.env.FRONTEND_URL||process.env.CLIENT_URL||'http://localhost:5173').replace(/\/$/,'');

const getMailer=()=>{
  const host=process.env.SMTP_HOST;
  const port=Number(process.env.SMTP_PORT||587);
  const user=process.env.SMTP_USER;
  const pass=process.env.SMTP_PASS;
  if(!host||!user||!pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure:String(process.env.SMTP_SECURE||'false')==='true'||port===465,
    auth:{user,pass}
  });
};

const sendPasswordResetEmail=async({email,name,resetUrl})=>{
  const mailer=getMailer();
  if(!mailer) return false;
  const from=process.env.MAIL_FROM||process.env.SMTP_USER;
  await mailer.sendMail({
    from,
    to:email,
    subject:'Reset Password PKDP',
    text:`Halo ${name||''},\n\nGunakan link berikut untuk mengatur ulang password PKDP Anda:\n${resetUrl}\n\nLink berlaku 30 menit. Abaikan email ini jika Anda tidak meminta reset password.`,
    html:`<p>Halo ${name||''},</p><p>Gunakan link berikut untuk mengatur ulang password PKDP Anda:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Link berlaku 30 menit. Abaikan email ini jika Anda tidak meminta reset password.</p>`
  });
  return true;
};

exports.register=async(req,res,next)=>{
  try{
    const e=validationResult(req);
    if(!e.isEmpty()) return res.status(422).json({errors:e.array()});
    const{name,email,password,role,period_id}=req.body;
    const consent_file = req.file ? `/uploads/${req.file.filename}` : req.body.consent_file;
    const normalizedEmail=(email||'').trim().toLowerCase();
    const selectedRole=role||'DOSEN';

    if(selectedRole==='NARASUMBER'){
      if(!normalizedEmail.endsWith('@radenfatah.ac.id')) return res.status(400).json({message:'Email narasumber wajib menggunakan @radenfatah.ac.id'});
      if(!consent_file||String(consent_file).trim()==='') return res.status(400).json({message:'Surat kesediaan narasumber wajib diunggah'});
      if(!period_id) return res.status(400).json({message:'Pilih periode penugasan terlebih dahulu'});

      const[[period]]=await db.query('SELECT id,registration_open FROM periods WHERE id=?',[period_id]);
      if(!period) return res.status(400).json({message:'Periode tidak valid'});
      if(!period.registration_open) return res.status(400).json({message:'Pendaftaran ditutup untuk periode ini. Hubungi Admin.'});

      const[existingUsers]=await db.query('SELECT id,role FROM users WHERE email=?',[normalizedEmail]);
      const existingUser=existingUsers[0];

      if(existingUser){
        if(existingUser.role==='ADMIN') return res.status(409).json({message:'Email admin tidak dapat digunakan untuk pendaftaran narasumber.'});

        const[existingSubmissions]=await db.query(
          'SELECT id FROM narasumber_submissions WHERE user_id=? AND period_id=? LIMIT 1',
          [existingUser.id,period_id]
        );
        if(existingSubmissions.length) return res.status(409).json({message:'Akun ini sudah mengajukan narasumber pada periode ini'});

        const[submissionResult]=await db.query(
          `INSERT INTO narasumber_submissions (user_id,period_id,consent_file,status)
           VALUES (?,?,?,'pending')`,
          [existingUser.id,period_id,consent_file]
        );
        await upsertUserPeriodRole(existingUser.id,period_id,'NARASUMBER','pending','narasumber_submission',submissionResult.insertId);
        await saveProfileSnapshot(existingUser.id,period_id,'NARASUMBER',submissionResult.insertId);
        await db.query(
          `UPDATE users
           SET narasumber_status='pending', narasumber_reject_reason=NULL, narasumber_verified_at=NULL, narasumber_verified_by=NULL, period_id=?
           WHERE id=?`,
          [period_id,existingUser.id]
        );

        return res.status(201).json({message:'Pengajuan narasumber berhasil memakai akun yang sudah terdaftar. Password akun tidak diubah; silakan login dengan password lama setelah pengajuan diverifikasi admin.',userId:existingUser.id,existing:true});
      }
    }else{
      const[exist]=await db.query('SELECT id FROM users WHERE email=?',[normalizedEmail]);
      if(exist.length) return res.status(409).json({message:'Email sudah terdaftar'});
    }

    if(selectedRole==='DOSEN'&&period_id){
      const[[p]]=await db.query('SELECT registration_open FROM periods WHERE id=?',[period_id]);
      if(!p) return res.status(400).json({message:'Periode tidak valid'});
      if(!p.registration_open) return res.status(400).json({message:'Pendaftaran ditutup untuk periode ini. Hubungi Admin.'});
    }

    const hashed=await bcrypt.hash(password,12);
    const initialNarasumberStatus=selectedRole==='NARASUMBER'?'pending':'verified';
    const[r]=await db.query(
      'INSERT INTO users (name,email,password,role,period_id,narasumber_status,dosen_verification_status) VALUES (?,?,?,?,?,?,?)',
      [name,normalizedEmail,hashed,selectedRole,period_id||null,initialNarasumberStatus,selectedRole==='DOSEN'?'unverified':'verified']
    );
    await db.query('INSERT INTO profiles (user_id) VALUES (?)',[r.insertId]);

    if(selectedRole==='NARASUMBER'){
      const[submissionResult]=await db.query(
        `INSERT INTO narasumber_submissions (user_id,period_id,consent_file,status)
         VALUES (?,?,?,'pending')`,
        [r.insertId,period_id,consent_file]
      );
      await upsertUserPeriodRole(r.insertId,period_id,'NARASUMBER','pending','narasumber_submission',submissionResult.insertId);
      await saveProfileSnapshot(r.insertId,period_id,'NARASUMBER',submissionResult.insertId);
    }else if(selectedRole==='DOSEN'&&period_id){
      await upsertUserPeriodRole(r.insertId,period_id,'DOSEN','unverified','registration',null);
      await saveProfileSnapshot(r.insertId,period_id,'DOSEN',null);
    }

    res.status(201).json({message:'Registrasi berhasil',userId:r.insertId});
  }catch(err){next(err);}
};

exports.login=async(req,res,next)=>{
  try{
    const e=validationResult(req);
    if(!e.isEmpty()) return res.status(422).json({errors:e.array()});
    const{email,password}=req.body;
    const[rows]=await db.query('SELECT id,name,email,password,role,status,payment_status,payment_reject_reason,dosen_verification_status,dosen_verification_reject_reason,narasumber_status,narasumber_reject_reason,period_id,profile_complete FROM users WHERE email=?',[email]);
    if(!rows.length) return res.status(401).json({message:'Email atau password salah'});
    const user=rows[0];
    if(user.status==='blocked') return res.status(403).json({message:'Akun Anda diblokir'});
    let latestNarasumberSubmission=null;
    if(user.role==='NARASUMBER'){
      const[[activeSubmission]]=await db.query(
        `SELECT ns.status,ns.reject_reason,ns.period_id
         FROM narasumber_submissions ns
         JOIN periods p ON p.id=ns.period_id
         WHERE ns.user_id=? AND p.is_active=1
         ORDER BY p.year DESC,p.id DESC,ns.created_at DESC,ns.id DESC
         LIMIT 1`,
        [user.id]
      );
      latestNarasumberSubmission=activeSubmission||null;
      if(!latestNarasumberSubmission){
        return res.status(403).json({message:'Narasumber belum terdaftar pada periode aktif'});
      }

      user.period_id=latestNarasumberSubmission.period_id;
      user.narasumber_status=latestNarasumberSubmission.status;
      user.narasumber_reject_reason=latestNarasumberSubmission.reject_reason||null;
    }

    const restrictedToCertificates=await getRestrictedToCertificates(user);

    const match=await bcrypt.compare(password,user.password);
    if(!match) return res.status(401).json({message:'Email atau password salah'});
    const token=jwt.sign({id:user.id,email:user.email,role:user.role,period_id:user.period_id,payment_status:user.payment_status,dosen_verification_status:user.dosen_verification_status,narasumber_status:user.narasumber_status,restricted_to_certificates:restrictedToCertificates},process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRES_IN||'7d'});
    res.json({token,user:{id:user.id,name:user.name,email:user.email,role:user.role,period_id:user.period_id,profile_complete:user.profile_complete||false,payment_status:user.payment_status||'unpaid',payment_reject_reason:user.payment_reject_reason||null,dosen_verification_status:user.dosen_verification_status||'unverified',dosen_verification_reject_reason:user.dosen_verification_reject_reason||null,narasumber_status:user.narasumber_status||'pending',narasumber_reject_reason:user.narasumber_reject_reason||null,restricted_to_certificates:restrictedToCertificates}});
  }catch(err){next(err);}
};

exports.forgotPassword=async(req,res,next)=>{
  try{
    const e=validationResult(req);
    if(!e.isEmpty()) return res.status(422).json({errors:e.array()});
    const email=String(req.body.email||'').trim().toLowerCase();
    const successMessage='Link reset password telah dikirim ke email Anda.';
    const[[user]]=await db.query('SELECT id,name,email,status FROM users WHERE email=?',[email]);
    if(!user) return res.status(404).json({message:'Email belum terdaftar.'});
    if(user.status==='blocked') return res.status(403).json({message:'Akun Anda diblokir. Hubungi admin.'});

    await db.query('UPDATE password_reset_tokens SET used_at=NOW() WHERE user_id=? AND used_at IS NULL',[user.id]);
    const token=crypto.randomBytes(32).toString('hex');
    const tokenHash=hashResetToken(token);
    await db.query(
      `INSERT INTO password_reset_tokens (user_id,token_hash,expires_at)
       VALUES (?,?,DATE_ADD(NOW(),INTERVAL 30 MINUTE))`,
      [user.id,tokenHash]
    );

    const resetUrl=`${getFrontendUrl()}/reset-password/${token}`;
    const sent=await sendPasswordResetEmail({email:user.email,name:user.name,resetUrl});
    if(!sent) return res.status(503).json({message:'Fitur reset password belum aktif. Konfigurasi SMTP belum tersedia di server.'});
    res.json({message:successMessage});
  }catch(err){next(err);}
};

exports.resetPassword=async(req,res,next)=>{
  try{
    const e=validationResult(req);
    if(!e.isEmpty()) return res.status(422).json({errors:e.array()});
    const token=String(req.body.token||'').trim();
    const password=String(req.body.password||'');
    const tokenHash=hashResetToken(token);
    const[[row]]=await db.query(
      `SELECT prt.id,prt.user_id
       FROM password_reset_tokens prt
       JOIN users u ON u.id=prt.user_id
       WHERE prt.token_hash=? AND prt.used_at IS NULL AND prt.expires_at>NOW() AND u.status='active'
       LIMIT 1`,
      [tokenHash]
    );
    if(!row) return res.status(400).json({message:'Link reset password tidak valid atau sudah kedaluwarsa.'});

    const hashed=await bcrypt.hash(password,12);
    await db.query('UPDATE users SET password=? WHERE id=?',[hashed,row.user_id]);
    await db.query('UPDATE password_reset_tokens SET used_at=NOW() WHERE id=?',[row.id]);
    res.json({message:'Password berhasil diubah. Silakan login dengan password baru.'});
  }catch(err){next(err);}
};

exports.me=async(req,res,next)=>{
  try{
    const[rows]=await db.query(
      `SELECT u.id,u.name,u.email,u.role,u.status,u.period_id,u.profile_complete,
              u.payment_status,u.payment_reject_reason,u.payment_verified_at,
              u.dosen_verification_status,u.dosen_verification_reject_reason,u.dosen_verification_verified_at,
              u.narasumber_status,u.narasumber_reject_reason,u.narasumber_verified_at,
              p.label AS period_label,p.year AS period_year,
              pr.nip,pr.nuptk,pr.institution,pr.department,pr.phone,pr.bio,pr.avatar_url
       FROM users u
       LEFT JOIN periods p ON p.id=u.period_id
       LEFT JOIN profiles pr ON pr.user_id=u.id
       WHERE u.id=?`,[req.user.id]);
    if(!rows.length) return res.status(404).json({message:'User tidak ditemukan'});
    rows[0].restricted_to_certificates=await getRestrictedToCertificates(rows[0]);
    res.json(rows[0]);
  }catch(err){next(err);}
};
