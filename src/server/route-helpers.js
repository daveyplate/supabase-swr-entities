import { SupabaseClient, PostgrestError, User } from '@supabase/supabase-js'
import { createAdminClient } from '../supabase/service-role.js'

export const METHOD_MAP = {
    "GET": "select",
    "PATCH": "update",
    "POST": "upsert",
    "DELETE": "delete"
}

/**
 * Authorize a user based on the request headers
 * @param {SupabaseClient} supabase - Supabase client
 * @param {object} headers - Request headers
 * @returns {Promise<{user: User?, error: PostgrestError?}>} User or error
 */
export async function authorizeUser(supabase, headers) {
    const supabaseAdmin = createAdminClient()

    // Check for Bearer access token
    const authToken = headers?.authorization?.split('Bearer ')[1]

    // Check api_keys for a user entry
    if (authToken?.startsWith('sk-')) {
        const { data: { user_id }, error } = await supabaseAdmin
            .from('api_keys')
            .select('user_id')
            .eq('api_key', authToken)
            .single()

        if (error) console.error(error)

        return { user: { id: user_id }, error }
    }

    const { data: { user }, error } = await supabase.auth.getUser()

    if (error) console.error(error)

    return { user, error }
}

/** 
 * Authorize a user based on the request headers
 * @param {SupabaseClient} supabase - Supabase client
 * @param {("GET"|"POST"|"PATCH"|"DELETE")} method - Request method
 * @param {object} headers - Request headers
 * @param {object} params - Request query parameters
 * @param {object} entitySchema - Entity schema
 * @param {boolean} [admin=false] - Admin authorization
 * @returns {Promise<{user: User?, error: Error?}>} User or error
 */
export async function authorizeParams(supabase, method, headers, params, entitySchema, admin = false) {
    const { user, error } = await authorizeUser(supabase, headers)
    if (error) return { error }

    // TODO setup admin claim
    if (admin && !user.is_admin) {
        return { error: new Error("Unauthorized") }
    }

    // Add authColumns to params if not admin
    if (!admin) {
        const authColumns = entitySchema.authColumns?.[METHOD_MAP[method]] || [entitySchema.authColumn]
        if (!authColumns.length) return { error: new Error("No authColumns found") }

        if (authColumns.length == 1) {
            params[authColumns[0]] = user.id
        } else {
            params.or = authColumns.map(column => column + ".eq." + user.id).join(',')
        }
    }

    return { user }
}