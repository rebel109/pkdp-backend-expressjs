const db=require('../config/db');

const ensureGradeTimelineSchema=async()=>{
  const [cols]=await db.query("SHOW COLUMNS FROM grades WHERE Field IN ('initial_graded_at','remedial_graded_at')");
  const existing=new Set(cols.map(c=>c.Field));
  if(!existing.has('initial_graded_at')) await db.query('ALTER TABLE grades ADD COLUMN initial_graded_at DATETIME NULL AFTER is_draft');
  if(!existing.has('remedial_graded_at')) await db.query('ALTER TABLE grades ADD COLUMN remedial_graded_at DATETIME NULL AFTER initial_graded_at');
};

const ensureGradeUnlockAuditTable=async()=>{
  await db.query(`
    CREATE TABLE IF NOT EXISTS grade_unlock_audit (
      id INT AUTO_INCREMENT PRIMARY KEY,
      grade_id INT NOT NULL,
      submission_id INT NULL,
      admin_user_id INT NOT NULL,
      previous_submission_status VARCHAR(30) NULL,
      current_submission_status VARCHAR(30) NULL,
      status_changed TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (grade_id) REFERENCES grades(id) ON DELETE CASCADE,
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE SET NULL,
      FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
};

const OJC_WEIGHTS={
  OJC_RPS_INSTRUMEN:30,
  OJC_VIDEO_PEMBELAJARAN_PRAKTIK:30,
  OJC_ARTIKEL_ILMIAH:25,
  OJC_KONTEN_MODERASI:15
};

const ISC2_WEIGHTS={
  ISC2_VIDEO_PRAKTIK:50,
  ISC2_ARTIKEL_SUBMITTED:50
};

const NK_FORMULA={isc1:30,ojc:50,isc2:20};
const REKAP_FORMULA={
  nilai_besar:['ISC1','OJC','ISC2'],
  nilai_kecil:{
    isc1:['PRETEST','POSTTEST'],
    ojc:OJC_WEIGHTS,
    isc2:ISC2_WEIGHTS
  },
  nilai_akhir_kelulusan:NK_FORMULA
};

const round=n=>Math.round(n);

const avg=arr=>arr.length?round(arr.reduce((s,v)=>s+v,0)/arr.length):null;

const strictWeightedScore=(componentScores,weights)=>{
  const keys=Object.keys(weights);
  const complete=keys.every(k=>componentScores[k]!=null);
  if(!complete) return null;
  const weightedTotal=keys.reduce((sum,key)=>sum+(componentScores[key]*weights[key]),0);
  return round(weightedTotal/100);
};

const toPredikat=score=>{
  if(score==null) return {predikat:null,status_kelulusan:null};
  if(score>=91) return {predikat:'Sangat Baik',status_kelulusan:'Lulus'};
  if(score>=76) return {predikat:'Baik',status_kelulusan:'Lulus'};
  if(score>=61) return {predikat:'Cukup',status_kelulusan:'Lulus'};
  return {predikat:'Kurang',status_kelulusan:'Tidak Lulus'};
};

const componentLabelMap={
  OJC_RPS_INSTRUMEN:'Penyusunan RPS dan Instrumen Penilaian',
  OJC_VIDEO_PEMBELAJARAN_PRAKTIK:'Video bahan/sumber pembelajaran & video praktik mengajar',
  OJC_ARTIKEL_ILMIAH:'Penulisan Artikel Ilmiah',
  OJC_KONTEN_MODERASI:'Konten moderasi beragama pada media sosial',
  ISC2_VIDEO_PRAKTIK:'Video praktik mengajar',
  ISC2_ARTIKEL_SUBMITTED:'Artikel ilmiah siap submitted pada jurnal'
};

const finalNKKontribusi=(isc1,ojc,isc2)=>{
  if([isc1,ojc,isc2].some(v=>v==null)) return null;
  return round((isc1*0.3)+(ojc*0.5)+(isc2*0.2));
};

const progressNKKontribusi=(isc1,ojc,isc2)=>{
  const hasAny=[isc1,ojc,isc2].some(v=>v!=null);
  if(!hasAny) return 0;
  return round(
    ((isc1??0)*NK_FORMULA.isc1+
     (ojc??0)*NK_FORMULA.ojc+
     (isc2??0)*NK_FORMULA.isc2)/100
  );
};

const buildComponentScores=(subs,weightMap)=>{
  const scores={};
  Object.keys(weightMap).forEach(key=>{scores[key]=null;});
  const grouped={};
  subs.forEach(s=>{
    if(!s.assessment_component||s.final_score==null) return;
    if(!weightMap[s.assessment_component]) return;
    if(!grouped[s.assessment_component]) grouped[s.assessment_component]=[];
    grouped[s.assessment_component].push(Number(s.final_score));
  });
  Object.keys(grouped).forEach(k=>{scores[k]=avg(grouped[k]);});
  return scores;
};

const buildComponentStatusMap=(subs,weightMap)=>{
  const statusMap={};
  Object.keys(weightMap).forEach(key=>{statusMap[key]=null;});

  const latestByComponent={};
  subs.forEach(s=>{
    if(!s.assessment_component) return;
    if(!weightMap[s.assessment_component]) return;
    const key=s.assessment_component;
    const ts=s.submitted_at?new Date(s.submitted_at).getTime():0;
    const prev=latestByComponent[key];
    if(!prev||ts>prev.ts){
      latestByComponent[key]={ts,status:s.submission_status||null};
    }
  });

  Object.keys(latestByComponent).forEach(key=>{
    statusMap[key]=latestByComponent[key].status;
  });
  return statusMap;
};

const toComponentRows=(scoreMap,weightMap,statusMap={})=>Object.keys(weightMap).map(key=>({
  component_key:key,
  component_label:componentLabelMap[key]||key,
  weight:weightMap[key],
  score:scoreMap[key],
  submission_status:statusMap[key]??null
}));

const calcIsc1Score=(pretestScore,posttestScore)=>{
  if(pretestScore==null||posttestScore==null) return null;
  return round((pretestScore+posttestScore)/2);
};

const calcIsc1ProgressScore=(pretestScore,posttestScore)=>{
  if(posttestScore!=null) return round(posttestScore);
  if(pretestScore!=null) return 0;
  return 0;
};

const partialWeightedScore=(componentScores,weights)=>{
  const keys=Object.keys(weights);
  const hasAny=keys.some(k=>componentScores[k]!=null);
  if(!hasAny) return 0;
  const weightedTotal=keys.reduce((sum,key)=>sum+((componentScores[key]??0)*weights[key]),0);
  return round(weightedTotal/100);
};

const countCompletedComponents=(scoreMap,weightMap)=>Object.keys(weightMap).filter(k=>scoreMap[k]!=null).length;

const requiredComponentsCount=weightMap=>Object.keys(weightMap).length;

const phaseOrder=['ISC1','OJC','ISC2'];
const ACTIVE_SUBMISSION_STATUSES=['submitted','reviewed','revision','approved'];
const PARTICIPANT_VISIBLE_GRADE_STATUSES=['approved','remedial_approved'];

const isParticipantGradeVisible=row=>PARTICIPANT_VISIBLE_GRADE_STATUSES.includes(row?.status)&&!Number(row?.is_draft||0);

const sanitizeParticipantGradeRow=row=>isParticipantGradeVisible(row)
  ? row
  : {
      ...row,
      total_score:null,
      final_score:null,
      notes:null,
      instrument_title:null
    };

const buildParticipantRecapData=async({period_id,phase,class_id})=>{
  let participantQ=`SELECT u.id AS user_id,u.name,u.email,pr.nidn,pr.nuptk,pr.nip,pr.institution,pr.unit_kerja,pr.avatar_url,
                           c.id AS class_id,c.name AS class_name,c.phase AS class_phase
                    FROM users u
                    LEFT JOIN profiles pr ON pr.user_id=u.id
                    LEFT JOIN class_members cm ON cm.user_id=u.id
                    LEFT JOIN classes c ON c.id=cm.class_id
                    WHERE u.role='DOSEN' AND u.period_id=? AND u.payment_status='verified'`;
  const pParams=[period_id];
  if(class_id){participantQ+=' AND c.id=?';pParams.push(class_id);}
  if(phase){participantQ+=' AND (c.phase=? OR c.phase IS NULL OR c.phase="")';pParams.push(phase);}
  participantQ+=' ORDER BY u.name';
  const[participants]=await db.query(participantQ,pParams);

  let taskQ=`SELECT t.id,t.title,t.class_id,t.phase,t.task_type,t.assessment_component,c.name AS class_name
             FROM tasks t
             LEFT JOIN classes c ON c.id=t.class_id
             WHERE t.period_id=?`;
  const tParams=[period_id];
  if(phase){taskQ+=' AND t.phase=?';tParams.push(phase);}
  if(class_id){taskQ+=' AND t.class_id=?';tParams.push(class_id);}
  const[tasks]=await db.query(taskQ,tParams);

  const taskByClass=new Map();
  tasks.forEach(t=>{
    const key=t.class_id||'ALL';
    if(!taskByClass.has(key)) taskByClass.set(key,[]);
    taskByClass.get(key).push(t.id);
  });

  const userIds=[...new Set(participants.map(p=>p.user_id))];
  let submissions=[];
  if(userIds.length){
    const placeholders=userIds.map(()=>'?').join(',');
    let subQ=`SELECT s.user_id,s.task_id,s.status AS submission_status,s.submitted_at,t.phase,t.task_type,t.assessment_component,g.final_score
              FROM submissions s
              LEFT JOIN grades g ON g.submission_id=s.id
              JOIN tasks t ON t.id=s.task_id
              WHERE s.period_id=? AND s.user_id IN (${placeholders})`;
    const sParams=[period_id,...userIds];
    if(phase){subQ+=' AND t.phase=?';sParams.push(phase);}
    if(class_id){subQ+=' AND t.class_id=?';sParams.push(class_id);}
    const[subs]=await db.query(subQ,sParams);
    submissions=subs;
  }

  const submissionMap=new Map();
  submissions.forEach(s=>{
    const key=`${s.user_id}-${s.task_id}`;
    submissionMap.set(key,s);
  });

  let mcqScores=[];
  if(userIds.length){
    const placeholders=userIds.map(()=>'?').join(',');
    let mcqQ=`SELECT ma.user_id,t.id AS task_id,COUNT(ma.id) AS total_q,SUM(ma.is_correct) AS correct_q
              FROM mcq_answers ma
              JOIN tasks t ON t.id=ma.task_id
              WHERE t.period_id=? AND ma.user_id IN (${placeholders})`;
    const mcqParams=[period_id,...userIds];
    if(phase){mcqQ+=' AND t.phase=?';mcqParams.push(phase);}
    if(class_id){mcqQ+=' AND t.class_id=?';mcqParams.push(class_id);}
    mcqQ+=' GROUP BY ma.user_id,t.id';
    const[mcqRows]=await db.query(mcqQ,mcqParams);
    mcqScores=mcqRows;
  }

  const mcqScoreMap=new Map();
  mcqScores.forEach(m=>{
    const totalQ=Number(m.total_q)||0;
    const correctQ=Number(m.correct_q)||0;
    mcqScoreMap.set(`${m.user_id}-${m.task_id}`,totalQ?round((correctQ/totalQ)*100):null);
  });

  const taskMap=new Map(tasks.map(t=>[t.id,t]));

  const userClassMap=new Map();
  participants.forEach(p=>{
    if(!userClassMap.has(p.user_id)) userClassMap.set(p.user_id,new Set());
    if(p.class_id) userClassMap.get(p.user_id).add(p.class_id);
  });

  return{participants,tasks,taskByClass,submissionMap,mcqScoreMap,taskMap,userClassMap};
};
exports.getAll=async(req,res,next)=>{
  try{
    const{submission_id,phase}=req.query;
    let q=`SELECT g.*,s.user_id AS dosen_id,u.name AS dosen_name,t.title AS task_title,t.phase,i.title AS instrument_title,ns.name AS narasumber_name
           FROM grades g JOIN submissions s ON s.id=g.submission_id JOIN users u ON u.id=s.user_id JOIN tasks t ON t.id=s.task_id LEFT JOIN instruments i ON i.id=g.instrument_id LEFT JOIN users ns ON ns.id=g.narasumber_id WHERE 1=1`;
    const params=[];
    if(req.user.role==='DOSEN'){q+=" AND s.user_id=? AND COALESCE(g.is_draft,0)=0 AND s.status IN ('approved','remedial_approved')";params.push(req.user.id);}
    else if(req.user.role==='NARASUMBER'){q+=' AND g.narasumber_id=? AND t.period_id=?';params.push(req.user.id,req.user.period_id);}
    if(submission_id){q+=' AND g.submission_id=?';params.push(submission_id);}
    if(phase){q+=' AND t.phase=?';params.push(phase);}
    const[rows]=await db.query(q,params);res.json(rows);
  }catch(e){next(e);}
};
exports.summary=async(req,res,next)=>{
  try{
    const tid=parseInt(req.params.userId);
    if(req.user.role==='DOSEN'&&req.user.id!==tid) return res.status(403).json({message:'Akses ditolak'});
    const[rawRows]=await db.query(
      `SELECT t.phase,t.title AS task_title,t.task_type,t.assessment_component,g.total_score,g.final_score,g.notes,g.is_draft,i.title AS instrument_title,i.max_score,s.status
       FROM submissions s JOIN tasks t ON t.id=s.task_id LEFT JOIN grades g ON g.submission_id=s.id LEFT JOIN instruments i ON i.id=g.instrument_id WHERE s.user_id=? ORDER BY t.phase,t.order_no`,[tid]);
    const rows=req.user.role==='DOSEN'?rawRows.map(sanitizeParticipantGradeRow):rawRows;
    const[mcq]=await db.query(
      `SELECT t.id AS task_id,t.title,t.task_type,COUNT(ma.id) AS total_q,SUM(ma.is_correct) AS correct_q
       FROM tasks t LEFT JOIN mcq_answers ma ON ma.task_id=t.id AND ma.user_id=? WHERE t.task_type IN ('PRETEST','POSTTEST') GROUP BY t.id`,[tid]);

    const mcqRows=mcq.map(r=>({...r,score:r.total_q?round((r.correct_q/r.total_q)*100):0}));
    const preScores=mcqRows.filter(r=>r.task_type==='PRETEST').map(r=>r.score);
    const postScores=mcqRows.filter(r=>r.task_type==='POSTTEST').map(r=>r.score);

    const pretestScore=preScores.length?avg(preScores):null;
    const posttestScore=postScores.length?avg(postScores):null;
    const isc1Score=calcIsc1ProgressScore(pretestScore,posttestScore);

    const ojcGrades=rows.filter(r=>r.phase==='OJC'&&r.final_score!=null);
    const isc2Grades=rows.filter(r=>r.phase==='ISC2'&&r.final_score!=null);

    const ojcComponentScores=buildComponentScores(ojcGrades,OJC_WEIGHTS);
    const isc2ComponentScores=buildComponentScores(isc2Grades,ISC2_WEIGHTS);

    const ojcScore=partialWeightedScore(ojcComponentScores,OJC_WEIGHTS);
    const isc2Score=partialWeightedScore(isc2ComponentScores,ISC2_WEIGHTS);

    const nkFinal=progressNKKontribusi(isc1Score,ojcScore,isc2Score);
    const predikatInfo=toPredikat(nkFinal);

    res.json({
      grades:rows,
      mcq:mcqRows,
      recap:{
        isc1:{
          score:isc1Score,
          pretest_score:pretestScore,
          posttest_score:posttestScore
        },
        ojc:{
          score:ojcScore,
          components:toComponentRows(ojcComponentScores,OJC_WEIGHTS)
        },
        isc2:{
          score:isc2Score,
          components:toComponentRows(isc2ComponentScores,ISC2_WEIGHTS)
        },
        nk_final:nkFinal,
        predikat:predikatInfo.predikat,
        status_kelulusan:predikatInfo.status_kelulusan
      }
    });
  }catch(e){next(e);}
};
exports.create=async(req,res,next)=>{
  try{
    await ensureGradeTimelineSchema();
    const{submission_id,instrument_id,aspect_scores,notes}=req.body;
    if(!submission_id) return res.status(400).json({message:'submission_id wajib'});
    const draftNotes=notes!=null?String(notes):'';

    const [[subMeta]]=await db.query(
      `SELECT s.status,s.remedial_enabled,s.initial_final_score,g.final_score AS existing_final_score,t.phase,t.period_id,t.class_id,t.id AS task_id,t.material_id,t.assessment_component
       FROM submissions s
       JOIN tasks t ON t.id=s.task_id
       LEFT JOIN grades g ON g.submission_id=s.id
       WHERE s.id=?`,
      [submission_id]
    );
    if(!subMeta) return res.status(404).json({message:'Submission tidak ditemukan'});
    if(req.user.role==='NARASUMBER'){
      if(subMeta.period_id!==req.user.period_id) return res.status(403).json({message:'Akses ditolak: beda periode'});
      const [[assignment]]=await db.query(
        `SELECT 1 AS ok
         FROM class_narasumber cn
         WHERE cn.narasumber_id=? AND cn.class_id=?
           AND (
             cn.material_id IS NULL
             OR cn.material_id=?
             OR (cn.material_id=? AND ? IS NOT NULL)
             OR cn.material_id IN (
               SELECT tx.id FROM tasks tx
               WHERE tx.class_id=? AND tx.phase=? AND tx.assessment_component=?
             )
           )
         LIMIT 1`,
        [req.user.id,subMeta.class_id,subMeta.task_id,subMeta.material_id,subMeta.material_id,subMeta.class_id,subMeta.phase,subMeta.assessment_component]
      );
      if(!assignment) return res.status(403).json({message:'Akses ditolak: bukan kelas Anda'});
    }

    const isDraft=!!req.body.is_draft;
    const requireNotes=!isDraft&&['OJC','ISC2'].includes(subMeta.phase);
    if(requireNotes&&!String(notes||'').trim()){
      return res.status(400).json({message:'Catatan nilai wajib diisi untuk OJC/ISC2'});
    }

    const isRemedialLane=['remedial_open','remedial_submitted','remedial_reviewed','remedial_approved'].includes(subMeta.status);
    const requiresRemedialUpload=subMeta.phase!=='ISC1'&&isRemedialLane&&subMeta.remedial_enabled;
    if(requiresRemedialUpload&&subMeta.status!=='remedial_submitted'){
      return res.status(403).json({message:'Peserta harus upload tugas remedial terlebih dahulu sebelum narasumber bisa menilai'});
    }
    if(req.user.role==='NARASUMBER'&&['approved','remedial_approved'].includes(subMeta.status)){
      return res.status(403).json({message:'Nilai sudah final dan tidak bisa diubah. Hubungi Admin jika perlu membuka kunci.'});
    }

    const total=( aspect_scores||[]).reduce((s,a)=>s+(parseInt(a.score)||0),0);
    let maxAspectScore=0;
    if(instrument_id){
      const[[ins]]=await db.query(
        "SELECT COUNT(*) AS cnt FROM instrument_aspects WHERE instrument_id=?",[instrument_id]
      );
      maxAspectScore=(ins?.cnt||0)*3;
    }
    const finalScore=maxAspectScore>0?Math.round((total/maxAspectScore)*100):0;
    const[[eg]]=await db.query('SELECT id,initial_graded_at,remedial_graded_at FROM grades WHERE submission_id=?',[submission_id]);
    const isFinalSubmission=!isDraft;
    const isRemedialFinalSubmission=isFinalSubmission&&isRemedialLane;
    const shouldSetInitialGradedAt=isFinalSubmission&&!isRemedialLane;
    const shouldSetRemedialGradedAt=isRemedialFinalSubmission;
    let gid;
    if(eg){await db.query(`UPDATE grades
      SET instrument_id=?,
          total_score=?,
          final_score=?,
          notes=?,
          is_draft=?,
          narasumber_id=?,
          initial_graded_at=CASE WHEN ? THEN COALESCE(initial_graded_at,NOW()) ELSE initial_graded_at END,
          remedial_graded_at=CASE WHEN ? THEN NOW() ELSE remedial_graded_at END,
          updated_at=NOW()
      WHERE id=?`,[instrument_id||null,total,finalScore,notes,isDraft?1:0,req.user.id,shouldSetInitialGradedAt?1:0,shouldSetRemedialGradedAt?1:0,eg.id]);gid=eg.id;await db.query('DELETE FROM grade_aspects WHERE grade_id=?',[gid]);}
    else{const[r]=await db.query(`INSERT INTO grades (submission_id,narasumber_id,instrument_id,total_score,final_score,notes,is_draft,initial_graded_at,remedial_graded_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,[submission_id,req.user.id,instrument_id||null,total,finalScore,notes,isDraft?1:0,shouldSetInitialGradedAt?new Date():null,shouldSetRemedialGradedAt?new Date():null]);gid=r.insertId;}
    await db.query(`UPDATE grades
      SET initial_graded_at=COALESCE(initial_graded_at,updated_at)
      WHERE id=? AND is_draft=0 AND initial_graded_at IS NULL`,[gid]);
    if(isRemedialFinalSubmission){
      await db.query(`UPDATE grades
        SET remedial_graded_at=COALESCE(remedial_graded_at,updated_at)
        WHERE id=?`,[gid]);
    }
    if(aspect_scores?.length){for(const a of aspect_scores){await db.query('INSERT INTO grade_aspects (grade_id,aspect_id,score,note) VALUES (?,?,?,?)',[gid,a.aspect_id,a.score,a.note||null]);}}
    if(isRemedialLane&&subMeta.remedial_enabled){
      if(isDraft){
        await db.query("UPDATE submissions SET status='remedial_reviewed' WHERE id=?",[submission_id]);
      }else{
        await db.query(
          "UPDATE submissions SET status='remedial_reviewed', initial_final_score=COALESCE(initial_final_score,?), remedial_final_score=? WHERE id=?",
          [subMeta.existing_final_score??finalScore,finalScore,submission_id]
        );
      }
    }else{
      await db.query("UPDATE submissions SET status='reviewed' WHERE id=?",[submission_id]);
    }
    res.json({message:'Nilai disimpan',grade_id:gid,total_score:total,final_score:finalScore});
  }catch(e){next(e);}
};
exports.update=async(req,res,next)=>{
  try{
    const{aspect_scores,notes}=req.body;
    const[[grade]]=await db.query('SELECT * FROM grades WHERE id=?',[req.params.id]);
    if(!grade) return res.status(404).json({message:'Nilai tidak ditemukan'});

    const [[gradeMeta]]=await db.query(
      `SELECT t.phase,t.period_id,s.status,s.remedial_enabled,g.narasumber_id
       FROM grades g
       JOIN submissions s ON s.id=g.submission_id
       JOIN tasks t ON t.id=s.task_id
       WHERE g.id=?`,
      [req.params.id]
    );
    if(req.user.role==='NARASUMBER'&&(gradeMeta?.narasumber_id!==req.user.id||gradeMeta?.period_id!==req.user.period_id)){
      return res.status(403).json({message:'Akses ditolak'});
    }

    const requireNotes=['OJC','ISC2'].includes(gradeMeta?.phase);
    if(requireNotes&&!String(notes||'').trim()){
      return res.status(400).json({message:'Catatan nilai wajib diisi untuk OJC/ISC2'});
    }

    const isRemedialLane=['remedial_open','remedial_submitted','remedial_reviewed','remedial_approved'].includes(gradeMeta?.status);
    const requiresRemedialUpload=gradeMeta?.phase!=='ISC1'&&isRemedialLane&&gradeMeta?.remedial_enabled;
    if(requiresRemedialUpload&&gradeMeta?.status!=='remedial_submitted'){
      return res.status(403).json({message:'Peserta harus upload tugas remedial terlebih dahulu sebelum narasumber bisa menilai'});
    }
    if(req.user.role==='NARASUMBER'&&['approved','remedial_approved'].includes(gradeMeta?.status)){
      return res.status(403).json({message:'Nilai sudah final dan tidak bisa diubah. Hubungi Admin jika perlu membuka kunci.'});
    }

    // Narasumber cannot update locked grades
    if(req.user.role==='NARASUMBER'&&grade.is_locked){
      return res.status(403).json({message:'Nilai sudah dikunci dan tidak bisa diubah. Hubungi Admin untuk membuka kunci.'});
    }

    const total=(aspect_scores||[]).reduce((s,a)=>s+(parseInt(a.score)||0),0);
    let maxAspectScore=0;
    if(grade.instrument_id){
      const[[ins]]=await db.query(
        "SELECT COUNT(*) AS cnt FROM instrument_aspects WHERE instrument_id=?",[grade.instrument_id]
      );
      maxAspectScore=(ins?.cnt||0)*3;
    }
    const final=maxAspectScore>0?Math.round((total/maxAspectScore)*100):0;
    await db.query('UPDATE grades SET total_score=?,final_score=?,notes=?,updated_at=NOW() WHERE id=?',[total,final,notes,req.params.id]);
    await db.query('DELETE FROM grade_aspects WHERE grade_id=?',[req.params.id]);
    for(const a of(aspect_scores||[])){await db.query('INSERT INTO grade_aspects (grade_id,aspect_id,score,note) VALUES (?,?,?,?)',[req.params.id,a.aspect_id,a.score,a.note||null]);}
    res.json({message:'Nilai diperbarui',total_score:total,final_score:final});
  }catch(e){next(e);}
};
// Lock/unlock grades (Admin only)
exports.lock=async(req,res,next)=>{
  try{
    const[[grade]]=await db.query('SELECT id FROM grades WHERE id=?',[req.params.id]);
    if(!grade) return res.status(404).json({message:'Nilai tidak ditemukan'});
    await db.query('UPDATE grades SET is_locked=1,updated_at=NOW() WHERE id=?',[req.params.id]);
    res.json({message:'Nilai dikunci'});
  }catch(e){next(e);}
};
exports.unlock=async(req,res,next)=>{
  try{
    await ensureGradeUnlockAuditTable();

    const[[grade]]=await db.query(`
      SELECT g.id,g.submission_id,s.status AS submission_status
      FROM grades g
      LEFT JOIN submissions s ON s.id=g.submission_id
      WHERE g.id=?
    `,[req.params.id]);
    if(!grade) return res.status(404).json({message:'Nilai tidak ditemukan'});

    const previousStatus=grade.submission_status||null;

    await db.query('UPDATE grades SET is_locked=0,updated_at=NOW() WHERE id=?',[req.params.id]);

    const statusDowngradeMap={
      approved:'reviewed',
      remedial_approved:'remedial_reviewed'
    };
    const nextStatus=statusDowngradeMap[grade.submission_status]||grade.submission_status||null;
    const statusChanged=Boolean(grade.submission_id&&previousStatus&&nextStatus&&nextStatus!==previousStatus);

    if(statusChanged){
      await db.query('UPDATE submissions SET status=?,updated_at=NOW() WHERE id=?',[nextStatus,grade.submission_id]);
    }

    await db.query(
      `INSERT INTO grade_unlock_audit (grade_id,submission_id,admin_user_id,previous_submission_status,current_submission_status,status_changed)
       VALUES (?,?,?,?,?,?)`,
      [req.params.id,grade.submission_id||null,req.user.id,previousStatus,nextStatus,statusChanged?1:0]
    );

    const message=statusChanged
      ? `Nilai dibuka dan status submission dikembalikan ke ${nextStatus}`
      : 'Nilai dibuka';

    res.json({
      message,
      status_changed:statusChanged,
      previous_status:previousStatus,
      current_status:nextStatus
    });
  }catch(e){next(e);}
};
exports.getUnlockAudit=async(req,res,next)=>{
  try{
    await ensureGradeUnlockAuditTable();
    const gradeId=parseInt(req.params.id,10);
    if(!gradeId) return res.status(400).json({message:'ID nilai tidak valid'});

    const[rows]=await db.query(
      `SELECT a.id,a.grade_id,a.submission_id,a.previous_submission_status,a.current_submission_status,
              a.status_changed,a.created_at,u.id AS admin_user_id,u.name AS admin_name
       FROM grade_unlock_audit a
       LEFT JOIN users u ON u.id=a.admin_user_id
       WHERE a.grade_id=?
       ORDER BY a.created_at DESC,a.id DESC`,
      [gradeId]
    );
    res.json(rows);
  }catch(e){next(e);}
};
exports.getAllUnlockAudit=async(req,res,next)=>{
  try{
    await ensureGradeUnlockAuditTable();
    const{search='',phase='',period_id=''}=req.query;
    let q=`SELECT a.id,a.grade_id,a.submission_id,a.previous_submission_status,a.current_submission_status,
                  a.status_changed,a.created_at,u.name AS admin_name,
                  dosen.name AS dosen_name,ns.name AS narasumber_name,
                  t.title AS task_title,t.phase,c.name AS class_name
           FROM grade_unlock_audit a
           LEFT JOIN users u ON u.id=a.admin_user_id
           LEFT JOIN submissions s ON s.id=a.submission_id
           LEFT JOIN grades g ON g.id=a.grade_id
           LEFT JOIN users dosen ON dosen.id=s.user_id
           LEFT JOIN users ns ON ns.id=g.narasumber_id
           LEFT JOIN tasks t ON t.id=s.task_id
           LEFT JOIN classes c ON c.id=t.class_id
           WHERE 1=1`;
    const params=[];
    if(phase){q+=' AND t.phase=?';params.push(phase);}
    if(period_id){q+=' AND t.period_id=?';params.push(period_id);}
    if(search&&String(search).trim()){
      q+=' AND (dosen.name LIKE ? OR ns.name LIKE ? OR u.name LIKE ? OR t.title LIKE ? OR c.name LIKE ?)';
      const keyword=`%${String(search).trim()}%`;
      params.push(keyword,keyword,keyword,keyword,keyword);
    }
    q+=' ORDER BY a.created_at DESC,a.id DESC';
    const[rows]=await db.query(q,params);
    res.json(rows);
  }catch(e){next(e);}
};
exports.remove=async(req,res,next)=>{try{await db.query('DELETE FROM grades WHERE id=?',[req.params.id]);res.json({message:'Nilai dihapus'});}catch(e){next(e);}};

