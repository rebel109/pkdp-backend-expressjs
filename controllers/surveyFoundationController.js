const db=require('../config/db');

const validPhase=phase=>['ISC1'].includes(String(phase||''));
const validActivationPhase=phase=>['ISC1','OJC'].includes(String(phase||''));
const validCategory=key=>['narasumber','panitia','sarpras','lainnya'].includes(String(key||''));

const assignmentSelect=`SELECT sia.*,p.label AS period_label,co.cohort_no,sim.name AS material_name,sin.name AS narasumber_name,sb.title AS bank_title
  FROM survey_isc1_assignments sia
  JOIN periods p ON p.id=sia.period_id
  JOIN cohorts co ON co.id=sia.cohort_id
  JOIN survey_isc1_materials sim ON sim.id=sia.material_id
  JOIN survey_isc1_narasumbers sin ON sin.id=sia.narasumber_id
  JOIN survey_banks sb ON sb.id=sia.bank_id`;

exports.getIsc1Materials=async(req,res,next)=>{
  try{
    const{period_id,is_active}=req.query;
    let q=`SELECT sim.*,p.label AS period_label,u.name AS created_by_name
      FROM survey_isc1_materials sim
      JOIN periods p ON p.id=sim.period_id
      JOIN users u ON u.id=sim.created_by
      WHERE 1=1`;
    const params=[];
    if(period_id){q+=' AND sim.period_id=?';params.push(period_id);}
    if(is_active!==undefined&&is_active!==''){q+=' AND sim.is_active=?';params.push(Number(is_active)?1:0);}
    q+=' ORDER BY sim.period_id DESC,sim.name,sim.id DESC';
    const[rows]=await db.query(q,params);
    res.json(rows);
  }catch(e){next(e);}
};

exports.createIsc1Material=async(req,res,next)=>{
  try{
    const{period_id,name,is_active}=req.body;
    if(!period_id||!String(name||'').trim()) return res.status(400).json({message:'period_id dan nama materi wajib'});
    const[r]=await db.query(
      'INSERT INTO survey_isc1_materials (period_id,name,is_active,created_by) VALUES (?,?,?,?)',
      [period_id,String(name).trim(),is_active===undefined?1:(is_active?1:0),req.user.id]
    );
    res.status(201).json({message:'Materi ISC1 dibuat',id:r.insertId});
  }catch(e){
    if(e?.code==='ER_DUP_ENTRY') return res.status(400).json({message:'Nama materi ISC1 sudah ada pada periode ini'});
    next(e);
  }
};

exports.updateIsc1Material=async(req,res,next)=>{
  try{
    const{period_id,name,is_active}=req.body;
    if(!period_id||!String(name||'').trim()) return res.status(400).json({message:'period_id dan nama materi wajib'});
    const[r]=await db.query('UPDATE survey_isc1_materials SET period_id=?,name=?,is_active=? WHERE id=?',[period_id,String(name).trim(),is_active?1:0,req.params.id]);
    if(!r.affectedRows) return res.status(404).json({message:'Materi ISC1 tidak ditemukan'});
    res.json({message:'Materi ISC1 diperbarui'});
  }catch(e){
    if(e?.code==='ER_DUP_ENTRY') return res.status(400).json({message:'Nama materi ISC1 sudah ada pada periode ini'});
    next(e);
  }
};

exports.removeIsc1Material=async(req,res,next)=>{
  try{
    const[r]=await db.query('DELETE FROM survey_isc1_materials WHERE id=?',[req.params.id]);
    if(!r.affectedRows) return res.status(404).json({message:'Materi ISC1 tidak ditemukan'});
    res.json({message:'Materi ISC1 dihapus'});
  }catch(e){next(e);}
};

