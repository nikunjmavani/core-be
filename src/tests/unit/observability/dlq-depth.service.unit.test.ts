import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetJobCounts = vi.fn();
const mockClose = vi.fn();

vi.mock('bullmq', () => ({
  Queue: class MockQueue {
    getJobCounts = mockGetJobCounts;
    close = mockClose;
  },
}));

vi.mock('@/infrastructure/observability/sentry.js', () => ({
  captureMessage: vi.fn(),
}));

describe('sampleDeadLetterQueueDepths', () => {
  beforeEach(() => {
    mockGetJobCounts.mockReset();
    mockClose.mockReset();
    mockGetJobCounts.mockResolvedValue({ waiting: 0, failed: 0 });
  });

  it('returns depth samples for each dead-letter queue', async () => {
    const { sampleDeadLetterQueueDepths } =
      await import('@/infrastructure/observability/dlq-depth/dlq-depth.service.js');

    const result = await sampleDeadLetterQueueDepths();

    expect(result.depths.length).toBeGreaterThan(0);
    expect(mockClose).toHaveBeenCalled();
  });
});
