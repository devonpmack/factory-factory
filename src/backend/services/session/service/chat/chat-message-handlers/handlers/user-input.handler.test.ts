import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessageHandlerSessionService } from '@/backend/services/session/service/chat/chat-message-handlers/types';
import { skillDiscoveryService } from '@/backend/services/session/service/skills/skill-discovery.service';
import { createUserInputHandler } from './user-input.handler';

vi.mock('@/backend/services/session/service/skills/skill-discovery.service', () => ({
  skillDiscoveryService: {
    findSkillByName: vi.fn(async () => null),
    getSkillContent: vi.fn(async () => null),
  },
}));

vi.mock('@/backend/services/logger.service', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function createDeps(overrides?: Partial<ChatMessageHandlerSessionService>) {
  const deps: ChatMessageHandlerSessionService = {
    isSessionRunning: vi.fn(() => false),
    sendSessionMessage: vi.fn(async () => undefined),
    respondToAcpPermission: vi.fn(),
    setSessionModel: vi.fn(async () => undefined),
    setSessionReasoningEffort: vi.fn(),
    getChatBarCapabilities: vi.fn(async () => ({})),
    ...overrides,
  };
  return deps;
}

describe('createUserInputHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ignores empty or whitespace-only content', () => {
    const sessionService = createDeps();
    const handler = createUserInputHandler({ sessionService });
    const ws = { send: vi.fn() };

    void handler({
      ws: ws as never,
      sessionId: 'session-1',
      workingDir: '/tmp/work',
      message: { type: 'user_input', text: '   ' } as never,
    });

    void handler({
      ws: ws as never,
      sessionId: 'session-1',
      workingDir: '/tmp/work',
      message: { type: 'user_input' } as never,
    });

    expect(sessionService.sendSessionMessage).not.toHaveBeenCalled();
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('forwards text input to active session', async () => {
    const sessionService = createDeps({ isSessionRunning: vi.fn(() => true) });
    const handler = createUserInputHandler({ sessionService });
    const ws = { send: vi.fn() };

    void handler({
      ws: ws as never,
      sessionId: 'session-1',
      workingDir: '/tmp/work',
      message: { type: 'user_input', text: 'hello' } as never,
    });

    await Promise.resolve();
    expect(sessionService.sendSessionMessage).toHaveBeenCalledWith('session-1', 'hello');
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('forwards structured content arrays to active session', async () => {
    const sessionService = createDeps({ isSessionRunning: vi.fn(() => true) });
    const handler = createUserInputHandler({ sessionService });
    const ws = { send: vi.fn() };
    const content = [{ type: 'text', text: 'from array' }];

    void handler({
      ws: ws as never,
      sessionId: 'session-2',
      workingDir: '/tmp/work',
      message: { type: 'user_input', content } as never,
    });

    await Promise.resolve();
    expect(sessionService.sendSessionMessage).toHaveBeenCalledWith('session-2', content);
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('returns websocket error when no active session exists', () => {
    const sessionService = createDeps({ isSessionRunning: vi.fn(() => false) });
    const handler = createUserInputHandler({ sessionService });
    const ws = { send: vi.fn() };

    void handler({
      ws: ws as never,
      sessionId: 'session-3',
      workingDir: '/tmp/work',
      message: { type: 'user_input', text: 'hello' } as never,
    });

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'error',
        message: 'No active session. Use queue_message to queue messages.',
      })
    );
  });

  it('injects skill content when message matches a skill command', async () => {
    vi.mocked(skillDiscoveryService.findSkillByName).mockResolvedValueOnce({
      name: 'my-skill',
      description: 'test skill',
      filePath: '/path/to/SKILL.md',
    });
    vi.mocked(skillDiscoveryService.getSkillContent).mockResolvedValueOnce(
      '# My Skill\nDo the thing.'
    );

    const sessionService = createDeps({ isSessionRunning: vi.fn(() => true) });
    const handler = createUserInputHandler({ sessionService });
    const ws = { send: vi.fn() };

    void handler({
      ws: ws as never,
      sessionId: 'session-4',
      workingDir: '/tmp/work',
      message: { type: 'user_input', text: '/my-skill fix the tests' } as never,
    });

    await vi.waitFor(() => {
      expect(sessionService.sendSessionMessage).toHaveBeenCalledWith(
        'session-4',
        '<skill name="my-skill">\n# My Skill\nDo the thing.\n</skill>\n\nfix the tests'
      );
    });
  });

  it('sends message as-is when skill is not found', async () => {
    const sessionService = createDeps({ isSessionRunning: vi.fn(() => true) });
    const handler = createUserInputHandler({ sessionService });
    const ws = { send: vi.fn() };

    void handler({
      ws: ws as never,
      sessionId: 'session-5',
      workingDir: '/tmp/work',
      message: { type: 'user_input', text: '/unknown-command do stuff' } as never,
    });

    await vi.waitFor(() => {
      expect(sessionService.sendSessionMessage).toHaveBeenCalledWith(
        'session-5',
        '/unknown-command do stuff'
      );
    });
  });
});
