import { SupabaseClient } from '@supabase/supabase-js'

import { getEntity, updateEntity, deleteEntity, loadEntitySchemas } from './entity-helpers'


/**
 * Entity route handler
 * @param {{}} options Options
 * @param {SupabaseClient} options.supabase Supabase client
 * @param {SupabaseClient} options.supabaseAdmin Service Role Supabase client
 * @param {[{table: string, select: string[], defaultOrder: string, defaultParams: {}, authenticate: boolean}]} options.entitySchemas Entity schemas
 * @param {string} options.method HTTP method
 * @param {{}} options.headers HTTP headers
 * @param {{}} options.query Request query parameters
 * @param {{}} options.body Request body
 * @returns {Promise<{status: number, body: {}}>} Response status and body
 */
export async function entityRoute({ supabase, supabaseAdmin, method, headers, query, body }) {
    const entitySchemas = loadEntitySchemas()

    // Determine the Entity and get the Schema
    let { entities, entity_id } = query
    const table = entities.replace(/-/g, '_')

    const entitySchema = entitySchemas.find(schema => schema.table === table)
    if (!entitySchema) return res.status(404).json({ error: { message: 'Resource Not Found' } })

    let params = { ...query }

    delete params.entities
    delete params.entity_id

    // Authenticate the user
    if (entitySchema.authenticate || ((table == 'users' || table == 'profiles') && entity_id == 'me')) {
        // Check for Bearer access token
        const authToken = headers?.authorization?.split('Bearer ')[1]

        // Check api_keys for a user entry
        if (authToken?.startsWith('sk-')) {
            const { data: { user_id } } = await supabaseAdmin
                .from('api_keys')
                .select('user_id')
                .eq('api_key', authToken)
                .single()

            if (!user_id) {
                return {
                    status: 401,
                    body: {
                        error: { message: 'Unauthorized' }
                    }
                }
            }

            if (table == 'users' || table == 'profiles') {
                params.id = user_id
            } else {
                params.user_id = user_id
            }
        } else {
            const { data: { user } } = await supabase.auth.getUser()

            if (!user) {
                return {
                    status: 401,
                    body: {
                        error: { message: 'Unauthorized' }
                    }
                }
            }

            if (table == 'users' || table == 'profiles') {
                params.id = user.id
            } else {
                params.user_id = user.id
            }
        }
    }

    // Build query
    if (method == 'GET') {
        // Support usernames
        if ((table == 'users' || table == 'profiles') && !isValidUUID(entity_id) && entity_id != 'me') {
            params.username = entity_id
            entity_id = null
        }

        // Get the entity from Postgres with given ID & params
        const { entity, error } = await getEntity(supabaseAdmin, entitySchemas, table, entity_id, params)
        if (error) return { status: 500, body: { error } }

        if (!entity) {
            return { status: 404, body: { error: { message: 'Resource Not Found' } } }
        }

        return { status: 200, body: entity }
    } else if (method == 'PATCH') {
        if (!entitySchema.authenticate && table != 'users' && table != 'profiles') return { status: 401, body: { error: { message: 'Unauthorized' } } }
        if ((table == 'users' || table == 'profiles') && entity_id != 'me') return { status: 405, body: { error: { message: 'Method Not Allowed' } } }

        const { entity, error } = await updateEntity(supabaseAdmin, entitySchemas, table, entity_id, body, params)
        if (error) return { status: 500, body: { error } }

        return { status: 200, body: entity }
    } else if (method == 'DELETE') {
        if (!entitySchema.authenticate && table != 'users' && table != 'profiles') return { status: 401, body: { error: { message: 'Unauthorized' } } }
        if ((table == 'users' || table == 'profiles') && entity_id != 'me') return { status: 405, body: { error: { message: 'Method Not Allowed' } } }

        if (table == 'users' || table == 'profiles') {
            // Delete the user from the auth.users table which will also cascade delete from public.users
            const { error } = await supabaseAdmin.auth.admin.deleteUser(
                params.id
            )

            if (error) {
                console.error(error)
                return { status: 500, body: { error } }
            }

            return { status: 200, body: { success: true } }
        } else {
            // Delete non-user entities as normal
            const { success, error } = await deleteEntity(supabaseAdmin, entitySchemas, table, entity_id, params)
            if (error) return { status: 500, body: { error } }

            return { status: 200, body: { success } }
        }
    }

    return { status: 405, body: { error: { message: 'Method Not Allowed' } } }
}

function isValidUUID(uuid) {
    const regex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89ABab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
    return regex.test(uuid);
}