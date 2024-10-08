import { SupabaseClient } from '@supabase/supabase-js'
import jwt from 'jsonwebtoken'

import { createEntity, deleteEntities, getEntities, updateEntities } from './entity-helpers'

/**
 * Entities route handler
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
export async function entitiesRoute({ supabase, supabaseAdmin, entitySchemas, method, headers, query, body }) {
    // Determine the Entity and get the Schema
    const { entities } = query
    const table = entities.replace(/-/g, '_')

    if (table == 'users' || table == 'profiles') return { status: 404, body: { error: { message: 'Resource Not Found' } } }

    const entitySchema = entitySchemas.find(schema => schema.table === table)
    if (!entitySchema) return { status: 404, body: { error: { message: 'Resource Not Found' } } }

    let params = { ...query }

    delete params.entities

    // Authenticate the user
    if (entitySchema.authenticate) {
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

            params.user_id = user_id

            if (body) {
                body.user_id = user_id
            }
        } else {
            const { data: { session } } = await supabase.auth.getSession()

            try {
                const accessToken = session?.access_token || authToken
                const user = jwt.verify(accessToken, process.env.SUPABASE_JWT_SECRET)
                user.id = user.sub

                params.user_id = user.id

                if (body) {
                    body.user_id = user.id
                }
            } catch (error) {
                console.error(error)

                return {
                    status: 401,
                    body: {
                        error: { message: 'Unauthorized' }
                    }
                }
            }
        }
    }

    // Build query
    if (method == 'GET') {
        const { entities, count, limit, offset, error } = await getEntities(supabaseAdmin, entitySchemas, table, params)
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
        if (!entitySchema.authenticate) return { status: 401, body: { error: { message: 'Unauthorized' } } }

        // Upsert body on POST
        const { entity, error } = await createEntity(supabaseAdmin, entitySchemas, table, body)
        if (error) return { status: 500, body: { error } }

        return { status: 201, body: entity }
    } else if (method == 'DELETE') {
        if (!entitySchema.authenticate) return { status: 401, body: { error: { message: 'Unauthorized' } } }

        // Delete the entities
        const { error } = await deleteEntities(supabaseAdmin, entitySchemas, table, params)
        if (error) return { status: 500, body: { error } }

        return { status: 200, body: { success: true } }
    } else if (method == 'PATCH') {
        if (!entitySchema.authenticate) return { status: 401, body: { error: { message: 'Unauthorized' } } }

        const { error } = await updateEntities(supabaseAdmin, entitySchemas, table, body, params)
        if (error) return { status: 500, body: { error } }

        return { status: 200, body: { success: true } }
    }

    return { status: 405, body: { error: { message: 'Method Not Allowed' } } }
}