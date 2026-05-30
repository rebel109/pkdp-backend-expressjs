const r=require('express').Router(),c=require('../controllers/materialController'),{authenticate,authorize,ensurePaymentVerified,ensureBodyPeriodActive}=require('../middlewares/auth'),{uploadPdf}=require('../middlewares/upload');
r.use(authenticate);
r.get('/',ensurePaymentVerified,c.getAll);r.get('/:id',ensurePaymentVerified,c.getOne);
r.post('/',authorize('ADMIN'),ensureBodyPeriodActive,uploadPdf.single('file'),c.create);
r.put('/:id',authorize('ADMIN'),uploadPdf.single('file'),c.update);
r.delete('/:id',authorize('ADMIN'),c.remove);
module.exports=r;
