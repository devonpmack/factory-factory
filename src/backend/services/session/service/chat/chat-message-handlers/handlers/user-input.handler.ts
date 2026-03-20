import { createLogger } from '@/backend/services/logger.service';
import type {
  ChatMessageHandler,
  ChatMessageHandlerSessionService,
} from '@/backend/services/session/service/chat/chat-message-handlers/types';
import { skillDiscoveryService } from '@/backend/services/session/service/skills/skill-discovery.service';
import type { AgentContentItem } from '@/shared/acp-protocol';
import type { UserInputMessage } from '@/shared/websocket';

const logger = createLogger('chat-message-handlers');

const SKILL_COMMAND_RE = /^\/(\S+)\s*([\s\S]*)$/;

/**
 * If the message starts with `/<skill-name> ...`, look up the skill,
 * read its content, and return a rewritten message with the skill
 * instructions prepended and the slash prefix stripped.
 * Returns null if no skill matches.
 */
async function maybeInjectSkillContent(text: string, workingDir: string): Promise<string | null> {
  const match = SKILL_COMMAND_RE.exec(text);
  if (!match) {
    return null;
  }
  const commandName = match[1];
  const rest = match[2] ?? '';
  if (!commandName) {
    return null;
  }
  const skill = await skillDiscoveryService.findSkillByName(workingDir, commandName);
  if (!skill) {
    return null;
  }
  const content = await skillDiscoveryService.getSkillContent(skill.filePath);
  if (!content) {
    return null;
  }
  const userMessage = rest.trim();
  return `<skill name="${skill.name}">\n${content}\n</skill>\n\n${userMessage}`;
}

export function createUserInputHandler(deps: {
  sessionService: ChatMessageHandlerSessionService;
}): ChatMessageHandler<UserInputMessage> {
  const { sessionService } = deps;

  return ({ ws, sessionId, workingDir, message }) => {
    const rawContent = message.content || message.text;
    if (!rawContent) {
      return;
    }

    if (typeof rawContent === 'string' && !rawContent.trim()) {
      return;
    }

    if (!sessionService.isSessionRunning(sessionId)) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'No active session. Use queue_message to queue messages.',
        })
      );
      return;
    }

    const send = async (content: string | AgentContentItem[]) => {
      try {
        if (typeof content === 'string' && workingDir) {
          const rewritten = await maybeInjectSkillContent(content, workingDir);
          if (rewritten !== null) {
            await sessionService.sendSessionMessage(sessionId, rewritten);
            return;
          }
        }
        await sessionService.sendSessionMessage(sessionId, content);
      } catch (error) {
        logger.error('Failed to send message to provider', { sessionId, error });
      }
    };

    const messageContent =
      typeof rawContent === 'string' ? rawContent : (rawContent as AgentContentItem[]);

    void send(messageContent);
  };
}
