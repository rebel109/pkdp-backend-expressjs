const db=require('../config/db');

const OJC_COMPONENTS=[
  'OJC_RPS_INSTRUMEN',
  'OJC_VIDEO_PEMBELAJARAN_PRAKTIK',
  'OJC_ARTIKEL_ILMIAH',
  'OJC_KONTEN_MODERASI'
];
const ISC2_COMPONENTS=[
  'ISC2_VIDEO_PRAKTIK',
  'ISC2_ARTIKEL_SUBMITTED'
];

const isValidAssessmentComponent=(phase,component)=>{
  if(phase==='ISC1') return !component;
  if(phase==='OJC') return !component || OJC_COMPONENTS.includes(component);
  if(phase==='ISC2') return ISC2_COMPONENTS.includes(component);
  return false;
};

const normalizeAssessmentComponent=v=>v?String(v).trim().toUpperCase():null;

exports.getAll=async(req,res,next)=>{
  try{
    const{phase,period_id,class_id}=req.query;
    let q=`SELECT t.*,c.name AS class_name,c.phase AS class_phase,p.label AS period_label,
                  COALESCE(
                    (SELECT u.name FROM class_narasumber cn JOIN users u ON u.id=cn.narasumber_id
                     WHERE cn.class_id=t.class_id AND (cn.material_id=t.id OR cn.material_id=t.material_id)
                     ORDER BY cn.id ASC LIMIT 1),
                    (SELECT u.name FROM class_narasumber cn JOIN users u ON u.id=cn.narasumber_id
                     WHERE cn.class_id=t.class_id AND cn.material_id IS NULL
                     ORDER BY cn.id ASC LIMIT 1)
                  ) AS narasumber_name
           FROM tasks t
           LEFT JOIN classes c ON c.id=t.class_id
           LEFT JOIN periods p ON p.id=t.period_id
           WHERE 1=1`;
    const params=[];

    if(req.user.role==='DOSEN'){
      // Dosen lihat tugas sesuai periode dan kelas yang dipilih; fallback ke semua kelas jika belum memilih
      if(req.user.period_id){q+=' AND t.period_id=?';params.push(req.user.period_id);}
      q+=` AND (
        (
          t.class_id IS NULL
          AND t.phase='ISC1'
        ) OR (
          t.class_id = COALESCE(
            (
              SELECT pr.selected_class_id
              FROM profiles pr
              WHERE pr.user_id=?
              LIMIT 1
            ),
            t.class_id
          )
          AND t.class_id IN (
            SELECT cm.class_id FROM class_members cm WHERE cm.user_id=?
          )
        )
      )`;
      params.push(req.user.id,req.user.id);
      q=q.replace('LIMIT 1) AS narasumber_name',"ORDER BY cn.material_id IS NULL DESC, cn.id ASC LIMIT 1) AS narasumber_name");
    } else if(req.user.role==='NARASUMBER'){
      q+=` AND t.period_id=? AND t.phase IN ('OJC','ISC2') AND t.class_id IN (
          SELECT cn2.class_id FROM class_narasumber cn2 WHERE cn2.narasumber_id=?
      )`;
      params.push(req.user.period_id,req.user.id);
    } else {
      // ADMIN - filter opsional
      if(period_id){q+=' AND t.period_id=?';params.push(period_id);}
      if(class_id){q+=' AND t.class_id=?';params.push(class_id);}
    }

    if(phase){q+=' AND t.phase=?';params.push(phase);}
    q+=' ORDER BY t.phase,t.order_no,t.id';
    const[rows]=await db.query(q,params);
    res.json(rows);
  }catch(e){next(e);}
};