exports.participantRecap=async(req,res,next)=>{
  try{
    const{period_id,phase,class_id}=req.query;
    if(!period_id) return res.status(400).json({message:'period_id wajib'});

    const{participants,taskByClass,submissionMap,mcqScoreMap,taskMap,userClassMap}=await buildParticipantRecapData({period_id,phase,class_id});

    const recapRows=participants.map(p=>{
      const userClassIds=userClassMap.get(p.user_id)||new Set();
      const classTaskIds=[...userClassIds].flatMap(classId=>taskByClass.get(classId)||[]);
      const uniqTaskIds=[...new Set([...classTaskIds,...(taskByClass.get('ALL')||[])])];
      let submitted_count=0;

      uniqTaskIds.forEach(taskId=>{
        const sub=submissionMap.get(`${p.user_id}-${taskId}`);
        if(sub&&ACTIVE_SUBMISSION_STATUSES.includes(sub.submission_status)) submitted_count++;
      });

      const pretestScores=[];
      const posttestScores=[];
      const userSubs=[];

      uniqTaskIds.forEach(taskId=>{
        const task=taskMap.get(taskId);
        const sub=submissionMap.get(`${p.user_id}-${taskId}`);
        const mcqScore=mcqScoreMap.get(`${p.user_id}-${taskId}`);
        if(task?.task_type==='PRETEST'&&mcqScore!=null) pretestScores.push(mcqScore);
        if(task?.task_type==='POSTTEST'&&mcqScore!=null) posttestScores.push(mcqScore);
        if(sub) userSubs.push(sub);
      });

      const pretestScore=pretestScores.length?avg(pretestScores):null;
      const posttestScore=posttestScores.length?avg(posttestScores):null;
      const isc1Score=calcIsc1ProgressScore(pretestScore,posttestScore);
      const ojcComponentScores=buildComponentScores(userSubs.filter(s=>s.phase==='OJC'),OJC_WEIGHTS);
      const isc2ComponentScores=buildComponentScores(userSubs.filter(s=>s.phase==='ISC2'),ISC2_WEIGHTS);
      const ojcScore=partialWeightedScore(ojcComponentScores,OJC_WEIGHTS);
      const isc2Score=partialWeightedScore(isc2ComponentScores,ISC2_WEIGHTS);
      const avg_final_score=progressNKKontribusi(isc1Score,ojcScore,isc2Score);
      const total_tasks=uniqTaskIds.length;
      const not_submitted_count=Math.max(total_tasks-submitted_count,0);

      return{
        user_id:p.user_id,
        name:p.name,
        email:p.email,
        avatar_url:p.avatar_url,
        nidn:p.nidn,
        nuptk:p.nuptk,
        nip:p.nip,
        institution:p.institution,
        unit_kerja:p.unit_kerja,
        class_id:p.class_id,
        class_name:p.class_name,
        class_phase:p.class_phase,
        total_tasks,
        submitted_count,
        not_submitted_count,
        avg_final_score
      };
    });

    const uniqueRows=[];
    const seen=new Set();
    for(const r of recapRows){
      if(seen.has(r.user_id)) continue;
      seen.add(r.user_id);
      uniqueRows.push(r);
    }

    const summary={
      total_peserta:uniqueRows.length,
      total_submitted:uniqueRows.reduce((s,r)=>s+r.submitted_count,0),
      total_not_submitted:uniqueRows.reduce((s,r)=>s+r.not_submitted_count,0),
      avg_score:uniqueRows.filter(r=>r.avg_final_score!=null).length
        ?Math.round(uniqueRows.filter(r=>r.avg_final_score!=null).reduce((s,r)=>s+r.avg_final_score,0)/uniqueRows.filter(r=>r.avg_final_score!=null).length)
        :null
    };

    res.json({summary,rows:uniqueRows});
  }catch(e){next(e);}
};

