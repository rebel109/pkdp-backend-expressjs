const fs=require('fs');
const db=require('../config/db');
const puppeteer=require('puppeteer');

let schemaReadyPromise=null;

const ensureSchema=async()=>{
  if(!schemaReadyPromise){
    schemaReadyPromise=(async()=>{
      await db.query(`
        CREATE TABLE IF NOT EXISTS task_attendance_settings (
          task_id INT PRIMARY KEY,
          is_open_override TINYINT(1) NOT NULL DEFAULT 0,
          updated_by INT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_task_attendance_settings_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
          CONSTRAINT fk_task_attendance_settings_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS task_attendance_records (
          id INT AUTO_INCREMENT PRIMARY KEY,
          task_id INT NOT NULL,
          user_id INT NOT NULL,
          attendance_role ENUM('DOSEN','NARASUMBER') NOT NULL,
          attended_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_task_attendance_user_role (task_id,user_id,attendance_role),
          CONSTRAINT fk_task_attendance_records_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
          CONSTRAINT fk_task_attendance_records_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    })().catch(err=>{
      schemaReadyPromise=null;
      throw err;
    });
  }
  return schemaReadyPromise;
};

const toIsoOrNull=value=>value?new Date(value).toISOString():null;

const getLocalBrowserPath=()=>{
  const candidates=[
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);
  return candidates.find(file=>fs.existsSync(file));
};

const getAttendanceWindow=task=>{
  if(task.task_type==='PRETEST') return {openAt:task.pretest_open?new Date(task.pretest_open).getTime():null,closeAt:task.pretest_close?new Date(task.pretest_close).getTime():null};
  if(task.task_type==='POSTTEST') return {openAt:task.posttest_open?new Date(task.posttest_open).getTime():null,closeAt:task.posttest_close?new Date(task.posttest_close).getTime():null};
  if(task.task_type==='BRIEFING') return {openAt:task.briefing_open?new Date(task.briefing_open).getTime():null,closeAt:task.briefing_close?new Date(task.briefing_close).getTime():null};
  return {openAt:task.upload_open?new Date(task.upload_open).getTime():null,closeAt:task.upload_close?new Date(task.upload_close).getTime():null};
};

const isAttendanceOpen=task=>{
  const now=Date.now();
  const {openAt,closeAt}=getAttendanceWindow(task);
  const withinWindow=(openAt===null||now>=openAt)&&(closeAt===null||now<=closeAt);
  return Boolean(withinWindow||Number(task.is_open_override||0)===1);
};

const buildStatus=task=>{
  const now=Date.now();
  const {openAt,closeAt}=getAttendanceWindow(task);
  const overrideOpen=Number(task.is_open_override||0)===1;
  const withinWindow=(openAt===null||now>=openAt)&&(closeAt===null||now<=closeAt);

  if(task.attended_at) return {label:'Sudah hadir',canAttend:false};
  if(overrideOpen) return {label:'Dibuka admin',canAttend:true};
  if(openAt!==null&&now<openAt) return {label:'Belum dibuka',canAttend:false};
  if(closeAt!==null&&now>closeAt) return {label:'Sudah ditutup',canAttend:false};
  if(withinWindow) return {label:'Absensi dibuka',canAttend:true};
  return {label:'Tidak tersedia',canAttend:false};
};

const getBadgeLabel=task=>{
  if(task.task_type==='PRETEST') return 'Pretest';
  if(task.task_type==='POSTTEST') return 'Posttest';
  if(task.task_type==='BRIEFING') return 'Briefing';
  return task.phase;
};

const normalizeTitle=value=>String(value||'').trim().toLowerCase();
const buildMaterialKey=task=>{
  if(task.phase==='ISC1') return `${task.class_id||'global'}::${task.phase}::${task.task_type}::${task.id}`;
  return `${task.class_id||''}::${task.phase||''}::${task.assessment_component||''}::${task.material_id||normalizeTitle(task.title)}`;
};

const mergeTaskWindow=(target,source)=>{
  for(const key of ['pretest_open','pretest_close','posttest_open','posttest_close','upload_open','upload_close']){
    if(!target[key]&&source[key]) target[key]=source[key];
  }
  target.is_open_override=Number(target.is_open_override||0)===1||Number(source.is_open_override||0)===1?1:0;
  if(!target.attended_at&&source.attended_at) target.attended_at=source.attended_at;
  else if(target.attended_at&&source.attended_at&&new Date(source.attended_at)<new Date(target.attended_at)) target.attended_at=source.attended_at;
};

const mergeAttendanceCounts=(target,source)=>{
  target.peserta_hadir=Number(target.peserta_hadir||0)+Number(source.peserta_hadir||0);
  target.narasumber_hadir=Number(target.narasumber_hadir||0)+Number(source.narasumber_hadir||0);
};

const groupAttendanceItems=(items,{mergeCounts=false}={})=>{
  const map=new Map();
  for(const item of items){
    const key=buildMaterialKey(item);
    const existing=map.get(key);
    if(!existing){
      map.set(key,{...item,task_ids:[item.id]});
      continue;
    }

    existing.task_ids.push(item.id);
    const itemComesFirst=(item.order_no||9999)<(existing.order_no||9999)||((item.order_no||9999)===(existing.order_no||9999)&&item.id<existing.id);
    const attendedAt=existing.attended_at;
    const pesertaHadir=existing.peserta_hadir;
    const narasumberHadir=existing.narasumber_hadir;
    mergeTaskWindow(existing,item);
    if(mergeCounts) mergeAttendanceCounts(existing,item);
    if(itemComesFirst){
      for(const [field,value] of Object.entries(item)) existing[field]=value;
      existing.task_ids=[...new Set([item.id,...existing.task_ids])];
      existing.attended_at=attendedAt||item.attended_at||null;
      existing.peserta_hadir=pesertaHadir;
      existing.narasumber_hadir=narasumberHadir;
      mergeTaskWindow(existing,item);
      if(mergeCounts) mergeAttendanceCounts(existing,item);
    }
  }
  return [...map.values()];
};

const baseTaskSelect=`
  SELECT t.id,t.title,t.phase,t.class_id,t.material_id,t.task_type,t.assessment_component,t.order_no,
         t.pretest_open,t.pretest_close,t.posttest_open,t.posttest_close,t.briefing_open,t.briefing_close,t.upload_open,t.upload_close,
         c.name AS class_name,co.cohort_no,
         tas.is_open_override,
         tar.attended_at,
         COALESCE(
           (SELECT u.name FROM class_narasumber cn JOIN users u ON u.id=cn.narasumber_id
            WHERE cn.class_id=t.class_id AND cn.material_id=t.id
            ORDER BY cn.id ASC LIMIT 1),
           (SELECT u.name FROM class_narasumber cn JOIN users u ON u.id=cn.narasumber_id
            WHERE cn.class_id=t.class_id AND cn.material_id IS NULL
            ORDER BY cn.id ASC LIMIT 1)
         ) AS narasumber_name
  FROM tasks t
  LEFT JOIN classes c ON c.id=t.class_id
  LEFT JOIN cohorts co ON co.id=c.cohort_id
  LEFT JOIN task_attendance_settings tas ON tas.task_id=t.id
  LEFT JOIN task_attendance_records tar ON tar.task_id=t.id AND tar.user_id=? AND tar.attendance_role=?
`;

exports.getMyAttendance=async(req,res,next)=>{
  try{
    await ensureSchema();
    if(!['DOSEN','NARASUMBER'].includes(req.user.role)) return res.json([]);

    let rows=[];
    if(req.user.role==='DOSEN'){
      const[items]=await db.query(
        `${baseTaskSelect}
         WHERE (
             (
               t.phase='ISC1'
               AND t.task_type IN ('PRETEST','POSTTEST')
               AND (
                 t.class_id IS NULL
                 OR (
                   t.class_id = COALESCE(
                     (
                       SELECT pr.selected_class_id
                       FROM profiles pr
                       WHERE pr.user_id=?
                       LIMIT 1
                     ),
                     t.class_id
                   )
                   AND t.class_id IN (SELECT class_id FROM class_members WHERE user_id=?)
                 )
               )
             )
             OR
             (
               (t.phase IN ('OJC','ISC2') AND t.task_type='UPLOAD')
               OR (t.phase='OJC' AND t.task_type='BRIEFING')
             ) AND t.class_id IN (SELECT class_id FROM class_members WHERE user_id=?)
           )
         ORDER BY t.phase,t.order_no,t.id`,
        [req.user.id,'DOSEN',req.user.id,req.user.id,req.user.id]
      );
      rows=groupAttendanceItems(items).map(item=>{
        const status=buildStatus(item);
        return {
          task_id:item.id,
          task_ids:item.task_ids,
          role:'DOSEN',
          nama_materi:item.title,
          nama_narasumber:item.phase==='ISC1'?(item.task_type==='PRETEST'?'Pretest':'Posttest'):(item.narasumber_name||'—'),
          class_name:item.class_name,
          cohort_no:item.cohort_no,
          task_type:item.task_type,
          phase:item.phase,
          badge_label:getBadgeLabel(item),
          is_open:isAttendanceOpen(item),
          attended_at:toIsoOrNull(item.attended_at),
          status_label:status.label,
          can_attend:status.canAttend
        };
      });
    }else{
      const[items]=await db.query(
        `${baseTaskSelect}
         WHERE t.period_id=?
           AND t.class_id IN (SELECT class_id FROM class_narasumber WHERE narasumber_id=?)
           AND (
             (t.phase IN ('OJC','ISC2') AND t.task_type='UPLOAD')
             OR (t.phase='OJC' AND t.task_type='BRIEFING')
           )
           AND EXISTS (
             SELECT 1 FROM class_narasumber cnx
             WHERE cnx.class_id=t.class_id AND cnx.narasumber_id=?
             AND (
               cnx.material_id IS NULL
               OR cnx.material_id=t.id
               OR (t.material_id IS NOT NULL AND cnx.material_id=t.material_id)
               OR cnx.material_id IN (
                 SELECT tx.id FROM tasks tx
                 WHERE tx.class_id=t.class_id
                   AND tx.phase=t.phase
                   AND tx.task_type=t.task_type
                   AND tx.assessment_component=t.assessment_component
                   AND LOWER(TRIM(tx.title))=LOWER(TRIM(t.title))
               )
             )
           )
         ORDER BY t.phase,t.order_no,t.id`,
        [req.user.id,'NARASUMBER',req.user.period_id,req.user.id,req.user.id]
      );
      rows=groupAttendanceItems(items).map(item=>{
        const status=buildStatus(item);
        return {
          task_id:item.id,
          task_ids:item.task_ids,
          role:'NARASUMBER',
          nama_kelas:item.class_name,
          nama_materi:item.title,
          cohort_no:item.cohort_no,
          task_type:item.task_type,
          phase:item.phase,
          badge_label:getBadgeLabel(item),
          is_open:isAttendanceOpen(item),
          attended_at:toIsoOrNull(item.attended_at),
          status_label:status.label,
          can_attend:status.canAttend
        };
      });
    }

    res.json(rows);
  }catch(e){next(e);}
};

exports.markAttendance=async(req,res,next)=>{
  try{
    await ensureSchema();
    const role=req.user.role;
    if(!['DOSEN','NARASUMBER'].includes(role)) return res.status(403).json({message:'Akses ditolak'});

    const taskId=Number(req.params.taskId);
    if(!Number.isInteger(taskId)) return res.status(400).json({message:'Task tidak valid'});

    const accessWhere=role==='DOSEN'
      ? `(
           (
             t.phase='ISC1'
             AND t.task_type IN ('PRETEST','POSTTEST')
             AND (
               t.class_id IS NULL
               OR (
                 t.class_id = COALESCE(
                   (
                     SELECT pr.selected_class_id
                     FROM profiles pr
                     WHERE pr.user_id=?
                     LIMIT 1
                   ),
                   t.class_id
                 )
                 AND t.class_id IN (SELECT class_id FROM class_members WHERE user_id=?)
               )
             )
           )
           OR
           (
             t.phase IN ('OJC','ISC2')
             AND t.task_type='UPLOAD'
             AND t.class_id IN (SELECT class_id FROM class_members WHERE user_id=?)
           )
           OR
           (
             t.phase='OJC'
             AND t.task_type='BRIEFING'
             AND t.class_id IN (SELECT class_id FROM class_members WHERE user_id=?)
           )
         )`
      : `(
           (t.phase IN ('OJC','ISC2') AND t.task_type='UPLOAD'
            AND t.period_id=?
            AND t.class_id IN (SELECT class_id FROM class_narasumber WHERE narasumber_id=?)
            AND EXISTS (
              SELECT 1 FROM class_narasumber cnx
              WHERE cnx.class_id=t.class_id AND cnx.narasumber_id=?
                AND (
                  cnx.material_id IS NULL
                  OR cnx.material_id=t.id
                  OR (t.material_id IS NOT NULL AND cnx.material_id=t.material_id)
                  OR cnx.material_id IN (
                    SELECT tx.id FROM tasks tx
                    WHERE tx.class_id=t.class_id
                      AND tx.phase=t.phase
                      AND tx.task_type=t.task_type
                      AND tx.assessment_component=t.assessment_component
                      AND LOWER(TRIM(tx.title))=LOWER(TRIM(t.title))
                  )
                )
            ))
           OR
           (t.phase='OJC' AND t.task_type='BRIEFING'
            AND t.period_id=?
            AND t.class_id IN (SELECT class_id FROM class_narasumber WHERE narasumber_id=?))
         )`;
    const accessParams=role==='DOSEN'?[req.user.id,req.user.id,req.user.id,req.user.id]:[req.user.period_id,req.user.id,req.user.id,req.user.period_id,req.user.id];

    const[[task]]=await db.query(
      `SELECT t.id,t.title,t.phase,t.class_id,t.task_type,
              t.pretest_open,t.pretest_close,t.posttest_open,t.posttest_close,t.briefing_open,t.briefing_close,t.upload_open,t.upload_close,
              tas.is_open_override
       FROM tasks t
       LEFT JOIN task_attendance_settings tas ON tas.task_id=t.id
       WHERE t.id=? AND ${accessWhere}`,
      [taskId,...accessParams]
    );
    if(!task) return res.status(404).json({message:'Data absensi tidak ditemukan'});
    if(!isAttendanceOpen(task)) return res.status(400).json({message:'Absensi sudah ditutup'});

    await db.query(
      `INSERT INTO task_attendance_records (task_id,user_id,attendance_role)
       VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE attended_at=attended_at`,
      [taskId,req.user.id,role]
    );

    res.json({message:'Absensi berhasil disimpan'});
  }catch(e){next(e);}
};

const buildAdminRecapData=async(query={})=>{
  await ensureSchema();
  const{period_id,class_id,phase,role}=query;
  let taskWhere=`WHERE ((t.phase='ISC1' AND t.task_type IN ('PRETEST','POSTTEST')) OR (t.phase IN ('OJC','ISC2') AND t.task_type='UPLOAD') OR (t.phase='OJC' AND t.task_type='BRIEFING'))`;
  const taskParams=[];

  let selectedClass=null;
  if(class_id){
    const[[cls]]=await db.query('SELECT id,phase FROM classes WHERE id=? LIMIT 1',[class_id]);
    selectedClass=cls||null;
  }

  if(period_id){
    taskWhere+=' AND t.period_id=?';
    taskParams.push(period_id);
  }

  if(class_id){
    if(selectedClass&&selectedClass.phase!=='ISC1'){
      taskWhere+=` AND (
        t.class_id=?
        OR (
          t.phase='ISC1'
          AND EXISTS (
            SELECT 1
            FROM class_members cm2
            JOIN profiles pr2 ON pr2.user_id=cm2.user_id
            WHERE cm2.class_id=? AND pr2.selected_class_id=t.class_id
          )
        )
        OR (
          t.phase='OJC'
          AND t.task_type='BRIEFING'
          AND t.class_id=?
        )
      )`;
      taskParams.push(class_id,class_id,class_id);
    }else{
      taskWhere+=' AND t.class_id=?';
      taskParams.push(class_id);
    }
  }

  if(phase){
    taskWhere+=' AND t.phase=?';
    taskParams.push(phase);
  }

  const[tasks]=await db.query(
    `SELECT t.id,t.title,t.phase,t.class_id,t.material_id,t.task_type,t.assessment_component,t.order_no,
            c.name AS class_name,c.phase AS class_phase,co.cohort_no,
            t.pretest_open,t.pretest_close,t.posttest_open,t.posttest_close,t.upload_open,t.upload_close,
            tas.is_open_override,
            COUNT(DISTINCT CASE WHEN tar.attendance_role='DOSEN' THEN tar.user_id END) AS peserta_hadir,
            COUNT(DISTINCT CASE WHEN tar.attendance_role='NARASUMBER' THEN tar.user_id END) AS narasumber_hadir
     FROM tasks t
     LEFT JOIN classes c ON c.id=t.class_id
     LEFT JOIN cohorts co ON co.id=c.cohort_id
     LEFT JOIN task_attendance_settings tas ON tas.task_id=t.id
     LEFT JOIN task_attendance_records tar ON tar.task_id=t.id
     ${taskWhere}
     GROUP BY t.id,c.name,c.phase,co.cohort_no,tas.is_open_override
     ORDER BY FIELD(t.phase,'ISC1','OJC','ISC2'),t.order_no,t.id`,
    taskParams
  );

  const taskIds=tasks.map(task=>task.id);
  const taskGroupMap=new Map();
  tasks.forEach(task=>{
    const key=buildMaterialKey(task);
    if(!taskGroupMap.has(key)) taskGroupMap.set(key,new Set());
    taskGroupMap.get(key).add(task.id);
  });
  const taskGroupIdsByTaskId=new Map();
  tasks.forEach(task=>{
    taskGroupIdsByTaskId.set(task.id,taskGroupMap.get(buildMaterialKey(task))||new Set([task.id]));
  });

  let participantRows=[];
  if(role!=='NARASUMBER'&&period_id){
    let participantQ=`SELECT cm.user_id,u.name,
                             cm.class_id AS member_class_id,member_class.name AS member_class_name,member_class.phase AS member_class_phase,
                             selected_class.id AS selected_class_id,selected_class.name AS selected_class_name,selected_class.phase AS selected_class_phase,
                             participant_cohort.cohort_no
                      FROM class_members cm
                      JOIN users u ON u.id=cm.user_id AND u.role='DOSEN' AND u.payment_status='verified' AND u.period_id=?
                      JOIN classes member_class ON member_class.id=cm.class_id
                      LEFT JOIN profiles pr ON pr.user_id=u.id
                      LEFT JOIN classes selected_class ON selected_class.id=pr.selected_class_id
                      LEFT JOIN cohorts participant_cohort ON participant_cohort.id=COALESCE(member_class.cohort_id,selected_class.cohort_id)
                      WHERE member_class.period_id=?`;
    const participantParams=[period_id,period_id];
    if(class_id){participantQ+=' AND cm.class_id=?';participantParams.push(class_id);}
    if(phase&&phase!=='ISC1'){participantQ+=' AND member_class.phase=?';participantParams.push(phase);}
    participantQ+=' ORDER BY u.name';
    const[participantMemberships]=await db.query(participantQ,participantParams);

    const participantMap=new Map();
    participantMemberships.forEach(row=>{
      if(!participantMap.has(row.user_id)){
        participantMap.set(row.user_id,{
          user_id:row.user_id,
          name:row.name,
          cohort_no:row.cohort_no,
          class_id:row.member_class_id,
          class_name:row.member_class_name,
          class_phase:row.member_class_phase,
          selected_class_id:row.selected_class_id,
          selected_class_name:row.selected_class_name,
          selected_class_phase:row.selected_class_phase,
          classIds:new Set()
        });
      }
      const participant=participantMap.get(row.user_id);
      participant.classIds.add(row.member_class_id);
      if((!participant.cohort_no&&participant.cohort_no!==0)&&row.cohort_no!=null) participant.cohort_no=row.cohort_no;
      if(!participant.class_name&&row.member_class_name){
        participant.class_id=row.member_class_id;
        participant.class_name=row.member_class_name;
        participant.class_phase=row.member_class_phase;
      }
      if(!participant.selected_class_name&&row.selected_class_name){
        participant.selected_class_id=row.selected_class_id;
        participant.selected_class_name=row.selected_class_name;
        participant.selected_class_phase=row.selected_class_phase;
      }
    });

    participantRows=[...participantMap.values()].flatMap(participant=>
      tasks.filter(task=>task.phase==='ISC1'||participant.classIds.has(task.class_id)).map(task=>({
        id:null,
        user_id:participant.user_id,
        task_id:task.id,
        role:'DOSEN',
        name:participant.name,
        cohort_no:participant.cohort_no,
        class_id:task.class_id||participant.class_id,
        class_name:task.class_name||participant.class_name,
        class_phase:task.class_phase||participant.class_phase,
        selected_class_id:participant.selected_class_id,
        selected_class_name:participant.selected_class_name,
        selected_class_phase:participant.selected_class_phase,
        material_name:task.title,
        task_type:task.task_type,
        phase:task.phase,
        attended_at:null
      }))
    );
  }

  let narasumberRows=[];
  if(role!=='DOSEN'&&period_id){
    let assignQ=`SELECT DISTINCT cn.narasumber_id AS user_id,u.name,cn.class_id,cn.material_id,
                        c.name AS class_name,c.phase AS class_phase,co.cohort_no
                 FROM class_narasumber cn
                 JOIN users u ON u.id=cn.narasumber_id AND u.role='NARASUMBER'
                 JOIN classes c ON c.id=cn.class_id
                 LEFT JOIN cohorts co ON co.id=c.cohort_id
                 WHERE c.period_id=?`;
    const assignParams=[period_id];
    if(class_id){assignQ+=' AND cn.class_id=?';assignParams.push(class_id);}
    if(phase&&phase!=='ISC1'){assignQ+=' AND c.phase=?';assignParams.push(phase);}
    assignQ+=' ORDER BY u.name,c.name';
    const[assignments]=await db.query(assignQ,assignParams);

    narasumberRows=assignments.flatMap(assignment=>
      tasks.filter(task=>{
        if(task.class_id!==assignment.class_id) return false;
        if(task.phase==='ISC1') return false;
        const taskGroupIds=taskGroupIdsByTaskId.get(task.id)||new Set([task.id]);
        return assignment.material_id==null||assignment.material_id===task.id||assignment.material_id===task.material_id||taskGroupIds.has(assignment.material_id);
      }).map(task=>({
        id:null,
        user_id:assignment.user_id,
        task_id:task.id,
        role:'NARASUMBER',
        name:assignment.name,
        cohort_no:assignment.cohort_no,
        class_id:task.class_id,
        class_name:task.class_name,
        class_phase:task.class_phase,
        selected_class_id:null,
        selected_class_name:null,
        selected_class_phase:null,
        material_name:task.title,
        task_type:task.task_type,
        phase:task.phase,
        attended_at:null
      }))
    );
  }

  const allRows=[...participantRows,...narasumberRows];
  const userIds=[...new Set(allRows.map(row=>row.user_id))];
  let attendanceRows=[];
  if(taskIds.length&&userIds.length){
    const taskPlaceholders=taskIds.map(()=>'?').join(',');
    const userPlaceholders=userIds.map(()=>'?').join(',');
    const[aRows]=await db.query(
      `SELECT id,task_id,user_id,attendance_role,attended_at
       FROM task_attendance_records
       WHERE task_id IN (${taskPlaceholders}) AND user_id IN (${userPlaceholders})`,
      [...taskIds,...userIds]
    );
    attendanceRows=aRows;
  }

  const attendanceMap=new Map();
  attendanceRows.forEach(row=>{
    attendanceMap.set(`${row.attendance_role}-${row.user_id}-${row.task_id}`,row);
  });

  const rows=allRows.map(row=>{
    const attendance=attendanceMap.get(`${row.role}-${row.user_id}-${row.task_id}`);
    return{
      ...row,
      id:attendance?.id||null,
      attended_at:toIsoOrNull(attendance?.attended_at)||null
    };
  }).sort((a,b)=>(Number(a.cohort_no)||9999)-(Number(b.cohort_no)||9999)||String(a.name||'').localeCompare(String(b.name||''),'id-ID')||String(a.role||'').localeCompare(String(b.role||''),'id-ID')||String(a.phase||'').localeCompare(String(b.phase||''),'id-ID')||String(a.material_name||'').localeCompare(String(b.material_name||''),'id-ID'));

  return {
    rows,
    tasks:groupAttendanceItems(tasks,{mergeCounts:true}).map(task=>({
      task_id:task.id,
      task_ids:task.task_ids,
      material_name:task.title,
      task_type:task.task_type,
      phase:task.phase,
      class_name:task.class_name,
      cohort_no:task.cohort_no,
      pretest_open:toIsoOrNull(task.pretest_open),
      pretest_close:toIsoOrNull(task.pretest_close),
      posttest_open:toIsoOrNull(task.posttest_open),
      posttest_close:toIsoOrNull(task.posttest_close),
      upload_open:toIsoOrNull(task.upload_open),
      upload_close:toIsoOrNull(task.upload_close),
      is_open_override:Boolean(task.is_open_override),
      is_open:isAttendanceOpen(task),
      peserta_hadir:Number(task.peserta_hadir||0),
      narasumber_hadir:Number(task.narasumber_hadir||0)
    }))
  };
};

exports.getAdminRecap=async(req,res,next)=>{
  try{
    res.json(await buildAdminRecapData(req.query));
  }catch(e){next(e);}
};

const formatDateTime=value=>value?new Date(value).toLocaleString('id-ID',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const escapeHtml=value=>String(value??'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
const roleLabel=role=>role==='DOSEN'?'Peserta':role==='NARASUMBER'?'Narasumber':role||'—';
const taskLabel=task=>`${task.phase?`[${task.phase}] `:''}${task.material_name||'—'}`;
const classLabel=(className,classPhase)=>className?`${className}${classPhase?` — ${classPhase}`:''}`:'—';

const buildAttendanceSummary=(rows,tasks)=>{
  const grouped=new Map();
  for(const row of rows){
    const key=`${row.role}-${row.user_id}`;
    if(!grouped.has(key)){
      grouped.set(key,{
        key,
        user_id:row.user_id,
        role:row.role,
        name:row.name,
        cohort_no:row.cohort_no,
        class_name:row.class_name,
        class_phase:row.class_phase,
        selected_class_name:row.selected_class_name,
        selected_class_phase:row.selected_class_phase,
        attendanceByTask:new Map(),
        classKeys:new Set()
      });
    }
    const person=grouped.get(key);
    person.attendanceByTask.set(String(row.task_id),row);
    if(row.class_name) person.classKeys.add(`${row.class_name}::${row.class_phase||''}`);
    if(row.selected_class_name) person.classKeys.add(`${row.selected_class_name}::${row.selected_class_phase||''}`);
    if(!person.class_name&&row.class_name){person.class_name=row.class_name;person.class_phase=row.class_phase;}
    if(!person.selected_class_name&&row.selected_class_name){person.selected_class_name=row.selected_class_name;person.selected_class_phase=row.selected_class_phase;}
    if((!person.cohort_no||person.cohort_no===null)&&row.cohort_no) person.cohort_no=row.cohort_no;
  }

  return [...grouped.values()].map(person=>{
    const details=tasks.filter(task=>{
      if(person.role==='DOSEN'&&task.phase==='ISC1') return true;
      if(!task.class_name) return false;
      return person.classKeys.has(`${task.class_name}::${task.phase||''}`);
    }).map(task=>{
      const taskIds=task.task_ids?.length?task.task_ids:[task.task_id];
      const attendance=taskIds.map(id=>person.attendanceByTask.get(String(id))).find(Boolean);
      return {task_id:task.task_id,label:taskLabel(task),attended:Boolean(attendance?.attended_at),attended_at:attendance?.attended_at||null};
    });
    return {...person,attendedCount:details.filter(item=>item.attended).length,totalTasks:details.length,details};
  }).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'id-ID')||String(a.role||'').localeCompare(String(b.role||''),'id-ID'));
};

const filterExportData=(data,query)=>{
  const materialTaskId=query.material_task_id?Number(query.material_task_id):null;
  const role=query.role||query.export_role||'';
  const tasks=materialTaskId?data.tasks.filter(task=>Number(task.task_id)===materialTaskId):data.tasks;
  const summary=buildAttendanceSummary(data.rows,tasks).filter(person=>!role||person.role===role).map(person=>({
    ...person,
    details:materialTaskId?person.details.filter(detail=>Number(detail.task_id)===materialTaskId):person.details
  })).filter(person=>person.details.length);
  return {tasks,summary};
};

const renderAttendancePdfHtml=({data,filtered,query})=>{
  const selectedTask=query.material_task_id?data.tasks.find(task=>Number(task.task_id)===Number(query.material_task_id)):null;
  const filterParts=[
    query.period_id?`Periode ID ${query.period_id}`:'Semua periode',
    query.phase||'Semua fase',
    query.class_id?`Kelas ID ${query.class_id}`:'Semua kelas',
    query.role||query.export_role?roleLabel(query.role||query.export_role):'Peserta & Narasumber',
    selectedTask?`Materi: ${taskLabel(selectedTask)}`:'Semua materi'
  ];
  const generatedAt=formatDateTime(new Date());
  const summaryRows=filtered.summary.map((person,index)=>`
    <tr>
      <td>${index+1}</td>
      <td>${escapeHtml(roleLabel(person.role))}</td>
      <td>${escapeHtml(person.name)}</td>
      <td>${person.cohort_no?`Angkatan ${escapeHtml(person.cohort_no)}`:'—'}</td>
      <td>${escapeHtml(classLabel(person.class_name||person.selected_class_name,person.class_phase||person.selected_class_phase))}</td>
      <td>${person.attendedCount}/${person.totalTasks} hadir</td>
    </tr>`).join('')||'<tr><td colspan="6" class="empty">Tidak ada data kehadiran.</td></tr>';
  const detailBlocks=filtered.summary.map(person=>`
    <section class="detail-block">
      <h3>${escapeHtml(person.name)} <span>${escapeHtml(roleLabel(person.role))}</span></h3>
      <table>
        <thead><tr><th>Materi</th><th>Status</th><th>Waktu Hadir</th></tr></thead>
        <tbody>${person.details.map(detail=>`
          <tr>
            <td>${escapeHtml(detail.label)}</td>
            <td class="${detail.attended?'ok':'muted'}">${detail.attended?'Sudah hadir':'Belum hadir'}</td>
            <td>${formatDateTime(detail.attended_at)}</td>
          </tr>`).join('')}</tbody>
      </table>
    </section>`).join('')||'<div class="empty">Tidak ada detail kehadiran.</div>';

  return `<!doctype html><html><head><meta charset="utf-8"/><style>
    body{font-family:Arial,sans-serif;color:#111827;margin:28px;font-size:12px} h1{font-size:22px;margin:0 0 6px} h2{font-size:16px;margin:22px 0 8px} h3{font-size:13px;margin:16px 0 6px} h3 span{font-weight:400;color:#6b7280} .meta{color:#4b5563;margin-bottom:16px;line-height:1.5}.chips{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 16px}.chip{border:1px solid #d1d5db;border-radius:999px;padding:4px 8px;background:#f9fafb} table{width:100%;border-collapse:collapse;margin-bottom:10px;page-break-inside:auto} th,td{border:1px solid #d1d5db;padding:6px 7px;text-align:left;vertical-align:top} th{background:#eef2ff;font-weight:700}.ok{color:#047857;font-weight:700}.muted{color:#6b7280}.empty{text-align:center;color:#6b7280;padding:12px}.detail-block{page-break-inside:avoid;margin-bottom:12px}.footer{margin-top:18px;color:#6b7280;font-size:10px}
  </style></head><body>
    <h1>Rekap Absensi</h1>
    <div class="meta">Dicetak: ${escapeHtml(generatedAt)}<br/>Format: Ringkasan + Detail</div>
    <div class="chips">${filterParts.map(part=>`<span class="chip">${escapeHtml(part)}</span>`).join('')}</div>
    <h2>Ringkasan Kehadiran</h2>
    <table><thead><tr><th>No</th><th>Role</th><th>Nama</th><th>Angkatan</th><th>Kelas</th><th>Ringkasan</th></tr></thead><tbody>${summaryRows}</tbody></table>
    <h2>Detail Kehadiran</h2>
    ${detailBlocks}
    <div class="footer">Dokumen ini dihasilkan otomatis dari sistem PKDP.</div>
  </body></html>`;
};

exports.exportAdminRecapPdf=async(req,res,next)=>{
  let browser;
  try{
    const data=await buildAdminRecapData(req.query);
    const filtered=filterExportData(data,req.query);
    const html=renderAttendancePdfHtml({data,filtered,query:req.query});
    const executablePath=getLocalBrowserPath();
    browser=await puppeteer.launch({headless:'new',executablePath,args:['--no-sandbox','--disable-setuid-sandbox']});
    const page=await browser.newPage();
    await page.setContent(html,{waitUntil:'networkidle0'});
    const pdf=await page.pdf({format:'A4',printBackground:true,margin:{top:'16mm',right:'12mm',bottom:'16mm',left:'12mm'}});
    const suffix=req.query.material_task_id?`materi-${req.query.material_task_id}`:(req.query.role||req.query.export_role||'semua');
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="rekap-absensi-${suffix}.pdf"`);
    res.send(Buffer.from(pdf));
  }catch(e){next(e);}finally{if(browser) await browser.close();}
};

exports.setTaskOverride=async(req,res,next)=>{
  try{
    await ensureSchema();
    const taskId=Number(req.params.taskId);
    const isOpenOverride=req.body?.is_open_override?1:0;
    if(!Number.isInteger(taskId)) return res.status(400).json({message:'Task tidak valid'});

    const[[task]]=await db.query(`SELECT id,phase,task_type FROM tasks WHERE id=? AND ((phase='ISC1' AND task_type IN ('PRETEST','POSTTEST')) OR (phase IN ('OJC','ISC2') AND task_type='UPLOAD') OR (phase='OJC' AND task_type='BRIEFING'))`,[taskId]);
    if(!task) return res.status(404).json({message:'Task absensi tidak ditemukan'});

    await db.query(
      `INSERT INTO task_attendance_settings (task_id,is_open_override,updated_by)
       VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE is_open_override=VALUES(is_open_override),updated_by=VALUES(updated_by)`,
      [taskId,isOpenOverride,req.user.id]
    );

    res.json({message:isOpenOverride?'Absensi dibuka admin':'Absensi dikembalikan ke jadwal otomatis'});
  }catch(e){next(e);}
};
