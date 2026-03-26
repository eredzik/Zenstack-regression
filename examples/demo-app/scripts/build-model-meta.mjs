/**
 * Build ZenStack v2 ModelMeta from Prisma DMMF (open policies, no generated .zenstack).
 */
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(path.join(root, "package.json"));
const { Prisma } = require("@prisma/client");

const relationAction = (a) =>
  a === "Cascade" ||
  a === "Restrict" ||
  a === "NoAction" ||
  a === "SetNull" ||
  a === "SetDefault"
    ? a
    : "NoAction";

function backLinkFor(modelName, relationName) {
  const other = Prisma.dmmf.datamodel.models.find((m) =>
    m.fields.some(
      (f) =>
        f.kind === "object" &&
        f.relationName === relationName &&
        m.name !== modelName
    )
  );
  if (!other) return undefined;
  const back = other.fields.find(
    (f) => f.kind === "object" && f.relationName === relationName
  );
  return back?.name;
}

function buildModelMeta() {
  const fkScalars = new Set();
  for (const m of Prisma.dmmf.datamodel.models) {
    for (const f of m.fields) {
      if (f.kind === "object" && f.relationFromFields?.length) {
        for (const fk of f.relationFromFields) fkScalars.add(`${m.name}.${fk}`);
      }
    }
  }

  const models = {};
  for (const m of Prisma.dmmf.datamodel.models) {
    const modelKey = m.name.charAt(0).toLowerCase() + m.name.slice(1);
    const fields = {};
    for (const f of m.fields) {
      if (f.kind === "scalar") {
        const attrs = [];
        if (f.isId) attrs.push({ name: "@id" });
        if (f.isUnique) attrs.push({ name: "@unique" });
        fields[f.name] = {
          name: f.name,
          type: f.type,
          isId: f.isId || undefined,
          isOptional: !f.isRequired,
          isArray: f.isList,
          isForeignKey: fkScalars.has(`${m.name}.${f.name}`) || undefined,
          attributes: attrs.length ? attrs : undefined,
        };
      } else {
        fields[f.name] = {
          name: f.name,
          type: f.type,
          isDataModel: true,
          isOptional: !f.isRequired,
          isArray: f.isList,
          isRelationOwner: !!(f.relationFromFields && f.relationFromFields.length),
          backLink: backLinkFor(m.name, f.relationName),
          onDeleteAction: f.relationOnDelete
            ? relationAction(f.relationOnDelete)
            : undefined,
        };
      }
    }

    const uniqueConstraints = {};
    m.uniqueFields.forEach((fieldNames, i) => {
      const name = fieldNames.join("_") || `uq_${i}`;
      uniqueConstraints[name] = { name, fields: fieldNames };
    });

    models[modelKey] = {
      name: m.name,
      fields,
      uniqueConstraints:
        Object.keys(uniqueConstraints).length > 0
          ? uniqueConstraints
          : undefined,
    };
  }

  const deleteCascade = {};
  for (const m of Prisma.dmmf.datamodel.models) {
    const modelKey = m.name.charAt(0).toLowerCase() + m.name.slice(1);
    const targets = new Set();
    for (const f of m.fields) {
      if (
        f.kind === "object" &&
        f.relationFromFields?.length &&
        f.relationOnDelete === "Cascade"
      ) {
        targets.add(f.type);
      }
    }
    if (targets.size) deleteCascade[modelKey] = [...targets];
  }

  return {
    models,
    deleteCascade:
      Object.keys(deleteCascade).length > 0 ? deleteCascade : undefined,
  };
}

function openPolicy() {
  const t = () => true;
  const modelLevel = {
    read: { guard: t },
    create: { guard: t },
    update: { guard: t },
    delete: { guard: t },
    postUpdate: { guard: t },
  };
  const models = Object.fromEntries(
    Prisma.dmmf.datamodel.models.map((m) => {
      const key = m.name.charAt(0).toLowerCase() + m.name.slice(1);
      return [key, { modelLevel: { ...modelLevel } }];
    })
  );
  return {
    policy: models,
    validation: Object.fromEntries(
      Prisma.dmmf.datamodel.models.map((m) => {
        const key = m.name.charAt(0).toLowerCase() + m.name.slice(1);
        return [key, { hasValidation: false }];
      })
    ),
  };
}

const outDir = path.join(root, "zenstack-generated");
mkdirSync(outDir, { recursive: true });

const modelMeta = buildModelMeta();
const policy = openPolicy();

writeFileSync(
  path.join(outDir, "model-meta.json"),
  JSON.stringify(modelMeta, null, 2),
  "utf8"
);
writeFileSync(
  path.join(outDir, "policy.json"),
  JSON.stringify(policy, null, 2),
  "utf8"
);

console.log("Wrote zenstack-generated/model-meta.json and policy.json");
