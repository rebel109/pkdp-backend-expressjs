const r=require('express').Router();
const c=require('../controllers/dashboardController');
const{authenticate,ensurePaymentVerified}=require('../middlewares/auth');
const db=require('../config/db');

r.get('/',authenticate,ensurePaymentVerified,c.getStats);

// DEBUG: cek mengapa submission tidak muncul untuk narasumber
r.get('/debug-ns',authenticate,ensurePaymentVerified,async(req,res)=>{
  try{
    const[kelas]=await db.query(
      `SELECT cn.class_id, c.name, c.phase, c.period_id
       FROM class_narasumber cn
       JOIN classes c ON c.id=cn.class_id
       WHERE cn.narasumber_id=? AND c.period_id=?`,[req.user.id,req.user.period_id]);

    const classIds=kelas.map(k=>k.class_id);
    let tasks=[];
    if(classIds.length){
      [tasks]=await db.query(
        'SELECT id,title,phase,task_type,class_id FROM tasks WHERE class_id IN (?) AND period_id=?',
        [classIds,req.user.period_id]);
    }

    let submissions=[];
    if(tasks.length){
      const taskIds=tasks.map(t=>t.id);
      [submissions]=await db.query(
        `SELECT s.id,s.user_id,s.task_id,s.status,u.name AS dosen_name
         FROM submissions s JOIN users u ON u.id=s.user_id
         WHERE s.task_id IN (?)`,
        [taskIds]);
    }

    // Cek semua submission yang ada di DB
    const[allSubs]=await db.query(
      `SELECT s.id,s.task_id,s.status,u.name AS dosen_name,t.class_id
       FROM submissions s
       JOIN users u ON u.id=s.user_id
       JOIN tasks t ON t.id=s.task_id
       LIMIT 20`);

    res.json({
      narasumber_id:req.user.id,
      step1_kelas_diampu:kelas,
      step2_tasks_di_kelas:tasks,
      step3_submissions_ditemukan:submissions,
      all_submissions_in_db:allSubs,
      diagnosis:{
        has_class:kelas.length>0,
        has_tasks:tasks.length>0,
        has_submissions:submissions.length>0
      }
    });
  }catch(e){res.status(500).json({error:e.message});}
});

module.exports=r;
