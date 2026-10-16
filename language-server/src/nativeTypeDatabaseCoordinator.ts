import type { Socket } from 'net';
import { performance } from 'node:perf_hooks';
import type { Connection, MessageWriter, ResponseMessage } from 'vscode-languageserver/node';
import { DEFAULT_LANGUAGE_SERVER_BUDGETS, ResolvedAngelScriptLanguageServerOptions } from './languageServerContract';
import type { createLanguageServerAutomationRuntime } from './languageServerAutomationRuntime';
import { Message, MessageType } from './unreal-buffers';
import { UnrealTransportDiagnostics } from './unrealTransportDiagnostics';

type RpcMessage = any;
type DeferredMessage = { message: RpcMessage; next: (message: RpcMessage) => void; bytes: number };
type NativeTransaction = { cancelReason: string | null; disconnected: boolean; promise: Promise<void>; finishing?: boolean; reconnectScheduled?: boolean };
type SyncRound = { id: string; editorProcessId?: number; deadline: number; liveCommitted: boolean; generation: number | null; timer: NodeJS.Timeout | null };
let semanticMutationActive = false;
export function isNativeSemanticMutationActive(): boolean { return semanticMutationActive; }

type CoordinatorOptions = {
    connection: Connection;
    writer: MessageWriter;
    ipc: boolean;
    transport: UnrealTransportDiagnostics;
    runtime: ReturnType<typeof createLanguageServerAutomationRuntime>;
    scriptSnapshot: { markSemanticUnsettled(): void; markSemanticSettled(): void };
    getOptions(): ResolvedAngelScriptLanguageServerOptions | null;
    getSocket(): Socket | null;
    getSocketEpoch(): number;
    isStopping(): boolean;
    cancelReconnect(): void;
    cancelRequests(): void;
    cancelDiagnostics(): void;
    onCommitted(generation: number): void;
    onCommitFailure(): void;
    startDiagnostics(): void;
    resumeDiagnostics(): void;
    trySettle(): void;
};

