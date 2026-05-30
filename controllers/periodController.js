const db=require('../config/db');
exports.getAll=async(req,res,next)=>{try{const[r]=await db.query('SELECT * FROM periods ORDER BY year DESC');res.json(r);}catch(e){next(e);}};
exports.create=async(req,res,next)=>{try{const{year,label}=req.body;if(!year||!label)return res.status(400).json({message:'year dan label wajib'});const[r]=await db.query('INSERT INTO periods (year,label) VALUES (?,?)',[year,label]);res.status(201).json({message:'Periode dibuat',id:r.insertId});}catch(e){next(e);}};
exports.setActive=async(req,res,next)=>{try{await db.query('UPDATE periods SET is_active=0');await db.query('UPDATE periods SET is_active=1 WHERE id=?',[req.params.id]);res.json({message:'Periode aktif diperbarui'});}catch(e){next(e);}};
exports.update=async(req,res,next)=>{try{const{year,label}=req.body;await db.query('UPDATE periods SET year=?,label=? WHERE id=?',[year,label,req.params.id]);res.json({message:'Periode diperbarui'});}catch(e){next(e);}};
exports.remove=async(req,res,next)=>{try{await db.query('DELETE FROM periods WHERE id=?',[req.params.id]);res.json({message:'Periode dihapus'});}catch(e){next(e);}};
exports.deactivateAll=async(req,res,next)=>{try{await db.query('UPDATE periods SET is_active=0');res.json({message:'Semua periode telah dinonaktifkan'});}catch(e){next(e);}};
