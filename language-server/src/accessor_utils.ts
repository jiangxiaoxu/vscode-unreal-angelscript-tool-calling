import * as typedb from './database';

export type PropertyAccessorKind = "get" | "set";
export type PropertyAccessorSource = "metadata" | "native-signature";

export interface PropertyAccessorInfo
{
    kind : PropertyAccessorKind;
    propertyName : string;
    typename : string;
    source : PropertyAccessorSource;
}

function GetAccessorPropertyName(method : typedb.DBMethod, prefix : string) : string | null
{
    if (!method.name.startsWith(prefix))
        return null;

    let propertyName = method.name.substring(prefix.length);
    if (propertyName.length == 0)
        return null;

    return propertyName;
}

function IsNativeLegacyAccessorCandidate(method : typedb.DBMethod) : boolean
{
    return !method.declaredModule;
}

function GetAccessorSource(method : typedb.DBMethod) : PropertyAccessorSource | null
{
    if (method.isProperty)
        return "metadata";
    if (IsNativeLegacyAccessorCandidate(method))
        return "native-signature";
    return null;
}

export function GetPropertyAccessorInfo(method : typedb.DBMethod) : PropertyAccessorInfo | null
{
    let source = GetAccessorSource(method);
    if (!source)
        return null;

    let getterPropertyName = GetAccessorPropertyName(method, "Get");
    if (getterPropertyName && method.args.length == 0 && method.returnType && method.returnType != "void")
    {
        return {
            kind: "get",
            propertyName: getterPropertyName,
            typename: method.returnType,
            source,
        };
    }

    let setterPropertyName = GetAccessorPropertyName(method, "Set");
    if (setterPropertyName && method.args.length == 1 && method.returnType == "void")
    {
        return {
            kind: "set",
            propertyName: setterPropertyName,
            typename: method.args[0].typename,
            source,
        };
    }

    return null;
}
