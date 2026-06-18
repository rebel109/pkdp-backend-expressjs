const db=require('../config/db');

let schemaReadyPromise=null;

const ensureSurveyFoundationSchema=async()=>{
  if(!schemaReadyPromise){
    schemaReadyPromise=(async()=>{
      const ensurePhaseColumn=async table=>{
        const[cols]=await db.query(`SHOW COLUMNS FROM ${table} LIKE 'phase'`);
        if(!cols.length){
          await db.query(`ALTER TABLE ${table} ADD COLUMN phase ENUM('ISC1','OJC') NOT NULL DEFAULT 'ISC1' AFTER period_id`);
        }
      };
      const ensureUniqueKeyHasPhase=async(table,keyName,columns)=>{
        const[idx]=await db.query(`SHOW INDEX FROM ${table} WHERE Key_name=?`,[keyName]);
        const hasPhase=idx.some(row=>String(row.Column_name).toLowerCase()==='phase');
        if(idx.length&&hasPhase) return;
        if(idx.length) await db.query(`ALTER TABLE ${table} DROP INDEX ${keyName}`);
        await db.query(`ALTER TABLE ${table} ADD UNIQUE KEY ${keyName} (${columns.join(',')})`);
      };
      await ensurePhaseColumn('survey_isc1_materials');
      await ensurePhaseColumn('survey_isc1_narasumbers');
      await ensurePhaseColumn('survey_isc1_assignments');
      await ensureUniqueKeyHasPhase('survey_isc1_materials','uq_survey_isc1_materials_period_name',['period_id','phase','name']);
      await ensureUniqueKeyHasPhase('survey_isc1_narasumbers','uq_survey_isc1_narasumbers_period_name',['period_id','phase','name']);
      await ensureUniqueKeyHasPhase('survey_isc1_assignments','uq_survey_isc1_assignments',['period_id','phase','cohort_id','material_id','narasumber_id']);
    })().catch(err=>{
      schemaReadyPromise=null;
      throw err;
    });
  }
  return schemaReadyPromise;
};

const normalizePhase=phase=>String(phase||'').toUpperCase();
const validPhase=phase=>['ISC1','OJC'].includes(normalizePhase(phase));
const validActivationPhase=phase=>['ISC1','OJC'].includes(normalizePhase(phase));
const validCategory=key=>['narasumber','panitia','sarpras','lainnya'].includes(String(key||''));
const phaseLabel=phase=>normalizePhase(phase)==='OJC'?'OJC':'ISC1';

const assignmentSelect=`SELECT sia.*,p.label AS period_label,co.cohort_no,sim.name AS material_name,sin.name AS narasumber_name,sb.title AS bank_title,
  (SELECT MAX(sam.activation_id) FROM survey_activation_mappings sam WHERE sam.isc1_assignment_id=sia.id) AS activation_id
  FROM survey_isc1_assignments sia
  JOIN periods p ON p.id=sia.period_id
  LEFT JOIN cohorts co ON co.id=sia.cohort_id
  LEFT JOIN survey_isc1_materials sim ON sim.id=sia.material_id
  LEFT JOIN survey_isc1_narasumbers sin ON sin.id=sia.narasumber_id
  JOIN survey_banks sb ON sb.id=sia.bank_id`;

const getPhaseMaterialsInternal=async({phase,query})=>{
  await ensureSurveyFoundationSchema();
  const normalizedPhase=normalizePhase(phase);
  const{period_id,is_active}=query;
  let q=`SELECT sim.*,p.label AS period_label,u.name AS created_by_name
    FROM survey_isc1_materials sim
    JOIN periods p ON p.id=sim.period_id
    JOIN users u ON u.id=sim.created_by
    WHERE sim.phase=?`;
  const params=[normalizedPhase];
  if(period_id){q+=' AND sim.period_id=?';params.push(period_id);}
  if(is_active!==undefined&&is_active!==''){q+=' AND sim.is_active=?';params.push(Number(is_active)?1:0);}
  q+=' ORDER BY sim.period_id DESC,sim.name,sim.id DESC';
  const[rows]=await db.query(q,params);
  return rows;
};

