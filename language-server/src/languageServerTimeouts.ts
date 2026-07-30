export const LANGUAGE_SERVER_TIMEOUTS_MS = Object.freeze({
    unrealReconnectDelay: 2000,
    windowsEditorOwnerQuery: 2000,
    verifiedDebugDatabaseRequestDelay: 250,
    initialOnlineNoTypeDbClassification: 5000,
    apiFullReadyWait: 2000,
    apiFullReadyPoll: 50,
    workspaceDiagnosticsSettle: 4000,
    workspaceDiagnosticsPoll: 10,
    shutdownPersistenceFlush: 1000,
    debugDatabaseChunkIntermessage: 1000,
    parentProcessWatchdog: 1000,
    cachePersistenceRetry: Object.freeze([1000, 3000, 5000] as const),
});
