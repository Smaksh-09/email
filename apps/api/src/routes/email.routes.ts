import { Router } from 'express';
import { EmailController } from '../controllers/email.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

router.use(requireAuth);

router.post('/senders', EmailController.createSender);
router.post('/schedule', EmailController.scheduleEmails);
router.get('/', EmailController.listEmails);
router.get('/:id', EmailController.getEmailById);

export default router;