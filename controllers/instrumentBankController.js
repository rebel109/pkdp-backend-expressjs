const db=require('../config/db');

exports.getAll=async(req,res,next)=>{
  try{
    const{period_id,phase,status}=req.query;
    let q=`SELECT ib.*,u.name AS created_by_name,p.label AS period_label,COUNT(iba.id) AS aspect_count
           FROM instrument_banks ib
           JOIN users u ON u.id=ib.created_by
           LEFT JOIN periods p ON p.id=ib.period_id
           LEFT JOIN instrument_bank_aspects iba ON iba.bank_id=ib.id
           WHERE 1=1`;
    const params=[];
    if(period_id){q+=' AND ib.period_id=?';params.push(period_id);}
    if(phase){q+=' AND ib.phase=?';params.push(phase);}
    if(status){q+=' AND ib.status=?';params.push(status);}
    q+=' GROUP BY ib.id ORDER BY ib.created_at DESC';
    const[rows]=await db.query(q,params);
    res.json(rows);
  }catch(e){next(e);}
};

exports.getOne=async(req,res,next)=>{
  try{
    const[[bank]]=await db.query('SELECT * FROM instrument_banks WHERE id=?',[req.params.id]);
    if(!bank) return res.status(404).json({message:'Bank instrumen tidak ditemukan'});
    const[aspects]=await db.query('SELECT * FROM instrument_bank_aspects WHERE bank_id=? ORDER BY order_no,id',[req.params.id]);
    res.json({...bank,aspects});
  }catch(e){next(e);}
};

exports.create=async(req,res,next)=>{
  try{
    const{period_id,phase,title,description,max_score,status}=req.body;
    if(!phase||!title) return res.status(400).json({message:'phase dan title wajib'});
    const[r]=await db.query(
      'INSERT INTO instrument_banks (period_id,phase,title,description,max_score,status,created_by) VALUES (?,?,?,?,?,?,?)',
      [period_id||null,phase,title,description||null,max_score||90,status||'draft',req.user.id]
    );
    res.status(201).json({message:'Bank instrumen dibuat',id:r.insertId});
  }catch(e){next(e);}
};

exports.update=async(req,res,next)=>{
  try{
    const{period_id,phase,title,description,max_score,status}=req.body;
    await db.query('UPDATE instrument_banks SET period_id=?,phase=?,title=?,description=?,max_score=?,status=? WHERE id=?',[period_id||null,phase,title,description||null,max_score||90,status||'draft',req.params.id]);
    res.json({message:'Bank instrumen diperbarui'});
  }catch(e){next(e);}
};

exports.remove=async(req,res,next)=>{try{await db.query('DELETE FROM instrument_banks WHERE id=?',[req.params.id]);res.json({message:'Bank instrumen dihapus'});}catch(e){next(e);}};

exports.addAspect=async(req,res,next)=>{
  try{
    const{order_no,aspect_name,score_3,score_2,score_1}=req.body;
    if(!aspect_name) return res.status(400).json({message:'aspect_name wajib'});
    const[r]=await db.query('INSERT INTO instrument_bank_aspects (bank_id,order_no,aspect_name,score_3,score_2,score_1) VALUES (?,?,?,?,?,?)',[req.params.id,order_no||1,aspect_name,score_3||'Baik',score_2||'Cukup',score_1||'Kurang']);
    res.status(201).json({message:'Aspek instrumen ditambahkan',id:r.insertId});
  }catch(e){next(e);}
};

exports.removeAspect=async(req,res,next)=>{try{await db.query('DELETE FROM instrument_bank_aspects WHERE id=?',[req.params.aspectId]);res.json({message:'Aspek instrumen dihapus'});}catch(e){next(e);}};