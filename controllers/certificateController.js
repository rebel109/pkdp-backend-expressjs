const db = require('../config/db');
const path = require('path');
const { renderCertificatePdf, validateLayout } = require('../services/certificateRenderer');
const { computeKelulusan, makeVerificationToken, makeCertificateNo, safeJsonParse } = require('../utils/certificateHelpers');

const ensureAdmin = (req) => {
  if(req.user?.role!=='ADMIN'){
    const err=new Error('Akses ditolak');
    err.statusCode=403;
    throw err;
  }
};

const parseLayout=(raw)=>{
  if(!raw) return {page1:{elements:[]},page2:{elements:[]}};
  const layout=typeof raw==='string'?JSON.parse(raw):raw;
  return validateLayout(layout);
};

const getActiveTemplate = async (type) => {
  const [[row]] = await db.query(
    `SELECT * FROM certificate_templates WHERE type=? AND is_active=1 ORDER BY id DESC LIMIT 1`,
    [type]
  );
  return row || null;
};

const getSettings = async ()=>{
  const [[settings]] = await db.query(`SELECT * FROM certificate_settings WHERE id=1 LIMIT 1`);
  return settings || null;
};

const ensureCertificateNumberSettingsTable = async ()=>{
  await db.query(`
    CREATE TABLE IF NOT EXISTS certificate_number_settings (
      id INT(11) NOT NULL AUTO_INCREMENT,
      year YEAR(4) NOT NULL,
      certificate_no_start INT(11) NOT NULL DEFAULT 1,
      updated_by INT(11) DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_certificate_number_settings_year (year),
      KEY idx_certificate_number_settings_updated_by (updated_by)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
};

const getNumberSettingByYear = async year => {
  await ensureCertificateNumberSettingsTable();
  const resolvedYear=Number.parseInt(year,10);
  if(!Number.isFinite(resolvedYear)||resolvedYear<2000||resolvedYear>9999) return null;
  const [[row]] = await db.query(
    `SELECT year,certificate_no_start,updated_by,updated_at FROM certificate_number_settings WHERE year=? LIMIT 1`,
    [resolvedYear]
  );
  return row || null;
};

const resolveNumberSettingYear = value => {
  const parsed=Number.parseInt(value,10);
  const currentYear=new Date().getFullYear();
  if(Number.isFinite(parsed)&&parsed>=2000&&parsed<=9999) return parsed;
  return currentYear;
};

const resolveCertificateNoStart = async ({ year, fallback }) => {
  const yearly=await getNumberSettingByYear(year);
  if(yearly?.certificate_no_start!=null){
    return parseCertificateNoStart(yearly.certificate_no_start, parseCertificateNoStart(fallback,1));
  }
  return parseCertificateNoStart(fallback,1);
};

const getPeriodOptions = async ()=>{
  const [rows]=await db.query(`SELECT id,year,label,is_active FROM periods ORDER BY year DESC,id DESC`);
  return rows||[];
};

const getKelulusanPeserta = async ({ userId }) => {
  const [gradeRows] = await db.query(
    `SELECT t.phase,t.task_type,t.assessment_component,g.final_score
     FROM submissions s
     JOIN tasks t ON t.id=s.task_id
     LEFT JOIN grades g ON g.submission_id=s.id
     WHERE s.user_id=?`,
    [userId]
  );

  const [mcqRaw] = await db.query(
    `SELECT t.task_type,COUNT(ma.id) AS total_q,SUM(ma.is_correct) AS correct_q
     FROM tasks t
     LEFT JOIN mcq_answers ma ON ma.task_id=t.id AND ma.user_id=?
     WHERE t.task_type IN ('PRETEST','POSTTEST')
     GROUP BY t.id,t.task_type`,
    [userId]
  );

  const mcqRows=(mcqRaw||[]).map(r=>({
    task_type:r.task_type,
    score:r.total_q?Math.round((Number(r.correct_q||0)/Number(r.total_q))*100):0
  }));

  return computeKelulusan({ mcqRows, gradeRows });
};

const resolveTargets = async ({ certificateType, period_id, class_id, user_ids=[] }) => {
  const role=certificateType==='PESERTA'?'DOSEN':'NARASUMBER';
  const selectedIds=Array.isArray(user_ids)?user_ids.filter(Boolean):[];
  const selectedPlaceholders=selectedIds.map(()=>'?').join(',');

  if(certificateType==='NARASUMBER'){
    let q=`SELECT u.id,u.name,u.email,u.role,ns.period_id,p.year AS period_year,p.label AS period_label,
                  pr.full_name_with_title,pr.full_name_without_title,pr.avatar_url,pr.nidn,pr.birthplace,pr.city,pr.institution,pr.unit_kerja,
                  NULL AS class_id,NULL AS class_name
           FROM narasumber_submissions ns
           JOIN users u ON u.id=ns.user_id
           JOIN periods p ON p.id=ns.period_id
           LEFT JOIN profiles pr ON pr.user_id=u.id
           WHERE u.role='NARASUMBER' AND ns.status='verified'`;
    const params=[];
    if(selectedIds.length){q+=` AND u.id IN (${selectedPlaceholders})`;params.push(...selectedIds);}
    if(period_id){q+=' AND ns.period_id=?';params.push(period_id);}
    q+=' ORDER BY p.year DESC,u.name';
    const [rows]=await db.query(q,params);
    return rows;
  }

  if(selectedIds.length){
    const [rows]=await db.query(
      `SELECT u.id,u.name,u.email,u.role,u.period_id,p.year AS period_year,p.label AS period_label,
              pr.full_name_with_title,pr.full_name_without_title,pr.avatar_url,pr.nidn,pr.birthplace,pr.city,pr.institution,pr.unit_kerja,
              cm.class_id,c.name AS class_name
       FROM users u
       LEFT JOIN periods p ON p.id=u.period_id
       LEFT JOIN profiles pr ON pr.user_id=u.id
       LEFT JOIN class_members cm ON cm.user_id=u.id
       LEFT JOIN classes c ON c.id=cm.class_id
       WHERE u.id IN (${selectedPlaceholders}) AND u.role=?`,
      [...selectedIds, role]
    );
    return rows;
  }

  let q=`SELECT u.id,u.name,u.email,u.role,u.period_id,p.year AS period_year,p.label AS period_label,
                pr.full_name_with_title,pr.full_name_without_title,pr.nidn,pr.birthplace,pr.city,pr.institution,pr.unit_kerja,
                cm.class_id,c.name AS class_name
         FROM users u
         LEFT JOIN periods p ON p.id=u.period_id
         LEFT JOIN profiles pr ON pr.user_id=u.id
         LEFT JOIN class_members cm ON cm.user_id=u.id
         LEFT JOIN classes c ON c.id=cm.class_id
         WHERE u.role=?`;
  const params=[role];
  if(period_id){q+=' AND u.period_id=?';params.push(period_id);}
  if(class_id){q+=' AND cm.class_id=?';params.push(class_id);}
  q+=' ORDER BY u.name';
  const [rows]=await db.query(q,params);
  return rows;
};

const buildCertificatePayload = ({ user, certificateType, certificateNo, issuedAt=new Date(), periodYear }) => ({
  full_name: user.full_name_without_title || user.full_name_with_title || user.name,
  full_name_with_title: user.full_name_with_title || user.name,
  avatar_url: user.avatar_url || '',
  nidn: user.nidn || '-',
  birthplace: user.birthplace || '-',
  city: user.city || '-',
  institution: user.institution || '-',
  unit_kerja: user.unit_kerja || '-',
  certificate_type: certificateType,
  certificate_no: certificateNo || '',
  issued_date: issuedAt.toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'}),
  sample_date_text: user.sample_date_text || 'Palembang, 19 Mei 2026',
  signer1_name: user.signer1_name || '-',
  signer1_title: user.signer1_title || '-',
  signer1_nip: user.signer1_nip || '-',
  signer2_name: user.signer2_name || '-',
  signer2_title: user.signer2_title || '-',
  signer2_nip: user.signer2_nip || '-',
  predikat: user.predikat || '-',
  status_kelulusan: user.status_kelulusan || (certificateType==='PESERTA'?'Tidak Lulus':'Lulus'),
  period_year: periodYear || user.period_year || issuedAt.getFullYear(),
  period_label: user.period_label || '-'
});

const parseCertificateNoStart=(value,fallback=1)=>{
  const parsed=Number.parseInt(value,10);
  return Number.isFinite(parsed)&&parsed>0?parsed:fallback;
};

const getActivePeriod = async ()=>{
  const [[period]] = await db.query('SELECT id,year,label FROM periods WHERE is_active=1 ORDER BY year DESC,id DESC LIMIT 1');
  return period || null;
};

const getCertificatePeriodYear=({ user, activePeriod, issuedAt=new Date() })=>Number(activePeriod?.year||user?.period_year||issuedAt.getFullYear());

const buildDownloadFileName=(baseName,fallback='certificate')=>`${String(baseName||fallback).replace(/[^a-zA-Z0-9-_]/g,'_')}.pdf`;

const resolveCertificateDownloadName=certificate=>{
  const payload=safeJsonParse(certificate?.payload_json,{});
  const baseName=payload.full_name||certificate?.user_name||certificate?.certificate_no||`certificate-${certificate?.id||'file'}`;
  return buildDownloadFileName(baseName,'certificate');
};

const resolveVerificationBaseUrl=req=>{
  const explicit=String(process.env.FRONTEND_PUBLIC_URL||'').trim().replace(/\/$/, '');
  if(explicit) return explicit;
  return `${req.protocol}://${req.get('host')}`.replace(/\/api$/,'');
};

const buildCertificateVerifyUrl=(baseUrl,token)=>`${baseUrl.replace(/\/$/, '')}/certificates/verify/${token}`;

const getCertificatePeriodInfo = ({ user, activePeriod, periodYear }) => ({
  period_year: periodYear || activePeriod?.year || user?.period_year || null,
  period_label: user?.period_label || activePeriod?.label || '-'
});

const buildVerificationSummary = ({ user, certificateType })=>({
  predikat: user?.predikat || '-',
  status_kelulusan: user?.status_kelulusan || (certificateType==='PESERTA'?'Tidak Lulus':'Lulus')
});

const buildVerifyResponse = ({ certificate, payload })=>{
  const periodYear=payload.period_year||certificate.period_year||null;
  const periodLabel=payload.period_label||certificate.period_label||'-';
  const periodText=periodLabel&&periodLabel!=='-'
    ? `${periodLabel}${periodYear?` (${periodYear})`:''}`
    : periodYear?`Periode ${periodYear}`:'-';
  const statusKelulusan=payload.status_kelulusan||'-';
  const predikat=payload.predikat&&payload.predikat!=='-'
    ? payload.predikat
    : statusKelulusan==='Lulus'&&certificate.certificate_type==='PESERTA'
      ? 'Lulus'
      : '-';
  return {
    valid:true,
    certificate_no:certificate.certificate_no,
    certificate_type:certificate.certificate_type,
    issued_at:certificate.issued_at,
    published_at:certificate.published_at,
    recipient_name:payload.full_name||certificate.user_name,
    nidn:payload.nidn||'-',
    predikat,
    status_kelulusan:statusKelulusan,
    period_year:periodYear,
    period_label:periodLabel,
    period_text:periodText
  };
};

const buildCertificateSettingsPayload=(settings,existing,body,reqUserId)=>[
  body.signer1_name ?? existing?.signer1_name ?? null,
  body.signer1_title ?? existing?.signer1_title ?? null,
  body.signer1_nip ?? existing?.signer1_nip ?? null,
  settings.signer1File,
  settings.signer1CapFile,
  body.signer2_name ?? existing?.signer2_name ?? null,
  body.signer2_title ?? existing?.signer2_title ?? null,
  body.signer2_nip ?? existing?.signer2_nip ?? null,
  body.sample_date_text ?? existing?.sample_date_text ?? 'Palembang, 19 Mei 2026',
  settings.signer2File,
  settings.signer2CapFile,
  existing?.verification_base_url ?? '',
  parseCertificateNoStart(body.certificate_no_start, parseCertificateNoStart(existing?.certificate_no_start,1)),
  reqUserId
];

const getNextSerial = async ({ periodYear }) => {
  const resolvedYear=String(Number(periodYear||new Date().getFullYear()));
  const [rows] = await db.query(
    `SELECT id FROM certificates WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.period_year'))=? ORDER BY id ASC`,
    [resolvedYear]
  );
  return (rows?.length||0)+1;
};

const buildNextCertificateNo = async ({ user, settings, issuedAt, activePeriod }) => {
  const periodYear=getCertificatePeriodYear({ user, activePeriod, issuedAt });
  const serial=await getNextSerial({ periodYear });
  const startNo=await resolveCertificateNoStart({ year:periodYear, fallback:settings?.certificate_no_start });
  return makeCertificateNo({ periodYear, serial, startNo, issuedAt });
};
const updateExistingCertificateRecord = async ({ existing, payload, rendered, forcePublish, adminId, issuedAt }) => {
  await db.query(
    `UPDATE certificates SET payload_json=?,pdf_file=?,status=?,published_at=?,published_by=?,issued_at=? WHERE id=?`,
    [JSON.stringify(payload),rendered.filePath,forcePublish?'published':'draft',forcePublish?issuedAt:null,forcePublish?adminId:null,issuedAt,existing.id]
  );
  const [[updated]] = await db.query(`SELECT * FROM certificates WHERE id=?`,[existing.id]);
  return updated;
};

const insertCertificateRecord = async ({ payload, certificateType, user, template, forcePublish, issuedAt, adminId, rendered, token }) => {
  const [ins]=await db.query(
    `INSERT INTO certificates
      (certificate_no,certificate_type,user_id,period_id,class_id,template_id,status,issued_at,published_at,published_by,payload_json,pdf_file,verification_token)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      payload.certificate_no,
      certificateType,
      user.id,
      user.period_id||null,
      user.class_id||null,
      template.id,
      forcePublish?'published':'draft',
      issuedAt,
      forcePublish?issuedAt:null,
      forcePublish?adminId:null,
      JSON.stringify(payload),
      rendered.filePath,
      token
    ]
  );
  const [[created]] = await db.query(`SELECT * FROM certificates WHERE id=?`,[ins.insertId]);
  return created;
};

const createOrPublishCertificate = async ({ user, template, settings, certificateType, adminId, verificationBaseUrl, forcePublish=true }) => {
  const [[existing]] = await db.query(
    `SELECT * FROM certificates WHERE user_id=? AND certificate_type=? AND period_id <=> ? ORDER BY id DESC LIMIT 1`,
    [user.id, certificateType, user.period_id || null]
  );

  const issuedAt=new Date();
  const periodYear=getCertificatePeriodYear({ user, activePeriod:null, issuedAt });
  const periodInfo=getCertificatePeriodInfo({ user, activePeriod:null, periodYear });
  const verificationSummary=buildVerificationSummary({ user, certificateType });
  const fullName = user.full_name_without_title || user.full_name_with_title || user.name;
  const enrichedUser={
    ...user,
    full_name_without_title:fullName||user.name,
    sample_date_text:settings?.sample_date_text,
    signer1_name:settings?.signer1_name,
    signer1_title:settings?.signer1_title,
    signer1_nip:settings?.signer1_nip,
    signer2_name:settings?.signer2_name,
    signer2_title:settings?.signer2_title,
    signer2_nip:settings?.signer2_nip,
    predikat:verificationSummary.predikat,
    status_kelulusan:verificationSummary.status_kelulusan,
    period_year:periodInfo.period_year,
    period_label:periodInfo.period_label
  };

  if(existing){
    if(existing.status==='published') return { certificate:existing, created:false, published:false, skipped:true };
    const payload=buildCertificatePayload({
      user:enrichedUser,
      certificateType,
      certificateNo:existing.certificate_no,
      issuedAt,
      periodYear
    });
    const verificationUrl = buildCertificateVerifyUrl(verificationBaseUrl, existing.verification_token);
    const rendered = await renderCertificatePdf({
      template: { ...template, layout_json: safeJsonParse(template.layout_json,{page1:{elements:[]},page2:{elements:[]}}) },
      settings,
      payload,
      verificationUrl,
      outputFileName: `${Date.now()}-cert-${existing.id}.pdf`
    });

    const updated=await updateExistingCertificateRecord({ existing, payload, rendered, forcePublish, adminId, issuedAt });
    return { certificate:updated, created:false, published:forcePublish, skipped:false };
  }

  const certNo=await buildNextCertificateNo({ user, settings, issuedAt, activePeriod:null });
  const token=makeVerificationToken();
  const payload=buildCertificatePayload({
    user:enrichedUser,
    certificateType,
    certificateNo:certNo,
    issuedAt,
    periodYear
  });
  const verificationUrl = buildCertificateVerifyUrl(verificationBaseUrl, token);
  const rendered = await renderCertificatePdf({
    template: { ...template, layout_json: safeJsonParse(template.layout_json,{page1:{elements:[]},page2:{elements:[]}}) },
    settings,
    payload,
    verificationUrl,
    outputFileName: `${Date.now()}-cert-${user.id}.pdf`
  });

  const created=await insertCertificateRecord({ payload, certificateType, user, template, forcePublish, issuedAt, adminId, rendered, token });
  return { certificate:created, created:true, published:forcePublish, skipped:false };
};

exports.createTemplate = async (req,res,next)=>{
  try{
    ensureAdmin(req);
    const { type, name, layout_json } = req.body;
    if(!['PESERTA','NARASUMBER'].includes(type)) return res.status(400).json({message:'Type template tidak valid'});
    if(!name||!String(name).trim()) return res.status(400).json({message:'Nama template wajib diisi'});
    if(!req.files?.page1_bg?.[0]||!req.files?.page2_bg?.[0]) return res.status(400).json({message:'Background halaman 1 dan 2 wajib diunggah'});

    const layout=parseLayout(layout_json);

    await db.query(`UPDATE certificate_templates SET is_active=0 WHERE type=?`,[type]);

    const page1=`/uploads/${req.files.page1_bg[0].filename}`;
    const page2=`/uploads/${req.files.page2_bg[0].filename}`;

    const [r]=await db.query(
      `INSERT INTO certificate_templates (type,name,page1_background_file,page2_background_file,layout_json,is_active,created_by)
       VALUES (?,?,?,?,?,1,?)`,
      [type,String(name).trim(),page1,page2,JSON.stringify(layout),req.user.id]
    );

    res.status(201).json({message:'Template sertifikat berhasil dibuat',id:r.insertId});
  }catch(err){next(err);}
};

exports.updateTemplate = async (req,res,next)=>{
  try{
    ensureAdmin(req);
    const id=parseInt(req.params.id,10);
    if(!id) return res.status(400).json({message:'ID template tidak valid'});

    const [[existing]]=await db.query(`SELECT * FROM certificate_templates WHERE id=?`,[id]);
    if(!existing) return res.status(404).json({message:'Template tidak ditemukan'});

    const nextName=req.body.name?String(req.body.name).trim():existing.name;
    const nextLayout=req.body.layout_json?parseLayout(req.body.layout_json):safeJsonParse(existing.layout_json,{page1:{elements:[]},page2:{elements:[]}});

    const nextPage1=req.files?.page1_bg?.[0]?`/uploads/${req.files.page1_bg[0].filename}`:existing.page1_background_file;
    const nextPage2=req.files?.page2_bg?.[0]?`/uploads/${req.files.page2_bg[0].filename}`:existing.page2_background_file;

    const makeActive=String(req.body.is_active||'1')!=='0';
    if(makeActive) await db.query(`UPDATE certificate_templates SET is_active=0 WHERE type=?`,[existing.type]);

    await db.query(
      `UPDATE certificate_templates
       SET name=?,page1_background_file=?,page2_background_file=?,layout_json=?,is_active=?
       WHERE id=?`,
      [nextName,nextPage1,nextPage2,JSON.stringify(nextLayout),makeActive?1:0,id]
    );

    res.json({message:'Template sertifikat berhasil diperbarui'});
  }catch(err){next(err);}
};

exports.setSignatures = async (req,res,next)=>{
  try{
    ensureAdmin(req);
    const { signer1_name, signer1_title, signer1_nip, signer2_name, signer2_title, signer2_nip, sample_date_text, certificate_no_start } = req.body;

    const [[existing]] = await db.query(`SELECT * FROM certificate_settings WHERE id=1 LIMIT 1`);
    const signer1File=req.files?.signer1_file?.[0]?`/uploads/${req.files.signer1_file[0].filename}`:existing?.signer1_signature_file||null;
    const signer1CapFile=req.files?.signer1_cap_file?.[0]?`/uploads/${req.files.signer1_cap_file[0].filename}`:existing?.signer1_cap_file||null;
    const signer2File=req.files?.signer2_file?.[0]?`/uploads/${req.files.signer2_file[0].filename}`:existing?.signer2_signature_file||null;
    const signer2CapFile=req.files?.signer2_cap_file?.[0]?`/uploads/${req.files.signer2_cap_file[0].filename}`:existing?.signer2_cap_file||null;

    if(!signer1CapFile) return res.status(400).json({message:'Cap TTD 1 wajib diunggah'});

    await db.query(
      `UPDATE certificate_settings
       SET signer1_name=?,signer1_title=?,signer1_nip=?,signer1_signature_file=?,signer1_cap_file=?,
           signer2_name=?,signer2_title=?,signer2_nip=?,sample_date_text=?,signer2_signature_file=?,signer2_cap_file=?,
           verification_base_url=?,certificate_no_start=?,updated_by=?
       WHERE id=1`,
      buildCertificateSettingsPayload({ signer1File, signer1CapFile, signer2File, signer2CapFile }, existing, req.body, req.user.id)
    );

    res.json({message:'Pengaturan tanda tangan berhasil disimpan'});
  }catch(err){next(err);}
};

const distributeByType = async ({ req, res, type }) => {
  ensureAdmin(req);
  const { period_id, class_id, user_ids } = req.body || {};
  const targetsRaw=await resolveTargets({ certificateType:type, period_id, class_id, user_ids:Array.isArray(user_ids)?user_ids:[] });

  const dedupMap=new Map();
  targetsRaw.forEach(t=>{ if(!dedupMap.has(t.id)) dedupMap.set(t.id,t); });
  let targets=[...dedupMap.values()];

  if(type==='PESERTA'){
    const eligible=[];
    for(const t of targets){
      const k=await getKelulusanPeserta({ userId:t.id });
      if(k.status_kelulusan==='Lulus'){
        eligible.push({
          ...t,
          nk_final:k.nk_final,
          predikat:k.predikat,
          status_kelulusan:k.status_kelulusan
        });
      }
    }
    targets=eligible;
  }

  const template=await getActiveTemplate(type);
  if(!template) return res.status(400).json({message:`Template aktif ${type} belum tersedia`});
  const settings=await getSettings();
  const verificationBaseUrl=resolveVerificationBaseUrl(req);

  let created=0,published=0,skipped=0;
  const results=[];

  for(const t of targets){
    const out=await createOrPublishCertificate({
      user:t,
      template,
      settings,
      certificateType:type,
      adminId:req.user.id,
      verificationBaseUrl,
      forcePublish:true
    });
    if(out.created) created++;
    if(out.published) published++;
    if(out.skipped) skipped++;
    results.push({ user_id:t.id, name:t.name, created:out.created, skipped:out.skipped });
  }

  const mode=(Array.isArray(user_ids)&&user_ids.length)?'INDIVIDUAL':'BATCH';
  await db.query(
    `INSERT INTO certificate_distribution_logs (certificate_type,mode,requested_by,filter_json,total_target,total_created,total_published)
     VALUES (?,?,?,?,?,?,?)`,
    [type,mode,req.user.id,JSON.stringify({period_id:period_id||null,class_id:class_id||null,user_ids:user_ids||[]}),targets.length,created,published]
  );

  res.json({
    message:`Distribusi sertifikat ${type.toLowerCase()} selesai`,
    summary:{ total_target:targets.length, created, published, skipped },
    results
  });
};

exports.distributeParticipant = async (req,res,next)=>{
  try{ await distributeByType({ req,res,type:'PESERTA' }); }
  catch(err){ next(err); }
};

exports.distributeNarasumber = async (req,res,next)=>{
  try{ await distributeByType({ req,res,type:'NARASUMBER' }); }
  catch(err){ next(err); }
};

exports.adminList = async (req,res,next)=>{
  try{
    ensureAdmin(req);
    const { type, status, period_id } = req.query;
    let q=`SELECT c.*,u.name AS user_name,u.email,p.label AS period_label,ct.name AS template_name
           FROM certificates c
           JOIN users u ON u.id=c.user_id
           LEFT JOIN periods p ON p.id=c.period_id
           LEFT JOIN certificate_templates ct ON ct.id=c.template_id
           WHERE 1=1`;
    const params=[];
    if(type){q+=' AND c.certificate_type=?';params.push(type);}
    if(status){q+=' AND c.status=?';params.push(status);}
    if(period_id){q+=' AND c.period_id=?';params.push(period_id);}
    q+=' ORDER BY c.created_at DESC';
    const [rows]=await db.query(q,params);
    res.json(rows.map(r=>({
      ...r,
      payload_json:safeJsonParse(r.payload_json,null)
    })));
  }catch(err){next(err);}
};

exports.myCertificates = async (req,res,next)=>{
  try{
    const [rows]=await db.query(
      `SELECT id,certificate_no,certificate_type,status,issued_at,published_at,pdf_file,verification_token,payload_json
       FROM certificates
       WHERE user_id=? AND status='published'
       ORDER BY published_at DESC, id DESC`,
      [req.user.id]
    );
    res.json(rows.map(r=>({ ...r, payload_json:safeJsonParse(r.payload_json,null) })));
  }catch(err){next(err);}
};

exports.downloadCertificate = async (req,res,next)=>{
  try{
    const id=parseInt(req.params.id,10);
    if(!id) return res.status(400).json({message:'ID sertifikat tidak valid'});

    const [[c]]=await db.query(`SELECT * FROM certificates WHERE id=?`,[id]);
    if(!c) return res.status(404).json({message:'Sertifikat tidak ditemukan'});

    if(req.user.role!=='ADMIN'&&req.user.id!==c.user_id) return res.status(403).json({message:'Akses ditolak'});
    if(!c.pdf_file) return res.status(404).json({message:'File sertifikat belum tersedia'});

    const fileName=path.basename(c.pdf_file);
    const absolutePath=path.resolve(process.env.UPLOAD_DIR||'uploads',fileName);
    res.download(absolutePath,resolveCertificateDownloadName(c));
  }catch(err){next(err);}
};

exports.verifyCertificate = async (req,res,next)=>{
  try{
    const token=String(req.params.token||'').trim();
    if(!token) return res.status(400).json({message:'Token verifikasi wajib diisi'});

    const [[c]]=await db.query(
      `SELECT c.id,c.certificate_no,c.certificate_type,c.status,c.issued_at,c.published_at,c.payload_json,
              u.name AS user_name,p.year AS period_year_db,p.label AS period_label_db
       FROM certificates c
       JOIN users u ON u.id=c.user_id
       LEFT JOIN periods p ON p.id=c.period_id
       WHERE c.verification_token=?`,
      [token]
    );

    if(!c||c.status!=='published'){
      return res.status(404).json({ valid:false, message:'Sertifikat tidak valid atau belum dipublikasikan' });
    }

    const payload=safeJsonParse(c.payload_json,{});
    res.json(buildVerifyResponse({
      certificate:{
        ...c,
        period_year:c.period_year_db,
        period_label:c.period_label_db
      },
      payload
    }));
  }catch(err){next(err);}
};

exports.withdrawCertificate = async (req,res,next)=>{
  try{
    ensureAdmin(req);
    const id=parseInt(req.params.id,10);
    if(!id) return res.status(400).json({message:'ID sertifikat tidak valid'});

    const [[existing]]=await db.query(`SELECT * FROM certificates WHERE id=?`,[id]);
    if(!existing) return res.status(404).json({message:'Sertifikat tidak ditemukan'});

    await db.query(
      `UPDATE certificates SET status='draft',published_at=NULL,published_by=NULL WHERE id=?`,
      [id]
    );
    res.json({message:'Sertifikat berhasil ditarik'});
  }catch(err){next(err);}
};

exports.removeCertificate = async (req,res,next)=>{
  try{
    ensureAdmin(req);
    const id=parseInt(req.params.id,10);
    if(!id) return res.status(400).json({message:'ID sertifikat tidak valid'});

    const [[existing]]=await db.query(`SELECT * FROM certificates WHERE id=?`,[id]);
    if(!existing) return res.status(404).json({message:'Sertifikat tidak ditemukan'});

    await db.query(`DELETE FROM certificates WHERE id=?`,[id]);
    res.json({message:'Sertifikat berhasil dihapus'});
  }catch(err){next(err);}
};

exports.templates = async (req,res,next)=>{
  try{
    ensureAdmin(req);
    const [rows]=await db.query(`SELECT * FROM certificate_templates ORDER BY type,id DESC`);
    res.json(rows.map(r=>({ ...r, layout_json:safeJsonParse(r.layout_json,{page1:{elements:[]},page2:{elements:[]}}) })));
  }catch(err){next(err);}
};

exports.getSettings = async (req,res,next)=>{
  try{
    ensureAdmin(req);
    const s=await getSettings();
    res.json(s||{});
  }catch(err){next(err);}
};

exports.getNumberSetting = async (req,res,next)=>{
  try{
    ensureAdmin(req);
    const year=resolveNumberSettingYear(req.query.year);
    const [settings,periods]=await Promise.all([
      getSettings(),
      getPeriodOptions()
    ]);
    const existing=await getNumberSettingByYear(year);
    res.json({
      year,
      certificate_no_start:existing?.certificate_no_start ?? parseCertificateNoStart(settings?.certificate_no_start,1),
      periods
    });
  }catch(err){next(err);}
};

exports.setNumberSetting = async (req,res,next)=>{
  try{
    ensureAdmin(req);
    await ensureCertificateNumberSettingsTable();
    const year=resolveNumberSettingYear(req.body?.year);
    const settings=await getSettings();
    const certificateNoStart=parseCertificateNoStart(req.body?.certificate_no_start, parseCertificateNoStart(settings?.certificate_no_start,1));
    await db.query(
      `INSERT INTO certificate_number_settings (year,certificate_no_start,updated_by)
       VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE certificate_no_start=VALUES(certificate_no_start),updated_by=VALUES(updated_by),updated_at=CURRENT_TIMESTAMP`,
      [year,certificateNoStart,req.user.id]
    );
    res.json({message:'Nomor awal sertifikat tahunan berhasil disimpan',year,certificate_no_start:certificateNoStart});
  }catch(err){next(err);}
};