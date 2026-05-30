const db=require('../config/db');

const validPhase=p=>['OJC','ISC2'].includes(String(p||''));

const checkTask=async(taskId)=>{
  const [[task]]=await db.query(
    `SELECT t.id,t.period_id,t.class_id,t.phase,t.title
     FROM tasks t
     WHERE t.id=? AND t.phase IN ('OJC','ISC2')`,
    [taskId]
  );
  return task||null;
};

const checkClasses=async(classIds,periodId,phase)=>{
  if(!classIds.length) return [];
  const ph=classIds.map(()=>'?').join(',');
  const [rows]=await db.query(
    `SELECT id,name,period_id,phase
     FROM classes
     WHERE id IN (${ph}) AND period_id=? AND phase=?`,
    [...classIds,periodId,phase]
  );
  return rows;
};

exports.getAll=async(req,res,next)=>{
  try{
    const {period_id,phase,class_id}=req.query;
    let q=`SELECT ss.id,ss.period_id,ss.task_id,ss.phase,ss.slot_date,ss.start_time,ss.end_time,ss.module_title,ss.jp,ss.notes,
                  t.title AS task_title,
                  GROUP_CONCAT(DISTINCT c.id ORDER BY c.id SEPARATOR ',') AS class_ids,
                  GROUP_CONCAT(DISTINCT c.name ORDER BY c.name SEPARATOR ', ') AS class_names
           FROM schedule_slots ss
           LEFT JOIN tasks t ON t.id=ss.task_id
           LEFT JOIN schedule_slot_classes ssc ON ssc.schedule_slot_id=ss.id
           LEFT JOIN classes c ON c.id=ssc.class_id
           WHERE 1=1`;
    const params=[];
    if(period_id){q+=' AND ss.period_id=?';params.push(Number(period_id));}
    if(phase){q+=' AND ss.phase=?';params.push(phase);}
    if(class_id){q+=' AND ssc.class_id=?';params.push(Number(class_id));}
    q+=' GROUP BY ss.id ORDER BY ss.slot_date,ss.start_time,ss.id';
    const [rows]=await db.query(q,params);
    res.json(rows.map(r=>({
      ...r,
      class_ids:r.class_ids?String(r.class_ids).split(',').map(Number):[]
    })));
  }catch(e){next(e);}
};

exports.create=async(req,res,next)=>{
  try{
    const {period_id,task_id,phase,slot_date,start_time,end_time,module_title,jp,notes,class_ids}=req.body;
    const pid=Number(period_id);
    const tid=Number(task_id);
    const clsIds=Array.isArray(class_ids)?[...new Set(class_ids.map(Number).filter(Boolean))]:[];

    if(!pid||!tid||!validPhase(phase)||!slot_date||!start_time||!end_time||!module_title||!clsIds.length)
      return res.status(400).json({message:'period_id, task_id, phase, slot_date, start_time, end_time, module_title, class_ids wajib'});
    if(start_time>=end_time)
      return res.status(400).json({message:'start_time harus lebih kecil dari end_time'});

    const task=await checkTask(tid);
    if(!task) return res.status(400).json({message:'Task OJC/ISC2 tidak valid'});
    if(Number(task.period_id)!==pid) return res.status(400).json({message:'Task tidak sesuai periode'});
    if(task.phase!==phase) return res.status(400).json({message:'Phase task tidak sesuai'});

    const classes=await checkClasses(clsIds,pid,phase);
    if(classes.length!==clsIds.length) return res.status(400).json({message:'Ada class_id yang tidak valid untuk periode/fase ini'});

    const conn=await db.getConnection();
    try{
      await conn.beginTransaction();
      const [ins]=await conn.query(
        `INSERT INTO schedule_slots (period_id,task_id,phase,slot_date,start_time,end_time,module_title,jp,notes)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [pid,tid,phase,slot_date,start_time,end_time,module_title,jp||null,notes||null]
      );
      for(const cid of clsIds){
        await conn.query('INSERT INTO schedule_slot_classes (schedule_slot_id,class_id) VALUES (?,?)',[ins.insertId,cid]);
      }
      await conn.commit();
      res.status(201).json({message:'Jadwal sesi dibuat',id:ins.insertId});
    }catch(e){
      await conn.rollback();
      throw e;
    }finally{conn.release();}
  }catch(e){next(e);}
};

exports.update=async(req,res,next)=>{
  try{
    const slotId=Number(req.params.id);
    const {period_id,task_id,phase,slot_date,start_time,end_time,module_title,jp,notes,class_ids}=req.body;
    const pid=Number(period_id);
    const tid=Number(task_id);
    const clsIds=Array.isArray(class_ids)?[...new Set(class_ids.map(Number).filter(Boolean))]:[];

    if(!slotId||!pid||!tid||!validPhase(phase)||!slot_date||!start_time||!end_time||!module_title||!clsIds.length)
      return res.status(400).json({message:'Data update jadwal tidak lengkap'});
    if(start_time>=end_time)
      return res.status(400).json({message:'start_time harus lebih kecil dari end_time'});

    const [[exists]]=await db.query('SELECT id FROM schedule_slots WHERE id=?',[slotId]);
    if(!exists) return res.status(404).json({message:'Jadwal sesi tidak ditemukan'});

    const task=await checkTask(tid);
    if(!task) return res.status(400).json({message:'Task OJC/ISC2 tidak valid'});
    if(Number(task.period_id)!==pid) return res.status(400).json({message:'Task tidak sesuai periode'});
    if(task.phase!==phase) return res.status(400).json({message:'Phase task tidak sesuai'});

    const classes=await checkClasses(clsIds,pid,phase);
    if(classes.length!==clsIds.length) return res.status(400).json({message:'Ada class_id yang tidak valid untuk periode/fase ini'});

    const conn=await db.getConnection();
    try{
      await conn.beginTransaction();
      await conn.query(
        `UPDATE schedule_slots
         SET period_id=?,task_id=?,phase=?,slot_date=?,start_time=?,end_time=?,module_title=?,jp=?,notes=?
         WHERE id=?`,
        [pid,tid,phase,slot_date,start_time,end_time,module_title,jp||null,notes||null,slotId]
      );
      await conn.query('DELETE FROM schedule_slot_classes WHERE schedule_slot_id=?',[slotId]);
      for(const cid of clsIds){
        await conn.query('INSERT INTO schedule_slot_classes (schedule_slot_id,class_id) VALUES (?,?)',[slotId,cid]);
      }
      await conn.commit();
      res.json({message:'Jadwal sesi diperbarui'});
    }catch(e){
      await conn.rollback();
      throw e;
    }finally{conn.release();}
  }catch(e){next(e);}
};

exports.remove=async(req,res,next)=>{
  try{
    const slotId=Number(req.params.id);
    if(!slotId) return res.status(400).json({message:'ID tidak valid'});
    const [r]=await db.query('DELETE FROM schedule_slots WHERE id=?',[slotId]);
    if(!r.affectedRows) return res.status(404).json({message:'Jadwal sesi tidak ditemukan'});
    res.json({message:'Jadwal sesi dihapus'});
  }catch(e){next(e);}
};
