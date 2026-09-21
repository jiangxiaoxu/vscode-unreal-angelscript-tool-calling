import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AddTypeToDatabase,
    DBProperty,
    DBType,
    GetRootNamespace,
    OnDirtyTypeCaches,
    ResetDatabaseForTests,
} from '../database';
import { GetAPISymbolMembers } from '../api_docs';

test('native direct property projection keeps editable read/write metadata', () =>
{
    ResetDatabaseForTests();
    const type = new DBType().initEmpty('UProjectionFixture');
    type.namespace = GetRootNamespace();
    const property = new DBProperty();
    property.fromJSON('EditableValue', ['int']);
    property.declaredModule = null;
    property.access = {
        read: { normal: 'allowed', restricted: 'allowed', restrictions: [{ code: 'Editable' }] },
        write: { normal: 'denied', restricted: 'allowed', restrictions: [{ code: 'Editable' }] },
    };
    type.addSymbol(property);

    AddTypeToDatabase(GetRootNamespace(), type);
    OnDirtyTypeCaches();

    const memberResult = GetAPISymbolMembers({
        name: 'UProjectionFixture',
        ownerKind: 'type',
        source: 'native',
        members: ['data'],
        limit: 20,
    });
    assert.equal(memberResult.ok, true, JSON.stringify(memberResult));
    if (memberResult.ok)
    {
        const members = memberResult.data.groups[0]?.members.items ?? [];
        assert.deepEqual(members.map((member) => member.name), ['EditableValue']);
        const direct = members[0];
        assert.equal(direct?.isCallable, false);
        assert.equal(direct?.isAccessor, undefined);
        assert.deepEqual(direct?.access, property.access);
    }

});
