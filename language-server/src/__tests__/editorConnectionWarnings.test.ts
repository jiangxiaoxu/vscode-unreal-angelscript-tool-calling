import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorConnectionWarnings } from '../editorConnectionWarnings';
import { EditorListenerIdentityResult } from '../editorListenerIdentity';

type IdentityFailure = Extract<EditorListenerIdentityResult, { ok: false }>;

test('repeated ownership and verification failures warn once per unchanged incident', () => {
    let warnings: string[] = [];
    let reporter = new EditorConnectionWarnings(reason => warnings.push(reason));
    for (let code of ['owner-mismatch', 'verification-failed', 'unsupported-platform'] as const)
    {
        let failure: IdentityFailure = { ok: false, code, reason: 'unavailable' };
        let count = warnings.length;
        reporter.report(failure);
        reporter.report({ ...failure });
        assert.equal(warnings.length, count + 1);
        reporter.report({ ...failure, reason: 'different failure' });
        assert.equal(warnings.length, count + 2);
    }
});

test('absent listeners stay silent and allow a later mismatch to warn again', () => {
    let warnings: string[] = [];
    let reporter = new EditorConnectionWarnings(reason => warnings.push(reason));
    let mismatch: IdentityFailure = { ok: false, code: 'owner-mismatch', reason: 'mismatch' };
    reporter.report(mismatch);
    reporter.report({ ok: false, code: 'no-listener', reason: 'absent' });
    reporter.report({ ok: false, code: 'no-listener', reason: 'absent' });
    assert.equal(warnings.length, 1);
    reporter.report(mismatch);
    assert.equal(warnings.length, 2);
});

test('verified connection reset allows a subsequent incident to warn again', () => {
    let count = 0;
    let reporter = new EditorConnectionWarnings(() => count++);
    let failure: IdentityFailure = { ok: false, code: 'owner-mismatch', reason: 'mismatch' };
    reporter.report(failure);
    reporter.reset();
    reporter.report(failure);
    reporter.report(failure);
    assert.equal(count, 2);
});