exports.getOne=async(req,res,next)=>{
  try{
    const[[task]]=await db.query(
      `SELECT t.*,c.name AS class_name FROM tasks t
       LEFT JOIN classes c ON c.id=t.class_id WHERE t.id=?`,[req.params.id]);
    if(!task) return res.status(404).json({message:'Tugas tidak ditemukan'});

    let questions=[];
    if(task.task_type==='PRETEST'||task.task_type==='POSTTEST'){
      let[q]=await db.query('SELECT * FROM questions WHERE task_id=? ORDER BY order_no',[req.params.id]);
      if(!q.length){
        const[snaps]=await db.query('SELECT order_no,question_text,image_url,option_a,option_b,option_c,option_d,correct_answer FROM task_question_snapshots WHERE task_id=? ORDER BY order_no,id',[req.params.id]);
        if(snaps.length){
          for(const s of snaps){
            await db.query('INSERT INTO questions (task_id,order_no,question_text,image_url,option_a,option_b,option_c,option_d,correct_answer) VALUES (?,?,?,?,?,?,?,?,?)',[req.params.id,s.order_no,s.question_text,s.image_url||null,s.option_a,s.option_b,s.option_c,s.option_d,s.correct_answer]);
          }
          const[hydrated]=await db.query('SELECT * FROM questions WHERE task_id=? ORDER BY order_no',[req.params.id]);
          q=hydrated;
        }
      }
      questions=req.user.role==='DOSEN'?q.map(({correct_answer,...r})=>r):q;
    }

    let instruments=[];
    if(task.task_type==='UPLOAD'){
      const[ins]=await db.query(
        `SELECT i.*,COUNT(ia.id) AS aspect_count
         FROM task_instruments ti
         JOIN instruments i ON i.id=ti.instrument_id
         LEFT JOIN instrument_aspects ia ON ia.instrument_id=i.id
         WHERE ti.task_id=?
         GROUP BY i.id`,[req.params.id]);
      instruments=ins;
    }

    res.json({...task,questions,instruments});
  }catch(e){next(e);}
};

