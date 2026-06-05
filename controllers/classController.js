const db=require('../config/db');
const puppeteer=require('puppeteer');

const esc=(value='')=>String(value??'')
  .replace(/&/g,'&amp;')
  .replace(/</g,'&lt;')
  .replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;')
  .replace(/'/g,'&#39;');

const phaseRank={ISC1:1,OJC:2,ISC2:3};
const buildMaterialKey=t=>`${t.phase||''}||${t.assessment_component||''}||${String(t.title||'').trim().toLowerCase()}`;
const ojcMaterialRank=m=>{
  const component=String(m.assessment_component||'').toUpperCase();
  const title=String(m.title||'').toLowerCase();
  if(component==='OJC_RPS_INSTRUMEN'||title.includes('rps')||title.includes('instrumen')) return 1;
  if(component==='OJC_VIDEO_PEMBELAJARAN_PRAKTIK'||title.includes('video')) return 2;
  if(component==='OJC_ARTIKEL_ILMIAH'||title.includes('artikel')) return 3;
  if(component==='OJC_KONTEN_MODERASI'||title.includes('moderasi')) return 4;
  return 99;
};
const materialRank=m=>m.phase==='OJC'?ojcMaterialRank(m):(m.order_no||9999);
const validMatrixPhase=phase=>['ISC1','OJC','ISC2'].includes(String(phase||''));

const getActivePeriodId=async()=>{
  const[[active]]=await db.query('SELECT id FROM periods WHERE is_active=1 ORDER BY year DESC,id DESC LIMIT 1');
  return active?.id||null;
};

const getMatrixVisibility=async(periodId,phase)=>{
  const[[row]]=await db.query('SELECT is_visible FROM schedule_visibility WHERE period_id=? AND phase=? LIMIT 1',[periodId,phase]);
  return Boolean(row?.is_visible);
};

const buildNarasumberMatrix=async({periodId,phase,allowedClassIds=null})=>{
  if(!periodId) return {period_id:null,classes:[],materials:[],cells:{},is_visible:false};

  const classParams=[periodId];
  let classWhere='c.period_id=?';
  if(phase){classWhere+=' AND c.phase=?';classParams.push(phase);}
  if(Array.isArray(allowedClassIds)){
    if(!allowedClassIds.length) return {period_id:periodId,classes:[],materials:[],cells:{},is_visible:await getMatrixVisibility(periodId,phase)};
    const allowedPh=allowedClassIds.map(()=>'?').join(',');
    classWhere+=` AND c.id IN (${allowedPh})`;
    classParams.push(...allowedClassIds);
  }

  const[classes]=await db.query(
    `SELECT c.id,c.name,c.phase,c.period_id,p.label AS period_label,co.cohort_no,co.ojc_mode
     FROM classes c
     LEFT JOIN periods p ON p.id=c.period_id
     LEFT JOIN cohorts co ON co.id=c.cohort_id
     WHERE ${classWhere}
     ORDER BY COALESCE(co.cohort_no,9999),c.phase,c.name`,
    classParams
  );
  if(!classes.length) return {period_id:periodId,classes:[],materials:[],cells:{},is_visible:await getMatrixVisibility(periodId,phase)};

  const classIds=classes.map(c=>c.id);
  const ph=classIds.map(()=>'?').join(',');
  const taskParams=[periodId,...classIds];
  let taskWhere=`t.period_id=? AND t.class_id IN (${ph}) AND t.phase IN ('OJC','ISC2')`;
  if(phase){taskWhere+=' AND t.phase=?';taskParams.push(phase);}

  const[tasks]=await db.query(
    `SELECT t.id,t.title,t.phase,t.assessment_component,t.order_no,t.class_id,t.material_id
     FROM tasks t
     WHERE ${taskWhere}
     ORDER BY t.phase,t.order_no,t.title,t.id`,
    taskParams
  );

  const materials=[];
  const materialMap=new Map();
  for(const t of tasks){
    const key=buildMaterialKey(t);
    const existing=materialMap.get(key);
    if(existing){
      existing.task_ids.push(t.id);
      existing.order_no=Math.min(existing.order_no||9999,t.order_no||9999);
    }else{
      const item={key,title:t.title,phase:t.phase,assessment_component:t.assessment_component,order_no:t.order_no||9999,task_ids:[t.id],slot:null};
      materialMap.set(key,item);
      materials.push(item);
    }
  }
  materials.sort((a,b)=>(phaseRank[a.phase]||9)-(phaseRank[b.phase]||9)||materialRank(a)-materialRank(b)||(a.order_no||0)-(b.order_no||0)||String(a.title).localeCompare(String(b.title)));

  const taskIds=tasks.map(t=>t.id);
  const cells={};
  if(taskIds.length){
    const tph=taskIds.map(()=>'?').join(',');
    const[slots]=await db.query(
      `SELECT ss.task_id,ss.material_id,ss.slot_date,ss.start_time,ss.end_time,ss.module_title,ss.jp
       FROM schedule_slots ss
       WHERE ss.task_id IN (${tph}) OR ss.material_id IN (
         SELECT DISTINCT COALESCE(t.material_id,0) FROM tasks t WHERE t.id IN (${tph}) AND t.material_id IS NOT NULL
       )
       ORDER BY ss.slot_date,ss.start_time,ss.id`,
      [...taskIds,...taskIds]
    );
    for(const s of slots){
      const task=tasks.find(t=>t.id===s.task_id || (s.material_id!=null && t.material_id!=null && t.material_id===s.material_id));
      if(!task) continue;
      const material=materialMap.get(buildMaterialKey(task));
      if(material&&!material.slot) material.slot=s;
    }

    const[assigned]=await db.query(
      `SELECT t.id,t.title,t.phase,t.assessment_component,t.class_id,
              GROUP_CONCAT(DISTINCT u.name ORDER BY u.name SEPARATOR ', ') AS narasumber_names
       FROM tasks t
       JOIN class_narasumber cn ON cn.class_id=t.class_id AND (cn.material_id=t.id OR (t.material_id IS NOT NULL AND cn.material_id=t.material_id))
       JOIN users u ON u.id=cn.narasumber_id
       WHERE t.id IN (${tph})
       GROUP BY t.id,t.title,t.phase,t.assessment_component,t.class_id`,
      taskIds
    );
    for(const row of assigned){
      const key=buildMaterialKey(row);
      const cellKey=`${key}::${row.class_id}`;
      if(cells[cellKey]) cells[cellKey]+=', '+row.narasumber_names;
      else cells[cellKey]=row.narasumber_names;
    }
  }

  return {period_id:periodId,classes,materials,cells,is_visible:await getMatrixVisibility(periodId,phase)};
};

exports.getNarasumberMatrix=async(req,res,next)=>{
  try{
    const{period_id,phase}=req.query;
    const matrixPhase=validMatrixPhase(phase)?phase:'OJC';
    const pid=period_id?Number(period_id):await getActivePeriodId();
    res.json(await buildNarasumberMatrix({periodId:pid,phase:matrixPhase}));
  }catch(e){next(e);}
};

exports.setMatrixVisibility=async(req,res,next)=>{
  try{
    const periodId=Number(req.body.period_id);
    const phase=req.body.phase;
    const isVisible=Boolean(req.body.is_visible);
    if(!periodId||!validMatrixPhase(phase)) return res.status(400).json({message:'period_id dan phase wajib'});
    await db.query(
      `INSERT INTO schedule_visibility (period_id,phase,is_visible,updated_by)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE is_visible=VALUES(is_visible),updated_by=VALUES(updated_by),updated_at=CURRENT_TIMESTAMP`,
      [periodId,phase,isVisible?1:0,req.user.id]
    );
    res.json({period_id:periodId,phase,is_visible:isVisible});
  }catch(e){next(e);}
};

exports.getMyScheduleMatrix=async(req,res,next)=>{
  try{
    if(!['DOSEN','NARASUMBER'].includes(req.user.role)) return res.status(403).json({message:'Tidak diizinkan'});
    const periodId=Number(req.user.period_id)||await getActivePeriodId();
    if(!periodId) return res.json({period_id:null,matrices:{OJC:null,ISC2:null}});

    const matrices={};
    for(const phase of ['OJC','ISC2']){
      const visible=await getMatrixVisibility(periodId,phase);
      if(!visible){
        matrices[phase]={period_id:periodId,phase,is_visible:false,classes:[],materials:[],cells:{}};
        continue;
      }

      let rows=[];
      if(req.user.role==='DOSEN'){
        [rows]=await db.query(
          `SELECT DISTINCT c.id FROM class_members cm JOIN classes c ON c.id=cm.class_id WHERE cm.user_id=? AND c.period_id=? AND c.phase=?`,
          [req.user.id,periodId,phase]
        );
      }else{
        [rows]=await db.query(
          `SELECT DISTINCT c.id FROM class_narasumber cn JOIN classes c ON c.id=cn.class_id WHERE cn.narasumber_id=? AND c.period_id=? AND c.phase=?`,
          [req.user.id,periodId,phase]
        );
      }
      matrices[phase]={...(await buildNarasumberMatrix({periodId,phase,allowedClassIds:rows.map(r=>r.id)})),phase,is_visible:true};
    }

    res.json({period_id:periodId,matrices});
  }catch(e){next(e);}
};

exports.getAll=async(req,res,next)=>{
  try{
    const{period_id,phase}=req.query;
    let q=`SELECT c.*,p.label AS period_label,co.cohort_no,co.ojc_mode,COUNT(DISTINCT cm.user_id) AS member_count,
                  GROUP_CONCAT(DISTINCT un.name SEPARATOR ', ') AS narasumber_names
           FROM classes c LEFT JOIN periods p ON p.id=c.period_id
           LEFT JOIN cohorts co ON co.id=c.cohort_id
           LEFT JOIN class_members cm ON cm.class_id=c.id
           LEFT JOIN class_narasumber cn ON cn.class_id=c.id
           LEFT JOIN users un ON un.id=cn.narasumber_id WHERE 1=1`;
    const params=[];
    if(period_id){q+=' AND c.period_id=?';params.push(period_id);}
    if(phase){q+=' AND c.phase=?';params.push(phase);}
    q+=' GROUP BY c.id ORDER BY c.phase,c.name';
    const[rows]=await db.query(q,params);res.json(rows);
  }catch(e){next(e);}
};

const getParticipantClassRows=async({periodId})=>{
  const[rows]=await db.query(
    `SELECT c.id AS class_id,c.name AS class_name,c.phase AS class_phase,c.period_id,
            p.label AS period_label,p.year AS period_year,co.id AS cohort_id,co.cohort_no,co.ojc_mode,
            u.id AS user_id,u.name,COALESCE(NULLIF(pr.nidn,''),NULLIF(pr.nuptk,''),'—') AS identity_no
     FROM class_members cm
     JOIN classes c ON c.id=cm.class_id
     JOIN users u ON u.id=cm.user_id
     LEFT JOIN profiles pr ON pr.user_id=u.id
     LEFT JOIN periods p ON p.id=c.period_id
     LEFT JOIN cohorts co ON co.id=c.cohort_id
     WHERE u.role='DOSEN' AND c.period_id=?
     ORDER BY FIELD(c.phase,'ISC1','OJC','ISC2'),COALESCE(co.cohort_no,9999),c.name,u.name`,
    [periodId]
  );
  return rows;
};

const buildParticipantsPdfHtml=({rows,periodLabel,generatedAt})=>{
  // Group by cohort_no → class (no phase grouping — each class is its own section)
  const cohortData={};

  rows.forEach(row=>{
    const cohortNo=row.cohort_no||0;
    const className=row.class_name||'ISC1';
    const phase=row.class_phase||'ISC1';

    if(!cohortData[cohortNo]) cohortData[cohortNo]={cohort_no:cohortNo,phases:{}};
    if(!cohortData[cohortNo].phases[phase]) cohortData[cohortNo].phases[phase]={};
    if(!cohortData[cohortNo].phases[phase][className]) cohortData[cohortNo].phases[phase][className]=[];
    cohortData[cohortNo].phases[phase][className].push(row);
  });

  const totalParticipants=new Set(rows.map(r=>r.user_id)).size;
  const totalCohorts=new Set(rows.map(r=>r.cohort_no).filter(Boolean)).size;
  const sortedCohorts=Object.keys(cohortData).sort((a,b)=>Number(a)-Number(b));

  const sections=sortedCohorts.map((cohortNo,i)=>{
    const cohort=cohortData[cohortNo];
    const cohortLabel=cohortNo?`Angkatan ${cohortNo}`:'Tanpa Angkatan';
    const pageBreak=i>0?' style="page-break-before:always;"':'';

    // Build per-angkatan content: list of classes with phase badges
    const allClasses=[];
    const phaseOrder=['ISC1','OJC','ISC2'];
    const phaseColors={ISC1:'#1e40af',OJC:'#047857',ISC2:'#7c3aed'};
    const phaseLabels={ISC1:'ISC 1',OJC:'OJC',ISC2:'ISC 2'};

    for(const phase of phaseOrder){
      const classNames=Object.keys(cohort.phases[phase]||{});
      for(const className of classNames.sort()){
        const participants=cohort.phases[phase][className];
        allClasses.push({phase,className,participants,color:phaseColors[phase]});
      }
    }

    const classHtml=allClasses.map(({phase,className,participants,color})=>{
      const body=participants.map((r,j)=>`<tr><td class="no">${j+1}</td><td>${esc(r.identity_no||'—')}</td><td>${esc(r.name||'—')}</td></tr>`).join('');
      return `<div class="class-card">
        <div class="class-head">
          <span class="phase-badge" style="background:${color}">${phaseLabels[phase]}</span>
          <span class="class-name">${esc(className)}</span>
          <span class="class-count">${participants.length} peserta</span>
        </div>
        <table>
          <colgroup><col><col><col></colgroup>
          <thead><tr><th class="no">No</th><th>NIDN/NUPTK</th><th>Nama Peserta</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
    }).join('');

    return `<div class="angkatan-wrapper"${pageBreak}>
      <div class="angkatan-title">${esc(cohortLabel)}</div>
      ${classHtml}
    </div>`;
  }).join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Daftar Kelas Peserta PKDP</title>
  <style>
    @page{size:A4;margin:8mm 6mm}
    *{box-sizing:border-box}
    body{font-family:Arial,sans-serif;color:#172033;margin:0;font-size:11pt;background:#fff}

    .sheet{border:1px solid #d7e3f4;border-radius:12px;overflow:hidden;box-shadow:0 12px 32px rgba(30,64,175,.08)}
    .header{padding:8px 12px;background:linear-gradient(135deg,#123f5c 0%,#0f5f8f 52%,#1db6e7 100%);color:#fff;position:relative}
    .header:after{content:"";position:absolute;right:-42px;top:-50px;width:180px;height:180px;border-radius:50%;background:rgba(255,255,255,.18)}
    .eyebrow{font-size:7pt;font-weight:800;text-transform:uppercase;letter-spacing:.16em;opacity:.9;margin-bottom:2px}
    h1{font-size:13pt;margin:0 0 2px;text-transform:uppercase;letter-spacing:.03em;line-height:1.1}
    .subtitle{font-size:7pt;opacity:.92;max-width:680px;line-height:1.2;margin:0}
    .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;padding:4px 8px;background:#f7fbff;border-bottom:1px solid #d7e3f4}
    .meta-card{padding:2px 5px;border:1px solid #dbeafe;border-radius:6px;background:#fff}
    .meta-label{font-size:5.5pt;color:#64748b;text-transform:uppercase;letter-spacing:.08em;font-weight:800;margin-bottom:1px}
    .meta-value{font-size:8pt;color:#0f172a;font-weight:700;line-height:1.1}

    .content{padding:2px 8px}

    /* ANGKATAN */
    .angkatan-wrapper{margin-bottom:0}
    .angkatan-title{font-size:11pt;font-weight:800;color:#0f172a;margin:1px 0 2px;padding:2px 0 2px 0;border-bottom:2px solid #0f5f8f}

    /* CLASS CARD */
    .class-card{border:1px solid #e2e8f0;border-radius:4px;margin-bottom:2px;page-break-inside:avoid;background:#fff}
    .class-head{display:flex;align-items:center;gap:4px;padding:1px 5px;background:#f8fafc;border-bottom:1px solid #e2e8f0;border-radius:3px 3px 0 0}
    .phase-badge{display:inline-block;font-size:6pt;font-weight:800;color:#fff;padding:0 5px;border-radius:2px;letter-spacing:.06em;text-transform:uppercase}
    .class-name{font-size:9pt;font-weight:700;color:#0f172a}
    .class-count{font-size:6pt;color:#64748b;margin-left:auto;background:#eef2ff;padding:0 5px;border-radius:6px;font-weight:600}

    /* TABLE */
    table{width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0}
    th,td{padding:1px 3px;vertical-align:top;line-height:1.1;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;font-size:11pt}
    td:last-child{border-right:0}
    th:last-child{border-right:0}
    tbody tr:last-child td{border-bottom:0}
    colgroup col:nth-child(1){width:16px}
    colgroup col:nth-child(2){width:26%}
    colgroup col:nth-child(3){width:auto}
    th{background:#0f5f8f;color:#fff;text-align:left;font-weight:700;font-size:7pt;text-transform:uppercase;letter-spacing:.04em}
    tbody tr:nth-child(even){background:#f8fafc}
    .no{width:16px;text-align:center;font-weight:700;color:#0f5f8f;font-size:11pt}
    th.no{color:#fff;text-align:center}

    /* FOOTER */
    .footer{padding:2px 8px;background:#f8fafc;color:#64748b;font-size:6pt;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;gap:6px}
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div class="eyebrow">Daftar Kelas PKDP</div>
      <h1>Daftar Kelas Peserta</h1>
      <div class="subtitle">Peserta dikelompokkan per angkatan, dilengkapi fase dan kelas masing-masing.</div>
    </div>
    <div class="meta">
      <div class="meta-card"><div class="meta-label">Periode</div><div class="meta-value">${esc(periodLabel)}</div></div>
      <div class="meta-card"><div class="meta-label">Total Peserta</div><div class="meta-value">${totalParticipants}</div></div>
      <div class="meta-card"><div class="meta-label">Total Angkatan</div><div class="meta-value">${totalCohorts}</div></div>
    </div>
    <div class="content">${sections||'<div style="padding:16px;color:#64748b;text-align:center;font-weight:700">Belum ada peserta yang masuk kelas pada periode ini.</div>'}</div>
    <div class="footer"><span>Dicetak dari Sistem PKDP</span><span>${esc(generatedAt)}</span></div>
  </div>
</body>
</html>`;
};

exports.exportParticipantsPdf=async(req,res,next)=>{
  try{
    const periodId=req.query.period_id?Number(req.query.period_id):await getActivePeriodId();
    if(!periodId) return res.status(400).json({message:'period_id wajib'});
    const[[period]]=await db.query('SELECT label,year FROM periods WHERE id=?',[periodId]);
    if(!period) return res.status(404).json({message:'Periode tidak ditemukan'});
    const rows=await getParticipantClassRows({periodId});
    const generatedAt=new Date().toLocaleString('id-ID',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const html=buildParticipantsPdfHtml({rows,periodLabel:period.label||`Periode ${period.year||periodId}`,generatedAt});
    const browser=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox']});
    try{
      const page=await browser.newPage();
      await page.setContent(html,{waitUntil:'networkidle0'});
      const pdf=await page.pdf({format:'A4',printBackground:true,margin:{top:'10mm',right:'8mm',bottom:'10mm',left:'8mm'}});
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition','attachment; filename="daftar-kelas-peserta.pdf"');
      res.send(Buffer.from(pdf));
    }finally{
      await browser.close();
    }
  }catch(e){next(e);}
};
exports.getOne=async(req,res,next)=>{
  try{
    const[[cls]]=await db.query(`SELECT c.*,p.label AS period_label,co.cohort_no,co.ojc_mode FROM classes c LEFT JOIN periods p ON p.id=c.period_id LEFT JOIN cohorts co ON co.id=c.cohort_id WHERE c.id=?`,[req.params.id]);
    if(!cls) return res.status(404).json({message:'Kelas tidak ditemukan'});
    const[members]=await db.query(`SELECT u.id,u.name,u.email,pr.institution FROM class_members cm JOIN users u ON u.id=cm.user_id LEFT JOIN profiles pr ON pr.user_id=u.id WHERE cm.class_id=?`,[req.params.id]);
    const[narasumber]=await db.query(`SELECT u.id,u.name,u.email,cn.material_id,t.title AS task_name FROM class_narasumber cn JOIN users u ON u.id=cn.narasumber_id LEFT JOIN tasks t ON t.id=cn.material_id WHERE cn.class_id=?`,[req.params.id]);
    const[tasks]=await db.query(`SELECT t.id,t.title,t.phase,t.task_type,t.class_id,c.name AS class_name
       FROM tasks t LEFT JOIN classes c ON c.id=t.class_id
       WHERE (t.class_id=? OR t.class_id IS NULL) AND t.period_id=? ORDER BY t.phase,t.order_no`,[req.params.id,cls.period_id]);
    res.json({...cls,members,narasumber,tasks});
  }catch(e){next(e);}
};
exports.create=async(req,res,next)=>{
  try{
    const{period_id,name,phase:rawPhase,description}=req.body;
    if(!period_id||!name) return res.status(400).json({message:'period_id, name wajib'});
    const phase=(rawPhase==='ALL'||!rawPhase)?'':rawPhase;
    const[r]=await db.query('INSERT INTO classes (period_id,name,phase,description) VALUES (?,?,?,?)',[period_id,name,phase,description||null]);
    res.status(201).json({message:'Kelas dibuat',id:r.insertId});
  }catch(e){next(e);}
};
exports.update=async(req,res,next)=>{try{const{name,phase,description}=req.body;await db.query('UPDATE classes SET name=?,phase=?,description=? WHERE id=?',[name,phase,description,req.params.id]);res.json({message:'Kelas diperbarui'});}catch(e){next(e);}};
exports.remove=async(req,res,next)=>{
  try{
    const conn=await db.getConnection();
    try{
      await conn.beginTransaction();
      const [[cls]]=await conn.query('SELECT id,cohort_id FROM classes WHERE id=?',[req.params.id]);
      if(!cls){
        await conn.rollback();
        return res.status(404).json({message:'Kelas tidak ditemukan'});
      }

      await conn.query('DELETE FROM classes WHERE id=?',[req.params.id]);

      if(cls.cohort_id){
        const [[{total}]]=await conn.query('SELECT COUNT(*) AS total FROM classes WHERE cohort_id=?',[cls.cohort_id]);
        if(total===0) await conn.query('DELETE FROM cohorts WHERE id=?',[cls.cohort_id]);
      }

      await conn.commit();
      res.json({message:'Kelas dihapus'});
    }catch(e){
      await conn.rollback();
      throw e;
    }finally{conn.release();}
  }catch(e){next(e);}
};
exports.assignNarasumber=async(req,res,next)=>{
  try{
    const classId=Number(req.params.id);
    const narasumberId=Number(req.body.narasumber_id);
    const materialId=req.body.material_id==null||req.body.material_id===''?null:Number(req.body.material_id);

    if(!Number.isInteger(classId)||!Number.isInteger(narasumberId))
      return res.status(400).json({message:'class_id dan narasumber_id wajib'});

    const [[cls]]=await db.query('SELECT id,period_id,phase,name FROM classes WHERE id=?',[classId]);
    if(!cls) return res.status(404).json({message:'Kelas tidak ditemukan'});

    const [[nsUser]]=await db.query("SELECT id,role,status FROM users WHERE id=?",[narasumberId]);
    if(!nsUser||nsUser.role!=='NARASUMBER'||nsUser.status!=='active')
      return res.status(400).json({message:'Narasumber tidak valid atau tidak aktif'});

    let targetTasks=[];
    if(materialId!=null){
      if(!Number.isInteger(materialId)) return res.status(400).json({message:'material_id tidak valid'});
      const [rows]=await db.query(
        `SELECT t.id,t.title FROM tasks t
         WHERE t.id=? AND t.class_id=? AND t.phase IN ('OJC','ISC2')`,
        [materialId,classId]
      );
      if(!rows.length) return res.status(400).json({message:'Tugas tidak ditemukan pada kelas ini'});
      targetTasks=rows;
    }else{
      const [rows]=await db.query(
        `SELECT t.id,t.title FROM tasks t
         WHERE t.class_id=? AND t.phase IN ('OJC','ISC2')`,
        [classId]
      );
      if(!rows.length) return res.status(400).json({message:'Kelas ini belum memiliki tugas OJC/ISC2 untuk ditugaskan'});
      targetTasks=rows;
    }

    const taskIds=targetTasks.map(t=>t.id);
    const taskPh=taskIds.map(()=>'?').join(',');

    const [targetSlots]=await db.query(
      `SELECT ss.id,ss.task_id,ss.slot_date,ss.start_time,ss.end_time,c.name AS class_name
       FROM schedule_slots ss
       JOIN schedule_slot_classes ssc ON ssc.schedule_slot_id=ss.id
       JOIN classes c ON c.id=ssc.class_id
       WHERE ssc.class_id=? AND ss.task_id IN (${taskPh})
       GROUP BY ss.id,ss.task_id,ss.slot_date,ss.start_time,ss.end_time,c.name`,
      [classId,...taskIds]
    );

    if(targetSlots.length){
      const [otherSlots]=await db.query(
        `SELECT ss.id,ss.slot_date,ss.start_time,ss.end_time,c.id AS class_id,c.name AS class_name
         FROM schedule_slot_classes ssc
         JOIN schedule_slots ss ON ss.id=ssc.schedule_slot_id
         JOIN classes c ON c.id=ssc.class_id
         WHERE ssc.narasumber_id=? AND ssc.class_id<>?
         GROUP BY ss.id,ss.slot_date,ss.start_time,ss.end_time,c.id,c.name`,
        [narasumberId,classId]
      );

      for(const ns of targetSlots){
        for(const ex of otherSlots){
          if(String(ns.slot_date)!==String(ex.slot_date)) continue;
          const overlap=ns.start_time<ex.end_time&&ns.end_time>ex.start_time;
          if(overlap){
            return res.status(400).json({
              message:`Bentrok jadwal: ${ns.slot_date} ${String(ns.start_time).slice(0,5)}-${String(ns.end_time).slice(0,5)} berbenturan dengan kelas ${ex.class_name}`
            });
          }
        }
      }
    }else{
      const [targetWindows]=await db.query(
        `SELECT t.id,t.title,t.upload_open,t.upload_close,c.name AS class_name
         FROM tasks t
         JOIN classes c ON c.id=t.class_id
         WHERE t.id IN (${taskPh}) AND t.upload_open IS NOT NULL AND t.upload_close IS NOT NULL`,
        [...taskIds]
      );

      if(targetWindows.length){
        const [otherWindows]=await db.query(
          `SELECT t.id,t.title,t.upload_open,t.upload_close,c.id AS class_id,c.name AS class_name
           FROM class_narasumber cn
           JOIN tasks t ON t.id=cn.material_id
           JOIN classes c ON c.id=cn.class_id
           WHERE cn.narasumber_id=? AND cn.class_id<>?
             AND t.upload_open IS NOT NULL AND t.upload_close IS NOT NULL`,
          [narasumberId,classId]
        );

        for(const tw of targetWindows){
          const twStart=new Date(tw.upload_open);
          const twEnd=new Date(tw.upload_close);
          for(const ow of otherWindows){
            const owStart=new Date(ow.upload_open);
            const owEnd=new Date(ow.upload_close);
            const overlap=twStart<owEnd&&twEnd>owStart;
            if(overlap){
              return res.status(400).json({
                message:`Bentrok jadwal tugas: ${tw.title} (${tw.class_name}) bertabrakan dengan kelas ${ow.class_name}`
              });
            }
          }
        }
      }
    }

    const conn=await db.getConnection();
    try{
      await conn.beginTransaction();

      if(materialId==null){
        await conn.query('DELETE FROM class_narasumber WHERE class_id=? AND narasumber_id=? AND material_id IS NULL',[classId,narasumberId]);
        for(const t of targetTasks){
          await conn.query(
            'INSERT IGNORE INTO class_narasumber (class_id,narasumber_id,material_id) VALUES (?,?,?)',
            [classId,narasumberId,t.id]
          );
        }
      }else{
        await conn.query(
          'INSERT IGNORE INTO class_narasumber (class_id,narasumber_id,material_id) VALUES (?,?,?)',
          [classId,narasumberId,materialId]
        );
      }

      if(targetSlots.length){
        await conn.query(
          `UPDATE schedule_slot_classes ssc
           JOIN schedule_slots ss ON ss.id=ssc.schedule_slot_id
           SET ssc.narasumber_id=?
           WHERE ssc.class_id=? AND ss.task_id IN (${taskPh})`,
          [narasumberId,classId,...taskIds]
        );
      }

      await conn.commit();
      res.json({message:'Narasumber ditugaskan'});
    }catch(e){
      await conn.rollback();
      throw e;
    }finally{conn.release();}
  }catch(e){next(e);}
};
exports.removeNarasumber=async(req,res,next)=>{try{const nsId=req.params.nsId;const mid=req.params.mid;if(mid)await db.query('DELETE FROM class_narasumber WHERE class_id=? AND narasumber_id=? AND material_id=?',[req.params.id,nsId,mid]);else await db.query('DELETE FROM class_narasumber WHERE class_id=? AND narasumber_id=? AND material_id IS NULL',[req.params.id,nsId]);res.json({message:'Narasumber dihapus dari kelas'});}catch(e){next(e);}};
exports.addMember=async(req,res,next)=>{try{await db.query('INSERT IGNORE INTO class_members (class_id,user_id) VALUES (?,?)',[req.params.id,req.body.user_id]);res.json({message:'Dosen ditambahkan'});}catch(e){next(e);}};
exports.removeMember=async(req,res,next)=>{try{await db.query('DELETE FROM class_members WHERE class_id=? AND user_id=?',[req.params.id,req.params.userId]);res.json({message:'Dosen dihapus dari kelas'});}catch(e){next(e);}};
exports.getMyClasses=async(req,res,next)=>{try{const[r]=await db.query(`SELECT c.*,p.label AS period_label FROM class_members cm JOIN classes c ON c.id=cm.class_id LEFT JOIN periods p ON p.id=c.period_id WHERE cm.user_id=? ORDER BY c.phase`,[req.user.id]);res.json(r);}catch(e){next(e);}};
exports.getNarasumberClasses=async(req,res,next)=>{try{const[r]=await db.query(`SELECT c.*,p.label AS period_label,co.cohort_no,co.ojc_mode,COUNT(DISTINCT cm.user_id) AS member_count FROM class_narasumber cn JOIN classes c ON c.id=cn.class_id LEFT JOIN periods p ON p.id=c.period_id LEFT JOIN cohorts co ON co.id=c.cohort_id LEFT JOIN class_members cm ON cm.class_id=c.id WHERE cn.narasumber_id=? AND c.period_id=? GROUP BY c.id ORDER BY c.phase`,[req.user.id,req.user.period_id]);res.json(r);}catch(e){next(e);}};

exports.generateCohortClasses=async(req,res,next)=>{
  try{
    const { period_id, cohort_no, ojc_mode='2x20' } = req.body;
    if(!period_id||!cohort_no) return res.status(400).json({message:'period_id dan cohort_no wajib'});
    const conn=await db.getConnection();
    try{
      await conn.beginTransaction();
      const [cIns]=await conn.query('INSERT INTO cohorts (period_id,cohort_no,ojc_mode,created_by) VALUES (?,?,?,?)',[period_id,cohort_no,ojc_mode,req.user.id]);
      const cohortId=cIns.insertId;
      const isc1Names=[`ISC1`];
      const ojcNames=ojc_mode==='4x10'?[`${cohort_no}A`,`${cohort_no}B`,`${cohort_no}C`,`${cohort_no}D`]:[`${cohort_no}A`,`${cohort_no}B`];
      const isc2Names=[`${cohort_no}A`,`${cohort_no}B`];
      const classIds=[];
      for(const n of isc1Names){ const [r]=await conn.query('INSERT INTO classes (period_id,cohort_id,name,phase,description) VALUES (?,?,?,?,?)',[period_id,cohortId,n,'ISC1',`Auto angkatan ${cohort_no}`]); classIds.push({id:r.insertId,phase:'ISC1'}); }
      for(const n of ojcNames){ const [r]=await conn.query('INSERT INTO classes (period_id,cohort_id,name,phase,description) VALUES (?,?,?,?,?)',[period_id,cohortId,n,'OJC',`Auto angkatan ${cohort_no}`]); classIds.push({id:r.insertId,phase:'OJC'}); }
      for(const n of isc2Names){ const [r]=await conn.query('INSERT INTO classes (period_id,cohort_id,name,phase,description) VALUES (?,?,?,?,?)',[period_id,cohortId,n,'ISC2',`Auto angkatan ${cohort_no}`]); classIds.push({id:r.insertId,phase:'ISC2'}); }
      const capacity=40;
      const [dosen]=await conn.query(`
        SELECT u.id
        FROM users u
        WHERE u.role='DOSEN'
          AND u.period_id=?
          AND u.status='active'
          AND EXISTS (
            SELECT 1 FROM payment_submissions ps
            WHERE ps.user_id=u.id AND ps.period_id=? AND ps.status='verified'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM class_members cm
            JOIN classes cx ON cx.id=cm.class_id
            WHERE cm.user_id=u.id
              AND cx.period_id=u.period_id
              AND cx.cohort_id IS NOT NULL
          )
        ORDER BY u.id
        LIMIT ?
      `,[period_id,period_id,capacity]);
      const distribute=async(phase,names)=>{
        const target=classIds.filter(c=>c.phase===phase).map(c=>c.id);
        if(!target.length||!dosen.length) return;
        for(let idx=0;idx<dosen.length;idx++){
          const u=dosen[idx];
          await conn.query('INSERT IGNORE INTO class_members (class_id,user_id) VALUES (?,?)',[target[idx%target.length],u.id]);
        }
      };
      await distribute('ISC1',isc1Names); await distribute('OJC',ojcNames); await distribute('ISC2',isc2Names);
      await conn.commit();
      res.status(201).json({message:'Cohort dan kelas berhasil digenerate',cohort_id:cohortId});
    }catch(e){ await conn.rollback(); throw e; } finally { conn.release(); }
  }catch(e){next(e);}
};

exports.rebalanceCohort=async(req,res,next)=>{
  try{
    const cohortId=req.params.id;
    const [classes]=await db.query('SELECT id,phase FROM classes WHERE cohort_id=? ORDER BY phase,name',[cohortId]);
    if(!classes.length) return res.status(404).json({message:'Cohort classes tidak ditemukan'});
    const [allDosen]=await db.query('SELECT DISTINCT cm.user_id FROM class_members cm JOIN classes c ON c.id=cm.class_id WHERE c.cohort_id=? ORDER BY cm.user_id',[cohortId]);
    const byPhase={OJC:classes.filter(c=>c.phase==='OJC').map(c=>c.id),ISC2:classes.filter(c=>c.phase==='ISC2').map(c=>c.id)};
    const conn=await db.getConnection();
    try{
      await conn.beginTransaction();
      for(const phase of ['OJC','ISC2']){
        const classIds=byPhase[phase]; if(!classIds.length) continue;
        const ph=classIds.map(()=>'?').join(',');
        await conn.query(`DELETE cm FROM class_members cm WHERE cm.class_id IN (${ph})`,classIds);
        for(let i=0;i<allDosen.length;i++) await conn.query('INSERT IGNORE INTO class_members (class_id,user_id) VALUES (?,?)',[classIds[i%classIds.length],allDosen[i].user_id]);
      }
      await conn.commit();
      res.json({message:'Rebalance cohort selesai'});
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }catch(e){next(e);}
};

exports.removeCohort=async(req,res,next)=>{
  try{
    const cohortId=req.params.id;
    const conn=await db.getConnection();
    try{
      await conn.beginTransaction();
      await conn.query('DELETE FROM classes WHERE cohort_id=?',[cohortId]);
      const [r]=await conn.query('DELETE FROM cohorts WHERE id=?',[cohortId]);
      if(!r.affectedRows) throw Object.assign(new Error('Cohort tidak ditemukan'),{status:404});
      await conn.commit();
      res.json({message:'Cohort berhasil dihapus'});
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }catch(e){next(e);}
};
