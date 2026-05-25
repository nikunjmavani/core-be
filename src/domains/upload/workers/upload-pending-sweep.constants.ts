/** BullMQ queue for auto-confirming or hard-deleting upload.uploads rows stuck in PENDING. */
export const UPLOAD_PENDING_SWEEP_QUEUE_NAME = 'upload-pending-sweep';

/** Maximum rows scanned per sweeper invocation. */
export const UPLOAD_PENDING_SWEEP_BATCH_SIZE = 500;
