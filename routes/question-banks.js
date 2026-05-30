const r=require('express').Router(),c=require('../controllers/questionBankController'),{authenticate,authorize,ensureAnyActivePeriod,ensureBodyPeriodActive}=require('../middlewares/auth'),{uploadImage}=require('../middlewares/upload');
r.use(authenticate);
r.get('/',authorize('ADMIN'),c.getAll);r.get('/:id',authorize('ADMIN'),c.getOne);
r.post('/',authorize('ADMIN'),ensureAnyActivePeriod,ensureBodyPeriodActive,c.create);r.put('/:id',authorize('ADMIN'),ensureAnyActivePeriod,ensureBodyPeriodActive,c.update);r.delete('/:id',authorize('ADMIN'),c.remove);
r.post('/:id/items',authorize('ADMIN'),uploadImage.single('image'),c.addItem);r.delete('/:id/items/:itemId',authorize('ADMIN'),c.removeItem);
module.exports=r;