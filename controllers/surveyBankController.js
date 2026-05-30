const db=require('../config/db');

exports.getAll=async(req,res,next)=>{
  try{
    const{period_id,target_role,status}=req.query;
    let q=`SELECT sb.*,u.name AS created_by_name,p.label AS period_label,COUNT(sbq.id) AS question_count
           FROM survey_banks sb
           JOIN users u ON u.id=sb.created_by
           LEFT JOIN periods p ON p.id=sb.period_id
           LEFT JOIN survey_bank_questions sbq ON sbq.bank_id=sb.id
           WHERE 1=1`;
    const params=[];
    if(period_id){q+=' AND sb.period_id=?';params.push(period_id);}
    if(target_role){q+=' AND sb.target_role=?';params.push(target_role);}
    if(status){q+=' AND sb.status=?';params.push(status);}
    q+=' GROUP BY sb.id ORDER BY sb.created_at DESC';
    const[rows]=await db.query(q,params);
    res.json(rows);
  }catch(e){next(e);}
};

exports.getOne=async(req,res,next)=>{
  try{
    const[[bank]]=await db.query('SELECT * FROM survey_banks WHERE id=?',[req.params.id]);
    if(!bank) return res.status(404).json({message:'Bank survei tidak ditemukan'});
    const[questions]=await db.query('SELECT * FROM survey_bank_questions WHERE bank_id=? ORDER BY order_no,id',[req.params.id]);
    res.json({...bank,questions});
  }catch(e){next(e);}
};

exports.create=async(req,res,next)=>{
  try{
    const{period_id,target_role,title,description,status}=req.body;
    if(!target_role||!title) return res.status(400).json({message:'target_role dan title wajib'});
    const[r]=await db.query(
      'INSERT INTO survey_banks (period_id,target_role,title,description,status,created_by) VALUES (?,?,?,?,?,?)',
      [period_id||null,target_role,title,description||null,status||'draft',req.user.id]
    );
    res.status(201).json({message:'Bank survei dibuat',id:r.insertId});
  }catch(e){next(e);}
};

exports.update=async(req,res,next)=>{
  try{
    const{period_id,target_role,title,description,status}=req.body;
    await db.query('UPDATE survey_banks SET period_id=?,target_role=?,title=?,description=?,status=? WHERE id=?',[period_id||null,target_role,title,description||null,status||'draft',req.params.id]);
    res.json({message:'Bank survei diperbarui'});
  }catch(e){next(e);}
};

exports.remove=async(req,res,next)=>{try{await db.query('DELETE FROM survey_banks WHERE id=?',[req.params.id]);res.json({message:'Bank survei dihapus'});}catch(e){next(e);}};

exports.addQuestion=async(req,res,next)=>{
  try{
    const{order_no,question_text,question_type,option_a,option_b,option_c,option_d,required}=req.body;
    if(!question_text) return res.status(400).json({message:'question_text wajib'});
    const[r]=await db.query(
      'INSERT INTO survey_bank_questions (bank_id,order_no,question_text,question_type,option_a,option_b,option_c,option_d,required) VALUES (?,?,?,?,?,?,?,?,?)',
      [req.params.id,order_no||1,question_text,question_type||'single_choice',option_a||null,option_b||null,option_c||null,option_d||null,required===undefined?1:required]
    );
    res.status(201).json({message:'Pertanyaan survei ditambahkan',id:r.insertId});
  }catch(e){next(e);}
};

exports.updateQuestion=async(req,res,next)=>{
  try{
    const{order_no,question_text,question_type,option_a,option_b,option_c,option_d,required}=req.body;
    if(!question_text) return res.status(400).json({message:'question_text wajib'});
    await db.query(
      'UPDATE survey_bank_questions SET order_no=?,question_text=?,question_type=?,option_a=?,option_b=?,option_c=?,option_d=?,required=? WHERE id=? AND bank_id=?',
      [order_no||1,question_text,question_type||'single_choice',option_a||null,option_b||null,option_c||null,option_d||null,required===undefined?1:required,req.params.questionId,req.params.id]
    );
    res.json({message:'Pertanyaan survei diperbarui'});
  }catch(e){next(e);}
};

exports.removeQuestion=async(req,res,next)=>{try{await db.query('DELETE FROM survey_bank_questions WHERE id=?',[req.params.questionId]);res.json({message:'Pertanyaan survei dihapus'});}catch(e){next(e);}};
