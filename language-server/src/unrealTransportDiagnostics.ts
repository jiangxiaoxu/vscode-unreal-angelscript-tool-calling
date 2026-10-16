import type { Socket } from 'net';
import { performance } from 'node:perf_hooks';

export type UnrealTransportIdentity = {
    epoch: number;
    endpoint: { host: string; port: number };
    editorProcessId?: number;
    chunkCount: number;
    decodeDurationMs: number;
    drain?: () => void;
    clear?: () => void;
};

// 连接身份和有界诊断属于 transport, 不影响生命周期判定.
export class UnrealTransportDiagnostics {
    private readonly identities = new WeakMap<Socket, UnrealTransportIdentity>();
    constructor(private readonly notify: (method: string, payload: unknown) => Promise<void>) {}
    attach(socket: Socket, epoch: number, host: string, port: number): UnrealTransportIdentity {
        const identity = { epoch, endpoint: { host, port }, chunkCount: 0, decodeDurationMs: 0 };
        this.identities.set(socket, identity);
        this.report(socket, 'connect_attempt');
        return identity;
    }
    get(socket: Socket | null): UnrealTransportIdentity | undefined {
        return socket ? this.identities.get(socket) : undefined;
    }
    report(socket: Socket | null, event: string, fields: Record<string, unknown> = {}): void {
        try {
            const identity = this.get(socket);
            if (!identity) return;
            void this.notify('angelscript/transportDiagnostic', {
                schemaVersion: 1, event, epoch: identity.epoch, endpoint: identity.endpoint,
                monotonicMs: performance.now(), ...fields,
            }).catch(() => {});
        } catch {}
    }
    destroy(socket: Socket, reason: string, fields: Record<string, unknown> = {}): void {
        this.report(socket, 'socket_destroy', { reason, ...fields });
        this.get(socket)?.clear?.();
        socket.destroy();
    }
}
