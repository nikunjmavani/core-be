import type { user_data_exports } from './user-data-export.schema.js';

/** Thrown when an export job should stop without retry (user deleted or export row removed). */
export class UserDataExportCancelledError extends Error {
  constructor(message = 'User data export cancelled') {
    super(message);
    this.name = 'UserDataExportCancelledError';
  }
}

export const USER_DATA_EXPORT_STATUSES = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type UserDataExportStatus =
  (typeof USER_DATA_EXPORT_STATUSES)[keyof typeof USER_DATA_EXPORT_STATUSES];

export type UserDataExportRow = typeof user_data_exports.$inferSelect;

export interface UserDataExport {
  user: {
    id: string;
    email: string;
    full_name: string | null;
    created_at: string;
  };
  organizations: {
    name: string;
    slug: string;
    role: string;
    joined_at: string;
  }[];
  sessions: {
    ip_address: string;
    last_active_at: string;
    created_at: string;
  }[];
  notifications: {
    type: string;
    title: string;
    message: string;
    created_at: string;
  }[];
  audit_activity: {
    action: string;
    resource_type: string;
    created_at: string;
  }[];
  exported_at: string;
}

export type UserDataExportOutput = {
  export_id: string;
  status: UserDataExportStatus;
  download_url: string | null;
  expires_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  error_code: string | null;
  created_at: string;
};