// 负责 native 重建事务的 admission, 总预算和发布许可, 不依赖 server 单例.
export function createNativeTypeDatabaseCoordinator(options: CoordinatorOptions) {
var TYPE_DATABASE_SYNC_BUDGET_MS = 30000;
var TYPE_DATABASE_SYNC_TERMINAL_EXIT_CODE = 78;
let TypeDatabaseSyncRound: SyncRound | null = null;
let TypeDatabaseSyncGrant: Promise<SyncRound> | null = null;
var TypeDatabaseSyncStopped = false;
function CheckTypeDatabaseSyncDeadline() {
  if (TypeDatabaseSyncStopped || (TypeDatabaseSyncRound && performance.now() >= TypeDatabaseSyncRound.deadline))
    throw Object.assign(new Error("TypeDB synchronization exceeded its 30 second total budget. Restart the Language Server explicitly."), { code: "LanguageServerTypeDatabaseDeadlineExceeded" });
}
function StopTypeDatabaseSync(error: unknown) {
  TypeDatabaseSyncStopped = true;
  options.cancelReconnect();
  options.cancelRequests();
  clearTimeout(TypeDatabaseSyncRound?.timer);
  process.stderr.write(String((error as Error)?.message ?? error).slice(0, 1024) + "\n");
  if (options.getSocket()) options.transport.destroy(options.getSocket(), "type_database_sync_failed");
  process.exit(TYPE_DATABASE_SYNC_TERMINAL_EXIT_CODE);
}
async function BeginTypeDatabaseSync(editorProcessId: number | undefined = options.transport.get(options.getSocket())?.editorProcessId) {
  CheckTypeDatabaseSyncDeadline();
  if (TypeDatabaseSyncRound && TypeDatabaseSyncRound.editorProcessId === editorProcessId) return TypeDatabaseSyncRound;
  if (TypeDatabaseSyncRound && options.getOptions()?.role !== "project-daemon")
    throw Object.assign(new Error("Editor identity changed during TypeDB synchronization. Restart the Language Server explicitly."), { code: "LanguageServerTypeDatabaseEditorChanged" });
  if (TypeDatabaseSyncGrant) return TypeDatabaseSyncGrant;
  TypeDatabaseSyncGrant = (async () => {
    const grant: any = options.getOptions()?.role === "project-daemon"
      ? await options.connection.sendRequest("angelscript/beginTypeDatabaseSync", { phase: "begin", editorProcessId })
      : { roundId: "local", remainingMs: TYPE_DATABASE_SYNC_BUDGET_MS };
    if (!grant || typeof grant.roundId !== "string" || !Number.isFinite(grant.remainingMs) || grant.remainingMs <= 0 || grant.remainingMs > TYPE_DATABASE_SYNC_BUDGET_MS)
      throw new Error("Invalid TypeDB synchronization grant.");
    const round: SyncRound = { id: grant.roundId, editorProcessId, deadline: performance.now() + grant.remainingMs, liveCommitted: false, generation: null, timer: null };
    round.timer = setTimeout(() => StopTypeDatabaseSync(Object.assign(new Error("TypeDB synchronization deadline exceeded."), { code: "LanguageServerTypeDatabaseDeadlineExceeded" })), grant.remainingMs);
    round.timer.unref?.();
    TypeDatabaseSyncRound = round;
    return round;
  })().finally(() => { TypeDatabaseSyncGrant = null; });
  return TypeDatabaseSyncGrant;
}
let NativeTypeDatabaseTransaction: NativeTransaction | null = null;
var SemanticDatabaseEpoch = 0;
let DeferredSemanticMessages: DeferredMessage[] = [];
var DeferredSemanticBytes = 0;
var DeferredNativeCount = 0;
var DeferredNativeBytes = 0;
function ReserveNativeDeferred(bytes: number) {
  const budgets = options.getOptions()?.budgets ?? DEFAULT_LANGUAGE_SERVER_BUDGETS;
  if (DeferredNativeBytes + bytes > budgets.maxUncompressedBytes || DeferredNativeCount >= budgets.maxChunkCount) {
    if (NativeTypeDatabaseTransaction) NativeTypeDatabaseTransaction.cancelReason = "deferred_queue_budget_exceeded";
    process.stderr.write("TypeDB deferred_queue_budget_exceeded; child restart required.\n");
    process.exit(1);
    return false;
  }
  DeferredNativeBytes += bytes;
  DeferredNativeCount += 1;
  return true;
}
function ReturnNativeDeferred(bytes: number) {
  DeferredNativeBytes -= bytes;
  DeferredNativeCount -= 1;
}
function NativeDeferredHighWater() {
  const budgets = options.getOptions()?.budgets ?? DEFAULT_LANGUAGE_SERVER_BUDGETS;
  return DeferredNativeBytes >= budgets.maxUncompressedBytes / 2 || DeferredNativeCount >= budgets.maxChunkCount / 2;
}
var SemanticInputPaused = false;
function HandleNativeSemanticMessage(message: RpcMessage, next: (message: RpcMessage) => void, writer = options.writer) {
  if (message.method === "$/cancelRequest") {
    const cancelledId = message.params?.id;
    const index = (typeof cancelledId === "string" || typeof cancelledId === "number")
      ? DeferredSemanticMessages.findIndex((entry) => entry.message.id !== void 0 && entry.message.id === cancelledId) : -1;
    if (index >= 0) {
      const [entry] = DeferredSemanticMessages.splice(index, 1);
      DeferredSemanticBytes -= entry.bytes;
      ReturnNativeDeferred(entry.bytes);
      const cancellationResponse: ResponseMessage = { jsonrpc: "2.0", id: entry.message.id, error: { code: -32800, message: "Request cancelled before TypeDB admission." } };
      void Promise.resolve(writer.write(cancellationResponse)).catch((error) => {
        process.stderr.write(String((error as Error)?.message ?? error).slice(0, 1024) + "\n");
        process.exit(1);
      });
    }
  }
  const controls = ["initialize", "initialized", "angelscript/diagnosticsStatus", "angelscript/getUnrealConnectionStatus", "$/cancelRequest", "shutdown", "exit"];
  if (!NativeTypeDatabaseTransaction || !message.method || controls.includes(message.method)) {
    next(message);
    return;
  }
  const bytes = Buffer.byteLength(JSON.stringify(message));
  if (!ReserveNativeDeferred(bytes)) return;
  DeferredSemanticMessages.push({ message, next, bytes });
  DeferredSemanticBytes += bytes;
  if (!options.ipc && !SemanticInputPaused && NativeDeferredHighWater()) {
    process.stdin.pause();
    SemanticInputPaused = true;
  }
}
function ReleaseNativeSemanticMessages() {
  const messages = DeferredSemanticMessages;
  DeferredSemanticMessages = [];
  DeferredSemanticBytes = 0;
  for (const entry of messages) {
    ReturnNativeDeferred(entry.bytes);
    if (!options.isStopping()) entry.next(entry.message);
  }
  if (SemanticInputPaused) {
    SemanticInputPaused = false;
    process.stdin.resume();
  }
}

function CommitLegacyDebugDatabaseBase(socket: Socket, epoch: number) {
  if (options.getSocket() !== socket || epoch != options.getSocketEpoch() || !options.runtime.cache.isRefreshInProgress()) return;
  const startedAt = performance.now();
  const transaction: NativeTransaction = { cancelReason: null, disconnected: false, promise: null };
  let release: () => void;
  transaction.promise = new Promise<void>((resolve) => { release = resolve; });
  NativeTypeDatabaseTransaction = transaction;
  semanticMutationActive = true;
  SemanticDatabaseEpoch += 1;
  options.cancelDiagnostics();
  options.runtime.readiness.update({ fullReady: false, stage: "resolving", coverage: "none" });
  options.scriptSnapshot.markSemanticUnsettled();
  const check = () => {
    CheckTypeDatabaseSyncDeadline();
    if (transaction.cancelReason || options.isStopping() || options.getSocket() !== socket || epoch !== options.getSocketEpoch())
      throw new Error(transaction.cancelReason ?? "DebugDatabase transaction cancelled.");
  };
  options.transport.report(socket, "type_database_begin", { phase: "commit_live_refresh" });
  void (async () => {
    let succeeded = false;
    try {
      const accepted = await options.runtime.commitLiveRefresh(check, CheckTypeDatabaseSyncDeadline);
      if (TypeDatabaseSyncRound) {
        TypeDatabaseSyncRound.liveCommitted = true;
        TypeDatabaseSyncRound.generation = accepted.generation;
      }
      options.onCommitted(accepted.generation);
      succeeded = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "LanguageServerTypeDatabaseDeadlineExceeded") {
        StopTypeDatabaseSync(error);
        return;
      }
      if ((error as NodeJS.ErrnoException)?.code === "TypeDatabaseRecoveryFailed") {
        process.stderr.write(String((error as Error).message).slice(0, 1024) + "\n");
        process.exit(1);
        return;
      }
      options.onCommitFailure();
      options.transport.report(socket, "type_database_end", {
        phase: "commit_failure", succeeded: false,
        errorCode: String((error as NodeJS.ErrnoException)?.code ?? "").slice(0, 255), errorMessage: String((error as Error)?.message ?? error).slice(0, 1024)
      });
      if (!transaction.cancelReason && !options.isStopping() && options.getSocket() === socket) {
        options.transport.destroy(socket, "debug_database_commit_failed", { errorMessage: String((error as Error)?.message ?? error).slice(0, 1024) });
      }
      options.resumeDiagnostics();
    } finally {
      options.transport.report(socket, "type_database_end", { phase: "commit_live_refresh", durationMs: performance.now() - startedAt, succeeded });
      NativeTypeDatabaseTransaction = null;
      semanticMutationActive = false;
      release();
      options.transport.get(socket)?.drain?.();
      if (!NativeTypeDatabaseTransaction) ReleaseNativeSemanticMessages();
      options.startDiagnostics();
      options.trySettle();
    }
  })();
}