exports.participantRecapTasksDetail=async(req,res,next)=>{
  try{
    const{period_id,phase,class_id,user_id,scope='all'}=req.query;
    if(!period_id) return res.status(400).json({message:'period_id wajib'});
    if(!user_id) return res.status(400).json({message:'user_id wajib'});
    if(!['all','submitted','not_submitted'].includes(scope)) return res.status(400).json({message:'scope tidak valid'});

    const targetUserId=Number(user_id);
    const{participants,taskByClass,submissionMap,taskMap,userClassMap}=await buildParticipantRecapData({period_id,phase,class_id});
    const participant=participants.find(p=>Number(p.user_id)===targetUserId);
    if(!participant) return res.json({rows:[]});

    const userClassIds=userClassMap.get(targetUserId)||new Set();
    const classTaskIds=[...userClassIds].flatMap(classId=>taskByClass.get(classId)||[]);
    const uniqTaskIds=[...new Set([...classTaskIds,...(taskByClass.get('ALL')||[])])];

    const rows=uniqTaskIds.map(taskId=>{
      const task=taskMap.get(taskId);
      const sub=submissionMap.get(`${targetUserId}-${taskId}`);
      return{
        task_id:taskId,
        title:task?.title||'—',
        phase:task?.phase||'—',
        task_type:task?.task_type||'—',
        class_id:task?.class_id||null,
        class_name:task?.class_name||null,
        submission_status:sub?.submission_status||'not_submitted',
        submitted_at:sub?.submitted_at||null
      };
    }).filter(row=>{
      if(scope==='submitted') return ACTIVE_SUBMISSION_STATUSES.includes(row.submission_status);
      if(scope==='not_submitted') return !ACTIVE_SUBMISSION_STATUSES.includes(row.submission_status);
      return true;
    }).sort((a,b)=>{
      const phaseDiff=(phaseOrder.indexOf(a.phase)-phaseOrder.indexOf(b.phase));
      if(phaseDiff!==0) return phaseDiff;
      return String(a.title).localeCompare(String(b.title));
    });

    res.json({rows});
  }catch(e){next(e);}
};