const createPhaseMaterialInternal=async({phase,body,userId})=>{
  await ensureSurveyFoundationSchema();
  const normalizedPhase=normalizePhase(phase);
  const{period_id,name,is_active}=body;
  if(!period_id||!String(name||'').trim()) throw Object.assign(new Error('period_id dan nama materi wajib'),{status:400});
  const[r]=await db.query(
    'INSERT INTO survey_isc1_materials (period_id,phase,name,is_active,created_by) VALUES (?,?,?,?,?)',
    [period_id,normalizedPhase,String(name).trim(),is_active===undefined?1:(is_active?1:0),userId]
  );
  return r.insertId;
};

const updatePhaseMaterialInternal=async({phase,id,body})=>{
  await ensureSurveyFoundationSchema();
  const normalizedPhase=normalizePhase(phase);
  const{period_id,name,is_active}=body;
  if(!period_id||!String(name||'').trim()) throw Object.assign(new Error('period_id dan nama materi wajib'),{status:400});
  const[r]=await db.query('UPDATE survey_isc1_materials SET period_id=?,phase=?,name=?,is_active=? WHERE id=?',[period_id,normalizedPhase,String(name).trim(),is_active?1:0,id]);
  if(!r.affectedRows) throw Object.assign(new Error(`Materi ${phaseLabel(normalizedPhase)} tidak ditemukan`),{status:404});
};

const removePhaseMaterialInternal=async({phase,id})=>{
  await ensureSurveyFoundationSchema();
  const[r]=await db.query('DELETE FROM survey_isc1_materials WHERE id=? AND phase=?',[id,normalizePhase(phase)]);
  if(!r.affectedRows) throw Object.assign(new Error(`Materi ${phaseLabel(phase)} tidak ditemukan`),{status:404});
};

const getPhaseNarasumbersInternal=async({phase,query})=>{
  await ensureSurveyFoundationSchema();
  const normalizedPhase=normalizePhase(phase);
  const{period_id,is_active}=query;
  let q=`SELECT sin.*,p.label AS period_label,u.name AS created_by_name
    FROM survey_isc1_narasumbers sin
    JOIN periods p ON p.id=sin.period_id
    JOIN users u ON u.id=sin.created_by
    WHERE sin.phase=?`;
  const params=[normalizedPhase];
  if(period_id){q+=' AND sin.period_id=?';params.push(period_id);}
  if(is_active!==undefined&&is_active!==''){q+=' AND sin.is_active=?';params.push(Number(is_active)?1:0);}
  q+=' ORDER BY sin.period_id DESC,sin.name,sin.id DESC';
  const[rows]=await db.query(q,params);
  return rows;
};

const createPhaseNarasumberInternal=async({phase,body,userId})=>{
  await ensureSurveyFoundationSchema();
  const normalizedPhase=normalizePhase(phase);
  const{period_id,name,is_active}=body;
  if(!period_id||!String(name||'').trim()) throw Object.assign(new Error('period_id dan nama narasumber wajib'),{status:400});
  const[r]=await db.query(
    'INSERT INTO survey_isc1_narasumbers (period_id,phase,name,is_active,created_by) VALUES (?,?,?,?,?)',
    [period_id,normalizedPhase,String(name).trim(),is_active===undefined?1:(is_active?1:0),userId]
  );
  return r.insertId;
};

const updatePhaseNarasumberInternal=async({phase,id,body})=>{
  await ensureSurveyFoundationSchema();
  const normalizedPhase=normalizePhase(phase);
  const{period_id,name,is_active}=body;
  if(!period_id||!String(name||'').trim()) throw Object.assign(new Error('period_id dan nama narasumber wajib'),{status:400});
  const[r]=await db.query('UPDATE survey_isc1_narasumbers SET period_id=?,phase=?,name=?,is_active=? WHERE id=?',[period_id,normalizedPhase,String(name).trim(),is_active?1:0,id]);
  if(!r.affectedRows) throw Object.assign(new Error(`Narasumber ${phaseLabel(normalizedPhase)} tidak ditemukan`),{status:404});
};