function FinishTypeDatabaseSync() {
  const round = TypeDatabaseSyncRound;
  if (!round || !round.liveCommitted || NativeTypeDatabaseTransaction) return;
  let release: () => void;
  const transaction: NativeTransaction = { finishing: true, cancelReason: null, disconnected: false, promise: new Promise<void>((resolve) => { release = resolve; }) };
  NativeTypeDatabaseTransaction = transaction;
  semanticMutationActive = true;
  void (async () => {
    try {
      CheckTypeDatabaseSyncDeadline();
      if (options.getOptions()?.role === "project-daemon") {
        const result: any = await options.connection.sendRequest("angelscript/beginTypeDatabaseSync", {
          phase: "finish", roundId: round.id, fullReady: true, liveCommitted: true
        });
        if (result?.completed !== true) throw new Error("TypeDB synchronization completion was rejected.");
      } else {
        CheckTypeDatabaseSyncDeadline();
      }
      if (options.isStopping() || transaction.cancelReason || transaction.disconnected || TypeDatabaseSyncRound !== round
          || options.runtime.cache.getActiveGeneration() !== round.generation || !round.liveCommitted)
        throw new Error("TypeDB synchronization changed before completion acknowledgement.");
      clearTimeout(round.timer);
      TypeDatabaseSyncRound = null;
      options.runtime.markCurrentGenerationFullReady();
      options.scriptSnapshot.markSemanticSettled();
      options.runtime.cache.approveAcceptedPublication(round.generation);
    } catch (error) {
      StopTypeDatabaseSync(error);
    } finally {
      NativeTypeDatabaseTransaction = null;
      semanticMutationActive = false;
      release();
      options.transport.get(options.getSocket())?.drain?.();
      if (!NativeTypeDatabaseTransaction) ReleaseNativeSemanticMessages();
      options.trySettle();
    }
  })();
}

