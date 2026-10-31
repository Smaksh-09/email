import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/google', AuthController.googleLogin);
router.get('/google/callback', AuthController.googleCallback);
router.get('/me', requireAuth, AuthController.getMe);
router.post('/logout', AuthController.logout);

// Slack OAuth routes
router.get('/slack', requireAuth, AuthController.slackConnect);
router.get('/slack/callback', AuthController.slackCallback);
router.post('/slack/disconnect', requireAuth, AuthController.slackDisconnect);

export default router;