exports.getIsc1Narasumbers=async(req,res,next)=>{
  try{
    const{period_id,is_active}=req.query;
    let q=`SELECT sin.*,p.label AS period_label,u.name AS created_by_name
      FROM survey_isc1_narasumbers sin
      JOIN periods p ON p.id=sin.period_id
      JOIN users u ON u.id=sin.created_by
      WHERE 1=1`;
    const params=[];
    if(period_id){q+=' AND sin.period_id=?';params.push(period_id);}
    if(is_active!==undefined&&is_active!==''){q+=' AND sin.is_active=?';params.push(Number(is_active)?1:0);}
    q+=' ORDER BY sin.period_id DESC,sin.name,sin.id DESC';
    const[rows]=await db.query(q,params);
    res.json(rows);
  }catch(e){next(e);}
};

exports.createIsc1Narasumber=async(req,res,next)=>{
  try{
    const{period_id,name,is_active}=req.body;
    if(!period_id||!String(name||'').trim()) return res.status(400).json({message:'period_id dan nama narasumber wajib'});
    const[r]=await db.query(
      'INSERT INTO survey_isc1_narasumbers (period_id,name,is_active,created_by) VALUES (?,?,?,?)',
      [period_id,String(name).trim(),is_active===undefined?1:(is_active?1:0),req.user.id]
    );
    res.status(201).json({message:'Narasumber ISC1 dibuat',id:r.insertId});
  }catch(e){
    if(e?.code==='ER_DUP_ENTRY') return res.status(400).json({message:'Nama narasumber ISC1 sudah ada pada periode ini'});
    next(e);
  }
};

exports.updateIsc1Narasumber=async(req,res,next)=>{
  try{
    const{period_id,name,is_active}=req.body;
    if(!period_id||!String(name||'').trim()) return res.status(400).json({message:'period_id dan nama narasumber wajib'});
    const[r]=await db.query('UPDATE survey_isc1_narasumbers SET period_id=?,name=?,is_active=? WHERE id=?',[period_id,String(name).trim(),is_active?1:0,req.params.id]);
    if(!r.affectedRows) return res.status(404).json({message:'Narasumber ISC1 tidak ditemukan'});
    res.json({message:'Narasumber ISC1 diperbarui'});
  }catch(e){
    if(e?.code==='ER_DUP_ENTRY') return res.status(400).json({message:'Nama narasumber ISC1 sudah ada pada periode ini'});
    next(e);
  }
};

exports.removeIsc1Narasumber=async(req,res,next)=>{
  try{
    const[r]=await db.query('DELETE FROM survey_isc1_narasumbers WHERE id=?',[req.params.id]);
    if(!r.affectedRows) return res.status(404).json({message:'Narasumber ISC1 tidak ditemukan'});
    res.json({message:'Narasumber ISC1 dihapus'});
  }catch(e){next(e);}
};

exports.getMappings=async(req,res,next)=>{
  try{
    const{phase,period_id,class_id,is_active,cohort_id}=req.query;
    if(phase&&phase!=='ISC1') return res.json([]);
    let q=`${assignmentSelect} WHERE 1=1`;
    const params=[];
    if(period_id){q+=' AND sia.period_id=?';params.push(period_id);}
    if(cohort_id){q+=' AND sia.cohort_id=?';params.push(cohort_id);}
    if(class_id){q+=' AND sia.cohort_id=?';params.push(class_id);}
    if(is_active!==undefined&&is_active!==''){q+=' AND sia.is_active=?';params.push(Number(is_active)?1:0);}
    q+=' ORDER BY co.cohort_no,sim.name,sin.name,sia.id';
    const[rows]=await db.query(q,params);
    res.json(rows.map(r=>({...r,class_id:r.cohort_id,class_name:r.cohort_no?`Angkatan ${r.cohort_no}`:'Tanpa Angkatan',material_title:r.material_name})));
  }catch(e){next(e);}
};

