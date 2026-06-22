const service=require('../services/attendanceSessionService');

const getErrorMessage=error=>error?.message||'Terjadi kesalahan pada sesi absensi';
const sendBadRequest=(res,error)=>res.status(400).json({message:getErrorMessage(error)});

exports.getMySessions=async(req,res,next)=>{
  try{
    res.json(await service.listMySessions(req.user));
  }catch(error){next(error);}
};

exports.markSessionAttendance=async(req,res,next)=>{
  try{
    const sessionId=Number(req.params.sessionId);
    if(!Number.isInteger(sessionId)||sessionId<=0) return res.status(400).json({message:'Sesi absensi tidak valid'});
    res.json(await service.markSessionAttendance(sessionId,req.user));
  }catch(error){
    if(['Akses ditolak','Sesi absensi tidak ditemukan','Absensi sudah ditutup'].includes(error?.message)){
      const status=error.message==='Akses ditolak'?403:error.message==='Sesi absensi tidak ditemukan'?404:400;
      return res.status(status).json({message:error.message});
    }
    next(error);
  }
};

exports.getAdminSessions=async(req,res,next)=>{
  try{
    res.json(await service.listAdminSessions(req.query));
  }catch(error){next(error);}
};

exports.getAdminSessionRecap=async(req,res,next)=>{
  try{
    res.json(await service.getAdminSessionRecap(req.query));
  }catch(error){next(error);}
};

exports.createSession=async(req,res,next)=>{
  try{
    const id=await service.createSession(req.body,req.user);
    res.status(201).json({id,message:'Sesi absensi berhasil dibuat'});
  }catch(error){
    if(/tidak valid|wajib diisi|tidak ditemukan|tidak berada|tidak sesuai/i.test(getErrorMessage(error))) return sendBadRequest(res,error);
    next(error);
  }
};

exports.updateSession=async(req,res,next)=>{
  try{
    const sessionId=Number(req.params.sessionId);
    if(!Number.isInteger(sessionId)||sessionId<=0) return res.status(400).json({message:'Sesi absensi tidak valid'});
    await service.updateSession(sessionId,req.body,req.user);
    res.json({message:'Sesi absensi berhasil diperbarui'});
  }catch(error){
    if(/tidak valid|wajib diisi|tidak ditemukan|tidak berada|tidak sesuai/i.test(getErrorMessage(error))) return sendBadRequest(res,error);
    next(error);
  }
};

exports.setSessionOverride=async(req,res,next)=>{
  try{
    const sessionId=Number(req.params.sessionId);
    if(!Number.isInteger(sessionId)||sessionId<=0) return res.status(400).json({message:'Sesi absensi tidak valid'});
    await service.setSessionOverride(sessionId,Boolean(req.body?.is_open_override),req.user);
    res.json({message:req.body?.is_open_override?'Absensi dibuka admin':'Absensi dikembalikan ke jadwal otomatis'});
  }catch(error){
    if(/tidak valid|tidak ditemukan/i.test(getErrorMessage(error))) return sendBadRequest(res,error);
    next(error);
  }
};

exports.removeSession=async(req,res,next)=>{
  try{
    const sessionId=Number(req.params.sessionId);
    if(!Number.isInteger(sessionId)||sessionId<=0) return res.status(400).json({message:'Sesi absensi tidak valid'});
    await service.removeSession(sessionId);
    res.json({message:'Sesi absensi berhasil dinonaktifkan'});
  }catch(error){
    if(/tidak valid|tidak ditemukan/i.test(getErrorMessage(error))) return sendBadRequest(res,error);
    next(error);
  }
};