// Admin: Rekap semua dosen
exports.narasumberSummary=async(req,res,next)=>{
  try{
    const{period_id,phase}=req.query;

    let assignQ=`SELECT DISTINCT cn.narasumber_id,ns.name AS narasumber_name,ns.email AS narasumber_email,
                        pr.nidn,pr.nip,pr.institution,pr.unit_kerja,pr.avatar_url,
                        c.id AS class_id,c.name AS class_name,c.phase AS class_phase,c.period_id,
                        p.label AS period_label,p.year AS period_year,
                        t.id AS task_id,t.title AS task_title,t.phase AS task_phase,t.task_type,t.assessment_component,t.order_no
                 FROM class_narasumber cn
                 JOIN users ns ON ns.id=cn.narasumber_id
                 JOIN classes c ON c.id=cn.class_id
                 JOIN tasks t ON t.class_id=c.id AND (cn.material_id IS NULL OR cn.material_id=t.id OR (t.material_id IS NOT NULL AND cn.material_id=t.material_id))
                 LEFT JOIN periods p ON p.id=c.period_id
                 LEFT JOIN profiles pr ON pr.user_id=ns.id
                 WHERE ns.role='NARASUMBER'`;
    const assignParams=[];
    if(period_id){assignQ+=' AND c.period_id=?';assignParams.push(period_id);}
    if(phase){assignQ+=' AND t.phase=?';assignParams.push(phase);}
    assignQ+=' ORDER BY ns.name,c.phase,c.name,t.phase,t.order_no,t.title';
    const[assignments]=await db.query(assignQ,assignParams);

    const classIds=[...new Set(assignments.map(a=>a.class_id))];
    let members=[];
    if(classIds.length){
      const ph=classIds.map(()=>'?').join(',');
      const[mRows]=await db.query(
        `SELECT cm.class_id,u.id AS user_id,u.name,u.email,pr.nidn,pr.nip,pr.institution
         FROM class_members cm
         JOIN users u ON u.id=cm.user_id AND u.role='DOSEN'
         LEFT JOIN profiles pr ON pr.user_id=u.id
         WHERE cm.class_id IN (${ph})
         ORDER BY u.name`,
        classIds
      );
      members=mRows;
    }

    const taskIds=[...new Set(assignments.map(a=>a.task_id))];
    const userIds=[...new Set(members.map(m=>m.user_id))];
    let statuses=[];
    if(taskIds.length&&userIds.length){
      const tph=taskIds.map(()=>'?').join(',');
      const uph=userIds.map(()=>'?').join(',');
      const[sRows]=await db.query(
        `SELECT s.user_id,s.task_id,s.status AS submission_status,s.submitted_at,
                g.narasumber_id,g.final_score,g.total_score,g.is_draft,g.is_locked,g.updated_at AS graded_at
         FROM submissions s
         LEFT JOIN grades g ON g.submission_id=s.id
         WHERE s.task_id IN (${tph}) AND s.user_id IN (${uph})`,
        [...taskIds,...userIds]
      );
      statuses=sRows;
    }

    const membersByClass=new Map();
    members.forEach(m=>{
      if(!membersByClass.has(m.class_id)) membersByClass.set(m.class_id,[]);
      membersByClass.get(m.class_id).push(m);
    });

    const statusMap=new Map();
    statuses.forEach(s=>{
      statusMap.set(`${s.user_id}-${s.task_id}`,s);
    });

    const nsMap=new Map();
    assignments.forEach(a=>{
      if(!nsMap.has(a.narasumber_id)){
        nsMap.set(a.narasumber_id,{
          id:a.narasumber_id,
          name:a.narasumber_name,
          email:a.narasumber_email,
          nidn:a.nidn,
          nip:a.nip,
          institution:a.institution,
          unit_kerja:a.unit_kerja,
          avatar_url:a.avatar_url,
          classes:[]
        });
      }
      const ns=nsMap.get(a.narasumber_id);
      let cls=ns.classes.find(c=>c.id===a.class_id);
      if(!cls){
        cls={id:a.class_id,name:a.class_name,phase:a.class_phase,period_id:a.period_id,period_label:a.period_label,period_year:a.period_year,tasks:[],participants:[]};
        ns.classes.push(cls);
      }
      if(!cls.tasks.some(t=>t.id===a.task_id)){
        cls.tasks.push({id:a.task_id,title:a.task_title,phase:a.task_phase,task_type:a.task_type,assessment_component:a.assessment_component,order_no:a.order_no});
      }
    });

    const result=[...nsMap.values()].map(ns=>{
      let totalTasks=0;
      let totalRead=0;
      let totalRevision=0;
      let totalGraded=0;
      const scores=[];

      ns.classes=ns.classes.map(cls=>{
        const classMembers=membersByClass.get(cls.id)||[];
        const participants=classMembers.map(m=>{
          const materials=cls.tasks.map(t=>{
            const st=statusMap.get(`${m.user_id}-${t.id}`);
            const isDraft=!!st?.is_draft;
            const isGraded=st?.final_score!==null&&st?.final_score!==undefined&&!isDraft;
            const status=isDraft?'draft':(isGraded?'graded':(st?.submission_status||'not_submitted'));
            totalTasks++;
            if(['submitted','reviewed','approved'].includes(st?.submission_status)) totalRead++;
            if(st?.submission_status==='revision') totalRevision++;
            if(isGraded){totalGraded++;scores.push(Number(st.final_score));}
            return{
              task_id:t.id,
              title:t.title,
              phase:t.phase,
              task_type:t.task_type,
              assessment_component:t.assessment_component,
              status,
              submission_status:st?.submission_status||'not_submitted',
              submitted_at:st?.submitted_at||null,
              final_score:st?.final_score??null,
              total_score:st?.total_score??null,
              is_draft:isDraft,
              graded_at:st?.graded_at||null
            };
          });
          return{
            user_id:m.user_id,
            name:m.name,
            email:m.email,
            nidn:m.nidn,
            nip:m.nip,
            institution:m.institution,
            materials
          };
        });
        return{...cls,participants,participant_count:participants.length,task_count:cls.tasks.length};
      });

      return{...ns,total_classes:ns.classes.length,total_tasks:totalTasks,total_read:totalRead,total_revision:totalRevision,total_graded:totalGraded,avg_score:avg(scores)};
    });

    const allScores=result.flatMap(ns=>ns.classes.flatMap(c=>c.participants.flatMap(p=>p.materials.map(m=>m.final_score).filter(v=>v!=null).map(Number))));
    const summary={
      total_narasumber:result.length,
      total_classes:result.reduce((s,r)=>s+r.total_classes,0),
      total_tasks:result.reduce((s,r)=>s+r.total_tasks,0),
      total_graded:result.reduce((s,r)=>s+r.total_graded,0),
      total_revision:result.reduce((s,r)=>s+r.total_revision,0),
      avg_score:avg(allScores)||0,
      by_phase:{
        ISC1:{total:result.reduce((s,r)=>s+r.classes.filter(c=>c.phase==='ISC1'||c.tasks.some(t=>t.phase==='ISC1')).length,0)},
        OJC:{total:result.reduce((s,r)=>s+r.classes.filter(c=>c.phase==='OJC'||c.tasks.some(t=>t.phase==='OJC')).length,0)},
        ISC2:{total:result.reduce((s,r)=>s+r.classes.filter(c=>c.phase==='ISC2'||c.tasks.some(t=>t.phase==='ISC2')).length,0)}
      }
    };

    res.json({narasumbers:result,summary});
  }catch(e){next(e);}
};

