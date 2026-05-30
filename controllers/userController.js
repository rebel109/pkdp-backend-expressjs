const bcrypt=require('bcrypt'),db=require('../config/db');
const { saveProfileSnapshot } = require('../utils/profileSnapshot');
const { normalizeDateOnly } = require('../utils/date');
exports.getAll=async(req,res,next)=>{
  try{
    const{role,status,period_id,search}=req.query;
    let q=`SELECT u.id,u.name,u.email,u.role,u.status,u.payment_status,u.dosen_verification_status,u.narasumber_status,u.period_id,u.created_at,
                  p.label AS period_label, p.year AS period_year,
                  pr.nip,pr.nidn,pr.phone,pr.unit_kerja,pr.institution,pr.department
           FROM users u LEFT JOIN periods p ON p.id=u.period_id LEFT JOIN profiles pr ON pr.user_id=u.id WHERE 1=1`;
    const params=[];
    if(role){q+=' AND u.role=?';params.push(role);}
    if(status){q+=' AND u.status=?';params.push(status);}
    if(period_id){q+=' AND u.period_id=?';params.push(period_id);}
    if(search){
      const s=`%${String(search).trim()}%`;
      q+=' AND (u.name LIKE ? OR u.email LIKE ? OR pr.nip LIKE ? OR pr.nidn LIKE ? OR pr.phone LIKE ? OR pr.institution LIKE ? OR pr.department LIKE ?)';
      params.push(s,s,s,s,s,s,s);
    }
    q+=' ORDER BY u.created_at DESC';
    const[rows]=await db.query(q,params);res.json(rows);
  }catch(e){next(e);}
};
exports.getOne=async(req,res,next)=>{
  try{
    const[rows]=await db.query(
      `SELECT u.id,u.name,u.email,u.role,u.status,u.payment_status,u.dosen_verification_status,u.dosen_verification_reject_reason,u.narasumber_status,u.period_id,u.created_at,
              p.label AS period_label,
              pr.full_name_with_title,pr.full_name_without_title,
              pr.avatar_url,pr.gender,pr.nik,pr.nidn,pr.nip,pr.nuptk,
              pr.birthplace,pr.birthdate,pr.unit_kerja,pr.province,pr.institution,
              pr.department,pr.city,pr.employee_status,pr.sk_file,pr.tmt_sk_dosen,
              pr.functional_title,pr.functional_title_file,pr.diploma_file,
              pr.golongan,pr.npwp,pr.phone,pr.address,pr.bio,
              pr.rekening_no,pr.rekening_name,pr.bank_name,pr.cv_file,pr.rekening_file
       FROM users u LEFT JOIN periods p ON p.id=u.period_id
       LEFT JOIN profiles pr ON pr.user_id=u.id WHERE u.id=?`,[req.params.id]);
    if(!rows.length) return res.status(404).json({message:'User tidak ditemukan'});
    res.json(rows[0]);
  }catch(e){next(e);}
};
exports.update=async(req,res,next)=>{
  try{
    const tid=parseInt(req.params.id);
    if(req.user.role!=='ADMIN'&&req.user.id!==tid) return res.status(403).json({message:'Akses ditolak'});
    const{name,email,password,role,period_id,status}=req.body;
    const sets=[],params=[];
    if(name){sets.push('name=?');params.push(name);}
    if(email){sets.push('email=?');params.push(email);}
    if(password){sets.push('password=?');params.push(await bcrypt.hash(password,12));}
    if(req.user.role==='ADMIN'){
      if(role){sets.push('role=?');params.push(role);}
      if(period_id!==undefined){sets.push('period_id=?');params.push(period_id||null);}
      if(status){sets.push('status=?');params.push(status);}
    }
    if(!sets.length) return res.status(400).json({message:'Tidak ada data yang diubah'});
    params.push(tid);
    await db.query(`UPDATE users SET ${sets.join(',')} WHERE id=?`,params);
    res.json({message:'User diperbarui'});
  }catch(e){next(e);}
};
exports.remove=async(req,res,next)=>{try{await db.query('DELETE FROM users WHERE id=?',[req.params.id]);res.json({message:'User dihapus'});}catch(e){next(e);}};
exports.toggleBlock=async(req,res,next)=>{
  try{
    const[[u]]=await db.query('SELECT status FROM users WHERE id=?',[req.params.id]);
    if(!u) return res.status(404).json({message:'User tidak ditemukan'});
    const s=u.status==='active'?'blocked':'active';
    await db.query('UPDATE users SET status=? WHERE id=?',[s,req.params.id]);
    res.json({message:`User ${s}`,status:s});
  }catch(e){next(e);}
};
exports.getProfile=async(req,res,next)=>{
  try{
    const[[p]]=await db.query(`SELECT pr.*,c.name AS selected_class_name,c.phase,u.dosen_verification_status,u.dosen_verification_reject_reason FROM profiles pr LEFT JOIN classes c ON c.id=pr.selected_class_id LEFT JOIN users u ON u.id=pr.user_id WHERE pr.user_id=?`,[req.user.id]);
    res.json(p||{});
  }catch(e){next(e);}
};
exports.getHistory=async(req,res,next)=>{
  try{
    const[roles]=await db.query(
      `SELECT upr.id,upr.period_id,upr.role,upr.status,upr.source_type,upr.source_id,upr.created_at,
              p.label AS period_label,p.year AS period_year
       FROM user_period_roles upr
       LEFT JOIN periods p ON p.id=upr.period_id
       WHERE upr.user_id=?
       ORDER BY p.year DESC,p.id DESC,upr.created_at DESC`,
      [req.user.id]
    );
    const[narasumberSubmissions]=await db.query(
      `SELECT ns.id,ns.period_id,ns.consent_file,ns.status,ns.reviewed_at,ns.reject_reason,ns.created_at,
              p.label AS period_label,p.year AS period_year,
              reviewer.name AS reviewed_by_name
       FROM narasumber_submissions ns
       LEFT JOIN periods p ON p.id=ns.period_id
       LEFT JOIN users reviewer ON reviewer.id=ns.reviewed_by
       WHERE ns.user_id=?
       ORDER BY p.year DESC,p.id DESC,ns.created_at DESC,ns.id DESC`,
      [req.user.id]
    );
    res.json({roles,narasumberSubmissions});
  }catch(e){next(e);}
};
exports.verifyPassword=async(req,res,next)=>{
  try{
    const{password}=req.body;
    if(!password) return res.status(400).json({message:'Password wajib diisi'});
    const[[u]]=await db.query('SELECT password FROM users WHERE id=?',[req.user.id]);
    if(!u) return res.status(404).json({message:'User tidak ditemukan'});
    const match=await bcrypt.compare(password,u.password);
    if(!match) return res.status(401).json({message:'Password salah'});
    res.json({message:'Verified'});
  }catch(e){next(e);}
};
exports.updateProfile=async(req,res,next)=>{
  try{
    const{full_name_with_title,full_name_without_title,avatar_url,gender,nik,nidn,birthplace,birthdate,unit_kerja,province,city,employee_status,sk_file,tmt_sk_dosen,functional_title,functional_title_file,diploma_file,golongan,npwp,nip,nuptk,institution,department,phone,address,bio,name,email,rekening_no,rekening_name,bank_name,cv_file,rekening_file}=req.body;
    const normalizedTmtSkDosen = normalizeDateOnly(tmt_sk_dosen);
    if(req.user.role==='DOSEN'){
      const required={
        full_name_with_title,
        full_name_without_title,
        avatar_url,
        gender,
        nik,
        nidn,
        birthplace,
        birthdate,
        unit_kerja,
        institution,
        province,
        city,
        employee_status,
        sk_file,
        functional_title,
        functional_title_file,
        diploma_file,
        golongan,
        npwp,
        nip,
        nuptk,
        phone,
        address,
        bio
      };
      for(const [key,val] of Object.entries(required)){
        if(val===undefined||val===null||String(val).trim()==='') return res.status(400).json({message:`Field ${key} wajib diisi`});
      }
    }

    await db.query(
      `INSERT INTO profiles (user_id,full_name_with_title,full_name_without_title,avatar_url,gender,nik,nidn,birthplace,birthdate,unit_kerja,province,city,employee_status,sk_file,tmt_sk_dosen,functional_title,functional_title_file,diploma_file,golongan,npwp,nip,nuptk,institution,department,phone,address,bio,rekening_no,rekening_name,bank_name,cv_file,rekening_file) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE full_name_with_title=VALUES(full_name_with_title),full_name_without_title=VALUES(full_name_without_title),avatar_url=VALUES(avatar_url),gender=VALUES(gender),nik=VALUES(nik),nidn=VALUES(nidn),birthplace=VALUES(birthplace),birthdate=VALUES(birthdate),unit_kerja=VALUES(unit_kerja),province=VALUES(province),city=VALUES(city),employee_status=VALUES(employee_status),sk_file=VALUES(sk_file),tmt_sk_dosen=VALUES(tmt_sk_dosen),functional_title=VALUES(functional_title),functional_title_file=VALUES(functional_title_file),diploma_file=VALUES(diploma_file),golongan=VALUES(golongan),npwp=VALUES(npwp),nip=VALUES(nip),nuptk=VALUES(nuptk),institution=VALUES(institution),department=VALUES(department),phone=VALUES(phone),address=VALUES(address),bio=VALUES(bio),rekening_no=VALUES(rekening_no),rekening_name=VALUES(rekening_name),bank_name=VALUES(bank_name),cv_file=VALUES(cv_file),rekening_file=VALUES(rekening_file)`,
      [req.user.id,full_name_with_title||null,full_name_without_title||null,avatar_url,gender,nik,nidn,birthplace,birthdate,unit_kerja,province,city,employee_status,sk_file,normalizedTmtSkDosen,functional_title,functional_title_file,diploma_file,golongan,npwp,nip,nuptk,institution,department,phone,address,bio,rekening_no||null,rekening_name||null,bank_name||null,cv_file||null,rekening_file||null]);

    // Update user name/email if provided
    const userUpdates=[],userParams=[];
    if(name){userUpdates.push('name=?');userParams.push(name);}
    if(email){userUpdates.push('email=?');userParams.push(email);}
    if(userUpdates.length){userParams.push(req.user.id);await db.query(`UPDATE users SET ${userUpdates.join(',')} WHERE id=?`,userParams);}

    // Check profile completion (for DOSEN only)
    if(req.user.role==='DOSEN'){
      const[[p]]=await db.query('SELECT full_name_with_title,full_name_without_title,avatar_url,gender,nik,nidn,birthplace,birthdate,unit_kerja,province,institution,city,employee_status,sk_file,functional_title,functional_title_file,diploma_file,golongan,npwp,nip,nuptk,phone,address,bio FROM profiles WHERE user_id=?',[req.user.id]);
      const isComplete= !!(p&&p.full_name_with_title&&p.full_name_without_title&&p.avatar_url&&p.gender&&p.nik&&p.nidn&&p.birthplace&&p.birthdate&&p.unit_kerja&&p.province&&p.institution&&p.city&&p.employee_status&&p.sk_file&&p.functional_title&&p.functional_title_file&&p.diploma_file&&p.golongan&&p.npwp&&p.nip&&p.nuptk&&p.phone&&p.address&&p.bio);
      await db.query('UPDATE users SET profile_complete=? WHERE id=?',[isComplete?1:0,req.user.id]);
    } else if(req.user.role==='NARASUMBER'){
      await db.query('UPDATE users SET profile_complete=1 WHERE id=?',[req.user.id]);
    }

    const [[u]] = await db.query('SELECT role,period_id FROM users WHERE id=?',[req.user.id]);
    if(u?.period_id && (u.role==='DOSEN'||u.role==='NARASUMBER')) await saveProfileSnapshot(req.user.id,u.period_id,u.role,null);

    res.json({message:'Profil diperbarui'});
  }catch(e){next(e);}
};
exports.selectClass=async(req,res,next)=>{
  try{
    const{class_id}=req.body;
    if(!class_id) return res.status(400).json({message:'class_id wajib diisi'});
    
    // Check if class exists
    const[[cls]]=await db.query('SELECT id FROM classes WHERE id=?',[class_id]);
    if(!cls) return res.status(404).json({message:'Kelas tidak ditemukan'});
    
    // Check if selection is already locked
    const[[profile]]=await db.query('SELECT class_selection_locked FROM profiles WHERE user_id=?',[req.user.id]);
    if(profile&&profile.class_selection_locked) return res.status(403).json({message:'Pilihan kelas sudah terkunci dan tidak bisa diubah'});
    
    // Save class selection and lock it
    await db.query('UPDATE profiles SET selected_class_id=?,class_selection_locked=1 WHERE user_id=?',[class_id,req.user.id]);
    
    // Also add user to class_members if not already there
    await db.query('INSERT IGNORE INTO class_members (class_id,user_id) VALUES (?,?)',[class_id,req.user.id]);
    
    res.json({message:'Kelas berhasil disimpan dan terkunci'});
  }catch(e){next(e);}
};
