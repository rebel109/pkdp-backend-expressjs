const r=require('express').Router(),c=require('../controllers/surveyBankController'),{authenticate,authorize,ensureAnyActivePeriod,ensureBodyPeriodActive}=require('../middlewares/auth');
r.use(authenticate);
r.get('/',authorize('ADMIN'),c.getAll);r.get('/:id',authorize('ADMIN'),c.getOne);
r.post('/',authorize('ADMIN'),ensureAnyActivePeriod,ensureBodyPeriodActive,c.create);r.put('/:id',authorize('ADMIN'),ensureAnyActivePeriod,ensureBodyPeriodActive,c.update);r.delete('/:id',authorize('ADMIN'),c.remove);
r.post('/:id/questions',authorize('ADMIN'),c.addQuestion);r.put('/:id/questions/:questionId',authorize('ADMIN'),c.updateQuestion);r.delete('/:id/questions/:questionId',authorize('ADMIN'),c.removeQuestion);
module.exports=r;