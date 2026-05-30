const db=require('../config/db'),fs=require('fs'),path=require('path');
const VALID_PHASES=['ISC1','OJC','ISC2','GENERAL'];

exports.getAll=async(req,res,next)=>{
  try{
    const{period_id,phase}=req.query;
    let pid=period_id;
    if(!pid&&req.user.role!=='ADMIN') pid=req.user.period_id;
    let q=`SELECT m.*,u.name AS created_by_name,p.label AS period_label FROM materials m JOIN users u ON u.id=m.created_by LEFT JOIN periods p ON p.id=m.period_id WHERE 1=1`;
    const params=[];
    if(pid){q+=' AND m.period_id=?';params.push(pid);}
    if(phase&&VALID_PHASES.includes(phase)){q+=' AND m.phase=?';params.push(phase);}
    q+=" ORDER BY FIELD(m.phase,'ISC1','OJC','ISC2','GENERAL'), m.created_at DESC";
    const[rows]=await db.query(q,params);res.json(rows);
  }catch(e){next(e);}
};
exports.getOne=async(req,res,next)=>{try{const[[m]]=await db.query(`SELECT m.*,u.name AS created_by_name FROM materials m JOIN users u ON u.id=m.created_by WHERE m.id=?`,[req.params.id]);if(!m)return res.status(404).json({message:'Materi tidak ditemukan'});res.json(m);}catch(e){next(e);}};
exports.create=async(req,res,next)=>{
  try{
    const{period_id,title,description,phase,link_url}=req.body;
    const file_path=req.file?req.file.filename:null;
    if(!period_id||!title||!phase) return res.status(400).json({message:'period_id, title, phase wajib'});
    if(!VALID_PHASES.includes(phase)) return res.status(400).json({message:'Phase tidak valid'});
    const[r]=await db.query('INSERT INTO materials (period_id,title,description,phase,file_path,link_url,created_by) VALUES (?,?,?,?,?,?,?)',[period_id,title,description,phase,file_path,link_url||null,req.user.id]);
    res.status(201).json({message:'Materi ditambahkan',id:r.insertId});
  }catch(e){next(e);}
};
exports.update=async(req,res,next)=>{
  try{
    const{title,description,phase,link_url}=req.body;
    if(!VALID_PHASES.includes(phase)) return res.status(400).json({message:'Phase tidak valid'});
    const file_path=req.file?req.file.filename:undefined;
    const sets=['title=?','description=?','phase=?','link_url=?'],params=[title,description,phase,link_url||null];
    if(file_path){sets.push('file_path=?');params.push(file_path);}
    params.push(req.params.id);
    await db.query(`UPDATE materials SET ${sets.join(',')} WHERE id=?`,params);
    res.json({message:'Materi diperbarui'});
  }catch(e){next(e);}
};
exports.remove=async(req,res,next)=>{
  try{
    const[[m]]=await db.query('SELECT file_path FROM materials WHERE id=?',[req.params.id]);
    if(m?.file_path){const fp=path.join(process.env.UPLOAD_DIR||'uploads',m.file_path);if(fs.existsSync(fp))fs.unlinkSync(fp);}
    await db.query('DELETE FROM materials WHERE id=?',[req.params.id]);
    res.json({message:'Materi dihapus'});
  }catch(e){next(e);}
};
