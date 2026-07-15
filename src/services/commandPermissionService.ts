/** Frontend broker for command approvals emitted by any Pi runtime. */
export type CommandPermissionDecision = "deny" | "allow_once" | "allow_session";
export type CommandRisk = "normal" | "elevated" | "destructive";

export interface CommandPermissionRequest {
  requestId: string;
  sessionId: string;
  command: { program: string; args: string[]; cwd: string; timeoutMs: number };
  risk: CommandRisk;
  description: string;
}

type PendingPermission = CommandPermissionRequest & { socket: WebSocket };
type Listener = () => void;

class CommandPermissionService {
  private queue: PendingPermission[] = [];
  private listeners = new Set<Listener>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): CommandPermissionRequest | null => this.queue[0] || null;

  enqueue(message: CommandPermissionRequest, socket: WebSocket): void {
    if (this.queue.some((request) => request.requestId === message.requestId)) return;
    this.queue.push({ ...message, socket });
    this.emit();
  }

  resolve(requestId: string, decision: CommandPermissionDecision): void {
    const request = this.queue.find((candidate) => candidate.requestId === requestId);
    if (!request) return;
    if (request.socket.readyState === WebSocket.OPEN) {
      request.socket.send(JSON.stringify({ type: "command_permission_response", requestId, decision }));
    }
    this.queue = this.queue.filter((candidate) => candidate.requestId !== requestId);
    this.emit();
  }

  removeForSocket(socket: WebSocket): void {
    const next = this.queue.filter((request) => request.socket !== socket);
    if (next.length !== this.queue.length) {
      this.queue = next;
      this.emit();
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const commandPermissionService = new CommandPermissionService();

/** Returns true when a WebSocket message was consumed by the permission broker. */
export function handleCommandPermissionMessage(message: any, socket: WebSocket): boolean {
  if (message?.type !== "command_permission_request" || !message.requestId || !message.sessionId) return false;
  commandPermissionService.enqueue(message as CommandPermissionRequest, socket);
  return true;
}
