import { SupabaseClient } from '@supabase/supabase-js'

import { createEntity, deleteEntities, getEntities, loadEntitySchema, updateEntities } from './entity-helpers'
import { authorizeParams, METHOD_MAP } from './route-helpers'

/**
 * Entities route handler
 * @param {object} options Options
 * @param {SupabaseClient} options.supabase Supabase client
 * @param {("GET"|"POST"|"PATCH"|"DELETE")} options.method HTTP method
 * @param {object} [options.headers] HTTP headers
 * @param {object} options.query Request query parameters
 * @param {object} [options.body] Request body
 * @returns {Promise<{status: number, body: {}}>} Response status and body
 */
export async function entitiesRoute({ supabase, method, headers, query, body }) {
    method = method.toUpperCase()

    // Determine the table and load the Schema
    const { entities, admin } = query
    const table = entities.replace(/-/g, '_')

    const { entitySchema, error } = await loadEntitySchema(table)
    if (error) return { status: 404, body: { error } }

    // Determine allowed methods
    if (entitySchema.disableList) return { status: 405, body: { error: { message: 'Method Not Allowed' } } }

    const allowMethod = entitySchema.allowMethods.find((allowMethod) => allowMethod == METHOD_MAP[method] || allowMethod == '*')
    if (!allowMethod) return { status: 405, body: { error: { message: 'Method Not Allowed' } } }

    // Build query parameters
    const params = { ...entitySchema.defaultParams, ...query, ...entitySchema.requiredParams }
    delete params.entities
    delete params.admin

    // Authorize the request
    const authorize = entitySchema.authMethods.find((authMethod) => authMethod == METHOD_MAP[method] || authMethod == '*')

    // Add deactivated filter if set
    if (entitySchema.hasDeactivated && !admin) {
        params.deactivated = false
    }

    if (authorize || admin) {
        const { user, error } = await authorizeParams(supabase, method, headers, params, entitySchema, admin)
        if (error) return { status: 401, body: { error } }

        // Add user_id to post body if not admin or not set
        if (method == 'POST' && (!admin || !body?.user_id)) {
            body = { ...body, user_id: user.id }
        }
    }

    // Execute query based on method
    if (method == 'GET') {
        const { entities, count, limit, offset, error } = await getEntities(table, params)
        if (error) return { status: 500, body: { error } }

        return {
            status: 200,
            body: {
                data: entities,
                count: count,
                limit: limit,
                offset: offset,
                has_more: offset + entities.length < count
            }
        }
    } else if (method == 'POST') {
        const { entity, error } = await createEntity(table, body)
        if (error) return { status: 500, body: { error } }

        return { status: 201, body: entity }
    } else if (method == 'PATCH') {
        const { error } = await updateEntities(table, body, params)
        if (error) return { status: 500, body: { error } }

        return { status: 200, body: { success: true } }
    } else if (method == 'DELETE') {
        const { entities, error } = await deleteEntities(table, params)
        if (error) return { status: 500, body: { error } }

        return { status: 200, body: { data: entities } }
    }

    return { status: 405, body: { error: { message: 'Method Not Allowed' } } }
}