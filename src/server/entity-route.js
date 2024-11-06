import { SupabaseClient } from '@supabase/supabase-js'

import { getEntity, updateEntity, deleteEntity, loadEntitySchemas, createAdminClient, loadEntitySchema } from './entity-helpers'
import { authorizeParams, METHOD_MAP } from './route-helpers'

/**
 * Entity route handler
 * @param {object} options Options
 * @param {SupabaseClient} options.supabase Supabase client
 * @param {("GET"|"POST"|"PATCH"|"DELETE")} options.method HTTP method
 * @param {object} [options.headers] HTTP headers
 * @param {object} options.query Request query parameters
 * @param {object} [options.body] Request body
 * @returns {Promise<{status: number, body: {}}>} Response status and body
 */
export async function entityRoute({ supabase, method, headers, query, body }) {
    method = method.toUpperCase()

    // Determine the table and load the schema
    let { entities, entity_id, admin } = query
    const table = entities.replace(/-/g, '_')

    const { entitySchema, error } = await loadEntitySchema(table)
    if (error) return { status: 404, body: { error } }

    // Determine allowed methods
    const allowMethod = entitySchema.allowMethods.find((allowMethod) => allowMethod == METHOD_MAP[method] || allowMethod == '*')
    if (!allowMethod) return { status: 405, body: { error: { message: 'Method Not Allowed' } } }

    // Build query parameters
    const params = { ...entitySchema.defaultParams, ...query, ...entitySchema.requiredParams }
    delete params.entities
    delete params.entity_id
    delete params.admin

    // Authorize the request
    const authorize = entitySchema.authMethods.find((authMethod) => authMethod == METHOD_MAP[method] || authMethod == '*')

    if (authorize || admin || (entitySchema.hasMe && entity_id == 'me')) {
        const { error } = await authorizeParams(supabase, headers, params, entitySchema, admin)
        if (error) return { status: 401, body: { error } }
    }

    // Add deactivated filter if set
    if (entitySchema.hasDeactivated && !admin && (!entitySchema.hasMe || entity_id != 'me')) {
        params.deactivated = false
    }

    // Alternative non-UUID identifier 
    if (entitySchema.altIdentifier && !isValidUUID(entity_id) && (!entitySchema.hasMe || entity_id != 'me')) {
        params[entitySchema.altIdentifier] = entity_id
        entity_id = null
    }

    // Build query
    if (method == 'GET') {
        const { entity, error } = await getEntity(table, entity_id, params)
        if (error) return { status: 500, body: { error } }
        if (!entity) return { status: 404, body: { error: { message: 'Resource Not Found' } } }

        // Reactivate deactivated users
        if (entity_id == 'me' && entity.deactivated) {
            const { entity: newEntity, error: updateError } = await updateEntity(table, entity.id, { deactivated: false })
            if (updateError) return { status: 500, body: { error: updateError } }
            return { status: 200, body: newEntity }
        }

        return { status: 200, body: entity }
    } else if (method == 'PATCH') {
        const { entity, error } = await updateEntity(table, entity_id, body, params)
        if (error) return { status: 500, body: { error } }

        return { status: 200, body: entity }
    } else if (method == 'DELETE') {
        const { success, error } = await deleteEntity(table, entity_id, params)
        if (error) return { status: 500, body: { error } }

        return { status: 200, body: { success } }
    }

    return { status: 405, body: { error: { message: 'Method Not Allowed' } } }
}

function isValidUUID(uuid) {
    const regex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89ABab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
    return regex.test(uuid);
}