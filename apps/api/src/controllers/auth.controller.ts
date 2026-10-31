import { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { env } from '../config/env.js';
import { prisma } from '../config/db.js';
import { MailService } from '../services/mail.service.js';
import { AuthRequest } from '../middleware/auth.middleware.js';

const googleClient = new OAuth2Client(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_REDIRECT_URI
);

export class AuthController {
  /**
   * 1. Redirect user to Google OAuth consent screen
   */
  static googleLogin(req: Request, res: Response) {
    const authorizeUrl = googleClient.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email'],
      prompt: 'consent',
    });
    res.redirect(authorizeUrl);
  }

  /**
   * 2. Google OAuth callback -> Upsert User -> Auto-create Ethereal Sender -> Redirect to Frontend
   */
  static async googleCallback(req: Request, res: Response) {
    try {
      const code = req.query.code as string;
      if (!code) {
        res.status(400).json({ error: 'Missing authorization code' });
        return;
      }

      const { tokens } = await googleClient.getToken(code);
      googleClient.setCredentials(tokens);

      const ticket = await googleClient.verifyIdToken({
        idToken: tokens.id_token!,
        audience: env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      if (!payload || !payload.email) {
        res.status(400).json({ error: 'Failed to retrieve Google profile email' });
        return;
      }

      let user = await prisma.user.findUnique({
        where: { email: payload.email },
        include: { senders: true },
      });

      if (!user) {
        // Create new user
        user = await prisma.user.create({
          data: {
            email: payload.email,
            name: payload.name || payload.email.split('@')[0],
            avatarUrl: payload.picture || null,
            googleId: payload.sub,
          },
          include: { senders: true },
        });
      }

      // Auto-provision a real Ethereal SMTP sender if user has none
      if (user.senders.length === 0) {
        const ethereal = await MailService.createEtherealAccount();
        await prisma.sender.create({
          data: {
            userId: user.id,
            name: `${user.name} (Primary Outreach)`,
            email: ethereal.smtpUser,
            smtpHost: ethereal.smtpHost,
            smtpPort: ethereal.smtpPort,
            smtpUser: ethereal.smtpUser,
            smtpPass: ethereal.smtpPass,
            hourlyLimit: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
            minDelaySeconds: env.DEFAULT_MIN_DELAY_SECONDS,
          },
        });
      }

      // Sign JWT
      const token = jwt.sign({ id: user.id, email: user.email }, env.JWT_SECRET, {
        expiresIn: '7d',
      });

      // Set HTTP-only cookie and redirect with token query param for easy Next.js client consumption
      res.cookie('token', token, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.redirect(`${env.FRONTEND_URL}/dashboard?token=${token}`);
    } catch (error) {
      console.error('[Auth] Google Callback Error:', error);
      res.redirect(`${env.FRONTEND_URL}/login?error=oauth_failed`);
    }
  }

  /**
   * 3. Get Current Logged-in User + Senders + Slack Connection Status
   */
  static async getMe(req: AuthRequest, res: Response) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        include: {
          senders: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        slackConnected: Boolean(user.slackWebhookUrl || user.slackAccessToken),
        slackTeamName: user.slackTeamName,
        senders: user.senders,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch user profile' });
    }
  }

  /**
   * 4. Logout
   */
  static logout(req: Request, res: Response) {
    res.clearCookie('token');
    res.json({ success: true });
  }

  /**
   * 5. Initiate Real Slack OAuth Flow
   */
  static slackConnect(req: AuthRequest, res: Response) {
    const state = req.user!.id; // Pass userId in state to link on callback
    const scopes = ['incoming-webhook', 'chat:write', 'channels:read'].join(',');
    const slackAuthUrl = `https://slack.com/oauth/v2/authorize?client_id=${env.SLACK_CLIENT_ID}&scope=${scopes}&redirect_uri=${encodeURIComponent(
      env.SLACK_REDIRECT_URI || ''
    )}&state=${state}`;

    res.redirect(slackAuthUrl);
  }

  /**
   * 6. Slack OAuth Callback
   */
  static async slackCallback(req: Request, res: Response) {
    try {
      const { code, state } = req.query;
      if (!code || !state) {
        res.redirect(`${env.FRONTEND_URL}/dashboard?slack=error`);
        return;
      }

      const userId = state as string;

      const response = await axios.post(
        'https://slack.com/api/oauth.v2.access',
        new URLSearchParams({
          client_id: env.SLACK_CLIENT_ID || '',
          client_secret: env.SLACK_CLIENT_SECRET || '',
          code: code as string,
          redirect_uri: env.SLACK_REDIRECT_URI || '',
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );

      const data = response.data;
      if (!data.ok) {
        console.error('[Slack OAuth] Error:', data.error);
        res.redirect(`${env.FRONTEND_URL}/dashboard?slack=error`);
        return;
      }

      await prisma.user.update({
        where: { id: userId },
        data: {
          slackAccessToken: data.access_token || null,
          slackWebhookUrl: data.incoming_webhook?.url || null,
          slackChannelId: data.incoming_webhook?.channel_id || null,
          slackTeamName: data.team?.name || 'Slack Workspace',
        },
      });

      res.redirect(`${env.FRONTEND_URL}/dashboard?slack=connected`);
    } catch (error) {
      console.error('[Slack OAuth] Callback Exception:', error);
      res.redirect(`${env.FRONTEND_URL}/dashboard?slack=error`);
    }
  }

  /**
   * 7. Disconnect Slack
   */
  static async slackDisconnect(req: AuthRequest, res: Response) {
    try {
      await prisma.user.update({
        where: { id: req.user!.id },
        data: {
          slackAccessToken: null,
          slackWebhookUrl: null,
          slackChannelId: null,
          slackTeamName: null,
        },
      });

      res.json({ success: true, slackConnected: false });
    } catch (error) {
      res.status(500).json({ error: 'Failed to disconnect Slack' });
    }
  }
}