const removePhaseNarasumberInternal=async({phase,id})=>{
  await ensureSurveyFoundationSchema();
  const[r]=await db.query('DELETE FROM survey_isc1_narasumbers WHERE id=? AND phase=?',[id,normalizePhase(phase)]);
  if(!r.affectedRows) throw Object.assign(new Error(`Narasumber ${phaseLabel(phase)} tidak ditemukan`),{status:404});
};

const handlePhaseDbError=(res,next,error,{duplicateMessage})=>{
  if(error?.code==='ER_DUP_ENTRY') return res.status(400).json({message:duplicateMessage});
  if(error?.status) return res.status(error.status).json({message:error.message});
  return next(error);
};

exports.getIsc1Materials=async(req,res,next)=>{
  try{res.json(await getPhaseMaterialsInternal({phase:'ISC1',query:req.query}));}catch(e){next(e);}
};

exports.createIsc1Material=async(req,res,next)=>{
  try{
    const id=await createPhaseMaterialInternal({phase:'ISC1',body:req.body,userId:req.user.id});
    res.status(201).json({message:'Materi ISC1 dibuat',id});
  }catch(e){handlePhaseDbError(res,next,e,{duplicateMessage:'Nama materi ISC1 sudah ada pada periode ini'});}
};

exports.updateIsc1Material=async(req,res,next)=>{
  try{
    await updatePhaseMaterialInternal({phase:'ISC1',id:req.params.id,body:req.body});
    res.json({message:'Materi ISC1 diperbarui'});
  }catch(e){handlePhaseDbError(res,next,e,{duplicateMessage:'Nama materi ISC1 sudah ada pada periode ini'});}
};

exports.removeIsc1Material=async(req,res,next)=>{
  try{
    await removePhaseMaterialInternal({phase:'ISC1',id:req.params.id});
    res.json({message:'Materi ISC1 dihapus'});
  }catch(e){handlePhaseDbError(res,next,e,{duplicateMessage:'Nama materi ISC1 sudah ada pada periode ini'});}
};

exports.getIsc1Narasumbers=async(req,res,next)=>{
  try{res.json(await getPhaseNarasumbersInternal({phase:'ISC1',query:req.query}));}catch(e){next(e);}
};

exports.createIsc1Narasumber=async(req,res,next)=>{
  try{
    const id=await createPhaseNarasumberInternal({phase:'ISC1',body:req.body,userId:req.user.id});
    res.status(201).json({message:'Narasumber ISC1 dibuat',id});
  }catch(e){handlePhaseDbError(res,next,e,{duplicateMessage:'Nama narasumber ISC1 sudah ada pada periode ini'});}
};

exports.updateIsc1Narasumber=async(req,res,next)=>{
  try{
    await updatePhaseNarasumberInternal({phase:'ISC1',id:req.params.id,body:req.body});
    res.json({message:'Narasumber ISC1 diperbarui'});
  }catch(e){handlePhaseDbError(res,next,e,{duplicateMessage:'Nama narasumber ISC1 sudah ada pada periode ini'});}
};

exports.removeIsc1Narasumber=async(req,res,next)=>{
  try{
    await removePhaseNarasumberInternal({phase:'ISC1',id:req.params.id});
    res.json({message:'Narasumber ISC1 dihapus'});
  }catch(e){handlePhaseDbError(res,next,e,{duplicateMessage:'Nama narasumber ISC1 sudah ada pada periode ini'});}
};

exports.getOjcMaterials=async(req,res,next)=>{
  try{res.json(await getPhaseMaterialsInternal({phase:'OJC',query:req.query}));}catch(e){next(e);}
};

exports.createOjcMaterial=async(req,res,next)=>{
  try{
    const id=await createPhaseMaterialInternal({phase:'OJC',body:req.body,userId:req.user.id});
    res.status(201).json({message:'Materi OJC dibuat',id});
  }catch(e){handlePhaseDbError(res,next,e,{duplicateMessage:'Nama materi OJC sudah ada pada periode ini'});}
};

exports.updateOjcMaterial=async(req,res,next)=>{
  try{
    await updatePhaseMaterialInternal({phase:'OJC',id:req.params.id,body:req.body});
    res.json({message:'Materi OJC diperbarui'});
  }catch(e){handlePhaseDbError(res,next,e,{duplicateMessage:'Nama materi OJC sudah ada pada periode ini'});}
};

