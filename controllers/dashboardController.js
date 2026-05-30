const db=require('../config/db');
exports.getStats=async(req,res,next)=>{
  try{
    const role=req.user.role;
    if(role==='ADMIN'){
      const[[{td}]]=await db.query("SELECT COUNT(*) AS td FROM users WHERE role='DOSEN'");
      const[[{tn}]]=await db.query("SELECT COUNT(*) AS tn FROM users WHERE role='NARASUMBER'");
      const[[{ts}]]=await db.query("SELECT COUNT(*) AS ts FROM submissions");
      const[[{avg}]]=await db.query("SELECT ROUND(AVG(final_score),2) AS avg FROM grades");
      const[[{ap}]]=await db.query("SELECT COUNT(*) AS ap FROM submissions WHERE status='approved'");
      const[recent]=await db.query(`SELECT s.id,u.name AS dosen_name,t.title,t.phase,s.status,s.submitted_at FROM submissions s JOIN users u ON u.id=s.user_id JOIN tasks t ON t.id=s.task_id ORDER BY s.submitted_at DESC LIMIT 10`);
      const[by_phase]=await db.query(`SELECT t.phase,COUNT(s.id) AS total,SUM(s.status='approved') AS approved FROM submissions s JOIN tasks t ON t.id=s.task_id GROUP BY t.phase`);
      const[periods]=await db.query(`SELECT p.*,COUNT(DISTINCT u.id) AS dosen_count FROM periods p LEFT JOIN users u ON u.period_id=p.id AND u.role='DOSEN' GROUP BY p.id ORDER BY p.year DESC`);
      return res.json({total_dosen:td,total_narasumber:tn,total_submissions:ts,avg_score:avg,completion_rate:ts>0?Math.round((ap/ts)*100):0,recent,by_phase,periods});
    }
    if(role==='DOSEN'){
      const pid=req.user.period_id;
      const[myClasses]=await db.query(
        `SELECT c.id,c.name,c.phase,c.cohort_id,co.cohort_no,co.ojc_mode,p.label AS period_label
         FROM class_members cm
         JOIN classes c ON c.id=cm.class_id
         LEFT JOIN cohorts co ON co.id=c.cohort_id
         LEFT JOIN periods p ON p.id=c.period_id
         WHERE cm.user_id=?
         ORDER BY co.cohort_no IS NULL,co.cohort_no,c.phase,c.name`,
        [req.user.id]
      );
      const[tasks]=await db.query(
        `SELECT t.id,t.title,t.phase,t.task_type,t.order_no,COALESCE(s.status,'not_submitted') AS submission_status,s.id AS submission_id
         FROM tasks t LEFT JOIN submissions s ON s.task_id=t.id AND s.user_id=?
         WHERE t.period_id=? AND (t.class_id IN (SELECT class_id FROM class_members WHERE user_id=?) OR t.class_id IS NULL)
         ORDER BY t.phase,t.order_no`,[req.user.id,pid,req.user.id]);
      const[mcq]=await db.query(
        `SELECT t.id,t.title,t.task_type,COUNT(ma.id) AS total_q,SUM(ma.is_correct) AS correct_q
         FROM tasks t LEFT JOIN mcq_answers ma ON ma.task_id=t.id AND ma.user_id=?
         WHERE t.task_type IN ('PRETEST','POSTTEST') AND t.period_id=? GROUP BY t.id`,[req.user.id,pid]);
      const[grades]=await db.query(
        `SELECT t.phase,ROUND(AVG(g.final_score),2) AS avg_score FROM grades g JOIN submissions s ON s.id=g.submission_id JOIN tasks t ON t.id=s.task_id WHERE s.user_id=? GROUP BY t.phase`,[req.user.id]);
      return res.json({myClasses,tasks,mcq:mcq.map(r=>({...r,score:r.total_q?Math.round((r.correct_q/r.total_q)*100):0})),grades});
    }
    if(role==='NARASUMBER'){
      const pid=req.user.period_id;
      const[classes]=await db.query(
        `SELECT c.name,c.phase,COUNT(DISTINCT cm.user_id) AS dosen_count
         FROM class_narasumber cn
         JOIN classes c ON c.id=cn.class_id
         LEFT JOIN class_members cm ON cm.class_id=c.id
         WHERE cn.narasumber_id=? AND c.period_id=?
         GROUP BY c.id`,
        [req.user.id,pid]
      );
      const[[{pending}]]=await db.query(
        `SELECT COUNT(*) AS pending
         FROM submissions s
         JOIN tasks t ON t.id=s.task_id
         WHERE t.period_id=?
           AND t.class_id IN (SELECT cn.class_id FROM class_narasumber cn WHERE cn.narasumber_id=?)
           AND s.status='submitted'`,
        [pid,req.user.id]
      );
      const[[{graded}]]=await db.query(
        `SELECT COUNT(*) AS graded
         FROM grades g
         JOIN submissions s ON s.id=g.submission_id
         JOIN tasks t ON t.id=s.task_id
         WHERE g.narasumber_id=? AND t.period_id=?`,
        [req.user.id,pid]
      );
      return res.json({classes,pending_reviews:pending,total_graded:graded});
    }
    res.json({});
  }catch(e){next(e);}
};
