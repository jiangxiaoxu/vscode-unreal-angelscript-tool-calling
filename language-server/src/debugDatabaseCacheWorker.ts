import { parentPort, workerData } from 'node:worker_threads';
import {
    DebugDatabaseCacheContext,
    DebugDatabaseCachePayload,
    prepareDebugDatabaseCacheV2Temp,
} from './debugDatabaseCacheV2';

type CachePreparationWorkerData = {
    context: DebugDatabaseCacheContext;
    payload: DebugDatabaseCachePayload;
};

let input = workerData as CachePreparationWorkerData;
void prepareDebugDatabaseCacheV2Temp(input.context, input.payload).then(
    (prepared) => parentPort!.postMessage({ ok: true, prepared }),
    (error) => parentPort!.postMessage({ ok: false, error: String(error) }),
);
