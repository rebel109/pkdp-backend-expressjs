const r=require('express').Router(),c=require('../controllers/instrumentController'),{authenticate,authorize,ensureBodyPeriodActive}=require('../middlewares/auth');
r.use(authenticate);
r.get('/',c.getAll);r.get('/:id',c.getOne);
r.post('/',authorize('ADMIN'),ensureBodyPeriodActive,c.create);r.put('/:id',authorize('ADMIN'),c.update);r.delete('/:id',authorize('ADMIN'),c.remove);
r.post('/:id/aspects',authorize('ADMIN'),c.addAspect);r.put('/:id/aspects/:aid',authorize('ADMIN'),c.updateAspect);r.delete('/:id/aspects/:aid',authorize('ADMIN'),c.removeAspect);
module.exports=r;
