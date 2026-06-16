const jwt = require('jsonwebtoken');
const db = require('../config/db');

const authenticate = (req,res,next)=>{
  const h = req.headers.authorization;
  if(!h?.startsWith('Bearer ')) return res.status(401).json({message:'Token tidak ditemukan'});
  try{ req.user=jwt.verify(h.split(' ')[1],process.env.JWT_SECRET); next(); }
  catch{ return res.status(401).json({message:'Token tidak valid'}); }
};

const authorize = (...roles)=>(req,res,next)=>{
  if(!req.user) return res.status(401).json({message:'Belum login'});
  if(!roles.includes(req.user.role)) return res.status(403).json({message:'Akses ditolak'});
  next();
};

const ensureNotCertificateOnly=(req,res,next)=>{
  if(!req.user) return res.status(401).json({message:'Belum login'});
  if(req.user.restricted_to_certificates) return res.status(403).json({message:'Akun periode nonaktif hanya dapat mengakses menu sertifikat.'});
  next();
};

const ensureDosenVerificationApproved=async(req,res,next)=>{
  try{
    if(!req.user) return res.status(401).json({message:'Belum login'});
    if(req.user.role!=='DOSEN') return next();
    const [[u]] = await db.query('SELECT dosen_verification_status FROM users WHERE id=?',[req.user.id]);
    if(!u) return res.status(404).json({message:'User tidak ditemukan'});
    if(u.dosen_verification_status!=='verified') return res.status(403).json({message:'Akses dikunci. Selesaikan verifikasi dosen tahap 1 terlebih dahulu.'});
    next();
  }catch(err){next(err);}
};

const ensurePaymentVerified=async(req,res,next)=>{
  try{
    if(!req.user) return res.status(401).json({message:'Belum login'});
    const [[u]] = await db.query('SELECT role,payment_status FROM users WHERE id=?',[req.user.id]);
    if(!u) return res.status(404).json({message:'User tidak ditemukan'});
    if(u.role!=='DOSEN') return next();
    if(u.payment_status!=='verified') return res.status(403).json({message:'Akses dikunci. Selesaikan verifikasi pembayaran terlebih dahulu.'});
    next();
  }catch(err){next(err);}
};

const ensureAnyActivePeriod=async(req,res,next)=>{
  try{
    const [[period]] = await db.query('SELECT id FROM periods WHERE is_active=1 ORDER BY year DESC,id DESC LIMIT 1');
    if(!period) return res.status(403).json({message:'Semua periode sedang dinonaktifkan. Aktifkan periode terlebih dahulu.'});
    next();
  }catch(err){next(err);}
};

const ensureBodyPeriodActive=async(req,res,next)=>{
  try{
    const periodId = req.body?.period_id;
    if(periodId===undefined||periodId===null||String(periodId).trim()==='') return next();
    const [[period]] = await db.query('SELECT id,is_active FROM periods WHERE id=?',[periodId]);
    if(!period) return res.status(400).json({message:'Periode tidak valid'});
    if(!period.is_active) return res.status(403).json({message:'Periode sedang nonaktif. Aktifkan periode terlebih dahulu.'});
    next();
  }catch(err){next(err);}
};

module.exports={authenticate,authorize,ensureNotCertificateOnly,ensureDosenVerificationApproved,ensurePaymentVerified,ensureAnyActivePeriod,ensureBodyPeriodActive};