exports.createMapping=async(req,res,next)=>{
  try{
    const{phase,period_id,class_id,material_title,narasumber_id,bank_id,is_active}=req.body;
    if(!validPhase(phase)||!period_id||!class_id||!material_title||!narasumber_id||!bank_id) return res.status(400).json({message:'phase, period_id, angkatan, materi, narasumber, bank_id wajib'});
    const[[cohort]]=await db.query('SELECT id,period_id FROM cohorts WHERE id=? AND period_id=?',[class_id,period_id]);
    if(!cohort) return res.status(400).json({message:'Angkatan tidak valid untuk periode'});
    const[[material]]=await db.query('SELECT id,name FROM survey_isc1_materials WHERE id=? AND period_id=? AND is_active=1',[material_title,period_id]);
    if(!material) return res.status(400).json({message:'Materi ISC1 tidak valid'});
    const[[narasumber]]=await db.query('SELECT id,name FROM survey_isc1_narasumbers WHERE id=? AND period_id=? AND is_active=1',[narasumber_id,period_id]);
    if(!narasumber) return res.status(400).json({message:'Narasumber ISC1 tidak valid'});
    const[[bank]]=await db.query('SELECT id FROM survey_banks WHERE id=?',[bank_id]);
    if(!bank) return res.status(400).json({message:'Bank instrumen tidak valid'});
    const[r]=await db.query(
      `INSERT INTO survey_isc1_assignments (period_id,cohort_id,material_id,narasumber_id,bank_id,is_active,created_by)
       VALUES (?,?,?,?,?,?,?)`,
      [period_id,class_id,material.id,narasumber.id,bank_id,is_active===undefined?1:(is_active?1:0),req.user.id]
    );
    res.status(201).json({message:'Survei ISC1 dibuat',id:r.insertId});
  }catch(e){
    if(e?.code==='ER_DUP_ENTRY') return res.status(400).json({message:'Survei ISC1 untuk kombinasi angkatan, materi, dan narasumber ini sudah ada'});
    next(e);
  }
};

exports.updateMapping=async(req,res,next)=>{
  try{
    const id=Number(req.params.id);
    const{phase,period_id,class_id,material_title,narasumber_id,bank_id,is_active}=req.body;
    if(!id||!validPhase(phase)||!period_id||!class_id||!material_title||!narasumber_id||!bank_id) return res.status(400).json({message:'Data survei ISC1 tidak lengkap'});
    const[[exists]]=await db.query('SELECT id FROM survey_isc1_assignments WHERE id=?',[id]);
    if(!exists) return res.status(404).json({message:'Survei ISC1 tidak ditemukan'});
    const[[cohort]]=await db.query('SELECT id,period_id FROM cohorts WHERE id=? AND period_id=?',[class_id,period_id]);
    if(!cohort) return res.status(400).json({message:'Angkatan tidak valid untuk periode'});
    const[[material]]=await db.query('SELECT id FROM survey_isc1_materials WHERE id=? AND period_id=?',[material_title,period_id]);
    if(!material) return res.status(400).json({message:'Materi ISC1 tidak valid'});
    const[[narasumber]]=await db.query('SELECT id FROM survey_isc1_narasumbers WHERE id=? AND period_id=?',[narasumber_id,period_id]);
    if(!narasumber) return res.status(400).json({message:'Narasumber ISC1 tidak valid'});
    const[[bank]]=await db.query('SELECT id FROM survey_banks WHERE id=?',[bank_id]);
    if(!bank) return res.status(400).json({message:'Bank instrumen tidak valid'});
    await db.query(
      `UPDATE survey_isc1_assignments SET period_id=?,cohort_id=?,material_id=?,narasumber_id=?,bank_id=?,is_active=? WHERE id=?`,
      [period_id,class_id,material.id,narasumber.id,bank_id,is_active?1:0,id]
    );
    res.json({message:'Survei ISC1 diperbarui'});
  }catch(e){
    if(e?.code==='ER_DUP_ENTRY') return res.status(400).json({message:'Survei ISC1 untuk kombinasi angkatan, materi, dan narasumber ini sudah ada'});
    next(e);
  }
};

