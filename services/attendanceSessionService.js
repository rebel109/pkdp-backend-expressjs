const db=require('../config/db');

let sessionSchemaReadyPromise=null;

const ensureSessionSchema=async()=>{
  if(!sessionSchemaReadyPromise){
    sessionSchemaReadyPromise=(async()=>{
      await db.query(`
        CREATE TABLE IF NOT EXISTS attendance_sessions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          period_id INT NOT NULL,
          class_id INT NULL,
          phase ENUM('ISC1','OJC','ISC2') NULL,
          title VARCHAR(255) NOT NULL,
          description TEXT NULL,
          target_role ENUM('DOSEN','NARASUMBER','ALL') NOT NULL DEFAULT 'ALL',
          open_at DATETIME NULL,
          close_at DATETIME NULL,
          is_open_override TINYINT(1) NOT NULL DEFAULT 0,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_by INT NULL,
          updated_by INT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          KEY idx_attendance_sessions_period (period_id),
          KEY idx_attendance_sessions_class (class_id),
          KEY idx_attendance_sessions_phase (phase),
          KEY idx_attendance_sessions_role (target_role),
          KEY idx_attendance_sessions_active (is_active),
          KEY idx_attendance_sessions_open (open_at),
          CONSTRAINT fk_attendance_sessions_period FOREIGN KEY (period_id) REFERENCES periods(id) ON DELETE CASCADE,
          CONSTRAINT fk_attendance_sessions_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL,
          CONSTRAINT fk_attendance_sessions_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
          CONSTRAINT fk_attendance_sessions_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS attendance_records (
          id INT AUTO_INCREMENT PRIMARY KEY,
          session_id INT NOT NULL,
          user_id INT NOT NULL,
          attendance_role ENUM('DOSEN','NARASUMBER') NOT NULL,
          attended_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_attendance_records_session_user_role (session_id,user_id,attendance_role),
          KEY idx_attendance_records_user (user_id),
          CONSTRAINT fk_attendance_records_session FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE,
          CONSTRAINT fk_attendance_records_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    })().catch(err=>{
      sessionSchemaReadyPromise=null;
      throw err;
    });
  }
  return sessionSchemaReadyPromise;
};

const toIsoOrNull=value=>value?new Date(value).toISOString():null;
const toMysqlDateTime=value=>value?new Date(value):null;
const normalizeNullableString=value=>{
  const normalized=String(value??'').trim();
  return normalized||null;
};
const normalizePhase=value=>{
  const normalized=String(value??'').trim().toUpperCase();
  return ['ISC1','OJC','ISC2'].includes(normalized)?normalized:null;
};
const normalizeTargetRole=value=>{
  const normalized=String(value??'ALL').trim().toUpperCase();
  return ['DOSEN','NARASUMBER','ALL'].includes(normalized)?normalized:'ALL';
};
const normalizeBoolean=value=>Boolean(value);

const buildSessionWindow=item=>({
  openAt:item?.open_at?new Date(item.open_at).getTime():null,
  closeAt:item?.close_at?new Date(item.close_at).getTime():null
});

const isWindowOpen=item=>{
  const now=Date.now();
  const {openAt,closeAt}=buildSessionWindow(item);
  const withinWindow=(openAt===null||now>=openAt)&&(closeAt===null||now<=closeAt);
  return Boolean(withinWindow||Number(item?.is_open_override||0)===1);
};

const buildStatus=item=>{
  const now=Date.now();
  const {openAt,closeAt}=buildSessionWindow(item);
  const overrideOpen=Number(item?.is_open_override||0)===1;
  const withinWindow=(openAt===null||now>=openAt)&&(closeAt===null||now<=closeAt);
  if(item?.attended_at) return {label:'Sudah hadir',canAttend:false};
  if(!normalizeBoolean(item?.is_active)) return {label:'Nonaktif',canAttend:false};
  if(overrideOpen) return {label:'Dibuka admin',canAttend:true};
  if(openAt!==null&&now<openAt) return {label:'Belum dibuka',canAttend:false};
  if(closeAt!==null&&now>closeAt) return {label:'Sudah ditutup',canAttend:false};
  if(withinWindow) return {label:'Absensi dibuka',canAttend:true};
  return {label:'Tidak tersedia',canAttend:false};
};

const badgeLabelForSession=item=>item?.phase||'Absensi';
const targetRoleLabel=value=>value==='DOSEN'?'Peserta':value==='NARASUMBER'?'Narasumber':'Peserta & Narasumber';

const validateSessionInput=payload=>{
  const periodId=Number(payload?.period_id);
  if(!Number.isInteger(periodId)||periodId<=0) throw new Error('Periode tidak valid');
  const classIdRaw=normalizeNullableString(payload?.class_id);
  const classId=classIdRaw==null?null:Number(classIdRaw);
  if(classIdRaw!=null&&(!Number.isInteger(classId)||classId<=0)) throw new Error('Kelas tidak valid');
  const title=String(payload?.title||'').trim();
  if(!title) throw new Error('Judul absensi wajib diisi');
  const description=normalizeNullableString(payload?.description);
  const phase=normalizePhase(payload?.phase);
  const targetRole=normalizeTargetRole(payload?.target_role);
  const openAt=normalizeNullableString(payload?.open_at);
  const closeAt=normalizeNullableString(payload?.close_at);
  if(openAt&&Number.isNaN(new Date(openAt).getTime())) throw new Error('Waktu buka tidak valid');
  if(closeAt&&Number.isNaN(new Date(closeAt).getTime())) throw new Error('Waktu tutup tidak valid');
  if(openAt&&closeAt&&new Date(openAt)>=new Date(closeAt)) throw new Error('Waktu tutup harus setelah waktu buka');
  return {
    period_id:periodId,
    class_id:classId,
    title,
    description,
    phase,
    target_role:targetRole,
    open_at:openAt,
    close_at:closeAt,
    is_active:payload?.is_active==null?true:Boolean(payload.is_active)
  };
};

const getSessionBaseSelect=()=>`
  SELECT s.id,s.period_id,s.class_id,s.phase,s.title,s.description,s.target_role,s.open_at,s.close_at,
         s.is_open_override,s.is_active,s.created_at,s.updated_at,
         ar.attended_at,
         c.name AS class_name,c.phase AS class_phase,co.cohort_no,p.label AS period_label
  FROM attendance_sessions s
  JOIN periods p ON p.id=s.period_id
  LEFT JOIN classes c ON c.id=s.class_id
  LEFT JOIN cohorts co ON co.id=c.cohort_id
`;

const buildAdminFilters=(query={})=>{
  const clauses=['s.is_active=1'];
  const params=[];
  if(query.period_id){clauses.push('s.period_id=?');params.push(Number(query.period_id));}
  if(query.phase){clauses.push('s.phase=?');params.push(normalizePhase(query.phase));}
  if(query.class_id){clauses.push('s.class_id=?');params.push(Number(query.class_id));}
  if(query.role){clauses.push('s.target_role=?');params.push(normalizeTargetRole(query.role));}
  return {where:clauses.length?`WHERE ${clauses.join(' AND ')}`:'',params};
};

const mapSessionItem=(item,role)=>{
  const status=buildStatus(item);
  return {
    session_id:item.id,
    role,
    nama_materi:item.title,
    nama_kelas:item.class_name,
    class_name:item.class_name,
    class_phase:item.class_phase,
    cohort_no:item.cohort_no,
    phase:item.phase,
    description:item.description,
    target_role:item.target_role,
    badge_label:badgeLabelForSession(item),
    is_open:isWindowOpen(item),
    attended_at:toIsoOrNull(item.attended_at),
    status_label:status.label,
    can_attend:status.canAttend,
    open_at:toIsoOrNull(item.open_at),
    close_at:toIsoOrNull(item.close_at),
    source:'session'
  };
};

const getAccessibleSessionForUser=async(sessionId,user)=>{
  const role=user?.role;
  if(!['DOSEN','NARASUMBER'].includes(role)) return null;
  const roleCondition=role==='DOSEN'
    ? `(s.target_role IN ('DOSEN','ALL'))`
    : `(s.target_role IN ('NARASUMBER','ALL'))`;
  const accessWhere=role==='DOSEN'
    ? `(
         s.class_id IS NULL
         OR (
           s.phase='ISC1'
           AND s.class_id = COALESCE(
             (
               SELECT pr.selected_class_id
               FROM profiles pr
               WHERE pr.user_id=?
               LIMIT 1
             ),
             s.class_id
           )
           AND s.class_id IN (SELECT class_id FROM class_members WHERE user_id=?)
         )
         OR (
           (s.phase IS NULL OR s.phase IN ('OJC','ISC2'))
           AND s.class_id IN (SELECT class_id FROM class_members WHERE user_id=?)
         )
       )`
    : `(
         s.period_id=?
         OR EXISTS (
           SELECT 1 FROM classes cx
           WHERE cx.id=s.class_id AND cx.period_id=?
         )
       )`;
  const accessParams=role==='DOSEN'?[user.id,user.id,user.id]:[user.period_id,user.period_id];
  const [[session]]=await db.query(
    `${getSessionBaseSelect()}
     LEFT JOIN attendance_records ar ON ar.session_id=s.id AND ar.user_id=? AND ar.attendance_role=?
     WHERE s.id=? AND s.is_active=1 AND ${roleCondition} AND ${accessWhere}
     LIMIT 1`,
    [user.id,role,sessionId,...accessParams]
  );
  return session||null;
};

const listMySessions=async user=>{
  await ensureSessionSchema();
  const role=user?.role;
  if(!['DOSEN','NARASUMBER'].includes(role)) return [];
  if(role==='DOSEN'){
    const [rows]=await db.query(
      `${getSessionBaseSelect()}
       LEFT JOIN attendance_records ar ON ar.session_id=s.id AND ar.user_id=? AND ar.attendance_role='DOSEN'
       WHERE s.is_active=1
         AND s.period_id=?
         AND s.target_role IN ('DOSEN','ALL')
         AND (
           s.class_id IS NULL
           OR (
             s.phase='ISC1'
             AND s.class_id = COALESCE(
               (
                 SELECT pr.selected_class_id
                 FROM profiles pr
                 WHERE pr.user_id=?
                 LIMIT 1
               ),
               s.class_id
             )
             AND s.class_id IN (SELECT class_id FROM class_members WHERE user_id=?)
           )
           OR (
             (s.phase IS NULL OR s.phase IN ('OJC','ISC2'))
             AND s.class_id IN (SELECT class_id FROM class_members WHERE user_id=?)
           )
         )
       ORDER BY COALESCE(s.open_at,s.created_at) DESC,s.id DESC`,
      [user.id,user.period_id,user.id,user.id,user.id]
    );
    return rows.map(item=>({
      ...mapSessionItem(item,'DOSEN'),
      nama_narasumber:item.phase==='ISC1'?(item.target_role==='DOSEN'?'Peserta':'Absensi'):(item.class_name||'—')
    }));
  }
  const [rows]=await db.query(
    `${getSessionBaseSelect()}
     LEFT JOIN attendance_records ar ON ar.session_id=s.id AND ar.user_id=? AND ar.attendance_role='NARASUMBER'
     WHERE s.is_active=1
       AND s.target_role IN ('NARASUMBER','ALL')
       AND (
         s.period_id=?
         OR EXISTS (
           SELECT 1 FROM classes cx
           WHERE cx.id=s.class_id AND cx.period_id=?
         )
       )
     ORDER BY COALESCE(s.open_at,s.created_at) DESC,s.id DESC`,
    [user.id,user.period_id,user.period_id]
  );
  return rows.map(item=>mapSessionItem(item,'NARASUMBER'));
};

const markSessionAttendance=async(sessionId,user)=>{
  await ensureSessionSchema();
  const role=user?.role;
  if(!['DOSEN','NARASUMBER'].includes(role)) throw new Error('Akses ditolak');
  const session=await getAccessibleSessionForUser(sessionId,user);
  if(!session) throw new Error('Sesi absensi tidak ditemukan');
  if(!isWindowOpen(session)||!normalizeBoolean(session.is_active)) throw new Error('Absensi sudah ditutup');
  await db.query(
    `INSERT INTO attendance_records (session_id,user_id,attendance_role)
     VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE attended_at=attended_at`,
    [sessionId,user.id,role]
  );
  return {message:'Absensi berhasil disimpan'};
};

const listAdminSessions=async(query={})=>{
  await ensureSessionSchema();
  const {where,params}=buildAdminFilters(query);
  const [rows]=await db.query(
    `SELECT s.id,s.period_id,s.class_id,s.phase,s.title,s.description,s.target_role,s.open_at,s.close_at,
            s.is_open_override,s.is_active,s.created_at,s.updated_at,
            c.name AS class_name,c.phase AS class_phase,co.cohort_no,p.label AS period_label,
            COUNT(DISTINCT CASE WHEN ar.attendance_role='DOSEN' THEN ar.user_id END) AS peserta_hadir,
            COUNT(DISTINCT CASE WHEN ar.attendance_role='NARASUMBER' THEN ar.user_id END) AS narasumber_hadir
     FROM attendance_sessions s
     JOIN periods p ON p.id=s.period_id
     LEFT JOIN classes c ON c.id=s.class_id
     LEFT JOIN cohorts co ON co.id=c.cohort_id
     LEFT JOIN attendance_records ar ON ar.session_id=s.id
     ${where}
     GROUP BY s.id,p.label,c.name,c.phase,co.cohort_no
     ORDER BY COALESCE(s.open_at,s.created_at) DESC,s.id DESC`,
    params
  );
  return rows.map(item=>({
    session_id:item.id,
    period_id:item.period_id,
    class_id:item.class_id,
    phase:item.phase,
    title:item.title,
    description:item.description,
    target_role:item.target_role,
    target_role_label:targetRoleLabel(item.target_role),
    open_at:toIsoOrNull(item.open_at),
    close_at:toIsoOrNull(item.close_at),
    is_open_override:Boolean(item.is_open_override),
    is_active:Boolean(item.is_active),
    is_open:isWindowOpen(item),
    class_name:item.class_name,
    class_phase:item.class_phase,
    cohort_no:item.cohort_no,
    period_label:item.period_label,
    peserta_hadir:Number(item.peserta_hadir||0),
    narasumber_hadir:Number(item.narasumber_hadir||0),
    created_at:toIsoOrNull(item.created_at),
    updated_at:toIsoOrNull(item.updated_at)
  }));
};

const getAdminSessionRecap=async(query={})=>{
  await ensureSessionSchema();
  const sessions=await listAdminSessions(query);
  const sessionIds=sessions.map(item=>item.session_id);
  if(!sessionIds.length) return {sessions,rows:[]};

  const roleFilter=normalizeTargetRole(query.role||'');
  const sessionPlaceholders=sessionIds.map(()=>'?').join(',');
  const params=[...sessionIds];
  let roleClause='';
  if(roleFilter==='DOSEN'||roleFilter==='NARASUMBER'){
    roleClause=' AND ar.attendance_role=?';
    params.push(roleFilter);
  }

  const [records]=await db.query(
    `SELECT ar.session_id,ar.user_id,ar.attendance_role AS role,ar.attended_at,u.name
     FROM attendance_records ar
     JOIN users u ON u.id=ar.user_id
     WHERE ar.session_id IN (${sessionPlaceholders})${roleClause}
     ORDER BY ar.attended_at DESC,ar.id DESC`,
    params
  );
  if(!records.length) return {sessions,rows:[]};

  const dosenIds=[...new Set(records.filter(r=>r.role==='DOSEN').map(r=>r.user_id))];
  const narasumberIds=[...new Set(records.filter(r=>r.role==='NARASUMBER').map(r=>r.user_id))];

  const dosenClassMap=new Map();
  const dosenSelectedMap=new Map();
  if(dosenIds.length){
    const ph=dosenIds.map(()=>'?').join(',');
    const [memberClasses]=await db.query(
      `SELECT cm.user_id,c.id AS class_id,c.name AS class_name,c.phase AS class_phase,co.cohort_no
       FROM class_members cm
       JOIN classes c ON c.id=cm.class_id
       LEFT JOIN cohorts co ON co.id=c.cohort_id
       WHERE cm.user_id IN (${ph})`,
      dosenIds
    );
    memberClasses.forEach(row=>{
      if(!dosenClassMap.has(row.user_id)) dosenClassMap.set(row.user_id,[]);
      dosenClassMap.get(row.user_id).push(row);
    });
    const [selectedClasses]=await db.query(
      `SELECT pr.user_id,c.id AS class_id,c.name AS class_name,c.phase AS class_phase,co.cohort_no
       FROM profiles pr
       JOIN classes c ON c.id=pr.selected_class_id
       LEFT JOIN cohorts co ON co.id=c.cohort_id
       WHERE pr.user_id IN (${ph})`,
      dosenIds
    );
    selectedClasses.forEach(row=>{ if(!dosenSelectedMap.has(row.user_id)) dosenSelectedMap.set(row.user_id,row); });
  }

  const narasumberClassMap=new Map();
  if(narasumberIds.length){
    const ph=narasumberIds.map(()=>'?').join(',');
    const [nsClasses]=await db.query(
      `SELECT cn.narasumber_id AS user_id,c.id AS class_id,c.name AS class_name,c.phase AS class_phase,co.cohort_no
       FROM class_narasumber cn
       JOIN classes c ON c.id=cn.class_id
       LEFT JOIN cohorts co ON co.id=c.cohort_id
       WHERE cn.narasumber_id IN (${ph})`,
      narasumberIds
    );
    nsClasses.forEach(row=>{
      if(!narasumberClassMap.has(row.user_id)) narasumberClassMap.set(row.user_id,[]);
      narasumberClassMap.get(row.user_id).push(row);
    });
  }

  const resolveClass=(record,session)=>{
    if(session.class_id) return {class_name:session.class_name,class_phase:session.class_phase,cohort_no:session.cohort_no};
    if(record.role==='DOSEN'){
      if(session.phase==='ISC1'&&dosenSelectedMap.has(record.user_id)) return dosenSelectedMap.get(record.user_id);
      const list=dosenClassMap.get(record.user_id)||[];
      const match=session.phase?list.find(c=>c.class_phase===session.phase):null;
      return match||list[0]||dosenSelectedMap.get(record.user_id)||{};
    }
    const list=narasumberClassMap.get(record.user_id)||[];
    const match=session.phase?list.find(c=>c.class_phase===session.phase):null;
    return match||list[0]||{};
  };

  const sessionMap=new Map(sessions.map(item=>[item.session_id,item]));
  const rows=records.map(record=>{
    const session=sessionMap.get(record.session_id)||{};
    const cls=resolveClass(record,session);
    return {
      session_id:record.session_id,
      user_id:record.user_id,
      role:record.role,
      name:record.name,
      title:session.title,
      phase:session.phase,
      class_name:cls.class_name||null,
      class_phase:cls.class_phase||null,
      cohort_no:cls.cohort_no??null,
      target_role:session.target_role,
      attended_at:toIsoOrNull(record.attended_at)
    };
  });

  return {sessions,rows};
};

const createSession=async(payload,user)=>{
  await ensureSessionSchema();
  const data=validateSessionInput(payload);
  const [[period]]=await db.query('SELECT id FROM periods WHERE id=? LIMIT 1',[data.period_id]);
  if(!period) throw new Error('Periode tidak ditemukan');
  if(data.class_id!=null){
    const [[cls]]=await db.query('SELECT id,period_id,phase FROM classes WHERE id=? LIMIT 1',[data.class_id]);
    if(!cls) throw new Error('Kelas tidak ditemukan');
    if(Number(cls.period_id)!==Number(data.period_id)) throw new Error('Kelas tidak berada pada periode yang dipilih');
    if(data.phase&&cls.phase&&String(cls.phase)!==String(data.phase)) throw new Error('Fase sesi tidak sesuai dengan fase kelas');
  }
  const [result]=await db.query(
    `INSERT INTO attendance_sessions (period_id,class_id,phase,title,description,target_role,open_at,close_at,is_active,created_by,updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      data.period_id,
      data.class_id,
      data.phase,
      data.title,
      data.description,
      data.target_role,
      toMysqlDateTime(data.open_at),
      toMysqlDateTime(data.close_at),
      data.is_active?1:0,
      user?.id||null,
      user?.id||null
    ]
  );
  return result.insertId;
};

const updateSession=async(sessionId,payload,user)=>{
  await ensureSessionSchema();
  const data=validateSessionInput(payload);
  const [[session]]=await db.query('SELECT id FROM attendance_sessions WHERE id=? LIMIT 1',[sessionId]);
  if(!session) throw new Error('Sesi absensi tidak ditemukan');
  if(data.class_id!=null){
    const [[cls]]=await db.query('SELECT id,period_id,phase FROM classes WHERE id=? LIMIT 1',[data.class_id]);
    if(!cls) throw new Error('Kelas tidak ditemukan');
    if(Number(cls.period_id)!==Number(data.period_id)) throw new Error('Kelas tidak berada pada periode yang dipilih');
    if(data.phase&&cls.phase&&String(cls.phase)!==String(data.phase)) throw new Error('Fase sesi tidak sesuai dengan fase kelas');
  }
  await db.query(
    `UPDATE attendance_sessions
     SET period_id=?,class_id=?,phase=?,title=?,description=?,target_role=?,open_at=?,close_at=?,is_active=?,updated_by=?
     WHERE id=?`,
    [
      data.period_id,
      data.class_id,
      data.phase,
      data.title,
      data.description,
      data.target_role,
      toMysqlDateTime(data.open_at),
      toMysqlDateTime(data.close_at),
      data.is_active?1:0,
      user?.id||null,
      sessionId
    ]
  );
};

const setSessionOverride=async(sessionId,isOpenOverride,user)=>{
  await ensureSessionSchema();
  const [[session]]=await db.query('SELECT id FROM attendance_sessions WHERE id=? LIMIT 1',[sessionId]);
  if(!session) throw new Error('Sesi absensi tidak ditemukan');
  await db.query(
    'UPDATE attendance_sessions SET is_open_override=?, updated_by=? WHERE id=?',
    [isOpenOverride?1:0,user?.id||null,sessionId]
  );
};

const removeSession=async sessionId=>{
  await ensureSessionSchema();
  const [[session]]=await db.query('SELECT id FROM attendance_sessions WHERE id=? LIMIT 1',[sessionId]);
  if(!session) throw new Error('Sesi absensi tidak ditemukan');
  await db.query('UPDATE attendance_sessions SET is_active=0 WHERE id=?',[sessionId]);
};

module.exports={
  ensureSessionSchema,
  listMySessions,
  markSessionAttendance,
  listAdminSessions,
  getAdminSessionRecap,
  createSession,
  updateSession,
  setSessionOverride,
  removeSession,
  buildStatus,
  isWindowOpen,
  toIsoOrNull,
  targetRoleLabel
};
