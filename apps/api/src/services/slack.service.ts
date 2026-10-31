import axios from 'axios';
import { prisma } from '../config/db.js';

export class SlackService {
  static async notifyRateLimitHit(params: {
    userId: string;
    senderEmail: string;
    hourlyLimit: number;
    hourWindowKey: string;
    nextWindowTime: Date;
  }) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: params.userId },
      });

      if (!user || (!user.slackWebhookUrl && !user.slackAccessToken)) {
        // User has not connected Slack; safely ignore per spec.
        return;
      }

      const messageText = `⚠️ *ReachInbox Rate Limit Reached*\n• *Sender:* \`${params.senderEmail}\`\n• *Hourly Cap:* ${params.hourlyLimit} emails/hr (Window: \`${params.hourWindowKey}:00 UTC\`)\n• *Action Taken:* Remaining scheduled emails are preserved and automatically rescheduled to start at \`${params.nextWindowTime.toUTCString()}\`.`;

      // 1. Prefer Incoming Webhook URL if granted during OAuth
      if (user.slackWebhookUrl) {
        await axios.post(user.slackWebhookUrl, { text: messageText });
        console.log(`[Slack] Sent rate-limit webhook alert for sender ${params.senderEmail}`);
        return;
      }

      // 2. Fallback to chat.postMessage via OAuth Access Token
      if (user.slackAccessToken && user.slackChannelId) {
        await axios.post(
          'https://slack.com/api/chat.postMessage',
          {
            channel: user.slackChannelId,
            text: messageText,
          },
          {
            headers: {
              Authorization: `Bearer ${user.slackAccessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );
        console.log(`[Slack] Sent rate-limit chat.postMessage for sender ${params.senderEmail}`);
      }
    } catch (error) {
      console.error('[Slack] Failed to send rate-limit notification (non-fatal):', error);
    }
  }
}