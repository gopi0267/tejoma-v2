import Redis from 'redis';
import { REDIS_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';

const publisher = Redis.createClient({ url: REDIS_URL });

export async function initPublisher(): Promise<void> {
  publisher.on('error', (err) => {
    logger.error({ err: err.message }, 'Redis publisher error');
  });

  await publisher.connect();
  logger.info('Redis event publisher initialized');
}

export async function publishEvent(channel: string, event: Record<string, unknown>): Promise<void> {
  try {
    await publisher.publish(channel, JSON.stringify(event));
    logger.debug({ channel, eventType: event.type }, 'Event published to Redis');
  } catch (error) {
    logger.error({ err: (error as Error).message, channel }, 'Failed to publish event');
  }
}

export const eventPublisher = {
  publishUploadCompleted: (companyId: number, candidateId: number, uploadId: number, fileName: string) =>
    publishEvent('events:uploads', { type: 'upload:completed', companyId, candidateId, uploadId, fileName }),

  publishResumeExtracted: (companyId: number, candidateId: number, resumeId: number, skillsCount: number) =>
    publishEvent('events:resumes', { type: 'resume:extraction_completed', companyId, candidateId, resumeId, skillsCount }),

  publishSwipeAction: (companyId: number, candidateId: number, recruiterId: number, jobId: number, action: string, candidateName: string, jobTitle: string) =>
    publishEvent('events:swipes', {
      type: 'swipe:action',
      companyId,
      candidateId,
      recruiterId,
      jobId,
      action,
      candidateName,
      jobTitle,
    }),

  publishCandidateUpdate: (companyId: number, candidateId: number, recruiterId: number, candidateName: string) =>
    publishEvent('events:candidates', { type: 'candidate:profile_updated', companyId, candidateId, recruiterId, candidateName }),
};