exports.allSummary=async(req,res,next)=>{
  try{
    const{period_id,phase}=req.query;

    // Ambil semua dosen
    let dosenQ=`SELECT u.id,u.name,u.email,u.period_id,p.label AS period_label,p.year AS period_year,
                       pr.nidn,pr.nip,pr.institution,pr.unit_kerja,pr.avatar_url
                FROM users u LEFT JOIN periods p ON p.id=u.period_id
                LEFT JOIN profiles pr ON pr.user_id=u.id
                WHERE u.role='DOSEN' AND u.payment_status='verified'`;
    const dosenParams=[];
    if(period_id){dosenQ+=' AND u.period_id=?';dosenParams.push(period_id);}
    dosenQ+=' ORDER BY u.name';
    const[dosens]=await db.query(dosenQ,dosenParams);

    // Ambil semua submission & grades (TANPA filter phase - ambil semua dulu)
    let subQ=`SELECT s.user_id,t.phase,t.title,t.task_type,t.assessment_component,t.id AS task_id,
                     g.final_score,g.total_score,
                     s.status AS submission_status,s.submitted_at
              FROM submissions s
              JOIN tasks t ON t.id=s.task_id
              LEFT JOIN grades g ON g.submission_id=s.id
              WHERE 1=1`;
    const subParams=[];
    if(period_id){subQ+=' AND s.period_id=?';subParams.push(period_id);}
    if(phase){subQ+=' AND t.phase=?';subParams.push(phase);}
    const[submissions]=await db.query(subQ,subParams);

    // Ambil MCQ scores (pretest/posttest)
    let mcqQ=`SELECT ma.user_id,t.id AS task_id,t.phase,t.task_type,
                     COUNT(ma.id) AS total_q,
                     SUM(ma.is_correct) AS correct_q
              FROM mcq_answers ma
              JOIN tasks t ON t.id=ma.task_id
              WHERE 1=1`;
    const mcqParams=[];
    if(period_id){mcqQ+=' AND t.period_id=?';mcqParams.push(period_id);}
    mcqQ+=' GROUP BY ma.user_id,t.id,t.phase,t.task_type';
    const[mcqScores]=await db.query(mcqQ,mcqParams);

    const dosenIds=dosens.map(d=>d.id);
    let classMembers=[];
    if(dosenIds.length){
      const placeholders=dosenIds.map(()=>'?').join(',');
      let cmQ=`SELECT cm.user_id,cm.class_id,c.name AS class_name,c.phase AS class_phase,co.cohort_no
               FROM class_members cm
               JOIN classes c ON c.id=cm.class_id
               LEFT JOIN cohorts co ON co.id=c.cohort_id
               WHERE cm.user_id IN (${placeholders})`;
      const cmParams=[...dosenIds];
      if(period_id){cmQ+=' AND c.period_id=?';cmParams.push(period_id);}
      cmQ+=' ORDER BY cm.user_id,c.phase,c.name,c.id';
      const[cmRows]=await db.query(cmQ,cmParams);
      classMembers=cmRows;
    }

    const userClassMap=new Map();
    const userClassInfoMap=new Map();
    const userCohortMap=new Map();
    classMembers.forEach(cm=>{
      if(!userClassMap.has(cm.user_id)) userClassMap.set(cm.user_id,new Set());
      userClassMap.get(cm.user_id).add(cm.class_id);

      if(!userClassInfoMap.has(cm.user_id)) userClassInfoMap.set(cm.user_id,[]);
      const classInfos=userClassInfoMap.get(cm.user_id);
      if(cm.class_id && !classInfos.some(info=>info.class_id===cm.class_id)){
        classInfos.push({
          class_id:cm.class_id,
          class_name:cm.class_name||null,
          class_phase:cm.class_phase||null
        });
      }

      if(!userCohortMap.has(cm.user_id) && cm.cohort_no!=null) userCohortMap.set(cm.user_id,cm.cohort_no);
    });

    // Ambil semua tugas per fase untuk reference
    let taskQ='SELECT id,phase,title,task_type,assessment_component,class_id,period_id FROM tasks WHERE 1=1';
    const taskParams=[];
    if(period_id){taskQ+=' AND period_id=?';taskParams.push(period_id);}
    if(phase){taskQ+=' AND phase=?';taskParams.push(phase);}
    const[tasks]=await db.query(taskQ,taskParams);

    // Build response
    const result=dosens.map(d=>{
      const userId=d.id;
      const userSubs=submissions.filter(s=>s.user_id===userId);
      const userMcq=mcqScores.filter(m=>m.user_id===userId);
      const userClassIds=userClassMap.get(userId)||new Set();
      const cohortNo=userCohortMap.get(userId) ?? null;
      const classInfos=(userClassInfoMap.get(userId)||[])
        .filter(info=>!phase||!info.class_phase||info.class_phase===phase)
        .map(info=>({
          class_id:info.class_id,
          class_name:info.class_name,
          class_phase:info.class_phase
        }));

      const phaseState={ISC1:null,OJC:null,ISC2:null};

      const phases=phaseOrder.map(ph=>{
        const phSubs=userSubs.filter(s=>s.phase===ph);
        const phTasks=tasks.filter(t=>t.phase===ph&&(t.class_id===null||userClassIds.has(t.class_id)));
        const phMcq=userMcq.filter(m=>m.phase===ph);

        const pretest=phMcq.find(m=>m.task_type==='PRETEST');
        const posttest=phMcq.find(m=>m.task_type==='POSTTEST');
        const pretestScore=pretest&&pretest.total_q>0
          ? round((parseInt(pretest.correct_q)/parseInt(pretest.total_q))*100)
          : null;
        const posttestScore=posttest&&posttest.total_q>0
          ? round((parseInt(posttest.correct_q)/parseInt(posttest.total_q))*100)
          : null;

        const isc1Score=ph==='ISC1'?calcIsc1ProgressScore(pretestScore,posttestScore):null;

        const ojcComponentScores=ph==='OJC'?buildComponentScores(phSubs,OJC_WEIGHTS):null;
        const ojcComponentStatuses=ph==='OJC'?buildComponentStatusMap(phSubs,OJC_WEIGHTS):null;
        const ojcScore=ph==='OJC'?partialWeightedScore(ojcComponentScores,OJC_WEIGHTS):null;

        const isc2ComponentScores=ph==='ISC2'?buildComponentScores(phSubs,ISC2_WEIGHTS):null;
        const isc2ComponentStatuses=ph==='ISC2'?buildComponentStatusMap(phSubs,ISC2_WEIGHTS):null;
        const isc2Score=ph==='ISC2'?partialWeightedScore(isc2ComponentScores,ISC2_WEIGHTS):null;

        const avgGrade=ph==='ISC1'
          ? isc1Score
          : ph==='OJC'
            ? ojcScore
            : isc2Score;

        const gradeCount=ph==='ISC1'
          ? [pretestScore,posttestScore].filter(v=>v!=null).length
          : ph==='OJC'
            ? countCompletedComponents(ojcComponentScores,OJC_WEIGHTS)
            : countCompletedComponents(isc2ComponentScores,ISC2_WEIGHTS);

        const requiredCount=ph==='ISC1'
          ? 2
          : ph==='OJC'
            ? requiredComponentsCount(OJC_WEIGHTS)
            : requiredComponentsCount(ISC2_WEIGHTS);

        const submittedCount=phSubs.filter(s=>['submitted','reviewed','approved'].includes(s.submission_status)).length;

        const phaseRow={
          phase:ph,
          tasks:phTasks.map(t=>{
            const sub=phSubs.find(s=>s.task_id===t.id);
            let taskScore=sub?.final_score;
            if(['PRETEST','POSTTEST'].includes(t.task_type)){
              const mcqAns=userMcq.filter(m=>m.task_id===t.id);
              if(mcqAns.length>0){
                const totalQ=mcqAns.reduce((sum,m)=>sum+parseInt(m.total_q),0);
                const correctQ=mcqAns.reduce((sum,m)=>sum+parseInt(m.correct_q),0);
                taskScore=totalQ>0?round((correctQ/totalQ)*100):null;
              }
            }
            return{
              task_id:t.id,
              title:t.title,
              task_type:t.task_type,
              assessment_component:t.assessment_component||sub?.assessment_component||null,
              submitted:!!sub,
              submission_status:sub?.submission_status||null,
              final_score:taskScore
            };
          }),
          stats:{
            total_tasks:phTasks.length,
            submitted:submittedCount,
            graded:gradeCount,
            required_components:requiredCount,
            avg_grade:avgGrade,
            pretest_score:pretestScore,
            posttest_score:posttestScore,
            component_scores:ph==='OJC'
              ? toComponentRows(ojcComponentScores,OJC_WEIGHTS,ojcComponentStatuses)
              : ph==='ISC2'
                ? toComponentRows(isc2ComponentScores,ISC2_WEIGHTS,isc2ComponentStatuses)
                : []
          }
        };

        if(ph==='ISC1') phaseState.ISC1=isc1Score;
        if(ph==='OJC') phaseState.OJC=ojcScore;
        if(ph==='ISC2') phaseState.ISC2=isc2Score;

        return phaseRow;
      });

      const nkFinal=progressNKKontribusi(phaseState.ISC1,phaseState.OJC,phaseState.ISC2);
      const predikatInfo=toPredikat(nkFinal);

      const nilaiBesar={
        isc1:phaseState.ISC1,
        ojc:phaseState.OJC,
        isc2:phaseState.ISC2
      };

      const isc1Phase=phases.find(p=>p.phase==='ISC1')?.stats||{};
      const ojcPhase=phases.find(p=>p.phase==='OJC')?.stats||{};
      const isc2Phase=phases.find(p=>p.phase==='ISC2')?.stats||{};

      return{
        ...d,
        cohort_no:cohortNo,
        classes:classInfos,
        phases,
        phase_scores:nilaiBesar,
        nilai_besar:nilaiBesar,
        nilai_kecil:{
          isc1:{
            pretest:isc1Phase.pretest_score??null,
            posttest:isc1Phase.posttest_score??null
          },
          ojc:ojcPhase.component_scores||[],
          isc2:isc2Phase.component_scores||[]
        },
        nilai_akhir_kelulusan:{
          nk:nkFinal,
          formula:NK_FORMULA
        },
        overall_avg:nkFinal,
        nk_final:nkFinal,
        predikat:predikatInfo.predikat,
        status_kelulusan:predikatInfo.status_kelulusan,
        total_submissions:userSubs.length
      };
    });

    // Summary stats
    const withNk=result.filter(r=>r.nk_final!=null);
    const withIsc1=result.filter(r=>r.phase_scores?.isc1!=null);
    const withOjc=result.filter(r=>r.phase_scores?.ojc!=null);
    const withIsc2=result.filter(r=>r.phase_scores?.isc2!=null);
    const summary={
      total_dosen:dosens.length,
      avg_overall:withNk.length?round(withNk.reduce((sum,r)=>sum+r.nk_final,0)/withNk.length):0,
      lulus_count:result.filter(r=>r.status_kelulusan==='Lulus').length,
      tidak_lulus_count:result.filter(r=>r.status_kelulusan==='Tidak Lulus').length,
      by_phase:{
        ISC1:{
          total:result.filter(r=>r.phase_scores?.isc1!=null).length,
          avg_score:withIsc1.length?round(withIsc1.reduce((sum,r)=>sum+r.phase_scores.isc1,0)/withIsc1.length):0
        },
        OJC:{
          total:result.filter(r=>r.phase_scores?.ojc!=null).length,
          avg_score:withOjc.length?round(withOjc.reduce((sum,r)=>sum+r.phase_scores.ojc,0)/withOjc.length):0
        },
        ISC2:{
          total:result.filter(r=>r.phase_scores?.isc2!=null).length,
          avg_score:withIsc2.length?round(withIsc2.reduce((sum,r)=>sum+r.phase_scores.isc2,0)/withIsc2.length):0
        }
      }
    };

    res.json({
      dosens:result,
      summary,
      formula_rekap:REKAP_FORMULA
    });
  }catch(e){next(e);}
};