exports.removeOjcMaterial=async(req,res,next)=>{
  try{
    await removePhaseMaterialInternal({phase:'OJC',id:req.params.id});
    res.json({message:'Materi OJC dihapus'});
  }catch(e){handlePhaseDbError(res,next,e,{duplicateMessage:'Nama materi OJC sudah ada pada periode ini'});}
};

exports.getOjcNarasumbers=async(req,res,next)=>{
  try{res.json(await getPhaseNarasumbersInternal({phase:'OJC',query:req.query}));}catch(e){next(e);}
};

exports.createOjcNarasumber=async(req,res,next)=>{
  try{
    const id=await createPhaseNarasumberInternal({phase:'OJC',body:req.body,userId:req.user.id});
    res.status(201).json({message:'Narasumber OJC dibuat',id});
  }catch(e){handlePhaseDbError(res,next,e,{duplicateMessage:'Nama narasumber OJC sudah ada pada periode ini'});}
};

exports.updateOjcNarasumber=async(req,res,next)=>{
  try{
    await updatePhaseNarasumberInternal({phase:'OJC',id:req.params.id,body:req.body});
    res.json({message:'Narasumber OJC diperbarui'});
  }catch(e){handlePhaseDbError(res,next,e,{duplicateMessage:'Nama narasumber OJC sudah ada pada periode ini'});}
};

exports.removeOjcNarasumber=async(req,res,next)=>{
  try{
    await removePhaseNarasumberInternal({phase:'OJC',id:req.params.id});
    res.json({message:'Narasumber OJC dihapus'});
  }catch(e){handlePhaseDbError(res,next,e,{duplicateMessage:'Nama narasumber OJC sudah ada pada periode ini'});}
};

exports.getMappings=async(req,res,next)=>{
  try{
    await ensureSurveyFoundationSchema();
    const requestedPhase=String(req.query.phase||'').trim();
    const normalizedPhase=requestedPhase?normalizePhase(requestedPhase):'';
    const{period_id,class_id,is_active,cohort_id}=req.query;
    if(requestedPhase&&!validPhase(normalizedPhase)) return res.json([]);
    let q=`${assignmentSelect} WHERE 1=1`;
    const params=[];
    if(normalizedPhase){q+=' AND sia.phase=?';params.push(normalizedPhase);}
    if(period_id){q+=' AND sia.period_id=?';params.push(period_id);}
    if(cohort_id){q+=' AND sia.cohort_id=?';params.push(cohort_id);}
    if(class_id){q+=' AND sia.cohort_id=?';params.push(class_id);}
    if(is_active!==undefined&&is_active!==''){q+=' AND sia.is_active=?';params.push(Number(is_active)?1:0);}
    q+=' ORDER BY co.cohort_no,sim.name,sin.name,sia.id';
    const[rows]=await db.query(q,params);
    res.json(rows.map(r=>({...r,class_id:r.cohort_id,class_name:r.cohort_no?`Angkatan ${r.cohort_no}`:'Semua Angkatan',material_title:r.material_name,phase:r.phase||'ISC1'})));
  }catch(e){next(e);}
};

