import Redis from 'redis';
import { Server } from 'socket.io';
import { REDIS_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { db } from '../db.js';

const subscriber = Redis.createClient({ url: REDIS_URL });

export async function subscribeToRedisEvents(io: Server): Promise<void> {
  subscriber.on('error', (err) => {
    logger.error({ err: err.message }, 'Redis subscriber error');
  });

  subscriber.on('message', async (channel: string, message: string) => {
    try {
      const event = JSON.parse(message);
      logger.debug({ channel, eventType: event.type }, 'Redis event received');

      // Route to appropriate handler based on event type
      if (channel === 'events:uploads') {
        await handleUploadEvent(event, io);
      } else if (channel === 'events:resumes') {
        await handleResumeEvent(event, io);
      } else if (channel === 'events:swipes') {
        await handleSwipeEvent(event, io);
      } else if (channel === 'events:candidates') {
        await handleCandidateEvent(event, io);
      }
    } catch (error) {
      logger.error({ err: (error as Error).message, channel }, 'Failed to process Redis event');
    }
  });

  await subscriber.connect();
  await subscriber.subscribe(['events:uploads', 'events:resumes', 'events:swipes', 'events:candidates']);
  logger.info('Subscribed to Redis event channels');
}

async function handleUploadEvent(event: any, io: Server): Promise<void> {
  if (event.type === 'upload:completed') {
    const notification = await db.createNotification({
      company_id: event.companyId,
      recipient_user_id: event.candidateId,
      sender_user_id: null,
      notification_type: 'upload_completed',
      title: 'Resume Uploaded',
      message: `Your resume has been uploaded successfully`,
      data: { uploadId: event.uploadId, fileName: event.fileName },
      read_at: null,
      deleted_at: null,
    });

    if (notification) {
      io.to(`user:${event.candidateId}`).emit('notification', {
        id: notification.id,
        type: 'upload_completed',
        title: notification.title,
        message: notification.message,
      });
    }
  }
}

async function handleResumeEvent(event: any, io: Server): Promise<void> {
  if (event.type === 'resume:extraction_completed') {
    const notification = await db.createNotification({
      company_id: event.companyId,
      recipient_user_id: event.candidateId,
      sender_user_id: null,
      notification_type: 'resume_extracted',
      title: 'Resume Processed',
      message: `Your resume has been processed and analyzed`,
      data: { resumeId: event.resumeId, skillsCount: event.skillsCount },
      read_at: null,
      deleted_at: null,
    });

    if (notification) {
      io.to(`user:${event.candidateId}`).emit('notification', {
        id: notification.id,
        type: 'resume_extracted',
        title: notification.title,
        message: notification.message,
      });
    }
  }
}

async function handleSwipeEvent(event: any, io: Server): Promise<void> {
  if (event.type === 'swipe:action') {
    // Notify recruiter of candidate action
    const notification = await db.createNotification({
      company_id: event.companyId,
      recipient_user_id: event.recruiterId,
      sender_user_id: event.candidateId,
      notification_type: 'candidate_swiped',
      title: `${event.candidateName} swiped on a job`,
      message: `${event.candidateName} ${event.action} the ${event.jobTitle} position`,
      data: { candidateId: event.candidateId, jobId: event.jobId, action: event.action },
      read_at: null,
      deleted_at: null,
    });

    if (notification) {
      io.to(`user:${event.recruiterId}`).emit('notification', {
        id: notification.id,
        type: 'candidate_swiped',
        title: notification.title,
        message: notification.message,
      });
    }
  }
}

async function handleCandidateEvent(event: any, io: Server): Promise<void> {
  if (event.type === 'candidate:profile_updated') {
    // Notify recruiters following this candidate
    const notification = await db.createNotification({
      company_id: event.companyId,
      recipient_user_id: event.recruiterId,
      sender_user_id: event.candidateId,
      notification_type: 'candidate_updated',
      title: `${event.candidateName} updated profile`,
      message: `${event.candidateName} has updated their profile`,
      data: { candidateId: event.candidateId },
      read_at: null,
      deleted_at: null,
    });

    if (notification) {
      io.to(`user:${event.recruiterId}`).emit('notification', {
        id: notification.id,
        type: 'candidate_updated',
        title: notification.title,
        message: notification.message,
      });
    }
  }
}

export { subscriber };