return {
    handleMessage: HandleNativeSemanticMessage,
    begin: BeginTypeDatabaseSync,
    checkDeadline: CheckTypeDatabaseSyncDeadline,
    stop: StopTypeDatabaseSync,
    commit: CommitLegacyDebugDatabaseBase,
    get active() { return NativeTypeDatabaseTransaction; },
    get epoch() { return SemanticDatabaseEpoch; },
    get stopped() { return TypeDatabaseSyncStopped; },
    abort(reason: string): boolean {
        if (TypeDatabaseSyncRound) TypeDatabaseSyncRound.liveCommitted = false;
        if (!NativeTypeDatabaseTransaction) return false;
        NativeTypeDatabaseTransaction.cancelReason = reason;
        NativeTypeDatabaseTransaction.disconnected = true;
        return true;
    },
    deferReconnect(run: () => void): boolean {
        if (TypeDatabaseSyncStopped) return true;
        if (!NativeTypeDatabaseTransaction) return false;
        if (!NativeTypeDatabaseTransaction.reconnectScheduled) {
            NativeTypeDatabaseTransaction.reconnectScheduled = true;
            void NativeTypeDatabaseTransaction.promise.then(run);
        }
        return true;
    },
    settlePending(): boolean {
        if (TypeDatabaseSyncRound?.liveCommitted) { FinishTypeDatabaseSync(); return true; }
        return TypeDatabaseSyncRound?.generation != null && options.runtime.cache.getActiveGeneration() === TypeDatabaseSyncRound.generation;
    },
    createEngineQueue(socket: Socket, dispatch: (message: Message) => void, isCurrent: () => boolean) {
        let messages: Message[] = [];
        let index = 0;
        function dispatchReady(message: Message) {
            if (TypeDatabaseSyncStopped) return;
            if (message.type === MessageType.DebugDatabaseSettings && !TypeDatabaseSyncRound) {
                enqueue(message);
                void BeginTypeDatabaseSync().then(drain, StopTypeDatabaseSync);
                return;
            }
            try { CheckTypeDatabaseSyncDeadline(); }
            catch (error) { StopTypeDatabaseSync(error); return; }
            if (message.type === MessageType.DebugDatabaseSettings && TypeDatabaseSyncRound) TypeDatabaseSyncRound.liveCommitted = false;
            dispatch(message);
        }
        function enqueue(message: Message) {
            if (message.type === MessageType.DebugDatabaseSettings && NativeTypeDatabaseTransaction && !NativeTypeDatabaseTransaction.finishing)
                NativeTypeDatabaseTransaction.cancelReason = 'superseded_debug_database';
            if (!ReserveNativeDeferred(message.size + 5)) return;
            messages.push(message);
            if (NativeDeferredHighWater()) socket.pause();
        }
        function drain() {
            while (!NativeTypeDatabaseTransaction && !TypeDatabaseSyncGrant && index < messages.length) {
                const message = messages[index++];
                ReturnNativeDeferred(message.size + 5);
                if (isCurrent() && !options.isStopping()) dispatchReady(message);
            }
            messages = messages.slice(index);
            index = 0;
            if (!NativeTypeDatabaseTransaction && isCurrent() && !options.isStopping()) socket.resume();
        }
        function clear() {
            for (; index < messages.length; index++) ReturnNativeDeferred(messages[index].size + 5);
            messages = []; index = 0;
        }
        const identity = options.transport.get(socket)!;
        identity.drain = drain;
        identity.clear = clear;
        return {
            clear,
            receive(incoming: Message[]) {
                for (const message of incoming) {
                    if (NativeTypeDatabaseTransaction || TypeDatabaseSyncGrant) enqueue(message);
                    else dispatchReady(message);
                }
            },
        };
    },
};
}