exports.removeMapping=async(req,res,next)=>{
  try{
    const[r]=await db.query('DELETE FROM survey_isc1_assignments WHERE id=?',[req.params.id]);
    if(!r.affectedRows) return res.status(404).json({message:'Survei ISC1 tidak ditemukan'});
    res.json({message:'Survei ISC1 dihapus'});
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
    res.json({message:'Kategori survei OJC dihapus'});
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
    if(phase){q+=' AND sa.phase=?';params.push(phase);}
    if(is_active!==undefined&&is_active!==''){q+=' AND sa.is_active=?';params.push(Number(is_active)?1:0);}
    q+=' GROUP BY sa.id ORDER BY sa.period_id DESC,sa.phase,sa.id DESC';
    const[rows]=await db.query(q,params);
    res.json(rows);
  }catch(e){next(e);}
};

exports.createActivation=async(req,res,next)=>{
  try{
    const{period_id,phase,bank_id,title,description,target_role,ojc_category_id,opens_at,closes_at,is_active,lock_required,mapping_ids}=req.body;
    if(!period_id||!validActivationPhase(phase)) return res.status(400).json({message:'period_id dan phase wajib'});
    const mappingIds=[...new Set((Array.isArray(mapping_ids)?mapping_ids:[]).map(Number).filter(Boolean))];
    let effectiveBankId=bank_id||null,effectiveTitle=title||'',effectiveDescription=description||null;
    if(phase==='ISC1'){
      if(!mappingIds.length) return res.status(400).json({message:'Pilih minimal 1 survei ISC1 untuk aktivasi'});
      const ph=mappingIds.map(()=>'?').join(',');
      const[mapRows]=await db.query(`SELECT sia.id,sia.bank_id,p.label AS period_label FROM survey_isc1_assignments sia JOIN periods p ON p.id=sia.period_id WHERE sia.id IN (${ph}) AND sia.period_id=? AND sia.is_active=1`,[...mappingIds,period_id]);
      if(mapRows.length!==mappingIds.length) return res.status(400).json({message:'Ada survei ISC1 yang tidak valid untuk periode ini'});
      const bankIds=[...new Set(mapRows.map(m=>m.bank_id).filter(Boolean))];
      if(bankIds.length!==1) return res.status(400).json({message:'Survei ISC1 terpilih harus memakai bank instrumen yang sama'});
      effectiveBankId=bankIds[0];
      effectiveTitle=title||`Survei ISC1 - ${mapRows[0].period_label||period_id}`;
      effectiveDescription=description||null;
    }else{
      if(!ojc_category_id||!title) return res.status(400).json({message:'ojc_category_id dan title wajib untuk aktivasi OJC'});
      const[[ojcCategory]]=await db.query('SELECT id,period_id,bank_id FROM survey_ojc_categories WHERE id=? AND period_id=? AND is_active=1',[ojc_category_id,period_id]);
      if(!ojcCategory) return res.status(400).json({message:'Kategori OJC tidak valid untuk periode ini'});
      effectiveBankId=ojcCategory.bank_id;
    }
    const conn=await db.getConnection();
    try{
      await conn.beginTransaction();
      const[r]=await conn.query(
        `INSERT INTO survey_activations (period_id,phase,bank_id,title,description,target_role,ojc_category_id,opens_at,closes_at,is_active,lock_required,created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [period_id,phase,effectiveBankId,effectiveTitle,effectiveDescription,target_role||'DOSEN',ojc_category_id||null,opens_at||null,closes_at||null,is_active?1:0,lock_required===undefined?1:(lock_required?1:0),req.user.id]
      );
      const activationId=r.insertId;
      if(phase==='ISC1'){
        for(const mappingId of mappingIds){
          await conn.query('INSERT INTO survey_activation_mappings (activation_id,mapping_id,isc1_assignment_id,bank_id) VALUES (?,?,?,?)',[activationId,null,mappingId,effectiveBankId]);
        }
      }
      await conn.commit();
      res.status(201).json({message:'Aktivasi survei dibuat',id:activationId});
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }catch(e){next(e);}
};

exports.updateActivation=async(req,res,next)=>{
  try{
    const id=Number(req.params.id);
    const{period_id,phase,bank_id,title,description,target_role,ojc_category_id,opens_at,closes_at,is_active,lock_required,mapping_ids}=req.body;
    if(!id||!period_id||!validActivationPhase(phase)) return res.status(400).json({message:'Data aktivasi tidak lengkap'});
    const mappingIds=[...new Set((Array.isArray(mapping_ids)?mapping_ids:[]).map(Number).filter(Boolean))];
    let effectiveBankId=bank_id||null,effectiveTitle=title||'',effectiveDescription=description||null;
    if(phase==='ISC1'){
      if(!mappingIds.length) return res.status(400).json({message:'Pilih minimal 1 survei ISC1 untuk aktivasi'});
      const ph=mappingIds.map(()=>'?').join(',');
      const[mapRows]=await db.query(`SELECT sia.id,sia.bank_id,p.label AS period_label FROM survey_isc1_assignments sia JOIN periods p ON p.id=sia.period_id WHERE sia.id IN (${ph}) AND sia.period_id=? AND sia.is_active=1`,[...mappingIds,period_id]);
      if(mapRows.length!==mappingIds.length) return res.status(400).json({message:'Ada survei ISC1 yang tidak valid untuk periode ini'});
      const bankIds=[...new Set(mapRows.map(m=>m.bank_id).filter(Boolean))];
      if(bankIds.length!==1) return res.status(400).json({message:'Survei ISC1 terpilih harus memakai bank instrumen yang sama'});
      effectiveBankId=bankIds[0];
      effectiveTitle=title||`Survei ISC1 - ${mapRows[0].period_label||period_id}`;
      effectiveDescription=description||null;
    }else{
      if(!ojc_category_id||!title) return res.status(400).json({message:'ojc_category_id dan title wajib untuk aktivasi OJC'});
      const[[ojcCategory]]=await db.query('SELECT id,period_id,bank_id FROM survey_ojc_categories WHERE id=? AND period_id=? AND is_active=1',[ojc_category_id,period_id]);
      if(!ojcCategory) return res.status(400).json({message:'Kategori OJC tidak valid untuk periode ini'});
      effectiveBankId=ojcCategory.bank_id;
    }
    const conn=await db.getConnection();
    try{
      await conn.beginTransaction();
      const[r]=await conn.query(
        `UPDATE survey_activations SET period_id=?,phase=?,bank_id=?,title=?,description=?,target_role=?,ojc_category_id=?,opens_at=?,closes_at=?,is_active=?,lock_required=? WHERE id=?`,
        [period_id,phase,effectiveBankId,effectiveTitle,effectiveDescription,target_role||'DOSEN',ojc_category_id||null,opens_at||null,closes_at||null,is_active?1:0,lock_required?1:0,id]
      );
      if(!r.affectedRows) throw Object.assign(new Error('Aktivasi tidak ditemukan'),{status:404});
      await conn.query('DELETE FROM survey_activation_mappings WHERE activation_id=?',[id]);
      if(phase==='ISC1'){
        for(const mappingId of mappingIds){
          await conn.query('INSERT INTO survey_activation_mappings (activation_id,mapping_id,isc1_assignment_id,bank_id) VALUES (?,?,?,?)',[id,null,mappingId,effectiveBankId]);
        }
      }
      await conn.commit();
      res.json({message:'Aktivasi survei diperbarui'});
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }catch(e){next(e);}
};

exports.removeActivation=async(req,res,next)=>{
  try{
    const[r]=await db.query('DELETE FROM survey_activations WHERE id=?',[req.params.id]);
    if(!r.affectedRows) return res.status(404).json({message:'Aktivasi tidak ditemukan'});
    res.json({message:'Aktivasi survei dihapus'});
  }catch(e){next(e);}
};
