export const LANGUAGE_SERVER_TIMEOUTS_MS = Object.freeze({
    unrealReconnectDelay: 2000,
    windowsEditorOwnerQuery: 30000,
    verifiedDebugDatabaseRequestDelay: 250,
    initialOnlineNoTypeDbClassification: 30000,
    apiFullReadyWait: 30000,
    apiFullReadyPoll: 50,
    workspaceDiagnosticsSettle: 30000,
    workspaceDiagnosticsPoll: 10,
    shutdownPersistenceFlush: 30000,
    debugDatabaseChunkIntermessage: 30000,
    parentProcessWatchdog: 1000,
    cachePersistenceRetry: Object.freeze([1000, 3000, 5000] as const),
});