exports.createMapping=async(req,res,next)=>{
  try{
    await ensureSurveyFoundationSchema();
    const{phase,period_id,class_id,material_title,narasumber_id,bank_id,is_active}=req.body;
    const normalizedPhase=normalizePhase(phase);
    if(!validPhase(normalizedPhase)||!period_id||!bank_id) return res.status(400).json({message:'phase, period_id, dan bank_id wajib'});
    const normalizedClassId=String(class_id||'').trim();
    const normalizedMaterialId=String(material_title||'').trim();
    const normalizedNarasumberId=String(narasumber_id||'').trim();
    let cohortId=null,materialId=null,narasumberDbId=null;
    if(normalizedClassId){
      const[[cohort]]=await db.query('SELECT id,period_id FROM cohorts WHERE id=? AND period_id=?',[normalizedClassId,period_id]);
      if(!cohort) return res.status(400).json({message:'Angkatan tidak valid untuk periode'});
      cohortId=cohort.id;
    }
    if(normalizedMaterialId){
      const[[material]]=await db.query('SELECT id,name FROM survey_isc1_materials WHERE id=? AND period_id=? AND phase=? AND is_active=1',[normalizedMaterialId,period_id,normalizedPhase]);
      if(!material) return res.status(400).json({message:`Materi ${phaseLabel(normalizedPhase)} tidak valid`});
      materialId=material.id;
    }
    if(normalizedNarasumberId){
      const[[narasumber]]=await db.query('SELECT id,name FROM survey_isc1_narasumbers WHERE id=? AND period_id=? AND phase=? AND is_active=1',[normalizedNarasumberId,period_id,normalizedPhase]);
      if(!narasumber) return res.status(400).json({message:`Narasumber ${phaseLabel(normalizedPhase)} tidak valid`});
      narasumberDbId=narasumber.id;
    }
    const[[bank]]=await db.query('SELECT id FROM survey_banks WHERE id=?',[bank_id]);
    if(!bank) return res.status(400).json({message:'Bank instrumen tidak valid'});
    const[r]=await db.query(
      `INSERT INTO survey_isc1_assignments (period_id,phase,cohort_id,material_id,narasumber_id,bank_id,is_active,created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [period_id,normalizedPhase,cohortId,materialId,narasumberDbId,bank_id,is_active===undefined?1:(is_active?1:0),req.user.id]
    );
    res.status(201).json({message:`Survei ${phaseLabel(normalizedPhase)} dibuat`,id:r.insertId});
  }catch(e){
    if(e?.code==='ER_DUP_ENTRY') return res.status(400).json({message:`Survei ${phaseLabel(req.body?.phase)} untuk kombinasi angkatan, materi, dan narasumber ini sudah ada`});
    next(e);
  }
};

exports.updateMapping=async(req,res,next)=>{
  try{
    await ensureSurveyFoundationSchema();
    const id=Number(req.params.id);
    const{phase,period_id,class_id,material_title,narasumber_id,bank_id,is_active}=req.body;
    const normalizedPhase=normalizePhase(phase);
    if(!id||!validPhase(normalizedPhase)||!period_id||!bank_id) return res.status(400).json({message:'Data mapping survei tidak lengkap'});
    const[[exists]]=await db.query('SELECT id FROM survey_isc1_assignments WHERE id=?',[id]);
    if(!exists) return res.status(404).json({message:'Mapping survei tidak ditemukan'});
    const normalizedClassId=String(class_id||'').trim();
    const normalizedMaterialId=String(material_title||'').trim();
    const normalizedNarasumberId=String(narasumber_id||'').trim();
    let cohortId=null,materialId=null,narasumberDbId=null;
    if(normalizedClassId){
      const[[cohort]]=await db.query('SELECT id,period_id FROM cohorts WHERE id=? AND period_id=?',[normalizedClassId,period_id]);
      if(!cohort) return res.status(400).json({message:'Angkatan tidak valid untuk periode'});
      cohortId=cohort.id;
    }
    if(normalizedMaterialId){
      const[[material]]=await db.query('SELECT id FROM survey_isc1_materials WHERE id=? AND period_id=? AND phase=?',[normalizedMaterialId,period_id,normalizedPhase]);
      if(!material) return res.status(400).json({message:`Materi ${phaseLabel(normalizedPhase)} tidak valid`});
      materialId=material.id;
    }
    if(normalizedNarasumberId){
      const[[narasumber]]=await db.query('SELECT id FROM survey_isc1_narasumbers WHERE id=? AND period_id=? AND phase=?',[normalizedNarasumberId,period_id,normalizedPhase]);
      if(!narasumber) return res.status(400).json({message:`Narasumber ${phaseLabel(normalizedPhase)} tidak valid`});
      narasumberDbId=narasumber.id;
    }
    const[[bank]]=await db.query('SELECT id FROM survey_banks WHERE id=?',[bank_id]);
    if(!bank) return res.status(400).json({message:'Bank instrumen tidak valid'});
    await db.query(
      `UPDATE survey_isc1_assignments SET period_id=?,phase=?,cohort_id=?,material_id=?,narasumber_id=?,bank_id=?,is_active=? WHERE id=?`,
      [period_id,normalizedPhase,cohortId,materialId,narasumberDbId,bank_id,is_active?1:0,id]
    );
    res.json({message:`Survei ${phaseLabel(normalizedPhase)} diperbarui`});
  }catch(e){
    if(e?.code==='ER_DUP_ENTRY') return res.status(400).json({message:`Survei ${phaseLabel(req.body?.phase)} untuk kombinasi angkatan, materi, dan narasumber ini sudah ada`});
    next(e);
  }
};

exports.removeMapping=async(req,res,next)=>{
  try{
    await ensureSurveyFoundationSchema();
    const[r]=await db.query('DELETE FROM survey_isc1_assignments WHERE id=?',[req.params.id]);
    if(!r.affectedRows) return res.status(404).json({message:'Mapping survei tidak ditemukan'});
    res.json({message:'Mapping survei dihapus'});
  }catch(e){next(e);}
};

exports.getOjcCategories=async(req,res,next)=>{
  try{
    const{period_id,target_role,is_active}=req.query;
    let q=`SELECT soc.*,p.label AS period_label,sb.title AS bank_title,u.name AS created_by_name
      FROM survey_ojc_categories soc
      JOIN periods p ON p.id=soc.period_id
      JOIN survey_banks sb ON sb.id=soc.bank_id
      JOIN users u ON u.id=soc.created_by
      WHERE 1=1`;
    const params=[];
    if(period_id){q+=' AND soc.period_id=?';params.push(period_id);}
    if(target_role){q+=' AND soc.target_role=?';params.push(target_role);}
    if(is_active!==undefined&&is_active!==''){q+=' AND soc.is_active=?';params.push(Number(is_active)?1:0);}
    q+=' ORDER BY soc.period_id DESC,soc.category_key,soc.id DESC';
    const[rows]=await db.query(q,params);
    res.json(rows);
  }catch(e){next(e);}
};

exports.createOjcCategory=async(req,res,next)=>{
  try{
    const{period_id,category_key,title,description,bank_id,target_role,is_active}=req.body;
    if(!period_id||!validCategory(category_key)||!title||!bank_id) return res.status(400).json({message:'period_id, category_key, title, bank_id wajib'});
    const[r]=await db.query(
      'INSERT INTO survey_ojc_categories (period_id,category_key,title,description,bank_id,target_role,is_active,created_by) VALUES (?,?,?,?,?,?,?,?)',
      [period_id,category_key,title,description||null,bank_id,target_role||'DOSEN',is_active===undefined?1:(is_active?1:0),req.user.id]
    );
    res.status(201).json({message:'Kategori survei OJC dibuat',id:r.insertId});
  }catch(e){next(e);}
};

exports.updateOjcCategory=async(req,res,next)=>{
  try{
    const{period_id,category_key,title,description,bank_id,target_role,is_active}=req.body;
    if(!period_id||!validCategory(category_key)||!title||!bank_id) return res.status(400).json({message:'Data kategori OJC tidak lengkap'});
    const[r]=await db.query(
      'UPDATE survey_ojc_categories SET period_id=?,category_key=?,title=?,description=?,bank_id=?,target_role=?,is_active=? WHERE id=?',
      [period_id,category_key,title,description||null,bank_id,target_role||'DOSEN',is_active?1:0,req.params.id]
    );
    if(!r.affectedRows) return res.status(404).json({message:'Kategori OJC tidak ditemukan'});
    res.json({message:'Kategori survei OJC diperbarui'});
  }catch(e){next(e);}
};

exports.removeOjcCategory=async(req,res,next)=>{
  try{
    const[r]=await db.query('DELETE FROM survey_ojc_categories WHERE id=?',[req.params.id]);
    if(!r.affectedRows) return res.status(404).json({message:'Kategori OJC tidak ditemukan'});
    res.json({message:'Kategori OJC dihapus'});
  }catch(e){next(e);}
};

exports.getActivations=async(req,res,next)=>{
  try{
    const{period_id,phase,is_active}=req.query;
    let q=`SELECT sa.*,p.label AS period_label,sb.title AS bank_title,soc.title AS ojc_category_title,u.name AS created_by_name,
            COUNT(sam.id) AS mapping_count
      FROM survey_activations sa
      JOIN periods p ON p.id=sa.period_id
      JOIN survey_banks sb ON sb.id=sa.bank_id
      LEFT JOIN survey_ojc_categories soc ON soc.id=sa.ojc_category_id
      JOIN users u ON u.id=sa.created_by
      LEFT JOIN survey_activation_mappings sam ON sam.activation_id=sa.id
      WHERE 1=1`;
    const params=[];
    if(period_id){q+=' AND sa.period_id=?';params.push(period_id);}
    if(phase){q+=' AND sa.phase=?';params.push(normalizePhase(phase));}
    if(is_active!==undefined&&is_active!==''){q+=' AND sa.is_active=?';params.push(Number(is_active)?1:0);}
    q+=' GROUP BY sa.id ORDER BY sa.period_id DESC,sa.phase,sa.id DESC';
    const[rows]=await db.query(q,params);
    res.json(rows.map(row=>({...row,mapping_count:Number(row.mapping_count||0)})));
  }catch(e){next(e);}
};

const resolveActivationPayload=async({period_id,phase,bank_id,title,description,target_role,ojc_category_id,mapping_ids})=>{
  await ensureSurveyFoundationSchema();
  const normalizedPhase=normalizePhase(phase);
  const mappingIds=[...new Set((Array.isArray(mapping_ids)?mapping_ids:[]).map(Number).filter(Boolean))];
  let effectiveBankId=bank_id||null;
  let effectiveTitle=title||'';
  let effectiveDescription=description||null;
  let effectiveOjcCategoryId=ojc_category_id||null;
  let bundleMappingIds=[];

  if(mappingIds.length){
    const ph=mappingIds.map(()=>'?').join(',');
    const[mapRows]=await db.query(
      `SELECT sia.id,sia.bank_id,sia.phase,p.label AS period_label
       FROM survey_isc1_assignments sia
       JOIN periods p ON p.id=sia.period_id
       WHERE sia.id IN (${ph}) AND sia.period_id=? AND sia.phase=? AND sia.is_active=1`,
      [...mappingIds,period_id,normalizedPhase]
    );
    if(mapRows.length!==mappingIds.length) throw Object.assign(new Error(`Ada survei ${phaseLabel(normalizedPhase)} yang tidak valid untuk periode ini`),{status:400});
    const bankIds=[...new Set(mapRows.map(m=>m.bank_id).filter(Boolean))];
    if(bankIds.length!==1) throw Object.assign(new Error(`Survei ${phaseLabel(normalizedPhase)} terpilih harus memakai bank instrumen yang sama`),{status:400});
    effectiveBankId=bankIds[0];
    effectiveTitle=title||`Survei ${phaseLabel(normalizedPhase)} - ${mapRows[0].period_label||period_id}`;
    effectiveDescription=description||null;
    effectiveOjcCategoryId=null;
    bundleMappingIds=mappingIds;
    return {effectiveBankId,effectiveTitle,effectiveDescription,effectiveOjcCategoryId,bundleMappingIds};
  }

  if(normalizedPhase==='ISC1') throw Object.assign(new Error('Pilih minimal 1 survei ISC1 untuk aktivasi'),{status:400});
  if(normalizedPhase==='OJC'){
    if(!ojc_category_id||!title) throw Object.assign(new Error('Pilih minimal 1 survei OJC untuk aktivasi'),{status:400});
    const[[ojcCategory]]=await db.query('SELECT id,period_id,bank_id FROM survey_ojc_categories WHERE id=? AND period_id=? AND is_active=1',[ojc_category_id,period_id]);
    if(!ojcCategory) throw Object.assign(new Error('Kategori OJC tidak valid untuk periode ini'),{status:400});
    effectiveBankId=ojcCategory.bank_id;
    effectiveOjcCategoryId=ojc_category_id||null;
  }

  return {effectiveBankId,effectiveTitle,effectiveDescription,effectiveOjcCategoryId,bundleMappingIds};
};

exports.createActivation=async(req,res,next)=>{
  try{
    const{period_id,phase,bank_id,title,description,target_role,ojc_category_id,opens_at,closes_at,is_active,lock_required,mapping_ids}=req.body;
    const normalizedPhase=normalizePhase(phase);
    if(!period_id||!validActivationPhase(normalizedPhase)) return res.status(400).json({message:'period_id dan phase wajib'});
    const{effectiveBankId,effectiveTitle,effectiveDescription,effectiveOjcCategoryId,bundleMappingIds}=await resolveActivationPayload({period_id,phase:normalizedPhase,bank_id,title,description,target_role,ojc_category_id,mapping_ids});
    const conn=await db.getConnection();
    try{
      await conn.beginTransaction();
      const[r]=await conn.query(
        `INSERT INTO survey_activations (period_id,phase,bank_id,title,description,target_role,ojc_category_id,opens_at,closes_at,is_active,lock_required,created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [period_id,normalizedPhase,effectiveBankId,effectiveTitle,effectiveDescription,target_role||'DOSEN',effectiveOjcCategoryId,opens_at||null,closes_at||null,is_active?1:0,lock_required===undefined?1:(lock_required?1:0),req.user.id]
      );
      const activationId=r.insertId;
      for(const mappingId of bundleMappingIds){
        await conn.query('INSERT INTO survey_activation_mappings (activation_id,mapping_id,isc1_assignment_id,bank_id) VALUES (?,?,?,?)',[activationId,null,mappingId,effectiveBankId]);
      }
      await conn.commit();
      res.status(201).json({message:'Aktivasi survei dibuat',id:activationId});
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }catch(e){
    if(e?.status) return res.status(e.status).json({message:e.message});
    next(e);
  }
};

exports.updateActivation=async(req,res,next)=>{
  try{
    const id=Number(req.params.id);
    const{period_id,phase,bank_id,title,description,target_role,ojc_category_id,opens_at,closes_at,is_active,lock_required,mapping_ids}=req.body;
    const normalizedPhase=normalizePhase(phase);
    if(!id||!period_id||!validActivationPhase(normalizedPhase)) return res.status(400).json({message:'Data aktivasi tidak lengkap'});
    const{effectiveBankId,effectiveTitle,effectiveDescription,effectiveOjcCategoryId,bundleMappingIds}=await resolveActivationPayload({period_id,phase:normalizedPhase,bank_id,title,description,target_role,ojc_category_id,mapping_ids});
    const conn=await db.getConnection();
    try{
      await conn.beginTransaction();
      const[r]=await conn.query(
        `UPDATE survey_activations SET period_id=?,phase=?,bank_id=?,title=?,description=?,target_role=?,ojc_category_id=?,opens_at=?,closes_at=?,is_active=?,lock_required=? WHERE id=?`,
        [period_id,normalizedPhase,effectiveBankId,effectiveTitle,effectiveDescription,target_role||'DOSEN',effectiveOjcCategoryId,opens_at||null,closes_at||null,is_active?1:0,lock_required===undefined?1:(lock_required?1:0),id]
      );
      if(!r.affectedRows) throw Object.assign(new Error('Aktivasi tidak ditemukan'),{status:404});
      await conn.query('DELETE FROM survey_activation_mappings WHERE activation_id=?',[id]);
      for(const mappingId of bundleMappingIds){
        await conn.query('INSERT INTO survey_activation_mappings (activation_id,mapping_id,isc1_assignment_id,bank_id) VALUES (?,?,?,?)',[id,null,mappingId,effectiveBankId]);
      }
      await conn.commit();
      res.json({message:'Aktivasi survei diperbarui'});
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }catch(e){
    if(e?.status) return res.status(e.status).json({message:e.message});
    next(e);
  }
};

exports.removeActivation=async(req,res,next)=>{
  try{
    const[r]=await db.query('DELETE FROM survey_activations WHERE id=?',[req.params.id]);
    if(!r.affectedRows) return res.status(404).json({message:'Aktivasi tidak ditemukan'});
    res.json({message:'Aktivasi survei dihapus'});
  }catch(e){next(e);}
};
