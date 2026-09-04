"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchInstitutions = matchInstitutions;
const gatewayOf = (ctx) => ctx;
/**
 * The registry's own display name, not whichever name happens to come first.
 *
 * ROR returns names unordered and includes acronyms, local-language forms and aliases, so reading
 * index 0 yields "MGH" or "Hospital General de Massachusetts" about as often as the real name.
 */
function displayName(match) {
    const names = match.organization?.names ?? [];
    const display = names.find((n) => (n.types ?? []).includes("ror_display"));
    return (display ?? names[0])?.value;
}
/**
 * The PARENT relationship, if the registry records one.
 *
 * This is the reason this handler exists rather than a declarative projection: the parent is one entry
 * in a mixed array of children, parents and related organizations, and picking it out needs a filter
 * that a flat projection path cannot express. Projecting the array's types and labels as two parallel
 * lists is lossless but pushes the filtering onto every consumer, in Cypher, forever.
 */
function parentOf(match) {
    const rel = (match.organization?.relationships ?? []).find((r) => r.type === "parent");
    return { parent: rel?.label, parentRorId: rel?.id };
}
/**
 * Resolve institution names to registry identities, one call per name.
 *
 * ROR's affiliation matcher takes a single string — it is built for the messy institution text that
 * appears on a record — so names are resolved in sequence rather than batched. A name that matches
 * nothing yields no record at all: the honest answer for an institution the registry does not know,
 * and better than a placeholder that would count as a resolved institution downstream.
 */
async function matchInstitutions(ctx, args) {
    const api = gatewayOf(ctx).ror;
    const names = [...new Set((args.names ?? []).map((n) => String(n).trim()).filter(Boolean))];
    const out = [];
    for (const name of names) {
        // One institution failing to resolve must not lose the others: a single bad affiliation string
        // would otherwise take down the whole batch and read as "none of these sites are known".
        const response = await api.matchAffiliation({ affiliation: name }).catch(() => undefined);
        const best = response?.items?.[0];
        if (!best?.organization?.id)
            continue;
        out.push({
            name,
            rorId: best.organization.id,
            officialName: displayName(best),
            country: best.organization.locations?.[0]?.geonames_details?.country_name,
            score: best.score,
            // Explicitly boolean: absent means the matcher did NOT choose it, which is a weaker claim than
            // a match and must not read as one.
            chosen: best.chosen === true,
            ...parentOf(best),
            kinds: best.organization.types ?? [],
            established: best.organization.established,
        });
    }
    return out;
}
