import type { DragonFlowConfig, ParsedCommand, ParsedCommandType } from '@dragonflow/shared';

const COMMAND_PATTERN = /^\/(auto|approve|reject|fix|retry|merge|cancel)(?:\s+(.*))?$/i;

const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export function isMaintainer(
  author: string,
  authorAssociation: string | undefined,
  config: DragonFlowConfig,
): boolean {
  if (authorAssociation && MAINTAINER_ASSOCIATIONS.has(authorAssociation.toUpperCase())) {
    return true;
  }
  const normalized = author.toLowerCase();
  return config.github.maintainers.some((m) => m.toLowerCase() === normalized);
}

export function parseMaintainerCommand(
  body: string,
  author: string,
  commentId: number,
): ParsedCommand | null {
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('/')) continue;
    const match = line.match(COMMAND_PATTERN);
    if (!match) continue;
    const command = match[1].toLowerCase() as ParsedCommandType;
    const arg = match[2]?.trim() || undefined;
    return {
      command,
      arg,
      author,
      commentId,
    };
  }
  return null;
}
