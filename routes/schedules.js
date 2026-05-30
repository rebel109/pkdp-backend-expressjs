const r=require('express').Router(),c=require('../controllers/scheduleController'),{authenticate,authorize,ensureBodyPeriodActive}=require('../middlewares/auth');
r.use(authenticate);
r.get('/',authorize('ADMIN'),c.getAll);
r.post('/',authorize('ADMIN'),ensureBodyPeriodActive,c.create);
r.put('/:id',authorize('ADMIN'),ensureBodyPeriodActive,c.update);
r.delete('/:id',authorize('ADMIN'),c.remove);
module.exports=r;
