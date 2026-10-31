import { Client } from '@elastic/elasticsearch';
import { env } from '../config/env.js';

const esClient = new Client({ node: env.ELASTICSEARCH_NODE });
const INDEX_NAME = 'emails_index';

export class SearchService {
  static async initIndex() {
    try {
      const exists = await esClient.indices.exists({ index: INDEX_NAME });
      if (!exists) {
        await esClient.indices.create({
          index: INDEX_NAME,
          mappings: {
            properties: {
              id: { type: 'keyword' },
              userId: { type: 'keyword' },
              senderId: { type: 'keyword' },
              recipientEmail: { type: 'text', fields: { keyword: { type: 'keyword' } } },
              subject: { type: 'text' },
              body: { type: 'text' },
              status: { type: 'keyword' },
              scheduledAt: { type: 'date' },
              sentAt: { type: 'date' },
              previewUrl: { type: 'keyword' },
            },
          },
        });
        console.log('[Elasticsearch] Index created:', INDEX_NAME);
      }
    } catch (error) {
      console.error('[Elasticsearch] Failed to initialize index:', error);
    }
  }

  static async indexEmailJob(emailJob: {
    id: string;
    userId: string;
    senderId: string;
    recipientEmail: string;
    subject: string;
    body: string;
    status: string;
    scheduledAt: Date;
    sentAt?: Date | null;
    previewUrl?: string | null;
  }) {
    try {
      await esClient.index({
        index: INDEX_NAME,
        id: emailJob.id,
        document: {
          id: emailJob.id,
          userId: emailJob.userId,
          senderId: emailJob.senderId,
          recipientEmail: emailJob.recipientEmail,
          subject: emailJob.subject,
          body: emailJob.body,
          status: emailJob.status,
          scheduledAt: emailJob.scheduledAt.toISOString(),
          sentAt: emailJob.sentAt ? emailJob.sentAt.toISOString() : null,
          previewUrl: emailJob.previewUrl || null,
        },
        refresh: true,
      });
    } catch (error) {
      console.error(`[Elasticsearch] Failed to index job ${emailJob.id}:`, error);
    }
  }

  static async searchEmails(userId: string, query: string, statusFilter?: 'SCHEDULED' | 'SENT') {
    const mustClauses: any[] = [{ term: { userId } }];

    if (statusFilter === 'SCHEDULED') {
      mustClauses.push({ terms: { status: ['SCHEDULED', 'PROCESSING', 'RATE_LIMITED'] } });
    } else if (statusFilter === 'SENT') {
      mustClauses.push({ terms: { status: ['SENT', 'FAILED'] } });
    }

    if (query && query.trim() !== '') {
      mustClauses.push({
        multi_match: {
          query: query.trim(),
          fields: ['recipientEmail^3', 'subject^2', 'body'],
          fuzziness: 'AUTO',
        },
      });
    }

    const result = await esClient.search({
      index: INDEX_NAME,
      query: {
        bool: { must: mustClauses },
      },
      sort: [{ scheduledAt: { order: 'desc' } }],
      size: 100,
    });

    return result.hits.hits.map((hit) => hit._source);
  }
}