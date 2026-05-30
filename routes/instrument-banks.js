const r=require('express').Router(),c=require('../controllers/instrumentBankController'),{authenticate,authorize,ensureAnyActivePeriod,ensureBodyPeriodActive}=require('../middlewares/auth');
r.use(authenticate);
r.get('/',authorize('ADMIN'),c.getAll);r.get('/:id',authorize('ADMIN'),c.getOne);
r.post('/',authorize('ADMIN'),ensureAnyActivePeriod,ensureBodyPeriodActive,c.create);r.put('/:id',authorize('ADMIN'),ensureAnyActivePeriod,ensureBodyPeriodActive,c.update);r.delete('/:id',authorize('ADMIN'),c.remove);
r.post('/:id/aspects',authorize('ADMIN'),c.addAspect);r.delete('/:id/aspects/:aspectId',authorize('ADMIN'),c.removeAspect);
module.exports=r;