exports.create=async(req,res,next)=>{
  try{
    const{period_id,class_id,material_id,title,description,phase,task_type,assessment_component,order_no,pretest_open,pretest_close,posttest_open,posttest_close,briefing_open,briefing_close,upload_open,upload_close}=req.body;
    if(!period_id||!title||!phase||!task_type)
      return res.status(400).json({message:'period_id, title, phase, task_type wajib'});

    if(phase==='ISC1'&&!['PRETEST','POSTTEST'].includes(task_type))
      return res.status(400).json({message:'ISC1 hanya boleh PRETEST/POSTTEST'});
    if(phase==='ISC2'&&task_type!=='UPLOAD')
      return res.status(400).json({message:'ISC2 hanya boleh task_type UPLOAD'});
    if(phase==='OJC'&&!['UPLOAD','BRIEFING'].includes(task_type))
      return res.status(400).json({message:'OJC boleh task_type UPLOAD atau BRIEFING'});
    if((phase==='OJC'||phase==='ISC2')&&!class_id)
      return res.status(400).json({message:'class_id wajib untuk OJC/ISC2'});

    const component=normalizeAssessmentComponent(assessment_component);
    if(!isValidAssessmentComponent(phase,component))
      return res.status(400).json({message:'Komponen penilaian tidak valid untuk fase ini'});

    const[r]=await db.query(
      'INSERT INTO tasks (period_id,class_id,material_id,title,description,phase,task_type,assessment_component,order_no,pretest_open,pretest_close,posttest_open,posttest_close,briefing_open,briefing_close,upload_open,upload_close) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [period_id,class_id||null,material_id||null,title,description||null,phase,task_type,component,order_no||1,pretest_open||null,pretest_close||null,posttest_open||null,posttest_close||null,briefing_open||null,briefing_close||null,upload_open||null,upload_close||null]);
    res.status(201).json({message:'Tugas dibuat',id:r.insertId});
  }catch(e){next(e);}
};

exports.update=async(req,res,next)=>{
  try{
    const{title,description,phase,task_type,assessment_component,order_no,class_id,material_id,pretest_open,pretest_close,posttest_open,posttest_close,briefing_open,briefing_close,upload_open,upload_close}=req.body;
    if(phase==='ISC1'&&!['PRETEST','POSTTEST'].includes(task_type))
      return res.status(400).json({message:'ISC1 hanya boleh PRETEST/POSTTEST'});
    if(phase==='ISC2'&&task_type!=='UPLOAD')
      return res.status(400).json({message:'ISC2 hanya boleh task_type UPLOAD'});
    if(phase==='OJC'&&!['UPLOAD','BRIEFING'].includes(task_type))
      return res.status(400).json({message:'OJC boleh task_type UPLOAD atau BRIEFING'});
    if((phase==='OJC'||phase==='ISC2')&&!class_id)
      return res.status(400).json({message:'class_id wajib untuk OJC/ISC2'});

    const component=normalizeAssessmentComponent(assessment_component);
    if(!isValidAssessmentComponent(phase,component))
      return res.status(400).json({message:'Komponen penilaian tidak valid untuk fase ini'});

    await db.query(
      'UPDATE tasks SET title=?,description=?,phase=?,task_type=?,assessment_component=?,order_no=?,class_id=?,material_id=?,pretest_open=?,pretest_close=?,posttest_open=?,posttest_close=?,briefing_open=?,briefing_close=?,upload_open=?,upload_close=? WHERE id=?',
      [title,description,phase,task_type,component,order_no||1,class_id||null,material_id||null,pretest_open||null,pretest_close||null,posttest_open||null,posttest_close||null,briefing_open||null,briefing_close||null,upload_open||null,upload_close||null,req.params.id]);
    res.json({message:'Tugas diperbarui'});
  }catch(e){next(e);}
};

exports.remove=async(req,res,next)=>{
  try{
    await db.query('DELETE FROM tasks WHERE id=?',[req.params.id]);
    res.json({message:'Tugas dihapus'});
  }catch(e){next(e);}
};

exports.addQuestion=async(req,res,next)=>{
  try{
    const{question_text,option_a,option_b,option_c,option_d,correct_answer,order_no}=req.body;
    const[[task]]=await db.query('SELECT task_type FROM tasks WHERE id=?',[req.params.id]);
    if(!['PRETEST','POSTTEST'].includes(task?.task_type))
      return res.status(400).json({message:'Soal hanya untuk PRETEST/POSTTEST'});
    const image_url=req.file?`/uploads/${req.file.filename}`:null;
    const[r]=await db.query(
      'INSERT INTO questions (task_id,order_no,question_text,image_url,option_a,option_b,option_c,option_d,correct_answer) VALUES (?,?,?,?,?,?,?,?,?)',
      [req.params.id,order_no||1,question_text,image_url,option_a,option_b,option_c,option_d,correct_answer]);
    res.status(201).json({message:'Soal ditambahkan',id:r.insertId});
  }catch(e){next(e);}
};

exports.updateQuestion=async(req,res,next)=>{
  try{
    const{question_text,option_a,option_b,option_c,option_d,correct_answer,order_no}=req.body;
    const image_url=req.file?`/uploads/${req.file.filename}`:undefined;
    const[[existing]]=await db.query('SELECT image_url FROM questions WHERE id=?',[req.params.qid]);
    const finalImageUrl=image_url===undefined?existing.image_url:image_url;
    await db.query(
      'UPDATE questions SET order_no=?,question_text=?,image_url=?,option_a=?,option_b=?,option_c=?,option_d=?,correct_answer=? WHERE id=?',
      [order_no||1,question_text,finalImageUrl,option_a,option_b,option_c,option_d,correct_answer,req.params.qid]);
    res.json({message:'Soal diperbarui'});
  }catch(e){next(e);}
};

exports.removeQuestion=async(req,res,next)=>{
  try{
    await db.query('DELETE FROM questions WHERE id=?',[req.params.qid]);
    res.json({message:'Soal dihapus'});
  }catch(e){next(e);}
};

exports.linkInstrument=async(req,res,next)=>{
  try{
    await db.query('INSERT IGNORE INTO task_instruments (task_id,instrument_id) VALUES (?,?)',
      [req.params.id,req.body.instrument_id]);
    res.json({message:'Instrumen ditautkan'});
  }catch(e){next(e);}
};

exports.unlinkInstrument=async(req,res,next)=>{
  try{
    await db.query('DELETE FROM task_instruments WHERE task_id=? AND instrument_id=?',
      [req.params.id,req.params.insId]);
    res.json({message:'Instrumen dihapus dari tugas'});
  }catch(e){next(e);}
};

exports.cloneQuestionBank=async(req,res,next)=>{
  try{
    const taskId=req.params.id;
    const{bank_id}=req.body;
    if(!bank_id) return res.status(400).json({message:'bank_id wajib'});

    const[[task]]=await db.query('SELECT id,phase,task_type FROM tasks WHERE id=?',[taskId]);
    if(!task) return res.status(404).json({message:'Tugas tidak ditemukan'});
    if(task.phase!=='ISC1'||!['PRETEST','POSTTEST'].includes(task.task_type)) return res.status(400).json({message:'Clone bank soal hanya untuk tugas ISC1 PRETEST/POSTTEST'});

    const[[bank]]=await db.query('SELECT id FROM question_banks WHERE id=?',[bank_id]);
    if(!bank) return res.status(404).json({message:'Bank soal tidak ditemukan'});
    const[items]=await db.query('SELECT * FROM question_bank_items WHERE bank_id=? ORDER BY order_no,id',[bank_id]);

    await db.query('DELETE FROM task_question_snapshots WHERE task_id=?',[taskId]);
    for(const it of items){
      await db.query(
        'INSERT INTO task_question_snapshots (task_id,source_type,source_bank_id,order_no,question_text,image_url,option_a,option_b,option_c,option_d,correct_answer) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [taskId,'bank_snapshot',bank_id,it.order_no,it.question_text,it.image_url||null,it.option_a,it.option_b,it.option_c,it.option_d,it.correct_answer]
      );
    }

    res.json({message:'Bank soal berhasil di-clone ke snapshot tugas',count:items.length});
  }catch(e){next(e);}
};

exports.cloneInstrumentBank=async(req,res,next)=>{
  try{
    const taskId=req.params.id;
    const{bank_id}=req.body;
    if(!bank_id) return res.status(400).json({message:'bank_id wajib'});

    const[[task]]=await db.query('SELECT id,phase,task_type FROM tasks WHERE id=?',[taskId]);
    if(!task) return res.status(404).json({message:'Tugas tidak ditemukan'});
    if(!['OJC','ISC2'].includes(task.phase)||task.task_type!=='UPLOAD') return res.status(400).json({message:'Clone bank instrumen hanya untuk tugas OJC/ISC2 UPLOAD'});

    const[[bank]]=await db.query('SELECT * FROM instrument_banks WHERE id=?',[bank_id]);
    if(!bank) return res.status(404).json({message:'Bank instrumen tidak ditemukan'});
    const[aspects]=await db.query('SELECT * FROM instrument_bank_aspects WHERE bank_id=? ORDER BY order_no,id',[bank_id]);

    await db.query('DELETE tias FROM task_instrument_snapshot_aspects tias JOIN task_instrument_snapshots tis ON tis.id=tias.snapshot_id WHERE tis.task_id=?',[taskId]);
    await db.query('DELETE FROM task_instrument_snapshots WHERE task_id=?',[taskId]);

    const[r]=await db.query('INSERT INTO task_instrument_snapshots (task_id,source_type,source_bank_id,title,description,max_score) VALUES (?,?,?,?,?,?)',[taskId,'bank_snapshot',bank_id,bank.title,bank.description||null,bank.max_score||90]);
    const snapId=r.insertId;

    for(const a of aspects){
      await db.query('INSERT INTO task_instrument_snapshot_aspects (snapshot_id,order_no,aspect_name,score_3,score_2,score_1) VALUES (?,?,?,?,?,?)',[snapId,a.order_no,a.aspect_name,a.score_3||'Baik',a.score_2||'Cukup',a.score_1||'Kurang']);
    }

    res.json({message:'Bank instrumen berhasil di-clone ke snapshot tugas',count:aspects.length});
  }catch(e){next(e);}
};

exports.getSnapshots=async(req,res,next)=>{
  try{
    const taskId=req.params.id;
    const[qsnaps]=await db.query('SELECT * FROM task_question_snapshots WHERE task_id=? ORDER BY order_no,id',[taskId]);
    const[isnaps]=await db.query('SELECT * FROM task_instrument_snapshots WHERE task_id=? ORDER BY id DESC LIMIT 1',[taskId]);
    let instrument_snapshot=null;
    if(isnaps.length){
      const snap=isnaps[0];
      const[aspects]=await db.query('SELECT * FROM task_instrument_snapshot_aspects WHERE snapshot_id=? ORDER BY order_no,id',[snap.id]);
      instrument_snapshot={...snap,aspects};
    }
    res.json({question_snapshots:qsnaps,instrument_snapshot});
  }catch(e){next(e);}
};

exports.syncLegacyFromSnapshot=async(req,res,next)=>{
  try{
    const taskId=req.params.id;
    const[[task]]=await db.query('SELECT id,task_type FROM tasks WHERE id=?',[taskId]);
    if(!task) return res.status(404).json({message:'Tugas tidak ditemukan'});

    if(['PRETEST','POSTTEST'].includes(task.task_type)){
      const[snaps]=await db.query('SELECT * FROM task_question_snapshots WHERE task_id=? ORDER BY order_no,id',[taskId]);
      await db.query('DELETE FROM questions WHERE task_id=?',[taskId]);
      for(const s of snaps){
        await db.query('INSERT INTO questions (task_id,order_no,question_text,image_url,option_a,option_b,option_c,option_d,correct_answer) VALUES (?,?,?,?,?,?,?,?,?)',[taskId,s.order_no,s.question_text,s.image_url||null,s.option_a,s.option_b,s.option_c,s.option_d,s.correct_answer]);
      }
    }

    res.json({message:'Snapshot disinkronkan ke data legacy'});
  }catch(e){next(e);}
};
