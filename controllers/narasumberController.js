const db = require('../config/db');
const puppeteer = require('puppeteer');
const { saveProfileSnapshot } = require('../utils/profileSnapshot');

const upsertUserPeriodRole=(userId,periodId,role,status,sourceType,sourceId=null)=>db.query(
  `INSERT INTO user_period_roles (user_id,period_id,role,status,source_type,source_id)
   VALUES (?,?,?,?,?,?)
   ON DUPLICATE KEY UPDATE status=VALUES(status), source_type=VALUES(source_type), source_id=VALUES(source_id)`,
  [userId,periodId,role,status,sourceType,sourceId]
);

const esc=(value='')=>String(value??'')
  .replace(/&/g,'&amp;')
  .replace(/</g,'&lt;')
  .replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;')
  .replace(/'/g,'&#39;');

const buildAdminRecapQuery=({period_id,account_status,search}={})=>{
  const params=[];
  let where="WHERE u.role='NARASUMBER'";
  if(period_id){where+=' AND u.period_id=?';params.push(period_id);}
  if(account_status){
    const allowed=['active','blocked'];
    if(!allowed.includes(account_status)){const err=new Error('Status akun tidak valid');err.statusCode=400;throw err;}
    where+=' AND u.status=?';params.push(account_status);
  }
  if(search){
    const s=`%${String(search).trim()}%`;
    where+=` AND (u.name LIKE ? OR u.email LIKE ? OR pr.nip LIKE ? OR pr.nidn LIKE ? OR pr.phone LIKE ? OR pr.institution LIKE ? OR pr.unit_kerja LIKE ? OR pr.department LIKE ?)`;
    params.push(s,s,s,s,s,s,s,s);
  }
  return {where,params};
};

const getAdminRecapRows=async(filters={})=>{
  const {where,params}=buildAdminRecapQuery(filters);
  const[rows]=await db.query(
    `SELECT u.id AS user_id,u.id,u.name,u.email,u.role AS user_role,u.status AS account_status,u.narasumber_status,u.period_id,u.created_at,
            p.label AS period_label,p.year AS period_year,
            pr.nip,pr.nidn,pr.phone,pr.unit_kerja,pr.institution,pr.department,pr.avatar_url,
            pr.golongan,pr.npwp,pr.rekening_no,pr.rekening_name,pr.bank_name,pr.cv_file,pr.rekening_file,
            latest.id AS submission_id,latest.consent_file,latest.status AS submission_status,latest.reviewed_at,latest.reject_reason,
            reviewer.name AS reviewed_by_name,
            COALESCE(activity.activity_count,0) AS activity_count,
            COALESCE(activity.total_hours,0) AS total_hours,
            activity.topic_summary,
            activity.last_activity_at
     FROM users u
     LEFT JOIN profiles pr ON pr.user_id=u.id
     LEFT JOIN periods p ON p.id=u.period_id
     LEFT JOIN narasumber_submissions latest ON latest.id=(
       SELECT ns.id FROM narasumber_submissions ns
       WHERE ns.user_id=u.id
       ORDER BY ns.created_at DESC,ns.id DESC
       LIMIT 1
     )
     LEFT JOIN users reviewer ON reviewer.id=latest.reviewed_by
     LEFT JOIN (
       SELECT cn.narasumber_id,
              COUNT(DISTINCT t.id) AS activity_count,
              ROUND(COALESCE(SUM(DISTINCT CASE
                WHEN ss.start_time IS NOT NULL AND ss.end_time IS NOT NULL AND ss.end_time>ss.start_time
                THEN TIME_TO_SEC(TIMEDIFF(ss.end_time,ss.start_time))/3600
                ELSE 0
              END),0),2) AS total_hours,
              GROUP_CONCAT(DISTINCT COALESCE(ss.module_title,t.title) ORDER BY COALESCE(ss.slot_date,t.created_at) SEPARATOR ', ') AS topic_summary,
              MAX(ss.slot_date) AS last_activity_at
       FROM class_narasumber cn
       LEFT JOIN tasks t ON t.class_id=cn.class_id AND (cn.material_id IS NULL OR cn.material_id=t.id OR (t.material_id IS NOT NULL AND cn.material_id=t.material_id))
       LEFT JOIN schedule_slots ss ON ss.task_id=t.id
       GROUP BY cn.narasumber_id
     ) activity ON activity.narasumber_id=u.id
     ${where}
     ORDER BY p.year DESC,p.id DESC,u.name`,
    params
  );
  return rows;
};

exports.publicTemplate = async (_req,res,next)=>{
  try{
    const [[row]] = await db.query(
      `SELECT setting_value FROM app_settings WHERE setting_key='narasumber_consent_template' LIMIT 1`
    );
    res.json({template_url: row?.setting_value || null});
  }catch(err){next(err);}
};

exports.submit = async (req,res,next)=>{
  try{
    if(req.user.role==='ADMIN') return res.status(403).json({message:'Akses ditolak'});
    if(!req.file) return res.status(400).json({message:'Surat kesediaan wajib diunggah'});

    const periodId = req.body.period_id || req.user.period_id;
    if(!periodId) return res.status(400).json({message:'Pilih periode penugasan terlebih dahulu'});

    const [[period]] = await db.query('SELECT id,is_active FROM periods WHERE id=?',[periodId]);
    if(!period) return res.status(400).json({message:'Periode tidak valid'});
    if(!period.is_active) return res.status(400).json({message:'Pendaftaran ditutup untuk periode ini. Hubungi Admin.'});

    const [existing] = await db.query(
      'SELECT id FROM narasumber_submissions WHERE user_id=? AND period_id=? LIMIT 1',
      [req.user.id, periodId]
    );
    if(existing.length) return res.status(409).json({message:'Narasumber sudah terdaftar pada periode ini'});

    const consentFile = `/uploads/${req.file.filename}`;

    const[submissionResult] = await db.query(
      `INSERT INTO narasumber_submissions (user_id,period_id,consent_file,status)
       VALUES (?,?,?,'pending')`,
      [req.user.id, periodId, consentFile]
    );
    await upsertUserPeriodRole(req.user.id, periodId, 'NARASUMBER', 'pending', 'narasumber_submission', submissionResult.insertId);
    await saveProfileSnapshot(req.user.id, periodId, 'NARASUMBER', submissionResult.insertId);

    await db.query(
      `UPDATE users
       SET narasumber_status='pending', narasumber_reject_reason=NULL, narasumber_verified_at=NULL, narasumber_verified_by=NULL, period_id=?
       WHERE id=?`,
      [periodId, req.user.id]
    );

    res.status(201).json({message:'Surat kesediaan berhasil dikirim dan menunggu verifikasi admin'});
  }catch(err){next(err);}
};

exports.myStatus = async (req,res,next)=>{
  try{
    const [[u]] = await db.query(
      `SELECT id,role,narasumber_status,narasumber_reject_reason,narasumber_verified_at
       FROM users WHERE id=?`,
      [req.user.id]
    );
    if(!u) return res.status(404).json({message:'User tidak ditemukan'});

    const [[latest]] = await db.query(
      `SELECT ns.id,ns.period_id,ns.consent_file,ns.status,ns.reviewed_by,ns.reviewed_at,ns.reject_reason,ns.created_at,
              p.label AS period_label,p.year AS period_year,
              reviewer.name AS reviewed_by_name
       FROM narasumber_submissions ns
       LEFT JOIN periods p ON p.id=ns.period_id
       LEFT JOIN users reviewer ON reviewer.id=ns.reviewed_by
       WHERE ns.user_id=?
       ORDER BY ns.created_at DESC, ns.id DESC
       LIMIT 1`,
      [req.user.id]
    );

    const [history] = await db.query(
      `SELECT ns.id,ns.period_id,ns.consent_file,ns.status,ns.reviewed_by,ns.reviewed_at,ns.reject_reason,ns.created_at,
              p.label AS period_label,p.year AS period_year,
              reviewer.name AS reviewed_by_name
       FROM narasumber_submissions ns
       LEFT JOIN periods p ON p.id=ns.period_id
       LEFT JOIN users reviewer ON reviewer.id=ns.reviewed_by
       WHERE ns.user_id=?
       ORDER BY ns.created_at DESC, ns.id DESC`,
      [req.user.id]
    );

    res.json({
      narasumber_status: latest?.status || u.narasumber_status || 'pending',
      narasumber_reject_reason: latest?.reject_reason || u.narasumber_reject_reason || null,
      narasumber_verified_at: latest?.reviewed_at || u.narasumber_verified_at || null,
      latest_submission: latest || null,
      history
    });
  }catch(err){next(err);}
};

exports.adminList = async (req,res,next)=>{
  try{
    const status = req.query.status || 'pending';
    const allowed = ['pending','verified','rejected'];
    if(!allowed.includes(status)) return res.status(400).json({message:'Status filter tidak valid'});

    const [rows] = await db.query(
      `SELECT ns.id,ns.user_id,ns.period_id,ns.consent_file,ns.status,ns.reviewed_by,ns.reviewed_at,ns.reject_reason,ns.created_at,
              u.name AS user_name,u.email AS user_email,u.narasumber_status,
              p.label AS period_label,
              reviewer.name AS reviewed_by_name
       FROM narasumber_submissions ns
       JOIN users u ON u.id=ns.user_id
       LEFT JOIN periods p ON p.id=ns.period_id
       LEFT JOIN users reviewer ON reviewer.id=ns.reviewed_by
       WHERE ns.status=?
       ORDER BY ns.created_at DESC, ns.id DESC`,
      [status]
    );

    res.json(rows);
  }catch(err){next(err);}
};

exports.adminRecap = async (req,res,next)=>{
  try{
    const rows=await getAdminRecapRows(req.query);
    res.json(rows);
  }catch(err){next(err);}
};

exports.adminRecapPdf = async (req,res,next)=>{
  try{
    const rows=await getAdminRecapRows(req.query);
    const generatedAt=new Date().toLocaleString('id-ID',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const periodLabel=req.query.period_id?'Periode terfilter':'Semua periode';
    const accountStatusLabel=req.query.account_status?`Status akun: ${req.query.account_status}`:'Semua status akun';
    const searchLabel=req.query.search||'Tanpa pencarian';
    const activeCount=rows.filter(r=>r.account_status==='active').length;
    const totalHours=rows.reduce((sum,r)=>sum+(Number(r.total_hours)||0),0);

    const bodyRows=rows.map((r,i)=>{
      const topics=String(r.topic_summary||'').split(',').map(v=>v.trim()).filter(Boolean);
      const topicHtml=topics.length
        ? `<ul>${topics.slice(0,4).map(topic=>`<li>${esc(topic)}</li>`).join('')}${topics.length>4?`<li>+${topics.length-4} topik lainnya</li>`:''}</ul>`
        : '<span class="muted">—</span>';
      return `<tr>
        <td class="no">${i+1}</td>
        <td><strong>${esc(r.name||'—')}</strong><div class="subtext">${esc(r.email||'—')}</div></td>
        <td>${esc(r.nip||r.nidn||'—')}</td>
        <td>${esc(r.phone||'—')}</td>
        <td>${esc(r.golongan||'—')}</td>
        <td><strong>${esc(r.bank_name||'—')}</strong><div class="subtext">${esc(r.rekening_no||'—')} · ${esc(r.rekening_name||'—')}</div></td>
        <td class="num">${esc(r.total_hours||0)}</td>
        <td>${topicHtml}</td>
        <td>${esc(r.period_label||'—')}</td>
      </tr>`;
    }).join('');

    const html=`<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Rekap Narasumber</title>
  <style>
    @page{size:A4 landscape;margin:12mm}
    *{box-sizing:border-box}
    body{font-family:Arial,sans-serif;color:#172033;margin:0;font-size:10px;background:#fff}
    .sheet{border:1px solid #d7e3f4;border-radius:18px;overflow:hidden;box-shadow:0 12px 32px rgba(30,64,175,.08)}
    .header{padding:22px 26px;background:linear-gradient(135deg,#123f5c 0%,#0f5f8f 52%,#1db6e7 100%);color:#fff;position:relative}
    .header:after{content:"";position:absolute;right:-42px;top:-50px;width:180px;height:180px;border-radius:50%;background:rgba(255,255,255,.18)}
    .eyebrow{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.16em;opacity:.9;margin-bottom:7px}
    h1{font-size:22px;margin:0 0 7px;text-transform:uppercase;letter-spacing:.03em;line-height:1.2}
    .subtitle{font-size:12px;opacity:.92;max-width:680px;line-height:1.5}
    .meta{display:grid;grid-template-columns:1.25fr 1fr 1.35fr 1fr;gap:10px;padding:14px 18px;background:#f7fbff;border-bottom:1px solid #d7e3f4}
    .meta-card{padding:10px 12px;border:1px solid #dbeafe;border-radius:12px;background:#fff}
    .meta-label{font-size:8px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;font-weight:800;margin-bottom:4px}
    .meta-value{font-size:11px;color:#0f172a;font-weight:700;line-height:1.35}
    .content{padding:18px}
    .table-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;color:#334155;font-size:11px}
    .table-title strong{font-size:13px;color:#0f172a}
    table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #cbd5e1;border-radius:12px;overflow:hidden}
    th,td{padding:9px 10px;vertical-align:top;line-height:1.4;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0}
    th:last-child,td:last-child{border-right:0}
    tbody tr:last-child td{border-bottom:0}
    th{background:#123f5c;color:#fff;text-align:left;font-weight:800;font-size:9px;text-transform:uppercase;letter-spacing:.04em}
    tbody tr:nth-child(even){background:#f8fafc}
    tbody tr:nth-child(odd){background:#fff}
    ul{margin:0;padding-left:13px}
    li{margin-bottom:3px}
    .no{width:36px;text-align:center;font-weight:700;color:#0f5f8f}
    th.no{color:#fff;text-align:center}
    .num{text-align:center;font-weight:800;color:#0f5f8f}
    .subtext{font-size:8px;color:#64748b;margin-top:2px;line-height:1.35}
    .muted{color:#94a3b8}
    .empty{text-align:center;color:#64748b;padding:18px;font-weight:700}
    .footer{padding:11px 18px;background:#f8fafc;color:#64748b;font-size:10px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;gap:10px}
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div class="eyebrow">Rekap Narasumber PKDP</div>
      <h1>Data Narasumber</h1>
      <div class="subtitle">Daftar narasumber, kontak, rekening, jam/sesi, dan topik materi sesuai filter aktif pada halaman rekap narasumber.</div>
    </div>
    <div class="meta">
      <div class="meta-card"><div class="meta-label">Periode</div><div class="meta-value">${esc(periodLabel)}</div></div>
      <div class="meta-card"><div class="meta-label">Status Akun</div><div class="meta-value">${esc(accountStatusLabel)}</div></div>
      <div class="meta-card"><div class="meta-label">Pencarian</div><div class="meta-value">${esc(searchLabel)}</div></div>
      <div class="meta-card"><div class="meta-label">Ringkasan</div><div class="meta-value">${rows.length} narasumber · ${activeCount} aktif · ${totalHours} jam/sesi</div></div>
    </div>
    <div class="content">
      <div class="table-title"><strong>Daftar Narasumber</strong><span>Dicetak: ${esc(generatedAt)}</span></div>
      <table>
        <thead><tr><th class="no">No</th><th>Nama & Email</th><th>NIP/NIDN</th><th>No HP</th><th>Golongan</th><th>Rekening</th><th>Total Jam/Sesi</th><th>Topik/Materi</th><th>Periode Aktif</th></tr></thead>
        <tbody>${bodyRows||'<tr><td colspan="9" class="empty">Tidak ada data narasumber untuk filter ini.</td></tr>'}</tbody>
      </table>
    </div>
    <div class="footer">
      <span>Dicetak dari Sistem PKDP</span>
      <span>${esc(generatedAt)}</span>
    </div>
  </div>
</body>
</html>`;

    const browser=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox']});
    try{
      const page=await browser.newPage();
      await page.setContent(html,{waitUntil:'networkidle0'});
      const pdf=await page.pdf({format:'A4',landscape:true,printBackground:true,margin:{top:'16mm',right:'16mm',bottom:'16mm',left:'16mm'}});
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition','attachment; filename="rekap-narasumber.pdf"');
      res.send(Buffer.from(pdf));
    }finally{
      await browser.close();
    }
  }catch(err){next(err);}
};

exports.adminHistory = async (req,res,next)=>{
  try{
    const userId=parseInt(req.params.userId,10);
    if(!userId) return res.status(400).json({message:'ID user tidak valid'});
    const[rows]=await db.query(
      `SELECT ns.id,ns.period_id,ns.consent_file,ns.status,ns.reviewed_at,ns.reject_reason,ns.created_at,
              p.label AS period_label,p.year AS period_year,
              reviewer.name AS reviewed_by_name
       FROM narasumber_submissions ns
       LEFT JOIN periods p ON p.id=ns.period_id
       LEFT JOIN users reviewer ON reviewer.id=ns.reviewed_by
       WHERE ns.user_id=?
       ORDER BY p.year DESC,p.id DESC,ns.created_at DESC,ns.id DESC`,
      [userId]
    );
    res.json(rows);
  }catch(err){next(err);}
};

exports.adminVerify = async (req,res,next)=>{
  try{
    const id = parseInt(req.params.id,10);
    if(!id) return res.status(400).json({message:'ID submission tidak valid'});

    const [[submission]] = await db.query(
      `SELECT id,user_id,period_id,status FROM narasumber_submissions WHERE id=?`,
      [id]
    );
    if(!submission) return res.status(404).json({message:'Data pengajuan narasumber tidak ditemukan'});
    if(submission.status!=='pending') return res.status(400).json({message:'Data ini sudah direview'});

    await db.query(
      `UPDATE narasumber_submissions
       SET status='verified', reviewed_by=?, reviewed_at=NOW(), reject_reason=NULL
       WHERE id=?`,
      [req.user.id, id]
    );

    await db.query(
      `UPDATE users
       SET role='NARASUMBER', narasumber_status='verified', narasumber_verified_at=NOW(), narasumber_verified_by=?, narasumber_reject_reason=NULL, period_id=?
       WHERE id=?`,
      [req.user.id, submission.period_id, submission.user_id]
    );
    await upsertUserPeriodRole(submission.user_id, submission.period_id, 'NARASUMBER', 'verified', 'narasumber_submission', submission.id);
    await saveProfileSnapshot(submission.user_id, submission.period_id, 'NARASUMBER', submission.id);

    res.json({message:'Pengajuan narasumber berhasil diverifikasi'});
  }catch(err){next(err);}
};

exports.adminReject = async (req,res,next)=>{
  try{
    const id = parseInt(req.params.id,10);
    if(!id) return res.status(400).json({message:'ID submission tidak valid'});

    const rejectReason = (req.body.reject_reason || '').trim();
    if(!rejectReason) return res.status(400).json({message:'Alasan penolakan wajib diisi'});

    const [[submission]] = await db.query(
      `SELECT id,user_id,period_id,status FROM narasumber_submissions WHERE id=?`,
      [id]
    );
    if(!submission) return res.status(404).json({message:'Data pengajuan narasumber tidak ditemukan'});
    if(submission.status!=='pending') return res.status(400).json({message:'Data ini sudah direview'});

    await db.query(
      `UPDATE narasumber_submissions
       SET status='rejected', reviewed_by=?, reviewed_at=NOW(), reject_reason=?
       WHERE id=?`,
      [req.user.id, rejectReason, id]
    );

    await db.query(
      `UPDATE users
       SET narasumber_status='rejected', narasumber_verified_at=NULL, narasumber_verified_by=NULL, narasumber_reject_reason=?, period_id=?
       WHERE id=?`,
      [rejectReason, submission.period_id, submission.user_id]
    );
    await upsertUserPeriodRole(submission.user_id, submission.period_id, 'NARASUMBER', 'rejected', 'narasumber_submission', submission.id);

    res.json({message:'Pengajuan narasumber ditolak'});
  }catch(err){next(err);}
};

exports.adminSetTemplate = async (req,res,next)=>{
  try{
    if(!req.file) return res.status(400).json({message:'File template wajib diunggah'});
    const templateUrl = `/uploads/${req.file.filename}`;

    await db.query(
      `INSERT INTO app_settings (setting_key,setting_value)
       VALUES ('narasumber_consent_template',?)
       ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_at=CURRENT_TIMESTAMP`,
      [templateUrl]
    );

    res.json({message:'Template surat kesediaan berhasil diperbarui',template_url:templateUrl});
  }catch(err){next(err);}
};
