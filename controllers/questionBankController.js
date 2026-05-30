const db=require('../config/db');

exports.getAll=async(req,res,next)=>{
  try{
    const{period_id,status}=req.query;
    let q=`SELECT qb.*,u.name AS created_by_name,p.label AS period_label,COUNT(qbi.id) AS item_count
           FROM question_banks qb
           JOIN users u ON u.id=qb.created_by
           LEFT JOIN periods p ON p.id=qb.period_id
           LEFT JOIN question_bank_items qbi ON qbi.bank_id=qb.id
           WHERE 1=1`;
    const params=[];
    if(period_id){q+=' AND qb.period_id=?';params.push(period_id);}
    if(status){q+=' AND qb.status=?';params.push(status);}
    q+=' GROUP BY qb.id ORDER BY qb.created_at DESC';
    const[rows]=await db.query(q,params);
    res.json(rows);
  }catch(e){next(e);}
};

exports.getOne=async(req,res,next)=>{
  try{
    const[[bank]]=await db.query('SELECT * FROM question_banks WHERE id=?',[req.params.id]);
    if(!bank) return res.status(404).json({message:'Bank soal tidak ditemukan'});
    const[items]=await db.query('SELECT * FROM question_bank_items WHERE bank_id=? ORDER BY order_no,id',[req.params.id]);
    res.json({...bank,items});
  }catch(e){next(e);}
};

exports.create=async(req,res,next)=>{
  try{
    const{period_id,title,description,status}=req.body;
    if(!title) return res.status(400).json({message:'title wajib'});
    const[r]=await db.query(
      'INSERT INTO question_banks (period_id,phase,title,description,status,created_by) VALUES (?,?,?,?,?,?)',
      [period_id||null,'ISC1',title,description||null,status||'draft',req.user.id]
    );
    res.status(201).json({message:'Bank soal dibuat',id:r.insertId});
  }catch(e){next(e);}
};

exports.update=async(req,res,next)=>{
  try{
    const{period_id,title,description,status}=req.body;
    await db.query('UPDATE question_banks SET period_id=?,title=?,description=?,status=? WHERE id=?',[period_id||null,title,description||null,status||'draft',req.params.id]);
    res.json({message:'Bank soal diperbarui'});
  }catch(e){next(e);}
};

exports.remove=async(req,res,next)=>{
  try{await db.query('DELETE FROM question_banks WHERE id=?',[req.params.id]);res.json({message:'Bank soal dihapus'});}catch(e){next(e);}
};

exports.addItem=async(req,res,next)=>{
  try{
    const{order_no,question_text,option_a,option_b,option_c,option_d,correct_answer}=req.body;
    if(!question_text||!option_a||!option_b||!option_c||!option_d||!correct_answer) return res.status(400).json({message:'Pertanyaan, opsi A-D, dan jawaban benar wajib'});
    const image_url=req.file?`/uploads/${req.file.filename}`:null;
    const[r]=await db.query(
      'INSERT INTO question_bank_items (bank_id,order_no,question_text,image_url,option_a,option_b,option_c,option_d,correct_answer) VALUES (?,?,?,?,?,?,?,?,?)',
      [req.params.id,order_no||1,question_text,image_url,option_a,option_b,option_c,option_d,correct_answer]
    );
    res.status(201).json({message:'Item soal ditambahkan',id:r.insertId});
  }catch(e){next(e);}
};

exports.updateItem=async(req,res,next)=>{
  try{
    const{order_no,question_text,option_a,option_b,option_c,option_d,correct_answer,remove_image}=req.body;
    if(!question_text||!option_a||!option_b||!option_c||!option_d||!correct_answer) return res.status(400).json({message:'Pertanyaan, opsi A-D, dan jawaban benar wajib'});
    const[[existing]]=await db.query('SELECT image_url FROM question_bank_items WHERE id=? AND bank_id=?',[req.params.itemId,req.params.id]);
    if(!existing) return res.status(404).json({message:'Item soal tidak ditemukan'});

    let finalImageUrl=existing.image_url||null;
    if(req.file) finalImageUrl=`/uploads/${req.file.filename}`;
    else if(String(remove_image||'0')==='1') finalImageUrl=null;

    await db.query(
      'UPDATE question_bank_items SET order_no=?,question_text=?,image_url=?,option_a=?,option_b=?,option_c=?,option_d=?,correct_answer=? WHERE id=? AND bank_id=?',
      [order_no||1,question_text,finalImageUrl,option_a,option_b,option_c,option_d,correct_answer,req.params.itemId,req.params.id]
    );
    res.json({message:'Item soal diperbarui'});
  }catch(e){next(e);}
};

exports.removeItem=async(req,res,next)=>{
  try{await db.query('DELETE FROM question_bank_items WHERE id=?',[req.params.itemId]);res.json({message:'Item soal dihapus'});}catch(e){next(e);}
};